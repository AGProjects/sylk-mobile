import React, {Component, Fragment} from 'react';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import { View, TouchableOpacity } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import UserIcon from './UserIcon';
import VuMeter from './VuMeter';
import { Avatar, List, Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DarkModeManager from '../DarkModeManager';

import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  tileWrapper: {
    justifyContent: 'center',
    alignItems: 'stretch',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 6,
    marginVertical: 2,
    marginHorizontal: 8,
    overflow: 'hidden',
  },

  card: {
    height: 78,
    borderWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },

  cardWithFooter: {
    height: 78,
    borderWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  
  displayName: {
    fontSize: 16,
    color: 'white',
  },

  uri: {
    fontSize: 14,
    color: 'white',
  },

  media: {
    fontSize: 12,
    color: 'white',
    paddingBottom: 6,
    textAlign: 'right',
    // Same tabular-numeric treatment as the status text above —
    // keeps "8 ms" / "120 ms" / "Audio lost" from shifting the row
    // as the latency value changes width.
    fontVariant: ['tabular-nums'],
    minWidth: 56,
  },

  mediaMedium: {
    fontSize: 12,
    color: 'orange',
    paddingBottom: 6,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    minWidth: 56,
  },

  mediaBad: {
    fontSize: 12,
    color: 'red',
    paddingBottom: 6,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    minWidth: 56,
  },

  mediaGood: {
    fontSize: 12,
    color: 'green',
    paddingBottom: 6,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    minWidth: 56,
  },

  right: {
    fontSize: 12,
    color: 'white',
    textAlign: 'right',
    // Tabular-numeric digits so the ticking duration ("12:34" → "12:35")
    // keeps every digit at the same horizontal slot — without this,
    // proportional digits make the right-aligned text visibly jitter
    // each second as the leading digit's glyph width changes.
    // minWidth holds enough room for "hh:mm:ss" so the cluster
    // doesn't reflow when the duration crosses the 1-hour mark.
    fontVariant: ['tabular-nums'],
    minWidth: 56,
  },

  rightOrange: {
    fontSize: 12,
    color: 'orange',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    minWidth: 56,
  },

  rightGreen: {
    fontSize: 12,
    color: 'yellow',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    minWidth: 56,
  },

  statusBad: {
    fontSize: 12,
    color: 'red',
    textAlign: 'right',
  },

  statusBadDescription: {
    fontSize: 11,
    lineHeight: 14,
    color: 'red',
    paddingTop: 2,
    minHeight: 14,
  },

  vuRowDescription: {
    paddingTop: 4,
    minHeight: 14,
  },

  // Kick / close-X overlay — absolutely positioned 5 px in from the
  // tile's top-right corner (top:5 / right:5). Walked in from
  // -10/-10 → -5/-5 → 0/0 → 5/5 across successive "move left and
  // down 5 px" passes; the chip now sits visibly inside the tile
  // rather than at or past the corner. Floats over the List.Item
  // right slot so the duration / RTT text is undisturbed; zIndex
  // keeps it tappable above the rest of the tile content.
  kickButtonOverlay: {
    position: 'absolute',
    top: 5,
    right: 5,
    zIndex: 7,
  },

  // Inner description column wrapper. Adds a small paddingLeft so
  // the URI / VU / progress lines are nudged right of the avatar
  // rather than butting up against the column's left edge — small
  // visual breathing room that the user requested.
  // Inner description column wrapper. No paddingLeft — URI text and
  // VU meter sit flush against the description column's left edge,
  // aligned with the start of the title row above. Previously had
  // paddingLeft: 6 to nudge the lines off the column edge, but the
  // user prefers everything left-aligned at the column start.
  descriptionInner: {
    paddingLeft: 0,
  },

  // "Waiting for audio…" placeholder that takes the VU meter's slot
  // before the first audio level arrives. Same minHeight as the VU
  // row so the tile height is identical whether we're waiting or
  // showing the meter. Muted grey + italic to read as "we don't
  // have data yet".
  waitingForAudio: {
    paddingTop: 4,
    minHeight: 14,
    fontSize: 11,
    color: '#888888',
    fontStyle: 'italic',
  },

  // Invited-tile progress + result line, takes the VU meter's slot.
  // Same footprint as vuRowDescription / waitingForAudio so the tile
  // height is constant across "Waiting ...NN" → "408 No answer".
  // Slightly larger and not italicised so the countdown reads as
  // active state rather than passive placeholder text.
  progressLine: {
    paddingTop: 4,
    minHeight: 14,
    fontSize: 12,
    color: '#cccccc',
  },

  footerButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginTop: 2,
    marginLeft: -8,
  },

  clientLabel: {
    position: 'absolute',
    right: 16,
    bottom: 18,
    fontSize: 12,
    color: 'white',
    textAlign: 'right',
  },

  // Per-participant downstream bandwidth label, pinned to the
  // BOTTOM-RIGHT corner of the tile. Absolute positioning means the
  // VU meter and description column above are completely
  // untouched — the previous attempt to put this on the same line
  // as the VU meter broke percentage-widths inside the flex row and
  // the meter disappeared. Small font, muted grey, tabular-numeric
  // digits so the value doesn't jitter as it changes. `right` bumped
  // to 18 (was 8) to add a 10 px right margin so the speed label
  // sits in from the tile's right edge alongside the floating
  // close-X overlay above it.
  bandwidthCorner: {
    position: 'absolute',
    right: 18,
    bottom: 4,
    fontSize: 10,
    color: '#bbbbbb',
    fontVariant: ['tabular-nums'],
  },

  // Inline status-icon cluster. Two render contexts:
  //   1) Inside the duration row (default branch) — the icons sit to
  //      the RIGHT of the duration text on the same line.
  //   2) Next to the kick-button cluster (extraButtons branch) —
  //      icons inline at the same vertical centre as the kick button.
  // marginLeft (on this container AND on each individual icon)
  // provides the gap between the duration text and the first badge;
  // no right margin so the cluster hugs the tile's right edge.
  statusIconsInline: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
  },

  statusIcon: {
    marginLeft: 6,
  },

  // Row containing the duration text and the per-tile badges. Sits
  // INSIDE the mediaContainer column as its first row; the media
  // text (latency / loss / "Waiting for audio…") follows on a
  // second line below. flex-end keeps the row right-aligned within
  // the right column, matching the original status-text alignment.
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },

  userIconContainer: {
    paddingRight: 0,
    paddingLeft: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Relative-positioned wrapper around the 40x40 avatar so an
  // absolutely-positioned status overlay can anchor itself to the
  // avatar's corners (specifically the raised-hand badge below).
  // Same size as the Avatar so the top/right offsets read against
  // the avatar's bounds and not the padded userIconContainer.
  avatarHost: {
    width: 40,
    height: 40,
    position: 'relative',
  },

  // Wrapper for the stacked-icon "yellow inside, black outline"
  // raised-hand glyph. The host is sized to match the inner icons
  // (14x14) so the outline icon can be absolutely-positioned on top
  // of the filled icon at the same origin.
  handStack: {
    width: 14,
    height: 14,
    position: 'relative',
  },

  handStackOutline: {
    position: 'absolute',
    top: 0,
    left: 0,
  },

  // "Thin outline" variant — same stack origin, but the outline icon
  // is scaled to ~0.9 so its strokes render visibly thinner against
  // the yellow fill underneath. The slight inset leaves a thin
  // yellow ring around the black outline, which the user reads as a
  // "softer / thinner" border than the 1:1 stacked treatment.
  handStackThinOutline: {
    position: 'absolute',
    top: 0,
    left: 0,
    transform: [{scale: 0.9}],
  },

  // SIP / BRIDGE label overlaid on the avatar's BOTTOM-LEFT corner.
  // Mirrors the raised-hand badge geometry on the top-right: small
  // chip with dark backplate, fixed offsets so the avatar circle's
  // edge is exactly the diagonal anchor.
  avatarSipBadge: {
    position: 'absolute',
    // Lowered from -4 to -10 so the chip sits a touch further below
    // the avatar circle's edge, mirroring the visual offset of the
    // raised-hand badge on the top-right corner without colliding
    // with the avatar's outline.
    bottom: -10,
    left: -6,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    zIndex: 10,
  },

  avatarSipBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  // Raised-hand overlay anchored to the top-right of the avatar.
  // Negative top/right pulls the badge past the avatar's circle so
  // it reads as a tag sitting above the silhouette rather than
  // overlapping it. Dark backplate gives the yellow hand contrast
  // against any user-photo background; the small border completes
  // the chip look. 18x18 outer hugs the 14px icon with a 2px ring.
  avatarHandBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 235, 59, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },

  userButtonsContainer: {
    // Fixed minimum width so the title / VU description area gets
    // the same horizontal space on every tile. Without this, tiles
    // that show a kick-button slot on the right (remote WebRTC and
    // SIP participants) get a different right-cluster width than
    // tiles that show the status/media text (local user, bridge),
    // which makes the VU meter on the local tile look narrower
    // than the meters on remote tiles. 100 keeps the duration + RTT
    // cluster wide enough that "12:34" / "Waiting for audio…" don't
    // wrap.
    minWidth: 100,
    flexDirection: 'row',
    // flex-end shifts the action buttons + duration cluster to the
    // right edge of the right column.
    justifyContent: 'flex-end',
    // Centered so the action buttons line up with the duration
    // text on the same row.
    alignItems: 'center',
    // Cancel out the trailing slack between the right cluster and
    // the tile's right edge so the duration text tucks closer to
    // the border. The right column inherits paper's List.Item
    // padding (~16px); pulling 12 of that back here keeps the
    // border visually breathing without leaving an obvious gap
    // between the text and the edge.
    marginRight: -12,
    borderWidth: 0,
    borderColor: 'white'
  },

  mediaContainer: {
    flexDirection: 'column',
    // 10 px right margin so the duration / RTT cluster tucks 10 px in
    // from the tile's right border, giving the floating close-X
    // overlay above it some breathing room rather than letting the
    // text run flush against the edge.
    marginRight: 10,
    borderWidth: 0,
    borderColor: 'white'
  },

  // Container for the per-participant VU meter row, rendered as a
  // sibling below the participant's List.Item card. Tight vertical
  // padding so the meter hugs the row above without inflating each
  // attendee's overall row height by much. Horizontal padding lines
  // the meter up with the title/description text on the left, so a
  // tall conference list reads as a clean column of "name above,
  // bar below".
  vuRow: {
    paddingLeft: 62,
    paddingRight: 70,
    paddingBottom: 4,
    marginTop: -8,
  },

});


