# Blink data export / import

Phone‑to‑phone (or phone‑to‑computer) migration of the local history that lives
only on the device. **Orthogonal to journal sync** — the journal keeps a limited
window on the server, whereas this copies the *full* local store (contacts,
messages, file transfers) directly over the LAN.

There are two halves:

1. **Export** — the device runs a small HTTP server on the Wi‑Fi/LAN. A browser
   (computer or another phone) connects to it to browse and download.
2. **Import** — the device announces itself to the user's *own* account; the
   announcement forks to their other devices, which pop an **Import** screen and
   pull the data **add‑only** (never updates/deletes), decrypting it in transit.

---

## 1. Files

| File | Role |
|------|------|
| `app/ExportServer.js` | Singleton: TCP/TLS server (react‑native‑tcp‑socket), random port + token + session key, opens its own read connection to `sylk.db`, the SQLite data provider. |
| `app/exportRouter.js` | Transport‑free HTTP/1.1 routing, auth, response sealing. Shared by the device server **and** the Node mock. |
| `app/exportArchive.js` | Pure: app‑tree path mapping, `transfer-<id>.metadata` sidecars, `chat.txt`/`chat.html` rendering, streaming **STORE** zip (+ exact Content‑Length). |
| `app/exportCrypto.js` | Pure: NaCl `secretbox` seal/open + key generation. |
| `app/exportAnnounce.js` | Pure: `application/sylk-data-export` payload `{server,key,enc,timestamp}` + 60 s freshness. |
| `app/importClient.js` | Pure: add‑only diff + copy orchestration over injected fetchers. |
| `app/exportWebUI.js` | The self‑contained web page served to browsers (login, summary, kind/category/contact/calendar, downloads). |
| `app/components/ExportDataModal.js` | On‑device "Data export" modal (URL, key, QR, status). |
| `app/components/ImportDataModal.js` | Native "Import data" modal (controls + add‑only preview + import). |
| `tools/gen-export-cert.sh` | Generates the self‑signed `server-keystore.p12` (only needed for the optional TLS path). |
| `tools/export-mock-server.js` | Runs the **real** router + web UI over Node `https` with a fake provider — `--selftest` runs ~39 checks (no device rebuild needed). |

App‑side wiring lives in `app/app.js` (announce send / receive, SQLite inserts,
DND, origin stamping) and `app/components/NavigationBar.js` (the "Export data…"
menu item).

---

## 2. Transport & security

**HTTP by default** (`USE_TLS = false` in `ExportServer.js`). On‑device TLS is
problematic: it's a self‑signed cert, and Android's HTTP client (OkHttp, used by
`fetch`) **rejects self‑signed certs**, so the *import* couldn't talk to it even
though a browser could click through the warning. Release builds also block
cleartext by default, so `android/app/src/main/res/xml/network_security_config.xml`
permits cleartext for the LAN export (referenced from the main manifest).

**Confidentiality without TLS.** The import path is encrypted end‑to‑end with a
per‑session symmetric key:

