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
    SafeAreaView,
} from 'react-native';
import { Text, Button, Surface, Checkbox, Chip } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Share the Modal + overlay + Surface shell with EditContactModal /
// ShareLocationModal / ActiveLocationSharesModal / DeleteHistoryModal /
// DeleteFileTransfers / AboutModal so every dialog has the same
// rounded-corner card on a dimmed backdrop. Dropped the old Paper
// Dialog/Portal wrapper (which also had a stealthy Platform reference
// that was never imported — a crash waiting to happen on first open).
import containerStyles from '../assets/styles/ContainerStyles';
import utils from '../utils';
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

// Sentinel tag name for the "untagged" pill (lines containing no
// [bracketed] tag at all). Doubles as a Set key alongside real tag
// names — keep it impossible to collide with a real tag by leading
// with double underscores. The pill UI maps this to the label
// "untagged".
const UNTAGGED_KEY = '__untagged__';

// Tight green pill — drawn as a plain TouchableOpacity (not a Paper
// Chip) so we don't inherit the check-icon / avatar-circle the
// component injects on the selected state. Active pills are filled
// dark green; idle pills are a light green tint with dark green
// text. The vertical margin gives the multi-row wrap layout its
// row-gap.
const pillStyle = (active) => ({
    marginHorizontal: 2,
    marginVertical: 2,
    height: 22,
    paddingHorizontal: 10,
    borderRadius: 11,
    backgroundColor: active ? '#2e7d32' : '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
});
const pillTextStyle = (active) => ({
    color: active ? '#fff' : '#1b5e20',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: active ? '600' : '400',
});

// Max height for the pill area = ~3 rows of pills + their gaps. Each
// row is roughly 22 (height) + 4 (top+bottom margin) = 26 px. 3 rows ≈
// 80 px. If the total tag count exceeds that, the vertical ScrollView
// inside the pill bar takes over.
const PILL_BAR_MAX_HEIGHT = 84;

// Font scale bounds for the log viewer's − / + controls. The base
// fontSize comes from styles.body (10 px); 0.7×–2.0× covers a small
// 7 px down to a chunky 20 px without breaking the layout.
const FONT_BASE = 10;
const FONT_MIN_SCALE = 0.7;
const FONT_MAX_SCALE = 2.0;
const FONT_STEP = 0.15;

// Match `[token]` where token is a letter-led identifier (so we don't
// pick up timestamps like [19:40:52], device prefixes, or transfer
// IDs). Lowercase + dashes/underscores cover the existing tag set
// (`[messaging]`, `[support-share]`, `[pubkey-recv]`, `[upload]`,
// `[location]`, `[ZRTP]`, ...). The `[APPLOG]` prefix is stripped
// before scanning so it doesn't appear as a pill.
const TAG_RE = /\[([A-Za-z][A-Za-z0-9_-]*)\]/g;