class ConferenceAudioParticipant extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            stream: null,
            // Sticky last-non-zero bandwidth. Bandwidth samples arrive
            // from the parent (ConferenceBox) every ~5 s; between
            // samples and on transient `0` readings (e.g. the gateway
            // hadn't computed a fresh number yet) the live prop drops
            // to 0 and the indicator would otherwise blink off. We
            // cache the last useful value here and render it whenever
            // the live prop is missing / zero so the label stays put
            // until a fresh non-zero reading replaces it.
            lastBandwidth: (typeof props.bandwidth === 'number' && props.bandwidth > 0)
                ? props.bandwidth : null,
        }

        if (!props.isLocal && props.participant) {
            props.participant.on('stateChanged', this.onParticipantStateChanged);
        }
    }

    componentDidMount() {
        this.maybeAttachStream();
    }

    componentDidUpdate(prevProps) {
        // Refresh the sticky bandwidth cache whenever a fresh non-zero
        // sample arrives. Equality check avoids a setState loop on
        // unchanged values (each successful sample would otherwise
        // re-trigger setState → re-render → componentDidUpdate).
        if (typeof this.props.bandwidth === 'number'
                && this.props.bandwidth > 0
                && this.props.bandwidth !== this.state.lastBandwidth) {
            this.setState({lastBandwidth: this.props.bandwidth});
        }
    }

    componentWillUnmount() {
        if (!this.props.isLocal && this.props.participant) {
            this.props.participant.removeListener('stateChanged', this.onParticipantStateChanged);
        }
    }

    onParticipantStateChanged(oldState, newState) {
        if (newState === 'established') {
            this.maybeAttachStream();
        }
    }

    maybeAttachStream() {
        if (!this.props.participant) {
            return;
        }

        const streams = this.props.participant.streams;
        if (streams.length > 0) {
            if (!this.props.participant.videoPaused) {
                this.props.participant.pauseVideo();
            }
            this.setState({stream: streams[0]});
        }
    }

    render() {
        let identity = this.props.identity;
        // Theme-aware overrides for the tile chrome. The static
        // stylesheet hard-codes white text and a translucent-white
        // border tuned to the legacy dark conference background; on
        // the new Day-mode (light linen) background those styles
        // disappeared. We pull the active theme once per render and
        // layer per-property overrides on top of the static styles
        // — keeping the stylesheet itself untouched so Night-mode
        // behaviour is preserved 1:1.
        const _tileTheme = DarkModeManager.getTheme();
        const _isDark = _tileTheme.isDark;
        const _tileTextColor = _isDark ? '#FFFFFF' : _tileTheme.textPrimary;
        const _tileMutedColor = _isDark ? '#bbbbbb' : _tileTheme.textSecondary;
        const _tileBorderColor = _isDark
            ? 'rgba(255, 255, 255, 0.18)'
            : 'rgba(0, 0, 0, 0.18)';
        const _tileBgColor = _isDark
            ? 'transparent'
            : _tileTheme.surface;
        const _tileBadgePlateBg = _isDark
            ? 'rgba(0, 0, 0, 0.65)'
            : 'rgba(255, 255, 255, 0.85)';
        const _tileBadgePlateText = _isDark ? '#FFFFFF' : _tileTheme.textPrimary;
        // Theme overrides applied per-element below.
        const _tileWrapperStyle = [
            styles.tileWrapper,
            { borderColor: _tileBorderColor, backgroundColor: _tileBgColor },
        ];
        const _displayNameStyle = [styles.displayName, { color: _tileTextColor }];
        const _uriStyle = [styles.uri, { color: _tileTextColor }];
        const _clientLabelStyle = [styles.clientLabel, { color: _tileTextColor }];
        const _bandwidthCornerStyle = [styles.bandwidthCorner, { color: _tileMutedColor }];
        // "Waiting for audio…" placeholder + invited-tile progress
        // line. Both used a fixed mid-grey that vanished on the new
        // light Day tile. textSecondary flips with the theme so the
        // placeholder reads in both Day and Night.
        const _waitingForAudioStyle = [styles.waitingForAudio, { color: _tileMutedColor }];
        const _progressLineStyle = [styles.progressLine, { color: _tileMutedColor }];
        const _sipBadgeStyle = [styles.avatarSipBadge, { backgroundColor: _tileBadgePlateBg }];
        const _sipBadgeTextStyle = [styles.avatarSipBadgeText, { color: _tileBadgePlateText }];

        // Default duration-text style — the "normal" rightStyle in
        // the static stylesheet is white; theme it like the other
        // text. The Orange / Yellow / Red variants are accent
        // colours that read across both themes, so we keep them as-
        // is.
        let rightStyle = [styles.right, { color: _tileTextColor }] ;

        if (this.props.status === 'Muted') {
            rightStyle = styles.rightOrange;
        } else if (this.props.status && this.props.status.indexOf('kbit') > -1) {
            rightStyle = styles.rightGreen;
        }

        const _statusStr = typeof this.props.status === 'string' ? this.props.status.trim() : '';
        const isFailure = /^[3-6]\d\d\b/.test(_statusStr);
        if (isFailure) {
            rightStyle = styles.statusBad;
        }

        // RTT (latency) text suppressed per user request — the
        // "Xms" / "X% loss" / "Audio lost" line next to the duration
        // was deemed noise. Loss conditions are still observable via
        // the badge / VU meter; the per-tile latency display is
        // hidden. Restore by reinstating the conditional assignments
        // to `media` below.
        let media = '';
        let mediaStyle = styles.mediaGood;
        // NOTE: the "Waiting for audio..." placeholder used to live
        // in the right-column media slot. It now renders in the
        // description column where the VU meter goes, so the tile
        // doesn't show a label on the right that has nothing to do
        // with the connection metrics. The check is duplicated in
        // the description render below.
        
        //console.log(mediaStyle);

        // Show a per-participant VU meter when an audioLevel was
        // supplied by ConferenceBox. The level (0..1) is sampled at
        // ~5 Hz from WebRTC's getStats() on each participant's PC
        // (remote = inbound-rtp audioLevel; local mic = media-source
        // audioLevel) and forwarded down here as a plain number prop
        // — the meter component itself stays pure-render. We gate
        // on `audioLevel !== undefined` so callers that don't pass
        // the prop (e.g. invited-not-yet-joined rows with no PC
        // yet) suppress the meter entirely rather than rendering
        // a permanently-dark bar that would imply the participant
        // is connected-but-silent.
        const hasLevel = typeof this.props.audioLevel === 'number';

        // Per-participant status badges. Two render locations now:
        //   • Raised hand → absolutely positioned OVER the avatar in
        //     the left column (top-right of the avatar circle).
        //   • Muted       → inline in the right column next to the
        //     duration text, same row as before.
        // Mute is suppressed for the local user (this.props.isLocal —
        // myself has its own mute control in the bottom action bar)
        // and for the bridge. The raised-hand indicator is shown for
        // every participant that sets the flag, including self, so
        // the user has visible confirmation that their own hand is
        // up.
        // Legacy in-row muted badge — suppressed when an
        // `inlineMuteButton` is supplied by the parent. ConferenceBox
        // now passes its own (and interactive) microphone icon via
        // that prop for SIP / WebRTC remote tiles, which sits in
        // userButtonsContainer alongside the duration cluster. Leaving
        // the legacy badge on top of it produced a "double mic" when
        // muted. Tiles that don't ship inlineMuteButton (e.g. some
        // older callers) still get the read-only legacy badge.
        const showMutedBadge = this.props.muted
            && !this.props.isLocal
            && !this.props.isBridge
            && !this.props.inlineMuteButton;
        const showRaisedHandBadge = this.props.raisedHand && !this.props.isBridge;

        // Inline badges in the right column. Hand has moved to the
        // avatar overlay below; this cluster now only carries the
        // legacy mute icon (when applicable). Kept as a discrete View
        // so future status badges have an obvious place to land.
        const badgesNode = showMutedBadge ? (
            <View style={styles.statusIconsInline} pointerEvents="none">
                <Icon
                    name="microphone-off"
                    size={18}
                    color="#e57373"
                    style={styles.statusIcon}
                />
            </View>
        ) : null;

        // Avatar overlay — small solid-yellow filled hand glyph
        // anchored to the top-right of the user icon. No stacked
        // outline: at 14 px the black outline crowded the yellow
        // fill and the badge looked busy. The dark backplate of the
        // chip provides enough contrast for the palm to read on
        // its own. The top-bar toggle button keeps the stacked
        // yellow + black outline treatment since it's larger.
        const avatarHandBadge = showRaisedHandBadge ? (
            <View style={styles.avatarHandBadge} pointerEvents="none">
                <Icon
                    name="hand-back-right"
                    size={14}
                    color="#FFEB3B"
                />
            </View>
        ) : null;

        return (
            <View style={_tileWrapperStyle}>
            <List.Item
                style={isFailure ? styles.cardWithFooter : styles.card}
                title={identity.displayName||identity.uri}
                titleStyle={_displayNameStyle}
                titleNumberOfLines={1}
                titleEllipsizeMode="tail"
                description={(descProps) => (
                    <View style={styles.descriptionInner}>
                        <Text style={_uriStyle} numberOfLines={1} ellipsizeMode="tail">{identity.uri}</Text>
                        {isFailure ? (
                            <Text style={styles.statusBadDescription} numberOfLines={1} ellipsizeMode="tail">{_statusStr}</Text>
                        ) : (typeof this.props.progressText === 'string' && this.props.progressText.length > 0) ? (
                            // Invited-tile progress / result text —
                            // renders in the VU-meter slot (3rd line)
                            // instead of in the right column. Used to
                            // show "Waiting ...NN" while the invite
                            // window is counting down, then the
                            // result text (e.g. "408 No answer") once
                            // the window expires. Same footprint as
                            // the VU row so the layout doesn't jump.
                            <Text style={_progressLineStyle} numberOfLines={1} ellipsizeMode="tail">
                                {this.props.progressText}
                            </Text>
                        ) : hasLevel ? (
                            <View style={styles.vuRowDescription}>
                                <VuMeter
                                    level={this.props.audioLevel}
                                    width="100%"
                                    cellHeight={5}
                                />
                            </View>
                        ) : (!this.props.noAudioMetrics && !this.props.isLocal) ? (
                            // "Waiting for audio…" placeholder in the
                            // VU-meter slot. Renders here (description
                            // column) instead of in the right-column
                            // media slot where it used to live — the
                            // user wanted it where the meter would be.
                            // Same minHeight / paddingTop as the VU
                            // row so the tile doesn't jump when the
                            // first audio level lands.
                            <Text style={_waitingForAudioStyle} numberOfLines={1} ellipsizeMode="tail">
                                Waiting for audio…
                            </Text>
                        ) : (
                            <Text style={styles.statusBadDescription}> </Text>
                        )}
                    </View>
                )}
                left={props => <View style={styles.userIconContainer}>
                                  {/* Relative-positioned host so the
                                      raised-hand badge can anchor to
                                      the avatar's top-right corner.
                                      The 40x40 inner View matches the
                                      Avatar size so the badge offsets
                                      are predictable. */}
                                  <View style={styles.avatarHost}>
                                    {this.props.isBridge
                                      ? <Avatar.Icon size={40} icon="bridge" />
                                      : <UserIcon size={40} identity={identity}/>}
                                    {avatarHandBadge}
                                    {/* SIP / BRIDGE pill — small
                                        label overlaid on the avatar's
                                        BOTTOM-LEFT corner, mirroring
                                        the raised-hand top-right
                                        placement. Replaces the
                                        bottomLabel-in-media branch:
                                        the label was eating the
                                        latency slot for SIP tiles,
                                        which made it impossible to
                                        also surface RTT/loss from the
                                        bridge transfer below.
                                        pointerEvents:none so taps
                                        still reach the avatar. */}
                                    {(typeof this.props.bottomLabel === 'string' && this.props.bottomLabel.length > 0) ? (
                                        <View style={_sipBadgeStyle} pointerEvents="none">
                                            <Text style={_sipBadgeTextStyle} numberOfLines={1}>
                                                {this.props.bottomLabel}
                                            </Text>
                                        </View>
                                    ) : null}
                                  </View>
                               </View>
                      }
                right={props =>
                           <View style={styles.userButtonsContainer}>
                              {/* Right-slot layout, left → right:
                                    [inlineMuteButton] [extraButtons]
                                    [mediaContainer]
                                  The mic icon (passed by ConferenceBox
                                  for SIP and WebRTC remote tiles) sits
                                  at the LEFT of the cluster so the
                                  destructive duration row stays at the
                                  right edge. extraButtons is a legacy
                                  slot kept for backward compatibility;
                                  no current caller wires it. */}
                              {this.props.inlineMuteButton
                                ? this.props.inlineMuteButton
                                : null}
                              {this.props.extraButtons && this.props.extraButtons.length > 0
                                ? this.props.extraButtons
                                : null}
                              {this.props.suppressMediaContainer ? null : (
                                <View style={styles.mediaContainer}>
                                  <View style={styles.statusRow}>
                                    {/* Badges sit to the LEFT of the
                                        duration text so the row reads
                                        "🖐 12:34" — user-readable order
                                        with the indicator preceding the
                                        time it qualifies. statusRow is
                                        right-aligned, so the cluster as
                                        a whole still hugs the tile's
                                        right edge.

                                        Failure path (3xx/4xx/5xx/6xx,
                                        including the synthesised
                                        "408 No answer" on invite
                                        timeout): the status text is
                                        already rendered in the VU-meter
                                        slot via progressText, so we
                                        suppress it here. Otherwise the
                                        same "408 No answer" / "5xx ..."
                                        string would also appear on the
                                        right side next to the
                                        delete/retry buttons, which the
                                        user explicitly does not want. */}
                                    {badgesNode}
                                    {!isFailure ? (
                                      <Text style={rightStyle} numberOfLines={1} ellipsizeMode="tail">{this.props.status}</Text>
                                    ) : null}
                                  </View>
                                  <Text style={mediaStyle} numberOfLines={1} ellipsizeMode="tail">{media}</Text>
                                </View>
                              )}
                              {/* RTCView reserves layout width even
                                  when streamURL is null on some
                                  platforms, which left a phantom gap
                                  between the duration text and the
                                  tile's right edge. Only render the
                                  RTCView when we actually have a
                                  stream attached. */}
                              {this.state.stream ? (
                                <RTCView streamURL={this.state.stream.toURL()} />
                              ) : null}
                           </View>
                      }
            />
            {/* Top-right floating kick / close-X button. Rendered
                outside the List.Item so its absolute position anchors
                to the tileWrapper (the tile's outer bounds) rather
                than to the right slot's content; that keeps the X at
                the corner regardless of how wide the duration / media
                cluster ends up being. */}
            {this.props.kickButton ? (
                <View style={styles.kickButtonOverlay}>
                    {this.props.kickButton}
                </View>
            ) : null}
            {this.props.clientLabel ? (
                <Text style={_clientLabelStyle} numberOfLines={1} ellipsizeMode="tail">{this.props.clientLabel}</Text>
            ) : null}
            {/* Per-participant bandwidth label, anchored to the
                tile's BOTTOM-RIGHT corner via absolute positioning.
                Arrow direction follows isLocal — ↑ for the self
                tile (upload), ↓ for remote tiles (download from
                that participant). Deliberately overlaid on the
                existing layout rather than embedded in the
                description row so the VU meter isn't disturbed.
                Renders the LIVE prop when it's a non-zero sample
                and falls back to the sticky last-seen value
                (state.lastBandwidth) on transient 0 / undefined
                readings — without this the label was blinking off
                between sampling windows. Only suppressed entirely
                when no useful bandwidth has ever arrived. */}
            {(() => {
                const _liveBw = (typeof this.props.bandwidth === 'number' && this.props.bandwidth > 0)
                    ? this.props.bandwidth
                    : null;
                const _bwToShow = _liveBw !== null ? _liveBw : this.state.lastBandwidth;
                if (typeof _bwToShow !== 'number' || _bwToShow <= 0) {
                    return null;
                }
                return (
                    <Text style={_bandwidthCornerStyle} numberOfLines={1} pointerEvents="none">
                        {(this.props.isLocal ? '↑ ' : '↓ ') + (_bwToShow >= 1000
                            ? (_bwToShow / 1000).toFixed(1) + ' Mbps'
                            : Math.round(_bwToShow) + ' kbps')}
                    </Text>
                );
            })()}
            </View>
        );
    }
}

