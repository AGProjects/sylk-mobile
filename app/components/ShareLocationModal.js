import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Modal, View, TouchableWithoutFeedback, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, Button, Surface, RadioButton } from 'react-native-paper';
import PrivacyRadiusSlider from './PrivacyRadiusSlider';

// Match EditContactModal's look (Modal + Surface with borderRadius: 10)
// so the dialog corners are subtly rounded instead of the pronounced
// curve Paper's <Dialog> uses. `modalSurface` lives in ContainerStyles.
import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/blink/_DeleteMessageModal.scss';

// Duration options presented to the user.
//   value       — duration in milliseconds
//   label       — what the user sees in the radio list
//   periodLabel — what appears in the outgoing "I am sharing the location
//                 with you for …" text
//   kind        — 'meetingRequest' stamps meeting_request:true on the origin
//                 tick and means "until we meet"; 'fixed' is a plain timed
//                 share with no handshake semantics.
//
// "Until we meet" caps at 4h so the share can't run forever if the two
// parties never actually meet — per product decision, sharing must
// eventually expire on its own, and 4h is the window we expect for a
// realistic "meet up" intent.
const DURATION_OPTIONS = [
    {value: 4 * 60 * 60 * 1000,    label: 'Until we meet', periodLabel: 'until we meet', kind: 'meetingRequest'},
    // One-shot: a single GPS fix is acquired and a single location
    // message ships. No timer, no follow-up ticks, no live-update
    // semantics. Receiver renders a static "Shared location" bubble.
    {value: 0,                     label: 'Once',     periodLabel: 'now',      kind: 'once'},
    {value: 4 * 60 * 60 * 1000,    label: '4 hours',  periodLabel: '4 hours',  kind: 'fixed'},
    {value: 8 * 60 * 60 * 1000,    label: '8 hours',  periodLabel: '8 hours',  kind: 'fixed'},
    {value: 24 * 60 * 60 * 1000,   label: '24 hours', periodLabel: '24 hours', kind: 'fixed'},
];


class ShareLocationModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            show: props.show,
            // Index into DURATION_OPTIONS. Default to "Once" (a
            // single-shot share is the lowest-commitment option and
            // the most common day-to-day case — "send my current
            // location" without any live tracking). The previous
            // default was "Until we meet" at index 0; keep that
            // option in the list at index 0 but pre-select index 1.
            // We can't key off `value` here because "Until we meet"
            // and one of the fixed shares can collide on duration but
            // differ in semantics.
            selectedIndex: 1,
            // Privacy radius (metres). Only meaningful for the
            // "Until we meet" path. 0 disables the gate; non-zero values
            // tell NavigationBar to swallow every outgoing location tick
            // whose coordinates are within `excludeOriginRadiusMeters`
            // of the user's first GPS fix. Ticks resume the moment the
            // user moves past the radius. Default 0 so the share
            // behaves exactly as before unless the user picks a non-Off
            // stop. Picked from PRIVACY_RADIUS_STOPS.
            excludeOriginRadiusMeters: 0,
        };
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        // When the modal is re-opened, reset to the default ("Once").
        if (nextProps.show && !this.state.show) {
            this.setState({show: true, selectedIndex: 1, excludeOriginRadiusMeters: 0});
        } else {
            this.setState({show: nextProps.show});
        }
    }

    onConfirm() {
        const option = DURATION_OPTIONS[this.state.selectedIndex] || DURATION_OPTIONS[0];
        // Privacy radius only applies to the meeting-handshake path; for
        // any plain timed share we ship 0 regardless of the slider
        // state so the option can't accidentally bleed across semantic
        // kinds (the slider is only rendered when the meetingRequest
        // option is selected anyway, but defensive belt).
        const excludeOriginRadiusMeters = option.kind === 'meetingRequest'
            ? Number(this.state.excludeOriginRadiusMeters) || 0
            : 0;
        // Let the parent drive the side-effects (sending messages, starting
        // the periodic timer, etc.). We just report the chosen option —
        // including `kind` so the caller knows whether to stamp
        // meeting_request:true on the origin tick.
        this.props.onConfirm({
            durationMs: option.value,
            periodLabel: option.periodLabel,
            kind: option.kind,
            excludeOriginRadiusMeters,
        });
        this.props.close();
    }

    setRadiusStop(meters) {
        this.setState({excludeOriginRadiusMeters: meters});
    }

    onCancel() {
        this.props.close();
    }

    render() {
        return (
            <Modal
                style={containerStyles.container}
                visible={this.state.show}
                transparent
                animationType="fade"
                onRequestClose={this.onCancel}
            >
                {/* Tap outside to dismiss, same as EditContactModal. */}
                <TouchableWithoutFeedback onPress={this.onCancel}>
                    <View style={containerStyles.overlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                        >
                            {/* Block dismiss when the tap is inside the card. */}
                            <TouchableWithoutFeedback onPress={() => {}}>
                                <Surface style={containerStyles.modalSurface}>
                                    <Text style={containerStyles.title}>Share location</Text>

                                    {/* Tighter padding than the shared
                                        styles.body (10px all around) so the
                                        dialog feels compact — the prompt, the
                                        radio list and the note below sit
                                        closer together. */}
                                    <Text style={[styles.body, { paddingTop: 4, paddingBottom: 2 }]}>
                                        with {this.props.uri || this.props.displayName || 'this contact'}
                                    </Text>

                                    {/* Two-column layout. Left column: the
                                        meeting-handshake option ("Until we
                                        meet") followed by an "or" divider
                                        line so the two intents (meetup vs
                                        timed) read as alternatives rather
                                        than a flat list. Right column: the
                                        plain timed shares stacked vertically.
                                        A single RadioButton.Group wraps both
                                        columns so selection is mutually
                                        exclusive across them.

                                        RadioButton.Android is forced on both
                                        platforms so unchecked buttons render
                                        as a clearly visible empty circle
                                        outline — the default <RadioButton>
                                        picks the iOS checkmark style on iOS,
                                        which is invisible when unselected.
                                        uncheckedColor bumps contrast so the
                                        ring stands out against the Surface
                                        background. */}
                                    <RadioButton.Group
                                        onValueChange={(value) => this.setState({selectedIndex: parseInt(value, 10)})}
                                        value={String(this.state.selectedIndex)}
                                    >
                                        <View style={{ flexDirection: 'row' }}>
                                            <View style={{ flex: 1 }}>
                                                {DURATION_OPTIONS.map((opt, idx) => (
                                                    opt.kind === 'meetingRequest' ? (
                                                        /* Override the shared
                                                           checkBoxRow's 10px
                                                           bottom margin so the
                                                           option sits snug at
                                                           the top of its column. */
                                                        <View key={idx} style={[styles.checkBoxRow, { marginBottom: 0 }]}>
                                                            <RadioButton.Android
                                                                value={String(idx)}
                                                                uncheckedColor="#666"
                                                            />
                                                            <Text>{opt.label}</Text>
                                                        </View>
                                                    ) : null
                                                ))}
                                                {/* "or select an interval"
                                                    separator: just the text,
                                                    no horizontal rules — the
                                                    descriptive label stands on
                                                    its own and keeps the
                                                    divider visually quiet
                                                    inside the narrow column. */}
                                                <View style={{
                                                    alignItems: 'center',
                                                    marginTop: 6,
                                                    marginBottom: 2,
                                                    paddingHorizontal: 8,
                                                }}>
                                                    <Text style={{
                                                        fontSize: 12,
                                                        opacity: 0.7,
                                                    }}>or select an interval</Text>
                                                </View>
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                {DURATION_OPTIONS.map((opt, idx) => (
                                                    (opt.kind === 'once' || opt.kind === 'fixed') ? (
                                                        <View key={idx} style={[styles.checkBoxRow, { marginBottom: 0 }]}>
                                                            <RadioButton.Android
                                                                value={String(idx)}
                                                                uncheckedColor="#666"
                                                            />
                                                            <Text>{opt.label}</Text>
                                                        </View>
                                                    ) : null
                                                ))}
                                            </View>
                                        </View>
                                    </RadioButton.Group>

                                    {/* Privacy-radius slider — only shown
                                        when the "Until we meet" handshake is
                                        selected. For plain timed shares
                                        (2h / 4h / 8h / 24h) the user already
                                        knows they're broadcasting their
                                        location for the full window, so a
                                        "hide my origin" control would just
                                        be confusing; the meetup case is the
                                        one where the starting point is
                                        commonly home and the user wants to
                                        surface the journey, not the origin. */}
                                    {DURATION_OPTIONS[this.state.selectedIndex]
                                        && DURATION_OPTIONS[this.state.selectedIndex].kind === 'meetingRequest'
                                        ? (
                                        <PrivacyRadiusSlider
                                            value={this.state.excludeOriginRadiusMeters}
                                            onChange={this.setRadiusStop}
                                            title="Don’t share my location until I move away from my starting point:"
                                        />
                                    ) : null}

                                    {/* Single consolidated disclosure. Three
                                        original disclaimers (PGP, stop-at-any-
                                        time, retention) are joined into one
                                        paragraph so the dialog reads like a
                                        single reassurance instead of a stacked
                                        checklist. The retention clause swaps
                                        between the meetup wipe-on-end promise
                                        and the 7-day fixed-share policy based
                                        on which radio option is selected. */}
                                    <Text style={[styles.body, { marginTop: 4, paddingTop: 4, paddingBottom: 4, fontSize: 12, opacity: 0.75 }]}>
                                        {(() => {
                                            const sel = DURATION_OPTIONS[this.state.selectedIndex];
                                            const head = 'Location data is encrypted end-to-end between devices, no intermediary server can decrypt it. ';
                                            if (sel && sel.kind === 'meetingRequest') {
                                                return head
                                                    + 'Sharing can be stopped at any time by clicking on the location icon. '
                                                    + 'Location data will be destroyed on both devices after meetup.';
                                            }
                                            if (sel && sel.kind === 'once') {
                                                return head
                                                    + 'A single GPS fix is sent and not updated afterwards. '
                                                    + 'The location data can be deleted from both devices.';
                                            }
                                            return head
                                                + 'Sharing can be stopped at any time by clicking on the location icon. '
                                                + 'Only the last learned GPS position is stored in the devices for maximum 7 days. '
                                                + 'The location data can be deleted from both devices.';
                                        })()}
                                    </Text>

                                    {/* Extra bottom padding so the Confirm /
                                        Cancel buttons don't sit flush against
                                        the modal's rounded bottom edge.
                                        Inline rather than in _DeleteMessageModal.scss
                                        because that stylesheet is shared with
                                        other dialogs (Delete message, etc.)
                                        whose layouts we don't want to disturb. */}
                                    <View style={[styles.buttonRow, { marginBottom: 16 }]}>
                                        <Button
                                            mode="outlined"
                                            style={styles.button}
                                            onPress={this.onCancel}
                                            accessibilityLabel="Cancel"
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            mode="contained"
                                            style={styles.button}
                                            onPress={this.onConfirm}
                                            icon="map-marker"
                                            accessibilityLabel="Confirm sharing location"
                                        >
                                            Confirm
                                        </Button>
                                    </View>
                                </Surface>
                            </TouchableWithoutFeedback>
                        </KeyboardAvoidingView>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        );
    }
}

ShareLocationModal.propTypes = {
    show        : PropTypes.bool,
    close       : PropTypes.func.isRequired,
    onConfirm   : PropTypes.func.isRequired,
    uri         : PropTypes.string,
    displayName : PropTypes.string,
};

export default ShareLocationModal;
