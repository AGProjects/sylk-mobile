import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import {
    View,
    Platform,
    Text,
    Modal,
    TouchableWithoutFeedback,
    KeyboardAvoidingView,
    Linking,
    StyleSheet,
    Pressable,
    Clipboard,
} from 'react-native';
import { Button, Surface, ActivityIndicator, IconButton } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Share the same Modal + Surface shell the other dialogs use, so the
// rounded-corner card and dimmed backdrop match EditContactModal and
// DeleteHistoryModal.
import containerStyles from '../assets/styles/ContainerStyles';

const styles = StyleSheet.create({
    title: {
        padding: 0,
        fontSize: 24,
        textAlign: 'center',
    },
    body: {
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: 6,
        fontSize: 16,
        textAlign: 'center',
    },
    bullet: {
        paddingHorizontal: 28,
        paddingVertical: 2,
        fontSize: 14,
        textAlign: 'left',
    },
    warning: {
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 12,
        fontSize: 14,
        textAlign: 'center',
        color: '#a00',
    },
    button: {
        margin: 10,
    },
    buttonRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        paddingBottom: 8,
    },
    // ── Chooser-screen styles ────────────────────────────────────
    chooserIntro: {
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: 14,
        fontSize: 15,
        textAlign: 'center',
        color: '#444',
    },
    choiceCard: {
        marginHorizontal: 16,
        marginVertical: 6,
        padding: 14,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#d0d0d0',
        backgroundColor: '#fafafa',
        flexDirection: 'row',
        alignItems: 'center',
    },
    choiceCardPressed: {
        backgroundColor: '#eee',
    },
    choiceIcon: {
        marginRight: 12,
    },
    choiceTextWrap: {
        flex: 1,
    },
    choiceTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: '#222',
        marginBottom: 2,
    },
    choiceDescription: {
        fontSize: 12,
        color: '#666',
        lineHeight: 16,
    },
    backRow: {
        paddingTop: 6,
        paddingBottom: 4,
        paddingLeft: 14,
        flexDirection: 'row',
        alignItems: 'center',
    },
    backText: {
        marginLeft: 4,
        color: '#1976d2',
        fontSize: 14,
    },
});

/**
 * Two-mode destructive confirmation dialog.
 *
 * Flow:
 *   1. Chooser screen — user picks "Delete on device" OR
 *      "Delete on server" (each card carries its own description).
 *   2. Confirmation screen — full bullet list + warning; the
 *      destructive button arms on first tap, commits on second
 *      (the existing double-confirm pattern). "← Back" returns to
 *      the chooser.
 *   3. On commit, the modal closes via close() (device path) or
 *      shows a follow-up alert reporting the confirmation email
 *      address (server path).
 */
class DeleteAccountModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            mode: 'choose',           // 'choose' | 'device' | 'server'
            confirm: false,           // armed flag for double-confirm
            serverInFlight: false,    // network call in flight
            serverError: null,        // last server-error message
            serverEmail: null,        // email the confirmation went to
            clientRequestId: null,    // client_request_id echoed by the OK response
            requestIdCopied: false,   // brief green check after Copy (success screen)
            pendingIdCopied: false,   // brief green check after Copy (pending banner)
            abortArmed: false,        // armed flag for Abort double-confirm
            abortInFlight: false,     // abort POST in flight
            abortError: null,         // last abort error message
            nowTick: Date.now(),      // re-render driver for the countdown
            serverInFlightRefresh: false, // refreshAccountInfo in flight from pickServer
        };
    }

    componentWillUnmount() {
        this._stopCountdown();
    }

    _startCountdown() {
        if (this._countdownInterval) return;
        // 30 s tick — granular enough that the "5 hours remaining"
        // line updates within a minute of crossing each hour. Faster
        // ticks would burn battery without any visible benefit.
        this._countdownInterval = setInterval(() => {
            if (this.props.show) {
                this.setState({ nowTick: Date.now() });
            }
        }, 30 * 1000);
    }

    _stopCountdown() {
        if (!this._countdownInterval) return;
        clearInterval(this._countdownInterval);
        this._countdownInterval = null;
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        // Reset state whenever the modal opens so we never start
        // already-armed or already-on-the-server-tab from a previous
        // session.
        if (nextProps.show && !this.props.show) {
            this.setState({
                mode: 'choose',
                confirm: false,
                serverInFlight: false,
                serverError: null,
                serverEmail: null,
                clientRequestId: null,
                requestIdCopied: false,
                pendingIdCopied: false,
                abortArmed: false,
                abortInFlight: false,
                abortError: null,
                nowTick: Date.now(),
                serverInFlightRefresh: false,
            });
            if (nextProps.pendingDeleteRequest) {
                this._startCountdown();
            }
            // Dump the props the modal will render with — the full
            // set of decision inputs (which paths are offered, the
            // identity the user is about to delete, where the
            // confirmation will be sent) in one line so debugging
            // "why doesn't my server-delete button show?" or "why
            // is the email going to the wrong address?" doesn't
            // require chasing state through multiple components.
            console.log('[delete-account] modal opening',
                JSON.stringify({
                    accountId:                     nextProps.accountId || null,
                    allowDelete:                   nextProps.allowDelete === true,
                    hasRequestServerDeleteAccount: typeof nextProps.requestServerDeleteAccount === 'function',
                    hasAbortServerDeleteAccount:   typeof nextProps.abortServerDeleteAccount === 'function',
                    hasPendingDeleteRequest:       !!nextProps.pendingDeleteRequest,
                    deleteAccountUrl:              nextProps.deleteAccountUrl || null,
                })
            );
        } else if (!nextProps.show && this.props.show) {
            this._stopCountdown();
        } else if (nextProps.pendingDeleteRequest && !this.props.pendingDeleteRequest) {
            // Pending request just appeared (snapshot landed after
            // open). Start the countdown so the remaining-time line
            // refreshes.
            this._startCountdown();
        } else if (!nextProps.pendingDeleteRequest && this.props.pendingDeleteRequest) {
            // Request cleared (abort or click-through landed) —
            // stop ticking.
            this._stopCountdown();
        }
    }

    handleCancel() {
        this.setState({ mode: 'choose', confirm: false });
        this.props.close();
    }

    pickDevice() {
        this.setState({ mode: 'device', confirm: false });
    }

    pickServer() {
        // Refresh the account snapshot BEFORE rendering the
        // server-confirm screen. The user may be behind: a delete
        // request might have been issued from the web Identity
        // tab or another device since the last snapshot landed.
        // The server-confirm screen reads pendingDeleteRequest
        // (= accountInfo.delete_request) to decide between
        // showing Continue (Request deletion) or Abort, so it
        // needs the freshest possible value.
        //
        // refreshAccountInfo is fire-and-forget here — we set
        // `serverInFlightRefresh` so renderServerConfirm shows a
        // spinner until the prop transition lands.
        this.setState({
            mode: 'server',
            confirm: false,
            serverError: null,
            serverEmail: null,
            serverInFlightRefresh: true,
            abortArmed: false,
            abortError: null,
        });
        if (typeof this.props.refreshAccountInfo === 'function') {
            console.log('[delete-account] pickServer — refreshing snapshot before branching');
            Promise.resolve(this.props.refreshAccountInfo({ force: true }))
                .catch((e) => {
                    console.log('[delete-account] pre-confirm refresh failed:',
                        (e && e.message) || e);
                })
                .then(() => {
                    if (this.props.show) {
                        this.setState({ serverInFlightRefresh: false });
                    }
                });
        } else {
            // No refresh handler wired — fall through without
            // gating; renderServerConfirm will use whatever
            // pendingDeleteRequest already holds.
            this.setState({ serverInFlightRefresh: false });
        }
    }

    goBackToChooser() {
        this.setState({ mode: 'choose', confirm: false });
    }

    // ── Device-side commit (local DB wipe + sign out) ────────────
    handleDeviceConfirm() {
        if (this.state.confirm) {
            this.setState({ confirm: false });
            this.props.onConfirm();
            this.props.close();
            return;
        }
        this.setState({ confirm: true });
    }

    // ── Server-side commit (email confirmation request) ──────────
    async handleServerConfirm() {
        if (!this.state.confirm) {
            this.setState({ confirm: true });
            return;
        }
        // Second press — fire the request.
        if (typeof this.props.requestServerDeleteAccount !== 'function') {
            // No API wired — fall back to the legacy URL if any.
            if (this.props.deleteAccountUrl) {
                Linking.openURL(this.props.deleteAccountUrl);
                this.props.close();
            }
            return;
        }
        this.setState({ serverInFlight: true, serverError: null });
        console.log('[delete-account] firing server request for',
            this.props.accountId || '(unknown)');
        try {
            const result = await this.props.requestServerDeleteAccount();
            const email           = (result && result.email)             || null;
            const clientRequestId = (result && result.client_request_id) || null;
            console.log('[delete-account] server accepted — confirmation email sent to',
                email || '(none)',
                '| client_request_id =', clientRequestId || '(none)',
                '| full response:', JSON.stringify(result || {}));
            // Stay in the modal and surface the success inline so
            // the user can read the email address without losing
            // context. We display the client_request_id (NOT the
            // server_request_id — that's the secret email-link
            // token and never leaves the server).
            this.setState({
                serverInFlight: false,
                serverEmail: email,
                clientRequestId: clientRequestId,
                confirm: false,
            });
        } catch (e) {
            console.log('[delete-account] server rejected:', (e && e.message) || e);
            this.setState({
                serverInFlight: false,
                serverError: (e && e.message) || 'Unknown error',
                confirm: false,
            });
        }
    }

    // ── Abort (cancel pending server delete) ─────────────────────
    async handleAbortConfirm() {
        if (!this.state.abortArmed) {
            this.setState({ abortArmed: true, abortError: null });
            return;
        }
        if (typeof this.props.abortServerDeleteAccount !== 'function') {
            this.setState({
                abortArmed: false,
                abortError: 'Abort not supported on this server.',
            });
            return;
        }
        this.setState({ abortInFlight: true, abortError: null });
        console.log('[delete-account] firing abort for',
            this.props.accountId || '(unknown)');
        try {
            const result = await this.props.abortServerDeleteAccount();
            console.log('[delete-account] abort accepted',
                '| full response:', JSON.stringify(result || {}));
            // _stopCountdown fires from componentWillReceiveProps
            // when pendingDeleteRequest flips to null (after the
            // refresh that abort triggered lands).
            // After abort succeeds the pending state is cleared —
            // bounce back to the chooser so the user starts from
            // the top instead of seeing the server-confirm screen
            // briefly flip to the Continue UI. Anyone who actually
            // wants to issue a new request taps Delete account on
            // server again, which will re-fetch the snapshot and
            // route to the Continue branch.
            this.setState({
                abortArmed: false,
                abortInFlight: false,
                mode: 'choose',
                confirm: false,
                serverError: null,
            });
        } catch (e) {
            console.log('[delete-account] abort rejected:',
                (e && e.message) || e);
            this.setState({
                abortInFlight: false,
                abortArmed: false,
                abortError: (e && e.message) || 'Unknown error',
            });
        }
    }

    // Hours remaining until the server's expire_date. Returns null
    // when we can't parse the timestamp — caller falls back to a
    // generic "within 2 days" string. The expire_date format on
    // the server is "YYYY-MM-DD HH:MM:SS" (local server tz). We
    // parse permissively so a future ISO-8601 switch is harmless.
    _hoursRemaining(expireDate) {
        if (!expireDate || typeof expireDate !== 'string') return null;
        // "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS" so the JS
        // Date parser doesn't reject it. Already-ISO inputs pass
        // through unchanged.
        const norm = expireDate.indexOf('T') > -1
            ? expireDate
            : expireDate.replace(' ', 'T');
        const t = new Date(norm).getTime();
        if (!isFinite(t)) return null;
        const diffMs = t - this.state.nowTick;
        if (diffMs <= 0) return 0;
        return Math.ceil(diffMs / (60 * 60 * 1000));
    }

    // ── Renderers ────────────────────────────────────────────────
    renderPendingBanner() {
        const p = this.props.pendingDeleteRequest || {};
        const hours = this._hoursRemaining(p.expire_date);
        const armed = this.state.abortArmed;
        const inFlight = this.state.abortInFlight;
        // Remaining-time copy. We show hours up to 48 (the 2-day
        // server-side window); under 1 h becomes "less than 1 hour"
        // so the line reads naturally.
        let remaining;
        if (hours === null) {
            remaining = 'within the confirmation window';
        } else if (hours <= 0) {
            remaining = 'soon — the window may have already expired';
        } else if (hours === 1) {
            remaining = 'in less than 1 hour';
        } else {
            remaining = `in the next ${hours} hour${hours === 1 ? '' : 's'}`;
        }
        return (
            <View style={{
                marginHorizontal: 0,
                marginTop: 10,
                marginBottom: 6,
                padding: 12,
                borderWidth: 1,
                borderColor: '#fbeed5',
                backgroundColor: '#fcf8e3',
                borderRadius: 6,
            }}>
                <Text style={{ fontWeight: 'bold', color: '#8a6d3b', marginBottom: 4 }}>
                    Delete request pending
                </Text>
                <Text style={{ color: '#8a6d3b', fontSize: 13, lineHeight: 18 }}>
                    You must confirm by clicking the link sent to{' '}
                    <Text style={{ fontWeight: 'bold' }}>
                        {p.requester_entity && p.requester_entity.email
                            ? p.requester_entity.email
                            : (this.props.accountId || 'your email')}
                    </Text>{' '}
                    {remaining}.
                </Text>
                {p.client_request_id ? (
                    <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginTop: 8,
                        paddingHorizontal: 8,
                        paddingVertical: 6,
                        borderWidth: 1,
                        borderColor: '#e8d9a8',
                        backgroundColor: '#fffbed',
                        borderRadius: 4,
                    }}>
                        <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 11, color: '#8a6d3b', marginBottom: 2 }}>
                                Request ID
                            </Text>
                            <Text
                                style={{
                                    fontSize: 12,
                                    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                                    color: '#5c4a1f',
                                }}
                                selectable
                                numberOfLines={1}
                                ellipsizeMode="middle"
                            >
                                {p.client_request_id}
                            </Text>
                        </View>
                        <IconButton
                            icon="content-copy"
                            size={20}
                            color="#8a6d3b"
                            onPress={() => {
                                try {
                                    Clipboard.setString(p.client_request_id);
                                    this.setState({ pendingIdCopied: true });
                                    setTimeout(() => {
                                        if (this.props.show) {
                                            this.setState({ pendingIdCopied: false });
                                        }
                                    }, 2000);
                                } catch (e) {
                                    console.log('[delete-account] pending-id copy failed:',
                                        (e && e.message) || e);
                                }
                            }}
                            accessibilityLabel="Copy request ID"
                        />
                        {this.state.pendingIdCopied ? (
                            <Icon
                                name="check-circle"
                                size={18}
                                color="#388e3c"
                                style={{ marginLeft: 2 }}
                            />
                        ) : null}
                    </View>
                ) : null}
                {this.state.abortError ? (
                    <Text style={{ color: '#b22', fontSize: 12, marginTop: 6 }}>
                        {this.state.abortError}
                    </Text>
                ) : null}
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 }}>
                    {inFlight ? (
                        <ActivityIndicator size="small" color="#8a6d3b" />
                    ) : (
                        <Button
                            mode={armed ? 'contained' : 'outlined'}
                            compact
                            uppercase={false}
                            icon="close-circle"
                            onPress={this.handleAbortConfirm}
                            style={armed ? { backgroundColor: '#c62828' } : null}
                            accessibilityLabel={armed ? 'Confirm abort' : 'Abort request'}
                        >
                            {armed ? 'Confirm abort' : 'Abort request'}
                        </Button>
                    )}
                </View>
            </View>
        );
    }

    renderChooser() {
        // The server-delete card behaviour depends on three inputs:
        //   • allowDelete prop — flipped by the server snapshot
        //     when email is set, balance is clean, and the account
        //     isn't in deny-account-delete. When true the in-app
        //     JSON-API flow is offered.
        //   • deleteAccountUrl prop — legacy web URL used as a
        //     fallback when the in-app flow isn't available.
        //   • requestServerDeleteAccount prop — must be wired for
        //     the in-app flow to actually fire. Without it we
        //     degrade to the URL fallback even if allowDelete=true,
        //     since the action wouldn't have anywhere to call.
        const allowDelete = !!this.props.allowDelete
            && typeof this.props.requestServerDeleteAccount === 'function';
        // When the latest snapshot shows a pending server-side
        // delete request (issued from this device, another device,
        // or the web Identity tab), the chooser surfaces the
        // Abort UI directly inside the server-delete card. The
        // card itself is disabled — the user can't start a NEW
        // request while one is in flight — but the Abort button
        // works normally because it has its own onPress.
        const hasPending = !!this.props.pendingDeleteRequest;
        return (
            <>
                <Text style={[containerStyles.title, styles.title]}>
                    Delete account
                </Text>
                <Text style={styles.chooserIntro}>
                    Choose where to delete the account from.
                </Text>

                <Pressable
                    onPress={this.pickDevice}
                    style={({ pressed }) => [
                        styles.choiceCard,
                        pressed && styles.choiceCardPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Delete account on device"
                >
                    <Icon name="cellphone-remove" size={28} color="#c62828" style={styles.choiceIcon} />
                    <View style={styles.choiceTextWrap}>
                        <Text style={styles.choiceTitle}>Delete account on device</Text>
                        <Text style={styles.choiceDescription}>
                            Removes messages, contacts, PGP key, and cached files for this account from this device. Your server account is untouched.
                        </Text>
                    </View>
                </Pressable>

                {/* Server-delete card. When hasPending is true the
                    pending-banner is rendered INSIDE the card so
                    the user sees the abort affordance the moment
                    the chooser opens — no need to tap into the
                    server-confirm screen first. The outer
                    Pressable is `disabled` in that state so the
                    user can't navigate to start a new request;
                    only the Abort button inside is reachable. */}
                {allowDelete ? (
                    <Pressable
                        onPress={hasPending ? null : this.pickServer}
                        disabled={hasPending}
                        style={({ pressed }) => [
                            styles.choiceCard,
                            pressed && !hasPending && styles.choiceCardPressed,
                            hasPending && { flexDirection: 'column', alignItems: 'stretch' },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Delete account on server"
                        accessibilityState={{ disabled: hasPending }}
                    >
                        {/* Header row — dimmed when pending so it
                            visually reads as "this control is
                            blocked". The nested banner below stays
                            at full opacity so the countdown / IDs
                            / Abort button remain legible. */}
                        <View style={{ flexDirection: 'row', opacity: hasPending ? 0.55 : 1 }}>
                            <Icon name="server-remove" size={28} color="#c62828" style={styles.choiceIcon} />
                            <View style={styles.choiceTextWrap}>
                                <Text style={styles.choiceTitle}>Delete account on server</Text>
                                <Text style={styles.choiceDescription}>
                                    {hasPending
                                        ? 'A delete request is pending — abort it below or click the email link to confirm.'
                                        : 'Permanently removes the SIP account from the server. A confirmation email is sent to the address on file; click the link within 2 days to finalize.'}
                                </Text>
                            </View>
                        </View>
                        {hasPending ? this.renderPendingBanner() : null}
                    </Pressable>
                ) : this.props.deleteAccountUrl ? (
                    <Pressable
                        onPress={() => {
                            Linking.openURL(this.props.deleteAccountUrl);
                            this.handleCancel();
                        }}
                        style={({ pressed }) => [
                            styles.choiceCard,
                            pressed && styles.choiceCardPressed,
                        ]}
                        accessibilityRole="link"
                        accessibilityLabel="Delete account on server (opens browser)"
                    >
                        <Icon name="open-in-new" size={28} color="#c62828" style={styles.choiceIcon} />
                        <View style={styles.choiceTextWrap}>
                            <Text style={styles.choiceTitle}>Delete account on server</Text>
                            <Text style={styles.choiceDescription}>
                                Opens the server's account page in your browser. Sign in there to request deletion.
                            </Text>
                        </View>
                    </Pressable>
                ) : null}

                <View style={styles.buttonRow}>
                    <Button
                        mode="outlined"
                        style={styles.button}
                        onPress={this.handleCancel}
                        accessibilityLabel="Cancel"
                    >
                        Cancel
                    </Button>
                </View>
            </>
        );
    }

    renderDeviceConfirm() {
        const accountId = this.props.accountId || '';
        const label = this.state.confirm ? 'Confirm delete' : 'Delete from device';
        return (
            <>
                <View style={styles.backRow}>
                    <Pressable onPress={this.goBackToChooser} accessibilityLabel="Back">
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Icon name="chevron-left" size={22} color="#1976d2" />
                            <Text style={styles.backText}>Back</Text>
                        </View>
                    </Pressable>
                </View>
                <Text style={[containerStyles.title, styles.title]}>
                    Delete on device
                </Text>
                <Text style={styles.body}>
                    You are about to permanently remove{'\n'}
                    <Text style={{ fontWeight: 'bold' }}>{accountId}</Text>{'\n'}
                    from this device.
                </Text>
                <Text style={styles.bullet}>• Your messages on this device will be deleted.</Text>
                <Text style={styles.bullet}>• Your local contacts for this account will be deleted.</Text>
                <Text style={styles.bullet}>• Your PGP private key on this device will be deleted.</Text>
                <Text style={styles.bullet}>• Cached files for this account will be deleted.</Text>
                <Text style={styles.warning}>
                    This cannot be undone. Messages stored on the server are not
                    affected and will re-sync if you sign in again.
                </Text>
                <View style={styles.buttonRow}>
                    <Button
                        mode="outlined"
                        style={styles.button}
                        onPress={this.handleCancel}
                        accessibilityLabel="Cancel"
                    >
                        Cancel
                    </Button>
                    <Button
                        mode="contained"
                        style={[styles.button, { backgroundColor: '#c62828' }]}
                        icon="delete"
                        onPress={this.handleDeviceConfirm}
                        accessibilityLabel={label}
                    >
                        {label}
                    </Button>
                </View>
            </>
        );
    }

    renderServerConfirm() {
        const accountId = this.props.accountId || '';
        const armed = this.state.confirm;
        const label = armed ? 'Confirm request' : 'Request deletion';

        // Post-success branch — server accepted, email is in the inbox.
        if (this.state.serverEmail) {
            // Display the CLIENT request ID — it's the only one
            // the API returns. server_request_id is the secret
            // URL token inside the confirmation email.
            const reqId = this.state.clientRequestId || '';
            return (
                <>
                    <Text style={[containerStyles.title, styles.title]}>
                        Delete account on server
                    </Text>
                    <Text style={styles.body}>
                        A confirmation email has been sent to{'\n'}
                        <Text style={{ fontWeight: 'bold' }}>{this.state.serverEmail}</Text>.{'\n\n'}
                        Click the link inside within 2 days to finalize the
                        removal of <Text style={{ fontWeight: 'bold' }}>{accountId}</Text>.
                    </Text>
                    {reqId ? (
                        <View style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginHorizontal: 20,
                            marginTop: 6,
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderWidth: 1,
                            borderColor: '#DDDDDD',
                            backgroundColor: '#F8F8F8',
                            borderRadius: 4,
                        }}>
                            <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 11, color: '#777', marginBottom: 2 }}>
                                    Request ID
                                </Text>
                                <Text
                                    style={{
                                        fontSize: 12,
                                        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                                        color: '#333',
                                    }}
                                    selectable
                                    numberOfLines={1}
                                    ellipsizeMode="middle"
                                >
                                    {reqId}
                                </Text>
                            </View>
                            <IconButton
                                icon="content-copy"
                                size={20}
                                onPress={() => {
                                    try {
                                        Clipboard.setString(reqId);
                                        // Surface a brief visual ack by
                                        // toggling state.requestIdCopied —
                                        // resets after 2 s. Renders a small
                                        // green check next to the ID.
                                        this.setState({ requestIdCopied: true });
                                        setTimeout(() => {
                                            if (this.props.show) {
                                                this.setState({ requestIdCopied: false });
                                            }
                                        }, 2000);
                                    } catch (e) {
                                        console.log('[delete-account] copy failed:',
                                            (e && e.message) || e);
                                    }
                                }}
                                accessibilityLabel="Copy request ID"
                            />
                            {this.state.requestIdCopied ? (
                                <Icon
                                    name="check-circle"
                                    size={18}
                                    color="#388e3c"
                                    style={{ marginLeft: 2 }}
                                />
                            ) : null}
                        </View>
                    ) : null}
                    <View style={styles.buttonRow}>
                        <Button
                            mode="contained"
                            style={styles.button}
                            onPress={this.handleCancel}
                        >
                            Close
                        </Button>
                    </View>
                </>
            );
        }

        // pickServer fired a forced refreshAccountInfo before
        // branching — show a spinner until the snapshot lands so
        // we don't briefly render "Request deletion" only to flip
        // to "Abort" once the truth arrives. The flag is cleared
        // in the refresh's .then() inside pickServer.
        if (this.state.serverInFlightRefresh) {
            return (
                <>
                    <View style={styles.backRow}>
                        <Pressable onPress={this.goBackToChooser} accessibilityLabel="Back">
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Icon name="chevron-left" size={22} color="#1976d2" />
                                <Text style={styles.backText}>Back</Text>
                            </View>
                        </Pressable>
                    </View>
                    <Text style={[containerStyles.title, styles.title]}>
                        Delete account on server
                    </Text>
                    <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                        <ActivityIndicator size="small" />
                        <Text style={{ marginTop: 10, color: '#666', fontSize: 13 }}>
                            Checking server for pending requests…
                        </Text>
                    </View>
                </>
            );
        }

        // We only reach this screen when there's no pending
        // request — the chooser disables the server-delete card
        // and shows the Abort banner inline whenever
        // pendingDeleteRequest is non-null. If a request appears
        // mid-session (the user issued it from another device
        // while this screen was already open), the snapshot
        // refresh that fires from elsewhere will flip
        // pendingDeleteRequest; here we render only the standard
        // Continue (Request deletion) flow.

        return (
            <>
                <View style={styles.backRow}>
                    <Pressable onPress={this.goBackToChooser} accessibilityLabel="Back" disabled={this.state.serverInFlight}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Icon name="chevron-left" size={22} color="#1976d2" />
                            <Text style={styles.backText}>Back</Text>
                        </View>
                    </Pressable>
                </View>
                <Text style={[containerStyles.title, styles.title]}>
                    Delete account on server
                </Text>
                <Text style={styles.body}>
                    A confirmation email will be sent to the account owner email address{'\n'}
                    <Text style={{ fontWeight: 'bold' }}>{this.props.ownerEmail || ''}</Text>
                </Text>
                <Text style={styles.bullet}>• The email must be confirmed in maximum 2 days</Text>
                <Text style={styles.bullet}>• Existing balance must be reconciled with support first.</Text>
                <Text style={styles.warning}>
                    This cannot be undone once the email link is confirmed.
                </Text>
                {this.state.serverError ? (
                    <Text style={[styles.warning, { color: '#b22' }]}>
                        {this.state.serverError}
                    </Text>
                ) : null}
                <View style={styles.buttonRow}>
                    <Button
                        mode="outlined"
                        style={styles.button}
                        onPress={this.handleCancel}
                        disabled={this.state.serverInFlight}
                        accessibilityLabel="Cancel"
                    >
                        Cancel
                    </Button>
                    {this.state.serverInFlight ? (
                        <View style={[styles.button, { flexDirection: 'row', alignItems: 'center' }]}>
                            <ActivityIndicator size="small" />
                            <Text style={{ marginLeft: 8 }}>Sending…</Text>
                        </View>
                    ) : (
                        <Button
                            mode="contained"
                            style={[styles.button, { backgroundColor: '#c62828' }]}
                            icon="email-send"
                            onPress={this.handleServerConfirm}
                            accessibilityLabel={label}
                        >
                            {label}
                        </Button>
                    )}
                </View>
            </>
        );
    }

    render() {
        if (!this.props.show) return null;

        let content;
        if (this.state.mode === 'device') {
            content = this.renderDeviceConfirm();
        } else if (this.state.mode === 'server') {
            content = this.renderServerConfirm();
        } else {
            content = this.renderChooser();
        }

        return (
            <Modal
                style={containerStyles.container}
                visible={this.props.show}
                transparent
                animationType="fade"
                onRequestClose={this.handleCancel}
            >
                <TouchableWithoutFeedback onPress={this.handleCancel}>
                    <View style={containerStyles.overlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                        >
                            <TouchableWithoutFeedback onPress={() => {}}>
                                <Surface style={containerStyles.modalSurface}>
                                    {content}
                                </Surface>
                            </TouchableWithoutFeedback>
                        </KeyboardAvoidingView>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        );
    }
}

