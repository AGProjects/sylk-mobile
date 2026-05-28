# Sylk-ZRTP protocol

Copyright (C) 2019-2027 AG Projects B.V. (https://www.ag-projects.com)

End-to-end encryption layer for sylk-mobile audio and video calls. This is
**not** RFC 6189 ZRTP. It is a Sylk-specific protocol that runs an X25519
ECDH key exchange over in-dialog SIP MESSAGE bodies and installs an
AES-128-GCM `FrameEncryptor` / `FrameDecryptor` on each WebRTC RTP sender
and receiver. The result is media that SylkServer (the WebRTC Janus relay)
cannot read.

This document describes the implementation that currently ships, including
the wire format, the cryptographic construction, the state machine, the
UI surfaces, and the hardening work that brought the layer to its current
state.

---

## Layout in the codebase

| File | Role |
|---|---|
| `app/components/CallZrtp.js` | Protocol state machine, X25519 + HKDF, SAS derivation, sender/receiver install, encryption-mode policy. |
| `app/components/Call.js` | Dispatches incoming `application/sylk-zrtp-negotiation` messages; gates starting the probe. |
| `app/app.js` | Encryption-mode preference plumbing, capability header on INVITE, per-contact overrides. |
| `app/components/AudioCallBox.js` | Pill rendering, SAS verification dialog, mismatch alarm, downgrade banner (audio screen). |
| `app/components/VideoBox.js` | Same pill / dialog / mismatch alarm on the video screen. |
| `app/components/PreferencesModal.js` | Encryption-mode picker (Enabled / Strict) and video codec picker. |
| `app/components/EditContactModal.js` | Per-contact encryption-mode and codec overrides. |
| `patches/react-native-webrtc+124.0.7.patch` | Native FrameEncryptor / FrameDecryptor (Android JNI + iOS Obj-C++) including the strict-mode auto-promotion. |

---

## Protocol

### Capability advertisement

A caller that supports Sylk-ZRTP advertises support by adding a
SIP custom header to the outgoing INVITE:

```
X-Sylk-ZRTP: v=3; suites=AES-128-GCM
```

The callee, if also capable, echoes the same header on the 200 OK. Either
end can refuse to advertise (encryption mode `sdes` — see below). If the
SIP MitM (e.g. sylk-server) strips this header, both ends fall back to
plain DTLS-SRTP and the UI shows a downgrade banner (when ZRTP was in
optional mode) or the mandatory-failure modal (when in strict mode).

Header grammar is intentionally extensible:

- `v=N` — highest wire version this side speaks. Currently `3`. v1 / v2
  peers still interoperate (see *Version negotiation* below).
- `suites=CSV` — comma-separated AEAD suites the side supports.

Unknown parameters are ignored by the parser so future versions can add
fields without breaking older peers.

### Wire format

All handshake messages are sent as in-dialog SIP MESSAGE with
`Content-Type: application/sylk-zrtp-negotiation`. The body is plain JSON
(no PGP wrap):

```json
{
  "v": 3,
  "type": "probe" | "accept" | "recv_ready" | "sender_ready",
  "call_id": "<SIP Call-ID>",
  "ephem_pub_hex": "<64 hex chars = 32 bytes X25519 public key>",
  "suites": ["AES-128-GCM"],
  "rs_id_hex": "<16 hex chars = SHA-256(rs1)[0:8]>",
  "sig": "<armored detached PGP signature over canonical JSON of the other fields>"
}
```

`suites` is only present on `probe` and `accept`. `ephem_pub_hex` is
present on `probe` and `accept` (each side carries its own ephemeral
public key). `rs_id_hex` is present on `probe` and `accept` when the
sender already holds a retained per-peer secret (`rs1`) for the callee /
caller — see *Retained-secret continuity (v2)* below. `sig` is present
on every v3 payload when the sender holds a local PGP private key — see
*Signed handshake (v3)* below.

### Version negotiation

Both sides advertise their highest supported version in the `v` field.
On receive, each side pins `negotiated_version = min(peer_v, local_v)`.
A v2 peer talking to a v1 peer behaves exactly like v1 (no `rs_id_hex`
sent, no rs1 mix in HKDF). When both sides are v2 they exchange
`rs_id_hex` on `probe` / `accept` and use the continuity machinery.

### Retained-secret continuity (v2)

The v2 protocol carries a per-peer 32-byte secret `rs1` across calls so
that a MitM who completes a fresh X25519 exchange but doesn't hold the
stored `rs1` produces keys that disagree with the legitimate peer's.

**What's on the wire.** Each side computes
`rs_id = SHA-256(rs1)[0:8]` and includes it as `rs_id_hex` on `probe`
and `accept` if and only if it holds an `rs1` for the peer. `rs_id` is a
public commitment — it proves the sender holds *some* rs1 with that
hash, without revealing rs1 itself.

**Continuity decision.** Computed in `_deriveAndLog` on each side after
the X25519 ECDH:

| local rs1 | peer rs_id present | rs_id match | `continuityState` | HKDF salt | auto-rotate? |
|---|---|---|---|---|---|
| no | no | – | `first-time` | zero | no |
| no | yes | – | `one-sided-peer` | zero | no |
| yes | no | – | `one-sided-local` | zero | no |
| yes | yes | yes | `verified` | rs1 | yes |
| yes | yes | no | `mismatch` | zero | no |

In the `verified` case both sides bind their derived AEAD keys (and the
SAS) to `rs1`. A MitM who can echo the wire-visible `rs_id_hex` but
doesn't hold `rs1` will produce keys that don't match the legitimate
peer's — frames fail AEAD verification, the strict-mode decryptor
refuses passthrough after the first five legitimate frames, and the
call's audio breaks down. The attacker is forced out without ever
reaching the user's ears.

**Seeding rs1.** rs1 is only written when the user has demonstrated
trust by verbally comparing the SAS and tapping Confirm in the
verification dialog. That action calls
`session.confirmSasAndSeedRs1()`, which derives
`next_rs1 = HKDF(ss, salt=rs1_or_zero, info="sylk-zrtp/v2/next-rs1", 32)`
and persists it. Without an explicit SAS Confirm, no rs1 is stored —
which means a silent MitM on the first call cannot inject a fake rs1
that they could then use to forge continuity on subsequent calls.

**Rotating rs1.** On every continuity-verified call (i.e. one whose
`continuityState` reached `verified` AND that reached `key-active`),
both sides automatically derive a fresh `next_rs1` using the same
formula and persist it. The previous rs1 is discarded. Both sides
compute identical bytes because the inputs are identical, so they stay
in lockstep without any extra wire traffic.

**Storage.**
- sylk-mobile: `contact.localProperties.zrtp.rs1_hex` (32 bytes
  hex-encoded), written via the existing `saveSylkContact` SQL path.
  Persistence is wired by emitting `zrtpRs1Update` / `zrtpRs1Clear`
  events on the sylkrtc `Call` object — app.js listens via
  `registerZrtpRs1Handlers` and writes through to the contact row.
- python3-sipsimple: a `sylk_zrtp_secrets` table inside the same
  SQLite file libzrtpcpp opens for its RFC 6189 ZID cache
  (`engine.zrtp_cache`). One row per peer AOR, accessed via the
  module-level `SylkZrtpSecretStore`. Concurrent access is serialised
  with a single lock and `check_same_thread=False`.

**Mismatch handling.** When `continuityState == 'mismatch'` (both
sides hold an rs1 for each other but they differ — either a legitimate
reinstall or a MitM) the alarm modal opens automatically. The user
chooses:

- **End call** — terminates the call via `call.terminate()`.
- **I understand** — dismisses the modal AND calls `session.clearRs1()`
  so the stored rs1 is forgotten on this device. Subsequent calls
  re-bootstrap (no continuity until SAS is verified again).

If neither side ever stored rs1 (a `first-time` call), the pill shows
the unverified colour and the user is expected to verify the SAS
verbally on this call to seed the binding for the future.

### Signed handshake (v3)

v3 attaches a detached OpenPGP signature to every `probe` and `accept`
payload. The signature is over the canonical JSON encoding of the
payload's other fields (every field except `sig` itself). A peer who
holds the receiver's stored PGP public key verifies the signature on
receive; on failure the session transitions to `failed` and the call's
audio never reaches the codec.

This closes the SIP-MitM-swaps-ephemeral-keys attack — an attacker who
can rewrite SIP signaling between the two parties can still see and
modify the X25519 public keys on the wire, but they cannot forge a
signature under the peer's PGP private key, so any rewrite triggers a
verification failure on the legitimate peer and the call breaks.

**Canonical JSON.** Same on both sides so the bytes the libraries sign
match exactly:
- Keys sorted lexicographically at every depth.
- No whitespace between tokens (Python `separators=(',', ':')`).
- UTF-8 byte encoding.
- The `sig` field itself is excluded before signing / verifying.

**Sign / verify libraries.**
- sylk-mobile: `OpenPGP.sign(text, privateKey, '')` /
  `OpenPGP.verify(sigArmored, text, publicKey)` from
  `react-native-fast-openpgp`.
- python3-sipsimple: `pgpy.PGPKey.sign()` / `verify()` from `pgpy`
  (already a declared requirement). Both libraries produce / consume
  RFC 4880 detached signatures so the formats interop.

**Key plumbing.**
- sylk-mobile: `myKeys.private` (local) and `contact.publicKey` (peer)
  are already cached by `app.js` for chat encryption; the
  `ZrtpSession` constructor reads them straight off the props. Zero
  extra key management.
- python3-sipsimple: the `SylkZRTPSession` exposes
  `set_signing_keys(local_priv_blob, peer_pub_blob)` which the
  consuming application calls after the session is created.
  sip-session3 exposes the `/zrtp_pgp_keys <local_priv.asc>
  <peer_pub.asc>` command for manual wiring during testing.

**Receive-side policy** (in `_verify_or_reject` / `_verifyOrReject`):

| negotiated v | peer key held | sig present | outcome |
|---|---|---|---|
| < 3 | – | – | accept (peer agreed to no-sig protocol) |
| ≥ 3 | no | no | accept + warning (can't verify; rollout phase) |
| ≥ 3 | no | yes | accept + warning |
| ≥ 3 | yes | no | accept + warning (downgrade-strip suspected) |
| ≥ 3 | yes | yes, verifies | accept |
| ≥ 3 | yes | yes, fails | **reject + state `failed`** |

The current policy is intentionally tolerant of missing-key /
missing-sig cases so calls don't break during deployment — but any
actual verification failure is fatal. A future tightening could
hard-reject on missing-sig once both ends are known to be v3.

**Interaction with rs1 continuity.** The signed handshake and rs1
continuity layers are independent. A v3 + rs1-verified call gets both
protections at once. A v3-only / no-rs1 call gets identity binding for
each handshake. A v2-only / no-sig call gets rs1 continuity but the
first call between two peers is unprotected at the identity layer.
Mixing is fine.

### State machine

Per Call object. Caller and callee each own a `ZrtpSession`.

```
                                  caller side                callee side
                                  -----------                -----------
startProbe()                      idle -> probing
  -> SEND probe
                                                              RECV probe
                                                              idle -> probing
                                                              derive keys,
                                                              install RX
                                                              -> SEND accept
RECV accept
  derive keys, install RX
  -> SEND recv_ready
                                                              RECV recv_ready
                                                              install TX
                                                              -> SEND sender_ready
                                                              probing -> key-agreed
RECV sender_ready
  install TX
  probing -> key-agreed

both sides:
  poller observes AEAD-success counter rise -> key-active
  poller sees N seconds of silence          -> back to key-agreed
  any unrecoverable error                   -> failed
```

`key-agreed` means the DH is done and both sides hold matching AES-128-GCM
keys, but the media may not yet be confirmed encrypted.

`key-active` is the pill-on state: the receiver-side AEAD verifier has
authenticated frames from the peer.

`failed` is terminal. The session is not retried for the call.

### Replay / out-of-order protection

The state-machine guards in `_handleProbe` / `_handleAccept` /
`_handleRecvReady` / `_handleSenderReady` enforce:

- Only `callee` accepts `probe`; only `caller` accepts `accept`.
- `probe` is acted on only in state `idle`. Duplicate or late probes are
  dropped without re-deriving keys.
- `accept` is acted on only in state `probing` and only if
  `peerEphemPub` has not already been recorded.
- `recv_ready` and `sender_ready` are dropped after the session reaches
  `key-active` or `failed`, and dropped if derived keys are missing.

### `call_id` filter

Every incoming payload is rejected unless its `call_id` field is present
AND equal to the local SIP Call-ID. Missing-or-empty `call_id` is treated
as a reject (closes the cross-account-message-forking attack where a
peer omits the field to land on whichever call the device currently has
open).

### Length-checked X25519 keys

`ephem_pub_hex` is rejected unless it is exactly 64 hex characters
(32 bytes); the decoded byte length is also rechecked before
`nacl.scalarMult`. A malformed key hard-fails the session to `failed`
instead of letting an exception drop the session into a stuck state.

### Suite negotiation

When a `probe` or `accept` carries a non-empty `suites` array, the
receiver intersects it with `LOCAL_SUITES = ['AES-128-GCM']`. No
intersection ⇒ `failed`. Today this is a trivial single-suite check;
the structure exists so we can add suites (e.g. AES-256-GCM) without a
wire-format change.

---

## Cryptography

### Key agreement

X25519 (`tweetnacl.box.keyPair()` for generation,
`tweetnacl.scalarMult` for ECDH). Public keys are sent in the wire JSON.
The shared secret is the 32-byte ECDH output.

### Key schedule

HKDF-SHA256 (`extract-and-expand`, single-block expand). Info strings are
static UTF-8 labels. The salt depends on the v2 continuity decision:

- `continuityState == 'verified'`  → `salt = rs1` (32 bytes from store)
- anything else                    → `salt = 0x00 × 32`

```
audio caller -> callee AEAD key   = HKDF(ss, salt, "sylk-e2ee/v1/audio-caller-to-callee",      16)
audio callee -> caller AEAD key   = HKDF(ss, salt, "sylk-e2ee/v1/audio-callee-to-caller",      16)
audio caller -> callee AEAD salt  = HKDF(ss, salt, "sylk-e2ee/v1/audio-caller-to-callee-salt",  8)
audio callee -> caller AEAD salt  = HKDF(ss, salt, "sylk-e2ee/v1/audio-callee-to-caller-salt",  8)
SAS                                = HKDF(ss, salt, "sylk-zrtp/v1/sas",                          8)
next_rs1 (post-call)              = HKDF(ss, salt, "sylk-zrtp/v2/next-rs1",                     32)
```

Binding the salt to rs1 carries forward into the SAS too — a v2 peer
that does have rs1 with us will compute the same SAS only if it actually
holds the same rs1. This closes the SAS-grinding window from v1 (where
the SAS depended only on the per-call X25519 output).

For video, the same audio key/salt pair is reused — the AEAD construction
adds a per-frame counter so the key reuse across audio and video is safe
under GCM's strong-IV regime.

### Frame format on the wire

```
[ unencrypted prefix ][ header ][ counter ][ ciphertext ][ tag ]
       0..3 bytes        1 byte    4 bytes
```

- **unencrypted prefix**: bytes the RTP codec packetizer must read in
  plaintext to depacketize. Audio (Opus): 0 bytes. Video: VP8 / VP9: 3;
  H264: 2; AV1: 1.
- **header**: high nibble = version (`1`), low nibble = keyId (currently
  `1`).
- **counter**: 32-bit big-endian per-direction frame counter. Combined
  with the per-direction 8-byte salt to build the 12-byte AES-GCM IV.
- **ciphertext + tag**: AES-128-GCM over the post-prefix bytes of the
  encoded frame. AAD = `header || counter`.

### Short Authentication String (SAS)

8 bytes of HKDF output, split into:

- 4 chars from RFC 4648 base32 alphabet `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`
- 4 emojis from a fixed 32-emoji table (so the user has a visual
  fingerprint as well as alphanumeric)

The 5-bit-per-symbol use of the bytes means ~40 effective bits of SAS
entropy. Both endpoints derive identical SAS from the shared secret and
the user is asked to compare verbally during the first call with a peer.

### JS-side crypto library

CryptoJS provides HMAC-SHA256 for HKDF; tweetnacl provides X25519. Both
are pure JS. The codebase has a `TODO(hardening #21)` noting the planned
swap to `@noble/hashes` (constant-time, audited) once it's added as a
dependency — neither library is currently in `package.json`.

---

## Native FrameEncryptor / FrameDecryptor

Implemented in `patches/react-native-webrtc+124.0.7.patch`, both for
Android (JNI: `MediaEncryptorJni.cpp`, Java holder `SylkE2EE.java`) and
iOS (Obj-C++: `SylkZRTPBridge.mm`).

`setMediaEncryption(key, salt, keyId, prefix)` on `RTCRtpSender` installs
a per-sender `FrameEncryptor`. `setMediaDecryption(key, salt, keyId,
prefix)` on `RTCRtpReceiver` installs the matching `FrameDecryptor`.
Both take the same arguments on each side so audio and video can have
different prefixes.

### Permissive decryption with strict-mode auto-promotion

The decryptor accepts a small bootstrap window of plaintext frames so
the receiver can render frames that arrive before the peer has finished
its sender-side install (a brief race during handshake). The bootstrap
mode is unsafe past that point because it lets a man-in-the-middle who
strips encryption forward plain RTP that the decryptor would pass to
the codec while the pill stayed on.

Both `MediaDecryptor` (Android) and `MediaFrameDecryptor` (iOS) close
that window automatically: after `kStrictAfterOk = 5` successful
AES-GCM verifications, an atomic `strict_` flag is set, and from that
point the passthrough branch returns
`webrtc::FrameDecryptorInterface::Status::kFailedToDecrypt` instead of
copying bytes through. The codec gets nothing for any frame that fails
AEAD verification — no plaintext is rendered after we've seen even one
authentic AEAD frame from the peer.

The native logs include a one-line "STRICT after N successful AEAD
frames" entry per receiver instance when the promotion fires, plus a
destructor-time summary of `aeadOk / aeadFail / passthrough` counters
on Android.

---

## UI behaviour

### Encryption-mode picker

`Preferences -> Encryption` exposes two options:

- **Enabled** (`zrtp_optional`, the default) — try to negotiate ZRTP;
  fall back to DTLS-SRTP if the peer doesn't support it.
- **Strict** (`zrtp_mandatory`) — try to negotiate ZRTP; on failure,
  surface a modal prompting **End call** / **Continue**.

The legacy `sdes` value is still accepted at runtime for old saved
settings but is no longer offered in the picker.

### Per-contact override

`EditContactModal` lets a user pin a different mode per contact (e.g.
device default is Enabled, but Strict for one specific peer). The
override is applied on both outgoing and incoming calls via
`app.js:_applyContactEncryptionMode` and reset on call termination by
`_restoreEncryptionMode`.

### Pill label

The "🔒 zRTP …" pill on the audio/video call screen reflects what is
actually encrypted, not just that the handshake completed:

| Encrypted media kinds | Unverified label | Verified label |
|---|---|---|
| audio only | `🔒 zRTP audio` | `🔒 zRTP verified · audio` |
| video only | `🔒 zRTP video` | `🔒 zRTP verified · video` |
| audio + video | `🔒 zRTP audio and video` | `🔒 zRTP verified · audio and video` |
| neither (yet) | (no pill) | (no pill) |

The set of encrypted kinds is computed as the intersection of the
session's `_installedSenderKinds` and `_installedReceiverKinds` — both
directions must have a successful AEAD install for a kind to count. An
H264 video call therefore lights up as `audio` only (video skips the
FrameEncryptor because the H264 STAP-A multi-NAL packetizer is
incompatible with the fixed-prefix scheme); a VP8/VP9/AV1 video call
lights up as `audio and video`.

### SAS verification

Tapping the pill opens a dialog showing the SAS (4 letters + 4 emojis).
Confirming stores `(peer PGP key, SAS, timestamp, rs1)` in
`contact.localProperties.zrtp` keyed to the peer. On subsequent calls
the pill resolves to one of three states using the v2 retained-secret
continuity as the primary anchor:

- `verified` — v2: `session.continuityState === 'verified'` (both sides
  proved they hold the same rs1). v1 fallback: stored PGP key matches
  current key. Pill is green.
- `unverified` — v2: no rs1 stored yet (first-time, one-sided-local, or
  one-sided-peer). v1 fallback: no record yet. Pill is orange.
- `mismatch` — v2: `session.continuityState === 'mismatch'` (both
  sides hold rs1 but they differ). v1 fallback: stored PGP key differs
  from current key. Pill turns red and an unmissable modal opens
  automatically when the session reaches `key-active`. The modal offers
  **End call** / **I understand**; the latter calls
  `session.clearRs1()` so subsequent calls re-bootstrap.

The legacy PGP-key compare is kept as a fallback for v1 peers and for
sessions where rs1 hasn't been seeded yet. It uses a constant-time
helper (`constantTimeStringEqual` exported from `CallZrtp.js`) to dodge
a timing oracle on the stored fingerprint.

### Downgrade banner

When `zrtp_optional` is selected (the default) and the handshake fails
to reach `key-agreed` within `ZRTP_MANDATORY_TIMEOUT_MS` (6 seconds),
an orange dismissible banner appears on the call screen reading
"⚠ End-to-end encryption was attempted but did not activate." The
banner is informational only — the call continues over DTLS-SRTP.

In `zrtp_mandatory` mode the same condition opens the
`zrtpMandatoryFailed` modal instead, which terminates the call by
default and surfaces a Continue button for users who want to
ride it out without E2E.

---

## Hardening checklist

The following hardening items are in the current tree. Items marked
*deferred* are blocked on coordinated changes in `python3-sipsimple`
and will land in a later phase.

### Implemented (Phase 0 + 1 + selected Phase 3)

- `call_id` is required on every incoming payload; missing/empty is
  rejected.
- `ephem_pub_hex` must be exactly 64 hex chars (32 bytes); decoded
  length is rechecked. Bad input ⇒ `failed`.
- State-machine guards on `_handleProbe` / `_handleAccept` /
  `_handleRecvReady` / `_handleSenderReady` — only the right role in
  the right state acts, duplicates and out-of-order messages drop.
- Peer-advertised `suites[]` is intersected with `LOCAL_SUITES`; no
  overlap ⇒ `failed`.
- `_installSenders` no longer sets `_sendersInstalled = true`
  vacuously when there are no tracks to install on.
- `_installReceivers` counts successes and transitions to `failed`
  when every receiver install rejected (was previously flipped to true
  unconditionally).
- All shared-secret hex, HKDF-derived keys/salts, and 8-char key
  prefixes are gated on the React Native `__DEV__` global. Release
  builds get `<redacted>` placeholders.
- Per-session log rate-limit: 30 lines / second / session, with a
  single "[rate-limit] suppressed N lines" summary on the next window.
- `_log` floods from a hostile peer no longer fill the in-app log.
- `ZRTP_INSTALL_DISABLED` constant removed (was a dev-mode bypass).
- ZRTP message transport restricted to `call` (the in-dialog SIP
  MESSAGE transport). The legacy `account` transport (cross-device
  forking via account-message) was disabled to stop unrelated devices
  seeing the peer URI / call_id / ephemeral public key on every
  handshake.
- Constant-time string compare used for PGP-key fingerprint
  comparison in the verified/mismatch decision.
- SAS-mismatch on `key-active` opens an unmissable modal automatically
  (previously the warning was only visible inside the SAS dialog).
- Downgrade banner in optional mode when the handshake doesn't reach
  `key-agreed`.
- Per-kind encryption tracking and pill label reflect what is actually
  encrypted (audio / video / both).
- Native decryptor auto-promotes to strict mode after 5 successful
  AEAD frames — refuses plaintext passthrough thereafter. Same
  behaviour on Android (`MediaDecryptor`) and iOS
  (`MediaFrameDecryptor`).
- Native decryptor counters (`aeadOk`, `aeadFail`, `passthrough`)
  exposed at instance destruction time for forensic visibility.
- Retained-shared-secret continuity (RFC 6189-style `rs1`). Wire format
  bumped to v2; per-peer secret stored in
  `contact.localProperties.zrtp.rs1_hex` (mobile) and in a
  `sylk_zrtp_secrets` table inside `engine.zrtp_cache` (python3-
  sipsimple). HKDF salt is `rs1` on continuity-verified calls so a
  MitM who doesn't hold the stored secret cannot produce matching AEAD
  keys. rs1 is seeded by explicit user SAS Confirm and rotated
  automatically on every continuity-verified `key-active` transition.
  Mismatch alarm clears the stored rs1 on user acknowledgement so the
  next call re-bootstraps.
- Detached PGP signatures on `probe` / `accept` payloads (v3). Signs
  canonical-JSON encoding of every other field with the local PGP
  private key; verifies on receive with the peer's PGP public key.
  Mobile reads keys straight from existing `myKeys` and
  `contact.publicKey` props; SDK applications call
  `session._sylk_zrtp.set_signing_keys(local_priv, peer_pub)`
  (sip-session3 exposes `/zrtp_pgp_keys` for manual wiring during
  testing). Verification failure transitions the session to `failed`.
- Strict-mode H264 video drop. When `encryptionMode === 'zrtp_mandatory'`
  and the negotiated video codec is H264 (incompatible with the
  fixed-prefix encryptor), the session stops local/remote video tracks
  and emits `zrtpStrictH264VideoDrop`. VideoBox suppresses the
  camera-enable prompt and renders the call audio-only. Audio still
  gets full E2E.

### Deferred (need `python3-sipsimple` co-changes)

- **Transcript binding into HKDF.** Mix protocol version, agreed
  suite, `call_id`, and both ephemeral public keys (lexically ordered)
  into the HKDF `info` strings so a parameter substitution invalidates
  the derived keys.
- **AES-256-GCM.** Wire format already negotiates suites; native side
  needs to accept a 32-byte key path.
- **Commit step + wider SAS.** Real ZRTP-style commit hash before
  either side reveals its ephemeral public key, plus widening SAS to
  ≥64 effective bits to defeat SAS grinding.

### Known limitations

- H264 video: ZRTP is skipped on the video track when H264 is
  negotiated, because the H264 STAP-A multi-NAL packetizer is
  incompatible with the fixed-prefix encryption scheme. The pill
  label correctly shows `audio` only in that case. A NAL-aware
  encryptor that would lift this is in the longer-term plan.
- The SAS effective entropy (~40 bits) is grindable by an active
  attacker who can perform key generation in a loop; the commit-step
  deferred item closes this.
- The X-Sylk-ZRTP SIP capability header is not integrity-protected on
  the signaling layer. A SIP MitM that strips it causes both ends to
  fall back to plain DTLS-SRTP. In `zrtp_optional` mode the UI shows
  the downgrade banner; in `zrtp_mandatory` mode the call ends or the
  user explicitly chooses to continue.

---

## Events emitted on the Call object

These are EventEmitter events fired by `CallZrtp.js` on the sylkrtc
`Call` instance; the UI components subscribe in `componentDidMount` and
unsubscribe in `componentWillUnmount` (and on the `nextProps.call`
swap).

| Event | Payload | When |
|---|---|---|
| `zrtpStateChanged` | new state string (`'idle'`, `'probing'`, `'key-agreed'`, `'key-active'`, `'failed'`) | Every state transition on the session. |
| `zrtpMandatoryFailed` | `{reason, detail}` | `zrtp_mandatory` mode and handshake didn't reach `key-agreed` in `ZRTP_MANDATORY_TIMEOUT_MS`, or an immediate-fail condition (no peer PGP key, etc.). |
| `zrtpDowngradeWarning` | `{reason, detail, state}` | `zrtp_optional` mode and handshake didn't reach `key-agreed` in the same window. |

---

## Quick reference

### Encryption-mode constants

`CallZrtp.js`:

```js
const ENCRYPTION_MODES = ['sdes', 'zrtp_optional', 'zrtp_mandatory'];
const ENCRYPTION_MODE_DEFAULT = 'zrtp_optional';
const ZRTP_MANDATORY_TIMEOUT_MS = 6000;
```

### Session states

`idle → probing → key-agreed → key-active`
with `failed` reachable from any state.

### Encrypted-kinds getter

```js
session.encryptedKinds   // -> ['audio'] | ['video'] | ['audio', 'video'] | []
```

### Pill label helper

```js
formatEncryptedKindsLabel(['audio', 'video'])  // -> 'audio and video'
```
