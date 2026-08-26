import debug from 'debug';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { View, StyleSheet } from 'react-native';
import {
    Portal,
    Dialog,
    Button,
    Text,
    TouchableRipple,
    withTheme,
} from 'react-native-paper';
import dtmf from 'react-native-dtmf';
import utils from '../utils';

const DEBUG = debug('blinkrtc:DTMF');

// Letter sub-labels mirror the standard ITU/touch-tone phone layout.
// They're rendered small and dim under the digit so the dialpad reads
// like a real phone — the visual cue matters when prompts say things
// like "press P-Q-R-S".
const KEY_LAYOUT = [
    [
        { tone: '1', digit: '1', letters: '' },
        { tone: '2', digit: '2', letters: 'ABC' },
        { tone: '3', digit: '3', letters: 'DEF' },
    ],
    [
        { tone: '4', digit: '4', letters: 'GHI' },
        { tone: '5', digit: '5', letters: 'JKL' },
        { tone: '6', digit: '6', letters: 'MNO' },
    ],
    [
        { tone: '7', digit: '7', letters: 'PQRS' },
        { tone: '8', digit: '8', letters: 'TUV' },
        { tone: '9', digit: '9', letters: 'WXYZ' },
    ],
    [
        { tone: 'STAR', digit: '*', letters: '' },
        { tone: '0', digit: '0', letters: '+' },
        { tone: 'POUND', digit: '#', letters: '' },
    ],
];

// Inline 3×4 keypad. Reused by:
//   • DTMFModal — the in-call dialpad popup.
//   • AudioCallBox awaiting screen — a preview pad rendered above the
//     auto-start countdown so the user can see the dialpad they'll
//     soon be using.
// The keypad always plays a local DTMF tone preview on tap; if a call
// prop is provided AND established, it also forwards the tone over
// the wire via callKeepSendDtmf.
class DTMFPadBase extends Component {
    // Local key-click tone, tolerant of the native module being
    // absent: react-native-dtmf resolves to null on platforms where
    // it isn't linked (user-reported iOS crash: "Cannot read
    // property 'stopTone' of null"). Silent keys are fine; the
    // entered characters must still work.
    playKeyTone(tone, duration) {
        if (!dtmf || typeof dtmf.playTone !== 'function') {
            return;
        }
        try {
            dtmf.stopTone();
            dtmf.playTone(dtmf['DTMF_' + tone], duration);
        } catch (e) {
            // Tone is best-effort feedback only — never let it
            // take the keypad down.
        }
    }

