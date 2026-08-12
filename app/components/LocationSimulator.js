// LocationSimulator.js
//
// DEBUG: meet-up convergence simulator, extracted from NavigationBar.js.
//
// Drives a per-uri synthetic "walker" that steps toward a shared meeting
// destination and emits ticks through the same pipeline a real GPS fix
// would, so the meet-up convergence flow can be exercised end-to-end
// without two physically-moving devices. Gated behind the caller's
// `enabled` flag (NavigationBar's ENABLE_MEET_SIMULATION); when disabled,
// start() is a no-op and effectiveCoordinatesForSession() simply passes
// real coordinates through untouched, so production builds are unaffected.
//
// The simulator owns its own `_simStates` map (one entry per active sim)
// but it does NOT own the location session itself. The canonical synthetic
// position and the shared destination both live on the location-session
// entry (`entry.simulatedPosition` / `entry.tickExtras.destination`), which
// the owner (NavigationBar today, the location hook later) exposes via the
// injected `getEntry(uri)` accessor. The two engine callbacks it needs —
// `shouldSendUpdateTick` and `sendLocationPayload` — are injected the same
// way, so this module has no direct dependency on the component.
//
// Construction:
//   new LocationSimulator({
//       enabled,                 // boolean — ENABLE_MEET_SIMULATION
//       getEntry,                // (uri) => outgoingLocationSessions[uri] | undefined
//       shouldSendUpdateTick,    // (uri, coords) => boolean
//       sendLocationPayload,    // (uri, coords, expiresAtISO, originLocationId, extras) => void
//       geolocation,             // optional: @react-native-community/geolocation (for the requester-side seed)
//   })

import { haversineMeters, pickMeetingDestinationKm } from './geoUtils';

// The meet-up convergence simulator is no longer gated by this build
// constant — it's driven at runtime by the "Location simulator"
// preference (accountSetting.location.simulatorEnabled), threaded into
// the LocationSimulator as the `enabled` getter and read directly by
// LocationSharingManager via this.host.props.locationSimulatorEnabled.
// This export is retained only for reference / an optional build-time
// hard off; it is not part of the default wiring.
export const ENABLE_MEET_SIMULATION = false;

// Walk tuning. SIM_STEP_INTERVAL_MS is the wall-clock gap between
// synthetic ticks (10 s reads as distinct bubble updates rather than a
// burst of network-retry-looking spam).
//
// Meet-up convergence now walks a LEFT-bulging half-circle arc from each
// side's start position to the shared meeting point (rather than a
// straight line). The inviter (meetingRequest side) sweeps its arc in
// SIM_INVITER_STEPS ticks; the invited (meetingAccept side) in
// SIM_INVITED_STEPS. Same start + same meeting point ⇒ an identical arc
// walked at two different speeds (10 vs 15 ticks), so both trace the same
// half-circle but arrive at different times. Halved from 20/30 to converge
// twice as fast.
const SIM_STEP_INTERVAL_MS = 10000;
const SIM_INVITER_STEPS = 10;
const SIM_INVITED_STEPS = 15;

// When no meeting point (the "3rd point") was chosen, the SENDER (inviter)
// invents one this far away in a random direction from its own start
// position when the simulation begins, then broadcasts it on every tick.
// The invited side never invents — it waits for the shared point.
const SIM_INVENT_DEST_KM = 5;

// Fallback seed when GPS is unavailable (CI, simulator, no location
// service): Amsterdam city centre, so the walker still has somewhere
// plausible to start from.
const SIM_DEFAULT_SEED = { latitude: 52.379189, longitude: 4.899431 };

// ===== DEBUG: "Share Until I Return" round-trip simulator =====
//
// Independent of the meet-up convergence simulator above. Where that
// walker marches two phones toward a shared destination, this one
// drives ONE phone around a CLOSED CIRCULAR LOOP so the caregiver-only
// "Until I return" auto-stop gate (LocationSharingManager
// ._evaluateUntilReturnGate) can be exercised end-to-end without
// actually leaving the desk.
//
// The gate arms on the first tick (captures the origin), flips to
// "departed" once a tick lands more than UNTIL_RETURN_DEPARTURE_M
// (100 m) from that origin, and auto-stops the share on the first
// post-departure tick back inside UNTIL_RETURN_RETURN_M (100 m).
//
// Rather than a straight there-and-back line, the walker traces a circle
// that PASSES THROUGH the origin: the current position is one point ON
// the circle (its southernmost point), and the loop steps all the way
// around and closes back on that exact same point. With
// UNTIL_RETURN_SIM_POINTS = 20 waypoints — the first and last both being
// the origin — the loop sweeps a full 360° in 19 equal arcs (~18.95°
// each) and lands in ~200 s. The circle's radius is
// UNTIL_RETURN_SIM_RADIUS_M, so the farthest waypoint (diametrically
// opposite the origin) sits 2 × radius away.
//
// Each waypoint's distance from the origin is the chord length
// 2·R·sin(θ/2), where the central angle θ sweeps 0 → 360° across the 20
// points (R = 400 m shown):
//
//   tick   1     2     3    ...  10/11  ...   18    19    20
//   θ      0°   ~19°  ~38°  ...  ~180°  ...  ~322° ~341°  360°
//   dist   0    132   247   ...  ~800   ...   247   132    0   (metres)
//   phase origin│──────── outbound ───────│──────── return ──────│stop
//
// tick 1 captures the origin (0 m); tick 2 crosses 100 m → departed;
// every interior tick stays OUTSIDE the 100 m ring (the penultimate
// tick 19 is ~132 m, deliberately >100 so the gate does NOT fire early);
// tick 20 closes the circle back on the origin (0 m ≤ 100 m) → the gate
// calls stopLocationSharing({reason:'returned'}) and the share ends
// after exactly twenty ticks. The default radius (400 m) keeps that
// penultimate tick well clear of the return ring; shrinking it below
// ~310 m would let tick 19 dip inside 100 m and stop the share a tick
// early.
//
// The location-track walkers (round-trip + random walk) are no longer
// gated by a build constant — they're driven at runtime by the
// "Location simulator" preference (accountSetting.location.simulatorEnabled),
// threaded into the LocationSimulator as the `trackEnabled` getter and
// checked via _isTrackEnabled(). This export is retained only as an
// optional hard OFF for builds that want to force the walkers off
// regardless of the pref; it is not referenced by the default wiring.
export const ENABLE_UNTIL_RETURN_SIMULATION = false;

