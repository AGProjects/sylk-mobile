import React, { Component } from 'react';
import ThemedModalSurface from './ThemedModalSurface';
import { getModalColors } from '../paperTheme';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Modal, View, TouchableWithoutFeedback, KeyboardAvoidingView, Platform, TouchableOpacity, Dimensions, Linking, AppState, StyleSheet } from 'react-native';
import { Text, Button, Surface, RadioButton, Checkbox, ActivityIndicator as PaperActivityIndicator } from 'react-native-paper';
import Icon from '@react-native-vector-icons/material-design-icons';
import { openSettings } from 'react-native-permissions';
import PrivacyRadiusSlider from './PrivacyRadiusSlider';
// StaticMap is the slippy-map tile renderer used by LocationBubble.
// Reused here in meet-mode to draw the destination preview once the
// URL has resolved to coords. Lives in LocationBubble.js so the
// projection / tile cache / pin code stays in one place.
// pickZoomToFitPoints lets us seed the preview's initial zoom from
// the user-pin/destination bounding box so when both points land
// the map auto-zooms out instead of leaving the user pin offscreen
// at street-level zoom.
import { StaticMap, pickZoomToFitPoints } from './LocationBubble';

// Quick haversine-distance helper — matches the algorithm used in
// NavigationBar's _haversineMeters but kept local so the modal
// doesn't have to import a class method via a long path.
function haversineMeters(a, b) {
    if (!a || !b
            || typeof a.latitude !== 'number'
            || typeof a.longitude !== 'number'
            || typeof b.latitude !== 'number'
            || typeof b.longitude !== 'number') {
        return null;
    }
    const R = 6371008;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const x = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLng / 2) ** 2);
    return 2 * R * Math.asin(Math.sqrt(x));
}

// Format metres for display: "120 m" / "1.2 km" / "12 km".
function formatDistance(m) {
    if (m == null || !Number.isFinite(m)) return null;
    if (m < 1000) return `${Math.round(m)} m`;
    if (m < 10000) return `${(m / 1000).toFixed(1)} km`;
    return `${Math.round(m / 1000)} km`;
}

// Extract the first letter of a name as initials. Falls back to '?'
// when the name is missing — same convention LocationBubble uses
// internally so the avatar visual stays consistent across maps.
function initialsFromName(name) {
    if (!name || typeof name !== 'string') return '?';
    const trimmed = name.trim();
    if (!trimmed) return '?';
    // Strip @domain on URIs like alice@example.com → "alice"
    const localPart = trimmed.split('@')[0];
    if (!localPart) return '?';
    return localPart.charAt(0).toUpperCase();
}

// Zoom bounds for the preview map. Mirrors the LocationBubble values
// so the preview's zoom feel matches the in-bubble map. CartoDB /
// OSM mirror serves up to 18 reliably; below 3 the world wraps and
// the preview becomes useless context.
const PREVIEW_MIN_ZOOM = 3;
const PREVIEW_MAX_ZOOM = 18;
const PREVIEW_DEFAULT_ZOOM = 15;

// Match EditContactModal's look (Modal + Surface with borderRadius: 10)
// so the dialog corners are subtly rounded instead of the pronounced
// curve Paper's <Dialog> uses. `modalSurface` lives in ContainerStyles.
import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/blink/_DeleteMessageModal.scss';

const HOUR_MS = 60 * 60 * 1000;

// The duration picker is three independent controls, not one radio list:
//
//   1. "Until I return"  — a standalone auto-stop share (kind
//      'untilIReturn'). Mutually EXCLUSIVE with everything else: it runs
//      until the user returns to their starting point (NavigationBar
//      watches for departure-then-return) or the 8h ceiling, whichever
//      first. Selecting it clears the meet checkbox; the interval radio
//      is ignored while it's on.
//
//   2. "Until we meet"   — a CHECKBOX (kind 'meetingRequest') that layers
//      on top of the interval radio. It stamps meeting_request:true on the
//      origin tick, and the selected interval becomes its expiry cap
//      (default 8h — MEET_DEFAULT_DURATION_MS — when the user hasn't picked
//      an explicit interval). "Once" can't cap a live meet share, so the
//      two are mutually exclusive: checking meet bumps a "Once" selection
//      up to the 8h default, and selecting "Once" clears the meet checkbox.
//
//   3. The interval radio — 'once' | '4 hours' | '8 hours' | '24 hours'.
//      On its own ('once'/'fixed') it's a plain timed share with no
//      handshake. Combined with the meet checkbox it just supplies the cap.
//
//   value       — duration in milliseconds (the maximum cap; the share can
//                 stop earlier on its own — meet handshake / return detect).
//   label       — what the user sees in the picker.
//   periodLabel — what appears in the outgoing "I am sharing the location
//                 with you …" text.
//   kind        — 'meetingRequest' | 'untilIReturn' | 'once' | 'fixed'.

// Interval radio (right column). Always has exactly one selection; it is
// simply ignored when "Until I return" is active.
const INTERVAL_OPTIONS = [
    // One-shot: a single GPS fix is acquired and a single location message
    // ships. No timer, no follow-up ticks. Receiver renders a static
    // "Shared location" bubble. Mutually exclusive with the meet checkbox.
    {value: 0,           label: 'Once',     periodLabel: 'now',      kind: 'once'},
    {value: 2 * HOUR_MS, label: '2 hours',  periodLabel: '2 hours',  kind: 'fixed'},
    {value: 4 * HOUR_MS, label: '4 hours',  periodLabel: '4 hours',  kind: 'fixed'},
    {value: 8 * HOUR_MS, label: '8 hours',  periodLabel: '8 hours',  kind: 'fixed'},
    {value: 24 * HOUR_MS, label: '24 hours', periodLabel: '24 hours', kind: 'fixed'},
];
const INTERVAL_ONCE_INDEX = 0;
// The interval used as the default cap for an "Until we meet" share when the
// user hasn't picked an explicit interval (or has "Once" selected, which
// can't cap a live share). Product default is 8h.
const INTERVAL_DEFAULT_MEET_INDEX = 3; // '8 hours'
const MEET_DEFAULT_DURATION_MS = INTERVAL_OPTIONS[INTERVAL_DEFAULT_MEET_INDEX].value;
// Default duration for an "Until stopped" share when the user switches into
// that mode from "Once" (which carries no duration). The interval column is
// that share's expiry cap — a plain live share that runs until the user stops
// it or this ceiling is reached. 8h matches the meet default and the typical
// "out for a while" framing.
const INTERVAL_DEFAULT_FIXED_INDEX = 3; // '8 hours'

// "Until I return" — standalone, exclusive. Caps at 8h: the auto-stop kicks
// in once the user comes back to within UNTIL_RETURN_RETURN_THRESHOLD_M of
// where they started (but only after they've actually left, else it would
// self-stop the moment it began). 8h is a generous-but-finite ceiling for a
// typical "out for the day" excursion; if the user never returns, the share
// lapses on its own. Exposed to all contacts (not just caregivers) — the
// "I'll let you know I'm home" intent isn't specific to that relationship.
const UNTIL_RETURN_OPTION = {
    value: 8 * HOUR_MS,
    label: 'Until I return',
    periodLabel: 'until I return',
    kind: 'untilIReturn',
};


// ---------------------------------------------------------------------------
// Stop-condition pills.
//
// The four stop conditions used to be a column of identical grey radio
// buttons distinguished only by their English labels. That's unusable for
// the people this feature is actually for: an elderly or non-English-speaking
// user being talked through the screen over the phone. A helper can't say
// "press the third radio button" and be understood.
//
// So each mode now renders as a pill with its OWN colour and its OWN glyph —
// two independent, language-free handles. Over the phone it becomes "press
// the green one with the round arrow", which works regardless of what the
// label says or whether the user can read it.
//
// Selected = solid fill in the mode's colour with white icon+label.
// Unselected = same colour as a 2px outline with coloured icon+label.
// That's a large, unmistakable difference at arm's length, and it doesn't
// rely on colour alone (fill vs. outline + a distinct glyph per row), so it
// still reads for colour-blind users.
//
// Colours are picked to be nameable in any language ("green", "blue") and
// far enough apart in hue to survive a cheap screen: blue / orange / green /
// purple. Icon names are @react-native-vector-icons/material-design-icons
// glyphs (verified present in the bundled glyphmap).
const MODE_PILLS = {
    // `color` is the saturated fill used when the pill is selected (and, at low
    // alpha, as the always-on tint when it isn't). `lightColor` is the pale
    // variant used for the icon/label/border of an UNSELECTED pill in dark
    // mode, where the mid-tone brand colour doesn't have the contrast to be
    // read as text.
    //
    // A single pin dropped once — one fix, then done.
    once:         { icon: 'map-marker',        color: '#1565C0', lightColor: '#7FB2F0' }, // blue
    // A clock: it keeps running until you stop it.
    untilStopped: { icon: 'clock-outline',     color: '#EF6C00', lightColor: '#FFB74D' }, // orange
    // A circle of arrow curving back on itself — "goes away and comes back
    // round", the same shape as the activity spinner people already see
    // everywhere else on the phone.
    untilReturn:  { icon: 'restore',           color: '#2E7D32', lightColor: '#81C784' }, // green
    // Two people side by side — the two of you converging on one point.
    meet:         { icon: 'account-multiple',  color: '#6A1B9A', lightColor: '#CE93D8' }, // purple
};

const pillStyles = StyleSheet.create({
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        // Generous vertical padding: this is a touch target for someone with
        // unsteady hands, not a dense settings list.
        paddingVertical: 10,
        paddingHorizontal: 12,
        marginBottom: 8,
        marginRight: 6,
        borderRadius: 24,
        borderWidth: 2,
        minHeight: 44, // iOS HIG minimum tappable height
    },
    // Lift the selected pill off the sheet so the choice is legible even to
    // someone who can't distinguish the tint from the fill.
    pillSelected: {
        elevation: 3,
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
    },
    pillLabel: {
        marginLeft: 8,
        fontSize: 14,
        fontWeight: '600',
        flexShrink: 1,
    },
});

class ShareLocationModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            show: props.show,
            // The picker is three independent controls (see the constants
            // block up top). All three are seeded from
            // ShareLocationModal.defaultSelectionFor(props): caregiver
            // contacts open with "Until I return" checked, the meet-me-there
            // flow opens with "Until we meet" checked at the 8h default cap,
            // and everybody else opens with just "Once" selected — the same
            // low-commitment default we had before this feature.
            //
            //   selectedInterval   — index into INTERVAL_OPTIONS (the radio).
            //                        Always valid; ignored while untilReturn
            //                        is checked.
            //   meetChecked        — "Until we meet" checkbox. Layers the
            //                        meeting-handshake on top of the interval
            //                        (which becomes its expiry cap).
            //   untilReturnChecked — "Until I return" exclusive toggle.
            ...ShareLocationModal.defaultSelectionFor(props),
            // Privacy radius (metres). Only meaningful for the
            // "Until we meet" path. 0 disables the gate; non-zero values
            // tell NavigationBar to swallow every outgoing location tick
            // whose coordinates are within `excludeOriginRadiusMeters`
            // of the user's first GPS fix. Ticks resume the moment the
            // user moves past the radius. Seeded from
            // props.defaultPrivacyRadiusMeters (a device preference
            // recorded the last time the user confirmed a share with
            // a chosen radius), so a user who has settled on e.g.
            // 500 m doesn't have to reselect on every share.
            excludeOriginRadiusMeters: Number(props.defaultPrivacyRadiusMeters) || 0,
            // Zoom level for the meet-mode destination preview map.
            // null means "auto-fit" — let StaticMap's
            // pickZoomToFitPoints pick a zoom that frames every
            // visible point (destination + user pin once it lands +
            // privacy circle once selected). The +/- buttons set
            // this to a numeric value, switching from auto-fit to
            // manual zoom; from then on the user is in control until
            // the modal closes (we reset to null on reopen).
            // Without this, the map stayed at street-level (15) even
            // after the user pin landed kilometres away, leaving the
            // pin offscreen.
            meetPreviewZoom: null,
            // "Do not show this again" checkbox below the disclaimer.
            // Defaults to CHECKED so the common-case user (who
            // already understands the data-handling story after
            // seeing it once) can press Confirm in one tap and
            // never see the paragraph again. Untick it to keep the
            // disclaimer visible on future shares. Persists ONLY if
            // the user actually presses Confirm — Cancelling out of
            // the modal should not suppress future disclaimers,
            // since the user's intent wasn't to share. Suppression
            // is sticky across share sessions until the user opts
            // out of the privacy policy, which clears the flag in
            // app_state.
            dontShowDisclaimerAgain: true,
            // True from the moment the user taps "Share" until the parent's
            // onConfirm settles — i.e. the first GPS fix has been acquired
            // and the initial location message sent (or the attempt failed).
            // While true the Share button shows a spinner ringing its
            // map-marker icon and both buttons are disabled, so the user gets
            // immediate feedback and can't fire the share twice during the
            // acquire latency. We stay in the modal for that whole window and
            // only close once it clears.
            sharing: false,
        };
    }

    // Static helper so the constructor and CWRP both pick the same
    // default. Caregivers default to "Until I return"; non-caregivers
    // keep the historical "Once" default (lowest-commitment for a
    // day-to-day "send my current location" share).
    // True when the OS-level location grant is foreground-only — iOS
    // "While Using" or Android fine-location-without-background. In that
    // state the only share that actually works is a single "Once" fix:
    // every timed/live kind (Until I return, Until we meet, the hourly
    // options) drives a background watchPosition/interval that iOS/Android
    // suspend the moment the app leaves the foreground, so they need
    // "Always" to be meaningful. 'always' / 'undetermined' / null all read
    // as NOT foreground-only here — we only gate when we positively know
    // the grant is foreground-only, so we never falsely lock the picker.
    static _isForegroundOnly(level) {
        return level === 'whenInUse' || level === 'foregroundOnly';
    }

    // Seed the three picker controls on open. Returns
    // {selectedInterval, meetChecked, untilReturnChecked}. Spread into
    // state by the constructor and CWRP so both pick the same default.
    // Map a left-column mode to the underlying {selectedInterval, meetChecked,
    // untilReturnChecked} triple, and back. Used by defaultSelectionFor to seed
    // the picker away from an already-live session type.
    static _selectionForMode(mode) {
        if (mode === 'once') {
            return { selectedInterval: INTERVAL_ONCE_INDEX, meetChecked: false, untilReturnChecked: false };
        }
        if (mode === 'untilReturn') {
            return { selectedInterval: INTERVAL_ONCE_INDEX, meetChecked: false, untilReturnChecked: true };
        }
        if (mode === 'meet') {
            return { selectedInterval: INTERVAL_DEFAULT_MEET_INDEX, meetChecked: true, untilReturnChecked: false };
        }
        return { selectedInterval: INTERVAL_DEFAULT_FIXED_INDEX, meetChecked: false, untilReturnChecked: false };
    }

    static _modeOfSelection(sel) {
        if (sel.untilReturnChecked) return 'untilReturn';
        if (sel.meetChecked) return 'meet';
        const opt = INTERVAL_OPTIONS[sel.selectedInterval];
        if (opt && opt.kind === 'once') return 'once';
        return 'untilStopped';
    }

    // Public seeder: compute the natural default, then steer it away from any
    // session type that's already live for the contact so the picker never
    // opens on a disabled option.
    static defaultSelectionFor(props) {
        const raw = ShareLocationModal._rawDefaultSelectionFor(props);
        const lt = (props && props.liveTypes) || {};
        if (!lt.meet && !lt.share) return raw;
        const mode = ShareLocationModal._modeOfSelection(raw);
        const disabled = (m) => (m === 'meet' && lt.meet)
            || ((m === 'untilStopped' || m === 'untilReturn') && lt.share);
        if (!disabled(mode)) return raw;
        if (!lt.share) return ShareLocationModal._selectionForMode('untilStopped');
        if (!lt.meet) return ShareLocationModal._selectionForMode('meet');
        return ShareLocationModal._selectionForMode('once');
    }

    static _rawDefaultSelectionFor(props) {
        const base = {
            selectedInterval: INTERVAL_ONCE_INDEX,
            meetChecked: false,
            untilReturnChecked: false,
        };
        // Foreground-only grant ("While Using") — force the low-commitment
        // "Once" default and, in render, disable every other option. There's
        // no point pre-selecting a timed share the user can't actually run
        // in the background. Checked FIRST so it overrides the caregiver /
        // preset defaults below; the meet-me flow opens with an unknown
        // (null) permission level, so it is never caught here.
        if (props && ShareLocationModal._isForegroundOnly(props.permissionLevel)) {
            return base;
        }
        // "Meet me there..." flow: the caller staged a destination and wants
        // the meet-up handshake pre-selected so the user just has to tap
        // Start. Takes priority over caregiver / once because the destination
        // ONLY carries semantic weight in the meet-up flow. Open with the
        // meet checkbox on and the interval seeded to the 8h default cap.
        if (props && (props.presetKind === 'meetingRequest' || props.meetMode)) {
            return {
                selectedInterval: INTERVAL_DEFAULT_MEET_INDEX,
                meetChecked: true,
                untilReturnChecked: false,
            };
        }
        // Caregiver contacts ALWAYS default to "Until I return", and we
        // deliberately IGNORE any learned per-contact preference for them.
        // A caregiver's purpose is open-ended presence sharing, so the safe
        // default must not be overridden by a one-off (e.g. "Once") the user
        // happened to pick last time. Placed ABOVE the saved-option restore so
        // the caregiver default wins over learned settings. Foreground-only
        // grant and the explicit meet-me flow above still take priority: the
        // first is a technical constraint (a background "until return" can't
        // run under a "While Using" grant), the second an explicit per-tap
        // choice — neither is a "learned setting".
        if (props && props.isCaregiver) {
            return {
                selectedInterval: INTERVAL_ONCE_INDEX,
                meetChecked: false,
                untilReturnChecked: true,
            };
        }
        // Restore the user's last-used share option for THIS contact — a
        // local, non-synced per-contact preference persisted on Confirm
        // (see onConfirm → onPersistShareOption, stored by app.js
        // saveShareLocationPrefs under contact.localProperties). We only
        // ever persist / restore once | untilStopped | untilReturn (never
        // "meet" — that's a per-invocation context set by the meet-me flow
        // above, not a remembered preference). Only reached for NON-caregiver
        // contacts (caregivers are handled just above and never fall through
        // to a learned setting), and only when the grant isn't foreground-only
        // and this isn't the meet-me flow.
        const saved = props && props.lastShareOption;
        if (saved && saved.mode && saved.mode !== 'meet') {
            if (saved.mode === 'once') {
                return {
                    selectedInterval: INTERVAL_ONCE_INDEX,
                    meetChecked: false,
                    untilReturnChecked: false,
                };
            }
            if (saved.mode === 'untilReturn') {
                return {
                    selectedInterval: INTERVAL_ONCE_INDEX,
                    meetChecked: false,
                    untilReturnChecked: true,
                };
            }
            if (saved.mode === 'untilStopped') {
                // Restore the saved interval if it's still a valid fixed
                // entry; otherwise fall back to the 8h default cap.
                const _si = saved.selectedInterval;
                const _validFixed = typeof _si === 'number'
                    && INTERVAL_OPTIONS[_si]
                    && INTERVAL_OPTIONS[_si].kind === 'fixed';
                return {
                    selectedInterval: _validFixed ? _si : INTERVAL_DEFAULT_FIXED_INDEX,
                    meetChecked: false,
                    untilReturnChecked: false,
                };
            }
        }
        return base;
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        // When the modal is re-opened, reset to the default selection
        // for the (possibly updated) caregiver state of the contact.
        if (nextProps.show && !this.state.show) {
            // DIAG: what does the modal actually receive as the last-used
            // option on open, and what default did it resolve to? Lets
            // metro.log show whether a mismatch is a stale/missing
            // lastShareOption vs. a wrong defaultSelectionFor mapping.
            try {
                const _sel = ShareLocationModal.defaultSelectionFor(nextProps);
                console.log('[share-prefs] modal open: lastShareOption=',
                    JSON.stringify(nextProps.lastShareOption),
                    'isCaregiver=', !!nextProps.isCaregiver,
                    'presetKind=', nextProps.presetKind,
                    'meetMode=', !!nextProps.meetMode,
                    '→ selection=', JSON.stringify(_sel));
            } catch (e) { /* diag only */ }
            this.setState({
                show: true,
                ...ShareLocationModal.defaultSelectionFor(nextProps),
                // Seed from the device-pref default. If the user
                // hasn't picked one yet, this is 0 (the historical
                // "Off" default).
                excludeOriginRadiusMeters: Number(nextProps.defaultPrivacyRadiusMeters) || 0,
                // Fresh open → reset to auto-fit. Without this, a
                // user who zoomed in/out on a previous meet-up would
                // inherit that zoom on the next "Meet me there..."
                // flow even though the destination is somewhere else
                // entirely. null = let StaticMap auto-fit the
                // user-pin/destination bounding box.
                meetPreviewZoom: null,
                // Fresh open → checkbox CHECKED by default. Same
                // rationale as the constructor — most users will press
                // Confirm in one tap, suppress the disclaimer for next
                // time, and never see this paragraph again. Untick it
                // to keep the disclaimer visible on future shares.
                dontShowDisclaimerAgain: true,
                // Fresh open → button idle again. Guards against a stale
                // spinner if a previous attempt left it set.
                sharing: false,
            });
        } else {
            this.setState({show: nextProps.show});
        }
    }

    // Bump the preview map's zoom by `delta` (+1 or -1), clamped to
    // the slippy-tile range our provider serves. When zoom is null
    // (auto-fit mode), seed it from the same pickZoomToFitPoints
    // formula StaticMap uses internally so the first +/- tap reads
    // as "step in/out from THIS view" rather than "snap to 15 +
    // delta". Reaching either end is silent — buttons render with
    // reduced opacity at the cap.
    _adjustMeetPreviewZoom(delta, autoFitZoom) {
        const base = (typeof this.state.meetPreviewZoom === 'number')
            ? this.state.meetPreviewZoom
            : (typeof autoFitZoom === 'number'
                ? autoFitZoom
                : PREVIEW_DEFAULT_ZOOM);
        const next = Math.max(
            PREVIEW_MIN_ZOOM,
            Math.min(PREVIEW_MAX_ZOOM, base + delta)
        );
        if (next === this.state.meetPreviewZoom) return;
        this.setState({meetPreviewZoom: next});
    }

    // The left column is a single mutually-exclusive group: the user picks
    // exactly ONE "stop condition" — 'untilStopped' | 'once' | 'untilReturn'
    // | 'meet'. It's still backed by the three underlying state fields
    // (selectedInterval / meetChecked / untilReturnChecked) so _effectiveShare
    // and the parent's onConfirm contract don't change; _leftMode() derives the
    // current selection from them and _selectLeftMode() sets them.
    //
    //   • 'untilStopped' — a plain live share that runs until the user stops it
    //     (or the interval cap is hit). This is the historical "fixed" share,
    //     now surfaced explicitly so "what happens when I don't pick an
    //     auto-stop" is a visible choice rather than an implicit default. Uses
    //     the right-column interval as its duration/cap.
    //   • 'once'         — a single GPS fix. No duration; interval N/A.
    //   • 'untilReturn'  — auto-stops when the user returns to their start
    //     (8h ceiling). Interval N/A.
    //   • 'meet'         — the meet-up handshake. Interval = expiry cap.
    _leftMode() {
        if (this.state.untilReturnChecked) return 'untilReturn';
        if (this.state.meetChecked) return 'meet';
        const opt = INTERVAL_OPTIONS[this.state.selectedInterval];
        if (opt && opt.kind === 'once') return 'once';
        return 'untilStopped';
    }

    // A contact can already have a live meet AND/OR a live plain share. Those
    // options must be disabled in the picker so the user can't start a second
    // of the same type. `liveTypes` = {meet, share}. Rules (per Adi's spec):
    //   • meet live  → disable "Until we meet".
    //   • share live → disable "Until stopped" + "Until I return" (only
    //                  "Until we meet" and "Once" remain startable).
    //   • "Once" is a one-shot, never a persistent session → always allowed.
    _liveTypeDisabled(mode) {
        const lt = this.props.liveTypes || {};
        if (mode === 'meet') return !!lt.meet;
        if (mode === 'untilStopped' || mode === 'untilReturn') return !!lt.share;
        return false;
    }

    // Select one of the four exclusive left-column modes. Foreground-only
    // grants can only ever run a single "Once" fix, so every other mode is
    // refused here (belt to the render-time disable). Switching modes maps
    // down onto the underlying fields:
    //   once         → interval = Once, clear meet + untilReturn
    //   untilStopped → clear meet + untilReturn; ensure a real (fixed) interval
    //                  is selected (bump Once → the 8h default)
    //   untilReturn  → untilReturn on, meet off
    //   meet         → meet on, untilReturn off; ensure the interval is a valid
    //                  cap (bump Once → the 8h default)
    _selectLeftMode(mode) {
        if (ShareLocationModal._isForegroundOnly(this.props.permissionLevel)
                && mode !== 'once') {
            return;
        }
        // Refuse a mode whose session type is already live for this contact.
        if (this._liveTypeDisabled(mode)) {
            return;
        }
        if (mode === 'once') {
            this.setState({
                selectedInterval: INTERVAL_ONCE_INDEX,
                meetChecked: false,
                untilReturnChecked: false,
            });
            return;
        }
        if (mode === 'untilReturn') {
            this.setState({untilReturnChecked: true, meetChecked: false});
            return;
        }
        // 'untilStopped' and 'meet' both need a real duration in the interval
        // column; if the user is coming from "Once" (value 0) bump to the 8h
        // default so the share has a sane cap.
        const cur = INTERVAL_OPTIONS[this.state.selectedInterval];
        const hasFixed = cur && cur.kind === 'fixed' && cur.value > 0;
        if (mode === 'untilStopped') {
            this.setState({
                selectedInterval: hasFixed ? this.state.selectedInterval : INTERVAL_DEFAULT_FIXED_INDEX,
                meetChecked: false,
                untilReturnChecked: false,
            });
            return;
        }
        if (mode === 'meet') {
            this.setState({
                selectedInterval: hasFixed ? this.state.selectedInterval : INTERVAL_DEFAULT_MEET_INDEX,
                meetChecked: true,
                untilReturnChecked: false,
            });
        }
    }

    // Interval radio selection (right column — the duration/cap). Picking a
    // duration clears the exclusive untilReturn toggle; a fixed interval keeps
    // the meet checkbox (it becomes the cap). Since "Once" now lives in the
    // left column, the right column only renders fixed intervals, so tapping
    // one from 'once'/'untilReturn' naturally lands the user in 'untilStopped'.
    _selectInterval(idx) {
        const opt = INTERVAL_OPTIONS[idx];
        if (ShareLocationModal._isForegroundOnly(this.props.permissionLevel)
                && !(opt && opt.kind === 'once')) {
            return;
        }
        const isOnce = opt && opt.kind === 'once';
        // When a plain share is already live, the duration presets belong to the
        // now-disabled "Until stopped" mode — only allow picking one while the
        // user is in 'meet' mode (where the interval is the meet cap). Block the
        // selection otherwise so we don't silently drop them into 'untilStopped'.
        if (!isOnce && !this.state.meetChecked && this._liveTypeDisabled('untilStopped')) {
            return;
        }
        this.setState({
            selectedInterval: idx,
            untilReturnChecked: false,
            meetChecked: isOnce ? false : this.state.meetChecked,
        });
    }

    // Collapse the three controls into the single {durationMs, periodLabel,
    // kind} config the parent's onConfirm expects. Priority: untilReturn
    // (exclusive) → meet (interval = cap, 8h fallback) → plain interval.
    // Does NOT apply foreground-only coercion — onConfirm layers that on.
    _effectiveShare() {
        if (this.state.untilReturnChecked) {
            return {
                durationMs: UNTIL_RETURN_OPTION.value,
                periodLabel: UNTIL_RETURN_OPTION.periodLabel,
                kind: UNTIL_RETURN_OPTION.kind,
            };
        }
        const interval = INTERVAL_OPTIONS[this.state.selectedInterval]
            || INTERVAL_OPTIONS[INTERVAL_ONCE_INDEX];
        if (this.state.meetChecked) {
            // The selected interval is the meet share's expiry cap. "Once"
            // (value 0) can't cap a live share, so fall back to the 8h default.
            const cap = (interval.kind === 'fixed' && interval.value > 0)
                ? interval.value
                : MEET_DEFAULT_DURATION_MS;
            return {durationMs: cap, periodLabel: 'until we meet', kind: 'meetingRequest'};
        }
        return {
            durationMs: interval.value,
            periodLabel: interval.periodLabel,
            kind: interval.kind,
        };
    }

    async onConfirm() {
        // Re-entry guard. The button is disabled while sharing, but guard
        // here too so a stray double-invoke (a fast tap that lands before
        // the disabled state paints) can't kick off a second acquire-and-send.
        if (this.state.sharing) {
            return;
        }
        let option = this._effectiveShare();
        // Safety net: with a foreground-only grant the picker disables every
        // non-"Once" control, but coerce here too so a stale selection (e.g.
        // permission downgraded to "While Using" while the modal was open)
        // can never start a background share the OS won't sustain.
        if (ShareLocationModal._isForegroundOnly(this.props.permissionLevel)
                && option.kind !== 'once') {
            option = {
                durationMs: INTERVAL_OPTIONS[INTERVAL_ONCE_INDEX].value,
                periodLabel: INTERVAL_OPTIONS[INTERVAL_ONCE_INDEX].periodLabel,
                kind: 'once',
            };
        }
        // Safety net for the already-live disable rules: if the computed kind's
        // session type is already live for this contact (e.g. the live state
        // changed while the modal sat open), coerce to a one-shot rather than
        // starting a duplicate meet / plain share.
        const _kindMode = (option.kind === 'meetingRequest') ? 'meet'
            : (option.kind === 'untilIReturn') ? 'untilReturn'
            : (option.kind === 'fixed') ? 'untilStopped'
            : 'once';
        if (this._liveTypeDisabled(_kindMode)) {
            option = {
                durationMs: INTERVAL_OPTIONS[INTERVAL_ONCE_INDEX].value,
                periodLabel: INTERVAL_OPTIONS[INTERVAL_ONCE_INDEX].periodLabel,
                kind: 'once',
            };
        }
        // Privacy radius only applies to the meeting-handshake path; for
        // any plain timed share we ship 0 regardless of the slider
        // state so the option can't accidentally bleed across semantic
        // kinds (the slider is only rendered when the meetingRequest
        // option is selected anyway, but defensive belt).
        const excludeOriginRadiusMeters = option.kind === 'meetingRequest'
            ? Number(this.state.excludeOriginRadiusMeters) || 0
            : 0;
        // "Do not show this again" — fire the suppression callback
        // BEFORE we close the modal so the parent can persist the flag
        // synchronously. We only do this on Confirm (not on Cancel /
        // tap-outside) because suppression should follow user intent
        // to share, not user intent to back out. NavigationBar reads
        // app_state.location.disclaimerSuppressed before deciding
        // whether to render the disclaimer block on the next open.
        console.log(
            '[location] modal-confirm: dontShowDisclaimerAgain=',
            this.state.dontShowDisclaimerAgain,
            'onSuppressDisclaimer=', typeof this.props.onSuppressDisclaimer
        );
        if (this.state.dontShowDisclaimerAgain
                && typeof this.props.onSuppressDisclaimer === 'function') {
            try { this.props.onSuppressDisclaimer(); }
            catch (e) {
                console.log('[location] modal-confirm: onSuppressDisclaimer threw',
                    e && e.message ? e.message : e);
            }
        }
        // Persist the chosen privacy radius as the new default for
        // next time. Fires for every Confirm — including 0 ("Off")
        // — so a user who deliberately turns the radius off doesn't
        // get it auto-re-enabled on the next share.
        if (option.kind === 'meetingRequest'
                && typeof this.props.onPersistPrivacyRadius === 'function') {
            try { this.props.onPersistPrivacyRadius(excludeOriginRadiusMeters); }
            catch (e) { /* persistence is best-effort */ }
        }
        // Remember the chosen option for THIS contact so the modal reopens
        // pre-selected next time (see defaultSelectionFor → lastShareOption).
        // Derived from the FINAL option.kind so a foreground-only coercion to
        // "Once" is what actually gets remembered. "Until we meet"
        // (meetingRequest) is deliberately NOT persisted — it's a per-invocation
        // context from the meet-me flow, not a standing preference — so a plain
        // share after a meet share still restores the plain choice. Best-effort:
        // a persistence failure never blocks the share.
        let _persistMode = null;
        if (option.kind === 'once') _persistMode = 'once';
        else if (option.kind === 'fixed') _persistMode = 'untilStopped';
        else if (option.kind === 'untilIReturn') _persistMode = 'untilReturn';
        if (_persistMode && typeof this.props.onPersistShareOption === 'function') {
            try {
                this.props.onPersistShareOption({
                    mode: _persistMode,
                    selectedInterval: this.state.selectedInterval,
                });
            } catch (e) { /* persistence is best-effort */ }
        }
        // Let the parent drive the side-effects (sending messages, starting
        // the periodic timer, etc.). We just report the chosen option —
        // including `kind` so the caller knows whether to stamp
        // meeting_request:true on the origin tick.
        //
        // Stay in the modal — spinner up, both buttons disabled — until the
        // parent finishes: onShareLocationConfirmed resolves once the first
        // GPS fix is acquired and the initial location message is sent (or
        // the attempt fails / is declined). This gives the user immediate
        // feedback for the acquire latency and stops them re-tapping the
        // share icon while the first bubble is still on its way. The parent
        // bounds its own wait (see _awaitInitialShare) so this can't hang;
        // try/finally guarantees we always clear the spinner and close.
        this.setState({sharing: true});
        try {
            const result = this.props.onConfirm({
                durationMs: option.durationMs,
                periodLabel: option.periodLabel,
                kind: option.kind,
                excludeOriginRadiusMeters,
            });
            if (result && typeof result.then === 'function') {
                await result;
            }
        } catch (e) {
            console.log('[location] modal-confirm: onConfirm threw',
                e && e.message ? e.message : e);
        } finally {
            this.setState({sharing: false});
            this.props.close();
        }
    }

    setRadiusStop(meters) {
        this.setState({excludeOriginRadiusMeters: meters});
    }

    onCancel() {
        this.props.close();
    }

    // Deep-link to this app's OS settings so the user can upgrade to the
    // background-capable grant without hunting through Settings. Same
    // mechanism the rest of the app uses (LocationSharingManager's
    // openSettingsFn):
    //   • iOS: the `app-settings:` URL opens Blink's own pane in
    //     Settings.app, where Location is listed directly.
    //   • Android: react-native-permissions' openSettings() opens the App
    //     info page — the OS doesn't expose a deep link past that, so
    //     Permissions → Location is one/two taps from there. Falls back to
    //     RN's Linking.openSettings() if the native call throws.
    // When they return, _onAppStateChange re-probes the permission and the
    // background-only options unlock in place.
    onOpenLocationSettings() {
        try {
            if (Platform.OS === 'ios') {
                Linking.openURL('app-settings:');
            } else {
                try { openSettings(); }
                catch (e) { Linking.openSettings && Linking.openSettings(); }
            }
        } catch (e) {
            console.log('[location] modal: openSettings failed',
                e && e.message ? e.message : e);
        }
    }

    componentDidMount() {
        // Re-probe the location permission whenever the app returns to the
        // foreground while this modal is open — the user may have just gone
        // to Settings to grant "Always". onRefreshPermissionLevel asks
        // NavigationBar to refresh the permissionLevel prop, which flips the
        // gated options back on in place.
        this._appStateSub = AppState.addEventListener('change', this._onAppStateChange);
    }

    componentWillUnmount() {
        if (this._appStateSub && typeof this._appStateSub.remove === 'function') {
            this._appStateSub.remove();
        }
        this._appStateSub = null;
    }

    _onAppStateChange(nextState) {
        if (nextState === 'active'
                && this.state.show
                && typeof this.props.onRefreshPermissionLevel === 'function') {
            this.props.onRefreshPermissionLevel();
        }
    }

    // Render one row of the left-column mutually-exclusive mode group
    // ('untilStopped' | 'once' | 'untilReturn' | 'meet') as a coloured pill —
    // see MODE_PILLS above for why this isn't a radio list any more. The group
    // is still exactly-one-of-four; the pill fill IS the selection state, so
    // there's no separate radio glyph to read.
    //
    // Behaviour is unchanged from the radio version: every non-"Once" mode is
    // disabled under a foreground-only grant (they drive a background share the
    // OS won't sustain), "Once" is always available, and a session type that's
    // already live for this contact disables its own pill.
    _renderLeftModeRow(mode, label) {
        const _disabled = (ShareLocationModal._isForegroundOnly(this.props.permissionLevel)
            && mode !== 'once')
            // …or this session type is already live for the contact.
            || this._liveTypeDisabled(mode);
        const _selected = this._leftMode() === mode;
        const _cfg = MODE_PILLS[mode] || MODE_PILLS.once;
        // Every pill carries its colour in BOTH themes — an unselected pill is
        // a tinted wash of its own colour, never plain white/transparent. The
        // whole point is that a helper can say "press the green one" at any
        // time, which fails if the unselected pills are colourless until you
        // touch them. The tint is the same hue at low alpha, so the four rows
        // stay tellable apart while the fully-saturated fill still marks the
        // one that's actually selected.
        //
        // Alpha differs per theme: a 13% wash reads on white but disappears on
        // a dark surface, so dark mode gets a stronger 33% wash.
        const _isDark = getModalColors().isDark;
        const _tint = _cfg.color + (_isDark ? '55' : '22');
        const _fg = _selected
            ? '#FFFFFF'
            // On dark surfaces the mid-tone brand colour is too low-contrast
            // for text, so unselected labels use the pale variant instead.
            : (_isDark ? (_cfg.lightColor || _cfg.color) : _cfg.color);
        return (
            <TouchableOpacity
                key={mode}
                activeOpacity={0.7}
                disabled={_disabled}
                onPress={_disabled ? undefined : () => this._selectLeftMode(mode)}
                /* Announce the group to screen readers exactly as it behaves —
                   a radio group — even though it no longer looks like one. */
                accessibilityRole="radio"
                accessibilityState={{ selected: _selected, disabled: _disabled }}
                accessibilityLabel={label}
                style={[
                    pillStyles.pill,
                    {
                        backgroundColor: _selected ? _cfg.color : _tint,
                        borderColor: _selected
                            ? _cfg.color
                            : (_isDark ? (_cfg.lightColor || _cfg.color) : _cfg.color),
                        opacity: _disabled ? 0.35 : 1,
                    },
                    _selected ? pillStyles.pillSelected : null,
                ]}
            >
                <Icon name={_cfg.icon} size={20} color={_fg} />
                <Text style={[pillStyles.pillLabel, { color: _fg }]} numberOfLines={1}>
                    {label}
                </Text>
                {/* Tick on the selected pill. Since every pill is now coloured,
                    fill-vs-tint alone is a weaker selection cue than it was
                    against a white background — the tick makes "this is the one
                    that will happen" unambiguous without relying on colour. */}
                {_selected ? (
                    <>
                        <View style={{ flex: 1 }} />
                        <Icon name="check-circle" size={18} color="#FFFFFF" />
                    </>
                ) : null}
            </TouchableOpacity>
        );
    }

    // Render one interval-radio row in the right column (4h / 8h / 24h — the
    // duration/cap). The interval only applies to the 'untilStopped' and 'meet'
    // modes; for 'once' and 'untilReturn' it isn't in play, so the whole column
    // is dimmed and nothing shows selected. Foreground-only disables every row
    // (all are background-dependent). Rows stay tappable when not disabled —
    // tapping one moves an 'once'/'untilReturn' selection into 'untilStopped'.
    _renderIntervalRow(opt, idx) {
        const _mode = this._leftMode();
        const _intervalInPlay = _mode === 'untilStopped' || _mode === 'meet';
        const _disabled = ShareLocationModal._isForegroundOnly(this.props.permissionLevel)
            // A live plain share disables the duration presets EXCEPT while the
            // user is composing a meet (there the interval is the meet cap).
            || (this._liveTypeDisabled('untilStopped') && _mode !== 'meet');
        const _dim = _disabled || !_intervalInPlay;
        const _selected = _intervalInPlay
            && this.state.selectedInterval === idx;
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
                    <Text style={_dim ? { opacity: 0.4 } : null}>{opt.label}</Text>
                </View>
            </TouchableWithoutFeedback>
        );
    }

    render() {
        // Confirm-button gates. Three conditions can disable
        // Confirm in meet-mode:
        //
        //   1. Destination not resolved yet — happens for the brief
        //      window between tapping a Maps link and the URL
        //      resolution landing. Without this gate the user can
        //      tap Confirm and the share starts with no destination,
        //      which silently downgrades to a plain timed share.
        //
        //   2. User location not resolved yet — `userLocation` arrives
        //      asynchronously after the GPS fix. Requiring it before
        //      Confirm guarantees the privacy-zone overlap check
        //      below has the data it needs to be meaningful, AND
        //      makes the confirm gesture honest: the user can SEE
        //      the destination relative to their position before
        //      they commit.
        //
        //   3. Privacy zone covers the destination — when the user's
        //      chosen radius is greater than (or equal to) their
        //      actual distance to the destination, the privacy
        //      circle entirely engulfs the meeting point.
        //      Confirming would fire "you arrived at the
        //      destination" the moment the first real-coord tick
        //      lands. Surface a small inline note so the user
        //      knows why.
        //
        // Outside meet-mode (regular timed share, no destination) all
        // three gates are skipped: there's no destination to compare
        // against and no user pin to wait for.
        const _effectiveShare = this._effectiveShare();
        const _isMeetingKind = _effectiveShare.kind === 'meetingRequest';
        const _foregroundOnly = ShareLocationModal._isForegroundOnly(this.props.permissionLevel);
        const _radius = Number(this.state.excludeOriginRadiusMeters) || 0;
        const _userLoc = this.props.userLocation;
        const _userLocResolved = !!(_userLoc
            && typeof _userLoc.latitude === 'number'
            && typeof _userLoc.longitude === 'number');
        const _dest = this.props.meetDestination;
        const _destResolved = !!(_dest
            && typeof _dest.latitude === 'number'
            && typeof _dest.longitude === 'number');
        let _privacyOverlapsDestination = false;
        if (_isMeetingKind
                && _radius > 0
                && _userLocResolved
                && _destResolved) {
            const _d = haversineMeters(_userLoc, _dest);
            if (Number.isFinite(_d) && _d <= _radius) {
                _privacyOverlapsDestination = true;
            }
        }
        // A current GPS fix is required ONLY for a "Once" share: it captures a
        // single fix and sends it immediately, so with nothing acquired yet
        // there is nothing to send — keep Share disabled until it resolves.
        // Every OTHER mode (untilStopped / untilReturn / fixed / meet) starts a
        // LIVE share whose first fix is acquired by the share machinery AFTER
        // Confirm, so the user can press Share right away and the fix (and, for
        // "meet at my place", the destination) arrives later. The privacy-
        // overlap check stays: it only trips once both fix and destination are
        // resolved, never during load.
        const _isOnceShare = _effectiveShare.kind === 'once';
        const _onceMissingUserLocation = _isOnceShare && !_userLocResolved;
        const _confirmDisabled = _onceMissingUserLocation
            || _privacyOverlapsDestination;
        // While a share is starting, keep the map-marker glyph visible but
        // ring it with a circular spinner — the same "activity ring around an
        // icon" treatment the navbar's DND bell uses during its first sync.
        // Paper's Button accepts a function as its `icon` source; ours draws
        // the marker with a PaperActivityIndicator centred over it
        // (pointerEvents:none, purely decorative). Fixed accent colour so the
        // ring stays legible while the button is disabled (dimmed). Idle → the
        // plain "map-marker" string, identical to before.
        const _shareIcon = this.state.sharing
            ? ({ size, color }) => (
                <View style={{
                    width: size,
                    height: size,
                    alignItems: 'center',
                    justifyContent: 'center',
                }}>
                    <Icon name="map-marker" size={size} color={color} />
                    <View
                        pointerEvents="none"
                        style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            top: 0,
                            bottom: 0,
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <PaperActivityIndicator
                            size={size + 12}
                            color="#2196F3"
                            animating={true}
                        />
                    </View>
                </View>
            )
            : 'map-marker';
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
                {/* Tap outside to dismiss, same as EditContactModal.
                    In meet-mode the overlay's horizontal padding is
                    trimmed to 6 px so the destination preview map can
                    extend close to the screen edges. Outside meet-mode
                    we keep the shared overlay's 16 px on every side
                    so the dialog visual matches the rest of the app's
                    modals. We inline the styles (rather than
                    [base, override]) because RN's StyleSheet merge of
                    a `padding` shorthand and a `padding{Side}` longhand
                    is ambiguous on some RN versions — the shorthand
                    sometimes wins, sometimes the longhand does.
                    Spelling out the four `padding{Top,Right,Bottom,
                    Left}` props guarantees the horizontal trim takes
                    effect regardless of merge order. */}
                <TouchableWithoutFeedback onPress={this.onCancel}>
                    <View style={{
                        flex: 1,
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        justifyContent: 'center',
                        paddingTop: 16,
                        paddingBottom: 16,
                        paddingLeft: this.props.meetMode ? 6 : 16,
                        paddingRight: this.props.meetMode ? 6 : 16,
                    }}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                        >
                            {/* Block dismiss when the tap is inside the card.
                                In meet-mode we want the Surface to span
                                the full overlay width so the destination
                                preview map below fills it edge-to-edge.
                                `alignSelf: 'stretch'` does that without
                                fighting KAV — no explicit numeric width
                                to clash with the keyboard-avoiding
                                container's own layout (which is what
                                broke when we tried `width: ...` directly).
                                Outside meet-mode we keep the historical
                                content-sized behaviour so the radio
                                picker doesn't look stretched-out and
                                airy. */}
                            <TouchableWithoutFeedback onPress={() => {}}>
                                <ThemedModalSurface style={[
                                    containerStyles.modalSurface,
                                    // Outside meet-mode the card is content-sized. Without a
                                    // width cap, the two-column interval section can grow wider
                                    // than the screen (selecting "4 hours" pushed the card and the
                                    // "or select an interval" label off the right edge). Cap the
                                    // card to the screen width (minus the overlay's 16px padding
                                    // each side) and centre it, so wide content wraps inside the
                                    // card instead of overflowing.
                                    this.props.meetMode
                                        ? {alignSelf: 'stretch'}
                                        : {maxWidth: Dimensions.get('window').width - 32, alignSelf: 'center'},
                                ]}>

                                    <Text style={containerStyles.title}>Share location</Text>

                                    {/* "with <peer>" subtitle is only shown
                                        OUTSIDE meet-mode. Meet-mode folds the
                                        peer URI into the description text
                                        underneath the map ("Share your live
                                        location with <peer> until both of you
                                        arrive at the destination above."), so
                                        rendering it here too would just
                                        duplicate the same string two lines
                                        apart. Padding is tuned to CENTRE the
                                        subtitle between the title and the map:
                                        the title (containerStyles.title) carries
                                        a fixed 14 px padding, so the gap above
                                        the subtitle is already 14 px + our
                                        paddingTop, while the gap below is our
                                        paddingBottom + the preview's 4 px
                                        marginTop. paddingTop:0 / paddingBottom:10
                                        makes both gaps ~14 px so the subtitle
                                        sits evenly between the two instead of
                                        hugging the map. */}
                                    {!this.props.meetMode ? (
                                        <Text style={[styles.body, { paddingTop: 0, paddingBottom: 10 }]}>
                                            with {this.props.uri || this.props.displayName || 'this contact'}
                                        </Text>
                                    ) : null}

                                    {/* Simple-share mode preview: render a
                                        small map centered on the user's own
                                        position so the user can confirm what
                                        they're about to start sharing. No
                                        destination pin, no privacy circle —
                                        privacy radius only applies to meet
                                        sessions. Same StaticMap + zoom-control
                                        machinery as the meet-mode preview
                                        above. Hidden until the GPS fix lands
                                        so we don't render a degenerate
                                        "centered on lat=0,lng=0" map; falls
                                        back to a compact "Acquiring location…"
                                        banner in the meantime. */}
                                    {!this.props.meetMode ? (() => {
                                        const userLoc = this.props.userLocation;
                                        const hasUserLoc = userLoc
                                            && typeof userLoc.latitude === 'number'
                                            && typeof userLoc.longitude === 'number';
                                        // Width budget mirrors the meet
                                        // preview but accounts for the
                                        // wider 16 px overlay padding used
                                        // outside meet-mode: window.width −
                                        // (16 + 16 + 5 + 5) = − 42.
                                        const PREVIEW_W = Math.max(
                                            240,
                                            Dimensions.get('window').width - 42
                                        );
                                        const PREVIEW_H = 180;
                                        if (!hasUserLoc) {
                                            // Render the map-area placeholder at the
                                            // SAME width AND height as the resolved
                                            // map (PREVIEW_W × PREVIEW_H) — not a
                                            // compact text banner — so the modal
                                            // keeps a constant height and doesn't
                                            // expand when the GPS fix lands and the
                                            // real map swaps in. Matching
                                            // backgroundColor / borderRadius /
                                            // margins to the resolved-state <View>
                                            // below makes the swap seamless: the box
                                            // is already the right size, only its
                                            // contents change. A centred spinner over
                                            // the neutral map-tile grey reads as "the
                                            // map is loading here" while we wait for
                                            // the first fix.
                                            return (
                                                <View style={{
                                                    marginTop: 4,
                                                    marginBottom: 8,
                                                    width: PREVIEW_W,
                                                    height: PREVIEW_H,
                                                    borderRadius: 8,
                                                    overflow: 'hidden',
                                                    backgroundColor: '#e5e5e5',
                                                    alignSelf: 'center',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                }}>
                                                    <PaperActivityIndicator
                                                        size={36}
                                                        color="#2196F3"
                                                        animating={true}
                                                    />
                                                    <Text style={{
                                                        marginTop: 10,
                                                        fontSize: 12,
                                                        color: getModalColors().textPrimary,
                                                        textAlign: 'center',
                                                    }} numberOfLines={1}>
                                                        Acquiring your location…
                                                    </Text>
                                                </View>
                                            );
                                        }
                                        // Single-pin auto-fit: with one
                                        // point pickZoomToFitPoints isn't
                                        // meaningful, so fall back to the
                                        // default street-level zoom. The
                                        // user can +/- from there.
                                        const _autoFitZoom = PREVIEW_DEFAULT_ZOOM;
                                        const zoom = (typeof this.state.meetPreviewZoom === 'number')
                                            ? this.state.meetPreviewZoom
                                            : _autoFitZoom;
                                        const canZoomIn = zoom < PREVIEW_MAX_ZOOM;
                                        const canZoomOut = zoom > PREVIEW_MIN_ZOOM;
                                        const _ownerInitials = initialsFromName(this.props.myDisplayName);
                                        // Theme-aware map-tile placeholder fill (matches the
                                        // meet-destination preview below): neutral dark grey in
                                        // dark mode, light grey otherwise.
                                        const _placeholderBg = getModalColors().isDark ? '#2A2D31' : '#e5e5e5';
                                        return (
                                            <View style={{
                                                marginTop: 4,
                                                marginBottom: 8,
                                                width: PREVIEW_W,
                                                height: PREVIEW_H,
                                                borderRadius: 8,
                                                overflow: 'hidden',
                                                backgroundColor: _placeholderBg,
                                                alignSelf: 'center',
                                            }}>
                                                <StaticMap
                                                    /* No destinationLat/Lng:
                                                       StaticMap centers on
                                                       latitude/longitude when
                                                       the destination pair
                                                       is missing. */
                                                    latitude={userLoc.latitude}
                                                    longitude={userLoc.longitude}
                                                    ownerInitials={_ownerInitials}
                                                    mapWidth={PREVIEW_W}
                                                    mapHeight={PREVIEW_H}
                                                    zoom={zoom}
                                                />

                                                <TouchableOpacity
                                                    onPress={() => this._adjustMeetPreviewZoom(+1, _autoFitZoom)}
                                                    disabled={!canZoomIn}
                                                    hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
                                                    accessibilityLabel="Zoom in"
                                                    style={{
                                                        position: 'absolute',
                                                        top: 6,
                                                        right: 6,
                                                        width: 32,
                                                        height: 32,
                                                        borderRadius: 16,
                                                        backgroundColor: 'rgba(255,255,255,0.92)',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        opacity: canZoomIn ? 1 : 0.4,
                                                        shadowColor: '#000',
                                                        shadowOpacity: 0.2,
                                                        shadowRadius: 2,
                                                        shadowOffset: {width: 0, height: 1},
                                                        elevation: 3,
                                                    }}
                                                >
                                                    <Icon name="plus" size={20} color={getModalColors().textPrimary} />
                                                </TouchableOpacity>

                                                <TouchableOpacity
                                                    onPress={() => this._adjustMeetPreviewZoom(-1, _autoFitZoom)}
                                                    disabled={!canZoomOut}
                                                    hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
                                                    accessibilityLabel="Zoom out"
                                                    style={{
                                                        position: 'absolute',
                                                        top: 44,
                                                        right: 6,
                                                        width: 32,
                                                        height: 32,
                                                        borderRadius: 16,
                                                        backgroundColor: 'rgba(255,255,255,0.92)',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        opacity: canZoomOut ? 1 : 0.4,
                                                        shadowColor: '#000',
                                                        shadowOpacity: 0.2,
                                                        shadowRadius: 2,
                                                        shadowOffset: {width: 0, height: 1},
                                                        elevation: 3,
                                                    }}
                                                >
                                                    <Icon name="minus" size={20} color={getModalColors().textPrimary} />
                                                </TouchableOpacity>

                                                {/* Coords overlay strip — same
                                                    styling as the meet preview
                                                    so the two views share a
                                                    visual vocabulary. */}
                                                <View
                                                    pointerEvents="none"
                                                    style={{
                                                        position: 'absolute',
                                                        left: 0,
                                                        right: 0,
                                                        bottom: 0,
                                                        paddingVertical: 4,
                                                        paddingHorizontal: 10,
                                                        backgroundColor: 'rgba(0,0,0,0.55)',
                                                    }}
                                                >
                                                    <Text
                                                        style={{
                                                            fontSize: 11,
                                                            color: '#fff',
                                                            textAlign: 'center',
                                                        }}
                                                        numberOfLines={1}
                                                    >
                                                        {userLoc.latitude.toFixed(5)
                                                            + ', '
                                                            + userLoc.longitude.toFixed(5)}
                                                    </Text>
                                                </View>
                                            </View>
                                        );
                                    })() : null}

                                    {/* "Meet me there..." mode: render a
                                        destination-preview banner BEFORE the
                                        duration options so the user can
                                        confirm the location they're meeting
                                        at. The banner reads either:
                                          • "Resolving destination…" while a
                                            shortened URL is being expanded
                                          • "Meeting at lat,lng" once coords
                                            are known
                                          • "Couldn't read the map link" on
                                            resolve failure (the user can
                                            still cancel and pick a different
                                            link to long-press)
                                        Banner is only rendered when meetMode
                                        is true (set by NavigationBar.meetMeAt). */}
                                    {this.props.meetMode ? (() => {
                                        // Three render states:
                                        //   • Resolved (destination has
                                        //     lat/lng) — full-width map tile
                                        //     centred on the destination
                                        //     with the green map-marker
                                        //     pin, +/- zoom buttons in the
                                        //     right-edge gutter, and the
                                        //     coords overlaid in a semi-
                                        //     transparent strip along the
                                        //     bottom of the map. The
                                        //     section header / "Meeting
                                        //     destination" label is
                                        //     deliberately omitted so every
                                        //     pixel of vertical space goes
                                        //     to the map itself.
                                        //   • Failed (status === 'failed') —
                                        //     compact error banner so the
                                        //     user knows to cancel and try
                                        //     another link.
                                        //   • Resolving (default) — same
                                        //     banner shape as the failed
                                        //     case but with a "Resolving
                                        //     destination…" message; switches
                                        //     to the map tile in place when
                                        //     resolution lands.
                                        const dest = this.props.meetDestination;
                                        const hasCoords = dest
                                            && typeof dest.latitude === 'number'
                                            && typeof dest.longitude === 'number';
                                        if (hasCoords) {
                                            // Width: fill the modal panel
                                            // edge-to-edge. The overlay's
                                            // horizontal padding is locally
                                            // reduced to 6 px each side and
                                            // the modalSurface has padding 5
                                            // — so the usable inner width is
                                            // window.width − (6 + 6 + 5 + 5)
                                            // = window.width − 22. The
                                            // wrapper has overflow: 'hidden'
                                            // on a borderRadius, so sub-
                                            // pixel rounding can't bleed
                                            // past the clip. Floor at 240
                                            // keeps things sane on unusually
                                            // small viewports.
                                            const PREVIEW_W = Math.max(
                                                240,
                                                Dimensions.get('window').width - 22
                                            );
                                            // Height: 240 px gives enough
                                            // map area to read street
                                            // context without crowding the
                                            // duration picker beneath. Tuned
                                            // by eye on a 380 px Android
                                            // viewport — roughly square-ish
                                            // aspect on phone, slightly
                                            // wider than tall so the pin
                                            // and surrounding streets read
                                            // at a glance.
                                            const PREVIEW_H = 240;
                                            // Compute the auto-fit
                                            // zoom externally so we
                                            // can both pass it as the
                                            // map's zoom prop AND use
                                            // it to seed the +/-
                                            // buttons (so the first
                                            // tap reads as "from
                                            // here", not "snap to 15").
                                            const userLoc = this.props.userLocation;
                                            const _fitPoints = [];
                                            _fitPoints.push({
                                                latitude: dest.latitude,
                                                longitude: dest.longitude,
                                            });
                                            if (userLoc
                                                    && typeof userLoc.latitude === 'number'
                                                    && typeof userLoc.longitude === 'number') {
                                                _fitPoints.push({
                                                    latitude: userLoc.latitude,
                                                    longitude: userLoc.longitude,
                                                });
                                            }
                                            const _autoFitZoom = _fitPoints.length > 1
                                                ? pickZoomToFitPoints(
                                                    _fitPoints, 40, PREVIEW_W, PREVIEW_H,
                                                )
                                                : PREVIEW_DEFAULT_ZOOM;
                                            // The effective zoom we
                                            // pass to StaticMap. null
                                            // override means "use
                                            // auto-fit"; a numeric
                                            // override wins after the
                                            // user taps +/-.
                                            const zoom = (typeof this.state.meetPreviewZoom === 'number')
                                                ? this.state.meetPreviewZoom
                                                : _autoFitZoom;
                                            const canZoomIn = zoom < PREVIEW_MAX_ZOOM;
                                            const canZoomOut = zoom > PREVIEW_MIN_ZOOM;
                                            // Distance from user to
                                            // destination, formatted
                                            // for the gray label
                                            // below the coords.
                                            // null when the user
                                            // location hasn't landed
                                            // yet — caller hides the
                                            // distance segment in
                                            // that case.
                                            const _userToDestM = haversineMeters(userLoc, dest);
                                            const _distLabel = formatDistance(_userToDestM);
                                            // Initials for the user's
                                            // own pin. Falls back to
                                            // '?' when myDisplayName
                                            // isn't passed (shouldn't
                                            // happen in practice — see
                                            // NavigationBar's
                                            // myDisplayName prop
                                            // wiring).
                                            const _ownerInitials = initialsFromName(this.props.myDisplayName);
                                            return (
                                                <View style={{
                                                    marginTop: 4,
                                                    marginBottom: 8,
                                                    width: PREVIEW_W,
                                                    height: PREVIEW_H,
                                                    borderRadius: 8,
                                                    overflow: 'hidden',
                                                    backgroundColor: '#e5e5e5',
                                                    alignSelf: 'center',
                                                }}>
                                                    <StaticMap
                                                        destinationLatitude={dest.latitude}
                                                        destinationLongitude={dest.longitude}
                                                        /* User's current
                                                           location pin. Comes
                                                           from a
                                                           getCurrentCoordinates
                                                           fetch kicked off in
                                                           NavigationBar.show
                                                           ShareLocationModal —
                                                           absent until the GPS
                                                           fix lands, then
                                                           appears on the map
                                                           alongside the
                                                           destination. */
                                                        latitude={
                                                            this.props.userLocation
                                                                && typeof this.props.userLocation.latitude === 'number'
                                                                ? this.props.userLocation.latitude
                                                                : undefined
                                                        }
                                                        longitude={
                                                            this.props.userLocation
                                                                && typeof this.props.userLocation.longitude === 'number'
                                                                ? this.props.userLocation.longitude
                                                                : undefined
                                                        }
                                                        /* Privacy-radius
                                                           circle. Centered on
                                                           the user's current
                                                           position with the
                                                           radius the slider
                                                           currently reads.
                                                           Skipped when slider
                                                           is at "Off" (0) or
                                                           the user location
                                                           hasn't landed yet. */
                                                        circleCenterLatitude={
                                                            this.state.excludeOriginRadiusMeters > 0
                                                                && this.props.userLocation
                                                                && typeof this.props.userLocation.latitude === 'number'
                                                                ? this.props.userLocation.latitude
                                                                : undefined
                                                        }
                                                        circleCenterLongitude={
                                                            this.state.excludeOriginRadiusMeters > 0
                                                                && this.props.userLocation
                                                                && typeof this.props.userLocation.longitude === 'number'
                                                                ? this.props.userLocation.longitude
                                                                : undefined
                                                        }
                                                        circleRadiusMeters={
                                                            this.state.excludeOriginRadiusMeters > 0
                                                                && this.props.userLocation
                                                                ? Number(this.state.excludeOriginRadiusMeters)
                                                                : undefined
                                                        }
                                                        ownerInitials={_ownerInitials}
                                                        mapWidth={PREVIEW_W}
                                                        mapHeight={PREVIEW_H}
                                                        zoom={zoom}
                                                    />

                                                    {/* Zoom + button (top-right corner). */}
                                                    <TouchableOpacity
                                                        onPress={() => this._adjustMeetPreviewZoom(+1, _autoFitZoom)}
                                                        disabled={!canZoomIn}
                                                        hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
                                                        accessibilityLabel="Zoom in"
                                                        style={{
                                                            position: 'absolute',
                                                            top: 6,
                                                            right: 6,
                                                            width: 32,
                                                            height: 32,
                                                            borderRadius: 16,
                                                            backgroundColor: 'rgba(255,255,255,0.92)',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            opacity: canZoomIn ? 1 : 0.4,
                                                            // Subtle shadow so the buttons
                                                            // lift off the map tiles. Same
                                                            // shadow vocabulary the
                                                            // LocationBubble pins use.
                                                            shadowColor: '#000',
                                                            shadowOpacity: 0.2,
                                                            shadowRadius: 2,
                                                            shadowOffset: {width: 0, height: 1},
                                                            elevation: 3,
                                                        }}
                                                    >
                                                        <Icon name="plus" size={20} color={getModalColors().textPrimary} />
                                                    </TouchableOpacity>

                                                    {/* Zoom - button (just below the +).
                                                        Stacked vertically on the right edge
                                                        so they read as one control group;
                                                        spacing matches LocationBubble's
                                                        zoom-button layout where the user
                                                        already knows the pattern. */}
                                                    <TouchableOpacity
                                                        onPress={() => this._adjustMeetPreviewZoom(-1, _autoFitZoom)}
                                                        disabled={!canZoomOut}
                                                        hitSlop={{top: 6, bottom: 6, left: 6, right: 6}}
                                                        accessibilityLabel="Zoom out"
                                                        style={{
                                                            position: 'absolute',
                                                            top: 44, // 6 + 32 + 6 gap
                                                            right: 6,
                                                            width: 32,
                                                            height: 32,
                                                            borderRadius: 16,
                                                            backgroundColor: 'rgba(255,255,255,0.92)',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            opacity: canZoomOut ? 1 : 0.4,
                                                            shadowColor: '#000',
                                                            shadowOpacity: 0.2,
                                                            shadowRadius: 2,
                                                            shadowOffset: {width: 0, height: 1},
                                                            elevation: 3,
                                                        }}
                                                    >
                                                        <Icon name="minus" size={20} color={getModalColors().textPrimary} />
                                                    </TouchableOpacity>

                                                    {/* Coordinates overlay strip along the
                                                        bottom of the map. Semi-transparent
                                                        dark background with white text so
                                                        the coords stay legible regardless of
                                                        what's under them (city, water,
                                                        countryside — slippy tiles vary
                                                        wildly in luminance). pointerEvents:
                                                        'none' so the strip never intercepts
                                                        a future tap-to-pan gesture. */}
                                                    <View
                                                        pointerEvents="none"
                                                        style={{
                                                            position: 'absolute',
                                                            left: 0,
                                                            right: 0,
                                                            bottom: 0,
                                                            paddingVertical: 4,
                                                            paddingHorizontal: 10,
                                                            backgroundColor: 'rgba(0,0,0,0.55)',
                                                        }}
                                                    >
                                                        <Text
                                                            style={{
                                                                fontSize: 11,
                                                                color: '#fff',
                                                                textAlign: 'center',
                                                            }}
                                                            numberOfLines={1}
                                                        >
                                                            {dest.latitude.toFixed(5)
                                                                + ', '
                                                                + dest.longitude.toFixed(5)
                                                                + (_distLabel
                                                                    ? '  •  ' + _distLabel + ' away'
                                                                    : '')}
                                                        </Text>
                                                    </View>
                                                </View>
                                            );
                                        }
                                        // No coords yet — render the map-area
                                        // placeholder at the SAME width AND
                                        // height as the resolved map above so
                                        // the modal keeps a constant height and
                                        // doesn't expand when the destination
                                        // resolves and the real map tile swaps
                                        // in. PREVIEW_W / PREVIEW_H are scoped to
                                        // the hasCoords branch above, so we
                                        // recompute the identical values here
                                        // (window.width − 22, floored at 240;
                                        // height 240) to keep the two boxes the
                                        // same size. While resolving we centre a
                                        // spinner over the neutral map-tile grey
                                        // ("the map is loading here"); on the
                                        // 'failed' state we drop the spinner and
                                        // show only the error copy, but keep the
                                        // box the same size so the layout still
                                        // doesn't shift.
                                        const _PREVIEW_W = Math.max(
                                            240,
                                            Dimensions.get('window').width - 22
                                        );
                                        const _PREVIEW_H = 240;
                                        const _failed = this.props.meetDestinationStatus === 'failed';
                                        // Theme-aware placeholder fill. The box
                                        // used a hardcoded light grey (#e5e5e5),
                                        // so in dark mode the (near-white)
                                        // textPrimary error copy sat on a light
                                        // background and was barely legible. Use
                                        // a neutral dark grey in dark mode so both
                                        // the "Resolving…" and failure copy keep
                                        // strong contrast in either theme.
                                        const _mc = getModalColors();
                                        const _placeholderBg = _mc.isDark ? '#2A2D31' : '#e5e5e5';
                                        return (
                                            <View style={{
                                                marginTop: 4,
                                                marginBottom: 8,
                                                width: _PREVIEW_W,
                                                height: _PREVIEW_H,
                                                borderRadius: 8,
                                                overflow: 'hidden',
                                                backgroundColor: '#e5e5e5',
                                                alignSelf: 'center',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                paddingHorizontal: 24,
                                            }}>
                                                {!_failed ? (
                                                    <PaperActivityIndicator
                                                        size={36}
                                                        color="#2196F3"
                                                        animating={true}
                                                    />
                                                ) : null}
                                                <Text style={{
                                                    marginTop: _failed ? 0 : 10,
                                                    fontSize: 12,
                                                    color: _failed
                                                        ? (_mc.isDark ? '#FF8A80' : '#C62828')
                                                        : _mc.textPrimary,
                                                    fontWeight: _failed ? '600' : 'normal',
                                                    textAlign: 'center',
                                                }} numberOfLines={2}>
                                                    {_failed
                                                        ? "Couldn't read the map link — cancel and try another"
                                                        : 'Resolving destination…'}
                                                </Text>
                                            </View>
                                        );
                                    })() : null}

                                    {/* Two-column layout.
                                        Left column: a single mutually-exclusive
                                        group of stop conditions — Until stopped /
                                        Once / Until I return / Until we meet
                                        (see _leftMode / _selectLeftMode) — then a
                                        label describing the interval's role.
                                        Right column: the duration / expiry cap
                                        radio (4h / 8h / 24h).

                                        The left group is exactly one choice; the
                                        right column supplies the duration for the
                                        two modes that use one:
                                          • "Until stopped" runs live until the
                                            user stops it, capped by the interval.
                                          • "Once" is a single fix — no duration.
                                          • "Until I return" auto-stops on return
                                            (8h ceiling) — interval not used.
                                          • "Until we meet" is the handshake; the
                                            interval is its expiry cap.

                                        RadioButton.Android with uncheckedColor
                                        keeps the unchecked glyph visible on both
                                        platforms (the default iOS glyph vanishes
                                        when unselected). */}
                                    {/* Meet-me-there mode collapses the whole
                                        duration picker — there's only one valid
                                        choice (the meet-up handshake) and
                                        showing the alternate controls would
                                        invite the user to pick something
                                        incompatible with the destination they
                                        just chose. defaultSelectionFor() opens
                                        this flow with meetChecked=true at the
                                        8h default cap, and the description below
                                        is the only copy that needs to render. */}
                                    {this.props.meetMode ? (
                                        <View style={{
                                            paddingVertical: 6,
                                            paddingHorizontal: 12,
                                        }}>
                                            <Text style={{
                                                fontSize: 12,
                                                opacity: 0.8,
                                                textAlign: 'center',
                                            }}>
                                                Share your live location with{' '}
                                                <Text style={{fontWeight: 'bold'}}>
                                                    {this.props.uri || this.props.displayName || 'this contact'}
                                                </Text>
                                                {' '}until both of you arrive at the destination above.
                                            </Text>
                                        </View>
                                    ) : (
                                        <View style={{ flexDirection: 'row' }}>
                                            <View style={{ flex: 1 }}>
                                                {/* Left column — a single
                                                    mutually-exclusive group of
                                                    stop conditions, top to
                                                    bottom:
                                                      • "Once" — single fix. Sits
                                                        at the top as the
                                                        lowest-commitment choice.
                                                      • "Until stopped" — the
                                                        plain live share that
                                                        runs until the user stops
                                                        it (capped by the
                                                        interval); the explicit
                                                        name for "no auto-stop
                                                        picked".
                                                      • "Until I return" —
                                                        auto-stop on return.
                                                        Caregivers open with it
                                                        pre-checked via
                                                        defaultSelectionFor().
                                                      • "Until we meet" — the
                                                        meet-up handshake. Hidden
                                                        for caregiver contacts:
                                                        they're keeping watch over
                                                        a trip, not converging on
                                                        a point. */}
                                                {this._renderLeftModeRow('once', 'Once')}
                                                {this._renderLeftModeRow('untilStopped', 'Until stopped')}
                                                {this._renderLeftModeRow('untilReturn', UNTIL_RETURN_OPTION.label)}
                                                {!this.props.isCaregiver && !this.props.selfShare
                                                    ? this._renderLeftModeRow('meet', 'Until we meet')
                                                    : null}
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                {/* Right column — the duration /
                                                    expiry cap. "Once" now lives
                                                    in the left column, so only
                                                    the fixed intervals render
                                                    here. The interval only
                                                    applies to 'untilStopped' and
                                                    'meet'; for 'once' /
                                                    'untilReturn' it's not
                                                    applicable, so we render the
                                                    rows only in the applicable
                                                    modes and otherwise leave this
                                                    column EMPTY. The wrapping
                                                    flex:1 <View> stays mounted
                                                    either way, so the left column
                                                    keeps its width and the layout
                                                    doesn't reflow. */}
                                                {(this._leftMode() === 'untilStopped'
                                                    || this._leftMode() === 'meet')
                                                    ? INTERVAL_OPTIONS.map((opt, idx) =>
                                                        opt.kind === 'once'
                                                            ? null
                                                            : this._renderIntervalRow(opt, idx)
                                                    )
                                                    : null}
                                            </View>
                                        </View>
                                    )}

                                    {/* Foreground-only ("While Using") notice.
                                        Only rendered outside meet-mode (the
                                        RadioButton.Group branch) and only when
                                        the grant is positively foreground-only,
                                        so it never shows for an Always /
                                        unknown grant. Explains why every option
                                        but "Once" is disabled and offers a
                                        one-tap deep-link to upgrade to Always;
                                        returning to the app re-probes the
                                        permission and unlocks the options in
                                        place. */}
                                    {!this.props.meetMode
                                        && ShareLocationModal._isForegroundOnly(this.props.permissionLevel)
                                        ? (
                                        <View style={{
                                            paddingHorizontal: 12,
                                            paddingTop: 6,
                                            paddingBottom: 2,
                                        }}>
                                            <Text style={{ fontSize: 12, opacity: 0.85 }}>
                                                Disabled options become available when Location permission is set to <Text style={{ fontWeight: 'bold' }}>{Platform.OS === 'ios' ? 'Always' : 'Allow all the time'}</Text>.
                                            </Text>
                                            <Button
                                                mode="text"
                                                compact
                                                onPress={this.onOpenLocationSettings}
                                                accessibilityLabel="Open location settings"
                                                style={{ alignSelf: 'flex-start', marginTop: 2 }}
                                            >
                                                Open Settings
                                            </Button>
                                        </View>
                                    ) : null}

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
                                    {_isMeetingKind
                                        ? (
                                        <PrivacyRadiusSlider
                                        textColor={getModalColors().textPrimary}
                                        markerFillColor={getModalColors().surface}
                                            value={this.state.excludeOriginRadiusMeters}
                                            onChange={this.setRadiusStop}
                                            title="Hide my location near my starting point:"
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
                                        on which radio option is selected.
                                        Hidden when props.disclaimerSuppressed
                                        is true (the user previously confirmed
                                        with "Do not show this again"
                                        ticked). The suppression is sticky
                                        across share sessions and gets cleared
                                        when the user opts out of the privacy
                                        policy, so the legal text DOES come
                                        back the moment that contract is
                                        revoked. */}
                                    {/* Disclaimer + "Do not show this again"
                                        checkbox grouped inside one rounded-
                                        border container so the user reads
                                        them as a single unit ("here's what
                                        happens to your data, and you can
                                        opt out of seeing this again"). The
                                        whole block is hidden when the user
                                        previously confirmed with the box
                                        ticked — that flag is sticky across
                                        share sessions until they opt out of
                                        the privacy policy. */}
                                    {!this.props.disclaimerSuppressed ? (
                                        <View style={{
                                            marginTop: 6,
                                            marginBottom: 6,
                                            paddingVertical: 6,
                                            paddingHorizontal: 4,
                                            borderRadius: 8,
                                            borderWidth: 1,
                                            borderColor: 'rgba(0,0,0,0.15)',
                                        }}>
                                            <Text style={[styles.body, { paddingTop: 2, paddingBottom: 0, paddingHorizontal: 4, fontSize: 10, opacity: 0.75 }]}>
                                                {(() => {
                                                    const sel = _effectiveShare;
                                                    const head = 'Location data is encrypted end-to-end between devices, no intermediary server can decrypt it. ';
                                                    if (sel && sel.kind === 'meetingRequest') {
                                                        const _capHours = Math.round(sel.durationMs / HOUR_MS);
                                                        return head
                                                            + 'Sharing can be stopped at any time by clicking on the location icon. '
                                                            + 'It also stops automatically once you meet, or after '
                                                            + _capHours + (_capHours === 1 ? ' hour' : ' hours')
                                                            + ' — whichever comes first. '
                                                            + 'Location data will be destroyed on both devices after meetup.';
                                                    }
                                                    if (sel && sel.kind === 'untilIReturn') {
                                                        return head
                                                            + 'Sharing starts immediately and stops automatically when you return to where you started, '
                                                            + 'or after 8 hours — whichever comes first. '
                                                            + 'You can also stop it at any time by clicking on the location icon.';
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

                                            {/* "Do not show this again" —
                                                tapping anywhere on the row
                                                toggles the box. Centered
                                                horizontally and using a
                                                smaller font so it reads as
                                                a secondary control rather
                                                than competing with Confirm.
                                                The suppression is only
                                                persisted on Confirm — see
                                                onConfirm() — so cancelling
                                                out of the modal leaves the
                                                previous setting unchanged. */}
                                            <TouchableWithoutFeedback
                                                onPress={() => this.setState({
                                                    dontShowDisclaimerAgain: !this.state.dontShowDisclaimerAgain,
                                                })}
                                            >
                                                <View style={{
                                                    flexDirection: 'row',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    alignSelf: 'center',
                                                    marginTop: -8,
                                                }}>
                                                    {/* Checkbox.Android so the unchecked
                                                        box is visible on iOS too. */}
                                                    <Checkbox.Android
                                                        status={this.state.dontShowDisclaimerAgain ? 'checked' : 'unchecked'}
                                                        uncheckedColor="#666"
                                                        onPress={() => this.setState({
                                                            dontShowDisclaimerAgain: !this.state.dontShowDisclaimerAgain,
                                                        })}
                                                    />
                                                    <Text style={{
                                                        fontSize: 10,
                                                        marginLeft: 2,
                                                        opacity: 0.7,
                                                        textAlign: 'center',
                                                    }}>
                                                        Do not show this again
                                                    </Text>
                                                </View>
                                            </TouchableWithoutFeedback>
                                        </View>
                                    ) : null}

                                    {/* Inline warning — explains WHY the
                                        Confirm button is disabled.
                                        Two reasons in priority order:
                                        privacy-zone overlap (most
                                        actionable — pick a smaller
                                        radius) and destination not
                                        resolved yet. The "waiting for
                                        your current location" case is
                                        intentionally NOT surfaced here:
                                        the spinner inside the preview
                                        map box already tells the user
                                        the GPS fix is in flight, so a
                                        second "Waiting for your current
                                        location…" pill would just be
                                        redundant. */}
                                    {_privacyOverlapsDestination ? (
                                        <Text style={{
                                            fontSize: 11,
                                            textAlign: 'center',
                                            color: '#C0392B',
                                            paddingHorizontal: 12,
                                            marginTop: 4,
                                        }}>
                                            Your privacy zone covers the destination — pick a smaller radius or a different destination.
                                        </Text>
                                    ) : (this.props.meetMode && !_destResolved) ? (
                                        <Text style={{
                                            fontSize: 11,
                                            textAlign: 'center',
                                            opacity: 0.7,
                                            paddingHorizontal: 12,
                                            marginTop: 4,
                                        }}>
                                            Waiting for the destination to resolve…
                                        </Text>
                                    ) : _onceMissingUserLocation ? (
                                        // Only "Once" is gated on the current fix
                                        // (see _confirmDisabled). Explain the dimmed
                                        // Share button while the map acquires it.
                                        <Text style={{
                                            fontSize: 11,
                                            textAlign: 'center',
                                            opacity: 0.7,
                                            paddingHorizontal: 12,
                                            marginTop: 4,
                                        }}>
                                            Waiting for your location…
                                        </Text>
                                    ) : null}

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
                                            /* Locked while a share is starting
                                               so the modal stays put until the
                                               acquire-and-send finishes. */
                                            disabled={this.state.sharing}
                                            accessibilityLabel="Cancel"
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            mode="contained"
                                            style={styles.button}
                                            onPress={this.onConfirm}
                                            icon={_shareIcon}
                                            /* Disabled both while the normal
                                               gates fail AND while a share is
                                               in flight, so the user can't
                                               double-fire during the acquire
                                               latency. */
                                            disabled={_confirmDisabled || this.state.sharing}
                                            accessibilityLabel="Share location"
                                        >
                                            {this.state.sharing ? 'Sharing…' : 'Share'}
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

ShareLocationModal.propTypes = {
    show        : PropTypes.bool,
    close       : PropTypes.func.isRequired,
    onConfirm   : PropTypes.func.isRequired,
    uri         : PropTypes.string,
    displayName : PropTypes.string,
    // Which startable session types are ALREADY live for this contact, so the
    // picker can disable the matching options: { meet: bool, share: bool }.
    // meet live  → "Until we meet" disabled; share live → "Until stopped" and
    // "Until I return" disabled (only meet + Once remain). Defaults to all-free.
    liveTypes   : PropTypes.shape({
        meet  : PropTypes.bool,
        share : PropTypes.bool,
    }),
    // OS location grant level as reported by
    // LocationSharingManager.getLocationPermissionStatus():
    // 'always' | 'whenInUse' | 'foregroundOnly' | 'blocked' |
    // 'unavailable' | 'undetermined'. When it's a foreground-only value
    // ('whenInUse' / 'foregroundOnly') the picker restricts to "Once" and
    // shows the upgrade notice. null / undefined (e.g. the meet-me flow,
    // which opens before permission is probed) leaves every option enabled.
    permissionLevel : PropTypes.string,
    // Asks the parent (NavigationBar) to re-probe the OS permission and
    // refresh `permissionLevel`. Called when the app returns to the
    // foreground while the modal is open, so granting "Always" in Settings
    // unlocks the timed options without reopening the modal.
    onRefreshPermissionLevel : PropTypes.func,
    // True when the selected contact carries the 'caregiver' tag /
    // localProperties.caregiver flag. Surfaces the auto-stopping
    // "Until I return" option in the modal and pre-selects it.
    isCaregiver : PropTypes.bool,
    // Pre-select the share kind. Only 'meetingRequest' is honoured now —
    // it opens the modal with the "Until we meet" checkbox pre-checked.
    // Used by the Meet me there flow to land on 'meetingRequest'.
    presetKind  : PropTypes.string,
    // Meet me there mode: when true, hides all alternate duration
    // options (the meetingRequest entry is implicit) and renders a
    // destination-preview banner at the top.
    meetMode             : PropTypes.bool,
    meetDestination      : PropTypes.shape({
        latitude: PropTypes.number,
        longitude: PropTypes.number,
    }),
    // 'resolving' | 'resolved' | 'failed' — drives the banner copy
    // when meetDestination is null (no coords yet) or set.
    meetDestinationStatus: PropTypes.string,
    // True when the user previously confirmed with "Do not show this
    // again" ticked. Hides both the disclaimer text and the
    // checkbox itself. Sticky across share sessions until the user
    // opts out of the privacy policy.
    disclaimerSuppressed : PropTypes.bool,
    // Called by onConfirm() when the user pressed Confirm with the
    // checkbox ticked. The parent persists the suppression flag in
    // app_state.location.disclaimerSuppressed.
    onSuppressDisclaimer : PropTypes.func,
    // User's current location for the preview map. Fetched as a
    // fire-and-forget getCurrentCoordinates() in NavigationBar's
    // showShareLocationModal — null while the fix is in flight.
    // Drives the user pin AND the privacy-radius circle (when the
    // slider is non-zero).
    userLocation         : PropTypes.shape({
        latitude:  PropTypes.number,
        longitude: PropTypes.number,
    }),
    // Local user's display name. First letter is used as the red
    // avatar pin's label on the preview map. Falls back to '?'
    // when missing — same convention LocationBubble uses.
    myDisplayName        : PropTypes.string,
    // Last-used privacy radius from device preferences. Seeds the
    // slider's initial value when the modal opens; the modal calls
    // onPersistPrivacyRadius on Confirm with the user's final
    // choice so the same value comes back next time.
    defaultPrivacyRadiusMeters: PropTypes.number,
    onPersistPrivacyRadius    : PropTypes.func,
    // Last-used share option for this contact — a local, non-synced
    // per-contact preference ({mode, selectedInterval}) read from
    // contact.localProperties.shareLocationPrefs. Seeds the picker on open
    // (see defaultSelectionFor). mode is one of 'once' | 'untilStopped' |
    // 'untilReturn'; "meet" is never stored here.
    lastShareOption           : PropTypes.shape({
        mode:             PropTypes.string,
        selectedInterval: PropTypes.number,
    }),
    // Called from onConfirm with the chosen {mode, selectedInterval} so the
    // parent can persist it under the contact's localProperties (never for a
    // meetingRequest share). Non-synced — stays on the device.
    onPersistShareOption      : PropTypes.func,
    // True when the share target is the user's own account (self chat). Hides
    // the "Until we meet" option — a meet-up handshake with yourself is
    // meaningless — while leaving Once / Until stopped / Until I return
    // available. Computed by NavigationBarModals as uri === accountId.
    selfShare                 : PropTypes.bool,
};

export default ShareLocationModal;
