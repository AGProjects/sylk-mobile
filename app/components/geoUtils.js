// geoUtils.js
//
// Pure geometry / geocoding helpers extracted from NavigationBar.js.
// None of these touch component state — they take coordinates in and
// return coordinates / distances / booleans out — so they live here as
// free functions that can be imported anywhere and unit-tested in
// isolation.
//
//   • haversineMeters(a, b)            — great-circle distance in metres
//   • dummyOriginPoint(origin)         — throwaway point 4–7 km away
//   • pickMeetingDestinationKm(...)    — random point N km away
//   • isPointOnLand(coord)             — Nominatim land/water check
//   • pickMeetingDestinationKmOnLand() — land-validated random point

// Great-circle distance between two {latitude, longitude} points, in
// metres. Returns Infinity if either point is missing a numeric
// coordinate (callers treat Infinity as "unknown / too far").
export function haversineMeters(a, b) {
    const lat1 = a && typeof a.latitude === 'number' ? a.latitude : null;
    const lon1 = a && typeof a.longitude === 'number' ? a.longitude : null;
    const lat2 = b && typeof b.latitude === 'number' ? b.latitude : null;
    const lon2 = b && typeof b.longitude === 'number' ? b.longitude : null;
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
        return Infinity;
    }
    const R = 6371008;
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const sLat1 = Math.sin(dLat / 2);
    const sLon1 = Math.sin(dLon / 2);
    const h = sLat1 * sLat1
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sLon1 * sLon1;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Generate a throwaway "dummy" origin point a few km from `origin`
// at a random bearing. Used by the privacy-radius meet INVITE that
// carries no shared destination: the dummy is shipped as the origin
// tick's `value` (flagged dummy:true) purely so the origin bubble
// persists with valid coordinates — it is never rendered as a pin,
// never paired as a real position, and is overwritten by the
// inviter's first real fix once they cross their privacy perimeter.
//
// Distance is randomised in the ~4–7 km band (not a fixed radius)
// and the bearing is fully random, so the dummy reveals nothing
// useful about the inviter's actual position beyond what the privacy
// radius already implies. Returns {latitude, longitude}; falls back
// to the origin unchanged if the input is unusable (the caller has
// already gated on a valid `effective` fix, so this is defensive).
export function dummyOriginPoint(origin) {
    const lat = origin && typeof origin.latitude === 'number' ? origin.latitude : null;
    const lng = origin && typeof origin.longitude === 'number' ? origin.longitude : null;
    if (lat == null || lng == null) {
        return origin || null;
    }
    const R = 6371008; // mean Earth radius, metres
    const distance = 4000 + Math.random() * 3000; // 4–7 km
    const bearing = Math.random() * 2 * Math.PI;   // 0–360°
    const toRad = (deg) => deg * Math.PI / 180;
    const toDeg = (rad) => rad * 180 / Math.PI;
    const δ = distance / R;
    const φ1 = toRad(lat);
    const λ1 = toRad(lng);
    const φ2 = Math.asin(
        Math.sin(φ1) * Math.cos(δ)
        + Math.cos(φ1) * Math.sin(δ) * Math.cos(bearing)
    );
    const λ2 = λ1 + Math.atan2(
        Math.sin(bearing) * Math.sin(δ) * Math.cos(φ1),
        Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );
    // Normalise longitude to −180…+180.
    let lng2 = toDeg(λ2);
    lng2 = ((lng2 + 540) % 360) - 180;
    return { latitude: toDeg(φ2), longitude: lng2 };
}

// Pick a coordinate `kilometers` km away from `start` in a random
// bearing. Approximate spherical math — good enough for testing
// (the simulator just needs *some* fixed-but-shareable target).
// 1° latitude ≈ 111 km; longitude scales with cos(latitude).
export function pickMeetingDestinationKm(start, kilometers) {
    if (!start
            || typeof start.latitude !== 'number'
            || typeof start.longitude !== 'number'
            || !Number.isFinite(kilometers)
            || kilometers <= 0) {
        return null;
    }
    const bearing = Math.random() * 2 * Math.PI;
    const dLat = (kilometers / 111) * Math.cos(bearing);
    const cosLat = Math.cos(start.latitude * Math.PI / 180) || 1;
    const dLng = (kilometers / (111 * cosLat)) * Math.sin(bearing);
    return {
        latitude: start.latitude + dLat,
        longitude: start.longitude + dLng,
    };
}

