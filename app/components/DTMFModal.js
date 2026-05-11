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
    handleKeyPress(item) {
        // Number-entry mode (e.g. typing into the contacts search
        // bar): a digit-collecting consumer takes the printable
        // character ('1', '*', '#', '+', '0' …) and we skip the DTMF
        // tone path entirely. Useful for letting the user dial a
        // number on a real-looking keypad without it implying that
        // tones are being sent over a wire.
        if (this.props.onDigit) {
            this.props.onDigit(item.digit);
            return;
        }

        DEBUG('DTMF tone was sent: ' + item.tone);

        dtmf.stopTone();
        dtmf.playTone(dtmf['DTMF_' + item.tone], 500);

        if (this.props.call && this.props.call.state === 'established'
            && this.props.callKeepSendDtmf) {
            this.props.callKeepSendDtmf(item.tone);
        }
    }

    renderKey(item) {
        const theme = this.props.theme;
        const isV3 = theme && theme.isV3;
        const surfaceColor =
            this.props.darkOnLight
                ? 'rgba(255,255,255,0.10)'
                : (isV3 ? theme.colors.elevation.level2 : '#f5f5f5');
        const digitColor = this.props.darkOnLight
            ? '#ffffff'
            : (isV3 ? theme.colors.onSurface : '#212121');
        const letterColor = this.props.darkOnLight
            ? 'rgba(255,255,255,0.7)'
            : (isV3 ? theme.colors.onSurfaceVariant : '#757575');
        const rippleColor = this.props.darkOnLight
            ? 'rgba(255,255,255,0.25)'
            : (isV3 ? theme.colors.primary : 'rgba(0,0,0,0.12)');

        const sizeScale = this.props.compact ? 0.78 : 1;
        const keySize = Math.round(KEY_SIZE * sizeScale);

        return (
            <TouchableRipple
                key={item.tone}
                onPress={() => this.handleKeyPress(item)}
                rippleColor={rippleColor}
                borderless
                style={[
                    styles.key,
                    {
                        width: keySize,
                        height: keySize,
                        borderRadius: keySize / 2,
                        backgroundColor: surfaceColor,
                    },
                    this.props.darkOnLight && styles.keyDarkOnLight,
                ]}
            >
                <View style={styles.keyContent}>
                    <Text style={[
                        styles.digit,
                        this.props.compact && styles.digitCompact,
                        { color: digitColor },
                    ]}>
                        {item.digit}
                    </Text>
                    {item.letters ? (
                        <Text style={[
                            styles.letters,
                            this.props.compact && styles.lettersCompact,
                            { color: letterColor },
                        ]}>
                            {item.letters}
                        </Text>
                    ) : (
                        // Empty placeholder keeps every key the same
                        // height so '1' / '*' / '#' don't render
                        // shorter than the lettered keys and break the
                        // grid alignment.
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
                        {row.map((item) => this.renderKey(item))}
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
        marginVertical: 3,
    },
    rowCompact: {
        marginVertical: 2,
    },
    key: {
        marginHorizontal: 6,
        // Subtle elevation so the keys feel pressable and read as
        // distinct surfaces — matches Paper's elevated-surface idiom.
        elevation: 2,
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
    },
    keyDarkOnLight: {
        // Drop the elevation/shadow when sitting on a dark backdrop;
        // glassy translucent fill carries the surface read instead.
        elevation: 0,
        shadowOpacity: 0,
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