// Number of waypoints in the closed circular loop. The first and last
// are BOTH the origin (the loop closes on the same point), so with 20
// points the walker sweeps a full 360° in 19 equal arcs of ~18.95°.
// Overridable via opts.points.
const UNTIL_RETURN_SIM_POINTS = 20;

// Radius of the circle the walker traces (metres). The origin sits ON
// the circle, so the farthest waypoint is 2 × radius away. 400 m keeps
// every tick except the origin touches well outside the 100 m return
// ring — in particular the penultimate tick (~132 m at R = 400) — so the
// gate fires only on the final origin-closing tick. Keep it above ~310 m
// or the second-to-last tick drops inside the 100 m ring and the gate
// stops one tick early. Overridable via opts.radiusMeters.
const UNTIL_RETURN_SIM_RADIUS_M = 400;

// Random-walk ("normal track") simulator. Unlike the round-trip walker
// this never returns and never auto-stops — it meanders via a CORRELATED
// random walk (heading drifts a little each tick rather than jumping)
// and keeps emitting until the user stops it (or the share ends), so a
// plain live / fixed-duration share can be exercised with a moving track
// on the map. Each tick steps RANDOM_WALK_STEP_METERS along a heading
// that turns by up to ±RANDOM_WALK_TURN_RAD.
const RANDOM_WALK_STEP_METERS = 40;
const RANDOM_WALK_TURN_RAD = Math.PI / 3; // ±60° heading jitter per tick

// Metres per degree of latitude — used by the random walk to convert a
// step in metres to a lat/lng delta. Longitude is scaled by cos(lat).
const METERS_PER_DEG_LAT = 111320;

function log(msg) {
    try {
        // eslint-disable-next-line global-require
        const utils = require('../utils');
        utils.timestampedLog(msg);
    } catch (e) { /* noop */ }
}

export default class LocationSimulator {
    constructor({ enabled, trackEnabled, getEntry, shouldSendUpdateTick, sendLocationPayload, geolocation } = {}) {
        // Master switch for the meet-up convergence sim (start()). Driven
        // by the "Location simulator" preference, so it may be a live
        // getter (preferred) or a plain boolean. Defaults off.
        this._enabled = enabled;
        // Runtime switch for the location-track walkers (startUntilReturn
        // / startRandomWalk). Same "Location simulator" preference — a
        // function that reads the live pref each call (or a plain boolean).
        this._trackEnabled = trackEnabled;
        this._getEntry = getEntry;
        this._shouldSendUpdateTick = shouldSendUpdateTick;
        this._sendLocationPayload = sendLocationPayload;
        this._geolocation = geolocation || null;
        // Map<uri, { stepMeters, intervalMs, timerId }>
        this._simStates = {};
    }

    // Resolve the meet-sim runtime switch: accepts either a live getter
    // (preferred — reads the current preference) or a plain boolean.
    _isEnabled() {
        const e = this._enabled;
        return typeof e === 'function' ? !!e() : !!e;
    }

    // Resolve the track-sim runtime switch: accepts either a live getter
    // (preferred — reads the current preference) or a plain boolean.
    _isTrackEnabled() {
        const t = this._trackEnabled;
        return typeof t === 'function' ? !!t() : !!t;
    }