DeleteAccountModal.propTypes = {
    show: PropTypes.bool.isRequired,
    close: PropTypes.func.isRequired,
    onConfirm: PropTypes.func.isRequired,
    accountId: PropTypes.string,
    // Legacy fallback — opens the server-side delete page in an
    // external browser when the in-app API path isn't available.
    deleteAccountUrl: PropTypes.string,
    // In-app API. When provided AND allowDelete is true, the
    // server-delete card uses this instead of opening the URL.
    requestServerDeleteAccount: PropTypes.func,
    // Server-published flag from sylk_account_settings.phtml that
    // says the in-app delete-on-server flow is permitted for this
    // account (email set, balance clean, not in
    // deny-account-delete group).
    allowDelete: PropTypes.bool,
    // Customer-profile email — where the deletion-confirmation
    // link will land. Pulled from accountInfo.owner.email by the
    // parent (NavigationBar). Shown verbatim on the Server-confirm
    // screen so the user knows where to look for the message.
    ownerEmail: PropTypes.string,
    // Cancel a pending server-side delete. When provided AND
    // pendingDeleteRequest is set, the chooser surfaces an Abort
    // button next to the "Delete account on server" card.
    abortServerDeleteAccount: PropTypes.func,
    // Forced snapshot refresh. pickServer fires this before
    // branching the server-confirm screen between Continue and
    // Abort, so the client doesn't act on a stale view of the
    // pending state when another device or the web Identity tab
    // may have issued a request since the last snapshot.
    refreshAccountInfo: PropTypes.func,
    // Server's structured record of the pending delete (or null).
    // From accountInfo.delete_request in the latest snapshot.
    // Drives the remaining-time countdown and the Abort affordance.
    pendingDeleteRequest: PropTypes.shape({
        client_request_id: PropTypes.string,
        client_timestamp:  PropTypes.string,
        ip:                PropTypes.string,
        sip_account:       PropTypes.string,
        expire_date:       PropTypes.string,
        requester_entity:  PropTypes.object,
    }),
};

export default DeleteAccountModal;
