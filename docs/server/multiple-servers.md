# Running Sylk Mobile against multiple servers

Sylk Mobile is multi-tenant: one app installation can sign into accounts on
any number of independent Sylk Suite deployments. Nothing about a server is
hardcoded in the client — everything is discovered at sign-in time from the
SIP domain of the account. This document describes what a server operator
must configure (DNS + config files) so that a domain becomes usable from the
app, and how the client behaves when several servers are in play.

Verified against sylk-suite `install.py` and the app's discovery code
(2026-07-17).

## 1. How the client finds a server

When the user signs in (or enrolls) as `user@example.com`, the app:

1. Extracts the domain (`example.com`).
2. Resolves the TXT record `_sylkserver.example.com` **over DNS-over-HTTPS**
   (primary `https://dns.google/resolve`, fallback
   `https://mdns.sipthor.net/dnslookup.php`). The TXT value must be the URL
   of the server's configuration file, e.g.
   `https://example.com/sylk-config.json`.
3. Downloads that JSON. The `wsServer` key in it is tested and then used as
   the WebSocket endpoint to the SylkServer webrtcgateway. Every other
   feature of the deployment (enrollment, conference domain, ICE servers,
   file transfer, server addressbook, test numbers, ...) is also taken from
   this file.
4. Caches the config **per domain** (`configurations[<domain>]`) and
   persists it. On every subsequent sign-in the cached copy is applied
   immediately for a fast start, and a fresh copy is downloaded in the
   background (`[config] sign-in refresh` in the log); any changed keys are
   picked up and re-persisted. Server operators can therefore change
   capabilities (e.g. enable the server addressbook) and running clients
   learn it at their next sign-in — no reinstall needed.

Because resolution happens over DoH, the TXT record must be in the **public
DNS** — split-horizon or LAN-only records will not be found.

The special default domain (`sylk.link`) uses a static bootstrap URL
(`https://download.ag-projects.com/Sylk/Mobile/config.json`) instead of DNS
discovery; every other domain goes through the TXT lookup.

## 2. DNS records for a deployment

`install.py` prints a ready-made zone (from its `dns_template`) at the end
of an install. For a domain `example.com` on public IP `IPADDR` with the
default ports, the required records are:

```
; -- who the client talks to -------------------------------------------
example.com.               3600 IN A     IPADDR
xcap.example.com.           600 IN A     IPADDR

; -- Sylk Mobile server discovery (THE essential record) ----------------
_sylkserver.example.com.    600 IN TXT   "https://example.com/sylk-config.json"

; -- XCAP discovery for classic XCAP clients ---------------------------
xcap.example.com.           600 IN TXT   "https://xcap.example.com/xcap-root"

; -- SIP routing (used by SIP clients / federation) --------------------
example.com.                600 IN NAPTR 10 100 "s" "SIPS+D2T" "" _sips._tcp.example.com.
example.com.                600 IN NAPTR 20 100 "s" "SIP+D2T"  "" _sip._tcp.example.com.
example.com.                600 IN NAPTR 30 100 "s" "SIP+D2U"  "" _sip._udp.example.com.
conference.example.com.     600 IN NAPTR 100 100 "s" "SIP+D2T" "" _sip._tcp.example.com.
_sip._tcp.example.com.      600 IN SRV   100 100 SIPTCPPORT example.com.
_sip._udp.example.com.      600 IN SRV   100 100 SIPTCPPORT example.com.
_sips._tcp.example.com.     600 IN SRV   100 100 SIPTLSPORT example.com.
_msrps._tcp.example.com.    600 IN SRV   10 0 MSRPPORT example.com.
_stun._udp.example.com.     600 IN SRV   0 10 3478 stun1.sipthor.net.
_stun._udp.example.com.     600 IN SRV   0 10 3478 stun2.sipthor.net.
```

Notes:

- If the web frontend runs on a non-443 port, the TXT URL carries it:
  `https://example.com:PORT/sylk-config.json`.
- `xcap.example.com` needs a valid TLS certificate (the installer requests
  the cert for both `example.com` and `xcap.example.com` via certbot).
- To host **multiple servers**, repeat this per domain — each deployment is
  fully described by its own `_sylkserver.<domain>` TXT record. Domains can
  live on the same or different machines; the client does not care.

Verify from anywhere:

```sh
dig +short TXT _sylkserver.example.com
curl -s https://example.com/sylk-config.json | python3 -m json.tool
```

## 3. sylk-config.json — the per-server contract

