import React, { Component } from 'react';
import ThemedModalSurface from './ThemedModalSurface';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Modal, View, TouchableWithoutFeedback, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, Button, Surface, RadioButton } from 'react-native-paper';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/blink/_DeleteMessageModal.scss';

const HOUR_MS = 60 * 60 * 1000;

// Duration picker for the answer. Deliberately a SHORT list — this modal
// is an interrupt ("someone is asking where you are"), not the full share
// composer, so it offers the one-shot default plus two live windows and
// nothing else. The full set of stop conditions ("Until I return",
// "Until we meet", 4h/24h) stays in ShareLocationModal, which the user
// reaches on their own terms.
//
//   value       — duration in milliseconds. 0 means "no window": a single
//                 GPS fix, no timer, no follow-up ticks.
//   label       — what the user sees in the picker.
//   periodLabel — what appears in the outgoing "I am sharing the location
//                 with you …" text (same vocabulary as ShareLocationModal
//                 so both entry points read identically on the peer side).
//   kind        — 'once' (one-shot) | 'fixed' (plain timed live share).
//                 Passed straight through to the caller, which maps it onto
//                 shareLocationOnce vs startLocationSharing.
const INTERVAL_OPTIONS = [
    {value: 0,           label: 'Once',    periodLabel: 'now',      kind: 'once'},
    {value: 2 * HOUR_MS, label: '2 hours', periodLabel: '2 hours',  kind: 'fixed'},
    {value: 8 * HOUR_MS, label: '8 hours', periodLabel: '8 hours',  kind: 'fixed'},
];
// "Once" is the default on every open — the lowest-commitment answer to an
// unsolicited ask. It is also the ONLY answer available under a
// foreground-only grant (see _isForegroundOnly).
const INTERVAL_ONCE_INDEX = 0;

