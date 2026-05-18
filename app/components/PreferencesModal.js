// PreferencesModal — per-account, per-app settings.
//
// NOT synced to the SylkServer. Persisted in the SQL `accounts` table
// under the `settings` column as a single JSON blob, keyed by account.
// Backed by app.js: state.accountSetting + setAccountSetting(). When
// the user switches accounts, the modal re-hydrates from the new
// account's row.
//
// This is where per-account knobs live that depend on this phone's
// hardware or the user's per-device opinion: codec choice, jitter
// buffer size, debug toggles, etc. As the modal grows, add new
// <View>-wrapped sections to render() rather than packing everything
// into one screen.
//
// Two phones logged into the same SIP account legitimately want
// different settings here, which is fine — each device keeps its own
// SQL row, so the choices don't collide.
//
// Sections:
//   1. Video Calls — preferred video codec (with zRTP compatibility tag)
//   2. Audio Calls — preferred audio codec (opus / G722 / PCMU / PCMA),
//                    DTMF transmission mode, auto-record toggle, and the
//                    proximity-sensor toggle (display-mute + speakerphone-
//                    on-gesture; relevant only for audio calls)
//   3. Chat        — chat sounds toggle (notification/typing/sent
//                    sound for chat events). Moved here from
//                    EditContactModal's "My Account" view — per-device
//                    preference, not a call/privacy rule.
//   4. Encryption  — zRTP optional / mandatory; applies to BOTH audio
//                    and video calls (SDES is always available)
//   5. Location
//
// Future sections to consider: Audio quality (echo cancellation, AEC
// mode, jitter buffer), Network (TURN over TCP, prefer IPv6), Debug
// (verbose stats overlay, force codec for testing).

import React, { useState, useEffect } from 'react';
import { Modal, View, ScrollView, Pressable, Dimensions, Platform, StyleSheet } from 'react-native';
import { Text, Button, Surface, Divider } from 'react-native-paper';
import PropTypes from 'prop-types';

import containerStyles from '../assets/styles/ContainerStyles';
import ThreeStopSlider from './ThreeStopSlider';
import PrivacyRadiusSlider from './PrivacyRadiusSlider';
import CallRecordingDisclosureModal from './CallRecordingDisclosureModal';
import {
    readAcknowledged as readCallRecordingDisclosure,
    setAcknowledged  as setCallRecordingDisclosure,
    clearAcknowledged as clearCallRecordingDisclosure,
} from '../callRecordingDisclosure';
import LocationPrivacyDisclosureModal from './LocationPrivacyDisclosureModal';
import {
    readAcknowledged as readLocationDisclosure,
    setAcknowledged  as setLocationDisclosure,
    clearAcknowledged as clearLocationDisclosure,
} from '../locationDisclosure';

// Three-stop choices for the Location preferences. Values are kept in
// the units the persistent setting expects directly (seconds for the
// tick interval, metres for the proximity threshold) so
// PreferencesModal can hand them straight through `setAccountSetting`
// without any conversion. The NavigationBar consumer multiplies the
// seconds value by 1000 before handing it to setInterval. Defaults:
// 60 s tick cadence, 20 m meet-up proximity.
const LOCATION_TICK_INTERVAL_STOPS = [
    {value:  30,  label: '30 sec'},   // faster — more battery, sharper trail
    {value:  60,  label: '1 min'},    // standard / default
    {value: 120,  label: '2 min'},    // gentler on battery, coarser trail
];
const LOCATION_TICK_INTERVAL_DEFAULT = 60;

const LOCATION_PROXIMITY_STOPS = [
    {value: 10, label: '10 m'},   // tight — "same room"; sensitive to GPS jitter
    {value: 20, label: '20 m'},   // standard / default; "same building"
    {value: 50, label: '50 m'},   // relaxed — "same block"; tolerant of poor GPS
];
const LOCATION_PROXIMITY_DEFAULT = 20;

// Font sizes used throughout the Preferences panel.
//
// Bumped from the original literals (11 / 12 / 14) because the modal
// read as too small on every form factor — those values were tuned for
// a cramped small-phone layout and looked undersized on modern large
// phones and tablets alike. The three sizes preserve the original
// visual hierarchy (caption < body < label); only their absolute
// values grew.
//
// If you tweak these, also revisit pillContentStyle.height below —
// the chip-button height has to grow with the label or the text
// clips. Current ratio: height ≈ FS_BODY × 2.3 (rounded).
const FS_CAPTION = 13;  // hint / subtext under section headers
const FS_BODY    = 14;  // pill labels, inline links, body copy
const FS_LABEL   = 16;  // section headers (Audio Calls, Video Calls, …)

const VIDEO_CODECS = ['VP9', 'VP8', 'H264'];
const VIDEO_CODECS_DEFAULT = 'VP9';

// Video quality profiles — same ids and labels as VIDEO_PROFILES in
// app.js (single source of truth for the resolution / framerate /
// bitrate numbers; this modal only renders the picker). Hint strings
// are intentionally short so they fit under the pill row without
// wrapping on a 360 dp phone.
const VIDEO_PROFILE_OPTIONS = [
    { id: '480p',  label: '480p',  hint: '640×480 · 24 fps · 800 kbps · Standard' },
    { id: '720p',  label: '720p',  hint: '1280×720 · 30 fps · 1.5 Mbps · Balanced' },
    { id: '1080p', label: '1080p', hint: '1920×1080 · 30 fps · 3 Mbps · High' },
];
const VIDEO_PROFILE_DEFAULT = '480p';

// Audio codec choices. The order matters for the UI — opus first because
// it's the recommended default and what libwebrtc would pick on its own.
// G722 is wideband (16 kHz) and useful for SIP peers without opus. PCMU
// (μ-law) and PCMA (A-law) are narrowband G.711 — handy when the call
// terminates on Asterisk + PSTN and the user wants to skip the trunk-
// side transcoder. Anything else libwebrtc lists in the audio m-line
// (telephone-event, CN, red) is not user-selectable: telephone-event is
// for DTMF, CN is comfort noise, and red is RFC 2198 redundant audio
// for opus FEC. Promoting any of those would just confuse libwebrtc's
// negotiator.
const AUDIO_CODECS = ['opus', 'G722', 'PCMU', 'PCMA'];
const AUDIO_CODECS_DEFAULT = 'opus';