This file is what the TXT record points at. Keys the client consumes:

| key | meaning |
| --- | --- |
| `defaultDomain` / `enrollmentDomain` | SIP domain of the deployment |
| `wsServer` | `wss://` URL of the SylkServer webrtcgateway (tested at discovery) |
| `publicUrl` | base https URL of the web frontend |
| `enrollmentUrl` | account-creation endpoint used by the in-app signup |
| `defaultConferenceDomain` / `defaultGuestDomain` | conference / guest URIs |
| `fileSharingUrl` / `fileTransferUrl` | file transfer endpoints |
| `iceServers` | STUN/TURN list handed to WebRTC |
| `addressBookServer` | **opt-in** `true`/`1`: server stores the addressbook via XCAP; absent/false = contacts stay local, no `[ab]` traffic |
| `testNumbers` | contacts auto-created on first sign-in (echo / playback test) |
| `serverSettingsUrl`, `passwordRecoveryUrl`, `deleteAccountUrl`, `traceURL`, `qosServerUrl`, `pstn`, `conference` | optional feature endpoints |
| `muteGuestAudioOnJoin`, `guestUserPermissions`, `showGuestCompleteScreen`, `nonSipDomains`, `downloadUrl` | misc behavior toggles |

Where it lives on the server:

- Served by the `sylk-webrtc` nginx container at
  `https://<domain>/sylk-config.json`.
- **Generated at image build time** by `webrtc-nginx/to-json.js` from
  `webrtc-nginx/config.js` (domain/port are baked in via build args). As of
  2026-07-17 `to-json.js` sets `addressBookServer: true` by default.
- The container entrypoint wipes and repopulates the html directory from
  the image on every container start — hand edits inside the container do
  not survive a restart. The authoritative host copy is
  `/opt/sylk-suite/webrtc-nginx/html/sylk-config.json`; after editing it,
  refresh the container copy with
  `docker cp <file> sylk-webrtc:/usr/share/nginx/html/sylk-config.json`,
  or rebuild properly:
  `docker-compose --env-file logs/docker.env build webrtc && docker-compose --env-file logs/docker.env up -d --no-deps webrtc`.

## 4. Server-side config files (per deployment)

All paths relative to the install root `/opt/sylk-suite` unless absolute.
Every `docker-compose` invocation must pass
`--env-file /opt/sylk-suite/logs/docker.env` (there is no `.env` file; the
env is generated by `install.py`). Use the wrapper scripts in `scripts/`.

### sylkserver (webrtcgateway)

`sylkserver/config/webrtcgateway.ini` (bind-mounted at `/etc/sylkserver`):

```ini
[General]
; XCAP API base — NOTE: WITHOUT /xcap-root. OpenXCAP mounts the JSON
; addressbook API at /api/v1 directly under the server root; /xcap-root
; prefixes only the legacy XCAP document tree. Using the /xcap-root form
; here makes every API call fall through to the legacy parser and fail.
xcap_url = https://xcap.example.com
```

`outbound_sip_proxy` (and `outbound_proxy`/`hostname`/`public_port` in
`config.ini`) are rewritten by the container entrypoint from the env on
every start — do not hand-maintain those lines.

### OpenXCAP

`/etc/openxcap/config.ini`:

```ini
[Server]
; classic XCAP root — this one DOES keep /xcap-root, and must NOT carry
; :443 on standard-port installs (roots compare literally)
root = https://xcap.example.com/xcap-root

[Authentication]
type = basic
default_realm = example.com
; sylkserver's addressbook API calls arrive via the sylk-webrtc nginx
; proxy, so OpenXCAP sees the HOST's address as the source. Trusting it
; (plus the docker bridge) lets sylkserver skip Basic auth while external
; clients — which keep their real public IPs — are still challenged.
trusted_peers = <host LAN IP>, <docker0 IP>
```

### Regenerating configs from the installer

`install.py` (run from the source tree) generates all of the above. To
regenerate after template/installer changes:

```sh
sudo mv /opt/sylk-suite/sylkserver/config /opt/sylk-suite/sylkserver/config.bak
cd /opt/sylk-suite
sudo /path/to/source/install.py --skip-git --include sylkserver,openxcap
sudo docker restart sylkserver && sudo systemctl restart openxcap
```

(The `mv` is required: on re-runs the installer will not overwrite an
existing `config/` directory.)

## 5. Multiple servers on one device — client behavior