    // Returns the coordinates that should ride on this session's next
    // outgoing tick. When the entry has a simulatedPosition installed
    // (today: accepter side gets one on share start, 10 km from real
    // GPS), real GPS is bypassed and the synthetic position is reported
    // instead. The simulator mutates entry.simulatedPosition as it walks,
    // so all natural tick paths (initial fix, iOS watchPosition, Android
    // interval) and the simulator's own emits see the same moving point.
    //
    // When the entry has no simulatedPosition the real GPS fix passed in
    // is returned untouched — production builds (enabled === false never
    // install a simulatedPosition) fall straight through this helper.
    effectiveCoordinatesForSession(uri, realCoords) {
        const entry = this._getEntry(uri);
        if (entry && entry.simulatedPosition) {
            return {
                latitude: entry.simulatedPosition.latitude,
                longitude: entry.simulatedPosition.longitude,
                accuracy: typeof entry.simulatedPosition.accuracy === 'number'
                    ? entry.simulatedPosition.accuracy : 5,
                timestamp: Date.now(),
            };
        }
        return realCoords;
    }

    // Public entry (was simulateConvergence). Spins up a per-uri walker
    // that sweeps a LEFT-bulging half-circle arc from this side's start
    // position to the shared meeting point stored on
    // entry.tickExtras.destination. Both devices arc onto the same fixed
    // point so they converge there deterministically. Idempotent: a
    // second call replaces any in-flight sim for the same uri.
    //
    // Role decides the tick count: the inviter (meetingRequest side) walks
    // its arc in SIM_INVITER_STEPS ticks, the invited (meetingAccept side)
    // in SIM_INVITED_STEPS — so an identical arc is traced at two speeds.
    //
    // The meeting point (the "3rd point") is the SENDER's to set: if one
    // was chosen it is used as-is; if not, the inviter invents one
    // SIM_INVENT_DEST_KM away in a random bearing when the sim starts and
    // broadcasts it on every tick. The invited side never invents — if it
    // starts before the point arrives it holds position until it does.
    //
    // Bootstraps the start coord from the most recent real GPS fix so the
    // first synthetic tick lands on a plausible position; falls back to
    // SIM_DEFAULT_SEED when GPS is unavailable.
    start(uri, opts = {}) {
        if (!this._isEnabled()) return;
        if (!uri) return;
        const entry = this._getEntry(uri);
        if (!entry) {
            console.log('[sim] simulateConvergence: no active share for', uri);
            return;
        }
        const intervalMs = (opts && opts.intervalMs) || SIM_STEP_INTERVAL_MS;
        // Role → step count. Anything that isn't the invited (accept) side
        // is treated as the inviter, so a plain requester share still walks
        // the 20-tick arc.
        const isInviter = entry.kind !== 'meetingAccept';
        const steps = (opts && opts.steps)
            || (isInviter ? SIM_INVITER_STEPS : SIM_INVITED_STEPS);

        const startTimer = () => {
            // Stop any previous sim for this uri.
            const prev = this._simStates[uri];
            if (prev && prev.timerId) {
                clearInterval(prev.timerId);
            }
            const startCoord = entry.simulatedPosition;
            // The SENDER owns the meeting point. If none (the "3rd point")
            // was chosen, invent one SIM_INVENT_DEST_KM away in a random
            // bearing from the sender's start and stamp it onto tickExtras
            // so every outgoing tick broadcasts it. The invited side never
            // invents — it waits for this shared point (see _tick).
            let dest = entry.tickExtras && entry.tickExtras.destination;
            if (!dest && isInviter && startCoord) {
                dest = pickMeetingDestinationKm(startCoord, SIM_INVENT_DEST_KM);
                if (dest && entry.tickExtras) {
                    entry.tickExtras.destination = dest;
                    log(
                        `[sim] inviter invented meeting point → ${dest.latitude.toFixed(5)},${dest.longitude.toFixed(5)}`
                        + ` (~${SIM_INVENT_DEST_KM} km, random bearing)`
                    );
                }
            }
            // Precompute the left half-circle arc when both endpoints are
            // known; otherwise leave it null and let _tick build it once
            // the sender's point arrives.
            const waypoints = (startCoord && dest)
                ? this._buildLeftArc(startCoord, dest, steps)
                : null;
            this._simStates[uri] = {
                mode: 'converge',
                waypoints,
                steps,
                isInviter,
                stepIndex: 0,
                intervalMs,
                timerId: setInterval(() => {
                    this._tick(uri);
                }, intervalMs),
            };
            try {
                if (startCoord) {
                    const sLat = startCoord.latitude.toFixed(5);
                    const sLng = startCoord.longitude.toFixed(5);
                    const sUrl = `https://maps.google.com/?q=${sLat},${sLng}`;
                    const role = isInviter ? 'inviter' : 'invited';
                    log(
                        `[sim] CONVERGE ${role} START for ${uri} → ${sLat},${sLng} (${sUrl})`
                        + ` left half-circle in ${steps} ticks every ${intervalMs / 1000}s`
                        + ` (≈ ${(steps * intervalMs / 1000).toFixed(0)}s)`
                    );
                    if (dest) {
                        const dLat = dest.latitude.toFixed(5);
                        const dLng = dest.longitude.toFixed(5);
                        const distKm = (haversineMeters(startCoord, dest) / 1000).toFixed(2);
                        const dUrl = `https://maps.google.com/?q=${dLat},${dLng}`;
                        log(
                            `[sim] MEETING POINT for ${uri} → ${dLat},${dLng} (${dUrl}) straight-line ${distKm} km from start`
                        );
                    } else {
                        log(
                            `[sim] MEETING POINT for ${uri} → not yet known; holding until the sender's point arrives`
                        );
                    }
                }
            } catch (e) { /* noop */ }
            // Fire one tick right away so the user sees motion without
            // waiting a full interval for the first synthetic position.
            this._tick(uri);
        };

        // entry.simulatedPosition is the canonical synthetic position for
        // this session. The accepter side already has one armed at share
        // start (real GPS + 10 km random offset), so we just kick off the
        // timer and walk it. The requester side hasn't been seeded yet —
        // fetch real GPS once, install it, then start.
        if (entry.simulatedPosition) {
            startTimer();
            return;
        }

        const seed = (coord) => {
            const e = this._getEntry(uri);
            if (!e) return;
            e.simulatedPosition = {
                latitude: coord.latitude,
                longitude: coord.longitude,
                accuracy: 5,
                timestamp: Date.now(),
            };
            startTimer();
        };

        const Geolocation = this._geolocation;
        if (Geolocation && typeof Geolocation.getCurrentPosition === 'function') {
            Geolocation.getCurrentPosition(
                (pos) => {
                    const c = pos && pos.coords ? pos.coords : {};
                    if (typeof c.latitude === 'number' && typeof c.longitude === 'number') {
                        seed({ latitude: c.latitude, longitude: c.longitude });
                    } else {
                        seed({ ...SIM_DEFAULT_SEED });
                    }
                },
                () => seed({ ...SIM_DEFAULT_SEED }),
                { timeout: 3000, maximumAge: 60000, enableHighAccuracy: false }
            );
        } else {
            seed({ ...SIM_DEFAULT_SEED });
        }
    }