// Reverse-geocode `coord` against OpenStreetMap's Nominatim and
// decide whether the point is on land. Used by the simulator's
// destination picker so a random 4 km bearing doesn't drop the
// meet-up point in the middle of the North Sea (or any other
// body of water). Free public service — usage is rate-limited at
// 1 req/s and asks for a descriptive User-Agent. We send a
// Blink-specific agent and only call this from the debug
// simulator path (gated on ENABLE_MEET_SIMULATION) so the
// request load stays comfortably inside the policy.
//
// Returns true on land, false on water, throws on network /
// parse error so the caller can decide to accept the candidate
// anyway rather than block on a flaky network.
export async function isPointOnLand(coord) {
    if (!coord
            || typeof coord.latitude !== 'number'
            || typeof coord.longitude !== 'number') {
        return true; // Be permissive on malformed input.
    }
    const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2'
        + `&lat=${coord.latitude.toFixed(6)}`
        + `&lon=${coord.longitude.toFixed(6)}`
        + '&zoom=10&addressdetails=1';
    const resp = await fetch(url, {
        headers: {
            // Nominatim's usage policy requires a descriptive
            // User-Agent identifying the application.
            'User-Agent': 'Blink-Mobile/meet-sim (https://sylk.com)',
            'Accept': 'application/json',
        },
    });
    if (!resp.ok) {
        throw new Error('nominatim status ' + resp.status);
    }
    const data = await resp.json();
    // Water-body indicators in the Nominatim payload:
    //   • address.water is set (lake, reservoir, etc.).
    //   • address has no country (open ocean — Nominatim returns
    //     just an empty/minimal address for sea points).
    //   • class === 'natural' AND type ∈ {water, bay, strait,
    //     coastline, beach, reef}.
    //   • class === 'waterway' (rivers, canals, streams).
    // Anything else we treat as land.
    const cls = data && data.class;
    const typ = data && data.type;
    const addr = (data && data.address) || {};
    if (addr.water) return false;
    if (cls === 'waterway') return false;
    if (cls === 'natural'
            && /^(water|bay|strait|coastline|beach|reef|sea|ocean)$/i.test(typ || '')) {
        return false;
    }
    if (!addr.country && !addr.country_code
            && !addr.state && !addr.city
            && !addr.town && !addr.village
            && !addr.hamlet && !addr.county
            && !addr.suburb && !addr.neighbourhood) {
        // No administrative region at all — almost certainly
        // open water.
        return false;
    }
    return true;
}

// Async wrapper around pickMeetingDestinationKm: keeps re-rolling
// the random bearing until Nominatim agrees the candidate is on
// land or until `retries` attempts have been spent. Network or
// parse errors short-circuit and accept the current candidate
// (don't block the simulator on a flaky link). When all retries
// come back as water we fall through to a final pick — the
// simulator must produce *some* destination, even if it's wet,
// so the test session still progresses.
export async function pickMeetingDestinationKmOnLand(start, kilometers, retries = 5) {
    for (let i = 0; i < retries; i++) {
        const candidate = pickMeetingDestinationKm(start, kilometers);
        if (!candidate) return null;
        let onLand;
        try {
            onLand = await isPointOnLand(candidate);
        } catch (e) {
            // Network/parse hiccup — accept this candidate so we
            // don't stall the meeting sim. Real product use would
            // either back off and retry, or skip the check.
            console.log('[sim] land-check failed; accepting candidate as-is',
                e && e.message ? e.message : e);
            return candidate;
        }
        if (onLand) return candidate;
        try {
            const utils = require('../utils');
            utils.timestampedLog(
                `[sim] candidate at ${candidate.latitude.toFixed(5)},${candidate.longitude.toFixed(5)} is in water — re-rolling (attempt ${i + 1}/${retries})`
            );
        } catch (e) { /* noop */ }
        // Light spacing to be polite to Nominatim's 1 req/s policy.
        await new Promise((r) => setTimeout(r, 1100));
    }
    // Exhausted — return whatever the next plain pick gives us.
    return pickMeetingDestinationKm(start, kilometers);
}