- The login form accepts any `user@domain`; each new domain triggers its
  own discovery and gets its own cached configuration. Switching servers
  is: sign out → sign in with an account on the other domain.
- Per-account state (contacts, messages, keys, addressbook markers) is kept
  per account id, so accounts on different servers do not mix.
- Capabilities genuinely differ per server: e.g. a domain publishing
  `addressBookServer: true` syncs contacts via that server's XCAP, while
  another domain without it keeps contacts local — on the same device.
- The config cache refreshes on every sign-in, so a capability enabled
  server-side is picked up the next time the user signs into that domain
  (watch for `[config] sign-in refresh` → `[config] added <key>` in logs).

## 6. Switching servers in the app (UI)

There are two routes, depending on whether the user is signed in.

### From the sign-in screen (signed out)

The login form (`RegisterForm`) always operates against one *current*
server, shown by the status line ("Server is ready"). To point it at a
different one, tap the **"Choose another Sylk server?"** link under the
sign-in fields. The form switches to the server view (subtitle "Choose
server"), where the user can:

- **Type a domain** and tap **Check domain**. This runs the discovery from
  §1 (TXT lookup → config fetch → WebSocket test) and reports the result in
  the status line. Once the domain checks out the button becomes
  **Use domain**, which makes it the current server and returns to the
  sign-in view.
- **Pick a known server**: if accounts were used on other servers before, a
  **"Show servers (N)"** button opens the *Choose a Sylk server* modal
  listing every domain the app has signed into. Selecting one switches to
  it directly.

When switching to a server that was used before, the account and password
fields are pre-filled with the last identity used on that server (stored
per domain in `serversAccounts`), so returning to a server is typically
select → Sign in. The **"Back to current Sylk server"** link (same link,
relabelled while in the server view) abandons the switch. The server view
also carries an **"Install your own Sylk server?"** help link for operators.

Enrollment ("Create account") always creates the account on the currently
selected server — its `enrollmentUrl` comes from that server's
`sylk-config.json` — so to sign up on server B the user switches to B
first, then enrolls.

### Multiple accounts — on the same or different servers

The app stores any number of accounts, including several on the *same*
server, with exactly **one account active at a time** (a single SIP
registration/WebSocket identity). All local storage is **partitioned per
account id**: contacts, message history, journal cursors, PGP keys,
addressbook markers and app-state each live under their own
`user@domain` scope (SQL rows keyed by account, per-account file
directories). Accounts therefore coexist on one device without touching
each other's data — signing into `alice@example.com` after
`bob@example.com` on the same server shows only Alice's contacts and
conversations, and switching back restores Bob's exactly as left.

### While signed in (account switcher)

A signed-in user can jump straight to another locally-stored account via
the **Switch account** modal (account menu → "Switch to…"), without going
through the login form. The target account may live on a different server;
the app handles the two cases itself (`switchAccount()`):

- **Same server**: the existing WebSocket is reused — the current identity
  is unregistered and the new one registers over the same connection.
- **Different server**: the connection is torn down, discovery runs for the
  target domain (`lookupSylkServer`), and the stored credentials sign in on
  the new server's WebSocket.

Either way, per-account state (contacts, messages, keys) is loaded for the
target identity; nothing from the previous account leaks across — and on
every such sign-in the target server's config is re-fetched (§1), so
capability differences between the servers take effect immediately.

## 7. Troubleshooting

| symptom | check |
| --- | --- |
| app says no server / stays on login | `dig TXT _sylkserver.<domain>` resolves publicly? config URL reachable with valid TLS? `wsServer` in the JSON correct? |
| new config key not picked up | look for `[config] sign-in refresh` and `[config] added <key>` in the client log; the JSON actually served: `curl -s https://<domain>/sylk-config.json` (container may serve a stale copy — see §3) |
| addressbook: 401 Basic authentication required | source IP missing from OpenXCAP `trusted_peers`; find it in `journalctl -u openxcap` |
| addressbook: 404 "XCAP root not found" | `xcap_url`/`root` mismatch (port suffix or wrong host) |
| addressbook: 404 "Document selector context must be 'users' or 'global'" | `xcap_url` wrongly includes `/xcap-root` — API calls are falling through to the legacy XCAP parser |
| addressbook: 500 on a fresh account | OpenXCAP older than the 2026-07-17 `load_data` empty-document fix |
| duplicate `outbound_proxy` crash at sylkserver start | the entrypoint sed found two matching lines in `config.ini`; delete the extra one |