    // Build a LEFT-bulging half-circle arc of `steps` waypoints from
    // `start` to `dest`. The straight start→dest segment is the arc's
    // diameter (centre = midpoint, radius = half that distance); the arc
    // sweeps 180° and bulges to the LEFT of the start→dest heading, so the
    // walker curves out and comes back onto the meeting point. Computed in
    // a local east/north metre frame (longitude scaled by cos(lat) so the
    // circle stays round). waypoint[0] is the start; waypoint[steps-1] is
    // forced to exactly `dest` so both sides land on the same point.
    _buildLeftArc(start, dest, steps) {
        const n = Math.max(steps, 2);
        const cosLat = Math.cos(start.latitude * Math.PI / 180) || 1;
        // Destination offset from start, in local east/north metres.
        const eD = (dest.longitude - start.longitude) * METERS_PER_DEG_LAT * cosLat;
        const nD = (dest.latitude - start.latitude) * METERS_PER_DEG_LAT;
        const radius = Math.sqrt(eD * eD + nD * nD) / 2;
        // Arc centre = midpoint of start↔dest, same local frame.
        const mE = eD / 2;
        const mN = nD / 2;
        // Central angle of the START point (relative to the centre).
        // Sweeping it by −180° (clockwise) traces the LEFT half-circle onto
        // the destination; +180° would trace the right-hand one.
        const theta0 = Math.atan2(-nD, -eD);
        const wps = [];
        for (let k = 0; k < n; k++) {
            const f = k / (n - 1);
            const ang = theta0 - Math.PI * f;
            const east = mE + radius * Math.cos(ang);
            const north = mN + radius * Math.sin(ang);
            wps.push({
                latitude: start.latitude + north / METERS_PER_DEG_LAT,
                longitude: start.longitude + east / (METERS_PER_DEG_LAT * cosLat),
                accuracy: 5,
            });
        }
        // Force the final waypoint to be exactly the destination so both
        // sides converge on the identical meeting point (guards fp drift).
        wps[n - 1] = {
            latitude: dest.latitude,
            longitude: dest.longitude,
            accuracy: 5,
        };
        return wps;
    }