    handleKeyPress(item) {
        // First thing on every tap, before any of the mode branches
        // below can swallow it: record that the user physically
        // pressed a key, and the full state that decides what
        // happens next. Without this, a keypad press that never
        // reaches the wire is invisible in release.log — the log
        // simply has no line at all, which is indistinguishable
        // from "the user never pressed anything".
        const _call = this.props.call;
        utils.timestampedLog('[DTMF/keypad] key pressed'
            + ' digit=' + item.digit
            + ' tone=' + item.tone
            + ' mode=' + (this.props.onDigit ? 'number-entry' : 'in-call')
            + ' call=' + (_call ? _call.id : 'none')
            + ' callState=' + (_call ? _call.state : 'n/a')
            + ' sender=' + (this.props.callKeepSendDtmf ? 'present' : 'MISSING'));

        // Number-entry mode (e.g. typing into the contacts search
        // bar): a digit-collecting consumer takes the printable
        // character ('1', '*', '#', '+', '0' …). Play a short local
        // DTMF tone as audible key feedback — kept briefer than the
        // in-call 500ms burst since nothing is sent over a wire,
        // it's purely a keypad click.
        if (this.props.onDigit) {
            // If the hold-for-'+' timer already fired for this press
            // of the 0 key, the '+' was entered mid-hold — swallow
            // the release-time onPress so no '0' follows it.
            if (item.digit === '0' && this.zeroLongFired) {
                this.zeroLongFired = false;
                return;
            }
            if (item.tone) {
                this.playKeyTone(item.tone, 150);
            }
            this.props.onDigit(item.digit);
            return;
        }

        DEBUG('DTMF tone was sent: ' + item.tone);

        this.playKeyTone(item.tone, 500);

        // Media-flowing states. This USED to test `=== 'established'`
        // alone, which silently swallowed essentially every in-call
        // key press: sylkrtc's outgoing state machine runs
        // proceeding -> established -> accepted, and 'accepted' is the
        // steady talking state — 'established' is a transient the call
        // leaves within the same second (see the 14:52:50 transitions
        // in release.log). By the time a human can tap a digit the
        // call is always 'accepted', so the guard never passed and no
        // DTMF ever reached the wire, in any mode.
        //
        // 'early-media' matters too: PSTN IVRs play their menu before
        // the call is answered, and callers legitimately press digits
        // during that prompt.
        //
        // Keep this set in sync with Call.sendDtmfInfo in
        // node_modules/react-native-sylkrtc/lib/call.js, which gates
        // on exactly these three.
        const MEDIA_STATES = ['established', 'accepted', 'early-media'];

        if (!_call) {
            utils.timestampedLog('[DTMF/keypad] NOT sent — no call prop on the pad');
            return;
        }
        if (!this.props.callKeepSendDtmf) {
            utils.timestampedLog('[DTMF/keypad] NOT sent — callKeepSendDtmf prop missing');
            return;
        }
        if (MEDIA_STATES.indexOf(_call.state) === -1) {
            utils.timestampedLog('[DTMF/keypad] NOT sent — call state is '
                + _call.state + ', not one of ' + MEDIA_STATES.join('/'));
            return;
        }

        utils.timestampedLog('[DTMF/keypad] forwarding tone ' + item.tone
            + ' to callKeepSendDtmf');
        this.props.callKeepSendDtmf(item.tone);
    }

    // Hold the 0 key for 1s → enter '+' instead of '0' (the standard
    // phone-dialer idiom; matches the '+' sub-label under the key).
    // Number-entry mode only — in-call DTMF has no '+' tone, so this
    // isn't wired there and 0 behaves normally.
    //
    // Implemented with an explicit onPressIn timer rather than
    // Pressable's onLongPress: the user reported the '+' only
    // appearing after lifting the finger — this way it lands at the
    // 1s mark while the key is still held. The zeroLongFired flag
    // makes the release-time onPress a no-op (see handleKeyPress).
    handleZeroPressIn() {
        if (!this.props.onDigit) {
            return;
        }
        this.zeroLongFired = false;
        this.zeroHoldTimer = setTimeout(() => {
            this.zeroLongFired = true;
            this.playKeyTone('0', 150);
            this.props.onDigit('+');
        }, 1000);
    }

    handleZeroPressOut() {
        // Stop the pending hold — but keep zeroLongFired as-is: if
        // the timer already fired, the flag must survive until the
        // onPress that follows this pressOut consumes it.
        if (this.zeroHoldTimer) {
            clearTimeout(this.zeroHoldTimer);
            this.zeroHoldTimer = null;
        }
    }

    componentWillUnmount() {
        if (this.zeroHoldTimer) {
            clearTimeout(this.zeroHoldTimer);
        }
    }

