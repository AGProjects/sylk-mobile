# H.264 + zRTP (end-to-end encryption) — work archive

This folder parks the work done toward **end-to-end-encrypting H.264 video over
zRTP** on sylk-mobile. The conclusion: it is **not achievable through
react-native-webrtc's frame-level FrameEncryptor** with the prebuilt WebRTC
library. The picture content can't survive libwebrtc's H.264 RTP depacketizer,
which parses the slice bitstream we would need to encrypt. The reusable
foundation (per-NAL framing, key plumbing, host test) is saved here for the
future packet-level effort (Architecture B, below).

It is **not wired into the live build** as an active path — see "What ships
today" — but the native code remains present and dormant.

---

## What ships today (the pragmatic decision)

zRTP works for **VP9 and VP8** video (their RTP packetizers treat the payload as
opaque, so the fixed-prefix FrameEncryptor scheme works) and for **audio**.
H.264 cannot be E2EE'd, so:

- **Preferences** (`app/components/PreferencesModal.js`): when zRTP is enabled,
  VP9 and VP8 are both selectable; **H.264 is disabled** as a choice. VP9 is set
  as the default the first time zRTP is enabled; the user may then toggle
  VP9 ↔ VP8.
- **Account coupling** (`app/app.js` → `setAccountSetting`): the off→on zRTP
  transition defaults `rtp.preferredVideoCodec` to VP9 (once). It never forces
  the codec on later optional↔mandatory toggles; it only corrects a stored
  H.264 value.
- **1-to-1 calls** (`app/components/CallZrtp.js`): if a call still negotiates
  H.264 (e.g. the peer only offers it — H.264 stays in the SDP for interop):
  - `zrtp_optional`  → **video E2EE is skipped**; H.264 video flows over plain
    DTLS-SRTP (hop-by-hop) for maximum interop. **Audio stays E2EE.**
  - `zrtp_mandatory` → video is **refused** (`_maybeStrictDropH264Video`):
    encryption-or-nothing.
- **Conferences** (`app/app.js` → `_applyConferenceVideoCodec`): use the
  server-provided / `conferenceVideoCodec` codec (not forced to VP9), and
  **zRTP is disabled** (runtime mode forced to `sdes` for the conference's
  duration; restored on exit).

Net: maximum end-to-end privacy when both peers do VP9/VP8; maximum
interoperability (H.264, transport-encrypted only) when a peer requires H.264
and the user hasn't demanded mandatory zRTP.

---

## Why frame-level H.264 E2EE doesn't work

react-native-webrtc only exposes a **frame-level `FrameEncryptor`** that runs
*before* RTP packetization. That forces libwebrtc's codec-specific packetizer
(sender) and depacketizer (receiver) to operate on our encrypted bytes. Unlike
VP8/VP9, the **H.264** ones parse the bitstream:

1. **SPS parse (resolution).** The depacketizer parses the SPS NAL for
   width/height. We fixed this by leaving SPS/PPS/SEI/AUD in clear and
   encrypting only VCL slice NALs (types 1–5).
2. **Slice-header parse (frame assembly).** The depacketizer / frame assembler
   reads into the **slice header** (`first_mb_in_slice`, etc.) to assemble
   frames. Our scheme encrypts the slice body, which begins with that header,
   so assembly fails and **the encrypted slices are dropped before they ever
   reach our FrameDecryptor**.

Evidence (from on-device `SYLK_APP` logs, two-phone H.264 call):

```
[encH264] frame#=0 nals=3 enc=1 skip=2 firstType=7   # SPS+PPS skipped, IDR encrypted
[encH264] frame#=100 nals=1 enc=1 skip=0 firstType=1 # P-frames encrypted, every frame
[decH264] frame#=0..4  dec=0 pass=1                   # only the pre-encryption plaintext window
# ...no decH264 calls after frame#4: encrypted slices never reach the decryptor.
```

Encryptor ran to 400+ frames; decryptor was invoked ~5 times (the brief
plaintext handshake window) and never again. The slice header is variable-length
(Exp-Golomb), so there is no clean fixed-size prefix to leave in clear.

---

## What was built (the foundation, in the archived patch)

Native NAL-aware FrameEncryptor/FrameDecryptor in
`node_modules/react-native-webrtc/android/src/main/cpp/MediaEncryptorJni.cpp`
(see `MediaEncryptorJni.cpp` here). Wire format evolved through:

- **v1** — whole-frame AES-128-GCM after a fixed plaintext prefix (works for
  VP8/VP9/audio; the current shipping scheme for those).
- **v2** — per-NAL AES-128-GCM: start codes + NAL headers kept in clear, each
  NAL body encrypted, ciphertext emulation-prevention-escaped (EPB) so the
  packetizer's start-code scan still works.
- **v3** — added an explicit per-NAL **plaintext-length field**, because the
  H.264 depacketizer renormalizes every NAL to a 4-byte start code, and the
  decryptor must not fold the extra `00` into the GCM input.
- **clear-params** — leave SPS/PPS/SEI/AUD unencrypted (only encrypt VCL
  slices), to survive the SPS resolution parse.

All of the above is correct and **host-validated** (`nal_test.cpp` models the
depacketizer's 4-byte start-code renormalization and passes 60k frames). It is
the *codec packetizer*, not the crypto, that defeats it.

Also includes: a single-source-of-truth build tag (`sylk_e2ee_build.h`,
included by both `.cpp`s; the JS side compares it at startup), and rate-limited
`[encH264]`/`[decH264]` instrumentation under the `SYLK_APP` logcat tag.

---

## The path forward — Architecture B (packet-level, the right way)

Encrypt the **RTP payload after packetization** instead of the frame before it —
exactly what the desktop side already does in
`python3-sipsimple/.../pjmedia/src/pjmedia/sylk_aead_transport.c`. Then
packetization/depacketization happen on plaintext and **none of the H.264
bitstream problems exist**. This is also the **only** design that interoperates
with the python3-sipsimple peers (the stated end goal).

Requirements:

1. **Build libwebrtc from source.** The app uses the prebuilt
   `io.github.webrtc-sdk:android:137.+` AAR (M137), which has no packet-level
   hook. You must build the webrtc-sdk source (depot_tools `fetch` — ~25–30 GB,
   `tools_webrtc/android/build_aar.py`, Linux build host) at the milestone you
   standardize on.
2. **Add an AEAD pass in the SRTP/transport path** (`pc/srtp_transport.cc` /
   the `ProtectRtp` / `UnprotectRtp` path, or a transport wrapper), byte-for-byte
   matching `sylk_aead_transport.c`'s wire format:
   `[v|keyId : 1B][counter_be : 4B][ciphertext][GCM tag : 16B]`, IV = salt(8)‖counter(4).
3. **Point react-native-webrtc at the local AAR** instead of the Maven dep, and
   wire the ZRTP-derived keys into the new SRTP-AEAD setter.

Hurdle: standing up and maintaining a libwebrtc build pipeline. Payoff: robust
H.264 (and any codec) E2EE, unified mobile↔mobile↔desktop on one wire format,
no bitstream fragility.

(Alternative — Architecture A, selective frame-level encryption: parse the
Exp-Golomb slice header natively, leave it in clear, encrypt only the residual.
Stays on the prebuilt AAR but is fragile, version-coupled, and leaks slice-header
metadata. Not recommended given the pjsip interop requirement.)

---

## Files in this archive

| File | What it is |
|------|------------|
| `react-native-webrtc+124.0.7.patch` | Full patch snapshot; contains the native NAL-aware FrameEncryptor/Decryptor (`MediaEncryptorJni.cpp`), build header, JNI/Java/TS plumbing, plus the unrelated webrtc patches. |
| `MediaEncryptorJni.cpp` | Standalone copy of the native encryptor/decryptor (v1 + the H.264 NAL-aware v3/clear-params path + instrumentation). |
| `sylk_e2ee.cpp` / `sylk_e2ee_build.h` | JNI build-version probe and the single-source-of-truth build tag. |
| `nal_test.cpp` | Host test (`g++ -std=c++17`) — validates the EPB + length-prefix framing and round-trips through a model of the WebRTC depacketizer's start-code renormalization. |

## How the live build relates to this archive

The native NAL-aware code has been **removed from the live build** — the
react-native-webrtc patch is back to the clean v1 whole-frame scheme (audio +
VP8/VP9), and `CallZrtp.js` skips/drops H.264 video E2EE per the rules above.
The only carry-over kept in the live tree is the single-source build-tag header
(`sylk_e2ee_build.h`), which is codec-agnostic. Everything needed to resurrect
the H.264 attempt — the full native FrameEncryptor/Decryptor, the patch
snapshot, and the host test — lives in this folder. When Architecture B is
taken on, start from here (and from `sylk_aead_transport.c` on the
python3-sipsimple side for the wire format).