    // Internal — fired every intervalMs while a convergence sim is active.
    // Advances entry.simulatedPosition to the next precomputed arc waypoint
    // and emits it through the regular sendLocationPayload pipeline. Tears
    // the timer down after the final waypoint (the meeting point).
    _tick(uri) {
        const sim = this._simStates[uri];
        if (!sim || sim.mode !== 'converge') return;
        const entry = this._getEntry(uri);
        // Share was torn down (user stopped, expiration, peer cancelled).
        // Auto-stop the simulator so a stale interval doesn't keep firing
        // and burning a sendMessage every couple of seconds.
        if (!entry || !entry.simulatedPosition) {
            if (sim.timerId) clearInterval(sim.timerId);
            delete this._simStates[uri];
            return;
        }

        // Arc not built yet — the invited side started before the sender's
        // meeting point arrived. Build it the moment a destination shows up
        // (anchored on the current position); until then, hold here so the
        // pin stays alive.
        if (!sim.waypoints) {
            const dest = entry.tickExtras && entry.tickExtras.destination;
            const haveDest = dest
                && typeof dest.latitude === 'number'
                && typeof dest.longitude === 'number';
            if (haveDest) {
                sim.waypoints = this._buildLeftArc(entry.simulatedPosition, dest, sim.steps);
                sim.stepIndex = 0;
                log(
                    `[sim] CONVERGE ${sim.isInviter ? 'inviter' : 'invited'} — meeting point arrived,`
                    + ` building ${sim.steps}-tick left arc for ${uri}`
                );
            } else {
                // Nothing to walk toward yet. Re-emit the current position
                // (no destination) so the share stays live, and wait.
                if (this._shouldSendUpdateTick(uri, entry.simulatedPosition)) {
                    this._sendLocationPayload(
                        uri,
                        { ...entry.simulatedPosition },
                        new Date(entry.expiresAt).toISOString(),
                        entry.originLocationId,
                        // Carry the inviter's meet flag here too — the "waiting,
                        // no destination yet" hold path must not strip the meet
                        // identity from the inviter's ticks (else plain-share
                        // trail + slider reappear on the sender).
                        { meetingRequest: !!sim.isInviter, inReplyTo: entry.inReplyTo, destination: undefined }
                    );
                }
                return;
            }
        }

        const i = sim.stepIndex;
        const wp = sim.waypoints[i];
        if (!wp) {
            // Defensive: index past the end (arrival should have cleared the
            // timer on the last waypoint already).
            if (sim.timerId) clearInterval(sim.timerId);
            delete this._simStates[uri];
            return;
        }
        entry.simulatedPosition = {
            latitude: wp.latitude,
            longitude: wp.longitude,
            accuracy: typeof wp.accuracy === 'number' ? wp.accuracy : 5,
            timestamp: Date.now(),
        };
        sim.stepIndex = i + 1;
        // The final waypoint is exactly the meeting point.
        const arrivedThisStep = (i >= sim.waypoints.length - 1);

        // Emit through the same gate the real-GPS path uses so the
        // privacy-radius logic still applies during simulated walks.
        if (this._shouldSendUpdateTick(uri, entry.simulatedPosition)) {
            const tickExtras = {
                // Carry the INVITER's meet flag so sendLocationPayload stamps
                // meeting_request + role='inviter' on the wire. Hardcoding false
                // (as before) stripped the meet identity from the inviter's
                // convergence ticks — its bubble then read as a plain share, so
                // a movement trail AND the scrub slider appeared on the SENDER
                // only (the invited leg still got role='invited' via inReplyTo).
                meetingRequest: !!sim.isInviter,
                inReplyTo: entry.inReplyTo,
                destination: entry.tickExtras && entry.tickExtras.destination,
            };
            this._sendLocationPayload(
                uri,
                { ...entry.simulatedPosition },
                new Date(entry.expiresAt).toISOString(),
                entry.originLocationId,
                tickExtras
            );
        }
        try {
            const dNow = entry.tickExtras && entry.tickExtras.destination;
            const remain = dNow ? Math.round(haversineMeters(entry.simulatedPosition, dNow)) : null;
            log(
                `[sim] CONVERGE ${sim.isInviter ? 'inviter' : 'invited'} tick ${i + 1}/${sim.waypoints.length} for ${uri}`
                + (remain != null ? ` (${remain}m to meeting point)` : '')
            );
        } catch (e) { /* noop */ }

        if (arrivedThisStep) {
            // Walker reached the meeting point — PARK here, do NOT stop the
            // walker. If we cleared the sim (delete _simStates), the share
            // reverts to real GPS on the next watchPosition fire and the pin
            // JUMPS off the meeting point back to the device's real location.
            // The first party to arrive would then leave the meeting point
            // before the second party gets there, so the two are never
            // co-located and proximity-met (which concludes the meet with its
            // "arrived / meeting succeeded" announcements) never fires.
            //
            // Instead, clamp stepIndex to the final waypoint so every
            // subsequent tick RE-EMITS the meeting point: the parked party
            // stays put until BOTH are here, proximity-met fires, the meet is
            // concluded and the share torn down — at which point entry (and its
            // simulatedPosition) disappears and the guard at the top of _tick
            // clears this parked walker on its next fire.
            if (!sim.parked) {
                sim.parked = true;
                log(`[sim] convergence reached meeting point — parking walker at meeting point for ${uri} (holds until both meet)`);
            }
            sim.stepIndex = sim.waypoints.length - 1;
        }
    }

