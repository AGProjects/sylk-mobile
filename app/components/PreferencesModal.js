// PreferencesModal — per-device, per-app settings.
//
// NOT synced to the SylkServer, NOT tied to a SIP account, NOT in SQL.
// Lives in AsyncStorage as a single JSON blob under 'devicePreferences'.
// Backed by app.js: state.devicePreferences + setDevicePreference().
//
// This is where per-device knobs go that depend on this phone's hardware
// or the user's per-device opinion: codec choice, jitter buffer size,
// debug toggles, etc. As the modal grows, add new <View>-wrapped
// sections to render() rather than packing everything into one screen.
//
// Two phones logged into the same SIP account legitimately want
// different settings here, which is exactly why this modal exists
// separately from My Account.
//
// Sections:
//   1. Video Codecs — preferred video codec, with zRTP compatibility tag
//   2. Encryption  — sdes / zrtp-optional / zrtp-mandatory radio
//
// Future sections to consider: Audio (echo cancellation, AEC mode,
// jitter buffer), Network (TURN over TCP, prefer IPv6), Debug (verbose
// stats overlay, force codec for testing).

import React from 'react';
import { Modal, View, ScrollView, TouchableWithoutFeedback, TouchableOpacity } from 'react-native';
import { Text, Button, Surface, RadioButton } from 'react-native-paper';
import PropTypes from 'prop-types';

import containerStyles from '../assets/styles/ContainerStyles';

const VIDEO_CODECS = ['VP9', 'VP8', 'H264'];
const VIDEO_CODECS_DEFAULT = 'VP9';

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

// One of 'sdes' | 'zrtp_optional' | 'zrtp_mandatory'. Must match the
// constants in CallZrtp.js. Defaulted upstream by app.js so any unset
// value here also resolves to a real mode.
// Only zRTP modes are user-selectable. Plain SRTP/DTLS (SDES on the SIP
// side) is what WebRTC negotiates by default at the transport layer
// regardless — there's no point exposing it as a separate "off" choice.
// In zRTP-optional mode it's the fallback when end-to-end negotiation
// can't complete; in zRTP-mandatory mode the call is terminated rather
// than fall back.
const ENCRYPTION_OPTIONS = [
    {
        value: 'zrtp_optional',
        title: 'zRTP — optional',
        subtitle: 'End-to-end encryption; '
                + 'falls back to DTLS if negotiation fails',
    },
    {
        value: 'zrtp_mandatory',
        title: 'zRTP — mandatory',
        subtitle: 'End-to-end encryption; '
                + 'calls end if negotiation fails',
    },
];

const PreferencesModal = ({
    show,
    close,
    preferredVideoCodec,
    setPreferredVideoCodec,
    encryptionMode,
    setEncryptionMode,
    // Proximity sensor — moved here from the main menu since it's a
    // per-device behaviour preference (whether to mute the screen
    // when the user holds the phone to their ear during a call), not
    // a frequent-use action that warrants a top-level menu slot.
    proximity,
    toggleProximity,
}) => {
    const currentCodec = preferredVideoCodec || VIDEO_CODECS_DEFAULT;
    const currentMode = encryptionMode || 'zrtp_optional';

    return (
        <Modal
            animationType="fade"
            transparent
            visible={show}
            onRequestClose={close}
        >
            <TouchableWithoutFeedback onPress={close}>
                <View style={containerStyles.overlay}>
                    <TouchableWithoutFeedback>
                        <Surface style={containerStyles.modalSurface}>
                            <Text style={containerStyles.title}>Preferences</Text>

                            <ScrollView
                                style={{ maxHeight: 400, paddingHorizontal: 16 }}
                                contentContainerStyle={{ paddingBottom: 8 }}
                                keyboardShouldPersistTaps="handled"
                            >
                                {/* ───── Codecs ───────────────────────────────── */}
                                <View style={{ marginBottom: 16 }}>
                                    <Text
                                        style={{
                                            fontSize: 14,
                                            fontWeight: '600',
                                            marginBottom: 4,
                                            color: '#333',
                                        }}
                                    >
                                        Codecs
                                    </Text>
                                    <Text style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
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
                                                    onPress={() => setPreferredVideoCodec(codec)}
                                                >
                                                    {codec}
                                                </Button>
                                            );
                                        })}
                                    </View>
                                </View>

                                {/* ───── Encryption ────────────────────────────── */}
                                <View style={{ marginBottom: 16 }}>
                                    <Text
                                        style={{
                                            fontSize: 14,
                                            fontWeight: '600',
                                            marginBottom: 4,
                                            color: '#333',
                                        }}
                                    >
                                        Encryption
                                    </Text>
                                    {/* Three modes:
                                          sdes           — no zRTP, server-relay-encrypted only
                                          zrtp_optional  — try zRTP, fall back to sdes on failure
                                          zRTP_mandatory — require zRTP, terminate call on failure
                                        Tapping a row anywhere selects it (better hit area
                                        than the radio circle alone). */}
                                    <RadioButton.Group
                                        onValueChange={setEncryptionMode}
                                        value={currentMode}
                                    >
                                        {ENCRYPTION_OPTIONS.map(opt => (
                                            <TouchableOpacity
                                                key={opt.value}
                                                onPress={() => setEncryptionMode(opt.value)}
                                                activeOpacity={0.7}
                                                style={{
                                                    flexDirection: 'row',
                                                    alignItems: 'center',
                                                    paddingVertical: 0,
                                                }}
                                            >
                                                <RadioButton.Android
                                                    value={opt.value}
                                                    onPress={() => setEncryptionMode(opt.value)}
                                                />
                                                <View style={{ flex: 1, marginLeft: 2 }}>
                                                    <Text style={{ fontSize: 13, fontWeight: '500' }}>
                                                        {opt.title}
                                                    </Text>
                                                    <Text style={{ fontSize: 11, color: '#888' }}>
                                                        {opt.subtitle}
                                                    </Text>
                                                </View>
                                            </TouchableOpacity>
                                        ))}
                                    </RadioButton.Group>
                                </View>

                                {/* ───── Proximity sensor ───────────────── */}
                                <View style={{ marginBottom: 16 }}>
                                    <Text
                                        style={{
                                            fontSize: 14,
                                            fontWeight: '600',
                                            marginBottom: 4,
                                            color: '#333',
                                        }}
                                    >
                                        Proximity sensor
                                    </Text>
                                    <Text style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                                        Mute the display while the phone is held to your ear during a call.
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
                                    >
                                        {proximity ? 'On' : 'Off'}
                                    </Button>
                                </View>

                                {/* Future sections go here. */}
                            </ScrollView>

                            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: 12 }}>
                                <Button mode="contained" onPress={close}>
                                    Done
                                </Button>
                            </View>
                        </Surface>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

PreferencesModal.propTypes = {
    show: PropTypes.bool.isRequired,
    close: PropTypes.func.isRequired,
    preferredVideoCodec: PropTypes.string,
    setPreferredVideoCodec: PropTypes.func.isRequired,
    proximity: PropTypes.bool,
    toggleProximity: PropTypes.func,
    encryptionMode: PropTypes.oneOf(['zrtp_optional', 'zrtp_mandatory']),
    setEncryptionMode: PropTypes.func.isRequired,
};

export default PreferencesModal;