// User-facing labels for the audio codec pills. The underlying VALUES
// (the entries in AUDIO_CODECS, used by sylkrtc's negotiator and
// persisted via setPreferredAudioCodec) are still the SDP/RTP names
// — PCMU / PCMA / G722 / opus — so the wire payload, the persisted
// preference, and any external tooling that reads the codec id stay
// unchanged. Only the button captions differ:
//   PCMU (μ-law)  → "G711 μ"    PCMA (A-law)  → "G711 A"
// because most users know the family as G.711 rather than the
// PCMU / PCMA SDP codec names. opus and G722 are already the
// recognised consumer names so we render them as-is.
const AUDIO_CODEC_LABELS = {
    opus: 'opus',
    G722: 'G722',
    PCMU: 'G711 μ',
    PCMA: 'G711 A',
};

// Per-codec metadata shown as a small subtitle under the row of buttons,
// so the user has some idea of what they're picking without needing to
// know the underlying telephony details.
const AUDIO_CODEC_HINTS = {
    opus: '48 kHz, FEC. Recommended.',
    G722: '16 kHz wideband. SIP fallback.',
    PCMU: '8 kHz μ-law. PSTN / Asterisk.',
    PCMA: '8 kHz A-law. PSTN / Asterisk (EU).',
};

// Per-codec metadata. `zrtp` is whether ZRTP key-agreement + AES-128-GCM
// frame encryption work on this codec with the current FrameEncryptor.
//   VP9, VP8 — descriptor metadata is in the RTP descriptor extensions
//              (outside the encrypted payload), so a fixed N-byte
//              unencrypted prefix is sufficient. ZRTP works.
//   H264    — multi-NAL STAP-A packets pack several NAL headers into
//              one RTP payload; our fixed-prefix scheme can't preserve
//              all of them. ZRTP is silently skipped (CallZrtp.js).
//              A NAL-aware FrameEncryptor would lift this; planned.
const CODEC_META = {
    VP9:  { zrtp: true,  hint: 'recommended' },
    VP8:  { zrtp: true,  hint: 'fallback' },
    H264: { zrtp: false, hint: 'no zRTP' },
};

// UI-level zRTP toggle. Surfaced as a two-pill Enabled / Disabled
// picker, defaulting to Enabled. Under the hood it still writes to
// the same accountSetting.rtp.encryptionMode string (consumed by
// CallZrtp.setEncryptionMode) — only the user-facing surface
// changed:
//
//   Enabled  → 'zrtp_optional'
//              CallZrtp runs the X25519 handshake on the in-dialog
//              MESSAGE transport, advertises the X-Sylk-ZRTP
//              capability header on the INVITE / 200 OK, and
//              installs the AES-128-GCM FrameEncryptor when both
//              ends agree. Falls back to plain DTLS-SRTP if the
//              handshake doesn't complete (e.g. peer doesn't speak
//              the scheme) — the call still happens, just without
//              the end-to-end layer.
//
//   Disabled → 'sdes'
//              No handshake, no advertised header, no end-to-end
//              encryption. shouldAdvertiseZrtpCapability() in
//              CallZrtp.js gates the SIP X-Sylk-ZRTP header on the
//              mode being one of the two zRTP modes, and
//              startZrtpForCall / dispatchIncomingZrtp early-return
//              when the mode is 'sdes' — so both the offer and the
//              negotiation are fully suppressed. The call's media
//              is still encrypted between the device and the
//              SylkServer relay via the DTLS-SRTP that WebRTC
//              negotiates by default at the transport layer; there's
//              just no end-to-end layer on top.
//
// The legacy 'zrtp_mandatory' mode is no longer offered through the
// UI; saved values from older builds map to "Enabled" in the picker
// (see currentMode resolution below). Internally the mode constant
// still exists in CallZrtp.js and the mandatory-fail prompt remains
// wired, so anyone with an old setting keeps the behaviour they had
// until they touch the toggle.
const ENCRYPTION_OPTIONS = [
    {
        value: 'zrtp_optional',
        label: 'Enabled',
        title: 'zRTP — enabled',
        subtitle: 'End-to-end encryption; '
                + 'falls back to DTLS if negotiation fails',
    },
    {
        value: 'sdes',
        label: 'Disabled',
        title: 'zRTP — disabled',
        subtitle: 'No end-to-end encryption is negotiated. '
                + 'Calls are still encrypted between the device '
                + 'and the relay via DTLS-SRTP.',
    },
];

// DTMF transmission mode for in-call digit presses. Two choices:
//   info    — SIP INFO with `application/dtmf-relay` body. Default.
//             Bypasses RTP entirely; sylkserver forwards a
//             session-dtmf-info request to Janus's SIP plugin
//             dtmf_info command, which emits an in-dialog SIP INFO
//             toward the peer. Best for Asterisk + PSTN trunks and
//             survives libwebrtc 124's broken RFC 4733 packetiser.
//   rfc4733 — out-of-band telephone-event RTP packets (the W3C
//             RTCDTMFSender path; libwebrtc-encoded). Kept as a
//             fallback for SIP-aware peers (e.g. SIP-Simple SDK)
//             that decode telephone-event correctly. On libwebrtc
//             124 these can interop badly with downstream
//             detectors (Asterisk, PSTN), which is why SIP INFO is
//             the default.
//
// (Inband — audio-tone mixing into the PCMU stream — was a
// proposed third option but requires libwebrtc M132+ to wire up
// the AudioRecordDataCallback. Removed from the UI now that SIP
// INFO covers the same use case more cleanly.)
// `label` is the short, button-suitable name for the compact picker.
// `title` / `subtitle` are kept for any caller that wants the long
// descriptive form (none currently — the modal renders `label`).
const DTMF_OPTIONS = [
    {
        value: 'info',
        label: 'SIP INFO',
        title: 'SIP INFO',
        subtitle: 'Signalling-only. '
                + 'Best for Asterisk + PSTN. '
                + 'Recommended.',
        enabled: true,
    },
    {
        value: 'rfc4733',
        label: 'RFC 4733',
        title: 'RFC 4733 (out-of-band)',
        subtitle: 'Telephone-event RTP packets. '
                + 'Works for SIP-aware peers; '
                + 'less reliable for PSTN.',
        enabled: true,
    },
];
const DTMF_DEFAULT = 'info';

