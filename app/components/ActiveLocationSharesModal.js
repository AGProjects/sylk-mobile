import React, { Component } from 'react';
import ThemedModalSurface from './ThemedModalSurface';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import {
    Modal,
    View,
    TouchableWithoutFeedback,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    Dimensions,
} from 'react-native';
import { Text, Button, Surface, IconButton, Divider } from 'react-native-paper';

// Same visual frame as ShareLocationModal / EditContactModal — white
// rounded Surface over a dimmed overlay. Colour-less borders so the list
// sits flat inside the dialog.
import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/blink/_DeleteMessageModal.scss';

// Renders one row per active live-location SESSION and lets the user stop /
// pause individual sessions or stop them all at once.
//
// A contact can now have MORE THAN ONE session live at the same time — a
// meet ("Until we meet") AND a plain timed share — so the modal is keyed by
// session, not by peer URI, and every row shows its session TYPE (Meet-up vs
// Sharing). Incoming shares (peer → me) are intentionally NOT listed and are
// therefore never stoppable here.
//
// The actual timer bookkeeping stays in the engine — we just call the
// `stopShare(row)` / `stopAll()` / `pauseShare(row)` callbacks the parent
// passed in, each carrying the row's `sessionId` + `type` so the exact
// session is targeted. That keeps this modal stateless (apart from its 1 s
// tick) and openable from anywhere in the UI.
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

    // Human label for a session type. 'meet' → "Meet-up", anything else
    // ('share') → "Sharing". Shown on every row so a contact's two sessions
    // are told apart at a glance.
    typeLabel(row) {
        return (row && row.type === 'meet') ? 'Meet-up' : 'Sharing';
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

    // The live session rows. Prefer the LIVE getter (called at our own render
    // time — we tick once a second, so this always reflects current truth)
    // over the snapshot prop. Falls back to deriving rows from the legacy
    // {uri: expiresAt} map if only that was wired.
    rows() {
        let rows = [];
        if (typeof this.props.getRows === 'function') {
            rows = this.props.getRows() || [];
        } else if (Array.isArray(this.props.rows)) {
            rows = this.props.rows;
        } else if (this.props.activeShares && typeof this.props.activeShares === 'object') {
            // Legacy fallback: one 'share' row per uri.
            rows = Object.keys(this.props.activeShares).map((uri) => ({
                uri,
                sessionId: uri,
                type: 'share',
                expiresAt: this.props.activeShares[uri],
                owned: true,
                paused: false,
            }));
        }
        // Scope to one contact when asked (ReadyBox pin / contact-menu entry).
        if (this.props.filterUri) {
            rows = rows.filter((r) => r && r.uri === this.props.filterUri);
        }
        return rows;
    }

    onStopOne(row) {
        if (typeof this.props.stopShare === 'function') {
            this.props.stopShare(row);
        }
    }

    onStopAll() {
        if (typeof this.props.stopAll === 'function') {
            this.props.stopAll();
        }
    }

    // Pause / Resume helpers. The parent's getShareState(row) returns
    // 'active' | 'paused' | 'stopped' so we can label the toggle without
    // mirroring pause state into our own state.
    isPaused(row) {
        // Prefer the row's own paused flag; fall back to the getter.
        if (row && typeof row.paused === 'boolean') return row.paused;
        if (typeof this.props.getShareState !== 'function') return false;
        try {
            return this.props.getShareState(row) === 'paused';
        } catch (e) { return false; }
    }

    // Only a session THIS device broadcasts (owned) may be paused/stopped from
    // here. A mirrored session can be stopped (relayed) but not paused; an
    // incoming session isn't listed at all. Defaults to true when the parent
    // doesn't wire the check.
    ownsShare(row) {
        if (row && typeof row.owned === 'boolean') return row.owned;
        if (typeof this.props.isShareOwned !== 'function') return true;
        try { return !!this.props.isShareOwned(row); } catch (e) { return false; }
    }

    onPauseOne(row) {
        if (typeof this.props.pauseShare === 'function') {
            this.props.pauseShare(row);
        }
        // Dismiss after pause/resume so the user gets immediate visual
        // confirmation (the chat-header pin stops/starts pulsing, etc.)
        // instead of being blocked by the still-open modal. Stop
        // intentionally does NOT dismiss — for multi-session users it keeps
        // the modal open so they can stop the next one.
        if (typeof this.props.close === 'function') this.props.close();
    }

    onResumeOne(row) {
        if (typeof this.props.resumeShare === 'function') {
            this.props.resumeShare(row);
        }
        if (typeof this.props.close === 'function') this.props.close();
    }

    onCancel() {
        this.props.close();
    }

    render() {
        const rows = this.rows();

        // Orientation-agnostic sizing: cap the list relative to the current
        // window and centre/limit the card width so it doesn't stretch
        // edge-to-edge in landscape.
        const _winH = Dimensions.get('window').height;
        const _winW = Dimensions.get('window').width;
        const _isLandscape = _winW > _winH;
        const _listMaxHeight = _isLandscape
            ? Math.max(120, Math.floor(_winH * 0.45))
            : Math.min(260, Math.floor(_winH * 0.45));
        const _surfaceExtra = _isLandscape ? { alignSelf: 'center', width: Math.min(560, _winW * 0.85) } : null;

        const _single = rows.length === 1 ? rows[0] : null;

        return (
            <Modal
                style={containerStyles.container}
                visible={!!this.props.show}
                transparent
                animationType="fade"
                onRequestClose={this.onCancel}
                supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
            >
                <TouchableWithoutFeedback onPress={this.onCancel}>
                    <View style={containerStyles.overlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                        >
                            {/* Block dismiss when the tap is inside the card. */}
                            <TouchableWithoutFeedback onPress={() => {}}>
                                <ThemedModalSurface style={[containerStyles.modalSurface, _surfaceExtra]}>
                                    <Text style={containerStyles.title}>
                                        Location sessions
                                    </Text>

                                    {_single ? (
                                        /* Single-session shortcut. With exactly one
                                           session there's no list to navigate — show
                                           a short prompt that names the contact + the
                                           session type and pair it with a single
                                           Stop primary button (plus Pause/Resume when
                                           we own it). */
                                        <View style={{ alignItems: 'center', paddingTop: 4, paddingBottom: 4 }}>
                                            <Text style={styles.body}>
                                                {this.typeLabel(_single)} with {this.displayFor(_single.uri)}
                                                {this.isPaused(_single) ? '  • paused' : ''}
                                            </Text>
                                            <Text style={{ fontSize: 12, opacity: 0.7, textAlign: 'center', paddingTop: 2 }}>
                                                {this.formatTimeLeft(_single.expiresAt)}
                                            </Text>
                                        </View>
                                    ) : (
                                        <View>
                                            <ScrollView
                                                style={{ maxHeight: _listMaxHeight, marginHorizontal: 8 }}
                                                keyboardShouldPersistTaps="handled"
                                            >
                                                {rows.map((row, idx) => {
                                                    const _paused = this.isPaused(row);
                                                    const _owned = this.ownsShare(row);
                                                    return (
                                                    <View key={row.sessionId || (row.uri + ':' + idx)}>
                                                        {idx > 0 ? <Divider /> : null}
                                                        <View style={{
                                                            flexDirection: 'row',
                                                            alignItems: 'center',
                                                            paddingVertical: 6,
                                                            paddingHorizontal: 4,
                                                        }}>
                                                            <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                                                                <Text numberOfLines={1} style={{ fontSize: 15 }}>
                                                                    {this.displayFor(row.uri)}
                                                                    {'  ·  '}{this.typeLabel(row)}
                                                                    {_paused ? '  • paused' : ''}
                                                                </Text>
                                                                <Text
                                                                    numberOfLines={1}
                                                                    style={{ fontSize: 12, opacity: 0.7 }}
                                                                >
                                                                    {this.formatTimeLeft(row.expiresAt)}
                                                                </Text>
                                                            </View>
                                                            {/* Pause / Resume sits before Stop so the
                                                                destructive action stays the rightmost
                                                                button. Only shown for sessions we own. */}
                                                            {_owned && (
                                                            <IconButton
                                                                icon={_paused ? 'play' : 'pause'}
                                                                size={22}
                                                                onPress={() => _paused
                                                                    ? this.onResumeOne(row)
                                                                    : this.onPauseOne(row)}
                                                                accessibilityLabel={`${_paused ? 'Resume' : 'Pause'} ${this.typeLabel(row)} with ${this.displayFor(row.uri)}`}
                                                            />
                                                            )}
                                                            <Button
                                                                mode="outlined"
                                                                compact
                                                                icon="map-marker-off"
                                                                onPress={() => this.onStopOne(row)}
                                                                accessibilityLabel={`Stop ${this.typeLabel(row)} with ${this.displayFor(row.uri)}`}
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
                                        {/* Cancel/Close removed — the modal dismisses
                                            on backdrop tap and Android back. */}
                                        {_single && this.ownsShare(_single) ? (
                                            <Button
                                                mode="outlined"
                                                style={styles.button}
                                                icon={this.isPaused(_single) ? 'play' : 'pause'}
                                                onPress={() => this.isPaused(_single)
                                                    ? this.onResumeOne(_single)
                                                    : this.onPauseOne(_single)}
                                                accessibilityLabel={`${this.isPaused(_single) ? 'Resume' : 'Pause'} ${this.typeLabel(_single)} with ${this.displayFor(_single.uri)}`}
                                            >
                                                {this.isPaused(_single) ? 'Resume' : 'Pause'}
                                            </Button>
                                        ) : null}
                                        {_single ? (
                                            <Button
                                                mode="contained"
                                                style={styles.button}
                                                icon="map-marker-off"
                                                onPress={() => this.onStopOne(_single)}
                                                accessibilityLabel={`Stop ${this.typeLabel(_single)} with ${this.displayFor(_single.uri)}`}
                                            >
                                                Stop
                                            </Button>
                                        ) : null}
                                        {rows.length > 1 ? (
                                            <Button
                                                mode="contained"
                                                style={styles.button}
                                                icon="map-marker-off"
                                                onPress={this.onStopAll}
                                                accessibilityLabel="Stop all location sessions"
                                            >
                                                Stop all
                                            </Button>
                                        ) : null}
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

ActiveLocationSharesModal.propTypes = {
    show          : PropTypes.bool,
    close         : PropTypes.func.isRequired,
    // Per-session rows: [{uri, sessionId, type:'meet'|'share', expiresAt,
    // owned, paused}]. Prefer the live getter; `rows` is the first-paint
    // snapshot fallback.
    getRows       : PropTypes.func,
    rows          : PropTypes.array,
    // Legacy {uri: expiresAtMs} snapshot — used only to derive rows when the
    // per-session props aren't wired.
    activeShares  : PropTypes.object,
    // All callbacks receive the ROW (which carries sessionId + type) so the
    // exact session is targeted.
    stopShare     : PropTypes.func.isRequired,
    stopAll       : PropTypes.func,
    pauseShare    : PropTypes.func,
    resumeShare   : PropTypes.func,
    getShareState : PropTypes.func,
    isShareOwned  : PropTypes.func,
    allContacts   : PropTypes.array,
    // When set, the modal renders only sessions targeting this URI (may be
    // more than one row — a meet and a plain share).
    filterUri     : PropTypes.string,
};

export default ActiveLocationSharesModal;