- the exporter mints a 32‑byte key (`exportCrypto.generateKey()`),
- ships it as `enc` inside the **PGP‑encrypted announcement** (encrypted to the
  user's own public key — only their devices can read it),
- the import sends `X-Sylk-Enc: 1`; the server seals each response body with
  `secretbox` (`nonce‖box`, `Content-Type: application/octet-stream`,
  `X-Sylk-Enc: 1`); the import decrypts with the announced key.

Wrong key → Poly1305 auth failure, so it's tamper‑evident, not just confidential.
The **browser** never sends the header and has no key, so it keeps getting
plaintext (intentional — the browser export is unencrypted over the LAN).

**Auth.** A random 8‑char token (shown on the modal, encoded in the QR). Accepted
as a session cookie, `Authorization: Bearer`, **or** `?token=` in the URL (used by
downloads/QR because browsers don't reliably attach the cookie to downloads).

**TLS (optional).** Flip `USE_TLS = true` + native rebuild. On Android the
keystore is referenced as `{ uri: 'server_keystore' }` so it loads from
`res/raw/server_keystore.p12` in dev **and** release (no Metro dependency).
Browser shows a one‑time warning; the app import still can't use it (OkHttp).

---

## 3. Data model (`sylk.db`)

`messages`: `account, msg_id, unix_timestamp, sender, content, content_type,
metadata(JSON), from_uri, to_uri, direction, category, local_url, origin, …`.
Categories: `text, links, location, image, audio, video, other`. File transfers
are `content_type = application/sylk-file-transfer`; bytes live on disk at
`local_url`, metadata JSON carries `{filename, filetype, filesize}`.

`contacts`: `account, contact_id, uri, name, organization, tags, email,
public_key, …`. The "other party" of a message = `from_uri==account ? to_uri :
from_uri`. Day buckets use local time (`strftime('%Y-%m-%d', …, 'localtime')`),
and `links = text AND has_link=1`, matching the app's in‑chat calendar.

---

## 4. HTTP API

Base `http://<ip>:<port>`. All `/api/*` except login require the token. Routes
the **import** uses are sealed when `X-Sylk-Enc` is set; browser routes stay
plaintext.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | The web UI. |
| POST | `/api/login` / `/api/logout` | Token → session cookie (browser). |
| GET | `/api/summary` | Counts per category, contacts, file bytes, device user‑agent. |
| GET | `/api/calendar?contact=` | Per‑category day index (optionally scoped to one contact). |
| GET | `/api/contacts-counts?kind=&category=&period=` | Contacts that have that media, **ordered by count desc** (the contact train). |
| GET | `/api/selection?kind=&category=&period=&contact=&format=` | Browseable manifest + `Download all` zip url. |
| GET | `/api/ids?kind=&category=&period=&contact=` | Unique ids in a selection (for the add‑only diff). |
| GET | `/api/blob?id=` | One file transfer's bytes. |
| GET | `/api/meta?id=` | One transfer's full SQL row (the `.metadata` sidecar). |
| GET | `/api/chat?contact=&day=&category=&format=` | One day's `chat.txt` / `chat.html`. |
| GET | `/api/messages.json` · `/api/contacts.json` | JSON dumps. |
| GET | `/api/export.zip?kind=&category=&period=&contact=&format=` | The whole selection as one streamed zip. |

`kind` ∈ `contacts|messages|files`; `period` ∈ `all|YYYY|YYYY-MM|YYYY-MM-DD`.
Messages `category` ∈ `all|text|links|location`; Files ∈
`all|image|audio|video|other`. Messages `format` ∈ `story|html|json`.

---

## 5. Export layout

Every archive expands under a shared root so multiple zips merge into one tree:

```
BlinkArchive/
├── Contacts/<account>/contacts.json
├── Messages/<account>/<contact>/<YYYY-MM-DD>/chat.txt | chat.html   (or messages.json)
└── Files/<account>/<contact>/<id>/<filename>
                              └/<id>/transfer-<id>.metadata
```

The file tree is identical to the app's on‑disk tree (derived from `local_url`).
The sidecar is the full SQL row as JSON, written even when the file isn't on disk
(`file_present:false`). Zip names carry the selection: `Blink-contacts.zip`,
`Blink-messages-2026.zip`, `Blink-images-2026-03.zip`. Streamed **STORE** (no
recompression of already‑compressed media), with a precomputed `Content-Length`.

Web UI: stat cards double as the **kind** selector; then **category**, a
**contact train** (only contacts with that media, desc), a **Year→Month→Day**
calendar (counts re‑scoped to the selected contact), and for messages a
**Story/HTML/JSON** toggle. Individual download links appear at day level; a
**Download all · .zip** is available at any level.

---

## 6. Import (receiving phone)

1. **Announce.** When the export server starts, the device sends
   `application/sylk-data-export` to its **own account**, PGP‑encrypted to its own
   public key, payload `{server,key,enc,timestamp}`.
2. **Receive.** A message to your own account arrives on other devices as an
   **`outgoingMessage` carbon** (not `incomingMessage`). `app.js` decrypts it
   there, never persists it (memory‑only; `saveOutgoingMessageSql` and
   `_syncConversations` skip the content type), and pops the Import modal only if
   **fresh (< 60 s)**.
3. **Browse + diff.** The native modal calls the API directly (no WebView) with
   our own controls. For each selection it diffs the server's `/api/ids` against
   the local DB and shows **only what will be added**.
4. **Import (add‑only).** For each new id: `/api/meta` (row) + `/api/blob` (bytes,
   files) → `INSERT OR IGNORE` into `messages`/`contacts` and the file tree.
   Contacts come from `/api/contacts.json`. Existing rows are never touched.
   - imported rows are stamped with `origin` = the exporting device's
     **SIP user‑agent**;
   - **Do‑Not‑Disturb** is enabled during export/import (restored only if we set
     it);
   - the import can be **Cancelled** mid‑run (stops between items, keeps the
     selection); the count of local rows with that origin is logged after.

---

## 7. Build / run / test

- **Web preview, no device:** `node tools/export-mock-server.js` → open the URL.
  `node tools/export-mock-server.js --selftest` runs the full suite (auth,
  calendar, selection, zip integrity via `unzip -t`, add‑only diff/copy,
  encryption round‑trip, contact filter…).
- **On device:** rebuild the app, then main menu ▸ **Export data…**. To enable
  TLS, set `USE_TLS = true` and do a native rebuild.
- The mock runs the **real** `exportRouter.js` + `exportWebUI.js` + `exportCrypto.js`
  + `importClient.js`, so what the suite verifies is what ships.