const PreferencesModal = ({
    show,
    close,
    // SIP account id — used to scope the call-recording disclosure
    // acknowledgement so a second identity on the same physical
    // device must accept the disclaimer for itself rather than
    // silently inheriting the first user's choice.
    accountId,
    preferredVideoCodec,
    setPreferredVideoCodec,
    // Active video quality profile id ('480p' / '720p' / '1080p').
    // Resolved in app.js → VIDEO_PROFILES[id] for the concrete
    // resolution / framerate / bitrate; this modal just renders the
    // picker. Persisted via setAccountSetting('device.videoProfile').
    // Changing it re-applies live (the app's _applyVideoProfileId
    // walks the active call and re-runs reapplyVideoEncoderParams)
    // so the bump takes effect mid-call.
    videoProfile,
    setVideoProfile,
    // Per-device preferred audio codec. opus by default — only worth
    // changing when calls terminate on a PSTN trunk via Asterisk where
    // forcing PCMU/PCMA avoids a trunk-side transcode.
    preferredAudioCodec,
    setPreferredAudioCodec,
    encryptionMode,
    setEncryptionMode,
    // DTMF transmission mode — see DTMF_OPTIONS above. Defaults to
    // RFC 4733 (out-of-band) which is the W3C-spec'd path. Switch to
    // 'inband' for Asterisk / PSTN destinations where libwebrtc 124's
    // RFC 4733 packet emission interops badly with downstream
    // detectors.
    dtmfMode,
    setDtmfMode,
    // Whether the in-call record control is shown on audio calls.
    // OFF by default — flipping it ON surfaces the record button in
    // AudioCallBox on subsequent calls. Per-device, persisted through
    // setAccountSetting like the codec choices above.
    enableAudioRecording,
    setEnableAudioRecording,
    // Chat sounds toggle (ON by default). Moved here from the
    // "My Account..." (EditContactModal) view — it's a per-device
    // speaker preference, not a call-acceptance/privacy rule, so it
    // belongs alongside the other Preferences toggles. Persisted
    // via setAccountSetting('device.chatSounds', !current) on the
    // app side; from this modal's POV it's just a bool toggle.
    chatSounds,
    toggleChatSounds,
    // Proximity sensor — moved here from the main menu since it's a
    // per-device behaviour preference (whether to mute the screen
    // when the user holds the phone to their ear during a call), not
    // a frequent-use action that warrants a top-level menu slot.
    proximity,
    toggleProximity,
    // Location settings. Both have meaningful defaults if the props
    // aren't passed (callers may roll out the new section gradually).
    //   locationTickIntervalSec — heartbeat cadence for live shares,
    //     in SECONDS (NavigationBar multiplies ×1000 before passing
    //     to setInterval). Larger = better battery / less server
    //     traffic, smaller = finer trail granularity.
    //   locationProximityMeters — meet-up auto-end threshold. Two
    //     participants within this radius for the dwell window get a
    //     "you've met" notification and the share auto-ends. Smaller =
    //     tighter "same room" semantics, larger = tolerates GPS
    //     jitter for indoor / urban-canyon scenarios.
    locationTickIntervalSec,
    setLocationTickIntervalSec,
    locationProximityMeters,
    setLocationProximityMeters,
    // Last-used privacy radius for meeting-handshake shares. Seeded
    // into ShareLocationModal / MeetingRequestModal as the default
    // when the user opens the slider. Updated implicitly on every
    // Confirm/Accept (the modals call setLocationPrivacyRadiusMeters
    // with whatever the user picked) AND can be set explicitly here
    // in Preferences. 0 = "Off" (no privacy radius).
    locationPrivacyRadiusMeters,
    setLocationPrivacyRadiusMeters,
}) => {
    const currentCodec = preferredVideoCodec || VIDEO_CODECS_DEFAULT;
    const currentVideoProfile = VIDEO_PROFILE_OPTIONS.some(o => o.id === videoProfile)
        ? videoProfile
        : VIDEO_PROFILE_DEFAULT;
    const currentAudioCodec = preferredAudioCodec || AUDIO_CODECS_DEFAULT;
    // Resolve the saved tri-state encryptionMode into one of the two
    // UI options. The picker only offers 'zrtp_optional' (Enabled) and
    // 'sdes' (Disabled); a legacy 'zrtp_mandatory' value from an older
    // build collapses into "Enabled" so the pill still highlights
    // correctly without forcing a migration write. Any other unknown
    // value defaults to Enabled too — same shape as app.js's runtime
    // default.
    const currentMode = encryptionMode === 'sdes'
        ? 'sdes'
        : 'zrtp_optional';
    const currentDtmf = dtmfMode || DTMF_DEFAULT;
    const currentTickInterval = LOCATION_TICK_INTERVAL_STOPS.some(s => s.value === locationTickIntervalSec)
        ? locationTickIntervalSec
        : LOCATION_TICK_INTERVAL_DEFAULT;
    const currentProximity = LOCATION_PROXIMITY_STOPS.some(s => s.value === locationProximityMeters)
        ? locationProximityMeters
        : LOCATION_PROXIMITY_DEFAULT;

    // ScrollView max height: 70% of screen so the modal grows with the
    // device. The previous fixed 400 px clipped most of the content
    // once new sections (DTMF, location sliders) landed and made the
    // gesture area for scrolling tight enough that Android often
    // missed the pan.
    const scrollMaxHeight = Math.round(Dimensions.get('window').height * 0.7);

    // Compact pill styles — same shape EditContactModal uses for its
    // per-contact override pills so both modals feel consistent.
    // contentStyle pulls the default Paper Button height (~36 px) down
    // to a tighter pill height; labelStyle drops the label to FS_BODY
    // and removes the vertical margin that would otherwise hike the
    // pill back up. Apply to every Button in the section rows below.
    // Height was 28 (sized for fontSize 12); bumped to 32 so the
    // FS_BODY label (14) doesn't clip vertically inside the pill.
    const pillContentStyle = { height: 32 };
    const pillLabelStyle = {
        fontSize: FS_BODY,
        marginVertical: 0,
        marginHorizontal: 8,
        lineHeight: 16,
    };

    // Call-recording disclosure modal state.
    //   'hidden'  — modal is closed
    //   'consent' — user just tried to flip auto-record ON; show the
    //               legal disclaimer first and only flip the switch
    //               on "I agree"
    //   'viewer'  — user tapped the "View disclaimer" link next to
    //               the toggle; same body, but the action button is
    //               "Opt out" instead of "I agree"
    // Tracked locally because none of the disclosure state needs to
    // outlive a Preferences session — the *agreement flag* itself is
    // persisted in accounts.settings under disclaimers.callRecording
    // (see callRecordingDisclosure.js) so it survives an app restart
    // and is shared with any future gate.
    const [disclosureMode, setDisclosureMode] = useState('hidden');
    // Has-acknowledged flag, hydrated on mount from accounts.settings.
    // Drives both the "do we need to show the consent gate?" branch
    // when toggling ON and the showOptOut variant of the viewer.
    const [hasAcknowledged, setHasAcknowledged] = useState(false);

    useEffect(() => {
        let cancelled = false;
        if (!accountId) {
            setHasAcknowledged(false);
            return () => { cancelled = true; };
        }
        readCallRecordingDisclosure(accountId).then((ack) => {
            if (cancelled) return;
            setHasAcknowledged(ack === true);
        }).catch(() => {
            if (cancelled) return;
            setHasAcknowledged(false);
        });
        return () => { cancelled = true; };
    }, [accountId, show]);

    // Toggle handler — gated by the disclosure. Turning OFF is always
    // immediate (no gate); turning ON either flips immediately (if
    // already acknowledged) or opens the consent modal (which will
    // flip the toggle on accept). Exists at this scope so it closes
    // over the latest hasAcknowledged + setEnableAudioRecording.
    const handleToggleAutoRecord = () => {
        if (typeof setEnableAudioRecording !== 'function') return;
        if (enableAudioRecording) {
            // Turning OFF — no disclosure gate. We deliberately keep
            // the persisted acknowledgement: re-enabling later
            // shouldn't re-prompt unless the user explicitly opted
            // out via the viewer.
            setEnableAudioRecording(false);
            return;
        }
        // Turning ON.
        if (hasAcknowledged) {
            setEnableAudioRecording(true);
        } else {
            setDisclosureMode('consent');
        }
    };

    const onDisclosureContinue = async () => {
        // Snapshot the mode BEFORE we hide the modal — the close
        // resets disclosureMode to 'hidden' synchronously and we'd
        // lose the source-of-trigger otherwise.
        const openedFrom = disclosureMode;
        if (accountId) {
            try { await setCallRecordingDisclosure(accountId); }
            catch (e) { /* persistence failure is non-fatal */ }
        }
        setHasAcknowledged(true);
        setDisclosureMode('hidden');
        // ONLY flip the auto-record toggle when the disclosure was
        // opened by the user clicking the Recording-Off pill (mode
        // 'consent'). If they opened the modal via the "View
        // disclaimer" link in viewer mode, agreeing here just
        // persists the legal acknowledgement so subsequent in-call
        // record gestures don't re-prompt — it does NOT enable
        // device-wide auto-recording. The user can flip the pill
        // separately if they want auto-record on.
        if (openedFrom === 'consent'
                && typeof setEnableAudioRecording === 'function') {
            setEnableAudioRecording(true);
        }
    };

    const onDisclosureCancel = () => {
        // No state change — toggle stays where it was, agreement
        // flag stays where it was. The consent gate is purely
        // additive: declining never opts the user out of an existing
        // agreement (only the explicit Opt out button does that).
        setDisclosureMode('hidden');
    };

    const onDisclosureOptOut = async () => {
        if (accountId) {
            try { await clearCallRecordingDisclosure(accountId); }
            catch (e) { /* noop */ }
        }
        setHasAcknowledged(false);
        // Withdrawing consent must also disable the feature — leaving
        // auto-record ON after the user explicitly opted out would be
        // a serious UX bug.
        if (typeof setEnableAudioRecording === 'function') {
            setEnableAudioRecording(false);
        }
        setDisclosureMode('hidden');
    };

    // ─── Location privacy disclosure (parallel to call-recording) ───
    // Same pattern: a 'viewer' modal opened from a "View disclaimer"
    // link in the Location section. The action button is "Opt out"
    // when the user has previously acknowledged (so they can
    // withdraw consent), or "I agree" otherwise.
    //
    // Unlike call recording, there's no toggle here that needs
    // gating — the location-share gate lives in NavigationBar's
    // _ensureLocationDisclosureAcknowledged, which fires the FIRST
    // time the user actually tries to share. The Preferences entry
    // is the viewer/opt-out surface so users can revisit / revoke
    // the consent without having to start a share.
    const [locDisclosureMode, setLocDisclosureMode] = useState('hidden');
    const [locHasAcknowledged, setLocHasAcknowledged] = useState(false);

    useEffect(() => {
        let cancelled = false;
        if (!accountId) {
            setLocHasAcknowledged(false);
            return () => { cancelled = true; };
        }
        readLocationDisclosure(accountId).then((ack) => {
            if (cancelled) return;
            setLocHasAcknowledged(ack === true);
        }).catch(() => {
            if (cancelled) return;
            setLocHasAcknowledged(false);
        });
        return () => { cancelled = true; };
    }, [accountId, show]);

    const onLocDisclosureContinue = async () => {
        // From the Preferences viewer, "I agree" only persists the
        // legal acknowledgement — it does NOT trigger a share. The
        // user still needs to tap Share location in a chat to
        // actually start one.
        if (accountId) {
            try { await setLocationDisclosure(accountId); }
            catch (e) { /* persistence failure is non-fatal */ }
        }
        setLocHasAcknowledged(true);
        setLocDisclosureMode('hidden');
    };

    const onLocDisclosureCancel = () => {
        setLocDisclosureMode('hidden');
    };

    const onLocDisclosureOptOut = async () => {
        // Clearing the flag re-arms the share-flow gate: the next
        // time the user taps Share location, they'll see the
        // disclosure again before any GPS read happens.
        if (accountId) {
            try { await clearLocationDisclosure(accountId); }
            catch (e) { /* noop */ }
        }
        setLocHasAcknowledged(false);
        setLocDisclosureMode('hidden');
    };

    return (
        <>
        <Modal
            animationType="fade"
            transparent
            visible={show}
            onRequestClose={close}
        >
            <View style={containerStyles.overlay}>
                {/* Backdrop: a Pressable that absolute-fills the
                    overlay, sitting BEHIND the Surface (rendered
                    earlier in JSX → behind in z-order). Tap outside
                    the Surface → backdrop receives the touch →
                    onPress fires → modal dismissed. Tap on the
                    Surface → Surface (rendered later, on top) gets
                    the touch first; the Pressable underneath sees
                    nothing. No parent TouchableWithoutFeedback
                    wraps the Surface, so no responder negotiation
                    for the inner ScrollView to lose. This is what
                    fixes the Android stuck-scroll: previously the
                    inner TWF that was absorbing inside-taps was
                    pre-grabbing the touch responder at every
                    gesture start, making the ScrollView miss the
                    pan a fraction of the time. Decoupled like
                    this, ScrollView always wins pans cleanly. */}
                <Pressable
                    style={StyleSheet.absoluteFillObject}
                    onPress={close}
                    accessibilityLabel="Close preferences"
                />
                <Surface style={containerStyles.modalSurface}>
                            <Text style={containerStyles.title}>Sylk preferences</Text>

                            <ScrollView
                                style={{ maxHeight: scrollMaxHeight, paddingHorizontal: 16 }}
                                contentContainerStyle={{ paddingBottom: 8 }}
                                keyboardShouldPersistTaps="handled"
                                nestedScrollEnabled={true}
                                showsVerticalScrollIndicator={true}
                                overScrollMode={Platform.OS === 'android' ? 'always' : undefined}
                                // The remaining handful of Android
                                // quirks that round out the gesture
                                // path:
                                //
                                //   removeClippedSubviews={false}
                                //     RN otherwise unmounts off-
                                //     screen children to save memory;
                                //     during fast scrolls Android can
                                //     try to claim responder on a
                                //     freshly-mounted touchable child
                                //     mid-gesture, dropping the pan.
                                //   directionalLockEnabled={true}
                                //     Once the pan has decided it's
                                //     vertical, ignore minor sideways
                                //     wobble from the user's thumb.
                                //     On phones with curved-edge
                                //     screens the vertical pan
                                //     otherwise occasionally bails to
                                //     horizontal and gets dropped.
                                //   scrollEventThrottle / decelerationRate
                                //     keep the scroll feel snappy so
                                //     the user doesn't perceive a
                                //     stutter as a stuck gesture.
                                removeClippedSubviews={false}
                                directionalLockEnabled={true}
                                scrollEventThrottle={16}
                                decelerationRate="normal"
                            >
                                {/* ───── Video Calls ─────────────────────────────
                                    Two rows:
                                      1. Preferred video codec — VP9 /
                                         VP8 / H264.
                                      2. Quality profile — 480p / 720p /
                                         1080p. Resolution + framerate +
                                         bitrate cap, applied on both the
                                         camera (getUserMedia constraints)
                                         and the libwebrtc encoder
                                         (setParameters). Resolved in
                                         app.js → VIDEO_PROFILES[id].
                                    Both persist to SQL under
                                    accounts.settings and re-apply
                                    immediately via setAccountSetting.
                                    Profile changes also walk the active
                                    call and re-run the encoder caps so
                                    a mid-call bump takes effect without
                                    a hang-up + redial. */}
                                <View style={{ marginBottom: 16 }}>
                                    <Text
                                        style={{
                                            fontSize: FS_LABEL,
                                            fontWeight: '600',
                                            marginBottom: 4,
                                            color: '#333',
                                        }}
                                    >
                                        Video Calls
                                    </Text>
                                    <Text style={{ fontSize: FS_CAPTION, color: '#888', marginBottom: 8 }}>
                                        Preferred video codec for outgoing calls.
                                    </Text>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                                        {VIDEO_CODECS.map(codec => {
                                            const selected = currentCodec === codec;
                                            return (
                                                <Button
                                                    key={codec}
                                                    mode={selected ? 'contained' : 'outlined'}
                                                    compact
                                                    style={{ marginRight: 6, marginBottom: 6 }}
                                                    contentStyle={pillContentStyle}
                                                    labelStyle={pillLabelStyle}
                                                    onPress={() => setPreferredVideoCodec(codec)}
                                                >
                                                    {codec}
                                                </Button>
                                            );
                                        })}
                                    </View>

                                    {/* Quality profile picker. Three
                                        pills — same compact styling as
                                        the codec row so the section
                                        reads consistently. Hint line
                                        below shows the active profile's
                                        concrete resolution / framerate /
                                        bitrate so the user can see what
                                        each tier actually means without
                                        diving into docs. */}
                                    <Text style={{ fontSize: FS_CAPTION, color: '#888', marginTop: 12, marginBottom: 8 }}>
                                        Video profile.
                                    </Text>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                                        {VIDEO_PROFILE_OPTIONS.map(opt => {
                                            const selected = currentVideoProfile === opt.id;
                                            return (
                                                <Button
                                                    key={opt.id}
                                                    mode={selected ? 'contained' : 'outlined'}
                                                    compact
                                                    style={{ marginRight: 6, marginBottom: 6 }}
                                                    contentStyle={pillContentStyle}
                                                    labelStyle={pillLabelStyle}
                                                    onPress={() => {
                                                        if (typeof setVideoProfile === 'function') {
                                                            setVideoProfile(opt.id);
                                                        }
                                                    }}
                                                >
                                                    {opt.label}
                                                </Button>
                                            );
                                        })}
                                    </View>
                                    {(() => {
                                        const active = VIDEO_PROFILE_OPTIONS.find(o => o.id === currentVideoProfile);
                                        return active ? (
                                            <Text style={{ fontSize: FS_CAPTION, color: '#888', marginTop: 4 }}>
                                                {active.hint}
                                            </Text>
                                        ) : null;
                                    })()}
                                </View>

                                <Divider style={{ marginTop: -8, marginBottom: 8 }} />

                                {/* ───── Audio Calls ─────────────────────────────
                                    Three sub-rows packed into a single
                                    section because they're all "what does
                                    an audio call do" knobs:
                                      1. Preferred audio codec — opus by
                                         default, switchable to G722 / PCMU
                                         / PCMA for PSTN routes.
                                      2. DTMF transmission mode — SIP INFO
                                         vs. RFC 4733 (out-of-band).
                                      3. Enable audio recording — gates
                                         the in-call record control. Off by
                                         default so the recording UI doesn't
                                         appear for users who don't need it.
                                    All three persist to SQL under
                                    accounts.settings and re-apply
                                    immediately via setAccountSetting. */}
                                <View style={{ marginBottom: 16 }}>
                                    <Text
                                        style={{
                                            fontSize: FS_LABEL,
                                            fontWeight: '600',
                                            marginBottom: 4,
                                            color: '#333',
                                        }}
                                    >
                                        Audio Calls
                                    </Text>
                                    <Text style={{ fontSize: FS_CAPTION, color: '#888', marginBottom: 8 }}>
                                        Preferred audio codec for outgoing calls.
                                    </Text>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                                        {AUDIO_CODECS.map(codec => {
                                            const selected = currentAudioCodec === codec;
                                            // Display label only — `codec` is still
                                            // the SDP name (PCMU/PCMA/G722/opus) that
                                            // gets persisted and negotiated, but the
                                            // pill reads the user-friendlier name
                                            // from AUDIO_CODEC_LABELS (so PCMU shows
                                            // as "G711 μ" etc.). Falls back to the
                                            // raw codec id if the map is missing an
                                            // entry, so adding a new codec to
                                            // AUDIO_CODECS without updating the
                                            // label map still renders something.
                                            const label = AUDIO_CODEC_LABELS[codec] || codec;
                                            return (
                                                <Button
                                                    key={codec}
                                                    mode={selected ? 'contained' : 'outlined'}
                                                    compact
                                                    style={{ marginRight: 6, marginBottom: 6 }}
                                                    contentStyle={pillContentStyle}
                                                    labelStyle={pillLabelStyle}
                                                    onPress={() => {
                                                        if (typeof setPreferredAudioCodec === 'function') {
                                                            setPreferredAudioCodec(codec);
                                                        }
                                                    }}
                                                >
                                                    {label}
                                                </Button>
                                            );
                                        })}
                                    </View>

                                    {/* DTMF transmission mode — same compact
                                        button-row treatment as the codec
                                        pickers so the whole section reads
                                        consistently. Disabled options keep
                                        their reduced-opacity look so any
                                        future opt-out (e.g. an Android
                                        build that doesn't support a given
                                        path) is visible without being
                                        actionable. */}
                                    <Text style={{ fontSize: FS_CAPTION, color: '#888', marginTop: 12, marginBottom: 8 }}>
                                        How dialpad digits are transmitted during a call.
                                    </Text>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                                        {DTMF_OPTIONS.map(opt => {
                                            const disabled = opt.enabled === false;
                                            const selected = currentDtmf === opt.value;
                                            const onTap = disabled
                                                ? undefined
                                                : () => setDtmfMode(opt.value);
                                            return (
                                                <Button
                                                    key={opt.value}
                                                    mode={selected ? 'contained' : 'outlined'}
                                                    compact
                                                    disabled={disabled}
                                                    style={{
                                                        marginRight: 6,
                                                        marginBottom: 6,
                                                        opacity: disabled ? 0.45 : 1,
                                                    }}
                                                    contentStyle={pillContentStyle}
                                                    labelStyle={pillLabelStyle}
                                                    onPress={onTap}
                                                >
                                                    {opt.label}
                                                </Button>
                                            );
                                        })}
                                    </View>

                                    {/* Auto-record toggle. The in-call
                                        record control is always visible
                                        in AudioCallBox; this preference
                                        flips on the existing "armed"
                                        state automatically when the call
                                        is created so the recorder kicks
                                        in the moment the call connects.
                                        OFF by default so users who don't
                                        need it never see a recording
                                        start without explicit input.
                                        Toggling ON is gated by the call-
                                        recording legal disclaimer (see
                                        handleToggleAutoRecord above) —
                                        the user must opt in once per
                                        SIP identity before the feature
                                        becomes active. */}
                                    <Text style={{ fontSize: FS_CAPTION, color: '#888', marginTop: 12, marginBottom: 8 }}>
                                        Automatic call recording.
                                    </Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <Button
                                            mode={enableAudioRecording ? 'contained' : 'outlined'}
                                            compact
                                            icon={enableAudioRecording ? 'record-rec' : 'record'}
                                            onPress={handleToggleAutoRecord}
                                            style={{ alignSelf: 'flex-start' }}
                                            contentStyle={pillContentStyle}
                                            labelStyle={pillLabelStyle}
                                        >
                                            {enableAudioRecording ? 'Recording On' : 'Recording Off'}
                                        </Button>
                                        {/* "View disclaimer" link. Opens
                                            the disclosure in viewer mode.
                                            If the user has previously
                                            acknowledged, the modal swaps
                                            "I agree" for "Opt out" so
                                            they can withdraw consent (and
                                            simultaneously turn the
                                            feature off) right from here.
                                            Available regardless of
                                            current toggle state — the
                                            user should always be able to
                                            re-read the legal text. */}
                                        <Text
                                            style={{
                                                marginLeft: 12,
                                                fontSize: FS_BODY,
                                                color: '#1976d2',
                                                textDecorationLine: 'underline',
                                            }}
                                            onPress={() => setDisclosureMode('viewer')}
                                            accessibilityRole="link"
                                            accessibilityLabel="View call recording disclaimer"
                                        >
                                            View disclaimer
                                        </Text>
                                    </View>

                                    {/* Proximity sensor — moved under
                                        Audio Calls because the proximity-
                                        triggered behaviours (display blank
                                        while held to the ear, speakerphone
                                        toggle on the away/close gesture)
                                        only matter for audio calls. The
                                        sensor is suspended for video
                                        calls regardless of this flag. */}
                                    <Text style={{ fontSize: FS_CAPTION, color: '#888', marginTop: 12, marginBottom: 8 }}>
                                        Automatic toggle speakerphone.
                                    </Text>
                                    <Button
                                        mode={proximity ? 'contained' : 'outlined'}
                                        compact
                                        icon={proximity ? 'ear-hearing-off' : 'ear-hearing'}
                                        onPress={() => {
                                            if (typeof toggleProximity === 'function') {
                                                toggleProximity();
                                            }
                                        }}
                                        style={{ alignSelf: 'flex-start' }}
                                        contentStyle={pillContentStyle}
                                        labelStyle={pillLabelStyle}
                                    >
                                        {proximity ? 'Proximity On' : 'Proximity Off'}
                                    </Button>
                                </View>

                                <Divider style={{ marginTop: -8, marginBottom: 8 }} />

                                {/* ───── Chat ────────────────────────────────────
                                    Currently just the chat-sounds
                                    toggle (was on the My Account...
                                    page). Other chat-only knobs (typing
                                    indicator, default font size,
                                    auto-link previews, etc.) can land
                                    here later as additional rows in
                                    the same section without affecting
                                    surrounding layout. */}
                                <View style={{ marginBottom: 16 }}>
                                    <Text
                                        style={{
                                            fontSize: FS_LABEL,
                                            fontWeight: '600',
                                            marginBottom: 4,
                                            color: '#333',
                                        }}
                                    >
                                        Chat
                                    </Text>
                                    <Text style={{ fontSize: FS_CAPTION, color: '#888', marginBottom: 8 }}>
                                        Notification sound when my message was read.
                                    </Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <Button
                                            mode={chatSounds ? 'contained' : 'outlined'}
                                            compact
                                            icon={chatSounds ? 'volume-high' : 'volume-off'}
                                            onPress={() => {
                                                if (typeof toggleChatSounds === 'function') {
                                                    toggleChatSounds();
                                                }
                                            }}
                                            style={{ alignSelf: 'flex-start' }}
                                            contentStyle={pillContentStyle}
                                            labelStyle={pillLabelStyle}
                                        >
                                            {chatSounds ? 'Sounds On' : 'Sounds Off'}
                                        </Button>
                                    </View>
                                </View>

                                <Divider style={{ marginTop: -8, marginBottom: 8 }} />

                                {/* ───── Encryption ──────────────────────────────
                                    Compact button-row picker, same shape
                                    as the Codecs section above. Two
                                    pills only — Enabled / Disabled —
                                    backed by the same encryptionMode
                                    string CallZrtp consumes (Enabled
                                    → 'zrtp_optional', Disabled →
                                    'sdes'). When Disabled, no X-Sylk-
                                    ZRTP capability header is sent on
                                    the INVITE and the handshake never
                                    starts (the call still goes through
                                    over DTLS-SRTP between the device
                                    and the SylkServer relay). */}
                                <View style={{ marginBottom: 16 }}>
                                    <Text
                                        style={{
                                            fontSize: FS_LABEL,
                                            fontWeight: '600',
                                            marginBottom: 4,
                                            color: '#333',
                                        }}
                                    >
                                        zRTP Encryption
                                    </Text>
                                    <Text style={{ fontSize: FS_CAPTION, color: '#888', marginBottom: 8 }}>
                                        Used for both audio and video calls.
                                    </Text>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                                        {ENCRYPTION_OPTIONS.map(opt => {
                                            const selected = currentMode === opt.value;
                                            return (
                                                <Button
                                                    key={opt.value}
                                                    mode={selected ? 'contained' : 'outlined'}
                                                    compact
                                                    style={{ marginRight: 6, marginBottom: 6 }}
                                                    contentStyle={pillContentStyle}
                                                    labelStyle={pillLabelStyle}
                                                    onPress={() => setEncryptionMode(opt.value)}
                                                >
                                                    {opt.label}
                                                </Button>
                                            );
                                        })}
                                    </View>
                                    {/* Reassurance note: no matter which
                                        pill is chosen, the call is
                                        always encrypted between the
                                        device and the SylkServer relay
                                        via WebRTC's transport-layer
                                        DTLS-SRTP. What this toggle
                                        controls is whether to ALSO run
                                        the end-to-end layer on top
                                        (zRTP key agreement + AES-128-
                                        GCM frame encryption that the
                                        relay can't read). Spelling it
                                        out avoids the reading "Disabled
                                        = plaintext on the wire", which
                                        isn't the case. */}
                                    <Text style={{ fontSize: FS_CAPTION, color: '#888', marginTop: 2 }}>
                                        Calls are always encrypted between the device and the relay (DTLS-SRTP).
                                    </Text>
                                </View>

                                <Divider style={{ marginTop: -8, marginBottom: 8 }} />

                                {/* ───── Location ───────────────── */}
                                <View style={{ marginBottom: 16 }}>
                                    <Text
                                        style={{
                                            fontSize: FS_LABEL,
                                            fontWeight: '600',
                                            marginBottom: 4,
                                            color: '#333',
                                        }}
                                    >
                                        Location
                                    </Text>
                                    {/* Heartbeat tick cadence. The active live
                                        share fires one location update at this
                                        interval. Lowering it makes the trail
                                        finer and the receiver-side bubble
                                        feel more "live" at the cost of more
                                        battery + more wire traffic. */}
                                    <ThreeStopSlider
                                        title="Update interval (slower ↔ faster)"
                                        stops={LOCATION_TICK_INTERVAL_STOPS}
                                        value={currentTickInterval}
                                        onChange={(v) => {
                                            if (typeof setLocationTickIntervalSec === 'function') {
                                                setLocationTickIntervalSec(v);
                                            }
                                        }}
                                    />
                                    {/* Meet-up auto-end proximity threshold.
                                        Both participants must be within this
                                        radius of each other for the dwell
                                        window before the share auto-ends as
                                        "you've met". Tighter values are more
                                        precise but more sensitive to GPS
                                        jitter; relaxed values tolerate
                                        indoor / urban-canyon GPS at the cost
                                        of firing further apart. */}
                                    <ThreeStopSlider
                                        title="Meet-up proximity (tight ↔ relaxed)"
                                        stops={LOCATION_PROXIMITY_STOPS}
                                        value={currentProximity}
                                        onChange={(v) => {
                                            if (typeof setLocationProximityMeters === 'function') {
                                                setLocationProximityMeters(v);
                                            }
                                        }}
                                    />
                                    {/* Last-used privacy radius. Each
                                        meeting-handshake share gives
                                        the user a slider to hide their
                                        starting position from the
                                        peer for the first 500 m / 2 km
                                        / 4 km / 8 km of the journey;
                                        whichever value they confirm
                                        with becomes the default for
                                        the next share. The same
                                        slider is exposed here so the
                                        user can explicitly set / clear
                                        the default without having to
                                        start a share first. */}
                                    <PrivacyRadiusSlider
                                        title="Default privacy radius for meet-ups"
                                        value={Number(locationPrivacyRadiusMeters) || 0}
                                        onChange={(v) => {
                                            if (typeof setLocationPrivacyRadiusMeters === 'function') {
                                                setLocationPrivacyRadiusMeters(v);
                                            }
                                        }}
                                    />
                                    {/* Privacy-policy viewer link.
                                        Mirrors the "View disclaimer"
                                        link on the Automatic call
                                        recording row. Opens the same
                                        LocationPrivacyDisclosureModal
                                        the share-flow gate uses, but
                                        in viewer mode (showOptOut=
                                        true if previously agreed).
                                        Available regardless of
                                        whether a share is currently
                                        active — the user should
                                        always be able to re-read the
                                        legal text and / or withdraw
                                        consent. */}
                                    <Text
                                        style={{
                                            marginTop: 10,
                                            fontSize: FS_BODY,
                                            color: '#1976d2',
                                            textDecorationLine: 'underline',
                                            alignSelf: 'flex-start',
                                        }}
                                        onPress={() => setLocDisclosureMode('viewer')}
                                        accessibilityRole="link"
                                        accessibilityLabel="View location privacy policy"
                                    >
                                        View privacy policy
                                    </Text>
                                </View>

                                {/* Future sections go here. */}
                            </ScrollView>

                            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: 12 }}>
                                <Button mode="contained" onPress={close}>
                                    Done
                                </Button>
                            </View>
                        </Surface>
                {/* Call-recording disclosure overlay — rendered
                    INSIDE the Preferences Modal (as a sibling of the
                    Surface) using inline mode so it draws as an
                    absolute-fill View on top of the Surface. We do
                    NOT use a nested Modal here: iOS only presents
                    one Modal at a time per presentation context, so
                    a sibling Modal would silently fail to appear
                    until the parent Preferences Modal closed.
                    Visibility and mode (consent vs viewer) are
                    driven by the toggle handler / "View disclaimer"
                    link above. showOptOut flips the action button
                    to "Opt out" when the user has already
                    acknowledged. */}
                <CallRecordingDisclosureModal
                    inline
                    show={disclosureMode !== 'hidden'}
                    showOptOut={disclosureMode === 'viewer' && hasAcknowledged}
                    onContinue={onDisclosureContinue}
                    onCancel={onDisclosureCancel}
                    onOptOut={onDisclosureOptOut}
                />
                {/* Location privacy policy viewer — same inline-mode
                    pattern as the call-recording disclosure above.
                    Opens from the "View privacy policy" link in the
                    Location section. showOptOut flips to true once
                    the user has previously acknowledged so the
                    action button becomes "Opt out" (clears the flag
                    and re-arms the share-flow gate). */}
                <LocationPrivacyDisclosureModal
                    inline
                    show={locDisclosureMode !== 'hidden'}
                    showOptOut={locDisclosureMode === 'viewer' && locHasAcknowledged}
                    onContinue={onLocDisclosureContinue}
                    onCancel={onLocDisclosureCancel}
                    onOptOut={onLocDisclosureOptOut}
                />
            </View>
        </Modal>
        </>
    );
};