    // Public. Drives the round-trip "Until I return" walker for `uri`.
    // Seeds entry.simulatedPosition from the latest real GPS fix (falls
    // back to SIM_DEFAULT_SEED) and walks it around the closed circular
    // loop above (origin ON the circle, UNTIL_RETURN_SIM_POINTS waypoints
    // closing back on that same origin), emitting one tick per intervalMs.
    // The auto-stop is owned by LocationSharingManager's gate — this walker
    // only supplies the positions and tears its own timer down after the
    // final emit (or when the share disappears underneath it). Idempotent:
    // a second call replaces any in-flight sim for the same uri.
    //
    // NOTE: start the "Until I return" share WITHOUT a privacy radius —
    // _shouldSendUpdateTick swallows the first ticks inside a privacy
    // circle, which would starve the gate of its origin tick and throw
    // the 10-tick geometry off.
    startUntilReturn(uri, opts = {}) {
        if (!this._isTrackEnabled()) return;
        if (!uri) return;
        const entry = this._getEntry(uri);
        if (!entry) {
            console.log('[sim] startUntilReturn: no active share for', uri);
            return;
        }
        const intervalMs = (opts && opts.intervalMs) || SIM_STEP_INTERVAL_MS;
        const radiusMeters = (opts && opts.radiusMeters) || UNTIL_RETURN_SIM_RADIUS_M;
        const points = (opts && opts.points) || UNTIL_RETURN_SIM_POINTS;

        const begin = (originCoord) => {
            const e = this._getEntry(uri);
            if (!e) return;
            // Build the closed circular loop once. The origin (current
            // position) is the SOUTHERNMOST point of a circle of radius
            // `radiusMeters` whose centre sits due north of it; the walker
            // steps once all the way around and closes back on that exact
            // point. `points` waypoints span a full 360° in (points - 1)
            // equal arcs, so waypoint[0] and waypoint[points-1] are both the
            // origin. Latitude converts via a fixed metres-per-degree;
            // longitude is additionally scaled by cos(lat) so the circle
            // stays round rather than egg-shaped, and haversine(origin,
            // waypoint) tracks the intended chord 2·R·sin(θ/2) the gate
            // keys on.
            const cosLat = Math.cos(originCoord.latitude * Math.PI / 180) || 1;
            const n = Math.max(points, 3);
            const waypoints = [];
            for (let k = 0; k < n; k++) {
                // Central angle of this waypoint, measured at the circle's
                // centre and starting from the origin at the bottom (-90°),
                // swept once around the full circle.
                const phi = (-90 + (k / (n - 1)) * 360) * Math.PI / 180;
                const northOffset = radiusMeters * (1 + Math.sin(phi));
                const eastOffset = radiusMeters * Math.cos(phi);
                // θ = central angle swept FROM the origin; chord = 2R·sin(θ/2).
                const halfSweep = (k / (n - 1)) * Math.PI; // θ/2 in radians
                waypoints.push({
                    latitude: originCoord.latitude + northOffset / METERS_PER_DEG_LAT,
                    longitude: originCoord.longitude
                        + eastOffset / (METERS_PER_DEG_LAT * cosLat),
                    accuracy: 5,
                    dist: 2 * radiusMeters * Math.sin(halfSweep),
                });
            }
            // Force the closing waypoint to be EXACTLY the origin so the
            // loop shuts on the same point the gate captured on tick 1
            // (guards against sub-millimetre trig round-off at 360°).
            waypoints[n - 1] = {
                latitude: originCoord.latitude,
                longitude: originCoord.longitude,
                accuracy: 5,
                dist: 0,
            };
            // Seed the canonical synthetic position at the origin so the
            // first tick (and any real watch fix in the meantime) reports
            // the origin, matching waypoint[0].
            e.simulatedPosition = {
                latitude: originCoord.latitude,
                longitude: originCoord.longitude,
                accuracy: 5,
                timestamp: Date.now(),
            };
            // Stop any previous sim for this uri.
            const prev = this._simStates[uri];
            if (prev && prev.timerId) {
                clearInterval(prev.timerId);
            }
            this._simStates[uri] = {
                mode: 'untilReturn',
                waypoints,
                radiusMeters,
                stepIndex: 0,
                intervalMs,
                timerId: setInterval(() => {
                    this._untilReturnTick(uri);
                }, intervalMs),
            };
            try {
                const oLat = originCoord.latitude.toFixed(5);
                const oLng = originCoord.longitude.toFixed(5);
                const oUrl = `https://maps.google.com/?q=${oLat},${oLng}`;
                log(
                    `[sim] UNTIL-RETURN circular loop START for ${uri} → origin ${oLat},${oLng} (${oUrl})`
                    + ` ${waypoints.length} ticks around a ${radiusMeters} m-radius circle,`
                    + ` farthest ${2 * radiusMeters} m, every ${intervalMs / 1000}s`
                    + ` (auto-stop expected on tick ${waypoints.length})`
                );
            } catch (err) { /* noop */ }
            // Fire tick 1 (the origin) right away so the user sees the
            // walk begin without waiting a full interval.
            this._untilReturnTick(uri);
        };

        // Prefer a real GPS fix so the loop sits over the user's actual
        // position; fall back to SIM_DEFAULT_SEED when GPS is unavailable.
        // If a synthetic position is somehow already armed, reuse it.
        if (entry.simulatedPosition) {
            begin(entry.simulatedPosition);
            return;
        }
        const Geolocation = this._geolocation;
        if (Geolocation && typeof Geolocation.getCurrentPosition === 'function') {
            Geolocation.getCurrentPosition(
                (pos) => {
                    const c = pos && pos.coords ? pos.coords : {};
                    if (typeof c.latitude === 'number' && typeof c.longitude === 'number') {
                        begin({ latitude: c.latitude, longitude: c.longitude });
                    } else {
                        begin({ ...SIM_DEFAULT_SEED });
                    }
                },
                () => begin({ ...SIM_DEFAULT_SEED }),
                { timeout: 3000, maximumAge: 60000, enableHighAccuracy: false }
            );
        } else {
            begin({ ...SIM_DEFAULT_SEED });
        }
    }

