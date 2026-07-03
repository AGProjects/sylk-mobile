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
// `shouldSendUpdateTick` and `sendLocationMetadata` — are injected the same
// way, so this module has no direct dependency on the component.
//
// Construction:
//   new LocationSimulator({
//       enabled,                 // boolean — ENABLE_MEET_SIMULATION
//       getEntry,                // (uri) => locationTimers[uri] | undefined
//       shouldSendUpdateTick,    // (uri, coords) => boolean
//       sendLocationMetadata,    // (uri, coords, expiresAtISO, originMetadataId, extras) => void
//       geolocation,             // optional: @react-native-community/geolocation (for the requester-side seed)
//   })

import { haversineMeters, pickMeetingDestinationKm } from './geoUtils';

// Master switch for the meet-up convergence simulator. Production builds
// keep this false; flip to true to exercise the converge flow end-to-end
// without two physically-moving devices. Exported as the single source of
// truth — both NavigationBar (menu/render gating) and
// LocationSharingManager (share-start seeding) import it from here.
export const ENABLE_MEET_SIMULATION = false;

// Walk tuning. SIM_STEP_INTERVAL_MS is the wall-clock gap between
// synthetic ticks (10 s reads as distinct bubble updates rather than a
// burst of network-retry-looking spam). With SIM_TICKS_TO_CONVERGE = 5
// the whole meet-up lands in ~50 s — long enough to watch the pins
// march, short enough that nobody loses patience in a test session.
// SIM_STEP_METERS is only the fallback per-step distance used until a
// destination is known; once it is, the per-step distance is recomputed
// so each side arrives in exactly SIM_TICKS_TO_CONVERGE ticks.
const SIM_STEP_INTERVAL_MS = 10000;
const SIM_STEP_METERS = 50;
const SIM_TICKS_TO_CONVERGE = 5;

// Fallback seed when GPS is unavailable (CI, simulator, no location
// service): Amsterdam city centre, so the walker still has somewhere
// plausible to start from.
const SIM_DEFAULT_SEED = { latitude: 52.379189, longitude: 4.899431 };

function log(msg) {
    try {
        // eslint-disable-next-line global-require
        const utils = require('../utils');
        utils.timestampedLog(msg);
    } catch (e) { /* noop */ }
}

