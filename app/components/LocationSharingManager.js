// LocationSharingManager.js
//
// The live-location-sharing engine. Owns the imperative machinery for
// caregiver / meet-up location shares: starting and stopping sessions, the
// per-tick GPS → location-payload pipeline, the OS-permission and Google-Play
// "prominent disclosure" gates, "until I return" / destination-arrival
// auto-stop, pause/resume, peer-location requests, and meeting-session
// teardown.
//
// The engine is hosted by the top-level app instance and reaches the app's
// state, services and SQL persistence (_persistActiveShares /
// _loadAndResumeActiveShares) through the injected `this.app` reference. The
// on-screen reflection goes through the NavigationBar view (this.navbar),
// which is null while no NavBar is mounted; every view call goes through the
// guarded _ui* helpers so a null view is safe. NavigationBar keeps one-line
// delegating stubs for every public method here. The debug convergence
// simulator is reached through `this.sim`.

import autoBind from 'auto-bind';
import { showThemedAlert } from './ThemedAlert';
import { Alert, AppState, Linking, Platform, PermissionsAndroid, NativeModules } from 'react-native';
import BackgroundTimer from 'react-native-background-timer';
import uuid from 'react-native-uuid';
import utils from '../utils';
import { openSettings, check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import {
    readAcknowledged as readLocationDisclosure,
    setAcknowledged as setLocationDisclosure,
    clearAcknowledged as clearLocationDisclosure,
} from './locationDisclosure';
import { haversineMeters, dummyOriginPoint, pickMeetingDestinationKmOnLand } from './geoUtils';
// The meet-up convergence simulator is driven at runtime by the
// "Location simulator" preference (accountSetting.location.simulatorEnabled),
// read here via this.app._locationSimulatorEnabled — same pref that
// drives the location-track walkers. No build constant is imported.

// Geolocation is an optional native dependency. Guard the require so that
// the app still boots if the pod/AAR hasn't been installed yet — callers
// will get a graceful failure instead of a red-box on launch.
let Geolocation = null;
try {
    // eslint-disable-next-line global-require
    Geolocation = require('@react-native-community/geolocation').default
               || require('@react-native-community/geolocation');
} catch (e) {
    console.log('@react-native-community/geolocation not installed:', e && e.message);
}

// Native bridge to Blink's Android foreground service that keeps the
// process promoted while a location share is active. Guarded so iOS and
// dev-time stripped builds don't explode if the module isn't registered.
const LocationForegroundServiceModule =
    Platform.OS === 'android'
        ? (NativeModules && NativeModules.LocationForegroundServiceModule) || null
        : null;

export default class LocationSharingManager {
    constructor(host) {
        // The top-level app instance. Location's authoritative state — timers,
        // the remote-share mirror, services, config, persistence — all live on
        // the app, so the engine IS hosted by it.
        this.app = host;
        // The LocationSimulator instance; assigned right after construction by
        // whoever creates the engine (the app), since engine and simulator
        // reference each other.
        this.sim = null;
        // The NavigationBar VIEW, assigned when NavBar mounts (engine.ui = nav)
        // and cleared on its unmount. null while no NavBar is mounted — every
        // view call goes through the guarded _ui* helpers, so a null ui is safe.
        this.navbar = null;
        // Meeting-session registry: engine-owned authoritative
        // map of active meet sessions. app-side callers use this._locationEngine.meetingSessions.
        this.meetingSessions = {};
        // Live outgoing/incoming location-session registries. Engine-owned: the
        // engine owns the whole share lifecycle that mutates them, so the data
        // lives next to that logic.
        //   • outgoingLocationSessions — plain timed shares (fixed/untilIReturn),
        //     keyed by peer uri.
        //   • outgoingMeetSessions — meet ("Until we meet") legs, keyed by peer
        //     uri, so a meet and a plain share to the same contact coexist.
        //   • incomingLocationSessions — shares a peer is broadcasting to us,
        //     keyed by the sender's session/origin id.
        // app.js reaches these via this._locationEngine.<name>; NavigationBar
        // borrows outgoingLocationSessions by reference for read-only pulse/menu
        // checks. The React-state mirrors (activeLocationShares,
        // incomingLocationShareUris) stay on the app because they need setState.
        this.outgoingLocationSessions = {};
        this.outgoingMeetSessions = {};
        this.incomingLocationSessions = {};
        // Share-lifecycle internals: engine-owned.
        //   • _pendingPermissionShares — share intents deferred until the OS
        //     location permission is sufficient (drained on app-foreground).
        //   • _startingShares — in-flight start guard (dedupes rapid taps).
        //   • _pendingStops — reentrancy guard for stopLocationSharing.
        //   • _shareStateLogStamps — throttle stamps for share-state probe logs.
        this._pendingPermissionShares = {};
        this._startingShares = new Set();
        this._pendingStops = new Set();
        this._shareStateLogStamps = {};
        // Meeting handshake + share-mirror registries: engine-owned bare
        // state. The app's message pipeline / SQL persistence read & write these
        // across the seam via this._locationEngine.*. Kept off React state so
        // additions don't trigger renders on every location tick.
        //   • handledMeetingRequestIds — request _ids we've already presented (or
        //     auto-handled) so the modal never pops twice for the same request.
        //     Hydrated from AsyncStorage on mount; persisted on every change.
        //   • pendingMeetingRequests — {uri: {requestId, expiresAt, fromUri}} for a
        //     request that arrived while that uri's chat wasn't open; drained into
        //     the modal when the user opens that chat.
        //   • handledAcceptanceIds — request _ids for which we've already rendered
        //     the "peer accepted" system note on the requester side (dedupes retries).
        //   • myOutgoingMeetingRequestIds — origin ticks we sent with
        //     meeting_request:true; used to recognise incoming acceptance ticks
        //     (metadata.in_reply_to === one of these) and render "peer accepted".
        //   • acceptedMeetingRequestIds — incoming request _ids we've ACCEPTED on
        //     this device (accepter-side mirror of myOutgoing...); used by
        //     _injectLocationBubble to suppress the duplicate outgoing reply bubble.
        //   • endedMeetingSessionIds — persistent tombstone of sessions that ENDED
        //     (met / expired / cancelled); survives the prune of handled/accepted so
        //     a journal-replayed meeting_request can't re-present the accept modal.
        //   • _deletedLocationBubbleIds — bubble ids the user explicitly deleted;
        //     belt-and-braces guard against getMessages re-synthesising a deleted
        //     bubble from straggler trail rows. In-memory only (session-scoped).
        //   • _activeRemoteShares — Map<peerUri, {originMid, lastTickAt, lastCoords,
        //     role}> multi-device mirror: another device of this account broadcasting
        //     a share renders here from its self-echoed ticks (no local timer).
        //     Seeded from the SQL journal on boot; inactivity sweep evicts >90s.
        this.handledMeetingRequestIds = new Set();
        this.pendingMeetingRequests = {};
        this.handledAcceptanceIds = new Set();
        this.myOutgoingMeetingRequestIds = new Set();
        this.acceptedMeetingRequestIds = new Set();
        this.endedMeetingSessionIds = new Set();
        this._deletedLocationBubbleIds = new Set();
        this._activeRemoteShares = new Map();
        // Proximity/meet + location-request registries: engine-owned.
        // metPeerUris — peer URIs this device has met with in a past "Until we meet"
        // session (proximity-met fired before). Picks the greeting variant in
        // _maybeFireProximityMeet ("Nice to meet you!" vs "…again!"). Persisted.
        this.metPeerUris = new Set();
        // _proximityNotedSessionIds — sessions we've already emitted the "Location
        // sharing stopped at HH:MM" note for (local proximity OR a peer's meeting_end
        // with reason='proximity'). Dedup so it doesn't log twice per device. In-memory.
        this._proximityNotedSessionIds = new Set();
        // _meetLastDistanceBand — Map<sessionId, bandName> for the [meet] narrative
        // logger; prints a distance line only on band crossings (km → hundreds → tens
        // → ≤ threshold), never every tick.
        this._meetLastDistanceBand = {};
        // meetingSessionWipeTimers — pending wipe timers keyed by sessionId. At
        // expires_at we wipe the session's messages from SQL + live state; a map so
        // repeated observations de-duplicate scheduling.
        this.meetingSessionWipeTimers = {};
        // handledLocationRequestIds — incoming location-request _ids we've already
        // presented (modal shown or expired). Memory-only.
        this.handledLocationRequestIds = new Set();
        // siblingAnsweredLocationRequestIds — location requests a sibling device on
        // this account answered; the pre-modal 2 s delay consults it to skip
        // presenting (can't reuse handledLocationRequestIds — stamped before the
        // setTimeout, so it'd always read handled).
        this.siblingAnsweredLocationRequestIds = new Set();
        // pendingLocationRequests — per-peer pending request, keyed by sender uri.
        this.pendingLocationRequests = {};
        // _meetReportedEnded — dedup for the "SESSION ENDED" note (fired from
        // both local teardown and the incoming meeting_end handler). In-memory.
        this._meetReportedEnded = new Set();
        // "Until I return" auto-stop thresholds (metres) — engine-owned config.
        // Symmetric departure/return rings.
        this.UNTIL_RETURN_DEPARTURE_M = 100;
        this.UNTIL_RETURN_RETURN_M = 100;
        // Bind prototype methods so bare references passed to timers /
        // native callbacks keep the right `this` (mirrors the component's
        // autoBind). Arrow class-property methods are already bound.
        autoBind(this);
    }

    // ── Concurrent-session store helpers ──────────────────────────────
    // Outgoing location sessions are split across TWO uri-keyed maps so a
    // contact can have a meet ("Until we meet") AND a plain timed share live
    // at the same time without colliding on a single [uri] slot:
    //   • _plainStore() — app.outgoingLocationSessions — fixed/untilIReturn/once
    //   • _meetStore()  — app.outgoingMeetSessions      — meetingRequest/meetingAccept
    // Every write routes through _storeForKind(kind); reads that already know
    // the session's originLocationId use _entryByOrigin so they find the entry
    // in whichever store holds it. Reads that mean "the session for this peer"
    // (legacy one-per-uri assumption) fall back to the plain entry, then meet.
    _plainStore() {
        if (!this.outgoingLocationSessions) this.outgoingLocationSessions = {};
        return this.outgoingLocationSessions;
    }
    _meetStore() {
        if (!this.outgoingMeetSessions) this.outgoingMeetSessions = {};
        return this.outgoingMeetSessions;
    }
    _isMeetKind(kind) {
        return kind === 'meetingRequest' || kind === 'meetingAccept';
    }
    _storeForKind(kind) {
        return this._isMeetKind(kind) ? this._meetStore() : this._plainStore();
    }
    _storeOfEntry(entry) {
        return (entry && this._isMeetKind(entry.kind)) ? this._meetStore() : this._plainStore();
    }
    // The entry (in either store) for `uri` matching `originId`. With no originId,
    // prefer the plain entry, else the meet entry — backward-compat for the many
    // callers that historically assumed a single entry per uri. null if none.
    _entryByOrigin(uri, originId) {
        if (!uri) return null;
        const plain = this._plainStore()[uri];
        const meet = this._meetStore()[uri];
        if (originId != null) {
            if (plain && plain.originLocationId === originId) return plain;
            if (meet && meet.originLocationId === originId) return meet;
            // meet legs are also addressed by their meetingSessionId
            if (meet && meet.meetingSessionId === originId) return meet;
            return null;
        }
        return plain || meet || null;
    }
    _meetEntryForUri(uri) {
        return (uri && this._meetStore()[uri]) || null;
    }
    _plainEntryForUri(uri) {
        return (uri && this._plainStore()[uri]) || null;
    }
    // Every live outgoing entry for a uri across both stores (0, 1, or 2).
    _allEntriesForUri(uri) {
        const out = [];
        const plain = uri && this._plainStore()[uri];
        const meet = uri && this._meetStore()[uri];
        if (plain) out.push(plain);
        if (meet) out.push(meet);
        return out;
    }
    // True if ANY outgoing entry (plain or meet) is armed for uri. Replaces the
    // old `!!outgoingLocationSessions[uri]` "is anything live for this peer" test.
    _hasAnyEntryForUri(uri) {
        return !!(uri && (this._plainStore()[uri] || this._meetStore()[uri]));
    }

    // ── UI predicates: which startable session types are live for a contact ──
    // A "meet" and a plain "share" are the two things the local user can start
    // from the picker; the pin/modal use these to disable already-live options
    // and to decide when to open the active-sessions list instead of the picker.
    // Consults the app's unified session list (covers sibling-device mirrors)
    // and the local stores as authoritative fallback. By design a
    // sent-but-unaccepted meet invite does NOT count — only an armed meet leg
    // (local meet entry, or an accepted remote meet mirror) does.
    getStartableLiveTypes(uri) {
        let meet = false;
        let share = false;
        if (uri) {
            // LOCAL meet leg. A requester's invite that is still HELD awaiting
            // the peer's acceptance does NOT count as live (by design:
            // only an accepted/broadcasting meet gates "Until we meet"). The
            // accepter's own leg is never held, so it counts immediately.
            const m = this._meetStore()[uri];
            if (m) {
                const _sid = m.meetingSessionId;
                const _awaiting = !!(this._awaitingAcceptSessions && _sid
                    && this._awaitingAcceptSessions.has(_sid));
                if (!_awaiting) meet = true;
            }
            // LOCAL plain timed share.
            const pe = this._plainStore()[uri];
            if (pe && (pe.kind === 'fixed' || pe.kind === 'untilIReturn')) share = true;
            // REMOTE (sibling-device) sessions via the app's unified list. Its
            // remote branch already filters out un-accepted meet invites, so a
            // 'meeting' session here is a real, accepted meet. We only read the
            // NOT-owned rows to avoid re-counting the local legs handled above
            // (which would bypass the awaiting-accept filter).
            try {
                const sessions = (this.app.getActiveShareSessions && this.app.getActiveShareSessions()) || {};
                for (const sid of Object.keys(sessions)) {
                    const s = sessions[sid];
                    if (!s || s.peerUri !== uri) continue;
                    if (s.kind === 'meeting') {
                        // Only accepted meets count. Owned local meet legs may be
                        // a still-HELD invite (not live) — those are gated by the
                        // meetStore/_awaitingAcceptSessions check above, so here we
                        // only trust NOT-owned (sibling, already-accepted) meets.
                        if (!s.owned) meet = true;
                    } else {
                        // Any plain 'location' session — owned (this device) OR a
                        // sibling mirror — means a timed share is live for this uri.
                        share = true;
                    }
                }
            } catch (e) { /* best-effort */ }
        }
        return { meet, share };
    }
    isMeetLiveForUri(uri) {
        return this.getStartableLiveTypes(uri).meet;
    }
    isPlainShareLiveForUri(uri) {
        return this.getStartableLiveTypes(uri).share;
    }

    // ===== Active-share list derivation (the NavigationBar view consumes these
    // via this._locationEngine.*). Pure share-state logic over the app-owned
    // session map + this engine's timer registry. =====

    // The app-authoritative sessions map (keyed by sessionId) — the single
    // source of truth for the pulse, the panel and Stop routing. Read via the
    // app's getActiveShareSessions(); {} if the app isn't wired yet (defensive).
    _shareSessions() {
        try {
            if (this.app && typeof this.app.getActiveShareSessions === 'function') {
                return this.app.getActiveShareSessions() || {};
            }
        } catch (e) { /* noop */ }
        return {};
    }

    // The broadcaster share map ({uri: expiresAtMs}), owned by the app (the
    // engine writes it via this.app.setState). {} if the app isn't wired yet.
    _activeShares() {
        const app = this.app;
        return (app && app.state && app.state.activeLocationShares) || {};
    }

    // True when a share for `uri` is active on ANOTHER of our devices and this
    // device is only mirroring it (no local timer). Lets the share menu offer
    // "Stop" so a session started elsewhere can be finished here — the stop is
    // relayed by stopLocationSharing's mirror path.
    _isShareActiveRemote(uri) {
        if (!uri) return false;
        const sessions = this._shareSessions();
        for (const sid of Object.keys(sessions)) {
            const s = sessions[sid];
            if (s && s.peerUri === uri) return !s.owned; // remote = owned by a sibling
        }
        return false;
    }

    // Active shares for the stop panel, as {uri: expiresAtMs|null}, derived from
    // the authoritative session list (local + sibling-owned). One source of
    // truth — no per-URI mirror-map desync.
    getActiveSharesForModal() {
        const merged = {};
        const sessions = this._shareSessions();
        for (const sid of Object.keys(sessions)) {
            const s = sessions[sid];
            if (s && s.peerUri && merged[s.peerUri] === undefined) {
                merged[s.peerUri] = s.expiresAt || null;
            }
        }
        // Broadcaster ground truth. Any locally-armed GPS timer IS an active
        // share by definition — the device is emitting ticks right now. Read the
        // timer registry directly so the device doing the sharing always lists
        // its own session and can stop it, independent of whether the
        // authoritative session map has surfaced it yet.
        const outgoingSessions = this.outgoingLocationSessions || {};
        for (const uri of Object.keys(outgoingSessions)) {
            if (merged[uri] === undefined) {
                const t = outgoingSessions[uri];
                merged[uri] = (t && typeof t.expiresAt === 'number') ? t.expiresAt : null;
            }
        }
        // Fallback: our own local broadcaster state, in case a session hasn't
        // surfaced in the authoritative list yet (first tick race).
        const local = this._activeShares() || {};
        for (const uri of Object.keys(local)) {
            if (merged[uri] === undefined) merged[uri] = local[uri];
        }
        return merged;
    }

    // Rich per-SESSION list for the ActiveLocationSharesModal: one row per live
    // session so a contact's meet AND plain share both appear, each with its own
    // type label and Stop. Shape: [{uri, sessionId, type:'meet'|'share',
    // expiresAt, owned, paused}]. Incoming shares are intentionally NOT included.
    getActiveSharesRowsForModal() {
        const rows = [];
        const sessions = this._shareSessions();
        for (const sid of Object.keys(sessions)) {
            const s = sessions[sid];
            if (!s || !s.peerUri) continue;
            const type = (s.kind === 'meeting') ? 'meet' : 'share';
            let paused = false;
            try {
                const entry = (typeof this._entryByOrigin === 'function')
                    ? this._entryByOrigin(s.peerUri, s.sessionId)
                    : null;
                paused = !!(entry && entry.paused);
            } catch (e) { /* best-effort */ }
            rows.push({
                uri: s.peerUri,
                sessionId: s.sessionId,
                type,
                expiresAt: (s.expiresAt != null) ? s.expiresAt : null,
                owned: !!s.owned,
                paused,
            });
        }
        return rows;
    }

    // Dump the authoritative live share-session list + each session's expiry to
    // the log. Called when the user taps the navbar active-shares button.
    _dumpActiveShareSessions() {
        try {
            const sessions = this._shareSessions();
            const ids = Object.keys(sessions);
            const now = Date.now();
            utils.timestampedLog('[location] [sessions] tap: ' + ids.length + ' active');
            for (const sid of ids) {
                const s = sessions[sid] || {};
                const exp = (typeof s.expiresAt === 'number') ? s.expiresAt : null;
                const inSec = (exp != null) ? Math.round((exp - now) / 1000) : null;
                utils.timestampedLog('[location] [sessions]   ' + String(sid).slice(0, 8)
                    + ' peer=' + s.peerUri
                    + ' kind=' + s.kind
                    + ' owned=' + s.owned
                    + ' ownerDeviceId=' + (s.ownerDeviceId || '-')
                    + ' role=' + (s.role || '-')
                    + ' expiresAt=' + (exp != null ? new Date(exp).toISOString() : '-')
                    + ' expiresIn=' + (inSec != null ? inSec + 's' : '-'));
            }
        } catch (e) { /* logging must never break the tap */ }
    }

    // Share-menu gate: is there a genuine two-way conversation with `uri`?
    // Scans the app's message map, ignoring system / metadata / imdn / pgp
    // markers. Any live-location bubble counts as bidi in BOTH directions (a
    // contact who only ever shared their location with us still has a real
    // relationship, so the share button must not vanish once the share ends).
    _hasBidirectionalChat(uri) {
        if (!uri) return false;
        const _map = (this.app && typeof this.app._messagesMap === 'function')
            ? this.app._messagesMap() : null;
        const msgs = (_map && _map[uri]) || [];
        if (!Array.isArray(msgs) || msgs.length === 0) return false;
        let hasOut = false;
        let hasIn = false;
        for (const m of msgs) {
            if (!m) continue;
            if (m.system === true) continue;
            const ct = m.contentType;
            if (typeof ct !== 'string') continue;
            if (ct === 'application/sylk-message-metadata') continue;
            if (ct === 'application/sylk-contact-update') continue;
            if (ct === 'message/imdn') continue;
            if (ct.indexOf('pgp') !== -1) continue;
            if (ct === 'application/sylk-location-sharing') {
                return true;
            }
            const dir = m.direction;
            if (dir === 'outgoing') hasOut = true;
            else if (dir === 'incoming') hasIn = true;
            if (hasOut && hasIn) return true;
        }
        return false;
    }

    // Reconcile stale broadcaster shares: any uri in activeLocationShares that
    // isn't backed by a live timer AND isn't mid-startup (per-store in-flight
    // guard on the engine-owned _startingShares) is dropped, keeping the pulse
    // state eventually-consistent with the actual share state regardless of
    // which cleanup path missed. Writes app.setState when it prunes. Returns
    // true if it reconciled (caller should then skip that frame's pulse toggle).
    reconcileActiveShares() {
        const sharesMap = this._activeShares() || {};
        const sharesUris = Object.keys(sharesMap);
        if (sharesUris.length === 0) return false;
        let reconciled = null;
        const staleUris = [];
        const _startingShares = this._startingShares;
        sharesUris.forEach((uri) => {
            // A session for this uri may live in EITHER store (plain share or
            // meet leg) — a meet-only session must not be reconciled away.
            const hasTimer = (typeof this._hasAnyEntryForUri === 'function')
                ? this._hasAnyEntryForUri(uri)
                : !!(this.outgoingLocationSessions && this.outgoingLocationSessions[uri]);
            // In-flight guard keys are per-store (`uri#plain` / `uri#meet`).
            const starting = !!(_startingShares
                && (_startingShares.has(uri + '#plain')
                    || _startingShares.has(uri + '#meet')
                    || _startingShares.has(uri)));
            if (!hasTimer && !starting) {
                if (!reconciled) reconciled = {...sharesMap};
                delete reconciled[uri];
                staleUris.push(uri);
            }
        });
        if (reconciled) {
            console.log('[location] reconcile: dropping stale activeLocationShares', staleUris);
            if (this.app && typeof this.app.setState === 'function') {
                this.app.setState({activeLocationShares: reconciled});
            }
            return true;
        }
        return false;
    }

    // Can THIS device end the SPECIFIC session a given map bubble represents?
    // Drives the map bubble's "Stop sharing" button. Matched by the bubble's
    // own origin/session id — NOT merely by (uri, type) — so that a chat with
    // many historical location bubbles for the same contact only lights Stop on
    // the one bubble whose session is actually live right now (a type-only match
    // lit Stop on every past bubble too — reported symptom).
    //   • Local owned entry: _entryByOrigin matches a plain share by its
    //     originLocationId and a meet by its originLocationId OR meetingSessionId
    //     (so it survives the meet accept handshake).
    //   • Sibling-device MIRROR: an _activeRemoteShares entry for this peer whose
    //     originMid equals the bubble's id — endable via the stop relay.
    // A session that has already ended (durable ended marker) never qualifies,
    // so a reload / journal replay that transiently re-seeds a stopped session's
    // mirror can't resurrect its Stop button.
    hasStoppableSessionForBubble(uri, sessionId, isMeet) {
        if (!uri || !sessionId) return false;
        // Never offer Stop for a session known to have ended.
        try {
            if (this.app._endedLocationSessions
                    && this.app._endedLocationSessions.has(sessionId)) return false;
        } catch (e) { /* best-effort */ }
        // Locally-owned entry for THIS bubble's session.
        try {
            if (this._entryByOrigin(uri, sessionId)) return true;
        } catch (e) { /* best-effort */ }
        // Sibling-device MIRROR of the matching TYPE (endable via the relay
        // inside stopLocationSharing). Matched by uri + type rather than the
        // mirror's originMid, because a mirror entry's origin id does not
        // reliably equal the bubble's message id on the receiving device — an
        // id-exact match hid Stop on the 2nd device even while the share was
        // live. There is at most one active mirror per type per contact, and
        // an ENDED bubble is already excluded above (ended-set) and by the
        // caller's trackEnded gate, so a type match here can't light Stop on a
        // stale/past bubble.
        // Read the app's unified session list (getActiveShareSessions) rather
        // than the _activeRemoteShares Map alone: that list UNIONS the live Map
        // with its React-state twin, so a mirror entry the ~90s inactivity sweep
        // evicted from the Map between the broadcaster's ticks is still seen
        // (that gap was hiding Stop on the 2nd device mid-share). NOT-owned rows
        // only — owned local sessions are handled by _entryByOrigin above.
        try {
            const sessions = (this.app.getActiveShareSessions && this.app.getActiveShareSessions()) || {};
            for (const sid of Object.keys(sessions)) {
                const s = sessions[sid];
                if (!s || s.peerUri !== uri || s.owned) continue;
                if (isMeet ? (s.kind === 'meeting') : (s.kind === 'location')) return true;
            }
        } catch (e) { /* best-effort */ }
        return false;
    }

    // this.navbar (the NavigationBar VIEW) is a plain field set on NavBar mount /
    // cleared on unmount — see the constructor. The engine touches it only for
    // genuine UI (share/preview modal state, pulse, forceUpdate) and always via
    // the guarded _ui* helpers below, so it tolerates a null/unmounted view.

    // Guarded view accessors. The engine is hosted by the app and outlives
    // NavigationBar, so every view call must tolerate a
    // null/unmounted ui. A missing view means "no UI to update" — writes no-op,
    // reads return {} — which is correct: the engine's data work still happens
    // via this.app; only the on-screen reflection is skipped until NavBar is
    // back (its next mount re-reads app-owned state).
    _uiSetState(patch) {
        const u = this.navbar;
        if (u && !u._unmounted) u.setState(patch);
    }
    _uiState() {
        const u = this.navbar;
        return (u && u.state) || {};
    }
    _uiForceUpdate() {
        const u = this.navbar;
        if (u && !u._unmounted) u.forceUpdate();
    }
    _uiStartPulse() {
        const u = this.navbar;
        if (u) u._startActiveSharePulse();
    }
    _uiStopPulse() {
        const u = this.navbar;
        if (u) u._stopActiveSharePulse();
    }

    // Release the live OS handles (BackgroundTimer interval + expiry, GPS watch)
    // for every armed share and drop the entries from the app-owned registry.
    // Called from NavigationBar.componentWillUnmount so the view no
    // longer needs to import BackgroundTimer/Geolocation itself. This is a
    // handle-release only — it deliberately does NOT go through stopLocationSharing
    // (no stop signals, no system notes, no persistence wipe): a NavBar unmount
    // is a view teardown, not a user stop. The AsyncStorage resume snapshot is
    // left intact so the shares re-arm on the next mount.
    releaseTimerHandles() {
        // Release handles from BOTH stores — a contact may have a plain share
        // and a meet leg armed at once and both must be torn down on unmount.
        const _stores = [this.outgoingLocationSessions, this.outgoingMeetSessions];
        for (const timers of _stores) {
            if (!timers) continue;
            for (const uri of Object.keys(timers)) {
                const entry = timers[uri];
                if (!entry) continue;
                try {
                    if (entry.intervalId != null) BackgroundTimer.clearInterval(entry.intervalId);
                } catch (e) { /* noop */ }
                try {
                    if (entry.watchId != null && Geolocation
                            && typeof Geolocation.clearWatch === 'function') {
                        Geolocation.clearWatch(entry.watchId);
                    }
                } catch (e) { /* noop */ }
                try {
                    if (entry.expiryTimeoutId != null) BackgroundTimer.clearTimeout(entry.expiryTimeoutId);
                } catch (e) { /* noop */ }
                // Registry is app-owned and outlives the view — drop the entry so the
                // app doesn't carry a dead-handle timer and the resume path can
                // re-arm this share cleanly on the next mount.
                try { delete timers[uri]; } catch (e) { /* noop */ }
            }
        }
    }

    showShareLocationModal(uri, liveTypes) {
        // Open the picker IMMEDIATELY for instant tap feedback. Everything
        // that can add perceptible latency — the Prominent Disclosure gate,
        // the OS permission prompt, the grant-level probe, and the GPS
        // preview fetch — used to run BEFORE this setState, so the modal only
        // appeared after that whole async chain settled (the reported delay).
        // Now it renders on the same frame as the tap and the gates run in
        // the background (see _runShareModalGates), each writing back to
        // state as it resolves. Mirrors the meetMeAt() optimistic-open
        // pattern already used for the "Meet me there…" entry point.
        //
        // shareLocationPermissionLevel starts null ("unknown → don't gate")
        // so no features are prematurely disabled; _runShareModalGates fills
        // it in once the OS grant is known. The Share button is independently
        // gated on having a location fix (previewUserLocation), which only
        // lands after permission is granted, so the user can't confirm a
        // share before the gates have run regardless.
        // Capture the target contact + its live session types NOW, at tap time,
        // when the selection is definitely valid. The modal reads liveTypes from
        // THIS captured state instead of recomputing from selectedContact at
        // render — that live prop (app.state.selectedContact, passed to
        // NavigationBar) can momentarily flicker to null during unrelated
        // re-renders, and when it did the render-time compute silently returned
        // {share:false} and the picker showed every option enabled while a share
        // was already live (reported symptom). Captured once here it's stable
        // for the life of the modal; _onLocationSessionsChanged refreshes it
        // while open so a session starting/ending on another device still
        // updates the disabled options live.
        let _shareUri = (uri != null) ? uri : null;
        if (!_shareUri) {
            const _sc = this.app.state && this.app.state.selectedContact;
            _shareUri = (_sc && _sc.uri) || null;
        }
        let _shareTypes = liveTypes || null;
        if (!_shareTypes && _shareUri && typeof this.getStartableLiveTypes === 'function') {
            try { _shareTypes = this.getStartableLiveTypes(_shareUri); } catch (e) { _shareTypes = null; }
        }

        this._uiSetState({
            showShareLocationModal: true,
            shareLocationPermissionLevel: null,
            previewUserLocation: null,
            shareModalUri: _shareUri,
            shareLiveTypes: _shareTypes || { meet: false, share: false },
        });

        // Re-hydrate the disclaimer-suppressed flag from app_state so the
        // disclaimer block hides on this open if the user previously
        // confirmed with the box ticked. Fire-and-forget — a re-render
        // picks up the resolved value within a frame or two.
        this._hydrateDisclaimerSuppression();

        // Run disclosure + permission gates and the preview fetch off the
        // main path so none of them block the modal from rendering.
        this._runShareModalGates();
    }

    // Background gate runner for the button-tap share-modal open. Sequenced
    // exactly like the old synchronous showShareLocationModal, but the modal
    // is already on screen so each step just updates it (or closes it) as it
    // resolves:
    //   1. Prominent Disclosure — declined ⇒ close the picker we opened.
    //   2. OS permission (may prompt) — denied ⇒ close + Settings alert.
    //   3. Grant-level probe — sets shareLocationPermissionLevel so the
    //      picker can disable the background-only options under a
    //      foreground-only ("While Using") grant.
    //   4. GPS preview fetch — renders the current-location pin + map.
    // Each step bails if the user has meanwhile closed the picker, so we
    // never write state onto a dismissed modal.
    async _runShareModalGates() {
        // 1. Prominent Disclosure gate.
        let acknowledged = false;
        try {
            acknowledged = await this._ensureLocationDisclosureAcknowledged();
        } catch (e) {
            acknowledged = false;
        }
        if (!this._uiState().showShareLocationModal) { return; }
        if (!acknowledged) {
            utils.timestampedLog('[location] shareModal: disclosure declined — closing picker');
            this.hideShareLocationModal();
            return;
        }

        // 2. OS permission (this is the step that can pop the system prompt).
        let hasPermission = false;
        try {
            hasPermission = await this.ensureLocationPermission();
        } catch (e) {
            hasPermission = false;
        }
        // User may have cancelled the picker while the prompt was up.
        if (!this._uiState().showShareLocationModal) { return; }
        if (!hasPermission) {
            utils.timestampedLog('[location] shareModal: OS permission not granted — closing picker');
            this.hideShareLocationModal();
            const openSettingsFn = () => {
                try {
                    if (Platform.OS === 'ios') {
                        Linking.openURL('app-settings:');
                    } else {
                        try { openSettings(); }
                        catch (e) { Linking.openSettings && Linking.openSettings(); }
                    }
                } catch (e) { /* noop */ }
            };
            Alert.alert(
                'Location permission required',
                Platform.OS === 'ios'
                    ? "Open Settings → Blink → Location to allow location access."
                    : "Open Settings to allow Blink to access your location.",
                [
                    {text: 'Cancel', style: 'cancel'},
                    {text: 'Open Settings', onPress: openSettingsFn},
                ],
                {cancelable: true}
            );
            return;
        }

        // 3. Probe the grant level so the picker can gate the background-only
        //    options. Best-effort: 'undetermined' on failure leaves every
        //    option enabled rather than falsely locking the picker.
        let permLevel = 'undetermined';
        try {
            permLevel = await this.getLocationPermissionStatus();
        } catch (e) {
            permLevel = 'undetermined';
        }
        if (!this._uiState().showShareLocationModal) { return; }
        this._uiSetState({ shareLocationPermissionLevel: permLevel });

        // 4. Fetch the current location so the preview map + user pin render.
        this._fetchPreviewLocation();
    }

    // Fire-and-forget GPS fetch to populate `state.previewUserLocation`.
    // Called from BOTH share-modal-open paths: showShareLocationModal()
    // (button-tap entry) AND meetMeAt() (chat-link entry which opens
    // the modal via direct setState). Without this both-paths wiring
    // a "Meet me there..." flow opens the modal but never gets a
    // user pin because the GPS fetch fires only on the button-tap
    // path.
    _fetchPreviewLocation() {
        // Reset the previous fix immediately so a stale one from an
        // earlier modal-open doesn't render briefly while the new
        // one is in flight.
        this._uiSetState({previewUserLocation: null});
        try {
            //utils.timestampedLog('[location] preview: requesting current location for share modal');
            this.getCurrentCoordinates().then((coords) => {
                if (!this.navbar || this.navbar._unmounted) {
                    utils.timestampedLog('[location] preview: GPS fix landed but component unmounted — discarding');
                    return;
                }
                if (!coords
                        || typeof coords.latitude !== 'number'
                        || typeof coords.longitude !== 'number') {
                    utils.timestampedLog('[location] preview: GPS fix returned invalid coords', JSON.stringify(coords));
                    return;
                }
                // Defensive: if the modal was already closed before the
                // fix landed, don't write stale state.
                if (!this._uiState().showShareLocationModal) {
                    utils.timestampedLog('[location] preview: GPS fix landed but modal already closed — discarding');
                    return;
                }
                utils.timestampedLog('[location] preview: current location acquired —', coords.latitude.toFixed(5) + ',' + coords.longitude.toFixed(5), typeof coords.accuracy === 'number' ? `±${Math.round(coords.accuracy)}m` : '');
                this._uiSetState({previewUserLocation: {
                    latitude: coords.latitude,
                    longitude: coords.longitude,
                    // Kept so startLocationSharing can reuse this fix for the
                    // origin tick when the user Confirms quickly (see
                    // _freshPreviewFix). accuracy rides along so the reused
                    // origin tick carries the same quality as a live fix;
                    // acquiredAt is the fix time we measure freshness against.
                    accuracy: typeof coords.accuracy === 'number' ? coords.accuracy : undefined,
                    acquiredAt: typeof coords.timestamp === 'number' ? coords.timestamp : Date.now(),
                }});
            }).catch((err) => {
                utils.timestampedLog('[location] preview: getCurrentCoordinates failed —', err && err.message ? err.message : err, 'code=', err && err.code);
            });
        } catch (e) {
            utils.timestampedLog('[location] preview: getCurrentCoordinates threw synchronously —', e && e.message ? e.message : e);
        }
    }

    // Return the modal's preview location fix IF it's still fresh enough to
    // seed a share's origin tick (default: acquired within the last 60 s),
    // else null. Lets startLocationSharing skip a redundant GPS acquire when
    // the user Confirms shortly after the picker fetched their position —
    // the first bubble then renders immediately from the fix we already have.
    // Shape matches getCurrentCoordinates(): {latitude, longitude, accuracy,
    // timestamp}. Returns null if there's no preview, it lacks a timestamp,
    // or it has aged out — callers then fall back to a live fetch.
    _freshPreviewFix(maxAgeMs = 60000) {
        const p = this._uiState() && this._uiState().previewUserLocation;
        if (!p
                || typeof p.latitude !== 'number'
                || typeof p.longitude !== 'number'
                || typeof p.acquiredAt !== 'number') {
            return null;
        }
        if (Date.now() - p.acquiredAt > maxAgeMs) {
            return null;
        }
        return {
            latitude: p.latitude,
            longitude: p.longitude,
            accuracy: typeof p.accuracy === 'number' ? p.accuracy : undefined,
            timestamp: p.acquiredAt,
        };
    }

    hideShareLocationModal() {
        // Always clear the pending destination + URL + status on
        // close. Confirm and cancel both route here.
        // onShareLocationConfirmed reads pendingShareDestination
        // (and re-tries pendingShareDestinationUrl as a last-ditch
        // synchronous resolve) BEFORE this fires, so confirmed
        // shares still get the destination.
        this._uiSetState({
            showShareLocationModal: false,
            pendingShareDestination: null,
            pendingShareDestinationUrl: null,
            pendingShareDestinationStatus: null,
            // Drop the preview pin so a stale fix doesn't render
            // briefly the next time the modal opens with a different
            // destination — showShareLocationModal will rearm a fresh
            // getCurrentCoordinates fetch.
            previewUserLocation: null,
            // Clear the probed grant level so the next open starts fresh.
            // The meet-me entry points open the modal without probing
            // permission (gates run in the background), so leaving a stale
            // foreground-only value here could wrongly gate that flow;
            // resetting to null means "unknown → don't gate".
            shareLocationPermissionLevel: null,
        });
    }

    // Bridge from ContactsListBox's "Meet me there..." kebab / inline
    // icon on a Google-Maps-link text bubble. Stages the destination
    // and opens the share-location duration picker. The user picks the
    // meet-up duration; on confirm `onShareLocationConfirmed` reads
    // pendingShareDestination and stamps it onto every emitted tick.
    //
    // Accepts the descriptor returned by `utils.extractLocationLink`:
    //   {type: 'direct', coords: {latitude, longitude}}
    //     Stage immediately and open the panel.
    //   {type: 'short', url}
    //     Open the panel immediately, then resolve the short URL in
    //     the BACKGROUND. The panel doesn't have to wait on the
    //     network round-trip. If the user confirms before resolution
    //     completes, onShareLocationConfirmed does a final synchronous
    //     resolve as a fallback (also reads
    //     pendingShareDestinationUrl).
    async meetMeAt(uri, link) {
        if (!uri || !link) {
            console.log('[location] meetMeAt: missing uri or link', uri, link);
            return;
        }
        // Backwards compat: an older ContactsListBox build called
        // meetMeAt(uri, coords) directly. Detect the bare-coords
        // shape and wrap it as a direct link descriptor.
        if (link && typeof link.latitude === 'number'
                && typeof link.longitude === 'number') {
            link = {type: 'direct', coords: link};
        }
        if (link.type === 'direct') {
            utils.timestampedLog('[location] meetMeAt: direct destination', link.coords.latitude.toFixed(5), ',', link.coords.longitude.toFixed(5), 'for', uri);
            // Open panel synchronously via state — see the short-URL
            // branch below for why we don't go through
            // showShareLocationModal here either. The permission /
            // disclosure gates run as a background task and only kick
            // in when the user actually confirms the share.
            this._uiSetState({
                pendingShareDestination: {
                    latitude: link.coords.latitude,
                    longitude: link.coords.longitude,
                },
                pendingShareDestinationUrl: null,
                pendingShareDestinationStatus: 'resolved',
                showShareLocationModal: true,
            });
            // Same fire-and-forget GPS fetch the button-tap entry
            // path runs (see showShareLocationModal). Without this
            // the "Meet me there..." flow opens the modal but the
            // user pin never appears — meetMeAt bypasses
            // showShareLocationModal() entirely (we open the panel
            // optimistically rather than awaiting permission /
            // disclosure gates).
            this._fetchPreviewLocation();
            // Refresh the disclaimer-suppression mirror from
            // app_state. Fire-and-forget — the modal already
            // rendered above; when this resolves it'll setState and
            // the modal re-renders without the disclaimer block.
            this._hydrateDisclaimerSuppression();
            this._meetMeAtRunGates(uri);
            return;
        }
        if (link.type === 'short') {
            utils.timestampedLog('[location] meetMeAt: short URL — opening panel + resolving in parallel', link.url, 'for', uri);
            // Open the panel SYNCHRONOUSLY by flipping
            // showShareLocationModal in the same setState. Going
            // through this.showShareLocationModal() awaits async
            // disclosure + permission gates BEFORE rendering the
            // panel, which the user reported as a noticeable delay
            // — the meet-me-there flow already has a clear user
            // intent (they tapped a button on a maps link) so we
            // can show the panel optimistically and let the gates
            // run in the background. If a gate fails it closes the
            // panel and surfaces an alert (see _meetMeAtRunGates).
            this._uiSetState({
                pendingShareDestination: null,
                pendingShareDestinationUrl: link.url,
                pendingShareDestinationStatus: 'resolving',
                showShareLocationModal: true,
            });
            // Fire the GPS fetch in parallel with the URL resolve so
            // the user pin / privacy-radius circle appear as soon as
            // both have landed. Same wiring as the direct-coords
            // branch above — see the comment there.
            this._fetchPreviewLocation();
            // Same fire-and-forget rehydrate as the direct-coords
            // path. The modal opens optimistically with stale state;
            // this re-syncs from SQL and a re-render will hide the
            // disclaimer block within a frame or two.
            this._hydrateDisclaimerSuppression();
            // Three things now happen in parallel: the panel
            // renders (already triggered by setState), the URL
            // resolves over the network, and the permission gates
            // run. Each writes back via setState as it completes.
            this._meetMeAtRunGates(uri);
            const _kickedOffFor = link.url;
            const _isStale = () => this._uiState().pendingShareDestinationUrl !== _kickedOffFor;
            // Resolve via HTTP only. utils.resolveShortLocationUrl already
            // (a) follows HTTP redirects (response.url) for
            // `maps.app.goo.gl/<id>` and `maps.google.com/?q=lat,lng` style
            // URLs, and (b) scans the returned HTML body for embedded coords.
            // The previous headless-WebView fallback (for the residual
            // pure-JS-redirect case) was removed: instantiating
            // react-native-webview spins up Chromium's process-global
            // NetworkChangeNotifier, which issues a synchronous
            // ConnectivityManager.getNetworkInfo() on the UI thread on every
            // network-capabilities change — a main-thread freeze tripwire when
            // the platform connectivity service stalls (ANR 2026-06-09). When
            // HTTP resolve yields no coords we now go straight to the
            // address-geocode fallback on the original URL.
            utils.resolveShortLocationUrl(link.url)
                .then((coords) => {
                    if (_isStale()) return;
                    if (coords) {
                        utils.timestampedLog('[location] meetMeAt: short URL resolved (HTTP) →', coords.latitude.toFixed(5), ',', coords.longitude.toFixed(5));
                        this._uiSetState({
                            pendingShareDestination: coords,
                            pendingShareDestinationStatus: 'resolved',
                        });
                        return;
                    }
                    // No inline coords from the HTTP resolve. Last-resort
                    // fallback: many "share place by name" URLs carry an
                    // address in `?q=` (e.g.
                    // `maps.google.com/?q=Atic+Millennium,...`) — geocode that
                    // via Nominatim. Run it against the original link URL.
                    const _addr = utils.extractQueryAddress(link.url);
                    if (_addr) {
                        utils.timestampedLog('[location] meetMeAt: HTTP resolve had no coords — geocoding ?q= address', JSON.stringify(_addr));
                        return utils.geocodeAddress(_addr).then((coords2) => {
                            if (_isStale()) return;
                            if (coords2) {
                                utils.timestampedLog('[location] meetMeAt: geocode resolved →', coords2.latitude.toFixed(5), ',', coords2.longitude.toFixed(5));
                                this._uiSetState({
                                    pendingShareDestination: coords2,
                                    pendingShareDestinationStatus: 'resolved',
                                });
                            } else {
                                utils.timestampedLog('[location] meetMeAt: geocode had no match for', JSON.stringify(_addr));
                                this._uiSetState({pendingShareDestinationStatus: 'failed'});
                            }
                        });
                    }
                    utils.timestampedLog('[location] meetMeAt: HTTP resolve had no coords + no q= address —', link.url);
                    this._uiSetState({pendingShareDestinationStatus: 'failed'});
                })
                .catch((err) => {
                    if (_isStale()) return;
                    utils.timestampedLog('[location] meetMeAt: resolve chain failed', err && err.message ? err.message : err);
                    this._uiSetState({pendingShareDestinationStatus: 'failed'});
                });
            return;
        }
        console.log('[location] meetMeAt: unknown link type', link);
    }

    // Run the permission / disclosure gates as a fire-and-forget
    // background task. If a gate fails, close the meet-me-there
    // panel and surface the same alert showShareLocationModal would
    // show. If they pass, no-op — the panel is already open and the
    // user proceeds normally.
    async _meetMeAtRunGates(uri) {
        try {
            const acknowledged = await this._ensureLocationDisclosureAcknowledged();
            if (!acknowledged) {
                utils.timestampedLog('[location] meetMeAt: disclosure declined — closing panel');
                this.hideShareLocationModal();
                return;
            }
            let hasPermission = false;
            try {
                hasPermission = await this.ensureLocationPermission();
            } catch (e) {
                hasPermission = false;
            }
            if (!hasPermission) {
                utils.timestampedLog('[location] meetMeAt: OS permission missing — closing panel');
                this.hideShareLocationModal();
                const openSettingsFn = () => {
                    try {
                        if (Platform.OS === 'ios') {
                            Linking.openURL('app-settings:');
                        } else {
                            try { openSettings(); }
                            catch (e) { Linking.openSettings && Linking.openSettings(); }
                        }
                    } catch (e) { /* noop */ }
                };
                Alert.alert(
                    'Location permission required',
                    Platform.OS === 'ios'
                        ? "Open Settings → Blink → Location to allow location access."
                        : "Open Settings to allow Blink to access your location.",
                    [
                        {text: 'Cancel', style: 'cancel'},
                        {text: 'Open Settings', onPress: openSettingsFn},
                    ],
                    {cancelable: true}
                );
            }
        } catch (e) {
            utils.timestampedLog('[location] meetMeAt: gate evaluation failed', e && e.message ? e.message : e);
        }
    }

    // Check the **precise** current location-permission state without
    // triggering any native prompt. Used by the "Share location" flow to
    // decide upfront whether the share will survive a swipe to background.
    // Returns one of:
    //   'always'       — granted for background use (our happy path)
    //   'whenInUse'    — granted for foreground only; share will die on background
    //   'blocked'      — user tapped "Don't Allow" previously; Settings is the
    //                    only recovery path (native prompt won't re-appear)
    //   'undetermined' — never asked; a subsequent request() will prompt
    //   'unavailable'  — device has no location services
    async getLocationPermissionStatus() {
        // Thin caching wrapper over the native probe below. Synchronous
        // senders (sendLocationPayload runs inside a GPS callback and can't
        // await) need the state to stamp on an origin tick, so every probe
        // leaves its result in `_lastPermState` for them to read.
        const _state = await this._probeLocationPermissionStatus();
        this._lastPermState = _state;
        return _state;
    }

    async _probeLocationPermissionStatus() {
        if (Platform.OS === 'ios') {
            try {
                // Probe Always first — that's the capability that matters
                // for background sharing. If it's granted we're done.
                const alwaysStatus = await check(PERMISSIONS.IOS.LOCATION_ALWAYS);
                if (alwaysStatus === RESULTS.GRANTED || alwaysStatus === RESULTS.LIMITED) {
                    return 'always';
                }
                if (alwaysStatus === RESULTS.BLOCKED) {
                    return 'blocked';
                }
                // alwaysStatus === DENIED means "not yet prompted for
                // Always" OR "WhenInUse granted but no Always upgrade yet"
                // — the WhenInUse check disambiguates.
                const whenStatus = await check(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);
                if (whenStatus === RESULTS.GRANTED || whenStatus === RESULTS.LIMITED) {
                    return 'whenInUse';
                }
                if (whenStatus === RESULTS.BLOCKED) {
                    return 'blocked';
                }
                // Both probes came back UNAVAILABLE: the permission handler
                // pods (RNPermissions/LocationAlways, /LocationWhenInUse) are
                // almost certainly not installed in the current Podfile. The
                // device itself still has working location services, so we
                // must NOT surface "Location unavailable" to the user. Treat
                // it as 'undetermined' so startLocationSharing falls through
                // to the RNCGeolocation path, which asks iOS directly via
                // requestAuthorization. Real device-has-no-location is so
                // rare on iPhones that we'd rather risk a no-op prompt than
                // block a working feature on a Podfile oversight.
                if (alwaysStatus === RESULTS.UNAVAILABLE
                    && whenStatus === RESULTS.UNAVAILABLE) {
                    console.log('[location] react-native-permissions Location ' + 'subspecs not installed — skipping upfront probe');
                    return 'undetermined';
                }
                if (whenStatus === RESULTS.UNAVAILABLE) {
                    return 'unavailable';
                }
                return 'undetermined';
            } catch (e) {
                console.log('[location] getLocationPermissionStatus iOS failed', e && e.message ? e.message : e);
                return 'undetermined';
            }
        }
        if (Platform.OS === 'android') {
            try {
                const fine = await check(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
                if (fine === RESULTS.BLOCKED) return 'blocked';
                if (fine === RESULTS.UNAVAILABLE) return 'unavailable';
                if (fine !== RESULTS.GRANTED && fine !== RESULTS.LIMITED) {
                    return 'undetermined';
                }

                // Fine location is granted; now disambiguate foreground-only
                // vs "all the time". On API 29+ ACCESS_BACKGROUND_LOCATION
                // is a separate permission that the user can only enable
                // via Settings on API 30+. Without it CLLocationManager's
                // counterpart on Android (FusedLocationProviderClient /
                // LocationManager) stops delivering updates the moment the
                // process is throttled into the background — even if our
                // foreground service is running. On older devices (API <29)
                // there's no background permission concept; granting fine
                // location is implicitly "always".
                if (Platform.Version == null || Platform.Version < 29) {
                    return 'always';
                }
                const bg = await check(PERMISSIONS.ANDROID.ACCESS_BACKGROUND_LOCATION);
                if (bg === RESULTS.GRANTED) return 'always';
                if (bg === RESULTS.BLOCKED) return 'foregroundOnly';
                // Not yet asked, or the subspec isn't installed — treat as
                // foreground-only so the caller can nudge the user toward
                // the background upgrade before starting a share.
                return 'foregroundOnly';
            } catch (e) {
                return 'undetermined';
            }
        }
        return 'unavailable';
    }

    async _ensureLocationDisclosureAcknowledged() {
        // The Prominent Disclosure modal is required by Google Play's
        // Permissions and APIs that Access Sensitive Information
        // policy — it's an Android-store thing, not iOS. On iOS the
        // App Store has its own usage-string + system-level
        // disclosure model (NSLocationAlways/WhenInUseUsageDescription
        // is shown by CoreLocation directly), and an additional in-
        // app modal would be redundant and out of place. Short-circuit
        // here so the share-flow on iOS proceeds straight to the OS
        // permission probe.
        if (Platform.OS !== 'android') {
            return true;
        }

        // v1 → v2: disclosure body materially corrected to state that
        // Sylk's server DOES retain the encrypted journal entry until
        // the share's expiry (the v1 wording incorrectly implied the
        // server never sees the data at all). Bumping the key made
        // any user who acknowledged v1 re-see the corrected wording.
        // The v2 key is now further scoped per SIP account in
        // locationDisclosure.js so a second identity on the same
        // device starts fresh.
        const _accountId = this.app.state.accountId;
        const acknowledged = await readLocationDisclosure(_accountId);
        if (acknowledged === true) {
            return true;
        }
        // Diagnostic: log the OS-level location permission state right
        // before showing the disclosure panel, so we can correlate
        // user reports ("the OS dialog didn't fire after I agree")
        // with the permission state at the time. Best-effort — we
        // don't block the modal on the probe.
        try {
            const permState = await this.getLocationPermissionStatus();
            console.log('[location] disclosure shown — OS permission state =', permState);
        } catch (e) {
            console.log('[location] disclosure shown — getLocationPermissionStatus failed', e && e.message ? e.message : e);
        }
        return new Promise((resolve) => {
            this._uiSetState({
                locationDisclosurePending: {
                    onContinue: async () => {
                        await setLocationDisclosure(_accountId);
                        utils.timestampedLog('[location] user accepted privacy policy via share-flow gate — disclosure flag set for', _accountId);
                        this._uiSetState({
                            locationDisclosurePending: null,
                            locationDisclosureAcknowledged: true,
                        });
                        resolve(true);
                    },
                    onCancel: () => {
                        utils.timestampedLog('[location] user cancelled privacy policy at share-flow gate — share aborted for', _accountId);
                        this._uiSetState({locationDisclosurePending: null});
                        resolve(false);
                    },
                },
            });
        });
    }

    async ensureLocationPermission() {
        // Android: runtime permission prompt for ACCESS_FINE_LOCATION.
        // Note: ACCESS_BACKGROUND_LOCATION is NOT requested here. On API
        // 30+ the OS refuses to show a runtime dialog for it; the user
        // must flip "Allow all the time" inside Settings. We handle that
        // path separately in startLocationSharing's 'foregroundOnly'
        // branch (explainer Alert → openSettings).
        if (Platform.OS === 'android') {
            try {
                const granted = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                    {
                        title: 'Share location',
                        message: 'Blink needs access to your location so it can be shared with your contact.',
                        buttonPositive: 'OK',
                    }
                );
                return granted === PermissionsAndroid.RESULTS.GRANTED;
            } catch (err) {
                console.log('Location permission request failed', err);
                return false;
            }
        }

        // iOS: configure the geolocation module to ask for *Always*
        // authorization and turn on background location updates before
        // the session starts. Without "Always" + UIBackgroundModes=location
        // iOS kills location updates the moment the app is suspended,
        // and our sharing would silently stop.
        if (Platform.OS === 'ios' && Geolocation) {
            try {
                if (typeof Geolocation.setConfiguration === 'function') {
                    Geolocation.setConfiguration({
                        authorizationLevel: 'always',
                        enableBackgroundLocationUpdates: true,
                    });
                }
                if (typeof Geolocation.requestAuthorization === 'function') {
                    // The library's iOS requestAuthorization fires the
                    // SUCCESS callback when the user grants Always or
                    // WhenInUse, and the ERROR callback when the user
                    // denies or has previously denied in Settings. We
                    // faithfully translate those into the Promise result
                    // so startLocationSharing can prompt the user to open
                    // Settings instead of silently starting a share that
                    // can't post.
                    const granted = await new Promise((resolve) => {
                        let settled = false;
                        const settle = (value) => {
                            if (settled) return;
                            settled = true;
                            resolve(value);
                        };
                        try {
                            const maybePromise = Geolocation.requestAuthorization(
                                () => settle(true),
                                () => settle(false)
                            );
                            if (maybePromise && typeof maybePromise.then === 'function') {
                                maybePromise
                                    .then(() => settle(true))
                                    .catch(() => settle(false));
                            }
                        } catch (e) {
                            // Older library builds reject callback form —
                            // optimistically proceed; watchPosition's own
                            // error handler is our safety net.
                            settle(true);
                        }
                        // Safety timeout. Used to optimistically settle
                        // to TRUE if iOS never delivered a change — the
                        // theory was "don't hang the sharing flow if
                        // the dialog never produced an event". In
                        // practice that path landed users in a silent
                        // bug: on a fresh install, if the system
                        // permission dialog was suppressed for any
                        // reason (dismissed during our RN-Modal close
                        // animation, queued behind another alert,
                        // user backgrounded the app before answering),
                        // requestAuthorization's callback never fires,
                        // we returned TRUE, the share started with no
                        // permission, and getCurrentCoordinates
                        // silently failed — so the user saw a
                        // "started sharing" UI with no actual location
                        // ever shipping.
                        //
                        // Now: on timeout we RE-PROBE the OS-level
                        // permission and decide based on what's
                        // actually granted. If the dialog landed but
                        // the callback got lost, the probe sees
                        // 'always' / 'whenInUse' and we still return
                        // true. If nothing was granted, we return
                        // false so startLocationSharing can surface
                        // the "Location permission required" Alert
                        // instead of a no-coord share.
                        setTimeout(async () => {
                            if (settled) return;
                            try {
                                const probe = await this.getLocationPermissionStatus();
                                settle(probe === 'always' || probe === 'whenInUse');
                            } catch (e) {
                                settle(false);
                            }
                        }, 10000);
                    });
                    return granted;
                }
            } catch (e) {
                console.log('iOS location configuration failed', e && e.message ? e.message : e);
            }
            return true;
        }

        return true;
    }

    // ===== Share-location disclaimer suppression =====
    //
    // Reads / writes the per-account
    // `app_state.location.disclaimerSuppressed` flag and mirrors it
    // into React state so the share-location modal can render with
    // the disclaimer hidden when appropriate.

    // Hydrate the in-memory mirror from the persisted app_state row.
    // Idempotent — safe to call on every registrationState transition
    // and on every modal open. No-op when accountId or the read
    // accessor isn't available yet.
    _hydrateDisclaimerSuppression = async () => {
        try {
            const accountId = this.app.state.accountId;
            const read = this.app._readAppStateNamespace;
            if (!accountId || typeof read !== 'function') {
                //utils.timestampedLog(
                //    '[location] hydrate-disclaimer: skipped — accountId=', accountId,
                //    'read=', typeof read
                //);
                return;
            }
            const location = await read(accountId, 'location');
            const suppressed = !!(location && location.disclaimerSuppressed);
            //utils.timestampedLog(
            //    '[location] hydrate-disclaimer: accountId=', accountId,
            //    'location=', JSON.stringify(location),
            //    '→ suppressed=', suppressed
            //);
            if (this._uiState().shareDisclaimerSuppressed !== suppressed) {
                this._uiSetState({shareDisclaimerSuppressed: suppressed});
            }
        } catch (e) {
            utils.timestampedLog('[location] _hydrateDisclaimerSuppression failed', e && e.message ? e.message : e);
        }
    }

    // Persist `disclaimerSuppressed: true` for the currently signed-in
    // account. Called from the share-location modal's onConfirm path
    // when the user pressed Confirm with "Do not show this again"
    // ticked. We update the in-memory mirror synchronously so the
    // next modal open already sees the suppressed state, even if the
    // SQL UPDATE is still in the debounce window.
    _suppressShareLocationDisclaimer = async () => {
        //utils.timestampedLog('[location] suppress-disclaimer: invoked');
        try {
            const accountId = this.app.state.accountId;
            const read = this.app._readAppStateNamespace;
            const write = this.app._writeAppStateNamespace;
            if (!accountId
                    || typeof read !== 'function'
                    || typeof write !== 'function') {
                //utils.timestampedLog('[location] suppress-disclaimer: skipped — accountId=', accountId, 'read=', typeof read, 'write=', typeof write);
                return;
            }
            const location = await read(accountId, 'location');
            //utils.timestampedLog('[location] suppress-disclaimer: read existing location=', JSON.stringify(location));
            location.disclaimerSuppressed = true;
            await write(accountId, 'location', location);
            //utils.timestampedLog('[location] suppress-disclaimer: write completed for', accountId, 'new location=', JSON.stringify(location));
            this._uiSetState({shareDisclaimerSuppressed: true});
        } catch (e) {
            utils.timestampedLog('[location] _suppressShareLocationDisclaimer failed', e && e.message ? e.message : e);
        }
    }

    // Clear the persisted suppression flag. Called from the privacy-
    // policy opt-out path so the legal text re-appears the moment the
    // user revokes their disclosure consent — the suppression is a
    // convenience flag that depends on the user having agreed to the
    // policy in the first place.
    _clearShareLocationDisclaimerSuppression = async () => {
        try {
            const accountId = this.app.state.accountId;
            const read = this.app._readAppStateNamespace;
            const write = this.app._writeAppStateNamespace;
            if (!accountId
                    || typeof read !== 'function'
                    || typeof write !== 'function') return;
            const location = await read(accountId, 'location');
            if (location.disclaimerSuppressed) {
                delete location.disclaimerSuppressed;
                await write(accountId, 'location', location);
            }
            this._uiSetState({shareDisclaimerSuppressed: false});
        } catch (e) {
            console.log('[location] _clearShareLocationDisclaimerSuppression failed', e && e.message ? e.message : e);
        }
    }

    // Park a share-start intent that was blocked on missing OS-level
    // location permission. The user has already tapped Accept / Meet
    // up / Confirm once — re-prompting them after they grant the
    // permission in Settings is a UX failure ("I just said yes, why
    // are you asking again?"). Storing the intent here lets
    // _drainPendingPermissionShares (called from _onAppStateChange)
    // re-run the share automatically the next time the app
    // foregrounds with sufficient permission.
    //
    // Idempotent: a second arming for the same uri replaces the
    // first. The optimistic activeLocationShares pulse and the
    // announcement message are NOT rolled back when arming, so
    // visible UI keeps its "share is starting" feel while the user
    // is in Settings — the auto-resume flips it to a real share once
    // permission lands.
    _armPermissionRetry(uri, durationMs, periodLabel, opts) {
        if (!this._pendingPermissionShares) {
            this._pendingPermissionShares = {};
        }
        // Deep-clone opts so a later mutation by the caller (e.g.
        // tickExtras buildup) can't change the parked intent.
        const safeOpts = {};
        for (const k of Object.keys(opts || {})) {
            safeOpts[k] = opts[k];
        }
        // Strip the resume marker so a future drain doesn't see this
        // entry as an already-resumed one and skip arming on its
        // own permission fail.
        delete safeOpts._resumedAfterPermission;
        this._pendingPermissionShares[uri] = {
            uri,
            durationMs,
            periodLabel,
            opts: safeOpts,
            registeredAt: Date.now(),
            // Honour the original meet-request expiry so we don't
            // fire a retry for a request that has aged out while
            // the user was in Settings. opts.expiresAt is set on
            // meetingAccept (mirrors the requester's expiresAt) and
            // unset for plain timed shares.
            expiresAt: typeof (opts && opts.expiresAt) === 'number'
                ? opts.expiresAt : null,
        };
        utils.timestampedLog('[location] permission-retry armed for', uri, '— share will resume automatically when permission is granted');
    }

    // Explicit user-cancellation of a parked share intent. Called
    // from the Cancel button on the permission alerts when the user
    // chose to NOT proceed at all. Cleans up the parked entry AND
    // calls the supplied rollback to wind back the optimistic UI
    // (pulsing icon, announcement bubble) so the chat doesn't sit
    // there pretending a share is starting that the user already
    // told us to forget.
    _cancelPendingPermissionShare(uri, rollbackFn) {
        if (this._pendingPermissionShares[uri]) {
            delete this._pendingPermissionShares[uri];
            utils.timestampedLog('[location] permission-retry cancelled by user for', uri);
        }
        if (typeof rollbackFn === 'function') {
            try { rollbackFn(); }
            catch (e) { /* rollback is best-effort */ }
        }
    }

    // AppState foreground hook drains this. Re-probe the OS-level
    // permission; for each parked entry, retry startLocationSharing
    // if permission is now sufficient. The retry sets
    // _resumedAfterPermission:true so the inner permission-deferral
    // paths know not to re-arm a fresh entry on the (rare) case the
    // probe was a false positive.
    async _drainPendingPermissionShares() {
        if (!this._pendingPermissionShares) return;
        const uris = Object.keys(this._pendingPermissionShares);
        if (uris.length === 0) return;
        let probe = 'denied';
        try {
            probe = await this.getLocationPermissionStatus();
        } catch (e) { /* probe failures fall through as 'denied' */ }
        const sufficient =
            probe === 'always'
            || probe === 'whenInUse'
            || probe === 'foregroundOnly';
        utils.timestampedLog('[location] permission-retry drain — probe=', probe, 'sufficient=', sufficient, 'pending=', uris.length);
        if (!sufficient) {
            // Leave entries in place — the user may still be on the
            // way to Settings. Next foreground will probe again.
            return;
        }
        for (const uri of uris) {
            const pending = this._pendingPermissionShares[uri];
            if (!pending) continue;
            // Drop expired meet-accept retries — pointless to start
            // a share whose request has aged out.
            if (typeof pending.expiresAt === 'number'
                    && pending.expiresAt <= Date.now()) {
                utils.timestampedLog('[location] permission-retry: dropping expired pending for', uri);
                delete this._pendingPermissionShares[uri];
                continue;
            }
            // Defensive: someone may have started a share for this
            // uri via a different path while we were waiting. Don't
            // double-start.
            if (this._hasAnyEntryForUri(uri)) {
                delete this._pendingPermissionShares[uri];
                continue;
            }
            // Remove BEFORE starting — startLocationSharing's own
            // permission-deferral path could re-arm if something
            // unexpected (a fresh "blocked" state) happens; clearing
            // first means a single drain pass attempts at most one
            // start per uri. _resumedAfterPermission tells the
            // function to NOT call _armPermissionRetry again, which
            // would otherwise loop.
            const params = pending;
            delete this._pendingPermissionShares[uri];
            utils.timestampedLog('[location] permission-retry: permission now', probe, '— resuming share for', uri);
            try {
                await this.startLocationSharing(
                    uri,
                    params.durationMs,
                    params.periodLabel,
                    {
                        ...params.opts,
                        _resumedAfterPermission: true,
                        // The original call already shipped the
                        // "I want to meet up" / "I want to meet with
                        // you, too!" / "I am sharing the location for
                        // X hours" announcement before bouncing on
                        // permission. Suppress it on the resume so we
                        // don't post the same line twice.
                        suppressAnnouncement: true,
                    }
                );
            } catch (e) {
                utils.timestampedLog('[location] permission-retry: resume threw', e && e.message ? e.message : e);
            }
        }
    }

    // Timeout budget for a single fix, in ms. The high-accuracy attempt and
    // the coarse fallback are sequential, so the worst case is their SUM
    // (18 s). That has to stay under _awaitInitialShare's 20 s ceiling, or
    // the share modal's spinner would give up before the fix it is waiting
    // for arrives. Change one of these three numbers and check the other
    // two still add up.
    static get HIGH_ACCURACY_TIMEOUT_MS() { return 12000; }
    static get COARSE_FALLBACK_TIMEOUT_MS() { return 6000; }

    // Returns a Promise that resolves to {latitude, longitude, accuracy}
    // or rejects if the geolocation library is missing / the OS denies
    // access / the fix times out.
    //
    // Accuracy policy — this used to pass {enableHighAccuracy: false,
    // maximumAge: 10000}, which asked the OS for a wifi/cell-tower fused
    // fix and additionally accepted a cached one up to 10 s old. Those
    // fixes are routinely 100–500 m out and can land the user on the wrong
    // side of a river, a motorway, or a border — and because the share
    // picker's preview fix is reused as the origin tick, the wrong
    // position was what actually went out to the contact.
    //
    // Now: satellite-backed fix, no cache. If that fails (indoors, urban
    // canyon, GNSS cold start) we fall back ONCE to the old coarse
    // settings rather than returning nothing — a rough location the user
    // can see and correct on the picker's map beats a failed share. The
    // fallback's coords carry their own (large) `accuracy`, so the
    // provenance log and the UI can both tell the two apart.
    //
    // opts.highAccuracy — false to skip straight to a coarse fix.
    // opts.maximumAge   — accept a cached fix up to this old (default 0).
    // opts.timeout      — override the high-accuracy attempt's budget.
    getCurrentCoordinates(opts = {}) {
        const _wantHigh = opts.highAccuracy !== false;
        const _maximumAge = (typeof opts.maximumAge === 'number') ? opts.maximumAge : 0;
        const _acquire = (highAccuracy, timeout) => new Promise((resolve, reject) => {
            if (!Geolocation || typeof Geolocation.getCurrentPosition !== 'function') {
                reject(new Error('Geolocation module not available'));
                return;
            }
            Geolocation.getCurrentPosition(
                (position) => {
                    this._logFixProvenance(
                        highAccuracy ? 'getCurrentPosition/high' : 'getCurrentPosition/coarse',
                        null,
                        position
                    );
                    const c = position && position.coords ? position.coords : {};
                    resolve({
                        latitude: c.latitude,
                        longitude: c.longitude,
                        accuracy: c.accuracy,
                        timestamp: position.timestamp,
                    });
                },
                (error) => reject(error),
                {
                    enableHighAccuracy: highAccuracy,
                    timeout,
                    // A cached fix is the thing we are trying to get away
                    // from on the high-accuracy attempt: the OS would
                    // happily hand back the same coarse reading we just
                    // rejected. Callers on a repeating cadence can opt back
                    // in via opts.maximumAge.
                    maximumAge: highAccuracy ? _maximumAge : Math.max(_maximumAge, 10000),
                }
            );
        });
        if (!_wantHigh) {
            return _acquire(false, opts.timeout || LocationSharingManager.COARSE_FALLBACK_TIMEOUT_MS);
        }
        return _acquire(true, opts.timeout || LocationSharingManager.HIGH_ACCURACY_TIMEOUT_MS)
            .catch((err) => {
                utils.timestampedLog('[location] high-accuracy fix failed —',
                    err && err.message ? err.message : err,
                    'code=', err && err.code, '— falling back to coarse');
                return _acquire(false, LocationSharingManager.COARSE_FALLBACK_TIMEOUT_MS);
            });
    }

    // Log the PROVENANCE of a raw geolocation fix so we can tell whether
    // a stalled track is a real GPS fix that isn't moving, a coarse
    // wifi/cell fix that can't see movement, or a mock/fake location.
    //
    // @react-native-community/geolocation does NOT expose the Android
    // provider string ("gps"/"network"/"fused") — that would need a
    // native module change. But the raw position object carries several
    // fields we normally discard that, together, fingerprint the source:
    //   • mocked / isFromMockProvider — a fake-GPS app or dev-options
    //     "set location" is feeding a fixed coordinate (Android only).
    //   • accuracy — GPS/fused-with-GNSS is typically <= ~20 m; a pure
    //     wifi/cell fix is coarser (~50-2000 m).
    //   • altitude / altitudeAccuracy — real GNSS reports an altitude;
    //     network/wifi fixes usually report null / 0.
    //   • speed / heading — populated by GNSS while moving; null or -1
    //     on network fixes and on a stationary device.
    // The inferred label is a heuristic, not ground truth — the raw
    // fields next to it are what to actually read.
    _logFixProvenance(tag, uri, position) {
        try {
            const c = (position && position.coords) ? position.coords : {};
            const mocked = (position && position.mocked)
                || c.mocked || c.isFromMockProvider || false;
            const acc = (typeof c.accuracy === 'number') ? c.accuracy : null;
            const alt = (typeof c.altitude === 'number') ? c.altitude : null;
            const altAcc = (typeof c.altitudeAccuracy === 'number') ? c.altitudeAccuracy : null;
            const speed = (typeof c.speed === 'number') ? c.speed : null;
            const heading = (typeof c.heading === 'number') ? c.heading : null;
            // Heuristic source label.
            let source;
            if (mocked) {
                source = 'MOCK';
            } else if (alt != null && (acc == null || acc <= 25)) {
                // Has altitude + tight accuracy -> satellite-backed.
                source = 'gps/fused-gnss';
            } else if (acc != null && acc > 50) {
                source = 'network/wifi-coarse';
            } else if (alt == null) {
                // No altitude but okay accuracy -> likely fused/network.
                source = 'network/fused-no-altitude';
            } else {
                source = 'unknown';
            }
            const age = (position && typeof position.timestamp === 'number')
                ? (Date.now() - position.timestamp) : null;
            //utils.timestampedLog(`[location] [fix-source] ${tag} <- ${uri || '?'}`, 'source=' + source, 'mocked=' + (mocked ? 'YES' : 'no'), 'accuracy=' + (acc != null ? acc.toFixed(1) + 'm' : '?'), 'altitude=' + (alt != null ? alt.toFixed(1) + 'm' : 'null'), 'altAccuracy=' + (altAcc != null ? altAcc.toFixed(1) + 'm' : 'null'), 'speed=' + (speed != null ? speed.toFixed(2) + 'm/s' : 'null'), 'heading=' + (heading != null ? heading.toFixed(0) : 'null'), 'fixAgeMs=' + (age != null ? age : '?'), 'lat=' + (typeof c.latitude === 'number' ? c.latitude.toFixed(6) : '?'), 'lng=' + (typeof c.longitude === 'number' ? c.longitude.toFixed(6) : '?'));
        } catch (e) { /* logging must never throw */ }
    }

    // Build and send a single location-data message for the given
    // contact URI with the supplied coordinate + expiration timestamp.
    // `originLocationId` is null for the very first tick of a session
    // (that first tick becomes the "origin" message the receiver renders).
    // Every subsequent tick is flagged `isUpdate` and groups under the
    // origin's id (messageId) so the receiver updates the bubble in place.
    // Resolve which store entry a send/tick refers to. Follow-up ticks carry a
    // non-null originLocationId → unambiguous across both stores. The very first
    // (origin-promotion) tick has originLocationId null; `isMeet` (threaded from
    // the session's own kind by every tick path) disambiguates, and as a final
    // fallback we prefer the entry that hasn't been stamped with an origin yet.
    _resolveSendEntry(uri, originLocationId, isMeet) {
        if (!uri) return null;
        if (isMeet === true) return this._meetStore()[uri] || null;
        if (isMeet === false) return this._plainStore()[uri] || null;
        if (originLocationId != null) return this._entryByOrigin(uri, originLocationId);
        const plain = this._plainStore()[uri];
        const meet = this._meetStore()[uri];
        if (plain && !plain.originLocationId) return plain;
        if (meet && !meet.originLocationId) return meet;
        return plain || meet || null;
    }

    sendLocationPayload(uri, coords, expiresAt, originLocationId = null, extras = {}, isMeet = null) {
        if (!this.app.sendMessage) {
            console.log('sendLocationPayload: sendMessage prop is not wired');
            return null;
        }

        // Hard guard: never emit a tick without usable coordinates.
        // The receiver — and our own SQL row — would otherwise hold a
        // placeholder "Locating…" record that overwrites any earlier
        // good fix on UPDATE-in-place sessions, and on chat reload
        // there'd be nothing to render. With this guard the only
        // location ticks that ever reach the wire have a real lat/lng,
        // so the SQL row always retains the LAST KNOWN good position
        // even after a brief GPS dropout.
        if (!coords
                || typeof coords.latitude !== 'number'
                || typeof coords.longitude !== 'number') {
            console.log('[location] sendLocationPayload: dropping tick — coords missing for', uri);
            return null;
        }

        // Pause gate: when the entry is flagged paused, swallow the
        // tick. We keep the watchPosition / setInterval armed (so
        // Resume can fire an immediate tick without a re-arm dance),
        // but no location data leaves the device until the user resumes.
        const _pausedEntry = this._resolveSendEntry(uri, originLocationId, isMeet);
        if (_pausedEntry && _pausedEntry.paused) {
            return null;
        }

        // Atomic origin promotion. Two paths can race to be "the first
        // tick" of a session: the initial getCurrentCoordinates().then()
        // callback in startLocationSharing AND the first
        // watchPosition / setInterval fire (which may complete before
        // the awaited GPS read). Both pass originLocationId=null
        // because the entry's origin id isn't set yet. Without
        // coordination they'd each send an origin tick and the receiver
        // would render two bubbles. Resolve here:
        //   • If the entry already has an originLocationId, this tick
        //     is implicitly a follow-up — point it at that origin.
        //   • Otherwise the tick we're about to send IS the origin;
        //     stamp the entry below (after we've generated mId).
        const entryAtSend = this._resolveSendEntry(uri, originLocationId, isMeet);
        let promoteToOrigin = false;
        if (originLocationId == null) {
            if (entryAtSend && entryAtSend.originLocationId) {
                originLocationId = entryAtSend.originLocationId;
            } else {
                promoteToOrigin = true;
            }
        }

        // Meet-invite gate: a requester's meet share sends ONE invite ORIGIN
        // tick, then HOLDS — recurring update ticks are suppressed until the
        // invitee accepts (meeting_accept -> resumeMeetShareOnAccept clears the
        // session). The origin always passes (promoteToOrigin) — it IS the
        // invite; only follow-up updates wait.
        if (!promoteToOrigin && entryAtSend && entryAtSend.meetingSessionId
                && this._awaitingAcceptSessions
                && this._awaitingAcceptSessions.has(entryAtSend.meetingSessionId)) {
            return null;
        }

        // Row id (this message's own msg_id / primary key). Normally a fresh,
        // unique uuid — deliberately DECOUPLED from the session grouping id
        // (sessionId) below, so both legs of a meet can share one sessionId
        // without their origin rows colliding on msg_id.
        //
        // EXCEPTION — the REQUESTER's meet ORIGIN: its msg_id MUST equal the
        // session (request) id, so there is exactly ONE origin row keyed by the
        // request id and every subsequent tick is an update pointing back at it.
        // With a fresh uuid the origin row's msg_id diverged from the session id,
        // and the "two ticks race to become origin" (start callback + first
        // watch/interval fire) produced a SECOND, disconnected origin — leaving
        // the sender with two half-origins that the reload synthesis couldn't
        // rebuild, so the sender's map vanished after leaving + reopening the
        // chat. Pinning the origin msg_id to the session id also makes the race
        // self-healing: a second promote-to-origin tick reuses the same msg_id
        // and dedups on the UNIQUE (account, msg_id) key instead of forking.
        //
        // Scoped to the requester leg ONLY (entry.kind === 'meetingRequest').
        // The accepter's origin keeps a fresh uuid: both legs share the SAME
        // session id, so forcing the accepter's origin msg_id to it too would
        // collide with the requester's origin row on the shared id.
        const _meetSessionForId = entryAtSend && entryAtSend.meetingSessionId;
        const _isRequesterMeetOrigin = promoteToOrigin
            && !!_meetSessionForId
            && entryAtSend
            && entryAtSend.kind === 'meetingRequest';
        const mId = _isRequesterMeetOrigin ? _meetSessionForId : uuid.v4();
        const timestamp = new Date();

        // `messageId` is the _id of the **rendered location bubble** this
        // location data refers to. For the
        // very first tick of a session the bubble is *this* message itself
        // (origin and target), so messageId = own envelope _id. For every
        // subsequent tick, messageId points back at the origin tick so the
        // receiver's locationData store keeps updating the same key and
        // the already-rendered bubble refreshes in place.
        // Session grouping id = the rendered bubble key, shared by every tick
        // of the session (and by BOTH legs of a meet). For a meet it's the
        // meeting request id X (from meetingSessionId); the two legs group under
        // one bubble and are told apart by `role`. For a plain-live / one-shot
        // share it's this session's own origin id.
        const _meetSession = _meetSessionForId;
        const sessionId = _meetSession || originLocationId || mId;
        const targetId = sessionId;

        const locationContent = {
            action: 'location',
            // The bubble/session this tick belongs to (== sessionId). Same on
            // every tick of the session — that's how the rendering layer + the
            // peer's related_msg_id group the trail.
            messageId: targetId,
            // sessionId groups the trail on the wire (peer reads it into
            // related_msg_id).
            sessionId: sessionId,
            // false on this leg's first (origin) tick; true on every follow-up.
            // Tells "new session" apart from "another update"; the wire carries
            // this as the explicit location_update / meeting_update action.
            isUpdate: !!originLocationId,
            value: coords,          // {latitude, longitude, accuracy, timestamp}
            expires: expiresAt,     // ISO string of expiration
            timestamp: timestamp,
            uri: uri,
        };

        // "Until we meet" handshake fields, stamped on every outgoing
        // tick of a meeting request (meeting_request:true) and every
        // tick of an acceptance stream (in_reply_to → original request
        // _id). See ShareLocationModal.DURATION_OPTIONS and the
        // acceptance flow in app.js for how these propagate.
        //
        // `meeting_request:true` is stamped on EVERY tick, not just the origin.
        // Follow-up ticks UPDATE the origin row's `content` column in place
        // (saveOutgoingMessageSql location-update branch in app.js), so if only
        // the origin carried the flag the persisted content (the latest tick)
        // would lose it and the bubble's "Show meeting request..." option would
        // vanish on reload. Receiver-side handlers (`_noteIncomingMeetingRequest`,
        // etc.) are idempotent on the requestId, so re-firing per tick is a no-op.
        if (extras.meetingRequest) {
            locationContent.meeting_request = true;
            // Descriptive role on the wire (the inviter's coordinate stream).
            // The engine still pairs via meeting_request / in_reply_to; role is
            // carried alongside for self-describing payloads.
            locationContent.role = 'inviter';
        }
        // Privacy-deferred origin tick: the inviter chose a privacy
        // radius and is still inside it, so the value coords above are
        // the DESTINATION (not the inviter's actual position). Stamp
        // this flag on the wire so the receiver-side rendering can
        // suppress the inviter pin and show only the destination.
        // Cleared on the first real-coord tick that flows after the
        // user crosses the perimeter. The radius is also stamped so
        // the inviter's bubble can render the "Move <radius>…" hint
        // overlay along the bottom of the map without LocationBubble
        // having to look up the timer entry.
        if (extras.privacyDeferred) {
            locationContent.privacyDeferred = true;
            const _entry = this._resolveSendEntry(uri, originLocationId, isMeet);
            const r = _entry && Number(_entry.excludeOriginRadiusMeters);
            if (r && r > 0) {
                locationContent.privacyDeferredRadiusMeters = r;
            }
        }
        // Dummy-origin tick: a privacy-radius meet invite with NO shared
        // destination has no real point it's willing to disclose, so the
        // `value` coords above are a throwaway point generated a few km
        // from the inviter's actual position (see startLocationSharing).
        // The flag tells the receiver this point is fake — render no pin
        // for it (the privacyDeferred path already suppresses the inviter
        // pin; this is belt-and-suspenders and lets the bubble pick a
        // sane empty-map centre). The dummy exists ONLY so the origin
        // bubble persists with valid coords: that keeps the origin/update
        // chain intact so the inviter's REAL position renders the moment
        // they cross the perimeter (the first real tick overwrites the
        // dummy in place). Cleared on that first real-coord tick.
        if (extras.dummy) {
            locationContent.dummy = true;
        }
        if (extras.inReplyTo) {
            // The invited party's coordinate stream — identified by role + the
            // shared sessionId now (in_reply_to removed from the wire).
            locationContent.role = 'invited';
        }
        // Optional shared meeting destination, encoded as
        // {latitude, longitude}. Today only set by the convergence
        // simulator (debug; see ENABLE_MEET_SIMULATION) so both
        // devices can walk toward the same point. Future use case is
        // a real "pick where to meet on a map" UI for the inviting
        // party — receiver's map view can render the same pin on both
        // ends. Sender stamps it once it knows the destination; the
        // field is harmless to ignore for clients that don't render
        // it.
        if (extras.destination
                && typeof extras.destination.latitude === 'number'
                && typeof extras.destination.longitude === 'number') {
            locationContent.destination = {
                latitude: extras.destination.latitude,
                longitude: extras.destination.longitude,
            };
        }
        // One-shot flag — set by shareLocationOnce. Tells the receiver
        // this is a static location share, not a live one: no
        // follow-up ticks will arrive and the bubble should drop the
        // live-share UI affordances (no "expires in", no peer-distance
        // label, etc.).
        if (extras.oneShot) {
            locationContent.one_shot = true;
        }

        // System location-permission state of THIS device, captured when the
        // session started: 'always' | 'whenInUse' (iOS foreground-only) |
        // 'foregroundOnly' (Android, no ACCESS_BACKGROUND_LOCATION) |
        // 'blocked' | 'undetermined' | 'unavailable'. Stamped on ORIGIN ticks
        // only — location_start and meeting_start (the invite leg ships it on
        // its value-bearing meeting_request; location_once stamps its own in
        // shareLocationOnce). Update ticks omit it: the grant is a property of
        // the session's start, and re-stamping it 60x/hour would bloat every
        // trail tick. It rides CLEARTEXT on the wire (app.js
        // _sendLocationSharing) and is persisted in the row's metadata
        // (_locationStoredMetadata) on both legs, so the receiver — and any
        // later diagnostic read of the SQL row — can tell a share that will
        // survive the sender backgrounding the app from one that will stall.
        if (!locationContent.isUpdate) {
            const _perm = extras.permState || this._lastPermState;
            if (_perm) locationContent.perm = _perm;
            // This share is the answer to a peer's `location_request` and the
            // user chose an interval rather than the one-shot reply. Stamp the
            // request id on the ORIGIN tick — same field shareLocationOnce
            // uses, and app.js's wire builder ships it cleartext — so the peer
            // can correlate the stream with its request and our own sibling
            // devices close their still-open prompt on the replicated carbon.
            // Origin only: re-stamping it 60x/hour would bloat every trail
            // tick and the request is a property of the session's start.
            if (extras.answersRequestId) {
                locationContent.requestId = extras.answersRequestId;
            }
        }

        const locationMessage = {
            _id: mId,
            key: mId,
            createdAt: timestamp,
            metadata: locationContent,
            text: JSON.stringify(locationContent),
            // Outgoing messages carry an empty `user` object — GiftedChat
            // warns "user is missing" otherwise (see app/utils.js:192).
            user: {},
        };

        // Plain live shares (no meet-me handshake, privacy-radius, dummy origin
        // ALL location shares — plain live, one-shot AND the "Until we meet"
        // handshake — ship in the application/sylk-location-sharing format: only
        // the coordinate payload is PGP-encrypted, while the lifecycle fields
        // (action, sessionId, meeting_request, in_reply_to, expires…)
        // stay cleartext so the receiver/journal can identify and group a session
        // — and filter it on contact-select — without decrypting. `_isMeetShare`
        // is used only to suppress the plain-live "Sharing…" system note for meet
        // shares (which have their own "I want to meet up" announcement).
        const _isMeetShare = locationContent.meeting_request === true
            || !!locationContent.role
            || locationContent.privacyDeferred === true
            || locationContent.dummy === true
            || !!locationContent.destination;
        // "Until I return" auto-stop. Evaluate the gate BEFORE the send so
        // its departure/return state machine advances on this tick's coords,
        // and remember whether THIS is the terminal (arrival) tick. We do
        // NOT skip the send: the arrival fix is a legitimate final position
        // and must land on the receiver's track as the last point.
        //
        // Ordering matters. location_stop is coordinate-free so it skips the
        // PGP-encrypt step a coordinate-bearing location_update must do; if we
        // fired both without sequencing, the lighter stop would reach
        // account.sendMessage first and overtake the update on the wire (the
        // receiver would see stop-then-stray-update and the last point would
        // be lost). So we send the update and CHAIN the stop onto the update's
        // send promise — all updates go out, THEN the stop, in succession.
        // Returns false for any share whose kind !== 'untilIReturn'.
        const _untilReturnTerminal = this._evaluateUntilReturnGate(uri, coords);
        const _sendPromise = this.app.sendMessage(uri, locationMessage, 'application/sylk-location-sharing');
        if (_untilReturnTerminal) {
            Promise.resolve(_sendPromise)
                .catch(() => { /* stop even if the final update failed to send */ })
                .then(() => this.stopLocationSharing(uri, {reason: 'returned'}));
        }

        // First valid-coords send wins the origin slot for this session.
        // Stamp the entry so concurrent first-fixes (initial GPS-fix
        // resolve vs. first watch / interval callback) can read it and
        // send themselves as updates instead of spawning another origin
        // bubble. Mirrors meetingSessionId for meet-request sessions —
        // the requester's origin _id is the canonical session key.
        if (promoteToOrigin && entryAtSend) {
            entryAtSend.originLocationId = mId;
            if (entryAtSend.kind === 'meetingRequest' && !entryAtSend.meetingSessionId) {
                entryAtSend.meetingSessionId = mId;
            }
            // Mirror to the persisted snapshot so a kill-and-resume
            // doesn't pick up an older / null id.
            try { this.app._persistActiveShares(); } catch (e) { /* noop */ }

            // Plain live share: emit the sender's "You started sharing…" SYSTEM
            // note now — on the actual origin tick — so it's symmetric with the
            // receiver's note and the "You stopped sharing…" note, and never
            // fires for a share that was optimistically shown but then denied.
            // Meet-me keeps its chat-message announcement.
            if (!_isMeetShare
                    && !locationContent.one_shot) {
                const _startAt = timestamp.toLocaleTimeString([],
                    { hour: '2-digit', minute: '2-digit' });
                // Fold in the duration ("for 8 hours" / "until I return") when the
                // share carries one, so this single note conveys everything the
                // old separate "Started sharing … for X" note did — that one was
                // emitted AFTER the origin tick and rendered BELOW the map (a
                // reversed duplicate) and has been removed.
                const _plLabel = (entryAtSend && entryAtSend.periodLabel)
                    ? ` for ${entryAtSend.periodLabel}` : '';
                // Stamp the note ~1s BEFORE the origin tick so it sorts ABOVE the
                // map bubble (whose createdAt is the tick timestamp): the intent
                // note reads first, then the first map.
                const _startNoteTs = new Date(timestamp.getTime() - 1000);
                /* this.app.saveSystemMessage(uri,
                    `📍 Sharing live location at ${_startAt}${_plLabel}`,
                    'outgoing', false, 1, null, null, _startNoteTs); */
            }
        }

        // Per-tick breadcrumb. Emitted *after* the send so it's proof the
        // send path ran (not just that we got a fix). Kept terse — one
        // line per tick every LOCATION_REPEAT_MS so background sessions
        // leave a clear trail in Metro / Xcode / adb logcat.
        const role = originLocationId ? 'update' : 'origin';
        const lat = coords && typeof coords.latitude === 'number'
            ? coords.latitude.toFixed(5) : '?';
        const lng = coords && typeof coords.longitude === 'number'
            ? coords.longitude.toFixed(5) : '?';
        const acc = coords && typeof coords.accuracy === 'number'
            ? ` ±${Math.round(coords.accuracy)}m` : '';
        // Distance-from-origin breadcrumb. The receiver can't compute this on
        // its own (origin is captured per-share on the sender), so we stamp it
        // here. Useful for "I see 17 ticks but didn't move much" — comparing
        // each tick's distFromOrigin tells the recipient at a glance whether
        // the sender was actually progressing or jittering near home. Falls
        // back to '?' if we don't have an origin yet (very first origin tick,
        // or this isn't an "until I return" share).
        const liveEntry = this._resolveSendEntry(uri, originLocationId, isMeet);
        let distFromOriginStr = '';
        if (liveEntry
                && liveEntry.untilReturnOrigin
                && coords
                && typeof coords.latitude === 'number'
                && typeof coords.longitude === 'number') {
            const o = liveEntry.untilReturnOrigin;
            if (typeof o.latitude === 'number' && typeof o.longitude === 'number') {
                const d = haversineMeters(o, coords);
                if (Number.isFinite(d)) {
                    distFromOriginStr = ` distFromOrigin=${Math.round(d)}m`;
                }
            }
        }
        // Promoted from console.log → timestampedLog so it lands in the
        // on-device log file (Show logs / "Support needed…"). The previous
        // build only had this on the dev console, so a "17 ticks but stuck"
        // report from a phone in the field had no per-tick evidence to
        // correlate with — just an aggregate counter.
        //
        // socket= is stamped here because this line is emitted BEFORE the
        // payload reaches _sendMessage, so on its own it only ever meant "a
        // tick was produced" — never "a tick was delivered". With the socket
        // state on it, a tick line alone tells you whether it could have gone
        // out; the `[location] wire →` or `[location] NOT SENT` line that
        // follows says whether it did.
        let _sock = '?';
        try {
            _sock = (this.app && this.app.state && this.app.state.connection
                && this.app.state.connection.state) || 'none';
        } catch (e) { /* leave as ? */ }
        utils.timestampedLog(`[location] tick ${role} → ${uri} ${lat},${lng}${acc} (_id=${mId})${distFromOriginStr} socket=${_sock}`);
        // Record the just-reported coords on the timer entry so
        // _shouldSendUpdateTick's stationary gate can compare future
        // ticks against this baseline. Only meaningful when this is
        // a real coord (placeholder origin ticks land here too with
        // null lat/lng — those shouldn't poison the baseline).
        // Stamp lastReportedAt alongside the coords so the stationary
        // gate's heartbeat override has a reliable "last actually
        // shipped" timestamp; using lastSentMs would conflate "tick
        // attempted" with "tick that left the device" (a gated tick
        // updates lastSentMs but not lastReportedCoords/At).
        // (`liveEntry` was already resolved above for the
        // distFromOrigin breadcrumb — reuse it.)
        if (liveEntry
                && coords
                && typeof coords.latitude === 'number'
                && typeof coords.longitude === 'number') {
            liveEntry.lastReportedCoords = {
                latitude: coords.latitude,
                longitude: coords.longitude,
            };
            liveEntry.lastReportedAt = Date.now();
        }
        // Fire the destination-arrival heads-up if this tick's coords
        // landed within DEST_ARRIVAL_THRESHOLD_M of the shared meeting
        // destination. Once-per-session, gated on the entry flag.
        this._maybeFireDestinationArrival(uri, coords, liveEntry);
        return mId;
    }

    // State machine for the caregiver-only "Until I return" share. The
    // share starts immediately, the first valid tick records the
    // origin, and the share auto-stops the moment a later tick reports
    // a position within UNTIL_RETURN_RETURN_M of that origin — but ONLY
    // after the user has previously moved more than
    // UNTIL_RETURN_DEPARTURE_M away (the "departed" flag). Without the
    // departed gate the share would terminate on its very first
    // GPS-confirming tick, since the first tick is by definition at
    // the origin.
    //
    // No-op for any kind other than 'untilIReturn'; the regular
    // expires-at timer handles the 8h fallback ceiling for the
    // never-returns case (set in startLocationSharing via durationMs).
    //
    // Idempotent: if the tick is missing valid coords, or the entry
    // disappeared between scheduling and now, we just bail.
    _evaluateUntilReturnGate(uri, coords) {
        // 'untilIReturn' is always a PLAIN share, so it only ever lives in the
        // plain store.
        const entry = this._plainStore()[uri];
        if (!entry || entry.kind !== 'untilIReturn') return;
        if (!coords
                || typeof coords.latitude !== 'number'
                || typeof coords.longitude !== 'number') {
            return;
        }
        // First valid tick: record the origin and the initial phase.
        // We DON'T evaluate the gate on the same tick that captures
        // the origin — origin↔current distance is 0 by construction
        // and the departed flag is still false, so the gate would do
        // nothing anyway, but starting the math on the next tick keeps
        // the state machine easier to reason about.
        if (!entry.untilReturnOrigin) {
            entry.untilReturnOrigin = {
                latitude: coords.latitude,
                longitude: coords.longitude,
            };
            entry.untilReturnDeparted = false;
            try {
                utils.timestampedLog(`[location] [untilIReturn] origin captured for ${uri} → ` + `${coords.latitude.toFixed(5)},${coords.longitude.toFixed(5)} ` + `— share will auto-stop when you return after moving ≥${this.UNTIL_RETURN_DEPARTURE_M} m away`);
            } catch (e) { /* noop */ }
            return;
        }
        const distance = haversineMeters(entry.untilReturnOrigin, {
            latitude: coords.latitude,
            longitude: coords.longitude,
        });
        if (!Number.isFinite(distance)) return;
        if (!entry.untilReturnDeparted) {
            // Phase 1: waiting for the user to physically leave the
            // origin neighbourhood. Until they do, every tick stays
            // "near home" and we don't terminate the share.
            if (distance > this.UNTIL_RETURN_DEPARTURE_M) {
                entry.untilReturnDeparted = true;
                try {
                    utils.timestampedLog(`[location] [untilIReturn] departure detected for ${uri} ` + `(${Math.round(distance)} m from origin) — now watching for return`);
                } catch (e) { /* noop */ }
            }
            return;
        }
        // Phase 2: user has departed. As soon as we see a tick that
        // lands them back inside the return ring, terminate the
        // share. stopLocationSharing handles the system note, persisted
        // state, foreground service teardown, etc.; we just signal
        // the reason so future log-grep / analytics can tell why
        // this share ended.
        if (distance <= this.UNTIL_RETURN_RETURN_M) {
            try {
                utils.timestampedLog(`[location] [untilIReturn] return detected for ${uri} ` + `(${Math.round(distance)} m from origin) — sending final tick, then stopping share`);
            } catch (e) { /* noop */ }
            // Do NOT stop here. sendLocationPayload sends this tick's final
            // update first, then chains stopLocationSharing onto the send
            // promise so the stop goes out AFTER the last update.
            return true;
        }
        return false;
    }

    // ===== Destination arrival heads-up =====
    //
    // Fired on the first outgoing tick whose coords are within
    // DEST_ARRIVAL_THRESHOLD_M of the shared meeting destination
    // (the green pin). Independent of proximity-met: that one waits
    // for both phones to be near each other, this one watches a
    // single party reach the chosen meeting point — useful when
    // one party arrives early so the still-walking party knows
    // their friend is already there.
    //
    // Behaviour on the ARRIVING device:
    //   • Single line in the user-visible log.
    //   • Chat message to the peer ("<MyName> arrived at the meeting
    //     point") with metadata.meetingArrival = true. Flows through
    //     the standard PGP text path.
    // No local push to ourselves — we ARE at the meeting point, we
    // know. The peer's app.js detects the incoming meetingArrival
    // text on its side and fires the heads-up push there (see
    // handleIncomingMessage). That way only the still-walking
    // side gets a banner.
    //
    // Once-per-session via entry.destinationArrivalFired.
    _maybeFireDestinationArrival(uri, coords, entryArg = null) {
        // Destination arrival is a meet concept; prefer the entry the caller
        // resolved for this tick, else the meet leg, else any entry for the uri.
        const entry = entryArg
            || this._meetEntryForUri(uri)
            || this._entryByOrigin(uri, null);
        if (!entry) return;
        if (entry.destinationArrivalFired) return;
        // Privacy-deferred origin tick: the value coords passed in are
        // the destination itself (we ship them as a stand-in while the
        // inviter is hiding their position inside the privacy radius).
        // Don't treat this as "arrived" — there's no real position
        // data yet. The flag clears when the inviter crosses the
        // perimeter and a real coord update flows; arrival detection
        // resumes from that point onward.
        if (entry.privacyDeferred) return;
        const dest = entry.tickExtras && entry.tickExtras.destination;
        if (!dest) return;
        if (!coords
                || typeof coords.latitude !== 'number'
                || typeof coords.longitude !== 'number') {
            // Placeholder origin tick (null lat/lng) — wait for real
            // coords.
            return;
        }
        const dist = haversineMeters(coords, dest);
        if (!Number.isFinite(dist)) return;
        const DEST_ARRIVAL_THRESHOLD_M = 30;
        if (dist > DEST_ARRIVAL_THRESHOLD_M) return;

        entry.destinationArrivalFired = true;

        const myDisplayName = this.app.state.displayName || ((this.app.state.accountId || '').split('@')[0]) || 'I';

        // 1. Visible log line on this device.
        try {
            const utils = require('../utils');
            utils.timestampedLog(`[location] [meet] ARRIVED at meeting point (${Math.round(dist)} m from destination) — ${uri}`);
        } catch (e) { /* noop */ }

        // 2. Chat message to the peer. The peer's handleIncomingMessage
        //    sees metadata.meetingArrival on this and fires the
        //    arrival push on THEIR side (and suppresses the default
        //    "New message" banner so we don't double-buzz).
        try {
            const msgId = uuid.v4();
            const announceText = `${myDisplayName} arrived at the meeting point`;
            const textMessage = {
                _id: msgId,
                key: msgId,
                createdAt: new Date(),
                text: announceText,
                metadata: {meetingArrival: true},
                user: {},
            };
            this.app.sendMessage(uri, textMessage);
        } catch (e) {
            console.log('[location] arrival announcement send failed', e && e.message ? e.message : e);
        }
    }

    // Send one location-data update. Fetches a fresh fix every time
    // so each tick carries the user's current position. Returns the _id
    // of the tick that was sent (so the first call can record the origin).
    //
    // When `excludeOriginRadius` is enabled on the session, this method
    // honours the privacy gate via `_shouldSendUpdateTick`: the very
    // first fresh fix is captured as the session's origin point and
    // swallowed (returns null), and any subsequent fix that's still
    // within 1 km of that origin is also swallowed. Ticks resume the
    // moment the user has moved past the radius.
    async sendLocationUpdate(uri, expiresAt, originLocationId = null, extras = {}, isMeet = null) {
        try {
            // Race fence: see the long comment on
            // entry.awaitingSimulatedPosition in startLocationSharing.
            // While the accepter's synthetic-position setup is still
            // in flight (Nominatim land-check), skip the tick rather
            // than ship a real-GPS one that would mistakenly pair
            // both phones at ~1 m and trip proximity-met.
            const entryNow = this._resolveSendEntry(uri, originLocationId, isMeet);
            if (entryNow
                    && entryNow.awaitingSimulatedPosition
                    && !entryNow.simulatedPosition) {
                return null;
            }
            const realCoords = await this.getCurrentCoordinates();
            // Synthetic-position override (debug; see
            // ENABLE_MEET_SIMULATION). When an entry.simulatedPosition
            // is armed, that's what we report; real GPS is ignored
            // for this session.
            const coords = this.sim.effectiveCoordinatesForSession(uri, realCoords);
            if (!this._shouldSendUpdateTick(uri, coords, entryNow)) {
                // Privacy radius is hiding the tick from the wire —
                // refresh the LOCAL bubble's owner pin so the user
                // sees themselves move on their own map.
                const _curEntry = this._resolveSendEntry(uri, originLocationId, isMeet);
                if (_curEntry && _curEntry.privacyDeferred
                        && _curEntry.privacyDeferredBubbleMid) {
                    this.app._setLocalOwnerCoordsForBubble(
                        uri,
                        _curEntry.privacyDeferredBubbleMid,
                        coords,
                        Number(_curEntry.excludeOriginRadiusMeters) || 0
                    );
                }
                return null;
            }
            return this.sendLocationPayload(uri, coords, expiresAt, originLocationId, extras, isMeet);
        } catch (err) {
            console.log('sendLocationUpdate: failed to read location', err && err.message ? err.message : err);
            return null;
        }
    }

    // Privacy-radius gate consulted by every tick-emission path
    // (initial-fix, iOS watchPosition, Android sendLocationUpdate).
    //
    // Behaviour:
    //   - If the session for `uri` doesn't have a positive
    //     `excludeOriginRadiusMeters`, returns true unconditionally
    //     (no gate).
    //   - On the first call with valid coords, captures them as
    //     `originPoint` and returns false (silently swallows the tick).
    //     This is the "first location" the user told us to exclude.
    //   - On subsequent calls, computes the haversine distance from
    //     the captured origin and returns false while it's below the
    //     configured radius (500 m / 2 km — set by the modal slider).
    //   - Once the user crosses the radius, flips
    //     `originRadiusCleared` (one-time flag) so we log it exactly
    //     once and return true thereafter.
    //
    // Coordinates that aren't usable numbers (e.g. the placeholder tick's
    // null lat/lng) are treated as "not yet" — the gate doesn't capture
    // them as the origin point and continues to suppress ticks.
    _shouldSendUpdateTick(uri, coords, entryArg = null) {
        const entry = entryArg || this._entryByOrigin(uri, null);
        // Caller already verified the timer entry exists, but defend
        // against late-arriving callbacks racing tear-down.
        if (!entry) {
            return true;
        }
        // Meet arrival gate. Once THIS device is within _arriveM of the agreed
        // meeting point (session destination), stop emitting meeting_update
        // ticks — the user asked not to keep broadcasting after reaching the
        // meeting point. Exactly ONE tick is allowed through at/after arrival
        // (so the peer receives our final at-destination position), then the
        // rest are suppressed. The session, the receiver, proximity-met
        // detection and the expiry wipe all stay live, so the meet still
        // completes/ends normally — we only pause the outgoing coordinate
        // stream. Every tick path (Android interval, iOS watch, initial fix)
        // funnels through this gate, so one check covers both platforms.
        try {
            const _msid = entry.meetingSessionId;
            const _sess = _msid && this.meetingSessions ? this.meetingSessions[_msid] : null;
            const _dest = _sess && _sess.destination;
            const _clat = coords && typeof coords.latitude === 'number' ? coords.latitude : null;
            const _clng = coords && typeof coords.longitude === 'number' ? coords.longitude : null;
            if (_dest && _clat != null && _clng != null) {
                if (entry.arrivedAtDest) {
                    return false; // already reached the meeting point — stay quiet
                }
                const _pref = this.app && this.app.state && this.app.state.accountSetting
                    && this.app.state.accountSetting.location
                    && this.app.state.accountSetting.location.proximityMeters;
                // Arrival radius: at least 30 m (GPS noise floor at a fixed
                // point), widened to the user's meet-proximity preference when
                // they've relaxed it (e.g. 50 m indoor).
                const _arriveM = Math.max(30, (typeof _pref === 'number' && _pref > 0) ? _pref : 0);
                const _toDest = haversineMeters({latitude: _clat, longitude: _clng}, _dest);
                if (Number.isFinite(_toDest) && _toDest <= _arriveM) {
                    entry.arrivedAtDest = true;
                    try {
                        const _u = require('../utils');
                        _u.timestampedLog('[location] [meet] reached meeting point (~' + Math.round(_toDest) + ' m to dest) — sending final tick, then pausing meeting_update for', uri);
                    } catch (e) { /* logging must never throw */ }
                    // Fall through: let THIS (final) arrival tick go out normally.
                }
            }
        } catch (e) { /* best-effort arrival gate — never block a tick on error */ }
        // Stationary gate has been REMOVED in favour of a per-minute
        // heartbeat tick. The previous "if you haven't moved 10 m,
        // skip the tick" filter saved bandwidth but had two costs the
        // user pushed back on:
        //   1. The sender's app log went silent — no proof the share
        //      was still alive while the phone sat on a desk.
        //   2. The receiver's bubble timestamp + tick counter froze
        //      at the origin tick and never advanced for the entire
        //      X-hour window.
        // Both are now addressed by always emitting a tick at the
        // throttle cadence (LOCATION_REPEAT_MS = 60 s), regardless of
        // movement. A 4 h share at 60 s cadence is ~240 location-data
        // messages — at ~500 bytes encrypted, that's ~120 KB total,
        // which is well within budget for an active chat. The
        // privacy-radius branch below still applies normally so the
        // "Until we meet" 1 km exclusion still hides the user's
        // starting point.
        // The lastReportedCoords / lastReportedAt fields are still
        // stamped by sendLocationPayload so future tuning (e.g. a
        // user-toggleable "low bandwidth" mode that re-enables the
        // gate) has the data to work with.
        const radiusMeters = Number(entry.excludeOriginRadiusMeters) || 0;
        if (radiusMeters <= 0) {
            return true;
        }
        const lat = coords && typeof coords.latitude === 'number' ? coords.latitude : null;
        const lng = coords && typeof coords.longitude === 'number' ? coords.longitude : null;
        if (lat == null || lng == null) {
            // Placeholder / no-fix coords. Don't capture as origin and
            // don't emit a tick — wait for a real fix.
            return false;
        }
        if (!entry.originPoint) {
            entry.originPoint = {latitude: lat, longitude: lng};
            const radiusLabel = radiusMeters >= 1000
                ? `${(radiusMeters / 1000).toFixed(radiusMeters % 1000 === 0 ? 0 : 1)} km`
                : `${Math.round(radiusMeters)} m`;
            const utils = require('../utils');
            try {
                utils.timestampedLog(`[location] [meet] privacy radius active for ${uri} — your starting point will be hidden until you move ${radiusLabel} away`);
            } catch (e) {
                console.log('[location] origin point captured for', uri, 'lat=', lat.toFixed(5), 'lng=', lng.toFixed(5), `(privacy radius ${radiusLabel} active)`);
            }
            return false;
        }
        const meters = haversineMeters(entry.originPoint, {latitude: lat, longitude: lng});
        if (meters < radiusMeters) {
            // Inside the privacy circle — swallow.
            return false;
        }
        if (!entry.originRadiusCleared) {
            entry.originRadiusCleared = true;
            const utils = require('../utils');
            try {
                utils.timestampedLog(`[location] [meet] privacy radius cleared for ${uri} (${Math.round(meters)} m from origin) — your live location is now being shared`);
            } catch (e) {
                console.log('[location] privacy radius cleared for', uri, 'distance=', Math.round(meters), 'm');
            }
        }
        return true;
    }

    // Public: stamp a shared meeting destination onto an active
    // share's tickExtras so subsequent outgoing ticks carry it AND
    // the simulator (if/when started) walks toward it. Called by
    // app.js when an incoming meeting tick carries
    // metadata.destination (typically the requester's broadcast
    // landing on the accepter side, but symmetric — either side can
    // publish). Keeps the first destination it sees; later updates
    // are ignored to avoid mid-session flips.
    setMeetingDestination(uri, destination) {
        if (!uri || !destination
                || typeof destination.latitude !== 'number'
                || typeof destination.longitude !== 'number') {
            return;
        }
        // Destination is a meet concept — prefer the meet leg, fall back to any.
        const entry = this._meetEntryForUri(uri) || this._entryByOrigin(uri, null);
        if (!entry || !entry.tickExtras) return;
        if (entry.tickExtras.destination) return;
        entry.tickExtras.destination = {
            latitude: destination.latitude,
            longitude: destination.longitude,
        };
        try {
            const utils = require('../utils');
            utils.timestampedLog(`[sim] received shared meeting destination at ${destination.latitude.toFixed(5)},${destination.longitude.toFixed(5)} for ${uri}`);
        } catch (e) { /* noop */ }
    }

    // opts.silent — suppress the in-chat system note (used by
    //   componentWillUnmount and by the self-call inside startLocationSharing
    //   that replaces an existing share before posting its own "started" note).
    // opts.reason — 'user' | 'expired' | 'deleted' | 'replaced' | 'unmount'.
    //   Shapes the system-note body. Defaults to 'user'.
    // Pause an active location share. Lightweight (no clearWatch /
    // clearInterval) — we just flip a flag the tick-emission paths
    // consult before sending. The session timer entry stays alive so
    // the user can Resume without re-announcing or restarting from
    // scratch. Pause does NOT extend the share's expiry: real-world
    // time keeps ticking, and if the user resumes after expiresAt the
    // share will tear itself down on the next expiry check.
    //
    // No-op when:
    //   • there's no entry for this uri (already stopped); the
    //     contextual menu's Resume option will instead route to a
    //     fresh startLocationSharing on the bubble's location data.
    //   • originLocationId was supplied AND doesn't match the entry's
    //     origin: the user long-pressed an OLD bubble whose share has
    //     already been replaced by a newer one.
    pauseLocationSharing(uri, originLocationId) {
        const entry = this._entryByOrigin(uri, originLocationId);
        if (!entry) return false;
        if (originLocationId && entry.originLocationId !== originLocationId) return false;
        if (entry.paused) return true;
        entry.paused = true;
        try { this.app._persistActiveShares(); } catch (e) { /* noop */ }
        // Stop the NavBar icon's breathing animation when no shares
        // are actively ticking. Pause means no location data is leaving the
        // device, and the pulse is meant to communicate "the device is
        // sending updates" — keeping it on while nothing's flowing
        // would be misleading. Only stop if every share is paused
        // (multi-share users may have paused one but the other is
        // still ticking) AND there's no active call (the pulse also
        // signals the in-call icon).
        try {
            const _anyUnpaused = [
                ...Object.values(this.outgoingLocationSessions || {}),
                ...Object.values(this.outgoingMeetSessions || {}),
            ].some(e => e && !e.paused);
            if (!_anyUnpaused && !this.app._callActive) {
                this._uiStopPulse();
            }
        } catch (e) { /* noop */ }
        // Force a re-render so any UI gated on pause state (the
        // chat-header Pause/Resume Menu.Item we added earlier) flips
        // to its new label/icon.
        this._uiForceUpdate();
        utils.timestampedLog('[location] paused share for', uri, 'origin=', entry.originLocationId);
        return true;
    }

    // Unpause a previously paused share. If no entry exists (the share
    // was fully stopped — e.g. user deleted a bubble by mistake and
    // wants to keep going), the caller should fall back to a fresh
    // startLocationSharing with resumeOriginLocationId set so the
    // existing bubble keeps updating instead of a new one being
    // spawned. Returns false in that case so app.js's bridge knows to
    // take the start path.
    resumeLocationSharing(uri, originLocationId) {
        const entry = this._entryByOrigin(uri, originLocationId);
        if (!entry) return false;
        if (originLocationId && entry.originLocationId !== originLocationId) return false;
        if (!entry.paused) return true;
        if (Date.now() >= entry.expiresAt) {
            // Expired while paused — clean up and tell the caller
            // there's nothing to resume. Target THIS session explicitly so a
            // concurrent session of the other kind for the same uri is untouched.
            this.stopLocationSharing(uri, {
                reason: 'expired',
                sessionId: entry.originLocationId,
                meet: this._isMeetKind(entry.kind),
            });
            return false;
        }
        entry.paused = false;
        // Force an immediate fix so the receiver sees the position
        // jump from "frozen during pause" to "back to live" without
        // waiting for the LOCATION_REPEAT_MS window to roll around.
        try {
            this.sendLocationUpdate(
                uri,
                new Date(entry.expiresAt).toISOString(),
                entry.originLocationId,
                entry.tickExtras || {},
                this._isMeetKind(entry.kind)
            );
        } catch (e) { /* noop — next periodic tick will catch up */ }
        try { this.app._persistActiveShares(); } catch (e) { /* noop */ }
        // Re-arm the NavBar pulse — ticks are flowing again so the
        // breathing animation should communicate that. Symmetric to
        // the stop in pauseLocationSharing.
        try { this._uiStartPulse(); } catch (e) { /* noop */ }
        // Force a re-render so the chat-header Menu.Item flips back
        // from "Resume sharing" to "Pause sharing".
        this._uiForceUpdate();
        utils.timestampedLog('[location] resumed share for', uri, 'origin=', entry.originLocationId);
        return true;
    }

    // Read the live state of a share for menu / UI purposes:
    //   'active'   — entry exists, not paused
    //   'paused'   — entry exists, paused
    //   'stopped'  — no entry (share was torn down)
    getLocationShareState(uri, originLocationId) {
        const entry = this._entryByOrigin(uri, originLocationId);
        if (!entry) {
            // Diagnostic: a kebab/render path expected an active
            // share but didn't find one. Throttle so a tight render
            // loop doesn't flood the log — once per uri+origin per
            // 5 seconds is plenty for repro.
            if (this._shouldLogShareStateProbe(uri, originLocationId, 'stopped-no-entry')) {
                console.log('[location] getLocationShareState', 'uri=', uri, 'asked-origin=', originLocationId, '→ stopped (no entry)', 'allTimerKeys=', this.outgoingLocationSessions ? Object.keys(this.outgoingLocationSessions) : '(none)');
            }
            return 'stopped';
        }
        if (originLocationId && entry.originLocationId !== originLocationId) {
            if (this._shouldLogShareStateProbe(uri, originLocationId, 'origin-mismatch')) {
                console.log('[location] getLocationShareState', 'uri=', uri, 'asked-origin=', originLocationId, 'entry-origin=', entry.originLocationId, '→ stopped (origin mismatch)');
            }
            return 'stopped';
        }
        // active / paused are the common steady-state results — no log.
        // Each meet bubble's render fires this probe, and the chat
        // re-renders many times per second under normal app activity
        // (typing, scrolling, peer ticks landing). The previous
        // unconditional log produced ~50 lines/sec just from one
        // active share, drowning out useful diagnostics.
        return entry.paused ? 'paused' : 'active';
    }

    // Throttle for the diagnostic getLocationShareState log. Same
    // (uri, originLocationId, reason) won't log more than once per
    // 5 s. Cheap in-memory map keyed by composite — bounded by the
    // number of unique meet bubbles in the chat × the number of
    // distinct failure reasons (currently 2). No cleanup needed for
    // the lifetime of the component.
    _shouldLogShareStateProbe(uri, originLocationId, reason) {
        if (!this._shareStateLogStamps) this._shareStateLogStamps = {};
        const key = `${uri}|${originLocationId || ''}|${reason}`;
        const now = Date.now();
        const last = this._shareStateLogStamps[key] || 0;
        if (now - last < 5000) return false;
        this._shareStateLogStamps[key] = now;
        return true;
    }

    // Public entry point used by app.js logout(). Stops every in-flight
    // share for THIS account and drops any deferred-permission intents.
    // Called BEFORE the SIP connection is torn down so the meeting_end
    // signals can still reach peers — a peer with a reciprocal "Until
    // we meet" share will tear down its own side as a result.
    //
    // We pass `silent: true` so the chat doesn't gain a flurry of
    // "Stopped sharing at HH:MM" system notes the user wouldn't see
    // anyway (they're on the login screen). Reason 'logout' is NOT in
    // peerRelayReasons inside stopLocationSharing, so the peer signal
    // DOES go out — peer notification is the whole point.
    // Clear the engine's runtime handshake/pending state on logout or account-
    // switch: pending-request queues, dedup caches, and per-session wipe timers.
    // Runtime-only — the persisted marker Sets + app_state mirror are handled by
    // the app's _wipeLocationStateForLogout (which calls this); share teardown is
    // stopAllSharesForLogout()'s job.
    resetRuntimeStateForLogout() {
        // Pending request queues — runtime-only "modal not shown yet" state; on
        // account-switch a new identity must not inherit a pending invitation.
        this.pendingMeetingRequests = {};
        this.pendingLocationRequests = {};
        // Runtime dedup caches.
        this._meetLastDistanceBand = {};
        this._meetReportedEnded = new Set();
        // Cancel pending session-wipe timers — scoped to this account's session
        // ids, they'd otherwise fire after the account is gone.
        if (this.meetingSessionWipeTimers) {
            for (const id of Object.keys(this.meetingSessionWipeTimers)) {
                try { BackgroundTimer.clearTimeout(this.meetingSessionWipeTimers[id]); }
                catch (e) { /* noop */ }
            }
            this.meetingSessionWipeTimers = {};
        }
    }

    stopAllSharesForLogout() {
        // Stop every armed session across BOTH stores. A contact may have a
        // plain share AND a meet leg live at once, so target each by its own
        // session id rather than by uri alone.
        const targets = [];
        const _plain = this.outgoingLocationSessions || {};
        const _meet = this.outgoingMeetSessions || {};
        for (const uri of Object.keys(_plain)) {
            targets.push({uri, sessionId: _plain[uri] && _plain[uri].originLocationId, meet: false});
        }
        for (const uri of Object.keys(_meet)) {
            targets.push({uri, sessionId: _meet[uri] && _meet[uri].originLocationId, meet: true});
        }
        for (const t of targets) {
            try {
                this.stopLocationSharing(t.uri, {silent: true, reason: 'logout', sessionId: t.sessionId, meet: t.meet});
            } catch (e) { /* best effort */ }
        }
        // Drop any parked permission-retry intents. _onAppStateChange's
        // drain would otherwise try to start them again the next time
        // the app foregrounds — under whatever account is signed in
        // at that point, which is exactly the cross-account leak we're
        // trying to prevent here.
        this._pendingPermissionShares = {};
        // Defensive: ensure the pulse animation isn't left running
        // against an empty share map. _stopActiveSharePulse is a no-op
        // when no animation is armed.
        try { this._uiStopPulse(); } catch (e) { /* noop */ }
    }

    stopLocationSharing(uri, opts = {}) {
        // sessionId / meet pick WHICH of a contact's (possibly two) live sessions
        // to stop — a plain share and a meet leg can be armed at once. With no
        // discriminator we fall back to "the plain share, else the meet leg" for
        // backward-compat with the many legacy callers that pass only a uri.
        const {silent = false, reason = 'user', sessionId = null, meet = null} = opts;

        // Reentry guard. Our own deleteMessage call near the end of
        // this function re-enters stopLocationSharing (via app.js's
        // deleteMessage → navBar.stopLocationSharing({reason:'deleted'})
        // path, because the meeting_request we're deleting is itself a
        // live-location bubble). Without this guard the recursive call
        // would emit a second, duplicate system note — the outer call
        // has already scheduled the state cleanup and the "stopped
        // sharing" note, and re-entering here would see activeShares
        // still populated (setState is async) and fire another one.
        if (!this._pendingStops) this._pendingStops = new Set();
        if (this._pendingStops.has(uri)) return;
        this._pendingStops.add(uri);

        // If a permission-deferred share intent is parked for this
        // peer, drop it. stopLocationSharing means the user wants
        // sharing to stop — we shouldn't auto-resume a parked intent
        // on next foreground after that.
        if (this._pendingPermissionShares[uri]) {
            delete this._pendingPermissionShares[uri];
            utils.timestampedLog('[location] permission-retry dropped — stopLocationSharing called for', uri, 'reason=', reason);
        }

        let entry = null;
        if (sessionId != null) entry = this._entryByOrigin(uri, sessionId);
        // A sessionId that doesn't resolve (e.g. a meet bubble whose origin id
        // shifted across the accept handshake) must still stop the right local
        // session when the caller told us the TYPE — otherwise we fall through
        // to the mirror-relay branch on the very device that owns the timer and
        // nothing stops (reported "Stop didn't stop"). Fall back by type.
        if (!entry) {
            if (meet === true) entry = this._meetStore()[uri];
            else if (meet === false) entry = this._plainStore()[uri];
            else if (sessionId == null) entry = this._plainStore()[uri] || this._meetStore()[uri];
        }

        const wasActive = !!entry
            || this.app.state.activeLocationShares[uri] !== undefined;

        // MULTI-DEVICE STOP. This device is NOT the broadcaster (no local
        // timer), but the user pressed Stop while it was mirroring an active
        // share started on another of their devices. Relay a stop for the
        // mirrored session so BOTH the peer AND the broadcasting sibling tear
        // down — "start on one device, finish on another". Skip reasons that
        // are themselves teardown responses (so we never loop). One session at
        // a time per contact, so the mirror entry uniquely identifies it.
        if (!entry) {
            const _mirrorStopSkip = new Set(['peer-stopped', 'requester-deleted', 'unmount', 'replaced', 'expired']);
            // Source the mirror entry from the live Map OR the React-state twin.
            // These can desync (e.g. the inactivity sweep evicts the Map entry
            // while the state still carries it, which is exactly what opened the
            // panel). Take whichever has it so the relay always finds originMid.
            // The mirror lives on the APP (this.app), not NavigationBar. Read
            // the live Map first, then the React-state twin, then — as a last
            // resort — the snapshot NavigationBar received as a prop. These can
            // desync (e.g. the inactivity sweep evicts the Map entry while the
            // state still carries it, which is exactly what opened the panel),
            // so take whichever still has originMid. Without this.app the older
            // this.app reads returned undefined on a mirror-only device, so
            // the relay silently no-op'd and the broadcaster kept sharing.
            const _app = this.app;
            // The mirror Map is keyed per session-type (uri for a plain share,
            // uri#meet for a meet), so check BOTH slots — otherwise a meet stop
            // never finds its mirror entry. Fall back to the React-state twin
            // and the prop snapshot, which can carry it when the inactivity
            // sweep has evicted the Map entry mid-session.
            const _mirror = (_app && _app._activeRemoteShares
                    && (_app._activeRemoteShares.get(uri) || _app._activeRemoteShares.get(uri + '#meet')))
                || (_app && _app.state && _app.state.activeRemoteSharesByUri
                    && _app.state.activeRemoteSharesByUri[uri])
                || (this.app.props && this.app.props.activeRemoteSharesByUri
                    && this.app.props.activeRemoteSharesByUri[uri])
                || null;
            // GUARD: only relay when a mirrored session ACTUALLY exists. There's
            // no local entry here (we're in the !entry branch); if there's also
            // no mirror, then nothing is live for this peer on any device, so a
            // Stop tap must send NOTHING. Without this, a tap on a bubble whose
            // session already ended still fires a dead location_stop on the wire
            // (the bubble always carries a sessionId), which the peer/sibling
            // re-echo and the pin/button never settle. No mirror ⇒ no signal.
            // When a mirror does exist, prefer the caller's explicit sessionId
            // (the modal row / map bubble names WHICH of two sessions to stop),
            // else the mirror's own origin id.
            const _relayOrigin = _mirror
                ? ((opts.sessionId != null) ? opts.sessionId : _mirror.originMid)
                : null;
            if (_relayOrigin && !_mirrorStopSkip.has(reason)) {
                const _isMeetMirror = (opts.meet != null)
                    ? !!opts.meet
                    : !!(_mirror && (_mirror.role === 'requester' || _mirror.role === 'accepter'));
                try {
                    if (_isMeetMirror) {
                        this.sendMeetingEndSignal(uri, _relayOrigin, { reason });
                    } else {
                        this.sendLocationStopSignal(uri, _relayOrigin, reason);
                    }
                    utils.timestampedLog('[location] relayed stop for mirrored share', uri, 'origin=', _relayOrigin, 'role=', (opts.meet != null ? (opts.meet ? 'meet' : 'plain') : ((_mirror && _mirror.role) || 'plain')));
                } catch (e) {
                    utils.timestampedLog('[location] mirrored-share stop relay failed', e && e.message ? e.message : e);
                }
                try {
                    if (_app && typeof _app._clearRemoteShareForUri === 'function') {
                        _app._clearRemoteShareForUri(uri);
                    } else if (typeof this.app._clearRemoteShareForUri === 'function') {
                        this.app._clearRemoteShareForUri(uri);
                    }
                } catch (e) { /* best-effort */ }
                // Suppress the pulse from re-lighting: the broadcasting sibling
                // keeps shipping ticks until it receives our relayed stop, and
                // each self-echo carbon would otherwise re-stamp the mirror
                // (_mirrorStampFromSelfEcho) and bring the pulse straight back —
                // making the Stop tap look like it did nothing. The 10 s window
                // matches that guard; by then the sibling has stopped.
                try {
                    const _guardHost = _app || this.app;
                    if (!_guardHost._recentlyStoppedUris) _guardHost._recentlyStoppedUris = new Map();
                    _guardHost._recentlyStoppedUris.set(uri, Date.now());
                } catch (e) { /* best-effort */ }
            }
        }

        // If this share is one half of an "Until we meet" handshake AND the
        // stop was initiated locally (user tap, local delete, permission
        // revoked), tell the peer so they can tear down their reciprocal
        // share. We skip reasons that are already in response to a peer
        // event ('peer-stopped', 'requester-deleted'), a scheduled tear-
        // down that the peer's own timer will also hit ('expired'), an
        // internal silent restart ('replaced'), or app shutdown ('unmount',
        // where the websocket is on its way down anyway).
        const peerRelayReasons = new Set([
            'expired',
            'replaced',
            'peer-stopped',
            'requester-deleted',
            'unmount',
        ]);
        if (entry
            && entry.meetingSessionId
            && !peerRelayReasons.has(reason)) {
            // meeting_end wipes the session, posts the reason-aware "meet-up
            // ended" note, rides the location push, AND is journaled + replayed
            // (like location_stop) — so an offline peer woken by a push still
            // learns the meet ended on reconnect. No separate location_stop
            // companion is needed any more.
            this.sendMeetingEndSignal(uri, entry.meetingSessionId, {reason});
            // Ending our own meet leg ends the meet for BOTH sides — so drop
            // our LOCAL mirror of the peer's inbound share too. The peer stops
            // on our meeting_end, but as a peer-stopped teardown it never signals
            // us back, so without this our activeRemoteSharesByUri[uri] lingers
            // and its inbound-share indicator keeps pulsing on the very device
            // that pressed Stop (the reported symptom). The proximity / incoming
            // meeting_end paths already clear it via _wipeMeetingSession; this
            // covers the user-initiated stop.
            try {
                if (typeof this.app._clearRemoteShareForUri === 'function') {
                    this.app._clearRemoteShareForUri(uri);
                }
            } catch (e) { /* best-effort */ }
        }

        // Plain live share (no meet-me session): tell the peer we stopped so
        // their side can post an explicit "stopped sharing" note. Meet-me is
        // handled by sendMeetingEndSignal above. Skip peer-originated stops
        // (they already know) and app-shutdown reasons (websocket on its way
        // down). The signal references our origin tick id — the same messageId
        // the receiver's bubble is keyed by.
        const _plainStopSkip = new Set(['peer-stopped', 'unmount', 'replaced']);
        if (entry
            && !entry.meetingSessionId
            && entry.originLocationId
            && !_plainStopSkip.has(reason)) {
            this.sendLocationStopSignal(uri, entry.originLocationId, reason);
        }

        if (entry) {
            // Android path: a repeating BackgroundTimer interval.
            if (entry.intervalId != null) {
                BackgroundTimer.clearInterval(entry.intervalId);
            }
            // iOS path: CLLocationManager watcher + expiry fallback timer.
            // Releasing the watcher lets iOS let the app sleep again —
            // leaving it armed would keep us running in background
            // indefinitely.
            if (entry.watchId != null
                && Geolocation
                && typeof Geolocation.clearWatch === 'function') {
                try { Geolocation.clearWatch(entry.watchId); }
                catch (e) { /* noop */ }
            }
            if (entry.expiryTimeoutId != null) {
                try { BackgroundTimer.clearTimeout(entry.expiryTimeoutId); }
                catch (e) { /* noop */ }
            }
        }
        if (entry) { try { delete this._storeOfEntry(entry)[uri]; } catch (e) { /* noop */ } }
        if (entry) { try { this.app._onLocationSessionsChanged('REMOVE', 'outgoing', uri, `reason=${reason} type=${this._isMeetKind(entry.kind) ? 'meet' : 'share'} kind=${entry.kind || 'fixed'} sid=${entry.originLocationId || entry.meetingSessionId || '?'} dev=${this.app.deviceId || '?'}`); } catch (e) {} }
        // DURABLE ENDED MARKER. Record this session as ended so a later reload /
        // journal replay cannot revive it. The boot-replay mirror seed and the
        // journal zombie-guard both consult _endedLocationSessions + the stored
        // location_stop row; without a durable marker here a sibling-relayed
        // peer-stop (which tears the local entry down WITHOUT running
        // _endLocationTrack) leaves no trace, so a reload re-seeds the mirror and
        // the pin/Stop button come back for a session the user already ended
        // (reported symptom). _endLocationTrack is idempotent (its _already
        // guard) and, for direction 'outgoing', persists the stop row + adds the
        // id to _endedLocationSessions + flips the bubble to "ended". Skip the
        // reasons that are NOT real teardowns — 'replaced' (silent restart to
        // re-arm the same session) and 'unmount' (process death; the resume path
        // must still find the session on next launch).
        if (entry && reason !== 'replaced' && reason !== 'unmount') {
            const _endId = entry.originLocationId || entry.meetingSessionId;
            if (_endId && typeof this.app._endLocationTrack === 'function') {
                try {
                    this.app._endLocationTrack(uri, _endId, reason, _endId, Date.now(), 'outgoing');
                } catch (e) { /* best-effort — durable marker is defence in depth */ }
            }
        }
        // Locally-initiated end of a MEET leg (user tapped Stop, or deleted the
        // bubble) never runs _wipeMeetingSession on THIS device — only the peer
        // does, via the meeting_end we relay. So our own origin bubble was left
        // showing the generic "Track ended" footer instead of the meet outcome
        // the peer sees. Stamp the outcome locally for the user-driven reasons;
        // the peer-driven / scheduled teardowns already stamp it through
        // _wipeMeetingSession (proximity / expired / replaced / incoming end).
        try {
            const _localMeetFinalizeSkip = new Set(['peer-stopped', 'expired', 'replaced', 'unmount', 'proximity', 'denied', 'requester-deleted', 'returned']);
            if (entry && entry.meetingSessionId && !_localMeetFinalizeSkip.has(reason)
                    && typeof this.app._finalizeLocalMeetOutcome === 'function') {
                this.app._finalizeLocalMeetOutcome(entry.meetingSessionId, uri, reason);
            }
        } catch (e) { /* best-effort meet-outcome stamp */ }
        // The share is stopping — stop any SIMULATOR walker for this uri too.
        // The meet-up / round-trip / random-walk walkers run on their own
        // interval inside this.sim (this.sim._simStates), separate from the
        // real GPS interval/watch cleared above. Nothing else tears them down
        // on a share stop: previously the walker was started AND stopped by the
        // menu toggle, but now the meet-up sim auto-starts on accept, so when
        // the meet ends (proximity wipe / stop / expiry) the walker would keep
        // ticking — re-arming activeLocationShares and the pulse, and shipping
        // stray meeting_update ticks. Stop it here so a finished meet truly goes
        // quiet. Idempotent + best-effort.
        try { if (this.sim && typeof this.sim.stop === 'function') this.sim.stop(uri); } catch (e) { /* best-effort */ }
        // Only rewrite the persisted snapshot when the share is
        // ending for a USER / SESSION reason — not when the React
        // component is being torn down by process death. On
        // Android, swipe-up-to-kill DOES fire componentWillUnmount
        // (it loops over every active share calling
        // stopLocationSharing({reason:'unmount'}) ); persisting
        // here would wipe the snapshot to an empty map and the
        // resume-on-restart path would find nothing to bring back.
        // The "unmount" branch keeps outgoingLocationSessions clean for the
        // brief window before the JS engine itself shuts down, but
        // leaves AsyncStorage intact so _loadAndResumeActiveShares
        // sees the still-live entries when the user reopens the app.
        if (reason !== 'unmount') {
            this.app._persistActiveShares();
            // Force the underlying app_state SQL UPDATE through
            // immediately, bypassing the 250 ms debounce. Without
            // this, a user who stops a share and immediately kills
            // the app would relaunch with the just-cleared entry
            // still on disk — and _loadAndResumeActiveShares would
            // bring the share back to life.  _persistActiveShares
            // is async (read-modify-write) so we let the flush land
            // on the next microtask. Best-effort, no await needed
            // by the caller.
            try {
                if (this.app.state.accountId) {
                    Promise.resolve()
                        .then(() => this.app._forceFlushAppState(this.app.state.accountId))
                        .catch(() => { /* persistence is best-effort */ });
                }
            } catch (e) { /* noop */ }
        }

        // Android: release the foreground-service promotion, but ONLY when
        // there are no other active shares (a user may be sharing with
        // several contacts at once; stopping one shouldn't kill all of
        // them). We key off `outgoingLocationSessions` after the delete above —
        // if it's empty, no other share is running.
        if (Platform.OS === 'android'
            && LocationForegroundServiceModule
            && typeof LocationForegroundServiceModule.stopService === 'function'
            && Object.keys(this.outgoingLocationSessions).length === 0
            && Object.keys(this.outgoingMeetSessions || {}).length === 0) {
            try {
                LocationForegroundServiceModule.stopService();
                utils.timestampedLog('[location] [fgs] stopService requested — last share ended');
            } catch (e) {
                utils.timestampedLog('[location] [fgs] stopService FAILED: '
                    + (e && e.message ? e.message : e));
            }
        }

        // Mirror the change in React state so the menu item re-renders as
        // "Share location..." again. Guard the setState so we don't
        // schedule work after unmount (componentWillUnmount also calls us).
        if (!this.navbar || this.navbar._unmounted) return;
        if (this.app.state.activeLocationShares[uri] !== undefined) {
            // Only drop the pulse entry when NO session remains for this uri in
            // either store — a contact can have a plain share and a meet leg at
            // once, and stopping one must not clear the other's indicator. When a
            // session survives, retarget the countdown to its expiry.
            const _remaining = this._plainStore()[uri] || this._meetStore()[uri];
            const next = {...this.app.state.activeLocationShares};
            if (_remaining) {
                next[uri] = (_remaining.expiresAt != null) ? _remaining.expiresAt : next[uri];
            } else {
                delete next[uri];
            }
            this.app.setState({activeLocationShares: next});
        }

        // Drop a system note into the chat timeline so the user has a
        // visible record that sharing ended. Persisted via saveSystemMessage
        // (SQL INSERT with system=1) so it survives a reload. Skipped when
        // we weren't actually sharing (idempotent callers) or when the
        // caller explicitly asked for silence.
        if (!silent && wasActive) {
            // Wall-clock time the stop happened, e.g. "14:23" or "2:23 PM".
            // Chosen over toLocaleTimeString()'s default so we don't surface
            // seconds for a timeline marker — HH:MM is enough to anchor the
            // event and keeps the note short.
            const stoppedAt = new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
            });
            // Was this share part of an "Until we meet" meeting session?
            // The wording switches on that: meeting sessions get their own
            // started / stopped / cancelled / completed vocabulary, plain
            // timed shares keep the more literal "sharing" wording.
            const wasMeeting = !!(entry && entry.meetingSessionId);
            // Has the peer accepted yet? Drives the vocabulary of the
            // system note: before acceptance the session is still a
            // "Meeting request" (the peer hasn't responded); once either
            // side has accepted, it's just a "Meeting" — the "request"
            // qualifier no longer fits because both sides are actively
            // sharing. The 'requester-deleted' and 'peer-stopped' paths
            // can only fire when the peer was actively sharing (they
            // imply the handshake completed), so we treat those as
            // post-acceptance unconditionally.
            const sessionId = entry && entry.meetingSessionId;
            const meetingAccepted = !!(
                this.isMeetingSessionAccepted(sessionId)
            );
            const postAcceptance = meetingAccepted
                || reason === 'requester-deleted'
                || reason === 'peer-stopped';
            let note;
            if (wasMeeting) {
                switch (reason) {
                    case 'expired':
                        // Timer ran its course without a proximity-met
                        // event firing. If proximity HAD fired, the
                        // session was torn down via _wipeMeetingSession
                        // → stopLocationSharing({silent:true, reason:'expired'}),
                        // which skips this note entirely. So reaching
                        // this branch non-silently means: the two parties
                        // never actually met within the window.
                        note = 'Meeting expired';
                        break;
                    case 'deleted':
                        // We (the local user) cancelled the session.
                        note = postAcceptance
                            ? 'Meeting cancelled'
                            : 'Meeting request cancelled';
                        break;
                    case 'requester-deleted':
                        // The remote party deleted a leg of the session.
                        // Always post-acceptance — only the accepter's
                        // stopLocationSharing gets this reason, and the
                        // accepter by definition has accepted.
                        note = 'Meeting cancelled by remote party';
                        break;
                    case 'peer-stopped':
                        // Peer tapped Stop — orderly end, after both
                        // parties were actively sharing. Always
                        // post-acceptance.
                        note = 'Meeting stopped by remote party';
                        break;
                    default:
                        // Local user tapped Stop (no explicit reason
                        // supplied — the pin modal's stopShare calls us
                        // with no opts). An orderly, locally-initiated
                        // end. Post-acceptance → "Meeting stopped";
                        // before acceptance we would have hit 'deleted'
                        // via the origin-bubble delete path, not this
                        // default, so the wording here is safe.
                        note = 'Meeting stopped';
                        break;
                }
            } else {
                switch (reason) {
                    case 'expired':
                        note = `\uD83D\uDCCD Live location sharing expired at ${stoppedAt}`;
                        break;
                    case 'returned':
                        // Redundant now: the sharer's own origin bubble footer
                        // shows "Returned at HH:MM" (LocationBubble reads
                        // endedReason='returned'), so skip this system note —
                        // matches the receiver side (app.js location_stop handler).
                        note = null;
                        break;
                    case 'deleted':
                        note = `\uD83D\uDCCD Stopped sharing live location at ${stoppedAt} (message deleted)`;
                        break;
                    case 'requester-deleted':
                        note = `\uD83D\uDCCD Stopped sharing live location at ${stoppedAt} (the request was deleted by the other party)`;
                        break;
                    case 'peer-stopped':
                        note = `\uD83D\uDCCD The other party stopped location sharing at ${stoppedAt}`;
                        break;
                    default:
                        note = `\uD83D\uDCCD Stopped sharing live location at ${stoppedAt}`;
                }
            }
            // Tie the note to the track's session/origin id so the delete
            // cascade (msg_id = ? OR related_msg_id = ?) purges it with the trail.
            if (note) {
                this.app.saveSystemMessage(uri, note, 'outgoing', false, 1, null, null, null,
                    entry && (entry.meetingSessionId || entry.originLocationId));
            }
        }

        // Wipe the meeting-session messages from both sides so the only
        // thing left in the transcript after a cancel is the local system
        // notes we just emitted. Two distinct _ids are in play:
        //   • meetingSessionId — the requester's origin tick (the
        //     "meeting_request" bubble). The requester owns it; the
        //     accepter has a received copy of the same _id.
        //   • originLocationId — the local device's OWN origin tick. On
        //     the requester side this equals meetingSessionId. On the
        //     accepter side it's a separate message (their reply bubble
        //     with in_reply_to pointing at the request).
        //
        // Goal: both legs removed on BOTH devices regardless of who
        // initiated the cancel. For every leg in the session we call
        // deleteMessage(legId, uri, remote=true) — the remote=true flag
        // journals a removeMessage event to the peer, so their copy of
        // that leg is wiped too. Skip the specific id that was already
        // deleted by the caller (passed through as opts.deletedId) so we
        // don't fire a redundant delete on it.
        //
        // The _pendingStops guard at the top of this function short-
        // circuits the recursive re-entry that app.js.deleteMessage
        // triggers via its live-location detection (it calls
        // stopLocationSharing on any sylk-location-sharing bubble delete),
        // so calling deleteMessage from inside this block is safe.
        // FROZEN SUMMARY: a normal meet-end must KEEP the 3-point summary, so
        // 'user' (tapped Stop) and 'peer-stopped' (meeting_end / proximity from
        // the peer) NO LONGER trigger the delete + removeMessage cascade — that
        // cascade was what wiped the frozen map on both devices at meet-end.
        // Only an EXPLICIT delete removes the map (and propagates the removal to
        // the peer): the user long-pressing the bubble ('deleted'), or the peer
        // remote-deleting a leg ('requester-deleted').
        //
        // BOTH entries are user acts — 'requester-deleted' is simply the OTHER
        // party's user pressing delete, reaching us as an inbound removeMessage.
        // A deletion the remote side asks for is honoured, in full, including
        // the sibling-leg propagation below that makes all three devices
        // converge on the same end state. Do not "protect" the track from it.
        //
        // What was wrong until 2026-08-24 was not this set but the SENDERS: the
        // journal purge (app.js _syncJournal), the pending sweep, the metadata
        // dedup and the permission-denial rollback all issued removeMessage
        // with remote=true off their own bat, so a peer's DEVICE could fabricate
        // a "the user deleted this" request that no user ever made. Those are
        // now local-only, so an inbound removeMessage once again means what it
        // says. Fix the fabricators, not the honouring.
        const cleanupReasons = new Set([
            'deleted',          // user long-pressed the bubble to delete
            'requester-deleted', // peer remote-deleted a leg
        ]);
        if (entry
            && entry.meetingSessionId
            && cleanupReasons.has(reason)) {
            const deletedId = opts.deletedId || null;

            const propagateDelete = (legId) => {
                if (!legId) return;
                // The leg that triggered this stop is already being
                // deleted by whoever called us (app.js.deleteMessage for
                // reason='deleted'; app.js.removeMessage for reason=
                // 'requester-deleted'). Re-deleting the same id would
                // journal a duplicate removeMessage event to the peer.
                if (legId === deletedId) return;
                try {
                    this.app.deleteMessage(legId, uri, true, false,
                        'user:bubble-delete-cascade(' + (reason || 'deleted') + ')');
                } catch (e) {
                    console.log('[location] propagateDelete failed', legId, e && e.message ? e.message : e);
                }
            };

            propagateDelete(entry.meetingSessionId);
            // Only fire for originLocationId when it's a DISTINCT id
            // from meetingSessionId — on the requester side they're the
            // same bubble and we already handled it above.
            if (entry.originLocationId
                && entry.originLocationId !== entry.meetingSessionId) {
                propagateDelete(entry.originLocationId);
            }
        }

        this._pendingStops.delete(uri);
    }

    // Find every active share whose tick stream was started as a reply
    // to `deletedRequestId` (i.e. stored with `inReplyTo === deletedRequestId`
    // in the timer entry) and stop them. Used when an incoming
    // removeMessage event fires for the request we were replying to —
    // the requester has deleted their original message, so there's
    // nothing to reply to anymore. reason='requester-deleted' so
    // stopLocationSharing emits a distinct system note in the chat
    // timeline. Returns the list of URIs that were stopped.
    stopSharesRepliesTo(deletedRequestId) {
        if (!deletedRequestId) return [];
        const stopped = [];
        // inReplyTo tags an ACCEPT leg, which lives in the meet store now — but
        // scan both stores defensively. Snapshot the matches up front since
        // stopLocationSharing mutates the stores mid-iteration.
        const _matches = [];
        const _scan = (store, isMeet) => {
            Object.keys(store || {}).forEach((uri) => {
                const entry = store[uri];
                if (entry && entry.inReplyTo === deletedRequestId) {
                    _matches.push({uri, sessionId: entry.originLocationId, meet: isMeet});
                }
            });
        };
        _scan(this._meetStore(), true);
        _scan(this._plainStore(), false);
        _matches.forEach(({uri, sessionId, meet}) => {
            utils.timestampedLog('[location] stopSharesRepliesTo: stopping share with', uri, 'because its original request', deletedRequestId, 'was deleted by the peer');
            stopped.push(uri);
            // Pass deletedId so the cleanup block skips propagating
            // a redundant delete for the request that was already
            // removed by the peer's remote_delete. The OTHER leg
            // (originLocationId — our own reply) still gets wiped
            // with remote=true so the peer's copy is gone too.
            this.stopLocationSharing(uri, {
                reason: 'requester-deleted',
                deletedId: deletedRequestId,
                sessionId,
                meet,
            });
        });
        return stopped;
    }

    // Emit a small location-data message telling the peer to end their side of
    // a "Until we meet" session. Triggered from stopLocationSharing when
    // the user cancels a meeting share (either side). Carries the shared
    // meeting_session_id — the requester's origin tick _id — which both
    // clients stamped on their outgoingLocationSessions entry when the share began.
    //
    // Fire-and-forget: if the send fails (no connection, etc.) the peer
    // share will simply run to its natural expiry. We don't block the
    // local teardown waiting for confirmation.
    // Tell the peer we stopped a PLAIN live share so their side can post an
    // explicit "stopped sharing" note (and freeze the bubble at its last
    // position). Shipped on the same application/sylk-location-sharing type as
    // the ticks, but it carries NO coordinates — only the cleartext lifecycle
    // fields — so there is nothing to encrypt. `originId` is our origin tick's
    // _id, which is the messageId the receiver's bubble is keyed by.
    // Fire-and-forget: if it fails the share just runs to its natural expiry.
    sendLocationStopSignal(uri, originId, reason = 'user') {
        if (!uri || !originId) return;
        if (!this.app.sendMessage) {
            utils.timestampedLog('[location] sendLocationStopSignal: sendMessage prop not wired');
            return;
        }
        const mId = uuid.v4();
        const timestamp = new Date();
        // Normalise the internal stop reason to a small public vocabulary the
        // peer + push notification understand: 'returned' (came back to the
        // start point on an "until I return" share), 'expired' (the timed cap
        // lapsed) or 'ended' (everything else — a manual stop, delete, logout).
        const _publicReason = (reason === 'returned' || reason === 'expired' || reason === 'meet_end')
            ? reason : 'ended';
        const body = {
            action: 'location_stop',
            reason: _publicReason,
            // sessionId is the session/bubble grouping key every tick carries —
            // ship it EXPLICITLY (per the wire spec) so the peer + our sibling
            // devices can match this stop to the rendered bubble and flip it to
            // "Track ended". Leaving it to be back-derived from messageId on the
            // send path is fragile (it breaks whenever messageId and the bubble's
            // session id diverge, e.g. meets / resumed sessions) and was leaving
            // the desktop viewer stuck on a live map.
            sessionId: originId,
            messageId: originId,
            timestamp,
            uri,
            // Cleartext id of the device sending this stop (may be a mirroring
            // sibling relaying a stop for a session started elsewhere).
            deviceId: this.app.deviceId,
        };
        const msg = {
            _id: mId,
            key: mId,
            createdAt: timestamp,
            metadata: body,
            text: JSON.stringify(body),
            user: {},
        };
        try {
            this.app.sendMessage(uri, msg, 'application/sylk-location-sharing');
            utils.timestampedLog('[location] sent location_stop to', uri, 'origin=', originId);
        } catch (e) {
            utils.timestampedLog('[location] sendLocationStopSignal failed', e && e.message ? e.message : e);
        }
    }

    sendMeetingEndSignal(uri, sessionId, opts = {}) {
        if (!uri || !sessionId) return;
        if (!this.app.sendMessage) {
            utils.timestampedLog('[location] sendMeetingEndSignal: sendMessage prop not wired');
            return;
        }
        const mId = uuid.v4();
        const timestamp = new Date();
        // meeting_end ALWAYS carries a reason, mirroring location_stop:
        // 'proximity' (the parties met), 'expired' (the cap lapsed) or 'ended'
        // (a manual / other teardown). The receiver keys its dedup + note off it.
        const _publicReason = (opts.reason === 'proximity' || opts.reason === 'expired')
            ? opts.reason : 'ended';
        const body = {
            action: 'meeting_end',
            reason: _publicReason,
            // sessionId is the session/bubble grouping key — ship it EXPLICITLY
            // (per the wire spec, same as the coord ticks) so a meet teardown
            // matches the rendered bubble on the peer + sibling devices and flips
            // it to ended, instead of relying on the send-path back-deriving it
            // from messageId.
            sessionId: sessionId,
            // messageId is the bubble the signal refers to. Existing
            // receivers (updateMetadataFromRemote) key off this — pointing
            // it at the session id keeps lookups consistent with how
            // location ticks have always worked.
            messageId: sessionId,
            meeting_session_id: sessionId,
            timestamp,
            uri,
            // Cleartext id of the device sending this meeting_end.
            deviceId: this.app.deviceId,
        };
        const msg = {
            _id: mId,
            key: mId,
            createdAt: timestamp,
            metadata: body,
            text: JSON.stringify(body),
            // GiftedChat/outgoing plumbing requires a `user` field.
            user: {},
        };
        try {
            this.app.sendMessage(uri, msg, 'application/sylk-location-sharing');
            utils.timestampedLog('[location] sent meeting_end signal to', uri, 'session=', sessionId);
        } catch (e) {
            utils.timestampedLog('[location] sendMeetingEndSignal failed', e && e.message ? e.message : e);
        }
    }

    // Peer told us they ended a meeting session. Walk our timers and stop
    // any share whose meetingSessionId matches — reason='peer-stopped' so
    // the chat system-note copy makes it clear who ended it. Returns the
    // list of URIs that were stopped (mainly for logging / tests).
    // Meet-invite ticking gate. A requester's meet share sends ONE invite
    // origin tick, then holds; recurring updates are suppressed until the
    // invitee accepts. Tracked as a Set of session ids checked in
    // sendLocationPayload.
    holdMeetShareUntilAccept(sessionId) {
        if (!sessionId) return;
        this._awaitingAcceptSessions = this._awaitingAcceptSessions || new Set();
        this._awaitingAcceptSessions.add(sessionId);
        utils.timestampedLog('[location] meet share holding ticks until accept, session', String(sessionId).slice(0, 8));
    }

    resumeMeetShareOnAccept(sessionId) {
        if (!sessionId || !this._awaitingAcceptSessions) return;
        if (this._awaitingAcceptSessions.delete(sessionId)) {
            utils.timestampedLog('[location] meet accepted — resuming share ticks, session', String(sessionId).slice(0, 8));
            // NOTE: the convergence walker is NOT auto-started here anymore.
            // The invitee accepting only arms the meet (the simulated 5 km
            // start position is still installed on the share entry); the
            // walker begins only when the user presses "Start simulator" from
            // the location menu, which starts every active session at once.
        }
    }

    stopSharesForMeetingSession(sessionId, opts = {}) {
        if (!sessionId) return [];
        const stopped = [];
        // Remote reason propagated from the peer's meeting_end signal
        // (currently: 'proximity'). For 'proximity' we tear down SILENTLY
        // — the caller in app.js (the meeting_end handler)
        // is responsible for emitting the "Location sharing stopped at
        // HH:MM" note, dedeuped against the local-proximity emission via
        // _proximityNotedSessionIds. Emitting here too would double the
        // note on the receiving side whenever both devices fire proximity
        // around the same time.
        const remoteReason = opts.reason;
        const isProximity = remoteReason === 'proximity';
        // DIAGNOSTIC: dump every live timer's meetingSessionId against the
        // target so a "pin still pulsing after meet ended" case shows, in ONE
        // line, whether the peer's meeting_end matched any local share. A
        // mismatch (entry.meetingSessionId !== sessionId, e.g. undefined on a
        // share that should have been tagged, or a different id) means the
        // walk below stops nothing and the entry — and its pulse — survive.
        // Meet legs live in the meet store now.
        const _meetTimers = this._meetStore();
        try {
            const _keys = Object.keys(_meetTimers || {});
            const _dump = _keys.map((u) => {
                const e = _meetTimers[u];
                const _msid = e && e.meetingSessionId;
                return u + '{msid=' + (_msid ? String(_msid).slice(0, 8) : 'none')
                    + (_msid === sessionId ? ' MATCH' : '')
                    + ' kind=' + ((e && e.kind) || '-') + '}';
            });
            utils.timestampedLog('[location] stopSharesForMeetingSession: target session', String(sessionId).slice(0, 8), 'remoteReason=', remoteReason || '(none)', '| timers=', _keys.length, '[', _dump.join(', '), ']');
        } catch (e) { /* diagnostic only */ }
        Object.keys(_meetTimers).forEach((uri) => {
            const entry = _meetTimers[uri];
            if (entry && entry.meetingSessionId === sessionId) {
                utils.timestampedLog('[location] stopSharesForMeetingSession: stopping share with', uri, 'because peer ended meeting session', sessionId, 'remoteReason=', remoteReason || '(none)');
                stopped.push(uri);
                const _stopOpts = {reason: 'peer-stopped', sessionId: entry.originLocationId, meet: true};
                if (isProximity) {
                    // Silent — system note is the app.js side's concern.
                    this.stopLocationSharing(uri, {..._stopOpts, silent: true});
                } else {
                    this.stopLocationSharing(uri, _stopOpts);
                }
            }
        });
        // Summary so the "nothing matched" case is visible (previously it was
        // silent — no log at all when stopped.length === 0).
        utils.timestampedLog('[location] stopSharesForMeetingSession: session', String(sessionId).slice(0, 8), '— stopped', stopped.length, 'share(s)', stopped.length ? JSON.stringify(stopped) : '(none matched — pin may linger)');
        return stopped;
    }

    // Kick off a location-sharing session for `uri` lasting `durationMs`
    // milliseconds. Sends the first location-data message immediately, then one
    // more every 60 seconds until the expiration timestamp is reached.
    //
    // opts.kind       — 'fixed' (plain timed share) or 'meetingRequest' ("Until
    //                   we meet" — origin tick carries meeting_request:true).
    // opts.inReplyTo  — when accepting a peer's meeting request, the original
    //                   request message _id. Every tick carries it so the
    //                   peer's client can merge coords into their request
    //                   bubble instead of rendering a new one.
    // opts.expiresAt  — explicit expiration timestamp (ms). When present,
    //                   overrides `now + durationMs`. Used by the acceptance
    //                   flow so accepter and requester share the same
    //                   expires_at, guaranteeing synchronized cleanup.
    // opts.answersRequestId
    //                 — set when this share is the ANSWER to a peer's
    //                   `location_request` and the user picked an interval
    //                   rather than the one-shot reply (LocationRequestModal).
    //                   Stamped on the ORIGIN tick only, exactly the way
    //                   shareLocationOnce stamps its own reply, so the peer can
    //                   correlate it with the request AND our own sibling
    //                   devices see the replicated origin carbon and close
    //                   their still-open prompt for the same request (see
    //                   app.js _noteSiblingAnsweredLocationRequest). Purely
    //                   correlative: unlike opts.inReplyTo it does NOT mark the
    //                   session as a meet leg (no role='invited').
    async startLocationSharing(uri, durationMs, periodLabel, opts = {}) {
        if (!uri) {
            return;
        }
        // Synchronous re-entry guard. Two failure modes to block:
        //
        //   (a) An active share already exists for this peer. The chat
        //       should never host two concurrent sharing sessions — a
        //       second tap must be a no-op, not a silent replacement and
        //       not a second parallel session.
        //
        //   (b) A previous call to this function is still awaiting its
        //       permission-prompt / alert chain. The permission checks
        //       below are all async; a rapid double-tap on the "Meet up"
        //       button previously let both calls clear the await barrier
        //       before either wrote to outgoingLocationSessions, producing two
        //       origin ticks to the same peer (and two modals on the
        //       accepter side). The in-flight Set catches that race
        //       window synchronously at the top of the function.
        //
        // Both tests run before the first await so JS's single-threaded
        // event loop guarantees the second caller sees the first caller's
        // guard.
        if (!this._startingShares) {
            this._startingShares = new Set();
        }
        // Guard per-STORE, not per-uri: a meet and a plain share can be armed to
        // the same contact at once, so a meet start must not be blocked by a
        // live/in-flight plain share (and vice-versa). The in-flight key and the
        // "already active" check both use the store the requested kind maps to.
        const _guardKind = opts.kind || 'fixed';
        const _startKey = uri + (this._isMeetKind(_guardKind) ? '#meet' : '#plain');
        if (this._startingShares.has(_startKey)) {
            utils.timestampedLog('[location] startLocationSharing: ignoring duplicate — start already in-flight for', uri, _guardKind);
            return;
        }
        const _existingForKind = this._storeForKind(_guardKind)[uri];
        if (_existingForKind) {
            // A session of this KIND already exists for the peer. Normally a
            // no-op — but a meet INVITE that is still HELD awaiting the peer's
            // acceptance is not yet "live" (per product decision), so allow
            // re-sending "Until we meet" to REPLACE the stale pending invite
            // rather than silently doing nothing. Any other case (an accepted
            // meet, or a live plain share of this kind) still blocks.
            const _sid = _existingForKind.meetingSessionId;
            const _isHeldInvite = this._isMeetKind(_guardKind)
                && _sid
                && this._awaitingAcceptSessions
                && this._awaitingAcceptSessions.has(_sid);
            if (!_isHeldInvite) {
                utils.timestampedLog('[location] startLocationSharing: ignoring duplicate — share already active for', uri, _guardKind);
                return;
            }
            // End the stale pending invite locally (reason 'replaced' is in the
            // peer-relay skip set, so no meeting_end is sent — we're about to
            // send a fresh invite) before arming the new one.
            try {
                this._awaitingAcceptSessions.delete(_sid);
                this.stopLocationSharing(uri, {
                    silent: true,
                    reason: 'replaced',
                    sessionId: _existingForKind.originLocationId,
                    meet: true,
                });
            } catch (e) { /* best-effort — fall through and arm the new invite */ }
        }
        this._startingShares.add(_startKey);
      try {
        // Prominent Disclosure (Google Play). Must come BEFORE any
        // permission probe / OS dialog. The user can decline here
        // without anything happening — no permission asked, no
        // location read. After acknowledgement (now or previously)
        // we fall through to the existing permission flow.
        // Resume path skips the disclosure: by definition, this is a
        // share the user already started + acknowledged in a previous
        // session, and the OS-level permission is presumed to still
        // be granted. Re-prompting on every restart would just be
        // noise.
        if (!opts.resumeOriginLocationId) {
            const acknowledged = await this._ensureLocationDisclosureAcknowledged();
            if (!acknowledged) {
                utils.timestampedLog('[location] startLocationSharing: disclosure declined for', uri);
                this._startingShares.delete(_startKey);
                return;
            }
        }
        const kind = opts.kind || 'fixed';
        // The store this session's entry belongs to (meet legs vs plain shares).
        // Captured once so every read/write/closure below — and the tick
        // callbacks that outlive this function — address the right map, letting
        // a meet and a plain share to the same uri coexist without colliding.
        const store = this._storeForKind(kind);
        const _isMeetSession = this._isMeetKind(kind);
        const inReplyTo = opts.inReplyTo || null;
        // Privacy radius — distance in metres. When > 0, every
        // outgoing tick is gated by `_shouldSendUpdateTick` against
        // the first real GPS fix we recorded for this session. The
        // first fix is captured silently (no tick sent) and stored on
        // the timer entry as `originPoint`; thereafter any tick whose
        // haversine distance to that origin point is below the radius
        // is dropped on the floor, so the receiver keeps seeing the
        // "Locating…" placeholder bubble until the user has physically
        // moved past the perimeter. Only honoured for the meeting-
        // handshake kinds (the modal already enforces this client-
        // side, but we re-coerce here in case a future caller forgets).
        // Negative or non-numeric inputs collapse to 0 (off).
        const rawRadius = Number(opts.excludeOriginRadiusMeters);
        const excludeOriginRadiusMeters =
            (kind === 'meetingRequest' || kind === 'meetingAccept')
                && Number.isFinite(rawRadius) && rawRadius > 0
                ? rawRadius
                : 0;
        // Shared meeting destination. For the simulator we may set
        // this lazily (after the first real GPS fix) — initial value
        // is whatever the caller supplied (e.g. an accepter receiving
        // a destination embedded in the meeting_request the requester
        // already broadcast). The value lives on the outgoingLocationSessions
        // entry so any path that emits a tick can stamp it; tickExtras
        // is rebuilt at each send site (see _buildTickExtras below).
        const initialDestination = (opts.destination
                && typeof opts.destination.latitude === 'number'
                && typeof opts.destination.longitude === 'number')
            ? {latitude: opts.destination.latitude, longitude: opts.destination.longitude}
            : null;
        const tickExtras = {
            meetingRequest: kind === 'meetingRequest',
            inReplyTo,
            destination: initialDestination,
            // Correlation id when this share answers a peer's
            // `location_request` with an interval instead of a single fix.
            // Rides the origin tick only (see sendLocationPayload).
            answersRequestId: opts.answersRequestId || null,
        };
        // Shared identifier both sides use to refer to the same "Until we
        // meet" session. For the requester it's the _id of their origin
        // tick (carries meeting_request:true). For the accepter it's the
        // inReplyTo they were started with — which equals the requester's
        // origin _id. That symmetry means either side can emit / receive
        // a `meeting_end` signal carrying this id and the peer can find
        // the matching outgoingLocationSessions entry to tear down. For plain timed
        // shares we leave it null — they don't have a reciprocal share
        // to stop on the peer side.
        // (Computed post-hoc for meetingRequest below, once originLocationId
        // is known.)
        let meetingSessionId = null;
        if (kind === 'meetingAccept' && inReplyTo) {
            meetingSessionId = inReplyTo;
        } else if (kind === 'meetingRequest' && opts.forcedOriginId) {
            // The shared session id IS the meeting request id (forced origin).
            // BOTH legs carry it as sessionId now; `role` tells them apart.
            meetingSessionId = opts.forcedOriginId;
        }

        // === IMMEDIATE USER FEEDBACK (pre-permission) ===
        //
        // The user tapped "Meet up"/"Confirm". Until we know otherwise
        // we treat that as commitment and surface evidence of the tap
        // synchronously, before any await — because the permission
        // chain below, OS prompts, and first-GPS-fix can each add
        // perceptible latency.
        //
        // Two bits of feedback fire here:
        //
        //   1. Optimistic activeLocationShares entry. NavigationBar's
        //      share/pin indicator reads this map; flipping the entry
        //      now makes the icon start pulsing on the same frame as
        //      the tap. If permission is later denied/blocked/cancelled
        //      we roll it back in the finally path (see
        //      rollbackOptimistic() below).
        //
        //   2. Announcement text message ("I want to meet up with you",
        //      etc.). Previously this was sent AFTER the permission
        //      chain — meaning on an unlucky path the user waited 10 s
        //      before their own outgoing invitation appeared in chat.
        //      Sending it now gives the sender immediate proof that
        //      the invitation went out; the bubble (origin tick) can
        //      still take a moment to follow.
        //
        // Computing an interim expiresAt here duplicates the math
        // later at ~line 1250; the later computation overrides this
        // one once we know the share is definitely starting.
        const optimisticNow = Date.now();
        const optimisticExpiresAt = (typeof opts.expiresAt === 'number'
                                     && opts.expiresAt > optimisticNow)
            ? opts.expiresAt
            : optimisticNow + durationMs;
        const hadActiveShareForUri = this.app.state.activeLocationShares[uri] !== undefined;
        if (!hadActiveShareForUri) {
            this.app.setState({
                activeLocationShares: {
                    ...this.app.state.activeLocationShares,
                    [uri]: optimisticExpiresAt,
                },
            });
        }

        // Announcement text — build and ship NOW. Keep the id so we
        // can surgically delete the message if the permission chain
        // ultimately fails and we abandon this share attempt.
        // suppressAnnouncement is used by the resume-on-restart path
        // (_loadAndResumeActiveShares) — the original announcement
        // already landed in the chat the first time the share
        // started, so re-emitting it on resume would just spam the
        // conversation with duplicate "I want to meet up" / "I am
        // sharing for X hours" messages.
        // Start announcement.
        //   • Meet-me handshake (meetingRequest / meetingAccept): a chat
        //     message.
        //   • Plain live share: NO chat-bubble announcement. Instead the start
        //     shows as SYSTEM notes symmetric to the "stopped sharing" notes —
        //     "You started sharing…" on the sender (emitted from
        //     sendLocationPayload on the actual origin tick, so it never fires
        //     for a share that permission ultimately denies) and "<name> started
        //     sharing…" on the receiver (posted when it gets the origin tick).
        let announcementMessageId = null;
        // Meet-me no longer ships a text/plain announcement. The dedicated
        // location push (the origin tick, pushed by the server) now notifies
        // the peer that a meet share started, so the old "I want to meet up
        // with you" / "…too!" text — which double-pushed AND double-counted
        // unread against the location origin — has been removed. Plain fixed
        // live shares keep their text marker; skipped on resume
        // (suppressAnnouncement) so a kill-restart doesn't re-spam the chat.
        if (this.app.sendMessage && !opts.suppressAnnouncement
                && kind === 'fixed') {
            const announcementText = periodLabel
                ? `📍 Sharing my live location for ${periodLabel}`
                : '📍 Sharing my live location';
            announcementMessageId = uuid.v4();
            const textTs = new Date();
            const textMessage = {
                _id: announcementMessageId,
                key: announcementMessageId,
                createdAt: textTs,
                text: announcementText,
                metadata: {locationAnnouncement: true},
                // GiftedChat requires a `user` field on every message.
                user: {},
            };
            //this.app.sendMessage(uri, textMessage);
        }

        // Single place to unwind the optimistic UI state + invitation
        // message if the permission chain denies us. Must be safe to
        // call multiple times — several early-return branches below
        // all funnel through this.
        const rollbackOptimistic = () => {
            if (!hadActiveShareForUri
                && this.app.state.activeLocationShares[uri] !== undefined
                && !this._hasAnyEntryForUri(uri)) {
                const next = {...this.app.state.activeLocationShares};
                delete next[uri];
                this.app.setState({activeLocationShares: next});
            }
            if (announcementMessageId) {
                try {
                    // LOCAL ONLY — the third arg is `remote`, and it is now
                    // `false`. It used to be `true`, which contradicted the
                    // comment above it and meant that merely being DENIED an OS
                    // location permission journaled a removeMessage to the
                    // server. We are undoing a UI message that never should have
                    // shipped; that is a local concern and must not touch the
                    // shared journal or the peer's copy.
                    this.app.deleteMessage(announcementMessageId, uri, false, false,
                        'rollback:permission-denied');
                } catch (e) {
                    console.log('[location] rollback deleteMessage failed', e && e.message ? e.message : e);
                }
                announcementMessageId = null;
            }
        };

        // Upfront capability probe. We want to *tell the user* — before we
        // fire a single tick — whether their current OS-level permission
        // can sustain a background share. The native prompt for 'Always'
        // only appears once in an app's lifetime; after that, iOS silently
        // ignores requestAlwaysAuthorization and the only path back is
        // Settings. So we explicitly branch on the precise state.
        const permState = await this.getLocationPermissionStatus();
        const openSettingsFn = () => {
            try {
                if (Platform.OS === 'ios') {
                    // Deep link straight into Sylk's pane in Settings.app.
                    Linking.openURL('app-settings:');
                } else {
                    try { openSettings(); }
                    catch (e) { Linking.openSettings && Linking.openSettings(); }
                }
            } catch (e) { /* noop */ }
        };

        if (permState === 'blocked') {
            // The user has previously tapped "Don't Allow" (iOS) or "Don't
            // ask again" (Android). Any request() call is a no-op — only
            // Settings can flip this back.
            //
            // Arm the auto-resume FIRST so the optimistic UI (pulsing
            // share icon, "I want to meet up with you" announcement
            // text) can stay in place — it's a more honest UX than
            // tearing it down and forcing a second tap. The drain
            // inside _onAppStateChange will resume the share once the
            // app foregrounds with sufficient permission. Don't re-arm
            // when this run IS the resume — would loop.
            if (!opts._resumedAfterPermission) {
                this._armPermissionRetry(uri, durationMs, periodLabel, opts);
            } else {
                // Resume run found permission still blocked — give up
                // and roll back so the user isn't stuck with phantom UI.
                rollbackOptimistic();
            }
            Alert.alert(
                'Location access blocked',
                Platform.OS === 'ios'
                    ? "Blink can't access your location.\n\nOpen Settings → Blink → Location and choose 'Always'. The share will start automatically once you do."
                    : "Blink can't access your location.\n\nOpen Settings → Permissions → Location and choose 'Allow all the time'. The share will start automatically once you do.",
                [
                    {
                        text: 'Cancel',
                        style: 'cancel',
                        onPress: () => {
                            // User explicitly chose to NOT proceed —
                            // drop the parked intent and roll the
                            // optimistic UI back so the chat doesn't
                            // sit there pretending a share is starting.
                            this._cancelPendingPermissionShare(uri, rollbackOptimistic);
                        },
                    },
                    {text: 'Open Settings', onPress: openSettingsFn},
                ],
                {cancelable: true}
            );
            return;
        }

        if (permState === 'unavailable') {
            rollbackOptimistic();
            showThemedAlert(
                'Location unavailable',
                'Location services are not available on this device.',
                [{text: 'OK', style: 'cancel'}]
            );
            return;
        }

        if (Platform.OS === 'ios' && permState === 'whenInUse') {
            // User granted "While Using" but not "Always". Foreground
            // sharing works; the share WILL stop the moment the user
            // swipes Blink into the background. Be explicit about the
            // consequence and offer a one-tap path to upgrade.
            //
            // Three buttons map to three outcomes:
            //   • Cancel        — user changed their mind, abort.
            //   • Start anyway  — keep "While Using", continue, share
            //                     pauses on bg. No retry needed.
            //   • Open Settings — user wants to upgrade to Always; we
            //                     park the intent and auto-resume on
            //                     foreground after they grant.
            const proceed = await new Promise((resolve) => {
                Alert.alert(
                    "Background sharing needs 'Always'",
                    "Blink has 'While Using' location access. The share will pause when you move Blink to the background.\n\nOpen Settings → Blink → Location and pick 'Always' — the share will start automatically once you do.",
                    [
                        {text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel')},
                        {text: 'Start anyway', onPress: () => resolve('start')},
                        {text: 'Open Settings', onPress: () => { openSettingsFn(); resolve('settings'); }},
                    ],
                    {cancelable: true, onDismiss: () => resolve('cancel')}
                );
            });
            if (proceed === 'settings') {
                // Park the intent and exit. The auto-resume drain will
                // re-run startLocationSharing once permission upgrades
                // to 'always' and the app foregrounds.
                if (!opts._resumedAfterPermission) {
                    this._armPermissionRetry(uri, durationMs, periodLabel, opts);
                } else {
                    rollbackOptimistic();
                }
                return;
            }
            if (proceed !== 'start') {
                rollbackOptimistic();
                return;
            }
            // Fall through to the normal start path — ensureLocationPermission
            // below will re-confirm the OS-level permission and start ticks.
        }

        if (Platform.OS === 'android' && permState === 'foregroundOnly') {
            // Android analogue of iOS 'whenInUse': fine location is granted
            // but ACCESS_BACKGROUND_LOCATION is not. Our foreground service
            // keeps the process alive, but API 30+ still won't deliver
            // location callbacks if the background-location permission is
            // missing. Make the user aware and offer the Settings deep-link
            // (API 30+ has no runtime dialog for this — Settings is the
            // only path).
            //
            // Same three-way outcome as the iOS whenInUse branch above —
            // see that block's comment for the auto-resume rationale.
            const proceed = await new Promise((resolve) => {
                Alert.alert(
                    'Background sharing needs "Allow all the time"',
                    'Blink has location access only while the app is in use. Your share will pause when you switch away from Blink.\n\nOpen Settings → Permissions → Location and pick "Allow all the time" — the share will start automatically once you do.',
                    [
                        {text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel')},
                        {text: 'Start anyway', onPress: () => resolve('start')},
                        {text: 'Open Settings', onPress: () => { openSettingsFn(); resolve('settings'); }},
                    ],
                    {cancelable: true, onDismiss: () => resolve('cancel')}
                );
            });
            if (proceed === 'settings') {
                if (!opts._resumedAfterPermission) {
                    this._armPermissionRetry(uri, durationMs, periodLabel, opts);
                } else {
                    rollbackOptimistic();
                }
                return;
            }
            if (proceed !== 'start') {
                rollbackOptimistic();
                return;
            }
        }

        // Fast-path around ensureLocationPermission when we already know
        // from the upfront probe that the OS-level permission is granted.
        //
        // Why this matters: on iOS, Geolocation.requestAuthorization()
        // only fires its success callback via CLLocationManagerDelegate's
        // didChangeAuthorization — and that delegate ONLY fires on actual
        // authorization *changes*. If the user has already granted Always
        // (or WhenInUse), calling requestAuthorization is a no-op at the
        // CoreLocation layer: no change → no delegate callback → the
        // Promise wrapping it in ensureLocationPermission sits unresolved
        // until its 10 000 ms `setTimeout(settle(true), 10000)` safety
        // net fires. That ten-second stall is exactly the delay users
        // see between tapping "Meet up"/"Confirm" and their placeholder
        // bubble rendering — nothing after this await runs, including
        // the origin tick that draws the bubble on both sides.
        //
        // We still need setConfiguration to run (it flips the library's
        // authorizationLevel and enables background updates), but that
        // call is synchronous, so we do it inline here and skip the
        // hanging requestAuthorization.
        let hasPermission;
        const iosAlreadyGranted = Platform.OS === 'ios'
            && (permState === 'always' || permState === 'whenInUse');
        const androidAlreadyGranted = Platform.OS === 'android'
            && (permState === 'always' || permState === 'foregroundOnly');
        if (iosAlreadyGranted) {
            try {
                if (Geolocation && typeof Geolocation.setConfiguration === 'function') {
                    Geolocation.setConfiguration({
                        authorizationLevel: 'always',
                        enableBackgroundLocationUpdates: true,
                    });
                }
            } catch (e) { /* noop */ }
            hasPermission = true;
        } else if (androidAlreadyGranted) {
            // On Android PermissionsAndroid.request() for an already-granted
            // permission resolves quickly, but there's no need to incur the
            // round-trip at all — skip straight to tick emission.
            hasPermission = true;
        } else {
            hasPermission = await this.ensureLocationPermission();
        }
        if (!hasPermission) {
            console.log('Location permission denied; cannot share location');
            // Park the intent rather than tearing down the optimistic
            // UI immediately — the user has already tapped Accept /
            // Meet up / Confirm once and re-prompting them after
            // they grant the permission in Settings is a UX failure.
            // _drainPendingPermissionShares will pick this up the
            // next time the app foregrounds with sufficient permission.
            // Skip arming during a resume run (would loop) and roll
            // back instead so the phantom UI doesn't persist.
            if (!opts._resumedAfterPermission) {
                this._armPermissionRetry(uri, durationMs, periodLabel, opts);
            } else {
                rollbackOptimistic();
            }
            Alert.alert(
                'Location permission required',
                Platform.OS === 'ios'
                    ? "Open Settings → Blink → Location to allow location access. Pick 'Always' for background sharing — the share will start automatically once you do."
                    : "Blink needs location access to share your live location.\n\nOpen Settings → Permissions → Location and choose 'Allow all the time' — the share will start automatically once you do.",
                [
                    {
                        text: 'Cancel',
                        style: 'cancel',
                        onPress: () => {
                            // User explicitly aborted — drop the parked
                            // intent and unwind the optimistic UI.
                            this._cancelPendingPermissionShare(uri, rollbackOptimistic);
                        },
                    },
                    {text: 'Open Settings', onPress: openSettingsFn},
                ],
                {cancelable: true}
            );
            return;
        }

        // Re-read the OS permission AFTER the grant round-trip: the probe at
        // the top of this function ran BEFORE any prompt, so on a first-ever
        // share it read 'undetermined' / 'foregroundOnly' while the user has
        // since granted more. This is the value the origin tick stamps, so it
        // must reflect what we actually hold now. Cheap (a couple of native
        // check() calls, never a prompt); falls back to the pre-prompt state.
        try {
            tickExtras.permState = await this.getLocationPermissionStatus();
        } catch (e) {
            tickExtras.permState = permState;
        }
        utils.timestampedLog('[location] share start for', uri, 'kind=' + (kind || 'fixed'),
            'os permission=' + (tickExtras.permState || '(unknown)'),
            '(pre-prompt probe was ' + (permState || '(unknown)') + ')');

        const now = Date.now();
        // Acceptance mode inherits expires_at from the original request so
        // both devices tear down in sync. Otherwise compute from duration.
        const expiresAt = (typeof opts.expiresAt === 'number' && opts.expiresAt > now)
            ? opts.expiresAt
            : now + durationMs;
        // durationMs was the caller's request, but once expiresAt is clamped
        // the effective duration is what timers below use.
        const effectiveDurationMs = Math.max(0, expiresAt - now);
        const expiresIso = new Date(expiresAt).toISOString();

        // If there's already an active share for this uri, replace it with
        // the new one (new duration supersedes the old one). Silent because
        // we're about to emit a fresh "started sharing" note below. Skip
        // this entirely when the pre-permission re-entry guard noticed no
        // existing share (hadActiveShareForUri === false) — the
        // stopLocationSharing() call is a no-op in that case but also
        // happens to race with the optimistic activeLocationShares entry
        // we set above, so we don't want to even think about touching
        // state we're mid-way through populating.
        //
        // Auto-resume case: when this run was kicked by
        // _drainPendingPermissionShares, hadActiveShareForUri is true
        // (the optimistic activeLocationShares entry from the original
        // call is still in place — we never rolled it back) but
        // outgoingLocationSessions[uri] is empty (no real share was ever started).
        // Calling stopLocationSharing here would tear down the optimistic
        // UI we explicitly preserved across the permission round-trip,
        // including its "I want to meet up" announcement and the pulsing
        // share icon. Require a REAL active share (outgoingLocationSessions entry)
        // before triggering replacement.
        if (hadActiveShareForUri && store[uri]) {
            this.stopLocationSharing(uri, {silent: true, reason: 'replaced', sessionId: store[uri].originLocationId, meet: _isMeetSession});
        }

        // The invitation announcement is emitted at the top of this function
        // (pre-permission block) so it shows in the chat the moment the user
        // taps Confirm, not after the permission / OS-prompt round-trip. See
        // rollbackOptimistic() above for how we undo it if permission is
        // ultimately denied.

        // Origin tick — the first location-data message carrying coordinates
        // + expiration. Its _id becomes the anchor every subsequent
        // tick points back to. For "Until we meet" the origin tick
        // carries meeting_request:true; for acceptance every tick
        // carries in_reply_to pointing at the original request.
        //
        // We DON'T send a placeholder up-front. Earlier we shipped a
        // null-coords "Locating…" tick synchronously to give the user
        // immediate feedback; that produced a wire / SQL row with no
        // useful data, and on chat reload the bubble fell back to
        // "Locating…" with no map. The wait-for-first-fix path is
        // backed instead by the memory-only "📍 Location will be shared
        // as soon as it is acquired…" system message (see
        // shareLocationOnce / kicker callers) so the sender still sees
        // immediate feedback. The first valid-coords send (initial
        // getCurrentCoordinates() resolve OR first watchPosition /
        // setInterval fire — whichever wins) becomes the origin via
        // the atomic origin-promotion check inside sendLocationPayload.
        //
        // Resume path: we already know the saved origin id from a
        // previous run. Reuse it so subsequent ticks UPDATE the
        // existing bubble instead of spawning a fresh one.
        let originLocationId = null;
        if (opts.resumeOriginLocationId) {
            originLocationId = opts.resumeOriginLocationId;
        }

        // Kick off the initial fix in the background. When it lands we emit
        // a tick that the atomic origin-promotion in sendLocationPayload
        // routes correctly: as the origin if no origin has been recorded yet
        // (fresh share), or as an update if a watchPosition fire already
        // claimed the origin slot, or an explicit update on the resume path.
        // We don't await this — startLocationSharing's watch / interval arming
        // below must run synchronously so the tear-down path (timers, session
        // state) is consistent regardless of how long the first fix takes.
        //
        // Reuse the preview fix when possible: the share modal just fetched
        // the user's location for its map (_fetchPreviewLocation), so on a
        // quick Confirm we already have a fresh fix in hand. Sending the
        // origin tick from it makes the first bubble appear immediately
        // instead of waiting on a second GPS acquire. If that fix is missing
        // or older than 60 s we fall back to a live getCurrentCoordinates()
        // (whose latency the modal's Share-button spinner now covers). Skip
        // the reuse on the resume path — that must re-read real GPS, not a
        // stale preview from before the restart.
        {
            // opts.originOverride — hand-corrected origin from the share
            // picker's crosshair. Outranks both the preview fix and a live
            // acquire for THIS tick: the user looked at the fix we would
            // otherwise send and told us it was wrong. Never on the resume
            // path — a resume must re-read real GPS, and there is no live
            // picker behind it to have corrected anything.
            //
            // Only the origin. The watch / interval armed below keeps
            // reporting real GPS, so the correction does not leak into the
            // rest of the session.
            const _originOverride = opts.resumeOriginLocationId
                ? null
                : (opts.originOverride || null);
            const _freshPreview = (opts.resumeOriginLocationId || _originOverride)
                ? null
                : this._freshPreviewFix();
            const _initialFix = _originOverride
                ? Promise.resolve({
                    latitude: _originOverride.latitude,
                    longitude: _originOverride.longitude,
                    // No `accuracy`: see shareLocationOnce for why a
                    // hand-placed point must not inherit the GPS fix's
                    // precision claim.
                    timestamp: Date.now(),
                })
                : (_freshPreview
                    ? Promise.resolve(_freshPreview)
                    : this.getCurrentCoordinates());
            if (_originOverride) {
                utils.timestampedLog('[location] initial fix: using hand-adjusted origin for', uri,
                    '—', _originOverride.latitude.toFixed(6) + ',' + _originOverride.longitude.toFixed(6));
            }
            if (_freshPreview) {
                utils.timestampedLog('[location] initial fix: reusing fresh preview location for', uri, '(age', (typeof _freshPreview.timestamp === 'number' ? Math.round((Date.now() - _freshPreview.timestamp) / 1000) + 's' : 'n/a'), ')');
            }
            _initialFix.then(async (coords) => {
                // Session may have been stopped between placeholder send
                // and GPS resolve (user hit Stop, or meeting handshake
                // tore it down). Nothing to update in that case — the
                // placeholder bubble was already removed or is about to
                // be, and sending an update tick would re-inject it.
                if (!store[uri]) {
                    return;
                }
                // DEBUG: meet-up convergence simulator. The requester
                // picks the destination (4 km random offset) lazily
                // on the first real GPS fix; the accepter has a
                // *synthetic starting position* installed (real GPS
                // + 10 km random offset) so the two phones aren't
                // sitting on top of each other when the meet starts.
                // Both candidates are validated against Nominatim so
                // we don't randomly pick a point in the middle of a
                // sea / ocean / lake / river — re-rolling the bearing
                // up to 5 times if we land in water. Both fields
                // ride on tickExtras / entry from this point onward
                // and every emission path reads through them.
                if (this.app._locationSimulatorEnabled
                        && kind === 'meetingRequest'
                        && !tickExtras.destination) {
                    // NEW meet-sim model: our real current GPS IS the destination
                    // (the meet point). Our own simulated START is a random point
                    // ~5 km from it (on land) — that's what our pin and the invite
                    // broadcast; the walker arcs it back to the real location when
                    // the sim runs. (Was: destination invented ~4 km away with the
                    // start left on real GPS.) Only the start point + destination
                    // change here; the rest of the convergence logic is unchanged.
                    tickExtras.destination = {
                        latitude: coords.latitude,
                        longitude: coords.longitude,
                    };
                    const start = await pickMeetingDestinationKmOnLand(coords, 5);
                    const entryReq = store[uri];
                    if (entryReq) {
                        if (start && !entryReq.simulatedPosition) {
                            entryReq.simulatedPosition = {
                                latitude: start.latitude,
                                longitude: start.longitude,
                                accuracy: 5,
                                timestamp: Date.now(),
                            };
                        }
                        // Drop the fence so the (now 5 km) origin/invite tick ships.
                        entryReq.awaitingSimulatedPosition = false;
                    }
                    try {
                        const utils = require('../utils');
                        utils.timestampedLog(`[sim] inviter: destination = current GPS ${coords.latitude.toFixed(5)},${coords.longitude.toFixed(5)}` + (start ? ` — start ~5 km away at ${start.latitude.toFixed(5)},${start.longitude.toFixed(5)} (on land)` : ' — 5 km start pick failed, using real GPS as start'));
                    } catch (e) { /* noop */ }
                }
                // Accepter side, simulation mode: replace real GPS
                // with a synthetic position 10 km away from where we
                // actually are, so we have visible distance to the
                // destination even when both phones are sitting on
                // the same desk. Stored on entry.simulatedPosition;
                // every other tick path consults it via
                // _effectiveCoordinatesForSession.
                const entryNow = store[uri];
                if (this.app._locationSimulatorEnabled
                        && kind === 'meetingAccept'
                        && entryNow
                        && !entryNow.simulatedPosition) {
                    // NEW meet-sim model: start a random point ~3 km from the
                    // DESTINATION (the shared meet point carried on the invite),
                    // not ~10 km from our own GPS — so both sides converge on the
                    // same point from their respective offsets (sender 5 km,
                    // receiver 3 km). Anchor on the destination when known; fall
                    // back to real GPS only if the destination hasn't arrived yet.
                    const _accAnchor = (entryNow.tickExtras
                            && entryNow.tickExtras.destination
                            && typeof entryNow.tickExtras.destination.latitude === 'number'
                            && typeof entryNow.tickExtras.destination.longitude === 'number')
                        ? entryNow.tickExtras.destination
                        : (tickExtras && tickExtras.destination
                            && typeof tickExtras.destination.latitude === 'number'
                            && typeof tickExtras.destination.longitude === 'number'
                            ? tickExtras.destination : coords);
                    const synthetic = await pickMeetingDestinationKmOnLand(_accAnchor, 3);
                    if (synthetic) {
                        // Re-fetch entry — the await opened a window
                        // for the share to be torn down underneath us.
                        const entryAfter = store[uri];
                        if (entryAfter && !entryAfter.simulatedPosition) {
                            entryAfter.simulatedPosition = {
                                latitude: synthetic.latitude,
                                longitude: synthetic.longitude,
                                accuracy: 5,
                                timestamp: Date.now(),
                            };
                            // Drop the race fence — subsequent
                            // watchPosition / interval fires will
                            // pick up the synthetic position via
                            // _effectiveCoordinatesForSession.
                            entryAfter.awaitingSimulatedPosition = false;
                            try {
                                const utils = require('../utils');
                                const u = `https://maps.google.com/?q=${synthetic.latitude.toFixed(5)},${synthetic.longitude.toFixed(5)}`;
                                utils.timestampedLog(`[sim] accepter synthetic position armed for ${uri} → ${synthetic.latitude.toFixed(5)},${synthetic.longitude.toFixed(5)} (${u}) — ~3 km from destination, on land`);
                            } catch (e) { /* noop */ }
                            // NOTE: the convergence walker is NOT auto-started
                            // here anymore. Accepting only arms the simulated
                            // start position (~3 km from the destination); the
                            // walker begins only when the user presses "Start
                            // simulator" from the location menu, which starts
                            // every active session at once.
                        }
                    } else {
                        // Pick failed entirely (rare — _pickMeeting…
                        // OnLand falls back to a plain pick on
                        // exhausted retries). Drop the fence anyway
                        // so the share can keep running on real GPS;
                        // staying gated forever would be worse than
                        // a degraded test setup.
                        const entryAfter = store[uri];
                        if (entryAfter) {
                            entryAfter.awaitingSimulatedPosition = false;
                        }
                    }
                }
                // Re-check the timer entry — both awaits above could
                // have spanned a tear-down window.
                if (!store[uri]) {
                    return;
                }
                // From here on, the first update tick reports the
                // synthetic position when simulation is in play.
                // Otherwise it reports the real GPS fix as before.
                const effective = this.sim.effectiveCoordinatesForSession(uri, coords);
                // Privacy-radius gate. _shouldSendUpdateTick captures
                // the originPoint baseline as a side-effect on the
                // first valid coord, then returns false until the user
                // has moved past the perimeter.
                if (!this._shouldSendUpdateTick(uri, effective, store[uri])) {
                    // Meeting-request shares need to bootstrap the
                    // handshake even while the inviter's position is
                    // hidden. Ship a "privacy-deferred" origin tick:
                    // value coords are the destination (the only point
                    // we're willing to disclose) but stamped with
                    // privacyDeferred:true so neither end renders the
                    // inviter pin. The peer renders a map showing only
                    // the destination + meeting_request signal +
                    // Accept modal. The inviter's actual position
                    // stays private until they cross the perimeter,
                    // at which point a real coord update flows and
                    // the bubble adds the inviter pin to both ends.
                    const liveEntryRef0 = store[uri];
                    const dest = tickExtras && tickExtras.destination;
                    const _hasDest = !!(dest
                            && typeof dest.latitude === 'number'
                            && typeof dest.longitude === 'number');
                    // Both sides of the meet handshake can opt into a
                    // privacy radius — the inviter (kind=meetingRequest)
                    // hides their starting position with the slider in
                    // ShareLocationModal, the accepter (kind=meetingAccept)
                    // hides theirs via the same slider in
                    // MeetingRequestModal. Either side, when inside its
                    // own privacy radius at share start, ships ONE
                    // privacy-deferred tick so the peer can render the
                    // bubble + Accept modal (inviter side) or so the
                    // inviter knows the meeting is on (accepter side)
                    // without disclosing the deferred party's actual
                    // position. Real coords flow once the user crosses
                    // their own perimeter.
                    //
                    // The destination is no longer required for the INVITER.
                    // When the inviter sets a privacy radius but picks no
                    // meeting point (the common "Meet up" case — the modal
                    // never collects a destination), we still ship a
                    // bootstrap tick so the receiver's accept modal appears.
                    // With a destination it ships as the value stand-in
                    // (existing behaviour); without one we ship a DUMMY
                    // stand-in: a throwaway point a few km from the
                    // inviter's real position (see _dummyOriginPoint below),
                    // flagged dummy:true so neither end renders a pin for
                    // it. The dummy's whole purpose is to give the origin
                    // bubble VALID coords so it persists in SQL on both
                    // devices — which keeps the origin/update chain intact,
                    // so the moment the inviter crosses the perimeter their
                    // first REAL tick overwrites the dummy in place and the
                    // live position renders (the rendezvous converges).
                    //
                    // The ACCEPTER path is deliberately UNCHANGED: it still
                    // requires a destination to fire here, exactly as before,
                    // so this fix touches only the inviter's no-destination
                    // case (the reported bug).
                    if ((kind === 'meetingRequest'
                                || (kind === 'meetingAccept' && _hasDest))
                            && liveEntryRef0
                            && !liveEntryRef0.privacyDeferredOriginSent) {
                        liveEntryRef0.privacyDeferredOriginSent = true;
                        liveEntryRef0.privacyDeferred = true;
                        // Resume guard for the DUMMY case. On an app-restart
                        // / resume the origin bubble already exists on both
                        // devices — carrying either the original dummy or, if
                        // the inviter had already crossed their perimeter, a
                        // real position — and its id is restored here via
                        // opts.resumeOriginLocationId. Minting + sending a
                        // FRESH dummy now would be doubly wrong: it would
                        // jitter the empty map to a new random spot on every
                        // restart, and it could overwrite a real position that
                        // was already revealed before the restart. So for the
                        // dummy case we skip the (re)send on resume entirely
                        // and let the restored origin stand. The localOwner-
                        // Coords stamp below still runs (so the inviter keeps
                        // seeing their own pin), and real ticks resume in place
                        // the moment they're past the perimeter. The
                        // destination case is deterministic, so it keeps its
                        // existing resume behaviour.
                        const _skipDummyOnResume = !_hasDest
                            && !!opts.resumeOriginLocationId;
                        // Stand-in coords for the origin bubble. Real
                        // destination if the share has one; otherwise a
                        // dummy point ~4–7 km from the inviter's actual
                        // position at a random bearing. The offset is large
                        // enough that the dummy never doubles as a usable
                        // approximation of where the inviter is, and the
                        // dummy:true flag means it's never rendered or
                        // paired as a real position anyway. Not generated at
                        // all when we're skipping the send on resume.
                        const _standIn = _hasDest
                            ? {latitude: dest.latitude, longitude: dest.longitude}
                            : (_skipDummyOnResume ? null : dummyOriginPoint(effective));
                        let _deferredMid = null;
                        try {
                            if (_skipDummyOnResume) {
                                utils.timestampedLog('[location] privacy invite: skipping dummy origin re-send on resume —', uri, 'origin=', originLocationId);
                            } else {
                                // sendLocationPayload stamps
                                // metadata.privacyDeferred + the radius
                                // (read from the timer entry's
                                // excludeOriginRadiusMeters) — no
                                // separate system note here. The
                                // "Move <radius> from here…" hint is
                                // rendered as a bottom strip overlay on
                                // the map bubble itself (LocationBubble's
                                // privacy-deferred branch), keeping the
                                // chat timeline clean.
                                _deferredMid = this.sendLocationPayload(
                                    uri,
                                    _standIn,
                                    expiresIso,
                                    originLocationId,
                                    {...tickExtras, privacyDeferred: true, dummy: !_hasDest},
                                    _isMeetSession
                                );
                            }
                        } catch (e) {
                            console.log('[location] privacy-deferred origin send failed', e && e.message ? e.message : e);
                        }
                        // Stamp the inviter's REAL coords as a
                        // local-only field on the just-injected
                        // bubble's location data. The wire payload above
                        // shipped the destination as `value` (so the
                        // peer can't see where the inviter is), but
                        // on the inviter's OWN device we want the
                        // bubble to show their actual position +
                        // privacy circle + distance to destination.
                        // The localOwnerCoords field stays on the
                        // device — never re-serialised, never sent.
                        // Save it on the entry too so subsequent
                        // throttled GPS fixes (still inside the
                        // privacy radius) can refresh it.
                        // Pick the bubble id that the local user's
                        // privacy-deferred coords should attach to:
                        //   • REQUESTER (kind=meetingRequest): the
                        //     ORIGIN tick's mId — that's this
                        //     device's outgoing meeting bubble.
                        //     Prefer entry.originLocationId because
                        //     sendLocationPayload may have just
                        //     promoted the new mid to origin (fresh
                        //     share) OR may have routed the tick as
                        //     an UPDATE pointing at a previously
                        //     promoted origin (resumed share — auto-
                        //     resume after Metro reload sets
                        //     originLocationId on the entry from the
                        //     persisted snapshot, so the deferred
                        //     send becomes an "update" tick whose
                        //     own mId is NOT the bubble id). Only
                        //     fall back to _deferredMid if the entry
                        //     somehow doesn't have an origin id yet.
                        //   • ACCEPTER (kind=meetingAccept): the
                        //     INVITATION's id (= tickExtras.inReplyTo).
                        //     The accepter's reply tick gets suppressed
                        //     from creating its own bubble (the
                        //     in_reply_to dedup in _injectLocationBubble),
                        //     so all rendering happens on the incoming
                        //     request bubble whose _id IS the request
                        //     id.
                        const _isAccepter = (kind === 'meetingAccept');
                        const _midForStamp = _isAccepter
                            ? (tickExtras && tickExtras.inReplyTo)
                            : ((liveEntryRef0 && liveEntryRef0.originLocationId)
                                || _deferredMid);
                        const _radiusForStamp = Number(liveEntryRef0.excludeOriginRadiusMeters) || 0;
                        utils.timestampedLog('[location] privacy-deferred origin: stamping localOwnerCoords', 'kind=', kind, 'mid=', _midForStamp, 'radius=', _radiusForStamp, 'effective=', effective ? `${effective.latitude},${effective.longitude}` : 'null', 'callbackType=', typeof this.app._setLocalOwnerCoordsForBubble);
                        if (_midForStamp) {
                            // Run twice — once immediately, once after a
                            // tick — because the bubble injection runs in
                            // a microtask after sendMessage. setState is
                            // idempotent so the
                            // second write is cheap when the first
                            // already succeeded.
                            this.app._setLocalOwnerCoordsForBubble(
                                uri, _midForStamp, effective, _radiusForStamp
                            );
                            setTimeout(() => {
                                this.app._setLocalOwnerCoordsForBubble(
                                    uri, _midForStamp, effective, _radiusForStamp
                                );
                            }, 250);
                        }
                        liveEntryRef0.privacyDeferredBubbleMid = _midForStamp;
                    }
                    return;
                }
                // First non-deferred tick: clear the privacyDeferred
                // marker on the entry. Subsequent ticks (and the
                // wire) will now carry the inviter's real coords.
                const liveEntryRef = store[uri];
                if (liveEntryRef && liveEntryRef.privacyDeferred) {
                    liveEntryRef.privacyDeferred = false;
                }
                // Heartbeat the very first tick too. The 60 s
                // watchPosition / interval paths each have their own
                // tickAttempts increment + log, but the initial
                // getCurrentCoordinates().then() bypasses both — without
                // this bump, attempt counters start at 0 for the first
                // minute even though a tick is going out. Bump here so
                // the user sees "attempt=1" in the log line that pairs
                // with the bubble's "↻ 1" counter the moment the share
                // starts.
                const _initEntry = store[uri];
                if (_initEntry) {
                    _initEntry.tickAttempts = (_initEntry.tickAttempts || 0) + 1;
                    try {
                        // utils.timestampedLog(`[location] heartbeat → ${uri} attempt=${_initEntry.tickAttempts} kind=${_initEntry.kind || 'fixed'} (initial fix)`);
                    } catch (e) { /* noop */ }
                }
                this.sendLocationPayload(
                    uri, effective, expiresIso, originLocationId, tickExtras, _isMeetSession
                );
            }).catch((err) => {
                utils.timestampedLog('[location] initial getCurrentCoordinates failed', err && err.message ? err.message : err);
            }).then(() => {
                // Initial-fix completion signal. Runs after the first
                // getCurrentCoordinates() settles AND the origin tick has
                // been dispatched (success branch) or the fix has failed
                // (catch branch) — the `.then` after `.catch` fires either
                // way, exactly once. onShareLocationConfirmed passes this so
                // ShareLocationModal can hold its Share-button spinner until
                // there's real feedback, instead of closing the instant the
                // user taps and leaving them unsure the share started.
                // Non-modal callers (resume, meeting-accept, one-shot) don't
                // pass it, so the guard makes it a safe no-op there.
                if (typeof opts.onInitialShareResult === 'function') {
                    try { opts.onInitialShareResult(); }
                    catch (e) { /* best-effort feedback hook */ }
                }
            });
        }

        // For the requester side the session id is the origin tick's _id
        // (the same id the accepter will echo back in in_reply_to).
        if (kind === 'meetingRequest' && originLocationId) {
            meetingSessionId = originLocationId;
        }

        if (Platform.OS === 'ios') {
            // iOS background path: CADisplayLink-driven JS timers (setInterval,
            // BackgroundTimer.setInterval) pause the moment the app is
            // suspended — they are **not** real wall-clock timers in
            // background. The only reliable way to keep emitting ticks while
            // the app is in background is to ride CLLocationManager's own
            // streaming callbacks. When UIBackgroundModes contains "location"
            // and we've enabled allowsBackgroundLocationUpdates (done in
            // ensureLocationPermission), watchPosition → startUpdatingLocation
            // keeps firing the success callback while we're backgrounded.
            //
            // We still throttle to LOCATION_REPEAT_MS in JS so we don't flood
            // the channel; CLLocationManager will fire the callback much more
            // often than once a minute even with a sane distanceFilter.
            const entry = {
                watchId: null,
                expiryTimeoutId: null,
                expiresAt,
                originLocationId,
                // Remember the request _id we're replying to (if any) so
                // an incoming "remove message" for that _id can surgically
                // cancel just this share via stopSharesRepliesTo().
                inReplyTo,
                // Shared "Until we meet" session id (requester's origin _id).
                // Used by stopLocationSharing to signal the peer, and by
                // stopSharesForMeetingSession to react to the peer's signal.
                meetingSessionId,
                // Last wall-clock ms we actually emitted a tick. Seeded with
                // 0 so the very first watchPosition callback passes the
                // LOCATION_REPEAT_MS throttle and emits a real-coords update
                // immediately. The origin tick we just sent carried
                // placeholder coords (see placeholderCoords above) — the
                // receiver's bubble is stuck on "Locating…" until we ship
                // one with real lat/lng, so we want that to happen at the
                // first opportunity, not 60 s from now.
                lastSentMs: 0,
                // Privacy-radius state. `excludeOriginRadiusMeters` is
                // fixed at session start (from the modal slider — 0
                // means disabled, 500 / 2000 are the user-visible
                // stops); `originPoint` is captured on the first valid
                // GPS fix by _shouldSendUpdateTick; `originRadiusCleared`
                // flips exactly once when the user crosses the
                // perimeter so the "now sharing" log fires once instead
                // of on every subsequent tick.
                excludeOriginRadiusMeters,
                originPoint: null,
                originRadiusCleared: false,
                // Reference to the same tickExtras object the iOS
                // watchPosition closure captured. Mutating
                // entry.tickExtras.destination here flows through to
                // every subsequent tick automatically — used by the
                // simulator to publish a destination after the first
                // real GPS fix without re-arming the watch.
                tickExtras,
                // Race fence (debug): when the accepter's share
                // starts in simulation mode the synthetic 10 km
                // position is set up asynchronously inside the first
                // getCurrentCoordinates().then() callback (because it
                // awaits Nominatim land-checks). The iOS watchPosition
                // callback below — and the equivalent Android
                // interval — can fire before that async work
                // completes; without a fence they'd ship a real-GPS
                // tick first, the receiver pairs both phones at ~1 m,
                // and proximity-met fires erroneously. Setting this
                // flag synchronously here gates every tick path until
                // the async setup clears it. Set only when we
                // actually need it; production builds with
                // ENABLE_MEET_SIMULATION=false leave it false and
                // skip the gate entirely.
                // Gate early ticks until the async simulated start is armed.
                // Accepter: always (it arms a 3 km-from-destination start).
                // Inviter: only when NO destination was pre-chosen — that's the
                // case where we now arm a 5 km-from-GPS start asynchronously and
                // must not ship a real-GPS origin/invite before it lands. With a
                // pre-chosen destination the inviter keeps its old real-GPS start
                // and needs no fence (and the seed block wouldn't drop it).
                awaitingSimulatedPosition:
                    this.app._locationSimulatorEnabled
                    && (kind === 'meetingAccept'
                        || (kind === 'meetingRequest' && !initialDestination)),
                // Persisted to AsyncStorage on every mutation so a
                // killed app can re-arm this entry on next boot —
                // see _persistActiveShares / _loadAndResumeActiveShares.
                // periodLabel is only used at restart-time to pass
                // through to the resumed startLocationSharing call;
                // we don't ship a fresh announcement message on resume.
                kind,
                periodLabel,
                // Forced origin id for the post-accept requester meet share:
                // makes this session's ORIGIN tick reuse the meeting request
                // id so the accepter's in_reply_to = request_id ticks merge
                // into one session. null = normal freshly-generated origin.
                forcedOriginId: opts.forcedOriginId || null,
                // "Until I return" state machine — see
                // _evaluateUntilReturnGate. On a fresh start both
                // fields are reset (origin captured by the first
                // valid tick; departed flips when the user moves
                // beyond the threshold). On a kill-restart resume
                // we restore whatever was persisted so the gate
                // doesn't lose its "I've already left" memory.
                untilReturnOrigin: opts.resumeUntilReturnOrigin || null,
                untilReturnDeparted: !!opts.resumeUntilReturnDeparted,
                // Carry over the persisted paused state so a kill-
                // restart or AsyncStorage-resume of a paused share
                // doesn't silently start emitting ticks again. Set
                // BEFORE the initial tick is dispatched below so the
                // pause-gate at the top of sendLocationUpdate
                // (around line 1505) catches and swallows it. Default
                // false for fresh shares.
                paused: !!opts.resumePaused,
            };
            store[uri] = entry;
            this.app._persistActiveShares();
            try { this.app._onLocationSessionsChanged('ADD', 'outgoing', uri, `type=${this._isMeetKind(entry.kind) ? 'meet' : 'share'} kind=${entry.kind || 'fixed'} sid=${entry.originLocationId || entry.meetingSessionId || '?'} exp=${entry.expiresAt || '?'} dev=${this.app.deviceId || '?'}`); } catch (e) {}

            if (Geolocation && typeof Geolocation.watchPosition === 'function') {
                try {
                    const watchId = Geolocation.watchPosition(
                        (position) => {
                            // Session may have been torn down between the
                            // CLLocationManager callback being queued and us
                            // running — ignore late-arriving fixes. The
                            // entry being deleted is the canonical "stopped"
                            // signal; we don't check watchId here because
                            // the very first fix can arrive before the
                            // `entry.watchId = watchId` assignment below.
                            const current = store[uri];
                            if (!current) {
                                return;
                            }
                            if (Date.now() >= expiresAt) {
                                this.stopLocationSharing(uri, {reason: 'expired', sessionId: current.originLocationId, meet: _isMeetSession});
                                return;
                            }
                            const nowMs = Date.now();
                            if (nowMs - current.lastSentMs < this.app.LOCATION_REPEAT_MS) {
                                return;
                            }
                            // Race fence: the accepter's synthetic
                            // 10 km position is armed asynchronously
                            // (inside the initial getCurrentCoordinates
                            // .then(); awaits Nominatim). The iOS
                            // watch can fire before that completes —
                            // skip the tick until the synthetic is
                            // actually in place, otherwise we'd leak
                            // real GPS as the first reported coord
                            // and the proximity-met logic would
                            // mistake the two phones (sitting on the
                            // same desk) for "you've arrived".
                            if (current.awaitingSimulatedPosition && !current.simulatedPosition) {
                                return;
                            }
                            current.lastSentMs = nowMs;
                            // Per-minute heartbeat log. Fires here —
                            // AFTER the LOCATION_REPEAT_MS throttle but
                            // BEFORE the privacy-radius / send path —
                            // so the user always sees an "I'm alive"
                            // line in the app log every minute, even
                            // when the actual tick gets swallowed
                            // (privacy radius, peer not yet paired,
                            // GPS dropout). entry.tickAttempts is the
                            // sender-side counter that increments
                            // every minute regardless of send outcome
                            // — surfaces in the bubble's footer next
                            // to the timestamp.
                            current.tickAttempts = (current.tickAttempts || 0) + 1;
                            try {
                                // utils.timestampedLog(`[location] heartbeat → ${uri} attempt=${current.tickAttempts} kind=${current.kind || 'fixed'}`);
                            } catch (e) { /* noop */ }
                            this._logFixProvenance('watchPosition', uri, position);
                            const c = position && position.coords ? position.coords : {};
                            const realCoords = {
                                latitude: c.latitude,
                                longitude: c.longitude,
                                accuracy: c.accuracy,
                                timestamp: position.timestamp,
                            };
                            // Honour any synthetic position that's
                            // armed for this session. Today the
                            // accepter side gets one installed on
                            // share start (10 km from real GPS) and
                            // the simulator walks it from there. When
                            // simulation is off this returns realCoords
                            // unchanged.
                            const coords = this.sim.effectiveCoordinatesForSession(uri, realCoords);
                            // Privacy radius gate. When the user opted
                            // in to "Exclude my current location (1km)"
                            // and the fresh fix is still inside the
                            // 1 km circle around the session's origin
                            // point, swallow the tick. The throttle
                            // bump above still ran so we won't busy-
                            // loop on every CLLocationManager callback;
                            // we just no-op the actual emission until
                            // the user moves out of the radius.
                            if (!this._shouldSendUpdateTick(uri, coords, current)) {
                                // Privacy radius is hiding the tick
                                // from the wire — but on the SENDER's
                                // own device we still want the
                                // bubble to track real movement so
                                // the user sees themselves on the
                                // map. Stamp the latest coords as
                                // local-only location data. No-op when
                                // not in a privacy-deferred meet
                                // session (entry.privacyDeferred
                                // false / mid missing).
                                const _curEntry = store[uri];
                                if (_curEntry && _curEntry.privacyDeferred
                                        && _curEntry.privacyDeferredBubbleMid) {
                                    this.app._setLocalOwnerCoordsForBubble(
                                        uri,
                                        _curEntry.privacyDeferredBubbleMid,
                                        coords
                                    );
                                }
                                return;
                            }
                            this.sendLocationPayload(uri, coords, expiresIso, originLocationId, tickExtras, _isMeetSession);
                        },
                        (error) => {
                            const msg = error && error.message ? error.message : String(error);
                            const code = error && error.code;
                            utils.timestampedLog('[location] iOS watchPosition error', msg, 'code=', code);
                            // code 1 == PERMISSION_DENIED (library constant RNCPositionErrorDenied).
                            // Leaving the share "running" after permission was pulled would
                            // leave a stale timer + menu entry with no ticks going out; tear
                            // it down and post a system note so the user knows why.
                            if (code === 1) {
                                const stoppedAt = new Date().toLocaleTimeString([], {
                                    hour: '2-digit', minute: '2-digit',
                                });
                                // Stop silently so the default "You stopped sharing" note
                                // doesn't fire — we want a more specific permission note.
                                this.stopLocationSharing(uri, {silent: true, reason: 'denied', sessionId: originLocationId, meet: _isMeetSession});
                                this.app.saveSystemMessage(
                                    uri,
                                    `\uD83D\uDCCD Live location sharing stopped at ${stoppedAt} (location permission denied). Enable 'Always' location access for Blink in Settings to share in the background.`,
                                    'outgoing', false, 1, null, null, null,
                                    originLocationId
                                );
                                // Critical: a system note inside the chat only helps when
                                // the app is foregrounded. The denial typically fires the
                                // moment the user swipes Sylk into the background, so we
                                // also fire a local iOS notification. PushNotificationIOS
                                // presents this as a banner / lock-screen alert regardless
                                // of foreground state, which is the only way the user sees
                                // "your share stopped" while Sylk isn't on screen.
                                if (Platform.OS === 'ios') {
                                    try {
                                        this.app.sendLocalNotification(
                                            'Live location stopped',
                                            // Kept short — banners truncate anything
                                            // longer on a locked screen. The 'open
                                            // Settings' action lives on the tap-handler
                                            // (onLocalNotification → location_stopped).
                                            "Tap to open Blink's Settings and enable 'Always' access.",
                                            {
                                                // from_uri drives sendLocalNotification's
                                                // throttle bucket; using the contact uri
                                                // keeps this notification from colliding
                                                // with arbitrary message notifications.
                                                from_uri: uri,
                                                event: 'location_stopped',
                                                reason: 'denied',
                                            }
                                        );
                                    } catch (e) {
                                        console.log('[location] sendLocalNotification failed', e && e.message ? e.message : e);
                                    }
                                }
                            }
                        },
                        {
                            // Satellite-backed streaming updates. This is the
                            // stream a LIVE share rides for its whole duration,
                            // so a coarse setting here meant every tick after
                            // the origin was wifi/cell-grade too — the share
                            // would show the user drifting between cell
                            // sectors instead of walking down a street.
                            // CLLocationManager is already running for the
                            // share's lifetime either way; kBest vs
                            // kHundredMeters changes how hard the GPS chip
                            // works, not whether it is powered.
                            enableHighAccuracy: true,
                            // Fire every time the user moves; throttling is in JS.
                            distanceFilter: 0,
                            // useSignificantChanges would let the OS wake us
                            // less often but at the cost of minute-ish
                            // latency — we want the 60s cadence we promised
                            // the receiver, so stick with standard updates.
                            useSignificantChanges: false,
                        }
                    );
                    entry.watchId = watchId;
                } catch (e) {
                    utils.timestampedLog('[location] iOS watchPosition failed to start', e && e.message ? e.message : e);
                }
            }

            // Fallback for a stationary user: CLLocationManager only fires
            // callbacks when the OS thinks something has changed. If the
            // phone stays perfectly still for the whole sharing window we
            // could miss the expiry check above. Arm a single
            // BackgroundTimer.setTimeout at the full duration so we always
            // tear down even if no fixes ever arrive. (setTimeout — unlike
            // setInterval — still fires once the app returns to foreground,
            // and will fire on schedule while backgrounded because
            // react-native-background-timer uses a real iOS timer here.)
            try {
                entry.expiryTimeoutId = BackgroundTimer.setTimeout(() => {
                    this.stopLocationSharing(uri, {reason: 'expired', sessionId: originLocationId, meet: _isMeetSession});
                }, effectiveDurationMs);
            } catch (e) { /* noop */ }
        } else {
            // Android path. We rely on two things running together:
            //
            //   (a) LocationForegroundService — a native Kotlin service
            //       with foregroundServiceType="location" that pins the
            //       process in the foreground-service tier, keeps the
            //       JS engine alive past the usual background throttle,
            //       and (crucially on API 29+) is the only supported
            //       vehicle for location callbacks to keep flowing while
            //       the app isn't on screen.
            //
            //   (b) BackgroundTimer.setInterval — react-native-background-timer
            //       schedules a real wall-clock alarm on Android, so our
            //       60s tick keeps firing as long as the foreground
            //       service is alive.
            //
            // We start the service FIRST so that the very first post-origin
            // tick (60s in) is already protected, not just the ones after.
            //
            // INSTRUMENTED. Whether this service is actually running is the
            // biggest unknown behind "the socket died 5s after screen off and
            // never came back": without a live foreground service the process
            // drops out of the foreground-service tier and the OS firewalls
            // its sockets — which is exactly what a sub-second
            // connecting->disconnected looks like. Until now the ONLY trace of
            // this call was a console.log on throw, which never reaches the
            // exported log file, so a field report could not distinguish "FGS
            // running, network still blocked" from "FGS never started". Both
            // outcomes now land in the APPLOG.
            if (LocationForegroundServiceModule
                && typeof LocationForegroundServiceModule.startService === 'function') {
                try {
                    LocationForegroundServiceModule.startService();
                    utils.timestampedLog('[location] [fgs] startService requested for ' + uri
                        + ' — expect a matching "[native] D [location] [fgs] startForeground" line');
                } catch (e) {
                    utils.timestampedLog('[location] [fgs] startService FAILED for ' + uri + ': '
                        + (e && e.message ? e.message : e));
                }
            } else {
                utils.timestampedLog('[location] [fgs] startService UNAVAILABLE — native module missing;'
                    + ' background sharing is at the mercy of OS power management');
            }

            const intervalId = BackgroundTimer.setInterval(() => {
                if (Date.now() >= expiresAt) {
                    this.stopLocationSharing(uri, {reason: 'expired', sessionId: originLocationId, meet: _isMeetSession});
                    return;
                }
                // Per-minute heartbeat log. Fires at the start of
                // every interval tick BEFORE sendLocationUpdate
                // (which can swallow the tick on a privacy-radius
                // gate or GPS read failure). Mirrors the iOS path
                // above so app logs show a uniform "I'm alive" line
                // every minute regardless of platform.
                const _entryNow = store[uri];
                if (_entryNow) {
                    _entryNow.tickAttempts = (_entryNow.tickAttempts || 0) + 1;
                    try {
                        // utils.timestampedLog(`[location] heartbeat → ${uri} attempt=${_entryNow.tickAttempts} kind=${_entryNow.kind || 'fixed'}`);
                    } catch (e) { /* noop */ }
                }
                // Subsequent ticks are flagged isUpdate and group under the
                // origin's id so the receiver updates the existing bubble in
                // place rather than rendering a new one.
                this.sendLocationUpdate(uri, expiresIso, originLocationId, tickExtras, _isMeetSession);
            }, this.app.LOCATION_REPEAT_MS);

            store[uri] = {
                intervalId,
                expiresAt,
                originLocationId,
                inReplyTo,
                meetingSessionId,
                // Privacy-radius state — same shape as the iOS entry so
                // _shouldSendUpdateTick / sendLocationUpdate work the
                // same way on either platform. See the iOS branch above
                // for what each field does.
                excludeOriginRadiusMeters,
                originPoint: null,
                originRadiusCleared: false,
                // Same tickExtras object the BackgroundTimer interval
                // captures via closure — mutation here propagates.
                tickExtras,
                // Same race fence as the iOS branch above — see the
                // long comment there for what this gates and why.
                // Gate early ticks until the async simulated start is armed.
                // Accepter: always (it arms a 3 km-from-destination start).
                // Inviter: only when NO destination was pre-chosen — that's the
                // case where we now arm a 5 km-from-GPS start asynchronously and
                // must not ship a real-GPS origin/invite before it lands. With a
                // pre-chosen destination the inviter keeps its old real-GPS start
                // and needs no fence (and the seed block wouldn't drop it).
                awaitingSimulatedPosition:
                    this.app._locationSimulatorEnabled
                    && (kind === 'meetingAccept'
                        || (kind === 'meetingRequest' && !initialDestination)),
                // Same persistence-resume location data as the iOS branch.
                kind,
                periodLabel,
                // Forced origin id for the post-accept requester meet share:
                // makes this session's ORIGIN tick reuse the meeting request
                // id so the accepter's in_reply_to = request_id ticks merge
                // into one session. null = normal freshly-generated origin.
                forcedOriginId: opts.forcedOriginId || null,
                // "Until I return" state machine — see the iOS
                // branch above for the rationale on each field.
                untilReturnOrigin: opts.resumeUntilReturnOrigin || null,
                untilReturnDeparted: !!opts.resumeUntilReturnDeparted,
                // Persisted-pause restoration. Same intent as the iOS
                // branch above: when the user paused a share and the
                // app then went through a foreground/background cycle
                // (or a process restart), the in-memory entry was
                // re-armed without the paused flag and ticks resumed
                // on their own. Reading `opts.resumePaused` here keeps
                // the pause sticky.
                paused: !!opts.resumePaused,
            };
            this.app._persistActiveShares();
            try { const _oe = store[uri] || {}; this.app._onLocationSessionsChanged('ADD', 'outgoing', uri, `type=${this._isMeetKind(_oe.kind) ? 'meet' : 'share'} kind=${_oe.kind || 'fixed'} sid=${_oe.originLocationId || _oe.meetingSessionId || '?'} exp=${_oe.expiresAt || '?'} dev=${this.app.deviceId || '?'}`); } catch (e) {}
        }

        // Reflect the final (authoritative) expiresAt in React state.
        // The pre-permission block up top seeded activeLocationShares with
        // an optimistic expiresAt so the NavigationBar icon could start
        // pulsing at tap time; that value was computed ~milliseconds
        // earlier and is off by a tiny amount. Overwrite it now with the
        // canonical one so countdown UI and stop-timer math agree.
        this.app.setState({
            activeLocationShares: {
                ...this.app.state.activeLocationShares,
                [uri]: expiresAt,
            },
        });

        // System note persisted in SQL (saveSystemMessage INSERTs with
        // system=1, then renders it live). Only emitted if the origin tick
        // actually went out — otherwise a permission/network failure would
        // leave the user with a false "started" record on disk.
        //
        // Meeting-kind shares (meetingRequest / meetingAccept) DON'T get
        // a system note anymore: we already ship a chat-visible text
        // message on both legs of the handshake ("I want to meet up with
        // you" from the requester, "I want to meet with you, too!" from
        // the accepter — see the pre-permission announcement block up
        // top). The old "Meeting request started" / "Meeting request
        // accepted" system lines duplicated the same information one row
        // above the real text. Plain timed shares keep the "started
        // sharing at HH:MM" note — that one isn't redundant because
        // plain shares have no comparable chat-visible text marker.
        // Skip the "Started sharing location at HH:MM" note on
        // resume — the original note already lives in the chat;
        // re-emitting it on every restart would litter the
        // conversation.
        // The sender's "started sharing" system note is emitted ONCE, on the
        // actual origin tick inside sendLocationPayload — stamped ~1s before the
        // tick so it renders ABOVE the map, and it carries the duration label.
      } finally {
        // Paired with the this.app._startingShares.add(uri) at function
        // entry. Always release the in-flight flag so a later (legitimate)
        // call to start a new share — after this one has either fully
        // set up or been torn down — isn't blocked by a lingering guard.
        if (this._startingShares) {
          this._startingShares.delete(_startKey);
        }
      }
    }

    // Wait for a freshly-armed live share's FIRST location fix to land
    // (origin tick sent) — or fail — before resolving. ShareLocationModal
    // awaits this via onShareLocationConfirmed so it can hold its Share
    // button's spinner + disabled state until there's real feedback, rather
    // than closing the instant the user taps Share.
    //
    // Only waits when a share actually armed and is NEW: startLocationSharing
    // sets outgoingLocationSessions[uri] synchronously on the success path, so a fresh
    // entry means the initial getCurrentCoordinates() is in flight and
    // onInitialShareResult WILL fire. A share that was already active (or a
    // permission denial / early return) resolves immediately — nothing new to
    // wait for. The 20 s ceiling clears the 15 s getCurrentCoordinates
    // timeout with headroom so the modal can never hang if the fix stalls.
    _awaitInitialShare(uri, initialResultPromise, alreadyActive) {
        if (alreadyActive) {
            return Promise.resolve();
        }
        if (!this._hasAnyEntryForUri(uri)) {
            return Promise.resolve();
        }
        return Promise.race([
            initialResultPromise,
            new Promise((resolve) => setTimeout(resolve, 20000)),
        ]);
    }

    // `manualOrigin` — {latitude, longitude} the user dragged the share
    // picker's crosshair onto, or null/absent when they left the map
    // alone. Set when the GPS fix the picker showed was visibly wrong
    // (a coarse wifi/cell fix can land hundreds of metres out) and the
    // user corrected it by hand.
    //
    // It replaces the ORIGIN tick's coordinates only. Every later tick in
    // a live share still comes from real GPS: the correction fixes one bad
    // reading, it is not a standing offset, and treating it as one would
    // misreport the user's position for as long as the share ran.
    async onShareLocationConfirmed({durationMs, periodLabel, kind, excludeOriginRadiusMeters, manualOrigin}) {
        const uri = this.app.state.selectedContact && this.app.state.selectedContact.uri;
        if (!uri) {
            return;
        }
        // Validate the hand-picked origin ONCE here rather than at each use
        // site, so a malformed value can never reach a send path. Anything
        // that isn't a finite in-range coordinate pair degrades to null,
        // i.e. to the pre-existing "just use GPS" behaviour.
        const _manualOrigin = (manualOrigin
                && Number.isFinite(manualOrigin.latitude)
                && Number.isFinite(manualOrigin.longitude)
                && Math.abs(manualOrigin.latitude) <= 90
                && Math.abs(manualOrigin.longitude) <= 180)
            ? {latitude: manualOrigin.latitude, longitude: manualOrigin.longitude}
            : null;
        if (_manualOrigin) {
            utils.timestampedLog('[location] confirm: hand-adjusted origin for', uri,
                '—', _manualOrigin.latitude.toFixed(6) + ',' + _manualOrigin.longitude.toFixed(6),
                'kind=' + kind);
        }
        // Completion plumbing for ShareLocationModal's in-flight spinner. The
        // modal keeps its Share button spinning + disabled until THIS method's
        // returned promise settles, so the user gets immediate feedback and
        // can't double-fire the share while the first GPS fix is acquired and
        // the origin tick is sent. onInitialShareResult() is invoked from
        // startLocationSharing once the initial getCurrentCoordinates()
        // settles; _awaitInitialShare bounds the wait so we never hang.
        let _settleInitial;
        const _initialShareResult = new Promise((resolve) => { _settleInitial = resolve; });
        const onInitialShareResult = () => {
            try { _settleInitial(); } catch (e) { /* noop */ }
        };
        // Snapshot whether a share was already live BEFORE this confirm, so
        // _awaitInitialShare can tell a genuine fresh start (wait for the
        // first fix) from a duplicate/re-entry (nothing new to wait for).
        const _alreadyActive = !!this._storeForKind(kind)[uri];
        // "Meet me there..." path: the user invoked the share flow
        // from a chat-bubble kebab/inline on a Google-Maps-link text
        // message, and a destination is staged on state (or being
        // resolved in the background). If the user confirmed BEFORE
        // background resolution completed and we still have only the
        // shortened URL, do a last-ditch synchronous resolve here so
        // the user doesn't lose the destination because they were
        // quick on the trigger. Failure surfaces an Alert rather than
        // silently shipping a meet-up with no destination.
        let destination = this._uiState().pendingShareDestination;
        const pendingUrl = this._uiState().pendingShareDestinationUrl;
        if (!destination && pendingUrl) {
            utils.timestampedLog('[location] meetMeAt: confirm beat resolve — last-chance sync resolve for', pendingUrl);
            try {
                destination = await utils.resolveShortLocationUrl(pendingUrl);
            } catch (e) {
                destination = null;
            }
            if (!destination) {
                utils.timestampedLog('[location] meetMeAt: last-chance resolve failed for', pendingUrl);
                showThemedAlert(
                    'Couldn\'t read the map link',
                    'The shared link couldn\'t be expanded into coordinates. Open it in Maps and re-share the resulting full link.',
                    [{text: 'OK'}]
                );
                return;
            }
        }
        // Meet-up ("Until we meet", with or without a shared destination)
        // is a value-bearing invite: sendMeetingRequest starts the requester's
        // share immediately (origin forced to the request id). Its ORIGIN tick
        // is an E2EE application/sylk-location-sharing meeting_start carrying
        // the inviter's live coords + destination and meeting_request:true, so
        // the accepter's in_reply_to ticks merge onto that same origin id.
        const _hasDestination = !!(destination
                && typeof destination.latitude === 'number'
                && typeof destination.longitude === 'number');
        if (kind === 'meetingRequest' || _hasDestination) {
            this.app.sendMeetingRequest(uri, {
                durationMs,
                periodLabel,
                excludeOriginRadiusMeters,
                destination: _hasDestination ? destination : null,
            });
            // Nothing armed locally — resolve the modal spinner immediately.
            return;
        }
        if (kind === 'once') {
            // shareLocationOnce awaits its own getCurrentCoordinates() + send
            // internally, so its completion IS the feedback signal.
            await this.shareLocationOnce(uri, {originOverride: _manualOrigin});
            return;
        }
        await this.startLocationSharing(uri, durationMs, periodLabel, {
            kind,
            excludeOriginRadiusMeters,
            onInitialShareResult,
            originOverride: _manualOrigin,
        });
        await this._awaitInitialShare(uri, _initialShareResult, _alreadyActive);
    }

    // One-shot location share — acquire a single GPS fix and ship a
    // single application/sylk-location-sharing tick with action='location' and
    // one_shot:true. No timer, no follow-up ticks, no peerCoords
    // pairing, no destination, no proximity logic. Receiver renders
    // a static "Shared location" bubble (LocationBubble keys off
    // metadata.one_shot to drop the live-share affordances).
    //
    // Permission errors fall through to the same Alert prompts the
    // live-share path uses — there's no value in inventing a
    // separate copy for the one-shot path.
    // opts.inReplyTo — when this one-shot is answering a peer's
    //   `location_request` (action='location_request' / messageId=<reqId>),
    //   pass that reqId here. The outgoing tick stamps in_reply_to so
    //   the peer can dedupe and any of OUR sibling devices on the same
    //   account see the replicated tick and mirror "this request is
    //   answered" — closing their LocationRequestModal automatically
    //   (see app.js _noteSiblingAnsweredLocationRequest).
    async shareLocationOnce(uri, opts = {}) {
        if (!uri) return;
        if (!this.app.sendMessage) {
            utils.timestampedLog('[location] shareLocationOnce: sendMessage prop not wired');
            return;
        }
        // Prominent Disclosure (Google Play). Same gate as
        // startLocationSharing — must precede the OS permission
        // dialog and any data collection. Declining cleanly aborts.
        const acknowledged = await this._ensureLocationDisclosureAcknowledged();
        if (!acknowledged) {
            utils.timestampedLog('[location] shareLocationOnce: disclosure declined for', uri);
            return;
        }
        let hasPermission;
        try {
            hasPermission = await this.ensureLocationPermission();
        } catch (e) {
            hasPermission = false;
        }
        if (!hasPermission) {
            // Same "Open Settings" deep-link the live-share alert
            // uses (see startLocationSharing's openSettingsFn). On
            // iOS we hop into the app's own pane via the
            // app-settings: scheme; on Android react-native-permissions
            // exposes openSettings() which lands directly on the
            // app's Permissions screen — same destination as the
            // "Permissions" item in the global kebab menu.
            const openSettingsFn = () => {
                try {
                    if (Platform.OS === 'ios') {
                        Linking.openURL('app-settings:');
                    } else {
                        try { openSettings(); }
                        catch (e) { Linking.openSettings && Linking.openSettings(); }
                    }
                } catch (e) { /* noop */ }
            };
            Alert.alert(
                'Location permission required',
                Platform.OS === 'ios'
                    ? "Open Settings → Blink → Location to allow location access."
                    : 'Blink needs location access to share your location with your contact. Open Settings to enable it.',
                [
                    {text: 'Cancel', style: 'cancel'},
                    {text: 'Open Settings', onPress: openSettingsFn},
                ],
                {cancelable: true}
            );
            return;
        }
        // Memory-only "we're working on it" note. GPS cold-start can
        // take 5–15 s, and without any visible feedback the user
        // wonders whether the tap registered. Use renderSystemMessage
        // (no SQL INSERT, no replication) so the note disappears on
        // the next chat reload and doesn't clutter restored history.
        // Skip the "acquiring…" note when the user hand-placed the pin:
        // there is nothing to acquire, the bubble lands immediately, and
        // the note would claim a GPS read that never happens.
        if (!(opts && opts.originOverride)) {
            try {
                this.app.renderSystemMessage(
                    uri,
                    '📍 Location will be shared as soon as it is acquired…',
                    'outgoing',
                    new Date(),
                    true
                );
            } catch (e) { /* noop */ }
        }
        try {
            // opts.originOverride — the user dragged the picker's crosshair
            // off a visibly wrong GPS fix. Use their point and skip the
            // acquire entirely: re-reading GPS here would just hand back
            // the same bad fix they had just finished correcting.
            //
            // `accuracy` is deliberately NOT carried over from the fix. It
            // described the GPS reading, not this point, and shipping it
            // would tell the receiver we have a ±8 m measurement of a
            // location that was actually placed by hand. Omitting it is the
            // existing "accuracy unknown" case, which every consumer
            // already handles, rather than a new field older clients would
            // have to learn.
            const _override = opts && opts.originOverride;
            const coords = _override
                ? {
                    latitude: _override.latitude,
                    longitude: _override.longitude,
                    timestamp: Date.now(),
                }
                : await this.getCurrentCoordinates();
            if (_override) {
                utils.timestampedLog('[location] one-shot: using hand-adjusted origin for', uri,
                    '—', coords.latitude.toFixed(6) + ',' + coords.longitude.toFixed(6));
            }
            // 24 h expires_at is generous — a one-shot location is
            // useful for a long time after it's sent (you might be
            // showing it to someone the next morning), and the
            // bubble's expiry-aware UI is suppressed for one_shot
            // anyway. The expires field still gates the SQL row's
            // 7-day cleanup, so we don't end up with stale forever
            // rows.
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            // v1: one-shot goes out as application/sylk-location-sharing. Only
            // the coordinates are encrypted; the app.js send path handles the
            // coordinate-only PGP + cleartext-fields split. metadata.value holds
            // the plaintext coords here.
            const _mid = uuid.v4();
            const _msg = {
                _id: _mid,
                key: _mid,
                createdAt: new Date(),
                metadata: {
                    action: 'location',
                    messageId: _mid,
                    value: coords,
                    one_shot: true,
                    expires: expiresAt,
                    timestamp: new Date(),
                },
                text: '',
                user: {},
            };
            // Correlate a one-shot ANSWER to the location_request it replies to,
            // so the answerer's OTHER devices can close their prompt when a
            // sibling answers (see the sylk-location-sharing branch in
            // outgoingMessage). Distinct from sessionId — a one-shot has no session.
            if (opts && opts.inReplyTo) {
                _msg.metadata.requestId = opts.inReplyTo;
            }
            // Same origin-tick permission stamp the live shares carry (see
            // sendLocationPayload). Probed here rather than read from the
            // cache because ensureLocationPermission above may have just
            // prompted and flipped the state.
            try {
                const _permState = await this.getLocationPermissionStatus();
                if (_permState) _msg.metadata.perm = _permState;
                utils.timestampedLog('[location] one-shot share to', uri,
                    'os permission=' + (_permState || '(unknown)'));
            } catch (e) { /* stamp is best-effort — never block the share */ }
            this.app.sendMessage(uri, _msg, 'application/sylk-location-sharing');
            // No system-message text ("📍 Shared current location at …") — the
            // share renders as the sender's own outgoing MAP bubble (injected by
            // _sendLocationSharing → _injectLocationBubble with author=self), the
            // same way an incoming share renders a map bubble for the receiver.
        } catch (err) {
            utils.timestampedLog('[location] shareLocationOnce failed', err && err.message ? err.message : err);
        }
    }

    // Send a "please share your current location" request to the peer.
    // Symmetric to the meet-up handshake: we ship a single coord-free
    // application/sylk-location-sharing signal with action='location_request'
    // (no coords — we're asking, not sharing). The receiver's app.js detects
    // the action and pops a small Yes/No modal; on Yes the peer fires
    // shareLocationOnce back our way.
    //
    // No timer, no follow-up ticks, no expiry-driven cleanup — the
    // request expires on its own (24 h is generous: long enough for
    // the user to be away from the phone for most of a day before
    // they'd reasonably want a fresh ask), and the receiver's
    // pendingLocationRequests entry is silently dropped past expiry.
    requestPeerLocation(uri) {
        if (!uri) return;
        // Location requests ride the application/sylk-location-sharing signal
        // path: a coord-free action='location_request' tick (see app.js
        // sendLocationRequest). app.js owns the send so the payload and the
        // handshake bookkeeping live in one place. Falls back to a log if
        // the host prop isn't wired.
        this.app.sendLocationRequest(uri);
    }

    // Public entry point used by app.js when the local user taps "Accept"
    // on an incoming meeting request. Starts a location share whose ticks
    // carry in_reply_to pointing at the original request, with the same
    // expiresAt the requester chose so both sides tear down in sync.
    //
    // Returns a Promise that resolves to true if a share actually started
    // (outgoingLocationSessions entry now exists for `uri`), false otherwise. The
    // caller in app.js (_acceptMeetingRequest) uses this to roll back the
    // optimistic acceptedMeetingRequestIds marker when the share never
    // started — e.g. user denied / blocked the permission prompt, or
    // declined the prominent disclosure. Without this rollback the user
    // gets stuck: the marker keeps "Accept" disabled forever even though
    // they may have just granted permission and now want to retry.
    async startMeetingAcceptance(uri, {requestId, expiresAt, periodLabel, excludeOriginRadiusMeters, destination}) {
        if (!uri || !requestId || typeof expiresAt !== 'number') {
            utils.timestampedLog('[location] startMeetingAcceptance: missing required args', uri, requestId, expiresAt);
            return false;
        }
        const now = Date.now();
        const durationMs = Math.max(0, expiresAt - now);
        if (durationMs === 0) {
            utils.timestampedLog('[location] startMeetingAcceptance: request already expired', requestId);
            return false;
        }
        // Enforce one meet per contact: end any prior meet with this peer
        // before accepting a new one. Also clears a stale outgoingLocationSessions[uri]
        // entry that would otherwise make startLocationSharing's re-entry
        // guard treat this accept as a duplicate and silently no-op.
        try {
            if (typeof this._endPriorMeetsForUri === 'function') {
                this._endPriorMeetsForUri(uri, requestId);
            }
        } catch (e) { /* best effort */ }
        await this.startLocationSharing(
            uri,
            durationMs,
            periodLabel || 'until we meet',
            {
                kind: 'meetingAccept',
                inReplyTo: requestId,
                expiresAt,
                // Mirror the requester-side privacy radius: the
                // accepter's "starting point" is the location they
                // were at when they tapped Accept, and the slider on
                // MeetingRequestModal lets them hide that exactly the
                // same way the sender modal does.
                excludeOriginRadiusMeters,
                // Shared meeting destination — accepter inherits
                // whatever the requester broadcast (today: simulator
                // pick; tomorrow: user map-picker). Stamped on every
                // outgoing tick so the view layer / future map UI on
                // the requester's side gets a reciprocal echo.
                destination,
            }
        );
        // Canonical "share started" indicator: outgoingLocationSessions[uri] is
        // populated only on the success path inside startLocationSharing
        // (after permission probe + disclosure both clear). Any early-
        // return path in there (denied / blocked / disclosure-declined /
        // iOS-whenInUse-cancel / Android-foregroundOnly-cancel) leaves
        // outgoingLocationSessions untouched, so this read tells us whether to
        // honour the "we accepted" state in app.js or roll it back.
        return !!this._meetEntryForUri(uri);
    }

    // ===== Meeting/location formatters, wire/SQL derivers, meeting-lifecycle
    // telemetry, and acceptance predicates. Pure logic + app-owned registries
    // reached via this.app.* (the host). =====
    // --- Human-readable [location] [meet] narrative logger --------------------------
    // These emit a compact lifecycle trail, one line per event. Designed to
    // be readable at a glance without scrolling through per-tick noise.
    //
    //   [location] [meet] INVITATION SENT → <peer> — session <id8> expires <hh:mm>
    //   [location] [meet] INVITATION RECEIVED ← <peer> — session <id8> expires <hh:mm>
    //   [location] [meet] ACCEPTED ← <peer> — session <id8>
    //   [location] [meet] PEER ACCEPTED — session <id8> (both sides sharing)
    //   [location] [meet] Distance: ~<N> <unit> — session <id8>  (band change only)
    //   [location] [meet] Proximity dwell started — <N> m — session <id8>
    //   [location] [meet] PROXIMITY MET — session <id8>
    //   [location] [meet] SESSION ENDED — reason=<why> session <id8>
    _meetShortId(id) {
        if (!id) return '????????';
        const s = String(id);
        return s.length > 8 ? s.slice(0, 8) : s;
    }

    _meetFormatExpires(expiresAt) {
        if (typeof expiresAt !== 'number' || !isFinite(expiresAt)) return '(no-expiry)';
        try {
            const d = new Date(expiresAt);
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return hh + ':' + mm;
        } catch (e) {
            return '(invalid)';
        }
    }

    _meetDistanceBand(meters) {
        if (meters == null || !isFinite(meters)) return 'unknown';
        if (meters <= 10)   return 'proximity';     // meeting threshold
        if (meters <= 100)  return 'tens';          // 11–100 m
        if (meters <= 1000) return 'hundreds';      // 101 m – 1 km
        if (meters <= 10000) return 'km';           // 1–10 km
        return 'far';                                // > 10 km
    }

    _meetFormatDistance(meters) {
        if (meters == null || !isFinite(meters)) return '?';
        if (meters < 1000) return Math.round(meters) + ' m';
        return (meters / 1000).toFixed(meters < 10000 ? 1 : 0) + ' km';
    }

    // Single source of truth for the per-row category column.
    // One of {'text','image','video','audio','location','other'}
    // or null. Called at INSERT time so subsequent reads can gate
    // SQL directly on `category=?` instead of re-parsing metadata
    // on every scan.
    //
    // Mapping (kept aligned with the JS classifier in
    // sql2GiftedChat — utils.isImage/isAudio/isVideo strip a
    // trailing .asc themselves, so we don't have to special-case
    // PGP-armored names here either):
    //
    //   text/plain | text/html                              → 'text'
    //   application/sylk-file-transfer:
    //     metadata classifies as image / audio / video      → matches
    //     otherwise (filename present)                      → 'other'
    //     no filename                                       → null
    //   application/sylk-location-sharing, related_action NOT *_update
    //     (origin tick / one-shot)                          → 'location'
    //   everything else (pgp keys, reactions, replies, ctrl)→ null
    //
    // `metadata` may arrive as either a parsed object (most insert
    // sites already have it parsed) or a JSON string (saveOutgoing-
    // MessageSql passes JSON.stringify on the way to SQL). Accept
    // both — the alternative is forcing every caller to remember to
    // pass the parsed form, which is exactly the kind of leakage
    // this method exists to avoid.
    // True when a location CONTENT body is a location-share ORIGIN (the row the
    // chat renders as a map bubble): action 'location', not an update tick, with
    // a real lat/lng. Update ticks (isUpdate) are excluded. Same predicate as
    // updateRenderMessageState's _isLocationOriginRow.
    _isLocationOriginContent(content) {
        if (typeof content !== 'string' || content.indexOf('"location"') === -1) return false;
        try {
            const md = JSON.parse(content);
            return !!(md && md.action === 'location' && !md.isUpdate
                && md.value && typeof md.value.latitude === 'number'
                && typeof md.value.longitude === 'number');
        } catch (e) { return false; }
    }

    // The PURPOSE of a stored location row, written to the indexed
    // related_action column (decryption-free). Origins get a distinct action so
    // the handshake phase (request / accept) and one-shot are queryable in SQL;
    // every trail tick is 'location_update' (its session's purpose lives on the
    // origin row, joined via related_msg_id).
    _locationRelatedAction(fields) {
        // The location_* / meeting_* action families are consistently prefixed
        // with a start / update / stop|end lifecycle:
        //   location_once (static) | location_start | location_update | location_stop
        //   meeting_request/meeting_accept (coord-free handshake) | meeting_start (coord origin) | meeting_update | meeting_end
        if (!fields) return 'location_start';
        // Coordinate-free lifecycle SIGNALS name themselves explicitly in
        // `fields.action`. The shape-based derivation below can only classify
        // coord-BEARING ticks: handed a stop it sees "no isUpdate, no one_shot,
        // no meeting_request, no role" and falls through to 'location_start'.
        //
        // That mislabel is not cosmetic. The row is stored with
        // related_action='location_start', so on resend _resendLocationRow
        // takes the coordinate branch, finds no coordinates in a stop payload,
        // and clears pending — silently dropping the stop. The peer and every
        // sibling device are then left showing a live track that has already
        // ended.
        //
        // Safe against coord-bearing ticks: the send path deletes `action`
        // before the row is built ("signals only"), so they never reach here
        // with one set.
        if (fields.action === 'location_stop' || fields.action === 'meeting_end') {
            return fields.action;
        }
        if (fields.isUpdate) {
            // A meet session's update ticks re-stamp the meet flag, so they read
            // as 'meeting_update'; a plain live trail tick is 'location_update'.
            return (fields.meeting_request || fields.role)
                ? 'meeting_update' : 'location_update';
        }
        if (fields.one_shot) return 'location_once';
        // The requester's coordinate ORIGIN now ships as a value-bearing
        // `meeting_request` (it carries the inviter's coords + destination AND
        // the invite semantics in one message — the server already pushes this
        // action, and the receiver renders it as the 3-point map + accept/reject
        // modal). The accepter's origin stays `meeting_start`. (A legacy
        // coordinate-free meeting_request is a separate explicit signal that
        // never reaches this deriver.)
        if (fields.meeting_request) return 'meeting_request';
        if (fields.role) return 'meeting_start';
        return 'location_start';
    }

    // What to persist in the `metadata` column for a location-sharing row:
    // only the fields with NO column and that aren't derivable. messageId,
    // isUpdate, timestamp, uri, action, one_shot and meeting_request are all
    // reconstructed on read (from related_msg_id / related_action / timestamp /
    // from_uri|to_uri). in_reply_to is a request-id VALUE, so it stays.
    _locationStoredMetadata(fields) {
        const m = {};
        if (!fields) return m;
        if (fields.expires) m.expires = fields.expires;
        if (fields.role) m.role = fields.role;
        if (fields.privacyDeferred) m.privacyDeferred = true;
        if (fields.privacyDeferredRadiusMeters != null) m.privacyDeferredRadiusMeters = fields.privacyDeferredRadiusMeters;
        if (fields.dummy) m.dummy = true;
        // Owner device id (which of the account's devices is broadcasting this
        // session). Persisted so the SQL-derived active-sessions list can name
        // the owning device instead of guessing. Present on the cleartext wire
        // (added to every outgoing envelope) and captured on receive.
        if (fields.deviceId) m.deviceId = fields.deviceId;
        // Sender's OS location-permission state at session start (origin rows
        // only — 'always' / 'whenInUse' / 'foregroundOnly' / …). Not derivable
        // from any column, so it has to be persisted here to survive a reload.
        if (fields.perm) m.perm = fields.perm;
        // requestId correlates an ANSWER back to the location_request it
        // replies to. Not derivable from any column. Dropping it was invisible
        // while a stored row was only ever re-read for rendering; it matters
        // now that a row can be RE-SENT after an outage. Without it the carbon
        // reaching our other devices fails the `_lw.requestId` test in
        // _noteSiblingAnsweredLocationRequest, so their "Share your location?"
        // modal never closes even though the request has been answered.
        if (fields.requestId) m.requestId = fields.requestId;
        return m;
    }

    // Rebuild the full location locationContent for a stored row from its
    // columns + the flags in `metadata`. `coords`/`destination` are the
    // decrypted geo.
    _locationContentFromRow(row, coords, destination) {
        let stored = {};
        try { stored = JSON.parse(row.metadata || '{}'); } catch (e) {}
        const ra = row.related_action;
        const isUpdate = ra === 'location_update' || ra === 'meeting_update';
        let timestamp = stored.timestamp;
        if (timestamp == null) {
            try { timestamp = JSON.parse(row.timestamp); }
            catch (e) { timestamp = row.unix_timestamp ? new Date(row.unix_timestamp * 1000).toISOString() : undefined; }
        }
        const content = Object.assign({}, stored, {
            action: 'location',
            messageId: row.related_msg_id || stored.messageId,
            isUpdate: isUpdate,
            timestamp: timestamp,
            uri: stored.uri || (row.direction === 'incoming' ? row.from_uri : row.to_uri),
            value: coords,
            author: row.from_uri,
        });
        // Restore the purpose flags from related_action (or a legacy full row).
        if (ra === 'location_once' || stored.one_shot) content.one_shot = true;
        // Meet coord origins store as 'meeting_start' (both legs). The
        // accepter's leg carries in_reply_to (restored via the `stored` spread);
        // the requester's leg has none → restore its meeting_request flag.
        // Legacy rows used ra==='meeting_request' for the requester leg.
        // Meet coord origins store as 'meeting_start' (both legs); the persisted
        // `role` tells them apart. The inviter leg re-derives its meeting_request
        // flag; the invited leg is identified by role alone.
        // The requester's coordinate origin persists as related_action
        // 'meeting_request' (the value-bearing invite) OR legacy 'meeting_start';
        // either way the inviter leg (role !== 'invited') re-derives its
        // meeting_request flag so the reload rebuilds the 3-point map + the
        // accept/reject modal. The accepter leg (role 'invited') stays a plain
        // meet origin.
        if (ra === 'meeting_start' || ra === 'meeting_request') {
            if (content.role !== 'invited') content.meeting_request = true;
        } else if (stored.meeting_request) {
            content.meeting_request = true;
        }
        if (destination) content.destination = destination;
        return content;
    }

    // Is the journal payload a location-sharing UPDATE tick (or meeting_end)
    // that can be safely dropped on journal replay?
    //
    // Policy (per product decision after the "target was offline when I
    // started sharing" bug):
    //   • ORIGIN ticks (action='location', not an update) — KEEP. Needed so
    //     receivers who came online after the live event still see the share
    //     bubble and, for meeting requests, the accept modal. Includes plain
    //     timed-share origins, meeting-request origins (meeting_request:true)
    //     and acceptance origins (in_reply_to set).
    //   • UPDATE ticks (action='location', isUpdate set) — DROP. The origin
    //     row already carries the last-known position (live handling UPDATEs
    //     the origin's content in place), so replaying follow-ups would waste
    //     work and, worse, fail a rowid UPDATE if the origin was also dropped.
    //   • meeting_end — DROP. The "wipe now" signal is only meaningful live;
    //     the `expire` column + purgeExpiredMessages() handles the SQL side.
    //   • Encrypted blobs we can't introspect (contentOverride missing) —
    //     DROP, same as before: we can't tell origin from update, so the
    //     conservative move is to skip. Callers that want origin ticks
    //     through MUST pre-decrypt and pass the plaintext via contentOverride.
    _isLocationJournalPayload(message, contentOverride) {
        if (!message || message.contentType !== 'application/sylk-message-metadata') {
            return false;
        }
        const content = contentOverride != null ? contentOverride : message.content;
        if (typeof content !== 'string') return false;
        // Caller couldn't provide a decrypted body → we have no way to tell
        // origin from update. Drop (existing conservative default).
        if (content.startsWith('-----BEGIN PGP')) return true;
        try {
            const parsed = JSON.parse(content);
            if (!parsed || typeof parsed !== 'object') return false;
            const action = parsed.action;
            if (action === 'meeting_end') return true;
            if (action === 'location') {
                // Origin tick (meeting request, acceptance, or plain timed
                // share) → pass through so SQL gets the row and the modal
                // can be queued.
                if (!parsed.isUpdate) return false;
                // Follow-up tick. Two cases:
                //   • Meet session (meeting_request:true OR in_reply_to):
                //     UPDATE-in-place semantics; the origin row already
                //     carries the latest position once live, and journal
                //     replay would just duplicate. Drop.
                //   • Plain timed share (4h / 8h / 24h / once): we
                //     preserve every tick as its own SQL row so the trail
                //     can be replayed later. Pass through.
                const isMeetSession = parsed.meeting_request === true
                    || !!parsed.role;
                return isMeetSession;
            }
        } catch (e) {
            // Unparseable — not recognisable as structured metadata; let
            // the existing pipeline handle (it will silently skip via the
            // downstream guards in saveOutgoingMessageSqlBatch).
        }
        return false;
    }

    // High-level narrative meeting-lifecycle events. These are routed
    // through utils.timestampedLog so they land in the persisted user-
    // facing log file (exposed in the app's logs UI), not just the dev
    // console. Low-level `[location] [meet] propagate …` diagnostics remain on
    // plain console.log (they're too noisy for the user log).
    _reportMeetingInvitationSent(requestId, peerUri, expiresAt) {
        utils.timestampedLog('[location] [meet] INVITATION SENT →', peerUri, '— session', this._meetShortId(requestId), 'expires', this._meetFormatExpires(expiresAt));
    }

    _reportMeetingInvitationReceived(requestId, fromUri, expiresAt) {
        utils.timestampedLog('[location] [meet] INVITATION RECEIVED ←', fromUri, '— session', this._meetShortId(requestId), 'expires', this._meetFormatExpires(expiresAt));
    }

    _reportMeetingAccepted(requestId, fromUri) {
        utils.timestampedLog('[location] [meet] ACCEPTED ←', fromUri, '— session', this._meetShortId(requestId));
    }

    _reportPeerAccepted(requestId, fromUri) {
        utils.timestampedLog('[location] [meet] PEER ACCEPTED — session', this._meetShortId(requestId), 'peer=', fromUri, '(both sides sharing)');
    }

    _reportMeetingDistance(sessionId, meters, ownCoords, destinationCoords) {
        if (meters == null || !isFinite(meters)) return;
        const band = this._meetDistanceBand(meters);
        const prev = this._meetLastDistanceBand[sessionId];
        if (prev === band) return;
        this._meetLastDistanceBand[sessionId] = band;
        // Optional "and how far am *I* from the destination?" suffix.
        // Each device computes against its own current coords (the
        // caller passes ownCoords from this device's session side —
        // requesterCoords or accepterCoords depending on which side
        // we are), so the same line on both phones reads as that
        // device's own progress, not a shared number.
        let toDestSuffix = '';
        if (destinationCoords && ownCoords) {
            const toDest = haversineMeters(ownCoords, destinationCoords);
            if (Number.isFinite(toDest)) {
                toDestSuffix = ' • ' + this._meetFormatDistance(toDest) + ' to dest';
            }
        }
        utils.timestampedLog('[location] [meet] Distance: ~' + this._meetFormatDistance(meters) + ' peer' + toDestSuffix, '— session', this._meetShortId(sessionId), '(band', prev ? prev + '→' + band : band, ')');
    }

    _reportProximityDwellStarted(sessionId, meters) {
        utils.timestampedLog('[location] [meet] Proximity dwell started —', this._meetFormatDistance(meters), '— session', this._meetShortId(sessionId));
    }

    _reportProximityMet(sessionId, meters) {
        utils.timestampedLog('[location] [meet] PROXIMITY MET — session', this._meetShortId(sessionId), 'distance=', this._meetFormatDistance(meters));
    }

    _reportMeetingEnded(sessionId, reason) {
        // Dedup: this is called from both the incoming meeting_end
        // signal handler AND the local teardown helper, so without
        // a guard the SESSION ENDED log fires twice for the same
        // session. Track reported sessions in a Set; the
        // _meetLastDistanceBand cleanup still runs idempotently.
        if (!this._meetReportedEnded.has(sessionId)) {
            this._meetReportedEnded.add(sessionId);
            utils.timestampedLog('[meet] [location] SESSION ENDED — reason=' + (reason || 'unknown'), 'session', this._meetShortId(sessionId));
        }
        delete this._meetLastDistanceBand[sessionId];
    }

    // Predicate exposed as a prop so UI below (kebab menu) can decide whether
    // to surface the "Show meeting request..." option. Treats expired requests
    // as "not acceptable" too.
    isMeetingRequestAcceptable(requestId, expiresAt) {
        if (!requestId) return false;
        if (this.acceptedMeetingRequestIds.has(requestId)) {
            return false;
        }
        if (typeof expiresAt === 'number' && expiresAt <= Date.now()) {
            return false;
        }
        return true;
    }

    // Has this meeting session progressed past the acceptance handshake?
    // Exposed as a prop to NavigationBar so stopLocationSharing can
    // pick the right vocabulary for its system notes: before acceptance
    // we call the thing a "Meeting request" (it's still a request, the
    // peer hasn't responded yet); after acceptance it's just a "Meeting"
    // because the label of "request" stops making sense — both sides
    // are actively sharing.
    //
    // Accepted on either side counts:
    //   • this device was the accepter → acceptedMeetingRequestIds has it
    //   • this device was the requester → handledAcceptanceIds has it
    //     once we've seen the peer's first reply tick
    isMeetingSessionAccepted(sessionId) {
        if (!sessionId) return false;
        if (this.acceptedMeetingRequestIds.has(sessionId)) {
            return true;
        }
        if (this.handledAcceptanceIds.has(sessionId)) {
            return true;
        }
        return false;
    }


    // ===== Session-teardown cluster. Owns meetingSessions (engine state);
    // reaches app-owned persistence/timers and _wipeMeetingSession via
    // this.app.* seams. =====

    // Arm a one-shot BackgroundTimer for session expiry. Idempotent —
    // repeat calls for the same sessionId are no-ops, so it's safe to
    // invoke from both the outgoing-echo path and the incoming-request
    // path on the same device (won't happen in practice but cheap to
    // guard).
    _scheduleMeetingSessionWipe(sessionId, uri, expiresAt) {
        if (!sessionId) return;
        if (this.meetingSessionWipeTimers[sessionId]) return;
        const delay = Math.max(0, expiresAt - Date.now());
        // BackgroundTimer.setTimeout fires on a real alarm on Android and
        // is reliable in foreground on iOS. If the app is killed before
        // the timer fires, the next boot's hydrate path could replay the
        // wipe — but we keep the scheme simple: if the user kills the
        // app, cleanup happens on the NEXT interaction with that chat
        // after expires_at (see the defensive check at the top of the
        // wipe method itself). Good enough for a privacy feature where
        // "eventually" is acceptable.
        const id = BackgroundTimer.setTimeout(() => {
            delete this.meetingSessionWipeTimers[sessionId];
            this.app._wipeMeetingSession(sessionId, uri, 'expired');
        }, delay);
        this.meetingSessionWipeTimers[sessionId] = id;
        console.log('[meeting] scheduled wipe for session', sessionId, 'uri=', uri, 'in', Math.round(delay / 1000), 's');
    }

    // "Let's meet up." Pure invitation — the requester does NOT start
    // sharing yet. Register the request id so the acceptance tick
    // (in_reply_to === request_id) is recognised, and stash the share
    // params (cap / privacy radius / optional destination) so the requester
    // can start its OWN share once the peer accepts. destination (if any)
    // stays local — it is NOT put on the wire; it rides the E2EE location
    // ticks after acceptance.
    // Single-meet-per-contact enforcement. Before a NEW meet with `uri`
    // starts (inviter sending a request, or accepter tapping Accept), end
    // every OTHER meet session already tied to this contact so two meets
    // with the same person can never be live at once. Without this, starting
    // a fresh meet before the previous one wrapped up leaves the old session
    // alive on both sides: the receiver ends up with stacked map bubbles (one
    // per live session) and the NavBar pin never clears because the old share
    // keeps ticking. Idempotent — sessions already ended are skipped.
    _endPriorMeetsForUri(uri, exceptSessionId) {
        if (!uri || !this.meetingSessions) return;
        this.app._endedLocationSessions = this.app._endedLocationSessions || new Set();
        // Snapshot the ids up front — _wipeMeetingSession mutates
        // this.meetingSessions as it runs.
        const _ids = Object.keys(this.meetingSessions);
        for (const sid of _ids) {
            if (!sid || sid === exceptSessionId) continue;
            const s = this.meetingSessions[sid];
            if (!s) continue;
            // Only sessions involving THIS contact.
            if (s.requesterUri !== uri && s.accepterUri !== uri) continue;
            // Already torn down — don't re-signal the peer or post a second
            // end note. _meetReportedEnded is set by _reportMeetingEnded, which
            // fires from BOTH the local wipe and the incoming meeting_end
            // handler, so it covers sessions ended by either side.
            if (this.app._endedLocationSessions.has(sid)) continue;
            if (this._meetReportedEnded.has(sid)) continue;
            this.app._endedLocationSessions.add(sid);
            utils.timestampedLog('[location] [meet] auto-ending prior meet', this._meetShortId(sid), 'with', uri, '— a new meet with this contact is starting');
            try {
                // Tell the peer so their side tears down too. The old share
                // may no longer have a local timer (it was replaced), so
                // stopLocationSharing alone wouldn't emit this signal.
                this.sendMeetingEndSignal(uri, sid, {reason: 'ended'});
            } catch (e) { /* best effort */ }
            // Local teardown: stops any still-live timer for this uri (silent,
            // no note) and wipes the bubble + SQL rows + session record for
            // this session id. Runs synchronously up to its first await, so
            // outgoingLocationSessions[uri] is cleared before a new share starts.
            try { this.app._wipeMeetingSession(sid, uri, 'replaced'); } catch (e) {
                console.log('[location] [meet] auto-end wipe failed', e && e.message ? e.message : e);
            }
        }
    }


    // ===== Coord-propagation / proximity-meet cluster. Logic owns
    // meetingSessions (sibling); persistence, notifications, React state and
    // _wipeMeetingSession reached via this.app.* seams. =====

    // Per-tick pair update for meeting sessions. Determines which session
    // this tick belongs to (if any) and which side of it it came from,
    // then stores the latest coords on the matching side. Returns
    // {sessionId, side, peerUri} if the tick was paired, else null.
    //
    // Tick → (sessionId, side) classification:
    //   • in_reply_to present               → session=in_reply_to, side='accepter'
    //   • meeting_request:true + messageId  → session=messageId,   side='requester' (origin)
    //   • messageId in myOutgoingMeetingRequestIds → session=messageId, side='requester'
    //     (continuation tick of our own request; follow-up ticks don't
    //     restamp meeting_request:true.)
    //   • messageId matches a known session's requesterOriginId
    //     or accepterOriginId                → matching session + side
    //     (covers continuation ticks once we've already seen the origin.)
    _updateMeetingSessionCoords(locationContent, conversationUri) {
        if (!locationContent || locationContent.action !== 'location') return null;
        const mid = locationContent.messageId;
        if (!mid) return null;

        let sessionId = null;
        let side = null;

        // Unified meet model: the sender stamps an explicit sessionId (the
        // meeting request id, shared by both legs) + role. Prefer those.
        if (locationContent.sessionId && locationContent.role) {
            sessionId = locationContent.sessionId;
            side = locationContent.role === 'invited' ? 'accepter' : 'requester';
        } else if (locationContent.role === 'invited') {
            sessionId = locationContent.messageId;
            side = 'accepter';
        } else if (locationContent.meeting_request === true) {
            sessionId = mid;
            side = 'requester';
        } else if (this.myOutgoingMeetingRequestIds.has(mid)) {
            sessionId = mid;
            side = 'requester';
        } else {
            // Fallback: continuation tick for a session we've already
            // classified. Look it up by known origin ids.
            for (const [sid, s] of Object.entries(this.meetingSessions)) {
                if (!s) continue;
                if (s.requesterOriginId === mid) { sessionId = sid; side = 'requester'; break; }
                if (s.accepterOriginId  === mid) { sessionId = sid; side = 'accepter';  break; }
            }
        }

        if (!sessionId || !side) return null;

        const s = this.meetingSessions[sessionId] || {};
        // Record origin ids and conversation uri for each side the first
        // time we see them. conversationUri is the "other party" from this
        // device's perspective — it's the right key for state.messages.
        if (side === 'requester') {
            if (!s.requesterOriginId) s.requesterOriginId = mid;
            if (!s.requesterUri && conversationUri) s.requesterUri = conversationUri;
        } else {
            if (!s.accepterOriginId) s.accepterOriginId = mid;
            if (!s.accepterUri && conversationUri) s.accepterUri = conversationUri;
        }

        // Privacy-deferred ticks carry the destination as `value` (a
        // stand-in while that side is hiding their position). Don't
        // extract them as that side's coords — would render the side's
        // pin at the meeting point on the OTHER side's map (cross-leak).
        const v = locationContent.value;
        if (!locationContent.privacyDeferred
                && v && typeof v.latitude === 'number' && typeof v.longitude === 'number') {
            const coords = {
                latitude: v.latitude,
                longitude: v.longitude,
                accuracy: typeof v.accuracy === 'number' ? v.accuracy : null,
                timestamp: locationContent.timestamp || Date.now(),
            };
            if (side === 'requester') s.requesterCoords = coords;
            else                      s.accepterCoords  = coords;
            // START snapshot: keep the FIRST coords we ever see for each
            // side, never overwritten by later updates. The live/last
            // position (requesterCoords/accepterCoords) moves every tick;
            // these two freeze where each party was when the meet began.
            // Used to draw the "Meet-up succeeded" 3-point summary at end
            // (each party's start + the meeting point) — the last-known
            // coords are used instead when the meet FAILED.
            if (side === 'requester') { if (!s.requesterStartCoords) s.requesterStartCoords = coords; }
            else                      { if (!s.accepterStartCoords)  s.accepterStartCoords  = coords; }
        }
        // Capture shared meeting destination from any tick that
        // carries it (origin or update; requester broadcasts it once
        // they pick one — usually after their first GPS fix). Keep
        // the first non-null value we ever see; subsequent broadcasts
        // of the same destination are no-ops, and we don't want a
        // rogue update to flip an established destination mid-session.
        // If a NavBar share is already active for this conversation
        // (the accepter side after they tapped Accept), forward the
        // destination so its simulator/tick stamping picks it up.
        const dest = locationContent.destination;
        if (dest
                && typeof dest.latitude === 'number'
                && typeof dest.longitude === 'number'
                && !s.destination) {
            s.destination = {latitude: dest.latitude, longitude: dest.longitude};
            try {
                if (conversationUri) {
                    this.setMeetingDestination(conversationUri, s.destination);
                }
            } catch (e) {
                console.log('[meeting] propagating destination to NavBar failed', e && e.message ? e.message : e);
            }
        }
        this.meetingSessions[sessionId] = s;

        // One-line APPLOG summary of what this tick is and what the session
        // looks like AFTER it lands. This is the breadcrumb we want next time
        // the "two maps instead of one" symptom shows up — it tells us:
        //   • which side (requester / accepter) the tick was classified as
        //   • whether both origin ids are now known (without both we cannot
        //     stamp peerCoords on the partner's bubble — the symptom of two
        //     separate bubbles drifting independently)
        //   • whether both coord pairs are now known (precondition for the
        //     haversine/distance computation and the second pin)
        //   • the in_reply_to / meeting_request flags that drive the
        //     _injectLocationBubble dedup
        // We deliberately keep this on `utils.timestampedLog` so it lands in
        // the on-device log file (Show logs / Support needed…), not just the
        // dev console.
        try {
            utils.timestampedLog('[location] [meet] tick', 'session=' + this._meetShortId(sessionId), 'side=' + side, 'mid=' + this._meetShortId(mid), 'role=' + (locationContent.role ? locationContent.role : '-'), 'meeting_request=' + (locationContent.meeting_request === true ? 'y' : 'n'), 'has_coords=' + (v && typeof v.latitude === 'number' ? 'y' : 'n'), 'pair=req:' + (s.requesterOriginId ? 'id' : '-') + (s.requesterCoords ? '+gps' : '') + '/acc:' + (s.accepterOriginId ? 'id' : '-') + (s.accepterCoords ? '+gps' : ''));
        } catch (e) { /* logging must never throw */ }

        return {sessionId, side, peerUri: conversationUri, session: s};
    }

    // Patch peerCoords (+ distance) into the latest location-data entry of
    // each bubble that belongs to this session, so LocationBubble can read them
    // off the entry's peerCoords / distanceMeters on its next render.
    //
    // We update both this.app.state.locationData (the flat map ContactsListBox
    // reads) and the mirrored copy inside allContacts[uri].locationData — the
    // tick setState above keeps these in sync, so we do too.
    _propagatePeerCoordsForSession(sessionId, conversationUri) {
        const s = this.meetingSessions[sessionId];
        if (!s) return;
        const {requesterOriginId, requesterCoords, accepterOriginId, accepterCoords} = s;
        // Need at least one coord pair and both origin ids for the current
        // conversation to make a difference. If only one origin is known
        // on this device (e.g. the remote side's accept bubble hasn't
        // arrived yet) we still stamp peerCoords on whatever we have.
        if (!requesterCoords && !accepterCoords) return;

        const distance = haversineMeters(requesterCoords, accepterCoords);
        // Pick "our own" coords for this side. We're the requester
        // when this session id is in myOutgoingMeetingRequestIds (set
        // when our outgoing meeting_request tick echoed locally).
        // Otherwise we're the accepter side. The distance-to-dest
        // log uses these so each device shows its own remaining
        // walking distance to the meeting point.
        const iAmRequester = !!(this.myOutgoingMeetingRequestIds.has(sessionId));
        const ownCoords = iAmRequester ? requesterCoords : accepterCoords;
        this._reportMeetingDistance(sessionId, distance, ownCoords, s.destination);

        // Proximity auto-end. If the two participants have been within
        // MEETING_PROXIMITY_METERS of each other for MEETING_PROXIMITY_DWELL_MS
        // continuously, treat the meetup as completed: notify the user
        // locally, relay a meeting_end signal to the peer, stop this side's
        // share, and wipe the session. Gated by a once-per-session flag so
        // a stream of "near" ticks doesn't replay the alert. Called here
        // (and not in _updateMeetingSessionCoords) because we need both
        // coords populated, which is the same precondition this routine
        // already enforces above.
        this._maybeFireProximityMeet(sessionId, conversationUri, distance);

        this.app.setState(prev => {
            if (!prev || !prev.allContacts) return null;
            const idx = prev.allContacts.findIndex(c => c.uri === conversationUri);
            if (idx === -1) {
                console.log('[location] [meet] propagate: contact NOT FOUND for uri=', conversationUri, '— session', this._meetShortId(sessionId));
                return null;
            }
            const oldContact = prev.allContacts[idx];
            // Same setState drift trap: basing
            // newMm solely on oldContact.locationData and then writing
            // it back to the top level quietly rolls OTHER mIds back to
            // whatever the contact mirror last had. Merge top-level on top
            // so the freshest per-mId entries survive — peerCoords that
            // were stamped by a prior run of this same routine live at the
            // top level and would be lost otherwise.
            // Location lives in the isolated locationData store — base + write
            // there (messagesMetadata no longer carries location).
            const prevTopMeta = prev.locationData || {};
            const prevContactMeta = oldContact.locationData || {};
            const prevMm = {...prevContactMeta, ...prevTopMeta};
            const newMm = {...prevMm};
            let changed = false;

            // Per-tick propagate logging is intentionally omitted here (it was
            // ≈80 lines/minute during a live meet). The logic stays; errors /
            // contact-not-found still log once so a regression leaves a trail.

            // Shared meeting destination for this session (the "3rd point").
            // The receiver only ever gets it inside the PEER's ticks, which are
            // routed to peerCoords and never injected as their own bubble — so
            // without stamping it here the accepter's bubble location data never
            // carries `destination`, and LocationBubble draws no green pin and no
            // "X km to meeting point" line even though the engine store
            // (meetingSessions[sessionId].destination) has it. Stamp it onto the
            // same bubble location-data entry as peerCoords so both sides render it.
            const _meetDest = (s.destination
                    && typeof s.destination.latitude === 'number'
                    && typeof s.destination.longitude === 'number')
                ? {latitude: s.destination.latitude, longitude: s.destination.longitude}
                : null;
            const applyPeer = (originId, peerCoords, label) => {
                if (!originId) return;
                // No peer yet (one side hasn't been seen on this device) —
                // don't overwrite an absent peerCoords with explicit null.
                // Leaves the bubble showing a single pin until pairing
                // completes, which is the correct visual.
                if (!peerCoords) return;
                const arr = prevMm[originId];
                if (!Array.isArray(arr) || arr.length === 0) return;
                // Find the most recent 'location' entry (may not be last).
                let realIdx = -1;
                for (let i = arr.length - 1; i >= 0; i--) {
                    if (arr[i] && arr[i].action === 'location') { realIdx = i; break; }
                }
                if (realIdx < 0) return;
                const existing = arr[realIdx];
                // Cheap equality check — skip setState if nothing changed.
                // Include the destination so a freshly-arrived meeting point
                // still triggers an update even when peerCoords/distance are
                // unchanged from the previous tick.
                const _destSame = (!_meetDest && !existing.destination)
                    || (!!_meetDest && !!existing.destination
                        && existing.destination.latitude === _meetDest.latitude
                        && existing.destination.longitude === _meetDest.longitude);
                const same = existing.peerCoords
                    && existing.peerCoords.latitude === peerCoords.latitude
                    && existing.peerCoords.longitude === peerCoords.longitude
                    && existing.distanceMeters === distance
                    && _destSame;
                if (same) return;
                const updated = {
                    ...existing,
                    peerCoords,
                    distanceMeters: distance,
                };
                // Only add destination when we actually have one — never write
                // an explicit null that would clobber a destination stamped by
                // an earlier tick.
                if (_meetDest) updated.destination = _meetDest;
                const newArr = [...arr];
                newArr[realIdx] = updated;
                newMm[originId] = newArr;
                changed = true;
                // Persist to SQL on the same path — the origin row for this
                // side exists on this device regardless of direction (both
                // saveOutgoingMessage and saveIncomingMessage INSERT one on
                // origin tick). Scheduling the UPDATE outside setState so
                // the state commit isn't blocked on SQL; the helper is
                // fire-and-forget and logs its own errors.
                this.app._persistPeerCoordsToSql(originId, updated);
            };

            // Unified meet model: both legs share ONE bubble keyed on sessionId.
            // Stamp THAT bubble with the PEER's coords (the other party from this
            // device's perspective); our own coords are the bubble's own trail.
            const _peerCoords = iAmRequester ? accepterCoords : requesterCoords;
            applyPeer(sessionId, _peerCoords, iAmRequester ? 'req←acc' : 'acc←req');

            // One-line APPLOG summary of THIS propagation pass. We log:
            //   • whether each origin id was known (without both, the
            //     partner's bubble can't be stamped — that's the
            //     "two independent maps" symptom)
            //   • whether both coord pairs were known
            //   • the resulting distance
            //   • whether a state change actually happened (changed=y/n)
            // Skipped passes (no peer yet, peerCoords already match) are
            // the common case once the session has been paired and is just
            // echoing the same merge — they show up as changed=n.
            try {
                utils.timestampedLog('[location] [meet] propagate', 'session=' + this._meetShortId(sessionId), 'reqOrigin=' + (requesterOriginId ? this._meetShortId(requesterOriginId) : '-'), 'accOrigin=' + (accepterOriginId ? this._meetShortId(accepterOriginId) : '-'), 'reqCoords=' + (requesterCoords ? 'y' : 'n'), 'accCoords=' + (accepterCoords ? 'y' : 'n'), 'distance=' + (distance != null ? this._meetFormatDistance(distance) : '-'), 'changed=' + (changed ? 'y' : 'n'));
            } catch (e) { /* never throw from logging */ }

            if (!changed) return null;

            const updatedContact = {...oldContact, locationData: newMm};
            const newContacts = [...prev.allContacts];
            newContacts[idx] = updatedContact;

            const next = {
                allContacts: newContacts,
                locationData: newMm,
            };
            if (prev.selectedContact && prev.selectedContact.uri === conversationUri) {
                next.selectedContact = updatedContact;
            }
            return next;
        });
    }

    // Proximity gate for "Until we meet" auto-end. Called on every tick
    // after peerCoords are paired. Three possible outcomes per call:
    //
    //   • distance > threshold → reset dwell ("they drifted apart")
    //   • distance ≤ threshold but dwell not reached → remember when the
    //     near phase started and bail (waiting for sustained proximity)
    //   • distance ≤ threshold for ≥ dwell window → FIRE: notify user,
    //     relay meeting_end to peer, stop this side's share, wipe session.
    //
    // The once-per-session `proximityFired` flag guards against double-
    // firing before the session is torn down (the wipe is async — a tick
    // in flight could re-enter this block before meetingSessions[sid]
    // is deleted).
    //
    // Threshold / dwell tuning notes:
    //   • 10 m is "arm's length / same table" with consumer GPS. Tight
    //     enough to mean "they're actually at the same spot," at the
    //     cost of tolerating less GPS jitter — a single bad fix can
    //     push the reported distance past 10 m even when the phones
    //     are side by side. The dwell debounce below absorbs that.
    //   • 60 s dwell prevents a one-tick GPS glitch from killing an active
    //     session while the users are actually still walking toward each
    //     other. At the default 60 s tick cadence that's roughly "two
    //     ticks in a row both near" — reasonable signal / noise ratio.
    _maybeFireProximityMeet(sessionId, conversationUri, distance) {
        if (distance == null) return;
        const s = this.meetingSessions[sessionId];
        if (!s) return;
        if (s.proximityFired) return;

        // 10 m is "arm's length / same table / same doorway" — i.e. the
        // two phones are really at the same spot, not just nearby. This
        // is tighter than the "same block" 50 m earlier drafts used; the
        // downside is we're now squarely inside consumer-GPS noise (5–15 m
        // CEP is typical outdoors, worse indoors), so a single noisy fix
        // can bounce above the threshold. DWELL_MS + accuracy-aware gating
        // below absorb that — we require the sustained-near state, not a
        // single tick, AND we refuse to trust fixes whose reported
        // accuracy is too coarse to resolve proximity at 10 m.
        //
        // 15 s dwell is a deliberately-short debounce: at a 1-tick-every-
        // few-seconds cadence that's roughly 2–3 sustained near ticks
        // before we fire. Earlier drafts used 60 s, which felt unresponsive
        // when two people were clearly together at 2–3 m apart — by the
        // time they pulled out the phone to check, they'd been staring at
        // "distance: 3 m" for a minute.
        //
        // No accuracy gate on the meetup-confirmed fire (see comment on
        // the distance check below). Indoors / weak-GPS environments
        // report coarse accuracy (±50–150 m via cell+wifi positioning)
        // even when phones are side-by-side; gating on accuracy prevents
        // the meeting from ever auto-ending in that common case. Trust
        // the reported distance; DWELL_MS debounces single-tick glitches.
        // THRESHOLD_M raised from 10 m to 20 m after indoor testing: two
        // phones in the same room, with the peer physically within arm's
        // reach, consistently reported ~14 m apart because consumer GPS
        // accuracy indoors is ~20 m (reported by both iOS and Android as
        // `accuracy: 20` in the logs). A 10 m cutoff meant the meetup-
        // confirmed fire never triggered for in-building meetings. 20 m
        // matches that observed indoor accuracy floor while still being
        // tight enough that "within the same building" is the scale at
        // which we consider the meeting complete.
        //
        // User-overridable via Preferences → Location → "Meet-up
        // proximity": 10 m (tight / outdoor with clear sky view), 20 m
        // (default), or 50 m (relaxed / indoor / dense city). Read fresh
        // on every call so a change applies on the next tick without
        // any session teardown.
        const _prefProximity = this.app.state
            && this.app.state.accountSetting
            && this.app.state.accountSetting.location
            && this.app.state.accountSetting.location.proximityMeters;
        const THRESHOLD_M = (typeof _prefProximity === 'number' && _prefProximity > 0)
            ? _prefProximity
            : 20;
        const ALERT_THRESHOLD_M = 250;
        const DWELL_MS = 15 * 1000;

        // First-proximity heads-up — fire BEFORE the strict accuracy
        // gate and BEFORE effDistance-based dwell logic. Rationale: the
        // "You are close to each other" push is a low-stakes hint with
        // no permanent side-effects (no chat message, no session teardown),
        // so we'd rather err on the side of "tell the user they might be
        // nearby" than "stay silent because one device briefly reported a
        // coarse fix". Using the RAW reported distance here — no accuracy
        // adjustment — so the alert still fires when one device has a
        // coarse fix.
        //
        // ALERT_THRESHOLD_M (20 m) is intentionally roomier than
        // THRESHOLD_M (10 m): "close to each other" should trigger as the
        // phones approach, not only once they're already at the meetup
        // point. 20 m is about "in the same shop / around the corner" —
        // the right scale for a heads-up. The meetup-confirmed fire below
        // keeps the tighter 10 m threshold with the accuracy-aware gate.
        //
        // Once-per-session via s.proximityAlertSent; a subsequent
        // near→far→near bounce won't retrigger. Session teardown wipes
        // the object so a future meeting starts with a fresh flag.
        if (!s.proximityAlertSent && distance < ALERT_THRESHOLD_M) {
            s.proximityAlertSent = true;
            console.log('[meeting] proximity alert fired for session', sessionId, 'distance=', Math.round(distance), 'm', '(threshold', ALERT_THRESHOLD_M, 'm)');
            this.app._showProximityAlertNotification(conversationUri);
            // { const _atNear = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
            //   this.app._saveMeetingNote(conversationUri, sessionId, 'close', `You are close to each other at ${_atNear}`); }
        }

        // MEETUP-CONFIRMED fire. Uses the raw reported distance — no
        // accuracy gate, no effDistance inflation. If both devices are
        // reporting they're within THRESHOLD_M of each other, treat that
        // as "they met" regardless of whether GPS claims ±5 m or ±150 m
        // precision. The indoor / weak-GPS case is the motivating one:
        // accuracy there is routinely ±50–150 m even when phones are
        // physically touching, and an accuracy-gated fire would never
        // trigger. DWELL_MS below still debounces single-tick glitches.
        // accA/accB are retained purely for logging — they no longer
        // affect the decision.
        const accA = s.requesterCoords && typeof s.requesterCoords.accuracy === 'number'
            ? s.requesterCoords.accuracy : null;
        const accB = s.accepterCoords && typeof s.accepterCoords.accuracy === 'number'
            ? s.accepterCoords.accuracy : null;

        if (distance > THRESHOLD_M) {
            if (s.nearSince) {
                console.log('[meeting] proximity dwell reset for session', sessionId, 'distance=', Math.round(distance), 'm', 'accA=', accA == null ? '(none)' : Math.round(accA) + ' m', 'accB=', accB == null ? '(none)' : Math.round(accB) + ' m');
            }
            s.nearSince = null;
            return;
        }

        const now = Date.now();
        if (!s.nearSince) {
            s.nearSince = now;
            this._reportProximityDwellStarted(sessionId, distance);
            return;
        }

        const dwelled = now - s.nearSince;
        if (dwelled < DWELL_MS) {
            return;
        }

        // Fire: flip the flag first so any re-entry bails immediately.
        s.proximityFired = true;
        this._reportProximityMet(sessionId, distance);

        // Local notification on this device — "You met!". Shown whether the
        // app is foreground or background; when foreground the OS still
        // raises it as a banner (see sendLocalNotification for the
        // established iOS pattern).
        this.app._showMeetingProximityNotification(conversationUri, distance);

        // Emit the initiator-only "Meeting succeeded" real chat message for
        // this session. The helper is idempotent across paths — same call
        // happens on meeting_end reason='proximity' reception — so whichever
        // device/path reaches here first wins and the other is deduped. No
        // system note: the chat message carries its own timestamp, which is
        // all the "met at HH:MM" marker we need on both sides.
        this._sendMeetingSucceededIfInitiator(sessionId, conversationUri);

        // Relay meeting_end to the peer BEFORE local wipe, while the
        // NavigationBar timer entry (which carries meetingSessionId) still
        // exists. _wipeMeetingSession calls stopLocationSharing with
        // reason='expired', which is in peerRelayReasons and therefore
        // suppresses the relay — so we fire it explicitly here. The peer
        // will independently hit their own proximity threshold too, but the
        // explicit signal is a belt-and-braces in case one device's GPS is
        // laggy or dropped a tick.
        try {
            if (conversationUri) {
                // reason:'proximity' tells the peer this end was triggered by
                // the proximity-met threshold (not user-initiated / expired /
                // deleted). The peer's meeting_end handler forwards this
                // reason to stopSharesForMeetingSession → stopLocationSharing
                // so the note they emit ("Location sharing stopped at HH:MM")
                // matches the one we just logged locally.
                this.sendMeetingEndSignal(conversationUri, sessionId, {reason: 'proximity'});
            }
        } catch (e) {
            console.log('[meeting] proximity sendMeetingEndSignal failed', e);
        }

        // Full session teardown: stops the local timer, wipes SQL rows,
        // strips in-memory state, deletes meetingSessions[sid].
        this.app._wipeMeetingSession(sessionId, conversationUri, 'proximity');
    }

    // Emit the "Meeting succeeded" chat message when a meeting-session
    // ends via proximity. Called from two independent paths:
    //   • _maybeFireProximityMeet — our own proximity dwell just fired.
    //   • the meeting_end handler with reason='proximity' —
    //     the peer's proximity dwell fired and they signalled us.
    //
    // Both devices may reach one or both of these paths for the same
    // session (each hits its own proximity threshold independently, AND
    // each receives the peer's meeting_end signal). We want a single
    // message per session, so the helper is guarded by
    // _proximityNotedSessionIds — first caller claims the session, later
    // callers are no-ops. Only the initiator (the party whose session id
    // is in myOutgoingMeetingRequestIds) actually sends; the accepter
    // stays silent because they'll receive the initiator's message as a
    // normal incoming chat.
    //
    // Text is intentionally bare ("Meeting succeeded"): the message's
    // own createdAt timestamp supplies the "at HH:MM" display that the
    // transcript already renders next to every bubble. No accompanying
    // system note — the real message is the record of the meetup.
    _sendMeetingSucceededIfInitiator(sessionId, conversationUri) {
        if (!sessionId || !conversationUri) return;
        try {
            if (!this._proximityNotedSessionIds) this._proximityNotedSessionIds = new Set();
            if (this._proximityNotedSessionIds.has(sessionId)) {
                return;
            }
            // Determine initiator directly from myOutgoingMeetingRequestIds
            // (persisted across restarts). Using this rather than the live
            // meetingSessions[sid] entry means the gate still works after
            // a local proximity fire has already wiped the session, which
            // is the usual case on the peer-signal path.
            const isInitiator = !!(this.myOutgoingMeetingRequestIds.has(sessionId));
            // Diagnostic trace was here. Silenced now that the flow
            // is stable; if the user ever reports "no Meeting
            // succeeded message" again, the SESSION ENDED log on
            // both sides + the absence of the Meeting-succeeded
            // chat message together pinpoint the gate.
            if (!isInitiator) return;
            // Claim the session so both proximity paths dedup.
            this._proximityNotedSessionIds.add(sessionId);
            // No separate "Meet-up succeeded" chat message: the frozen meet map
            // already carries that label. Kept the dedup + met-peer bookkeeping.
            // Persist "we've met this peer" — retained so a future feature can
            // key off met-before state.
            if (!this.metPeerUris) this.metPeerUris = new Set();
            if (!this.metPeerUris.has(conversationUri)) {
                this.metPeerUris.add(conversationUri);
                if (typeof this.app._persistMeetingHandshakeState === 'function') {
                    this.app._persistMeetingHandshakeState();
                }
            }
        } catch (e) {
            console.log('[meeting] Meeting-succeeded emit failed', e && e.message ? e.message : e);
        }
    }

}