// Receiver-side prompt for an incoming "please share your current
// location" request. Fires once per request _id (the caller persists
// a "handled" marker so we don't reprompt after dismissal).
//
// Share  → caller fires the accept handler with the picked option:
//          'once' ships a single location bubble back to the requester,
//          a 'fixed' interval starts a live timed share that expires on
//          its own after the chosen window.
// No     → silent: no message is sent back, same convention as the
//          meeting-request decline.
class LocationRequestModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            show: props.show,
            // Index into INTERVAL_OPTIONS. Always valid; always reset to
            // "Once" when the modal (re-)opens — an interval picked for a
            // previous request must never be inherited by the next one.
            selectedInterval: INTERVAL_ONCE_INDEX,
            // The request the current selection belongs to. Tracked because
            // the parent re-presents in place (it sets show:true on the
            // already-open modal rather than closing first) when the peer
            // re-sends the ask, so "the modal opened" is NOT the same event
            // as "a new request arrived".
            answeringRequestId: props.requestId || null,
        };
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        // Re-seed the picker when a NEW request takes over the modal —
        // either the closed→open edge, or a different requestId swapped in
        // underneath an already-open prompt (the peer re-sent the ask from
        // their kebab inside our 45 s window; the parent overwrites
        // locationRequestModal without closing it). Both must land on the
        // "Once" default: answering a fresh ask with a duration the user
        // picked for the previous one is exactly the mistake this guards.
        //
        // Everything else — a plain re-render because the contact name or
        // the permission probe resolved late — must leave the selection
        // alone, hence the edge test rather than an unconditional reset.
        const _newRequest = !!nextProps.requestId
            && nextProps.requestId !== this.state.answeringRequestId;
        if (nextProps.show && (!this.state.show || _newRequest)) {
            this.setState({
                show: true,
                selectedInterval: INTERVAL_ONCE_INDEX,
                answeringRequestId: nextProps.requestId || null,
            });
            return;
        }
        this.setState({ show: nextProps.show });
    }

    // A foreground-only ("While Using") grant can't sustain a background
    // share: the OS suspends location delivery the moment the app leaves
    // the foreground, so a 2h/8h window would silently stop ticking. Under
    // that grant the intervals are disabled and only the single fix — which
    // completes while the app is still in front of the user — is offered.
    // Mirrors ShareLocationModal._isForegroundOnly.
    static _isForegroundOnly(level) {
        return level === 'whenInUse' || level === 'foregroundOnly';
    }

    // The two reasons an interval can't be picked:
    //
    //   • foreground-only grant — the OS won't run a background share.
    //   • a plain timed share to this contact is ALREADY live — on THIS
    //     device startLocationSharing's duplicate guard would refuse a
    //     second plain session outright, so offering an interval would be
    //     a no-op and the requester would get no answer at all. The prop is
    //     computed from isPlainShareLiveForUri, which is deliberately a bit
    //     broader: it also counts a share one of our SIBLING devices is
    //     broadcasting to this peer, which the local guard wouldn't catch.
    //     Blocking those too is the conservative read — the requester is
    //     already watching us move from some device of ours either way.
    //
    // "Once" is never blocked by either: a one-shot is a standalone
    // message, not a session, so it always ships.
    _intervalsBlocked() {
        return LocationRequestModal._isForegroundOnly(this.props.permissionLevel)
            || !!this.props.plainShareLive;
    }

    // The option the Share button will act on. Coerces to "Once" whenever
    // intervals are blocked, so a stale selection (permission downgraded, or
    // a share started from another screen while this modal sat open — it
    // lives up to 45 s) can never produce a share the engine will refuse.
    _effectiveOption() {
        const opt = INTERVAL_OPTIONS[this.state.selectedInterval]
            || INTERVAL_OPTIONS[INTERVAL_ONCE_INDEX];
        if (opt.kind !== 'once' && this._intervalsBlocked()) {
            return INTERVAL_OPTIONS[INTERVAL_ONCE_INDEX];
        }
        return opt;
    }

    _selectInterval(idx) {
        const opt = INTERVAL_OPTIONS[idx];
        if (!opt) return;
        if (opt.kind !== 'once' && this._intervalsBlocked()) {
            return;
        }
        this.setState({selectedInterval: idx});
    }

    // One row of the duration radio. Disabled (and dimmed) for every
    // interval while _intervalsBlocked(); "Once" is always tappable.
    _renderIntervalRow(opt, idx) {
        const _disabled = opt.kind !== 'once' && this._intervalsBlocked();
        const _selected = this.state.selectedInterval === idx;
        return (
            <TouchableWithoutFeedback
                key={idx}
                onPress={_disabled ? undefined : () => this._selectInterval(idx)}
            >
                <View style={[styles.checkBoxRow, { marginBottom: 0 }]}>
                    <RadioButton.Android
                        value={String(idx)}
                        status={_selected ? 'checked' : 'unchecked'}
                        uncheckedColor="#666"
                        disabled={_disabled}
                        onPress={_disabled ? undefined : () => this._selectInterval(idx)}
                    />
                    <Text style={_disabled ? { opacity: 0.4 } : null}>{opt.label}</Text>
                </View>
            </TouchableWithoutFeedback>
        );
    }

    onAccept() {
        const option = this._effectiveOption();
        if (typeof this.props.onAccept === 'function') {
            // Report the chosen option so the caller knows whether to ship a
            // single fix or arm a timed live share. Shape matches
            // ShareLocationModal's onConfirm payload so both accept paths
            // hand the engine the same vocabulary.
            this.props.onAccept({
                durationMs: option.value,
                periodLabel: option.periodLabel,
                kind: option.kind,
            });
        }
        this.props.close();
    }

    onCancel() {
        if (typeof this.props.onDecline === 'function') {
            this.props.onDecline();
        }
        this.props.close();
    }

    render() {
        // Prefer the requester's known display name; fall back to the
        // bare URI, then a generic label.
        const from = this.props.fromName || this.props.fromUri || 'your contact';
        const option = this._effectiveOption();
        const isOnce = option.kind === 'once';
        const foregroundOnly = LocationRequestModal._isForegroundOnly(this.props.permissionLevel);

        return (
            <Modal
                style={containerStyles.container}
                visible={this.state.show}
                transparent
                animationType="fade"
                onRequestClose={this.onCancel}
                /* iOS-only — without this, RN's Modal defaults to
                   supportedOrientations: ['portrait'], which forces the
                   underlying app to portrait while the modal is presented.
                   Include both landscape variants so the modal inherits
                   whichever orientation the user is in. */
                supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
            >
                <TouchableWithoutFeedback onPress={this.onCancel}>
                    <View style={containerStyles.overlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                        >
                            <TouchableWithoutFeedback onPress={() => {}}>
                                <ThemedModalSurface style={containerStyles.modalSurface}>
                                    <Text style={containerStyles.title}>Location request</Text>

                                    <Text style={styles.body}>
                                        {from} is requesting your current location.
                                    </Text>

                                    {/* Duration picker. "Once" is preselected on
                                        every open, so the common case (answer the
                                        ask, disclose nothing more) is still a
                                        single tap on Share — the intervals are
                                        opt-in for the user who wants the
                                        requester to keep seeing them for a
                                        while. */}
                                    <View style={{ marginTop: 4, marginBottom: 8 }}>
                                        {INTERVAL_OPTIONS.map((opt, idx) => this._renderIntervalRow(opt, idx))}
                                    </View>

                                    {/* End-to-end encryption note —
                                        same wording cadence as the
                                        sender-side modals so the
                                        prompts read consistently. The
                                        middle sentence tracks the picked
                                        duration: a one-shot is a single
                                        fix that never updates, an interval
                                        keeps sending until it lapses. */}
                                    <Text style={[styles.body, { marginTop: 4, fontSize: 12, opacity: 0.75 }]}>
                                        {'Location data is encrypted end-to-end between devices, no intermediary server can decrypt it. '
                                            + (isOnce
                                                ? 'A single GPS fix will be sent and not updated afterwards. '
                                                : ('Your location will be sent to ' + from + ' for ' + option.periodLabel
                                                    + ', then sharing stops on its own. You can stop it earlier at any time. '))
                                            + 'The location data can be deleted from both devices.'}
                                    </Text>

                                    {/* Why the intervals are greyed out. Two
                                        distinct causes, so two distinct
                                        sentences — a user told "you're already
                                        sharing" would be baffled by a
                                        permissions explanation and vice versa.
                                        The already-sharing case is checked
                                        first: it's the one the user can act on
                                        right now (stop the running share), and
                                        it holds regardless of the grant. An
                                        unknown permission level never gates. */}
                                    {this.props.plainShareLive ? (
                                        <Text style={[styles.body, { marginTop: 4, fontSize: 12, opacity: 0.85, fontStyle: 'italic' }]}>
                                            {'You are already sharing your location with ' + from + ', so no new period can be started. '
                                                + 'A single location can still be sent, or stop the running share first to pick a new period.'}
                                        </Text>
                                    ) : (foregroundOnly ? (
                                        <Text style={[styles.body, { marginTop: 4, fontSize: 12, opacity: 0.85, fontStyle: 'italic' }]}>
                                            {'Only a single location can be shared: this device is set to allow location access "While Using" the app. '
                                                + 'Allow location "Always" in Settings to share for a period of time.'}
                                        </Text>
                                    ) : null)}

                                    {/* Policy notice — only shown when the
                                        user has not yet agreed to Blink's
                                        location privacy policy. Tells them
                                        accepting this request will pop the
                                        policy modal first; their agreement
                                        is required for the share to actually
                                        proceed. Once they agree, this
                                        notice disappears on subsequent
                                        requests. */}
                                    {this.props.policyAcknowledged ? null : (
                                        <Text style={[styles.body, { marginTop: 8, fontSize: 12, opacity: 0.85, fontStyle: 'italic' }]}>
                                            {'When you tap "Share", you will be asked to review and agree to Blink\'s location privacy policy before any data is sent.'}
                                        </Text>
                                    )}

                                    <View style={[styles.buttonRow, { marginBottom: 16 }]}>
                                        <Button
                                            mode="outlined"
                                            style={styles.button}
                                            onPress={this.onCancel}
                                            accessibilityLabel="Decline location request"
                                        >
                                            Decline
                                        </Button>
                                        {/* Label names the outcome rather than
                                            saying a bare "Share": with a picker
                                            above it, the button has to confirm
                                            WHICH answer is about to be sent. */}
                                        <Button
                                            mode="contained"
                                            style={styles.button}
                                            onPress={this.onAccept}
                                            icon="map-marker"
                                            accessibilityLabel={isOnce
                                                ? 'Send my current location once'
                                                : ('Share my location for ' + option.periodLabel)}
                                        >
                                            {isOnce ? 'Share once' : ('Share for ' + option.periodLabel)}
                                        </Button>
                                    </View>
                                </ThemedModalSurface>
                            </TouchableWithoutFeedback>
                        </KeyboardAvoidingView>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        );
    }
}

