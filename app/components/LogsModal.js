import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import {
    View,
    ScrollView,
    TouchableOpacity,
    Clipboard,
    Modal,
    TouchableWithoutFeedback,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
} from 'react-native';
import { Text, Button, Surface, Checkbox } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { openComposer } from 'react-native-email-link';

// Share the Modal + overlay + Surface shell with EditContactModal /
// ShareLocationModal / ActiveLocationSharesModal / DeleteHistoryModal /
// DeleteFileTransfers / AboutModal so every dialog has the same
// rounded-corner card on a dimmed backdrop. Dropped the old Paper
// Dialog/Portal wrapper (which also had a stealthy Platform reference
// that was never imported — a crash waiting to happen on first open).
import containerStyles from '../assets/styles/ContainerStyles';
// Reuse the shared ContentStyles.button so the logs modal action
// row matches EditContactModal / DeleteHistoryModal / the rest of
// the dialog family — rounded corners, the same vertical breathing
// room around each button, no fixed 33% width that the local
// _LogsModal.scss button used to enforce.
import contentStyles from '../assets/styles/ContentStyles';

import styles from '../assets/styles/blink/_LogsModal.scss';

// ---- helpers for the "Request support" flow ---------------------------------
//
// Email scrubber: replaces every user@domain literal in the log text with a
// random@random substitute. Each unique original maps to ONE substitute for
// the whole export so the log still reads coherently — i.e. if alice@x.com
// shows up 30 times, every occurrence becomes the same fake address.
//
// Pattern follows the loose RFC 5321 grammar used by chat URIs in Sylk
// logs: local-part chars + '@' + domain with at least one dot. Anchored
// with \b so it doesn't chew through path-like substrings.

const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

// Friendly placeholder identities — keep it to just `alice` and `bob` so
// scrubbed logs read like the textbook crypto example, not like a guest
// list. Encounter order in the log assigns identities round-robin:
//
//   1st new email  → alice
//   2nd new email  → bob
//   3rd new email  → alice2
//   4th new email  → bob2
//   5th new email  → alice3
//   6th new email  → bob3
//   ...
//
// Most chats only have two participants, so the typical scrubbed log is
// just `alice` and `bob` with no numbers — easiest to read.

function _fakeUserFor(idx) {
    // idx is 0-based encounter index across all unique emails.
    const group = Math.floor(idx / 2) + 1;       // 1, 1, 2, 2, 3, 3, ...
    const baseName = idx % 2 === 0 ? 'alice' : 'bob';
    return group === 1 ? baseName : `${baseName}${group}`;
}

function _anonymizeEmails(text) {
    if (!text) return text;
    // Per-export state. Each unique original email gets a stable fake
    // address; each unique original domain gets a stable `exampleN.com`
    // so two users on the same domain still appear to share a domain
    // in the scrubbed log (preserves the readability of the
    // conversation graph).
    const emailMap = new Map();    // "alice@sylk.link" → "alice@example1.com"
    const domainMap = new Map();   // "sylk.link" → "example1.com"
    let userIdx = 0;
    let domainIdx = 0;
    return text.replace(EMAIL_RE, (orig) => {
        if (emailMap.has(orig)) return emailMap.get(orig);
        const fakeUser = _fakeUserFor(userIdx++);
        // Resolve the original domain to its `exampleN.com` substitute,
        // assigning a fresh number the first time we see it.
        const at = orig.indexOf('@');
        const origDomain = orig.slice(at + 1);
        let fakeDomain = domainMap.get(origDomain);
        if (!fakeDomain) {
            domainIdx++;
            fakeDomain = `example${domainIdx}.com`;
            domainMap.set(origDomain, fakeDomain);
        }
        const fake = `${fakeUser}@${fakeDomain}`;
        emailMap.set(orig, fake);
        return fake;
    });
}


class ShowLogsModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.scroll = null;

        // Live-tail bookkeeping. `userScrolledUp` is set when onScroll
        // detects the user is not near the bottom; while it's true we
        // suppress auto-scroll-to-end so the user can read older
        // entries undisturbed. As soon as they scroll back near the
        // bottom we flip it false again and tailing resumes.
        this._refreshTimer = null;
        this._lastLogsLen = (this.props.logs || '').length;

        this.state = {
            logs: this.props.logs,
            show: this.props.show,
            textInputText: '',
            // "Anonymize data" checkbox state for the Request-support flow.
            anonymize: true,
            // Tail-tracking flags driven by _onScroll / _onContentSizeChange.
            //   userScrolledUp — true when the view is more than ~50 px
            //     from the bottom; gates the auto-scroll-to-end glue
            //     so the user can read older entries without being
            //     yanked back, and controls the bottom-right "go to
            //     bottom" floating button visibility.
            //   isAtTop — true when the view is within ~50 px of the
            //     top; controls the top-right "go to top" floating
            //     button visibility (hidden once we're at the top
            //     since the affordance would be a no-op).
            userScrolledUp: false,
            isAtTop: true,
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        const newLen = (nextProps.logs || '').length;
        const grew = newLen > this._lastLogsLen;
        this._lastLogsLen = newLen;

        this.setState({show: nextProps.show,
                       logs: nextProps.logs});

        // Modal opening / closing: (re)start or stop the live-tail
        // polling timer. Polling is only useful while visible, and
        // leaving an interval running would keep the file-read going
        // forever in the background.
        if (nextProps.show && !this.props.show) {
            this._startLiveTail();
        } else if (!nextProps.show && this.props.show) {
            this._stopLiveTail();
        }

        // Auto-tail: scroll to the new bottom if (a) the body grew or
        // we're transitioning from no-content-yet to having-content
        // (modal first opens with empty `logs`, then the parent reads
        // the file and pushes them; that's not a "growth" because the
        // initial value was '', but we still want the view glued to
        // the end), and (b) the user hasn't scrolled away. The
        // user-scrolled-up flag is recomputed on every scroll event,
        // so when they scroll back near the bottom this condition
        // becomes true again and tailing resumes.
        const wentFromEmpty = !this.props.logs && nextProps.logs;
        if ((grew || wentFromEmpty) && !this.state.userScrolledUp && this.scroll) {
            // Defer one tick so the new `logs` prop has a chance to
            // commit and the ScrollView has remeasured contentSize —
            // otherwise scrollToEnd targets the previous content
            // height and lands part-way up.
            setTimeout(() => {
                if (this.scroll) this.scroll.scrollToEnd({ animated: false });
            }, 50);
        }
    }

    // ---------- live tail plumbing ----------------------------------------

    _startLiveTail = () => {
        if (this._refreshTimer) return;
        // 2s feels close enough to "live" without hammering RNFS — log
        // entries are typically separated by hundreds of ms and a 2s
        // refresh keeps the viewer feeling responsive while the user
        // exercises the app.
        this._refreshTimer = setInterval(() => {
            if (typeof this.props.refresh === 'function') {
                this.props.refresh();
            }
        }, 2000);
    }

    _stopLiveTail = () => {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
    }

    // Scroll handler — called by the inner ScrollView. We compute
    // distance from the bottom and pause tailing the moment the user
    // moves more than 50px above it; tailing resumes the moment they
    // come back within 50px. The 50px tolerance absorbs over-scroll
    // bounce on iOS so a soft scroll-to-end doesn't accidentally
    // pause itself.
    _onScroll = (e) => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
        const userScrolledUp = distanceFromBottom > 50;
        const isAtTop = contentOffset.y <= 50;
        const changed =
            userScrolledUp !== this.state.userScrolledUp
            || isAtTop !== this.state.isAtTop;
        if (changed) {
            this.setState({ userScrolledUp, isAtTop });
            if (!userScrolledUp && this.scroll) {
                this.scroll.scrollToEnd({ animated: false });
            }
        }
    }

    // Fired by the ScrollView whenever its inner content height changes —
    // e.g. when the parent pushes a fresh log slice into props.logs and
    // we re-render the bigger Text. Auto-scroll-to-end here (instead of
    // a fragile 500 ms setTimeout in componentDidMount) because by the
    // time this fires the content has actually been laid out, so
    // scrollToEnd has a real height to scroll to. Gated on
    // userScrolledUp so the user reading older entries doesn't get
    // yanked back when a new line arrives.
    _onContentSizeChange = () => {
        if (!this.state.userScrolledUp && this.scroll) {
            this.scroll.scrollToEnd({ animated: false });
        }
    }

    componentWillUnmount() {
        this._stopLiveTail();
    }

    copyToClipboard = async () => {
        await Clipboard.setString(this.state.logs);
    }

    // Open the user's email composer pre-filled with To, Subject, and a
    // body that contains the (optionally anonymized) log text. We use
    // `openComposer` from react-native-email-link — the same path
    // ShareMessageModal uses successfully — instead of react-native-share.
    // The previous Share.open(email) call was opening the share sheet
    // instead of the Mail composer on iOS / silently doing nothing on
    // some Android setups; openComposer constructs a proper mailto URL
    // (or platform-specific intent) so the system Mail app opens
    // reliably with the fields pre-filled.
    //
    // No attachment — react-native-email-link 1.7.5 doesn't support
    // them; we put the logs straight in the body. Truncated to a safe
    // size since email-app body length limits vary by platform; we keep
    // the most recent N chars (where the action of interest usually
    // lives) and prepend a marker for anything older.
    requestSupport = async () => {
        try {
            let body = this.state.logs || '';
            if (this.state.anonymize) {
                body = _anonymizeEmails(body);
            }
            const MAX_BODY = 200000; // ~200 KB — well within iOS Mail's mailto limit
            if (body.length > MAX_BODY) {
                const dropped = body.length - MAX_BODY;
                body = `... (truncated ${dropped} older chars, showing the most recent ${MAX_BODY}) ...\n\n` +
                       body.slice(-MAX_BODY);
            }
            // Subject includes the requesting account so support can
            // route the ticket without having to read the body. Falls
            // back to a plain "Sylk support request" when the account
            // isn't available yet (e.g. user opened Show Logs before
            // signing in).
            const account = this.props.account;
            const subject = account
                ? `Sylk support request for ${account}`
                : 'Sylk support request';
            // Typing room above the logs. The naive approach (a run of
            // \n) gets collapsed by every email client. A non-breaking
            // space (\u00A0) survives in iOS Mail / Gmail but BlueMail
            // (and a few other Android clients) still strip it.
            // The only universally-preserved approach is a *visible*
            // placeholder character on each line. We use a single
            // period — small enough to feel like blank space, but
            // every client honors it. The user can either type their
            // description above the dots or just replace them.
            const blankLines = ('.\n').repeat(3);
            await openComposer({
                to: 'support@sylk.link',
                subject,
                body:
                    'Hi Sylk support,\n\n' +
                    'Please describe the issue here:\n\n' +
                    blankLines +
                    '\n--- LOGS ---\n\n' +
                    body,
            });
        } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            console.log('[support-share] openComposer failed:', msg);
        }
    }

    componentDidMount() {
        setTimeout(() => {
            if (this.scroll) {
                this.scroll.scrollToEnd();
            }
        }, 500);
        // Cover the case where the modal mounts already-visible
        // (e.g. user opened the menu item, parent re-renders us
        // immediately): kick off live-tail polling right away.
        if (this.props.show) {
            this._startLiveTail();
        }
    }

    render() {
        const containerClass = this.props.orientation === 'landscape' ? styles.scrollViewLandscape : styles.scrollViewPortrait;
        // Hide the `[APPLOG] ` filter tag inside the in-app viewer —
        // it's noise to a human reader, and the tag is still present in
        // the on-disk log file (and in the email export / clipboard
        // copy) where grep / a support engineer cares about it.
        const displayLogs = (this.state.logs || '').replace(/\[APPLOG\] /g, '');

        return (
            <Modal
                style={containerStyles.container}
                visible={!!this.state.show}
                transparent
                animationType="fade"
                onRequestClose={this.props.close}
            >
                <TouchableWithoutFeedback onPress={this.props.close}>
                    <View style={containerStyles.overlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                        >
                            {/* Block dismiss when taps land inside the card. */}
                            <TouchableWithoutFeedback onPress={() => {}}>
                                <Surface style={containerStyles.modalSurface}>
                                    <View style={styles.container}>
                                        <Text style={containerStyles.title}>Sylk logs</Text>
                                        {/* Wrapper holds the ScrollView plus
                                            the two floating jump buttons.
                                            `position: relative` lets the
                                            buttons absolute-position
                                            themselves against the wrapper's
                                            edges. The buttons sit on the
                                            right side of the log view —
                                            a top-anchored "Top" and a
                                            bottom-anchored "Bottom" — so
                                            they live in the same visual
                                            column as their action and
                                            don't compete with the primary
                                            action row (Copy / Refresh /
                                            Purge) below the log. */}
                                        {/* Wrapper for the ScrollView + the
                                            two floating jump buttons. The
                                            wrapper carries the explicit
                                            height (formerly from
                                            containerClass = SCSS) inline
                                            so it's clear to RN's layout
                                            engine that the wrapper is
                                            bounded and the absolute
                                            children anchor against its
                                            edges. position: relative
                                            establishes the positioning
                                            context. */}
                                        <View
                                            style={{
                                                position: 'relative',
                                                height: this.props.orientation === 'landscape' ? 200 : 500,
                                                marginBottom: 10,
                                                alignSelf: 'stretch',
                                            }}
                                        >
                                            <ScrollView
                                                style={{ flex: 1 }}
                                                ref={(scroll) => {this.scroll = scroll;}}
                                                keyboardShouldPersistTaps="handled"
                                                onScroll={this._onScroll}
                                                onContentSizeChange={this._onContentSizeChange}
                                                scrollEventThrottle={120}
                                            >
                                                {/* Plain Text — was wrapped in a
                                                    TouchableOpacity for
                                                    tap-to-copy, but that's
                                                    what blocked the floating
                                                    Top/Bottom buttons from
                                                    receiving touches. The
                                                    Copy button in the action
                                                    row at the bottom of the
                                                    modal still handles copy
                                                    via this.copyToClipboard. */}
                                                <Text style={styles.body}>{displayLogs}</Text>
                                            </ScrollView>
                                            {/* Floating jump-to-top / jump-to-bottom
                                                controls. Each is hidden when its
                                                target position is already in
                                                view — Top hides at the top,
                                                Bottom hides at the live tail —
                                                so the user doesn't see redundant
                                                "go where you already are"
                                                buttons. */}
                                            {!this.state.isAtTop ? (
                                            <TouchableOpacity
                                                onPress={() => {
                                                    console.log('[logs] go to top tapped');
                                                    if (this.scroll) {
                                                        this.scroll.scrollTo({ y: 0, animated: true });
                                                        this.setState({ userScrolledUp: true, isAtTop: true });
                                                    }
                                                }}
                                                accessibilityLabel="Go to top"
                                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                                style={{
                                                    position: 'absolute',
                                                    right: 8,
                                                    top: 8,
                                                    width: 30,
                                                    height: 30,
                                                    borderRadius: 15,
                                                    backgroundColor: 'rgba(0,0,0,0.55)',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    elevation: 8,
                                                    zIndex: 8,
                                                }}
                                            >
                                                <Icon name="arrow-up-bold" size={18} color="#fff" />
                                            </TouchableOpacity>
                                            ) : null}
                                            {/* Bottom button is hidden when the
                                                view is already at (or near) the
                                                bottom — same `userScrolledUp`
                                                flag the live-tail glue uses, so
                                                the button only appears once the
                                                user actually scrolls up off the
                                                tail. Tailing the log feels
                                                cleaner without a redundant
                                                "go to where you already are"
                                                affordance hovering at the
                                                bottom-right. */}
                                            {this.state.userScrolledUp ? (
                                            <TouchableOpacity
                                                onPress={() => {
                                                    console.log('[logs] go to bottom tapped');
                                                    if (this.scroll) {
                                                        this.scroll.scrollToEnd({ animated: true });
                                                        this.setState({ userScrolledUp: false });
                                                    }
                                                }}
                                                accessibilityLabel="Go to bottom"
                                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                                style={{
                                                    position: 'absolute',
                                                    right: 8,
                                                    bottom: 8,
                                                    width: 30,
                                                    height: 30,
                                                    borderRadius: 15,
                                                    backgroundColor: 'rgba(0,0,0,0.55)',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    elevation: 8,
                                                    zIndex: 8,
                                                }}
                                            >
                                                <Icon name="arrow-down-bold" size={18} color="#fff" />
                                            </TouchableOpacity>
                                            ) : null}
                                        </View>

                                        {/* Action row.
                                            Layout matches the rest of
                                            the dialog family
                                            (EditContactModal,
                                            DeleteHistoryModal, …):
                                            Close on the LEFT (outlined,
                                            secondary action), primary
                                            actions filling the rest of
                                            the row.
                                            Refresh button removed —
                                            _startLiveTail already
                                            re-reads the log file every
                                            2 s while the modal is open,
                                            so a manual Refresh is
                                            redundant. */}
                                        <View style={contentStyles.buttonRow}>
                                            <Button
                                                mode="outlined"
                                                style={[contentStyles.button, { flex: 1, marginHorizontal: 4 }]}
                                                onPress={this.props.close}
                                                accessibilityLabel="Close"
                                            >
                                                Close
                                            </Button>
                                            <Button
                                                mode="contained"
                                                style={[contentStyles.button, { flex: 1, marginHorizontal: 4 }]}
                                                onPress={this.copyToClipboard}
                                                accessibilityLabel="Copy"
                                                icon="content-copy"
                                            >
                                                Copy
                                            </Button>
                                            <Button
                                                mode="contained"
                                                style={[contentStyles.button, { flex: 1, marginHorizontal: 4 }]}
                                                onPress={this.props.purgeLogs}
                                                accessibilityLabel="Purge"
                                                icon="delete"
                                                color="red"
                                            >
                                                Purge
                                            </Button>
                                        </View>

                                        {/* Horizontal divider — visually
                                            separates the primary log
                                            actions (Copy / Refresh / Purge)
                                            from the secondary "talk to a
                                            human" support area below. */}
                                        <View style={{
                                            height: StyleSheet.hairlineWidth,
                                            backgroundColor: '#bdbdbd',
                                            marginTop: 12,
                                            marginBottom: 8,
                                            alignSelf: 'stretch',
                                        }} />

                                        {/* Support-share row.
                                            Anonymize checkbox + Email
                                            support button. */}
                                        <View style={{
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            flexWrap: 'wrap',
                                        }}>
                                            <TouchableOpacity
                                                onPress={() => this.setState({ anonymize: !this.state.anonymize })}
                                                style={{ flexDirection: 'row', alignItems: 'center' }}
                                                accessibilityLabel="Anonymize data toggle"
                                            >
                                                <Checkbox
                                                    status={this.state.anonymize ? 'checked' : 'unchecked'}
                                                    onPress={() => this.setState({ anonymize: !this.state.anonymize })}
                                                />
                                                <Text>Anonymize data</Text>
                                            </TouchableOpacity>
                                            {/* Compact secondary action: tight
                                                padding via `compact`, no
                                                `styles.button` (which forces
                                                a wide min-width to match the
                                                primary button row). Purple
                                                `#6A1B9A` keeps it visually
                                                distinct from the default
                                                blue Copy/Refresh and the
                                                red Purge. */}
                                            <Button
                                                mode="contained"
                                                compact
                                                buttonColor="#6A1B9A"
                                                textColor="#ffffff"
                                                onPress={this.requestSupport}
                                                accessibilityLabel="Email support"
                                                icon="email-send"
                                                labelStyle={{ fontSize: 12 }}
                                            >
                                                Email support
                                            </Button>
                                        </View>
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

ShowLogsModal.propTypes = {
    show               : PropTypes.bool.isRequired,
    close              : PropTypes.func.isRequired,
    purgeLogs          : PropTypes.func.isRequired,
    refresh            : PropTypes.func.isRequired,
    orientation        : PropTypes.string,
    logs               : PropTypes.string,
    account            : PropTypes.string,   // current user@domain — used to tag the support email subject
};

export default ShowLogsModal;
