import React from 'react';
import PropTypes from 'prop-types';
import {
    View,
    Platform,
    Text,
    Modal,
    TouchableWithoutFeedback,
    StyleSheet,
} from 'react-native';
import { Button, Surface } from 'react-native-paper';

// Shared Modal + dimmed overlay + rounded Surface shell — matches
// DeleteHistoryModal / EditContactModal / ShareLocationModal so every
// dialog in the app reads as part of the same family.
import containerStyles from '../assets/styles/ContainerStyles';

// Lightweight, reusable confirmation dialog.
//
// Replaces three-button native `Alert.alert` prompts (Cancel / Restore /
// Proceed, Cancel / Revive / Eject, …) which Android lays out in a single
// horizontal row. In portrait that row is wider than the screen, so the
// rightmost button gets clipped past the right margin. Here the actions are
// stacked VERTICALLY at full width, so no number of buttons — and no label
// length — can overflow horizontally, in portrait or landscape.
//
// Props:
//   visible  — bool
//   title    — string (dialog heading)
//   message  — string (body; supports \n line breaks)
//   actions  — array of { label, onPress, mode?, destructive?, cancel? }
//              Rendered top-to-bottom. `cancel` styles it as the dismissive
//              option; `destructive` paints it red.
//   onDismiss — called on backdrop tap / hardware back.
const ConfirmActionModal = ({ visible, title, message, actions, onDismiss }) => {
    const _actions = Array.isArray(actions) ? actions : [];

    return (
        <Modal
            visible={!!visible}
            transparent
            animationType="fade"
            onRequestClose={onDismiss}
            supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
        >
            <TouchableWithoutFeedback onPress={onDismiss}>
                <View style={containerStyles.overlay}>
                    {/* Block dismiss when taps land inside the card. */}
                    <TouchableWithoutFeedback onPress={() => {}}>
                        <Surface style={[containerStyles.modalSurface, styles.card]}>
                            {title ? <Text style={styles.title}>{title}</Text> : null}
                            {message ? <Text style={styles.body}>{message}</Text> : null}

                            <View style={styles.actionStack}>
                                {_actions.map((a, i) => (
                                    <Button
                                        key={a.label + i}
                                        mode={a.mode || (a.cancel ? 'outlined' : 'contained')}
                                        uppercase={false}
                                        onPress={() => {
                                            if (typeof a.onPress === 'function') a.onPress();
                                        }}
                                        style={[
                                            styles.actionBtn,
                                            a.destructive ? styles.actionBtnDestructive : null,
                                        ]}
                                        labelStyle={styles.actionLabel}
                                        accessibilityLabel={a.label}
                                    >
                                        {a.label}
                                    </Button>
                                ))}
                            </View>
                        </Surface>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

const styles = StyleSheet.create({
    card: {
        padding: 16,
        // Keep the card comfortably inside both margins. The overlay
        // already pads 16 on each side; this just caps the width on
        // wide (landscape / tablet) screens so the dialog doesn't
        // stretch awkwardly.
        maxWidth: 440,
        width: '100%',
        alignSelf: 'center',
    },
    title: {
        fontSize: 22,
        textAlign: 'center',
        marginBottom: 10,
    },
    body: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 16,
        color: '#333',
    },
    // Vertical button stack — full width, one per row. This is what
    // guarantees the dialog never overflows horizontally regardless of
    // button count or label length.
    actionStack: {
        flexDirection: 'column',
    },
    actionBtn: {
        marginVertical: 5,
        borderRadius: 8,
    },
    actionBtnDestructive: {
        backgroundColor: 'red',
    },
    actionLabel: {
        fontSize: 15,
    },
});

ConfirmActionModal.propTypes = {
    visible: PropTypes.bool,
    title: PropTypes.string,
    message: PropTypes.string,
    actions: PropTypes.array,
    onDismiss: PropTypes.func,
};

export default ConfirmActionModal;