    renderKey(item, keyId) {
        const theme = this.props.theme;
        const isV3 = theme && theme.isV3;
        // Text-only keys sit directly on the host screen's
        // background, so the glyph colour must follow the app theme:
        // white-ish in dark mode (either the darkOnLight call-screen
        // backdrop or the `dark` app theme), theme/dark ink in light
        // mode. Relying on Paper's theme alone broke here — the
        // host theme isn't always V3, which fell through to
        // hardcoded black and vanished on dark backgrounds.
        const onDark = this.props.darkOnLight || this.props.dark;
        const digitColor = onDark
            ? '#ffffff'
            : (isV3 ? theme.colors.onSurface : '#212121');
        const letterColor = onDark
            ? 'rgba(255,255,255,0.7)'
            : (isV3 ? theme.colors.onSurfaceVariant : '#757575');
        const rippleColor = onDark
            ? 'rgba(255,255,255,0.25)'
            : (isV3 ? theme.colors.primary : 'rgba(0,0,0,0.12)');

        const sizeScale = this.props.compact ? 0.78 : 1;
        const keySize = Math.round(KEY_SIZE * sizeScale);

        return (
            <TouchableRipple
                key={keyId}
                onPress={() => this.handleKeyPress(item)}
                // Hold 0 for 1s → '+' (number-entry mode only), fired
                // mid-hold by a press-in timer; the release-time
                // onPress is swallowed via zeroLongFired.
                onPressIn={
                    (this.props.onDigit && item.digit === '0')
                        ? () => this.handleZeroPressIn()
                        : undefined
                }
                onPressOut={
                    (this.props.onDigit && item.digit === '0')
                        ? () => this.handleZeroPressOut()
                        : undefined
                }
                rippleColor={rippleColor}
                borderless
                style={[
                    styles.key,
                    {
                        width: keySize,
                        height: keySize,
                        // Round bounds kept for the borderless ripple
                        // — the press feedback is a circle even though
                        // the key itself has no visible surface.
                        borderRadius: keySize / 2,
                    },
                ]}
            >
                <View style={styles.keyContent}>
                    <Text style={[
                        styles.digit,
                        this.props.compact && styles.digitCompact,
                        // '#' renders optically low against the
                        // digits' shared baseline — lift it slightly;
                        // '*' draws high in the font box — bring it
                        // down slightly.
                        item.digit === '#' && styles.poundDigit,
                        item.digit === '*' && styles.starDigit,
                        { color: digitColor },
                    ]}>
                        {item.digit}
                    </Text>
                    {item.letters ? (
                        <Text style={[
                            styles.letters,
                            this.props.compact && styles.lettersCompact,
                            // The '+' under the 0 key is a dialable
                            // symbol, not an ABC letter row — render
                            // it 2pt bigger so it reads as such.
                            item.letters === '+'
                                && (this.props.compact
                                    ? styles.lettersPlusCompact
                                    : styles.lettersPlus),
                            { color: letterColor },
                        ]}>
                            {item.letters}
                        </Text>
                    ) : (
                        // Empty placeholder keeps every digit key the
                        // same height so '1' / '*' / '#' don't render
                        // shorter than the lettered keys and break the
                        // grid alignment. It also puts '*' and '#' at
                        // the same (slightly high) position as the
                        // digits — where the user wants them.
                        <Text style={[
                            styles.letters,
                            this.props.compact && styles.lettersCompact,
                            styles.lettersPlaceholder,
                        ]}>
                            {' '}
                        </Text>
                    )}
                </View>
            </TouchableRipple>
        );
    }

    render() {
        return (
            <View style={[styles.grid, this.props.style]}>
                {KEY_LAYOUT.map((row, rIdx) => (
                    <View
                        key={'row-' + rIdx}
                        style={[
                            styles.row,
                            this.props.compact && styles.rowCompact,
                        ]}
                    >
                        {row.map((item, cIdx) => this.renderKey(
                            item,
                            'k-' + rIdx + '-' + cIdx,
                        ))}
                    </View>
                ))}
            </View>
        );
    }
}