LocationRequestModal.propTypes = {
    show:                PropTypes.bool,
    close:               PropTypes.func.isRequired,
    // Called with {durationMs, periodLabel, kind} — the picked answer.
    // kind 'once' → one-shot fix; kind 'fixed' → timed live share of
    // durationMs. Same payload shape as ShareLocationModal's onConfirm.
    onAccept:            PropTypes.func,
    onDecline:           PropTypes.func,
    fromUri:             PropTypes.string,
    // _id of the location_request being answered. Used only to detect that
    // a DIFFERENT request has taken over an already-open prompt, so the
    // duration picker resets to "Once" for it (see CWRP).
    requestId:           PropTypes.string,
    // Resolved display name of the requester (contact name). When set,
    // shown instead of the bare URI. Optional — falls back to fromUri.
    fromName:            PropTypes.string,
    // True when the user has previously agreed to Sylk's location
    // privacy policy. When false, the modal renders an inline note
    // telling them the policy modal will appear before any data is
    // sent. The policy gate itself runs inside shareLocationOnce /
    // startLocationSharing (which onAccept eventually calls).
    policyAcknowledged:  PropTypes.bool,
    // OS location grant level, probed when the modal is presented:
    // 'always' | 'whenInUse' | 'foregroundOnly' | 'blocked' |
    // 'undetermined' | 'unavailable'. Under a foreground-only grant the
    // interval rows are disabled and the answer is forced to a single
    // fix. null/undefined = unknown → don't gate.
    permissionLevel:     PropTypes.string,
    // True when a plain timed location share to this same contact is
    // already running (engine: isPlainShareLiveForUri). The engine refuses
    // a second plain session to the same peer, so the interval rows are
    // disabled and the answer is forced to a single fix.
    plainShareLive:      PropTypes.bool,
};

export default LocationRequestModal;