// Scan the (already APPLOG-stripped) log text once. Returns the sorted
// list of unique tags discovered, plus a function that filters lines
// against a Set of selected tag keys (use UNTAGGED_KEY to include
// lines with no tag). An empty selection means "no filter, show
// everything". Multiple selected tags are combined with OR — picking
// more tags strictly shows MORE lines (cumulative), never less.
function _scanTagsAndBuildFilter(text) {
    const lines = (text || '').split('\n');
    // Per-tag line count, used both to surface the popular tags first
    // in the pill bar and to dedupe tag membership per-line for the
    // filter cache below. Also rendered inside each pill so the user
    // can see at a glance which tags carry the bulk of the log.
    const tagCounts = new Map();
    // Per-line tag sets, parallel to `lines`, computed once so the
    // per-render filter pass is just a Set lookup per line.
    const perLineTags = new Array(lines.length);
    // Whether at least one non-empty line has no [tag] at all. The
    // "untagged" pill in LogsModal is hidden when this is false so
    // we don't surface a filter chip with zero matches. Empty lines
    // (trailing newlines from RNFS reads) don't count — they're not
    // user-visible content the pill could surface.
    let hasUntagged = false;
    // Count of non-empty lines without any [tag]. Surfaced inside the
    // "untagged" pill so it follows the same "(N)" convention as the
    // tag pills.
    let untaggedCount = 0;
    // Total non-empty line count, used in the header summary alongside
    // the byte size. `lines.length` would over-count by 1 because
    // trailing '\r\n' from RNFS produces a final empty entry.
    let nonEmptyLineCount = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let m;
        let tagsForLine = null;
        TAG_RE.lastIndex = 0;
        while ((m = TAG_RE.exec(line)) !== null) {
            const tag = m[1];
            if (!tagsForLine) tagsForLine = new Set();
            // Only count each tag once per line so a tag that
            // happens to appear twice in the same log line (e.g. a
            // line that mentions both "[wss]" and the receiver as
            // "[wss]" again) doesn't get an inflated count.
            if (!tagsForLine.has(tag)) {
                tagsForLine.add(tag);
                tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            }
        }
        perLineTags[i] = tagsForLine; // null when the line has no tag
        if (line && line.trim().length > 0) {
            nonEmptyLineCount += 1;
            if (!tagsForLine) {
                hasUntagged = true;
                untaggedCount += 1;
            }
        }
    }
    // Order by descending line count so the busiest tags sit at the
    // start of the pill row (where the user's eye lands first), with
    // alphabetical order as the tiebreaker for stable rendering.
    // Returned as {name, count} objects so the renderer can show
    // both inside the pill body without a second Map lookup per
    // render.
    const sortedTags = Array.from(tagCounts.entries())
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
        .map(([tag, count]) => ({ name: tag, count }));
    const filter = (selectedSet) => {
        if (!selectedSet || selectedSet.size === 0) return text;
        const wantUntagged = selectedSet.has(UNTAGGED_KEY);
        const out = [];
        for (let i = 0; i < lines.length; i++) {
            const lineTags = perLineTags[i];
            if (!lineTags) {
                if (wantUntagged) out.push(lines[i]);
                continue;
            }
            // OR-match: keep the line if any of its tags is selected.
            for (const t of lineTags) {
                if (selectedSet.has(t)) { out.push(lines[i]); break; }
            }
        }
        return out.join('\n');
    };
    return {
        tags: sortedTags,           // [{name, count}, ...] desc by count
        filter,
        hasUntagged,
        untaggedCount,
        nonEmptyLineCount,
    };
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
            // True while requestSupport is in flight (writing the temp
            // file, exchanging keys, encrypting, uploading) so we can
            // disable the action button and avoid queueing duplicate
            // requests on a double-tap.
            sendingSupport: false,
            // Selected tag pills for the bottom filter row. Plain JS
            // Set so toggle is O(1). UNTAGGED_KEY is a valid member.
            // Empty set = no filter (show everything). The filter is
            // OR — selecting more tags shows MORE lines.
            selectedTags: new Set(),
            // Font scale multiplier for the log text. Driven by the
            // − / + controls in the header. Clamped to FONT_MIN /
            // FONT_MAX in _decreaseFont / _increaseFont.
            fontScale: 1,
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

        // Memoization for the tag scan: scanning a 100KB+ log line by
        // line is fine but repeating it on every live-tail tick or
        // every selectedTags toggle would be wasteful. Cache the scan
        // result keyed on the exact log string identity. Filter
        // function takes the selected Set so the cache survives pill
        // toggles without rescanning.
        this._scanCacheKey = null;
        this._scanCacheValue = null;
    }

    _getScan = (logsText) => {
        if (this._scanCacheKey === logsText && this._scanCacheValue) {
            return this._scanCacheValue;
        }
        const v = _scanTagsAndBuildFilter(logsText);
        this._scanCacheKey = logsText;
        this._scanCacheValue = v;
        return v;
    }

    _toggleTag = (tagKey) => {
        const next = new Set(this.state.selectedTags);
        if (next.has(tagKey)) next.delete(tagKey); else next.add(tagKey);
        this.setState({ selectedTags: next });
    }

    _clearTags = () => {
        if (this.state.selectedTags.size === 0) return;
        this.setState({ selectedTags: new Set() });
    }

    _decreaseFont = () => {
        const next = Math.max(FONT_MIN_SCALE, +(this.state.fontScale - FONT_STEP).toFixed(2));
        if (next === this.state.fontScale) return;
        this.setState({ fontScale: next });
    }

    _increaseFont = () => {
        const next = Math.min(FONT_MAX_SCALE, +(this.state.fontScale + FONT_STEP).toFixed(2));
        if (next === this.state.fontScale) return;
        this.setState({ fontScale: next });
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
        // Snapshot mode: when viewing a log file attachment opened via
        // openLogAttachment, there's no live tail to chase — the
        // contents come from a fixed file. Don't spin the refresh
        // timer in that case; it would just no-op against props.refresh
        // (which reads the on-device live log file, not the snapshot).
        if (this.props.attachedLogContent != null) return;
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

    // Send the (optionally anonymized) log text to support@sylk.link as
    // a PGP-encrypted file attachment over the regular Sylk file-transfer
    // pipeline. The orchestration (write temp .txt, autocreate the
    // support contact, send a plaintext "Request for support" to nudge
    // the PGP key exchange, wait for the support public key, then upload
    // the encrypted file) lives in app.js#requestSupportFromLogs. We
    // call that prop here, anonymize the body first if the checkbox is
    // ticked, and lock the button while in flight so a double-tap can't
    // queue two parallel uploads.
    requestSupport = async () => {
        if (this.state.sendingSupport) {
            // Disable double-tap while in flight so we don't queue two
            // parallel uploads.
            return;
        }
        this.setState({ sendingSupport: true });
        try {
            let body = this.state.logs || '';
            if (this.state.anonymize) {
                body = _anonymizeEmails(body);
            }
            if (typeof this.props.requestSupportFromLogs === 'function') {
                await this.props.requestSupportFromLogs(body, this.props.account);
            } else {
                console.log('[support-share] requestSupportFromLogs prop missing');
            }
        } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            console.log('[support-share] requestSupport failed:', msg);
        } finally {
            this.setState({ sendingSupport: false });
            if (typeof this.props.close === 'function') {
                this.props.close();
            }
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
        // Snapshot mode (file attachment) takes precedence over the
        // live tail in state.logs. attachedLogContent is set when the
        // user tapped a YYYY-MM-DD_HH-MM-SS-sylk-logs.txt attachment in
        // chat (or the legacy YYYYMMDD-HHMMSS shape from older builds)
        // — see app.js#openLogAttachment.
        const sourceLogs = this.props.attachedLogContent != null
            ? this.props.attachedLogContent
            : (this.state.logs || '');
        // Hide the `[APPLOG] ` filter prefix inside the in-app viewer —
        // it's noise to a human reader, and the prefix is still present in
        // the on-disk log file (and in the email export / clipboard copy)
        // where grep / a support engineer cares about it. We strip BEFORE
        // tag-scanning so [APPLOG] never shows up as a pill.
        const displayLogs = sourceLogs.replace(/\[APPLOG\] /g, '');
        const {
            tags,
            filter,
            hasUntagged,
            untaggedCount,
            nonEmptyLineCount,
        } = this._getScan(displayLogs);
        // Bytes ≈ char count for ASCII-heavy log content. Close enough
        // for the user-facing "13 KB" indicator; the on-disk file may
        // be a few bytes larger from the [APPLOG] prefix we strip
        // above and from CR/LF encoding.
        const sizeLabel = utils.formatBytes(displayLogs.length || 0);
        const linesLabel = nonEmptyLineCount.toLocaleString() + ' line'
            + (nonEmptyLineCount === 1 ? '' : 's');
        // True when the log being viewed belongs to a DIFFERENT
        // account than the user is signed in as. We hide owner-only
        // actions (Purge, Anonymize, Request support) in that case —
        // they either touch the local log file (which isn't the
        // snapshot we're viewing) or compose a new outgoing report
        // (which is meaningless when reading someone else's log).
        // app.js sets the subtitle ONLY when attachedLogUri !==
        // accountId, so this flag captures exactly the cross-account
        // viewing case.
        const _isViewingOthersLogs = !!this.props.subtitle;
        const filteredLogs = filter(this.state.selectedTags);
        const hasFilter = this.state.selectedTags.size > 0;
        // In landscape we reclaim vertical space by hiding the title
        // line and the bottom action button rows. The close (X) button
        // stays visible so the user always has a way out of the modal
        // without rotating back to portrait first. The filter pill row
        // and the log scroll view itself remain in both orientations.
        const isLandscape = this.props.orientation === 'landscape';

        return (
            <Modal
                visible={!!this.state.show}
                animationType="slide"
                onRequestClose={this.props.close}
                presentationStyle="fullScreen"
            >
                <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
                    <KeyboardAvoidingView
                        style={{ flex: 1 }}
                        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
                    >
                        {/* Header: single-line "Sylk logs · user@domain"
                            title with the close (X) on the right. The
                            URI is the SIP identity the logs belong to
                            (own account in live-tail mode, file_transfer
                            sender's URI in snapshot mode). The URI is
                            only appended when it differs from the
                            current account — viewing one's own live
                            tail or own self-attached snapshot renders
                            just "Sylk logs". */}
                        {/* In landscape the header row is dropped
                            entirely — we don't want to spend any vertical
                            pixels on chrome when height is the scarce
                            axis. The close (X) is moved to a floating
                            button overlaid on the log scroll view below,
                            styled to match the other floating controls
                            (go-to-top, go-to-bottom, font ±). */}
                        {!isLandscape ? (
                        <View style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderBottomWidth: StyleSheet.hairlineWidth,
                            borderBottomColor: '#e0e0e0',
                        }}>
                            {/* "Sylk logs" stays at the regular title
                                size; the SIP URI gets ~half size and a
                                muted colour so it reads as a secondary
                                label without breaking out of the
                                single-line header. Both share the same
                                Text via nested children so iOS / Android
                                inherit the parent's ellipsizeMode and
                                numberOfLines correctly. */}
                            <Text
                                style={[containerStyles.title, { flex: 1, marginBottom: 0 }]}
                                numberOfLines={1}
                                ellipsizeMode="middle"
                            >
                                Sylk logs
                                {this.props.subtitle ? (
                                    <Text style={{ fontSize: 11, color: '#666', fontWeight: 'normal' }}>
                                        {'  ·  ' + this.props.subtitle}
                                    </Text>
                                ) : null}
                            </Text>
                            <TouchableOpacity
                                onPress={this.props.close}
                                accessibilityLabel="Close"
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                                <Icon name="close" size={24} color="#444" />
                            </TouchableOpacity>
                        </View>
                        ) : null}

                        {/* Log scroll fills all remaining vertical space. */}
                        <View style={{ flex: 1, position: 'relative' }}>
                            <ScrollView
                                style={{ flex: 1 }}
                                contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
                                ref={(scroll) => {this.scroll = scroll;}}
                                keyboardShouldPersistTaps="handled"
                                onScroll={this._onScroll}
                                onContentSizeChange={this._onContentSizeChange}
                                scrollEventThrottle={120}
                            >
                                {/* `selectable` enables long-press text
                                    selection + the system Copy menu on
                                    both iOS and Android, so the user
                                    can grab a specific snippet from the
                                    log without sending the whole thing
                                    via the Copy button. */}
                                <Text
                                    selectable={true}
                                    selectionColor="rgba(46,125,50,0.35)"
                                    style={[
                                        styles.body,
                                        {
                                            fontSize: FONT_BASE * this.state.fontScale,
                                            lineHeight: Math.round(FONT_BASE * this.state.fontScale * 1.35),
                                        },
                                    ]}
                                >
                                    {filteredLogs}
                                </Text>
                            </ScrollView>
                            {/* Floating close — landscape only. The
                                in-row header X is dropped in landscape
                                to reclaim vertical space, so we mount a
                                matching dark-pill overlay button at the
                                top-LEFT of the scroll area. Top-left
                                (rather than top-right) keeps it off the
                                same gutter as go-to-top / go-to-bottom /
                                font ± so the four floating controls
                                never overlap. */}
                            {isLandscape ? (
                            <TouchableOpacity
                                onPress={this.props.close}
                                accessibilityLabel="Close"
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                style={{
                                    position: 'absolute', left: 8, top: 8,
                                    width: 30, height: 30, borderRadius: 15,
                                    backgroundColor: 'rgba(0,0,0,0.55)',
                                    alignItems: 'center', justifyContent: 'center',
                                    elevation: 8, zIndex: 8,
                                }}
                            >
                                <Icon name="close" size={18} color="#fff" />
                            </TouchableOpacity>
                            ) : null}
                            {/* Floating jump-to-top */}
                            {!this.state.isAtTop ? (
                            <TouchableOpacity
                                onPress={() => {
                                    if (this.scroll) {
                                        this.scroll.scrollTo({ y: 0, animated: true });
                                        this.setState({ userScrolledUp: true, isAtTop: true });
                                    }
                                }}
                                accessibilityLabel="Go to top"
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                style={{
                                    position: 'absolute', right: 8, top: 8,
                                    width: 30, height: 30, borderRadius: 15,
                                    backgroundColor: 'rgba(0,0,0,0.55)',
                                    alignItems: 'center', justifyContent: 'center',
                                    elevation: 8, zIndex: 8,
                                }}
                            >
                                <Icon name="arrow-up-bold" size={18} color="#fff" />
                            </TouchableOpacity>
                            ) : null}
                            {this.state.userScrolledUp ? (
                            <TouchableOpacity
                                onPress={() => {
                                    if (this.scroll) {
                                        this.scroll.scrollToEnd({ animated: true });
                                        this.setState({ userScrolledUp: false });
                                    }
                                }}
                                accessibilityLabel="Go to bottom"
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                style={{
                                    position: 'absolute', right: 8, bottom: 8,
                                    width: 30, height: 30, borderRadius: 15,
                                    backgroundColor: 'rgba(0,0,0,0.55)',
                                    alignItems: 'center', justifyContent: 'center',
                                    elevation: 8, zIndex: 8,
                                }}
                            >
                                <Icon name="arrow-down-bold" size={18} color="#fff" />
                            </TouchableOpacity>
                            ) : null}
                            {/* Floating font −/+ controls, right edge,
                                vertically centered. Stacked as a
                                column so they share the right gutter
                                with the go-to-top (top) and
                                go-to-bottom (bottom) controls — three
                                clusters spaced top / middle / bottom
                                along the same axis. The 50%-of-height
                                top + negative translate centers the
                                container without measuring the wrapper.
                                Same dark pill background as the nav
                                controls so they feel like one family. */}
                            <View
                                style={{
                                    position: 'absolute',
                                    right: 8,
                                    top: '50%',
                                    // Extra breathing room between + and −
                                    // makes the two targets feel less
                                    // crowded and easier to hit. Cluster
                                    // height is 30 + 24 + 30 = 84, so
                                    // shift up by 42 for true vertical
                                    // centering between the top/bottom
                                    // nav buttons.
                                    transform: [{ translateY: -42 }],
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    elevation: 8,
                                    zIndex: 8,
                                }}
                            >
                                <TouchableOpacity
                                    onPress={this._increaseFont}
                                    accessibilityLabel="Bigger font"
                                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                    disabled={this.state.fontScale >= FONT_MAX_SCALE}
                                    style={{
                                        width: 30, height: 30, borderRadius: 15,
                                        backgroundColor: 'rgba(0,0,0,0.55)',
                                        alignItems: 'center', justifyContent: 'center',
                                        marginBottom: 24,
                                        opacity: this.state.fontScale >= FONT_MAX_SCALE ? 0.4 : 1,
                                    }}
                                >
                                    <Icon name="plus" size={18} color="#fff" />
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={this._decreaseFont}
                                    accessibilityLabel="Smaller font"
                                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                    disabled={this.state.fontScale <= FONT_MIN_SCALE}
                                    style={{
                                        width: 30, height: 30, borderRadius: 15,
                                        backgroundColor: 'rgba(0,0,0,0.55)',
                                        alignItems: 'center', justifyContent: 'center',
                                        opacity: this.state.fontScale <= FONT_MIN_SCALE ? 0.4 : 1,
                                    }}
                                >
                                    <Icon name="minus" size={18} color="#fff" />
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* Filter pill row.
                            Horizontal scroll so an arbitrary number of
                            tags fits on narrow phones. The first chip is
                            always "untagged" — selects lines without any
                            [bracketed] tag. Tap toggles a tag in/out of
                            the selection set; an empty selection means
                            no filter (all lines shown). Filtering is
                            OR — picking more pills shows MORE lines
                            (cumulative), per the user's ask.

                            The header row above the pills carries the
                            logfile size + line count on the left and a
                            right-aligned "Clear" button (rendered only
                            when at least one pill is active — otherwise
                            it would do nothing on tap). Each pill
                            shows its line count in parentheses so the
                            busiest tags are obvious at a glance. */}
                        <View style={{
                            paddingVertical: 4,
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: '#e0e0e0',
                            backgroundColor: '#fafafa',
                        }}>
                            {/* Header: size + line count (left) and
                                Clear (right, only when filter active). */}
                            <View style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                paddingHorizontal: 8,
                                paddingTop: 2,
                                paddingBottom: 4,
                            }}>
                                <Text style={{
                                    color: '#666',
                                    fontSize: 10,
                                    lineHeight: 12,
                                }}>
                                    {sizeLabel} · {linesLabel}
                                </Text>
                                {hasFilter ? (
                                    <TouchableOpacity
                                        key="__clear__"
                                        onPress={this._clearTags}
                                        accessibilityLabel="Clear filter"
                                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                        style={{
                                            height: 22,
                                            paddingHorizontal: 10,
                                            borderRadius: 11,
                                            backgroundColor: 'transparent',
                                            borderWidth: StyleSheet.hairlineWidth,
                                            borderColor: '#bbb',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <Text style={{
                                            color: '#666',
                                            fontSize: 10,
                                            lineHeight: 12,
                                            fontWeight: '600',
                                        }}>
                                            Clear
                                        </Text>
                                    </TouchableOpacity>
                                ) : null}
                            </View>

                            {/* Pills wrap into rows; if more than ~3 rows
                                worth of tags exist, the vertical
                                ScrollView caps the visible area and the
                                rest scrolls behind. The wrap container
                                keeps the natural left-to-right tab
                                order so the user's eye lands on the
                                "untagged" pill first. */}
                            <ScrollView
                                style={{ maxHeight: PILL_BAR_MAX_HEIGHT }}
                                showsVerticalScrollIndicator={false}
                                keyboardShouldPersistTaps="handled"
                            >
                                <View style={{
                                    flexDirection: 'row',
                                    flexWrap: 'wrap',
                                    paddingHorizontal: 6,
                                    alignItems: 'center',
                                }}>
                                    {/* Plain TouchableOpacity pills — no
                                        react-native-paper Chip, because
                                        Paper's Chip in some versions
                                        renders a check overlay or
                                        avatar-circle on the active pill
                                        even without `selected`. The
                                        active state is communicated
                                        entirely by the background +
                                        text colour swap (light green
                                        tint → filled dark green). */}
                                    {/* The "untagged" pill is shown
                                        only when the current log
                                        actually contains at least one
                                        non-empty line with no
                                        [tag] — there's no point
                                        offering a filter that would
                                        match zero lines. hasUntagged
                                        is computed inside
                                        _scanTagsAndBuildFilter. */}
                                    {hasUntagged ? (
                                    <TouchableOpacity
                                        key="__untagged__"
                                        onPress={() => this._toggleTag(UNTAGGED_KEY)}
                                        accessibilityLabel={`Filter untagged lines (${untaggedCount})`}
                                        style={pillStyle(this.state.selectedTags.has(UNTAGGED_KEY))}
                                    >
                                        <Text style={pillTextStyle(this.state.selectedTags.has(UNTAGGED_KEY))}>
                                            untagged ({untaggedCount})
                                        </Text>
                                    </TouchableOpacity>
                                    ) : null}
                                    {tags.map((t) => {
                                        const active = this.state.selectedTags.has(t.name);
                                        return (
                                            <TouchableOpacity
                                                key={t.name}
                                                onPress={() => this._toggleTag(t.name)}
                                                accessibilityLabel={`Filter ${t.name} (${t.count})`}
                                                style={pillStyle(active)}
                                            >
                                                <Text style={pillTextStyle(active)}>
                                                    {t.name} ({t.count})
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            </ScrollView>
                        </View>

                        {/* Action row + support row pinned at the bottom.
                            Hidden in landscape to reclaim vertical space
                            for the log scroll view — the device is short
                            on height in that orientation and the user
                            typically rotates to portrait when they want
                            to copy / purge / request support. */}
                        {!isLandscape ? (
                        <View style={{
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: '#e0e0e0',
                            backgroundColor: '#fff',
                        }}>
                            <View style={contentStyles.buttonRow}>
                                <Button
                                    mode="contained"
                                    style={[contentStyles.button, { flex: 1, marginHorizontal: 4 }]}
                                    onPress={this.copyToClipboard}
                                    accessibilityLabel="Copy"
                                    icon="content-copy"
                                >
                                    Copy
                                </Button>
                                {!_isViewingOthersLogs ? (
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
                                ) : null}
                            </View>

                            {!_isViewingOthersLogs ? (
                                <React.Fragment>
                                    <View style={{
                                        height: StyleSheet.hairlineWidth,
                                        backgroundColor: '#bdbdbd',
                                        marginTop: 12,
                                        marginBottom: 8,
                                        alignSelf: 'stretch',
                                    }} />

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
                                        <Button
                                            mode="contained"
                                            compact
                                            buttonColor="#6A1B9A"
                                            textColor="#ffffff"
                                            onPress={this.requestSupport}
                                            accessibilityLabel="Request support"
                                            icon={this.state.sendingSupport ? 'progress-upload' : 'shield-key'}
                                            labelStyle={{ fontSize: 12 }}
                                            disabled={this.state.sendingSupport}
                                            loading={this.state.sendingSupport}
                                        >
                                            {this.state.sendingSupport ? 'Sending…' : 'Request support'}
                                        </Button>
                                    </View>
                                </React.Fragment>
                            ) : null}
                        </View>
                        ) : null}
                    </KeyboardAvoidingView>
                </SafeAreaView>
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
    account            : PropTypes.string,   // current user@domain — sender of the support file transfer
    requestSupportFromLogs : PropTypes.func, // app.js orchestrator: write temp file, key exchange, encrypted upload
    attachedLogContent : PropTypes.string,   // snapshot file contents when viewing a tapped log attachment; null in live-tail mode
    subtitle           : PropTypes.string,   // SIP URI of the log owner — only set when it differs from current account
};

export default ShowLogsModal;