    // Internal — fires every intervalMs while a round-trip sim is active.
    // Advances entry.simulatedPosition to the next precomputed waypoint,
    // emits it through the regular sendLocationPayload pipeline (so the
    // "Until I return" gate sees it), and tears the timer down after the
    // final waypoint. The gate stops the SHARE on the last tick; this
    // only stops the WALKER.
    _untilReturnTick(uri) {
        const sim = this._simStates[uri];
        if (!sim || sim.mode !== 'untilReturn') return;
        const entry = this._getEntry(uri);
        // Share torn down (gate auto-stopped on the return tick, user
        // stopped, expiry). Kill the walker so a stale interval doesn't
        // keep firing.
        if (!entry || !entry.simulatedPosition) {
            if (sim.timerId) clearInterval(sim.timerId);
            delete this._simStates[uri];
            return;
        }
        const i = sim.stepIndex;
        if (i >= sim.waypoints.length) {
            // All waypoints emitted — nothing left to walk. (The gate
            // normally stops the share on the final origin-closing tick
            // before we reach here; if it didn't — e.g. this ran on a
            // non-untilIReturn share — hand control back to real GPS by
            // dropping the synthetic point.)
            if (sim.timerId) clearInterval(sim.timerId);
            delete this._simStates[uri];
            entry.simulatedPosition = null;
            log(`[sim] UNTIL-RETURN round-trip complete for ${uri} — walker stopped`);
            return;
        }
        const wp = sim.waypoints[i];
        entry.simulatedPosition = {
            latitude: wp.latitude,
            longitude: wp.longitude,
            accuracy: typeof wp.accuracy === 'number' ? wp.accuracy : 5,
            timestamp: Date.now(),
        };
        sim.stepIndex = i + 1;

        // Emit through the same gate the real-GPS path uses. Reuse the
        // entry's own tickExtras (a plain live share has no meet
        // destination) so the wire shape matches a natural tick exactly.
        if (this._shouldSendUpdateTick(uri, entry.simulatedPosition)) {
            this._sendLocationPayload(
                uri,
                { ...entry.simulatedPosition },
                new Date(entry.expiresAt).toISOString(),
                entry.originLocationId,
                entry.tickExtras
            );
        }
        try {
            const wpDist = (sim.waypoints[i] && sim.waypoints[i].dist) || 0;
            log(
                `[sim] UNTIL-RETURN tick ${i + 1}/${sim.waypoints.length} for ${uri}`
                + ` (~${Math.round(wpDist)}m from origin)`
            );
        } catch (err) { /* noop */ }
    }

    // Public. Drives the "normal track" random-walk walker for `uri`.
    // Seeds entry.simulatedPosition from the latest real GPS fix (falls
    // back to SIM_DEFAULT_SEED) and then meanders it via a correlated
    // random walk, emitting one tick per intervalMs. There is NO
    // termination condition — it runs until stop(uri) is called or the
    // share is torn down — so it is the right tool for a plain live /
    // fixed-duration share (which has no auto-stop gate). Idempotent: a
    // second call replaces any in-flight sim for the same uri.
    //
    // NOTE: as with the round-trip walker, start the share WITHOUT a
    // privacy radius — _shouldSendUpdateTick would otherwise swallow the
    // ticks that sit inside the privacy circle.
    startRandomWalk(uri, opts = {}) {
        if (!this._isTrackEnabled()) return;
        if (!uri) return;
        const entry = this._getEntry(uri);
        if (!entry) {
            console.log('[sim] startRandomWalk: no active share for', uri);
            return;
        }
        const intervalMs = (opts && opts.intervalMs) || SIM_STEP_INTERVAL_MS;
        const stepMeters = (opts && opts.stepMeters) || RANDOM_WALK_STEP_METERS;

        const begin = (originCoord) => {
            const e = this._getEntry(uri);
            if (!e) return;
            e.simulatedPosition = {
                latitude: originCoord.latitude,
                longitude: originCoord.longitude,
                accuracy: 5,
                timestamp: Date.now(),
            };
            const prev = this._simStates[uri];
            if (prev && prev.timerId) {
                clearInterval(prev.timerId);
            }
            this._simStates[uri] = {
                mode: 'randomWalk',
                stepMeters,
                // Departure anchor — every step is steered along the
                // outward radial from here so distance keeps increasing.
                origin: {
                    latitude: originCoord.latitude,
                    longitude: originCoord.longitude,
                },
                // Seed heading for the very first step (before there's an
                // origin→current radial to follow).
                heading: Math.random() * 2 * Math.PI,
                intervalMs,
                timerId: setInterval(() => {
                    this._randomWalkTick(uri);
                }, intervalMs),
            };
            try {
                const oLat = originCoord.latitude.toFixed(5);
                const oLng = originCoord.longitude.toFixed(5);
                const oUrl = `https://maps.google.com/?q=${oLat},${oLng}`;
                log(
                    `[sim] RANDOM-WALK START for ${uri} → origin ${oLat},${oLng} (${oUrl})`
                    + ` step=${stepMeters} m every ${intervalMs / 1000}s (runs until stopped)`
                );
            } catch (err) { /* noop */ }
            // Fire the origin tick right away so the track starts moving
            // without waiting a full interval.
            this._randomWalkTick(uri);
        };

        if (entry.simulatedPosition) {
            begin(entry.simulatedPosition);
            return;
        }
        const Geolocation = this._geolocation;
        if (Geolocation && typeof Geolocation.getCurrentPosition === 'function') {
            Geolocation.getCurrentPosition(
                (pos) => {
                    const c = pos && pos.coords ? pos.coords : {};
                    if (typeof c.latitude === 'number' && typeof c.longitude === 'number') {
                        begin({ latitude: c.latitude, longitude: c.longitude });
                    } else {
                        begin({ ...SIM_DEFAULT_SEED });
                    }
                },
                () => begin({ ...SIM_DEFAULT_SEED }),
                { timeout: 3000, maximumAge: 60000, enableHighAccuracy: false }
            );
        } else {
            begin({ ...SIM_DEFAULT_SEED });
        }
    }