PreferencesModal.propTypes = {
    show: PropTypes.bool.isRequired,
    close: PropTypes.func.isRequired,
    // SIP account id — scopes the call-recording disclosure flag.
    // Optional so older callers that haven't been updated to pass it
    // still render the modal (the disclosure gate just defaults to
    // unacknowledged in that case, which means it'll re-prompt every
    // time the toggle is flipped ON).
    accountId: PropTypes.string,
    preferredVideoCodec: PropTypes.string,
    setPreferredVideoCodec: PropTypes.func.isRequired,
    // Video quality profile — optional so older callers that haven't
    // wired the setter still render the modal cleanly. Falls back to
    // the default profile when missing; the picker's onPress already
    // guards against a missing setter.
    videoProfile: PropTypes.string,
    setVideoProfile: PropTypes.func,
    // Audio codec preference — optional so older callers that haven't
    // wired the setter yet still render the modal cleanly. The Audio
    // sub-section's onPress already guards against a missing setter.
    preferredAudioCodec: PropTypes.string,
    setPreferredAudioCodec: PropTypes.func,
    // Audio recording toggle — both optional so older callers / tests
    // can render the modal cleanly. The Audio Calls section's button
    // already guards against a missing setter.
    enableAudioRecording: PropTypes.bool,
    setEnableAudioRecording: PropTypes.func,
    chatSounds: PropTypes.bool,
    toggleChatSounds: PropTypes.func,
    proximity: PropTypes.bool,
    toggleProximity: PropTypes.func,
    // Accepts every mode CallZrtp recognises: 'sdes' (Disabled in the
    // UI), 'zrtp_optional' (Enabled — the default), and the legacy
    // 'zrtp_mandatory' for old saves that haven't been touched yet.
    encryptionMode: PropTypes.oneOf(['sdes', 'zrtp_optional', 'zrtp_mandatory']),
    setEncryptionMode: PropTypes.func.isRequired,
    dtmfMode: PropTypes.oneOf(['rfc4733', 'info']),
    setDtmfMode: PropTypes.func,
    // Location prefs are not required — older callers / tests can omit
    // them and the modal renders the section with the in-code defaults
    // (1 min cadence, 20 m proximity).
    locationPrivacyRadiusMeters: PropTypes.number,
    setLocationPrivacyRadiusMeters: PropTypes.func,
    locationTickIntervalSec: PropTypes.number,
    setLocationTickIntervalSec: PropTypes.func,
    locationProximityMeters: PropTypes.number,
    setLocationProximityMeters: PropTypes.func,
};

export default PreferencesModal;