DTMFPadBase.propTypes = {
    call: PropTypes.object,
    callKeepSendDtmf: PropTypes.func,
    // Compact mode shrinks the keys ~22% — used by the inline pre-call
    // preview where vertical room is tight.
    compact: PropTypes.bool,
    // darkOnLight: when the pad is rendered over a dark background
    // (the call screen's dark backdrop) instead of inside a Paper
    // Dialog. Switches to white-on-translucent surfaces.
    darkOnLight: PropTypes.bool,
    // dark: app-level dark theme. Switches the text-only keys to
    // white glyphs so they stay visible on dark backgrounds (same
    // palette darkOnLight uses, but driven by the theme toggle
    // rather than the call-screen backdrop).
    dark: PropTypes.bool,
    // onDigit: when set, key presses report the printable character
    // ('1', '*', '#', '+', '0' …) to the consumer and the DTMF tone
    // path is skipped. Used for number-entry into a text input.
    onDigit: PropTypes.func,
    style: PropTypes.any,
    theme: PropTypes.object,
};

export const DTMFPad = withTheme(DTMFPadBase);

class DTMFModal extends Component {
    render() {
        return (
            <Portal>
                <Dialog
                    visible={this.props.show}
                    onDismiss={this.props.hide}
                    style={styles.dialog}
                >
                    <Dialog.Content>
                        <DTMFPad
                            call={this.props.call}
                            callKeepSendDtmf={this.props.callKeepSendDtmf}
                        />
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={this.props.hide}>Close</Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>
        );
    }
}

const KEY_SIZE = 64;

const styles = StyleSheet.create({
    dialog: {
        marginHorizontal: 32,
        // Push the modal toward the bottom third of the screen so the
        // keypad is reachable by thumb, but keep it CLEAR of the
        // action button bar. The bar sits at marginBottom: 50 with
        // ~70px of button height + the record-call pill overlay
        // immediately above it; reserve enough room here so the
        // dialog doesn't cover any of that.
        marginTop: 'auto',
        marginBottom: 200,
        borderRadius: 20,
    },
    title: {
        textAlign: 'center',
        fontSize: 16,
        paddingTop: 8,
        paddingBottom: 0,
    },
    grid: {
        alignItems: 'center',
        paddingVertical: 0,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'center',
        // Bumped from 3 → 8 so adjacent rows breathe more; with
        // marginHorizontal: 10 below this gives the grid a roomier,
        // less-cramped feel that better matches a real phone keypad.
        marginVertical: 8,
    },
    rowCompact: {
        // Compact preset's vertical gap nudges up proportionally
        // (was 2 → 5) so the inline pre-call preview still keeps
        // some of the breathing room but stays denser than the
        // full-size grid.
        marginVertical: 5,
    },
    key: {
        // 10px side margins → 20px gap between adjacent keys, so the
        // grid keeps real touch separation even without visible key
        // surfaces. Keys are text-only (no fill, no elevation/shadow)
        // per user request — the tap target is still the full round
        // KEY_SIZE area, shown only by the press ripple.
        marginHorizontal: 10,
        backgroundColor: 'transparent',
    },
    keyContent: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    digit: {
        fontSize: 22,
        fontWeight: '500',
        lineHeight: 24,
    },
    digitCompact: {
        fontSize: 18,
        lineHeight: 20,
    },
    // Small optical lift for '#' (reported as sitting too low).
    poundDigit: {
        transform: [{ translateY: -2 }],
    },
    // Matching optical drop for '*' (drawn high in the font box).
    starDigit: {
        transform: [{ translateY: 2 }],
    },
    letters: {
        fontSize: 10,
        fontWeight: '600',
        letterSpacing: 1.2,
        marginTop: 2,
    },
    lettersCompact: {
        fontSize: 8,
        marginTop: 1,
    },
    // '+' sub-label (under 0): a dialable symbol, so much bigger than
    // the ABC letter rows (bumped several times by user request).
    lettersPlus: {
        fontSize: 18,
        lineHeight: 19,
        fontWeight: '500',
    },
    lettersPlusCompact: {
        fontSize: 15,
        lineHeight: 16,
    },
    lettersPlaceholder: {
        opacity: 0,
    },
});

DTMFModal.propTypes = {
    show: PropTypes.bool.isRequired,
    hide: PropTypes.func.isRequired,
    call: PropTypes.object,
    callKeepSendDtmf: PropTypes.func,
};

export default DTMFModal;
