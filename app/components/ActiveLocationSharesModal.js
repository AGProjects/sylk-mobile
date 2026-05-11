import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import {
    Modal,
    View,
    TouchableWithoutFeedback,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { Text, Button, Surface, IconButton, Divider } from 'react-native-paper';

// Same visual frame as ShareLocationModal / EditContactModal — white
// rounded Surface over a dimmed overlay. Colour-less borders so the list
// sits flat inside the dialog.
import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/blink/_DeleteMessageModal.scss';

// Renders one row per active live-location share (keyed by peer URI) and
// lets the user stop individual shares or all of them at once.
//
// The actual timer bookkeeping stays in NavigationBar — we just call the
// `stopShare(uri)` / `stopAll()` callbacks the parent passed in. That way
// this modal is stateless and can be opened from anywhere in the UI.
class ActiveLocationSharesModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            // Re-render every second so the "time left" column stays
            // accurate. 1s granularity is more than enough for a HH:MM
            // style countdown.
            tick: 0,
        };
    }

    componentDidMount() {
        this._tickInterval = setInterval(() => {
            // Only bother updating while the modal is visible — when it's
            // hidden the parent unmounts it, so this is mainly a safety
            // net for the brief dismiss animation.
            if (this.props.show) {
                this.setState((s) => ({tick: s.tick + 1}));
            }
        }, 1000);
    }

    componentWillUnmount() {
        if (this._tickInterval) {
            clearInterval(this._tickInterval);
            this._tickInterval = null;
        }
    }

    // Format "HH:MM:SS" for short shares, "Xh Ym" for longer ones.
    // Accepts either a future timestamp (ms since epoch) or null/undefined.
    formatTimeLeft(expiresAtMs) {
        if (!expiresAtMs) return '';
        const msLeft = Math.max(0, expiresAtMs - Date.now());
        if (msLeft <= 0) return 'expiring…';
        const totalSec = Math.floor(msLeft / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (h > 0) {
            return `${h}h ${m}m left`;
        }
        if (m > 0) {
            return `${m}m ${s.toString().padStart(2, '0')}s left`;
        }
        return `${s}s left`;
    }

    // Resolve a URI to the nicest display we have — a contact's name if
    // we know it, otherwise the URI itself.
    displayFor(uri) {
        const contacts = this.props.allContacts || [];
        const c = contacts.find((x) => x && x.uri === uri);
        if (c && (c.name || c.displayName)) {
            return c.name || c.displayName;
        }
        return uri || 'unknown';
    }

    onStopOne(uri) {
        if (typeof this.props.stopShare === 'function') {
            this.props.stopShare(uri);
        }
    }

    onStopAll() {
        if (typeof this.props.stopAll === 'function') {
            this.props.stopAll();
        }
    }

    // Pause / Resume helpers. The parent passes a `getShareState(uri)`
    // function that returns 'active' | 'paused' | 'stopped' (read off
    // navBar.locationTimers[uri].paused) so we can label the toggle
    // button correctly without mirroring pause state into our own
    // state. The modal stays stateless apart from its 1 s tick.
    isPaused(uri) {
        if (typeof this.props.getShareState !== 'function') return false;
        try {
            return this.props.getShareState(uri) === 'paused';
        } catch (e) { return false; }
    }

    onPauseOne(uri) {
        if (typeof this.props.pauseShare === 'function') {
            this.props.pauseShare(uri);
        }
        // Dismiss after pause/resume so the user gets immediate
        // visual confirmation (the chat-header pin stops/starts
        // pulsing, the bubble's pause overlay appears, etc.) instead
        // of being blocked by the still-open modal. Stop intentionally
        // does NOT dismiss — for multi-share users it keeps the modal
        // open so they can stop the next one without re-navigating.
        if (typeof this.props.close === 'function') this.props.close();
    }

    onResumeOne(uri) {
        if (typeof this.props.resumeShare === 'function') {
            this.props.resumeShare(uri);
        }
        if (typeof this.props.close === 'function') this.props.close();
    }

    onCancel() {
        this.props.close();
    }

    render() {
        const shares = this.props.activeShares || {};
        // When `filterUri` is set, narrow the list to just that peer's
        // share. Used by the ReadyBox map-marker "pin" button, which
        // always opens this modal scoped to the current chat. If the
        // filter URI isn't in the active set we render as empty so the
        // user sees the "not sharing with anyone" copy.
        let uris;
        if (this.props.filterUri) {
            uris = shares[this.props.filterUri] !== undefined
                ? [this.props.filterUri]
                : [];
        } else {
            uris = Object.keys(shares);
        }

        return (
            <Modal
                style={containerStyles.container}
                visible={!!this.props.show}
                transparent
                animationType="fade"
                onRequestClose={this.onCancel}
            >
                <TouchableWithoutFeedback onPress={this.onCancel}>
                    <View style={containerStyles.overlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                        >
                            {/* Block dismiss when the tap is inside the card. */}
                            <TouchableWithoutFeedback onPress={() => {}}>
                                <Surface style={containerStyles.modalSurface}>
                                    <Text style={containerStyles.title}>
                                        Active location shares
                                    </Text>

                                    {uris.length === 1 ? (
                                        /* Single-session shortcut. With exactly
                                           one active share there's no list to
                                           navigate — a full row + separate
                                           Stop button is needless ceremony.
                                           Show a short prompt that names the
                                           contact and pair it with a single
                                           "Stop sharing" primary button.
                                           The 0-share case is intentionally not
                                           rendered here: the NavBar indicator
                                           is only drawn while a share is
                                           active, and the ReadyBox pin button
                                           falls through to the share picker
                                           when nothing is live — so this modal
                                           can only be opened with at least one
                                           URI.

                                           Layout note: prompt and time-left
                                           are rendered as two sibling Texts
                                           inside a center-aligned View. A
                                           previous version used a single
                                           parent Text with a `\n` + inline
                                           small-font child, which on Android
                                           caused the second line to hug the
                                           previous line's baseline rather
                                           than re-center itself. Two Texts
                                           in a column give both lines their
                                           own centered block. */
                                        <View style={{ alignItems: 'center', paddingTop: 4, paddingBottom: 4 }}>
                                            <Text style={styles.body}>
                                                Stop sharing your location with {this.displayFor(uris[0])}?
                                            </Text>
                                            <Text style={{ fontSize: 12, opacity: 0.7, textAlign: 'center', paddingTop: 2 }}>
                                                {this.formatTimeLeft(shares[uris[0]])}
                                            </Text>
                                        </View>
                                    ) : (
                                        <View>
                                            <ScrollView
                                                style={{ maxHeight: 260, marginHorizontal: 8 }}
                                                keyboardShouldPersistTaps="handled"
                                            >
                                                {uris.map((uri, idx) => {
                                                    const _paused = this.isPaused(uri);
                                                    return (
                                                    <View key={uri}>
                                                        {idx > 0 ? <Divider /> : null}
                                                        <View style={{
                                                            flexDirection: 'row',
                                                            alignItems: 'center',
                                                            paddingVertical: 6,
                                                            paddingHorizontal: 4,
                                                        }}>
                                                            <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                                                                <Text numberOfLines={1} style={{ fontSize: 15 }}>
                                                                    {this.displayFor(uri)}
                                                                    {_paused ? '  • paused' : ''}
                                                                </Text>
                                                                <Text
                                                                    numberOfLines={1}
                                                                    style={{ fontSize: 12, opacity: 0.7 }}
                                                                >
                                                                    {this.formatTimeLeft(shares[uri])}
                                                                </Text>
                                                            </View>
                                                            {/* Pause / Resume sits before Stop so the
                                                                destructive action stays the rightmost
                                                                button on each row — matches the
                                                                "less destructive on the left"
                                                                convention from other modals. */}
                                                            <IconButton
                                                                icon={_paused ? 'play' : 'pause'}
                                                                size={22}
                                                                onPress={() => _paused
                                                                    ? this.onResumeOne(uri)
                                                                    : this.onPauseOne(uri)}
                                                                accessibilityLabel={`${_paused ? 'Resume' : 'Pause'} sharing location with ${this.displayFor(uri)}`}
                                                            />
                                                            <Button
                                                                mode="outlined"
                                                                compact
                                                                icon="map-marker-off"
                                                                onPress={() => this.onStopOne(uri)}
                                                                accessibilityLabel={`Stop sharing location with ${this.displayFor(uri)}`}
                                                            >
                                                                Stop
                                                            </Button>
                                                        </View>
                                                    </View>
                                                    );
                                                })}
                                            </ScrollView>
                                        </View>
                                    )}

                                    <View style={[styles.buttonRow, { marginTop: 8, marginBottom: 12 }]}>
                                        {/* Cancel/Close button removed —
                                            the modal already dismisses on
                                            backdrop tap (TouchableWithoutFeedback
                                            wrapping the overlay) and on
                                            Android back (onRequestClose),
                                            and dropping it lets the
                                            remaining Pause/Resume + Stop
                                            buttons grow to a comfortable
                                            tap target without overflowing
                                            the modal surface on narrow
                                            phones. */}
                                        {/* Pause / Resume primary action paired
                                            with the existing Stop sharing
                                            button when there's exactly one
                                            share. Mirrors the per-row controls
                                            in the multi-share branch above —
                                            three-button row (Cancel | toggle |
                                            Stop) so the user can pause without
                                            committing to Stop. */}
                                        {uris.length === 1 ? (
                                            <Button
                                                mode="outlined"
                                                style={styles.button}
                                                icon={this.isPaused(uris[0]) ? 'play' : 'pause'}
                                                onPress={() => this.isPaused(uris[0])
                                                    ? this.onResumeOne(uris[0])
                                                    : this.onPauseOne(uris[0])}
                                                accessibilityLabel={`${this.isPaused(uris[0]) ? 'Resume' : 'Pause'} sharing location with ${this.displayFor(uris[0])}`}
                                            >
                                                {this.isPaused(uris[0]) ? 'Resume' : 'Pause'}
                                            </Button>
                                        ) : null}
                                        {/* One-shot Stop when there's a single
                                            share — no need to tap a row's Stop
                                            first. Pair with Cancel above. */}
                                        {uris.length === 1 ? (
                                            <Button
                                                mode="contained"
                                                style={styles.button}
                                                icon="map-marker-off"
                                                onPress={() => this.onStopOne(uris[0])}
                                                accessibilityLabel={`Stop sharing location with ${this.displayFor(uris[0])}`}
                                            >
                                                {/* Shortened from "Stop sharing"
                                                    to "Stop" so the three-button
                                                    row (Cancel | Pause/Resume |
                                                    Stop) fits inside the modal
                                                    surface on the narrowest
                                                    Android phones we ship to.
                                                    accessibilityLabel above
                                                    keeps the screen-reader
                                                    affordance unambiguous. */}
                                                Stop
                                            </Button>
                                        ) : null}
                                        {uris.length > 1 ? (
                                            <Button
                                                mode="contained"
                                                style={styles.button}
                                                icon="map-marker-off"
                                                onPress={this.onStopAll}
                                                accessibilityLabel="Stop all location shares"
                                            >
                                                Stop all
                                            </Button>
                                        ) : null}
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

ActiveLocationSharesModal.propTypes = {
    show          : PropTypes.bool,
    close         : PropTypes.func.isRequired,
    // { [uri]: expiresAtMs }  — the URI identifies the peer, the value is
    // the Date.now()-style timestamp when the share auto-ends.
    activeShares  : PropTypes.object,
    stopShare     : PropTypes.func.isRequired,
    stopAll       : PropTypes.func,
    // Pause / Resume per share. Optional — when both are missing the
    // toggle button still renders but onPress is a noop (the parent
    // simply hasn't wired the bridges yet). getShareState returns
    // 'active' | 'paused' | 'stopped' so the modal can label the
    // toggle correctly without mirroring pause state into its own
    // state.
    pauseShare    : PropTypes.func,
    resumeShare   : PropTypes.func,
    getShareState : PropTypes.func,
    allContacts   : PropTypes.array,
    // Optional. When provided, the modal renders only the share
    // targeting this URI (if any). Lets the ReadyBox "pin" button
    // open this same dialog scoped to the current chat rather than
    // showing every active share on the device.
    filterUri     : PropTypes.string,
};

export default ActiveLocationSharesModal;