ConferenceAudioParticipant.propTypes = {
    identity: PropTypes.object.isRequired,
    participant: PropTypes.object,
    isLocal: PropTypes.bool,
    isBridge: PropTypes.bool,
    status: PropTypes.string,
    // Invited-tile progress / result string. When set, takes the
    // VU-meter slot (3rd line of the tile) so a single label shows
    // the countdown "Waiting ...NN" and then the result text
    // "408 No answer" / "Accepted" without ever competing with
    // connection metrics or the audio meter.
    progressText: PropTypes.string,
    loss: PropTypes.number,
    latency: PropTypes.number,
    // Per-participant downstream bandwidth in kbps (audio + video on
    // this PC). Rendered as a small ↓-prefixed label in the tile's
    // bottom-right corner via absolute positioning; the VU-meter
    // row in the description column is left untouched.
    bandwidth: PropTypes.number,
    codec: PropTypes.string,
    // Audio signal level (0..1) for the per-participant VU meter.
    // Optional — when omitted the meter row is suppressed (used
    // for invited-but-not-yet-joined attendees that have no peer
    // connection to sample from).
    audioLevel: PropTypes.number,
    // Per-participant status flags rendered as top-right badges.
    // muted: microphone-off icon shown unless isLocal or isBridge.
    // raisedHand: hand icon shown unless isBridge (self IS allowed
    // so the user can see their own hand is up).
    muted: PropTypes.bool,
    raisedHand: PropTypes.bool,
    extraButtons: PropTypes.array,
    // Optional inline mute icon rendered to the RIGHT of the VU meter
    // inside the description column, on the same row. Passed in by
    // ConferenceBox for SIP and WebRTC remote tiles so the mute
    // affordance lives next to the audio level it qualifies, instead
    // of mixed in with the kick button in the right slot.
    inlineMuteButton: PropTypes.node,
    // Optional floating kick / close-X button anchored to the tile's
    // top-right corner. Passed in by ConferenceBox for kickable
    // remote participants; rendered as an absolutely-positioned
    // overlay on tileWrapper.
    kickButton: PropTypes.node,
    // When true, the right-slot mediaContainer (duration + status
    // text + RTT line) is not rendered. Used for failed-invite tiles
    // so only the retry button shows on the right; the failure
    // status itself is surfaced via progressText in the VU row slot.
    suppressMediaContainer: PropTypes.bool
};


export default ConferenceAudioParticipant;