    // Internal — fires every intervalMs while a random-walk sim is
    // active. Drifts the heading a little (correlated walk), steps the
    // synthetic position, and emits it through the regular pipeline. No
    // stop condition: it walks until stop(uri) is called or the share
    // disappears underneath it (user stopped / expiry).
    _randomWalkTick(uri) {
        const sim = this._simStates[uri];
        if (!sim || sim.mode !== 'randomWalk') return;
        const entry = this._getEntry(uri);
        if (!entry || !entry.simulatedPosition) {
            if (sim.timerId) clearInterval(sim.timerId);
            delete this._simStates[uri];
            return;
        }
        const cur = entry.simulatedPosition;
        const cosLat = Math.cos(cur.latitude * Math.PI / 180) || 1;
        // Outward-biased walk: steer along the radial pointing AWAY from
        // the departure anchor, plus a ±RANDOM_WALK_TURN_RAD (<90°)
        // jitter for a natural meander. Because every step stays within
        // 90° of "away", its radial component is always positive, so the
        // distance from origin keeps increasing — no walking back and
        // forth. The very first step (current == origin, radial
        // undefined) falls back to the seeded random heading.
        const oEast = (cur.longitude - sim.origin.longitude) * cosLat * METERS_PER_DEG_LAT;
        const oNorth = (cur.latitude - sim.origin.latitude) * METERS_PER_DEG_LAT;
        const distFromOrigin = Math.sqrt(oEast * oEast + oNorth * oNorth);
        if (distFromOrigin > 1) {
            // atan2(east, north): 0 = due north, +→east — same convention
            // the step math below uses (dNorth=cos, dEast=sin).
            const radial = Math.atan2(oEast, oNorth);
            sim.heading = radial + (Math.random() - 0.5) * 2 * RANDOM_WALK_TURN_RAD;
        }
        const dNorth = sim.stepMeters * Math.cos(sim.heading);
        const dEast = sim.stepMeters * Math.sin(sim.heading);
        entry.simulatedPosition = {
            latitude: cur.latitude + dNorth / METERS_PER_DEG_LAT,
            longitude: cur.longitude + dEast / (METERS_PER_DEG_LAT * cosLat),
            accuracy: 5,
            timestamp: Date.now(),
        };

        if (this._shouldSendUpdateTick(uri, entry.simulatedPosition)) {
            this._sendLocationPayload(
                uri,
                { ...entry.simulatedPosition },
                new Date(entry.expiresAt).toISOString(),
                entry.originLocationId,
                entry.tickExtras
            );
        }
    }

    // Public (was stopSimulation).
    stop(uri) {
        const st = this._simStates[uri];
        if (!st) return;
        if (st.timerId) {
            clearInterval(st.timerId);
        }
        // For the debug round-trip / random-walk walkers, hand control
        // back to real GPS by dropping the synthetic position so a share
        // that keeps running after the sim is stopped resumes reporting
        // the real device location. The meet-up convergence sim leaves
        // its position in place (unchanged behaviour).
        if (st.mode === 'randomWalk' || st.mode === 'untilReturn') {
            const entry = this._getEntry(uri);
            if (entry) {
                entry.simulatedPosition = null;
            }
        }
        delete this._simStates[uri];
        log(`[sim] simulation stopped for ${uri}`);
    }

    isSimulating(uri) {
        return !!this._simStates[uri];
    }

    // Stop every active walker (used on unmount / logout teardown).
    stopAll() {
        Object.keys(this._simStates).forEach((uri) => this.stop(uri));
    }
}