export default class LocationSimulator {
    constructor({ enabled, getEntry, shouldSendUpdateTick, sendLocationMetadata, geolocation } = {}) {
        this._enabled = !!enabled;
        this._getEntry = getEntry;
        this._shouldSendUpdateTick = shouldSendUpdateTick;
        this._sendLocationMetadata = sendLocationMetadata;
        this._geolocation = geolocation || null;
        // Map<uri, { stepMeters, intervalMs, timerId }>
        this._simStates = {};
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
    // that steps toward the shared meeting destination stored on
    // entry.tickExtras.destination. Both devices walk to the same fixed
    // point so they converge there deterministically. Idempotent: a
    // second call replaces any in-flight sim for the same uri.
    //
    // Bootstraps the start coord from the most recent real GPS fix so the
    // first synthetic tick lands on a plausible position; falls back to
    // SIM_DEFAULT_SEED when GPS is unavailable. If no destination is known
    // yet, the tick path synthesises a 4 km random offset and stamps it
    // onto tickExtras.destination so subsequent outgoing ticks broadcast it.
    start(uri, opts = {}) {
        if (!this._enabled) return;
        if (!uri) return;
        const entry = this._getEntry(uri);
        if (!entry) {
            console.log('[sim] simulateConvergence: no active share for', uri);
            return;
        }
        const stepMeters = (opts && opts.stepMeters) || SIM_STEP_METERS;
        const intervalMs = (opts && opts.intervalMs) || SIM_STEP_INTERVAL_MS;

        const startTimer = () => {
            // Stop any previous sim for this uri.
            const prev = this._simStates[uri];
            if (prev && prev.timerId) {
                clearInterval(prev.timerId);
            }
            // Compute the per-step distance so this side reaches the
            // destination in exactly SIM_TICKS_TO_CONVERGE ticks. Each
            // side computes independently from its own starting point, so
            // the requester (~4 km away) and the accepter (~10 km away
            // from the synthetic seed) both arrive at the same time even
            // though their distances differ. If the destination isn't
            // known yet we fall back to SIM_STEP_METERS — the in-tick
            // synthesised target path recomputes when a real one shows up.
            let perStepMeters = stepMeters;
            const destNow0 = entry.tickExtras && entry.tickExtras.destination;
            const startCoord0 = entry.simulatedPosition;
            if (destNow0 && startCoord0) {
                const initDist = haversineMeters(startCoord0, destNow0);
                if (Number.isFinite(initDist) && initDist > 0) {
                    perStepMeters = Math.max(initDist / SIM_TICKS_TO_CONVERGE, 1);
                }
            }
            this._simStates[uri] = {
                stepMeters: perStepMeters,
                intervalMs,
                timerId: setInterval(() => {
                    this._tick(uri);
                }, intervalMs),
            };
            try {
                const startCoord = entry.simulatedPosition;
                if (startCoord) {
                    const startLat = startCoord.latitude.toFixed(5);
                    const startLng = startCoord.longitude.toFixed(5);
                    const startUrl = `https://maps.google.com/?q=${startLat},${startLng}`;
                    log(
                        `[sim] START checkpoint for ${uri} → ${startLat},${startLng} (${startUrl})`
                        + ` step=${perStepMeters.toFixed(0)} m every ${intervalMs / 1000}s`
                        + ` (target ${SIM_TICKS_TO_CONVERGE} ticks ≈ ${(SIM_TICKS_TO_CONVERGE * intervalMs / 1000).toFixed(0)}s)`
                    );
                    const destNow = entry.tickExtras && entry.tickExtras.destination;
                    if (destNow) {
                        const dLat = destNow.latitude.toFixed(5);
                        const dLng = destNow.longitude.toFixed(5);
                        const distKm = (haversineMeters(startCoord, destNow) / 1000).toFixed(2);
                        const dUrl = `https://maps.google.com/?q=${dLat},${dLng}`;
                        log(
                            `[sim] DESTINATION for ${uri} → ${dLat},${dLng} (${dUrl}) distance from start=${distKm} km`
                        );
                    } else {
                        log(
                            `[sim] DESTINATION for ${uri} → not yet known; tick fallback will synthesise one on first step`
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

    // Internal — fired every intervalMs while a sim is active. Walks
    // entry.simulatedPosition one step toward the shared destination,
    // snaps when within a step of the target, then emits a tick through
    // the regular sendLocationMetadata pipeline.
    _tick(uri) {
        const sim = this._simStates[uri];
        if (!sim) return;
        const entry = this._getEntry(uri);
        // Share was torn down (user stopped, expiration, peer cancelled).
        // Auto-stop the simulator so a stale interval doesn't keep firing
        // and burning a sendMessage every couple of seconds.
        if (!entry || !entry.simulatedPosition) {
            if (sim.timerId) clearInterval(sim.timerId);
            delete this._simStates[uri];
            return;
        }

        // Resolve target from the shared destination on tickExtras. Both
        // sides walk to the same point so they converge there.
        let target = entry.tickExtras && entry.tickExtras.destination;
        if (!target
                || typeof target.latitude !== 'number'
                || typeof target.longitude !== 'number') {
            // No destination known on this side yet — synthesise a 4 km
            // random offset from our current position and stamp it onto
            // tickExtras so subsequent outgoing ticks broadcast it.
            target = pickMeetingDestinationKm(entry.simulatedPosition, 4);
            if (!target) return;
            if (entry.tickExtras) {
                entry.tickExtras.destination = target;
            }
            log(
                `[sim] no shared destination yet — synthesised ${target.latitude.toFixed(5)},${target.longitude.toFixed(5)} (~4 km from current position)`
            );
        }

        const dist = haversineMeters(entry.simulatedPosition, target);
        // Did this step land on (or past) the target? If so, snap to exact
        // destination coords and tear the timer down after this final tick
        // — there's nothing more to simulate, and emitting the same coords
        // every interval is just chat noise (and wasted battery on the
        // watching device). The last tick still ships so the receiver sees
        // the snap and the arrival-push gate has its trigger moment.
        const arrivedThisStep = !Number.isFinite(dist) || dist <= sim.stepMeters;
        if (arrivedThisStep) {
            entry.simulatedPosition = {
                latitude: target.latitude,
                longitude: target.longitude,
                accuracy: 5,
                timestamp: Date.now(),
            };
        } else {
            const ratio = sim.stepMeters / dist;
            entry.simulatedPosition = {
                latitude: entry.simulatedPosition.latitude
                    + (target.latitude - entry.simulatedPosition.latitude) * ratio,
                longitude: entry.simulatedPosition.longitude
                    + (target.longitude - entry.simulatedPosition.longitude) * ratio,
                accuracy: 5,
                timestamp: Date.now(),
            };
        }

        // Emit through the same gate the real-GPS path uses so the
        // privacy-radius logic still applies during simulated walks.
        if (this._shouldSendUpdateTick(uri, entry.simulatedPosition)) {
            const tickExtras = {
                meetingRequest: false,
                inReplyTo: entry.inReplyTo,
                destination: entry.tickExtras && entry.tickExtras.destination,
            };
            this._sendLocationMetadata(
                uri,
                { ...entry.simulatedPosition },
                new Date(entry.expiresAt).toISOString(),
                entry.originMetadataId,
                tickExtras
            );
        }

        if (arrivedThisStep) {
            // Walker reached the destination — kill the timer so the
            // simulator stops emitting redundant "still at dest" ticks.
            // sendLocationMetadata above already fired the arrival push via
            // _maybeFireDestinationArrival; the proximity-met logic on
            // app.js's side ends the session shortly once the peer's
            // arrival lands too.
            if (sim.timerId) clearInterval(sim.timerId);
            delete this._simStates[uri];
            log(`[sim] convergence reached destination — stopping walker for ${uri}`);
        }
    }

    // Public (was stopSimulation).
    stop(uri) {
        if (!this._simStates[uri]) return;
        if (this._simStates[uri].timerId) {
            clearInterval(this._simStates[uri].timerId);
        }
        delete this._simStates[uri];
        log(`[sim] convergence stopped for ${uri}`);
    }

    isSimulating(uri) {
        return !!this._simStates[uri];
    }

    // Stop every active walker (used on unmount / logout teardown).
    stopAll() {
        Object.keys(this._simStates).forEach((uri) => this.stop(uri));
    }
}
