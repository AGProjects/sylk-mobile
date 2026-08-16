import React, { Component } from 'react';
import ThemedModalSurface from './ThemedModalSurface';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, Platform, Modal, TouchableWithoutFeedback, KeyboardAvoidingView, StyleSheet } from 'react-native';
import { Text, Button, TextInput, Checkbox } from 'react-native-paper';

// Share the Modal + dimmed-overlay + rounded Surface shell with
// RefetchMessagesModal / DeleteHistoryModal / EditContactModal so every dialog
// in the app reads as the same rounded-corner card on a dimmed backdrop.
import containerStyles from '../assets/styles/ContainerStyles';

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-DIALER — developer soak tool.
//
// Configures and starts an automated call loop against one contact, used to
// hunt media leaks and ANRs across many calls without sitting there dialling by
// hand. Reached from the contact menu, which is itself gated on Developer mode
// (Preferences → Advanced → Developer).
//
// Three knobs:
//   • Media — audio and/or video, both on by default. Whatever is ticked here
//     is what every call in the train is placed with, so an audio-only soak and
//     a video soak exercise different capturer paths from the same tool.
//   • Auto redial timer — gap between one call ending and the next starting.
//     Must be > 0: dialling the instant the previous call tears down races the
//     very teardown we are trying to measure.
//   • Auto hangup timer — how long to hold an ANSWERED call before hanging up.
//     ZERO MEANS NEVER: the call is left up until the peer ends it or you press
//     hangup yourself. That mode soaks long calls (encoder churn, camera
//     thermals, jitter-buffer growth) rather than call setup/teardown.
//
// Pressing hangup yourself always stops the loop — see hangupCall() in app.js.
// ─────────────────────────────────────────────────────────────────────────────

export const AUTODIALER_DEFAULT_REDIAL_S = 10;
export const AUTODIALER_DEFAULT_HANGUP_S = 0;

// Quick-picks. 0 on the hangup row is the "stay connected" case, offered as a
// preset rather than left as something you have to know to type.
const REDIAL_PRESETS = [5, 10, 30, 60];
const HANGUP_PRESETS = [0, 10, 20, 60];

// Everything in the body is LEFT-aligned on a single 24dp gutter so the
// section labels, checkboxes, preset chips, inputs and hint text all share one
// vertical edge and the dialog reads as a form rather than a poster. The title
// and the Cancel/Start row stay centred, matching every other modal.
//
// The chip rows use a 20dp gutter, not 24: each chip carries margin: 4, so 20 +
// 4 puts the first chip's visible edge on the same 24dp line as the labels.
const GUTTER = 24;
const CHIP_MARGIN = 4;

const styles = StyleSheet.create({
    titleContainer: {
        flexDirection: 'column',
        alignItems: 'center',
    },
    sectionLabel: {
        fontSize: 13,
        fontWeight: '600',
        marginTop: 10,
        marginHorizontal: GUTTER,
        textAlign: 'left',
    },
    mediaRow: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        marginTop: 2,
        // Paper's Checkbox has its own internal padding, so pull the row in a
        // little to keep the tick box — not its ripple — on the gutter.
        marginHorizontal: GUTTER - 8,
    },
    mediaItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 16,
    },
    presetRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'flex-start',
        marginTop: 4,
        marginBottom: 2,
        marginHorizontal: GUTTER - CHIP_MARGIN,
    },
    presetButton: {
        margin: CHIP_MARGIN,
    },
    inputWrap: {
        marginHorizontal: GUTTER,
        marginTop: 4,
    },
    input: {
        backgroundColor: 'transparent',
    },
    hint: {
        fontSize: 12,
        color: '#666',
        textAlign: 'left',
        marginTop: 6,
        marginHorizontal: GUTTER,
    },
    error: {
        fontSize: 12,
        color: 'red',
        textAlign: 'left',
        marginTop: 6,
        marginHorizontal: GUTTER,
    },
    button: {
        margin: 10,
    },
    buttonRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        paddingBottom: 10,
        marginTop: 8,
    },
});

class AutoDialerModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = this.seed(props);
    }

    seed(props) {
        const r = (typeof props.redialSeconds === 'number' && props.redialSeconds > 0)
            ? props.redialSeconds : AUTODIALER_DEFAULT_REDIAL_S;
        const h = (typeof props.hangupSeconds === 'number' && props.hangupSeconds >= 0)
            ? props.hangupSeconds : AUTODIALER_DEFAULT_HANGUP_S;
        return {
            show: props.show,
            redialText: String(r),
            hangupText: String(h),
            // Both media on by default — a plain video call, which is what the
            // capturer/leak work cares about most.
            audio: props.audio !== false,
            video: props.video !== false,
        };
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.show !== this.props.show) {
            // Re-seed from the last used values every time the dialog opens, so
            // a run you just configured is one tap away from being repeated.
            if (nextProps.show && !this.props.show) {
                this.setState(this.seed(nextProps));
            } else {
                this.setState({ show: nextProps.show });
            }
        }
    }

    onChangeRedial(text) {
        this.setState({ redialText: (text || '').replace(/[^0-9]/g, '') });
    }

    onChangeHangup(text) {
        this.setState({ hangupText: (text || '').replace(/[^0-9]/g, '') });
    }

    /** Redial must be > 0 — see the note at the top of the file. */
    parsedRedial() {
        const n = parseInt(this.state.redialText, 10);
        if (isNaN(n) || n <= 0) return null;
        return n;
    }

    /** Hangup may be 0 — that is "never hang up", not an invalid value. */
    parsedHangup() {
        const n = parseInt(this.state.hangupText, 10);
        if (isNaN(n) || n < 0) return null;
        return n;
    }

    start() {
        const redial = this.parsedRedial();
        const hangup = this.parsedHangup();
        if (redial == null || hangup == null) return;
        if (!this.state.audio && !this.state.video) return;
        this.props.startAutoDialer(this.props.contact, {
            redialSeconds: redial,
            hangupSeconds: hangup,
            audio: this.state.audio,
            video: this.state.video,
        });
        this.props.close();
    }

    render() {
        const redial = this.parsedRedial();
        const hangup = this.parsedHangup();
        const noMedia = !this.state.audio && !this.state.video;
        const invalid = (redial == null || hangup == null || noMedia);
        const mediaLabel = (this.state.audio && this.state.video)
            ? 'video' : (this.state.video ? 'video-only' : 'audio');

        const shell = (inner) => (
            <Modal
                style={containerStyles.container}
                // Coerce to boolean — RN's Modal renders when `visible` is
                // undefined, so without `!!` it can pop up on cold start.
                visible={!!this.state.show}
                transparent
                animationType="fade"
                onRequestClose={this.props.close}
                supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
            >
                <TouchableWithoutFeedback onPress={this.props.close}>
                    <View style={containerStyles.overlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                        >
                            <TouchableWithoutFeedback onPress={() => {}}>
                                <ThemedModalSurface style={containerStyles.modalSurface}>
                                    {inner}
                                </ThemedModalSurface>
                            </TouchableWithoutFeedback>
                        </KeyboardAvoidingView>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        );

        return shell(
            <>
                <View style={styles.titleContainer}>
                    <Text style={containerStyles.title}>Auto-dialer</Text>
                </View>

                {/* ── Media ─────────────────────────────────────────────── */}
                <Text style={styles.sectionLabel}>Media</Text>
                <View style={styles.mediaRow}>
                    <View style={styles.mediaItem}>
                        <Checkbox
                            status={this.state.audio ? 'checked' : 'unchecked'}
                            onPress={() => this.setState({ audio: !this.state.audio })}
                        />
                        <Text onPress={() => this.setState({ audio: !this.state.audio })}>Audio</Text>
                    </View>
                    <View style={styles.mediaItem}>
                        <Checkbox
                            status={this.state.video ? 'checked' : 'unchecked'}
                            onPress={() => this.setState({ video: !this.state.video })}
                        />
                        <Text onPress={() => this.setState({ video: !this.state.video })}>Video</Text>
                    </View>
                </View>

                {/* ── Redial interval ───────────────────────────────────── */}
                <Text style={styles.sectionLabel}>Auto redial timer</Text>
                <View style={styles.presetRow}>
                    {REDIAL_PRESETS.map(s => (
                        <Button
                            key={'r' + s}
                            mode={String(s) === this.state.redialText ? 'contained' : 'outlined'}
                            compact
                            uppercase={false}
                            style={styles.presetButton}
                            onPress={() => this.setState({ redialText: String(s) })}
                        >
                            {s + 's'}
                        </Button>
                    ))}
                </View>
                <View style={styles.inputWrap}>
                    <TextInput
                        mode="outlined"
                        label="Redial after (seconds)"
                        keyboardType="number-pad"
                        value={this.state.redialText}
                        onChangeText={this.onChangeRedial}
                        style={styles.input}
                        maxLength={4}
                    />
                </View>

                {/* ── Hangup delay ──────────────────────────────────────── */}
                <Text style={styles.sectionLabel}>Auto hangup timer</Text>
                <View style={styles.presetRow}>
                    {HANGUP_PRESETS.map(s => (
                        <Button
                            key={'h' + s}
                            mode={String(s) === this.state.hangupText ? 'contained' : 'outlined'}
                            compact
                            uppercase={false}
                            style={styles.presetButton}
                            onPress={() => this.setState({ hangupText: String(s) })}
                        >
                            {s === 0 ? 'Never' : s + 's'}
                        </Button>
                    ))}
                </View>
                <View style={styles.inputWrap}>
                    <TextInput
                        mode="outlined"
                        label="Hang up after (seconds, 0 = never)"
                        keyboardType="number-pad"
                        value={this.state.hangupText}
                        onChangeText={this.onChangeHangup}
                        style={styles.input}
                        maxLength={4}
                    />
                </View>

                {invalid ? (
                    <Text style={styles.error}>
                        {noMedia
                            ? 'Select at least one of Audio or Video.'
                            : 'Redial must be greater than 0. Hang up may be 0 (never).'}
                    </Text>
                ) : (
                    <Text style={styles.hint}>
                        {hangup === 0
                            ? `Places ${mediaLabel} calls that stay connected until the other side hangs up, then redials after ${redial}s.`
                            : `Places ${mediaLabel} calls, hangs up ${hangup}s after each connects, then redials after ${redial}s.`}
                    </Text>
                )}

                <View style={styles.buttonRow}>
                    <Button
                        mode="outlined"
                        style={styles.button}
                        onPress={this.props.close}
                        accessibilityLabel="Cancel"
                    >
                        Cancel
                    </Button>
                    <Button
                        mode="contained"
                        style={styles.button}
                        onPress={this.start}
                        disabled={invalid}
                        icon="reload"
                        accessibilityLabel="Start auto-dialer"
                    >
                        Start
                    </Button>
                </View>
            </>
        );
    }
}

AutoDialerModal.propTypes = {
    show: PropTypes.bool,
    close: PropTypes.func.isRequired,
    startAutoDialer: PropTypes.func.isRequired,
    contact: PropTypes.object,
    // Last used values, so reopening the dialog offers them again.
    redialSeconds: PropTypes.number,
    hangupSeconds: PropTypes.number,
    audio: PropTypes.bool,
    video: PropTypes.bool,
};

export default AutoDialerModal;
