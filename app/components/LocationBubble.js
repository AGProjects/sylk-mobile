import React, { memo, useContext } from 'react';
import {
    View,
    TouchableOpacity,
    Text,
    Linking,
    StyleSheet,
    Platform,
    Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
// Deep import: GiftedChatContext isn't re-exported from the package's
// public entry point, but we need it so a long-press anywhere on the
// LocationBubble can call back into the host (ContactsListBox) with the
// same `(context, currentMessage)` shape that GiftedChat's own Bubble
// uses — that lets us reuse the existing `onLongMessagePress` ActionSheet
// logic without rebuilding it inside the bubble itself.
import { GiftedChatContext } from 'react-native-gifted-chat/lib/GiftedChatContext';

// -------- Static map implementation notes ----------------------------------
// We render a small static map preview by stitching a 3x3 grid of raster tiles
// into a fixed-size window with a pin overlay on the exact lat/lng. This keeps
// the bubble lightweight (no native map module / API key) and still lets the
// user tap through to the native map app for panning and zooming.
//
// Tile provider: CartoDB's public basemap CDN (Voyager style). OSM's own tile
// servers reject traffic from mobile apps under their tile usage policy and
// serve an "access blocked" error tile, so we can't use tile.openstreetmap.org
// directly. CartoDB's CDN is historically open and does not require an API
// key; it does require attribution in the UI (see `attribution` below).
//
// To swap providers later (Mapbox, MapTiler, Stadia, our own tile server),
// replace `tileUrl` and update the attribution string. Everything else stays.
// ---------------------------------------------------------------------------

// Map preview footprint inside the chat bubble. Originally 230 × 150
// when the bubble was a thumbnail-sized teaser; bumped to 300 × 200
// so the user can read street-level detail without leaving the chat
// (Open in Maps is still one tap away for a full map view). 300 px
// fits comfortably inside the standard chat-message column on every
// phone we ship to (smallest usable width is ~360 dp; the bubble
// reserves ~30 px of side padding).
const MAP_WIDTH = 300;
const MAP_HEIGHT = 200;
const TILE_SIZE = 256;           // slippy-map tiles are always 256px square
const DEFAULT_ZOOM = 15;         // ~1 block of visible area
const MIN_ZOOM = 3;              // continent-level; we refuse to go wider.
const MAX_ZOOM = 18;             // CartoDB Voyager only serves up to 18.

const TILE_SUBDOMAINS = ['a', 'b', 'c', 'd'];
function tileUrl(z, x, y) {
    const host = TILE_SUBDOMAINS[(x + y) % TILE_SUBDOMAINS.length];
    // CartoDB Voyager — coloured raster tiles, no API key required.
    // Alternatives: 'light_all' (positron, grey), 'dark_all' (dark matter).
    return `https://${host}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`;
}

// Attribution line shown below the map — required by CartoDB's and OSM's
// licences. Keep this in sync with whatever tile provider `tileUrl` uses.
const ATTRIBUTION = '© OpenStreetMap contributors, © CARTO';

// Slippy-map coordinate math.
// https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
function latLngToTileFrac(latitude, longitude, zoom) {
    const n = Math.pow(2, zoom);
    const xFrac = ((longitude + 180) / 360) * n;
    const latRad = (latitude * Math.PI) / 180;
    const yFrac =
        ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;
    return { xFrac, yFrac, maxTile: n };
}

// Pick a zoom level that fits all supplied points inside the map frame
// with a little padding on each side. Walks zoom from MAX_ZOOM down
// and returns the highest (i.e. most zoomed-in) zoom at which the
// bounding box of every valid point still fits. Generalised to N
// points so we can show owner + peer + destination together; degrades
// gracefully when only one is known.
function pickZoomToFitPoints(points, padding = 40) {
    const valid = (points || []).filter(
        (p) => p
            && typeof p.latitude === 'number'
            && typeof p.longitude === 'number'
    );
    if (valid.length <= 1) return DEFAULT_ZOOM;
    // Identical points: no need to zoom out.
    let allSame = true;
    const first = valid[0];
    for (let i = 1; i < valid.length; i++) {
        if (Math.abs(valid[i].latitude - first.latitude) > 1e-6
                || Math.abs(valid[i].longitude - first.longitude) > 1e-6) {
            allSame = false;
            break;
        }
    }
    if (allSame) return DEFAULT_ZOOM;
    for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (const p of valid) {
            const f = latLngToTileFrac(p.latitude, p.longitude, z);
            if (f.xFrac < minX) minX = f.xFrac;
            if (f.xFrac > maxX) maxX = f.xFrac;
            if (f.yFrac < minY) minY = f.yFrac;
            if (f.yFrac > maxY) maxY = f.yFrac;
        }
        const dxPx = (maxX - minX) * TILE_SIZE;
        const dyPx = (maxY - minY) * TILE_SIZE;
        if (dxPx + padding * 2 <= MAP_WIDTH && dyPx + padding * 2 <= MAP_HEIGHT) {
            return z;
        }
    }
    return MIN_ZOOM;
}

// Centroid (arithmetic mean) of N lat/lng points. For the small
// distances we care about (people meeting up over single-digit
// kilometres) simple component-wise mean is accurate to a few metres
// — no great-circle math needed.
function centroid(points) {
    const valid = (points || []).filter(
        (p) => p
            && typeof p.latitude === 'number'
            && typeof p.longitude === 'number'
    );
    if (valid.length === 0) return null;
    let lat = 0, lng = 0;
    for (const p of valid) {
        lat += p.latitude;
        lng += p.longitude;
    }
    return {
        latitude: lat / valid.length,
        longitude: lng / valid.length,
    };
}

// Format a distance for display. Metres under 1 km, kilometres above.
function formatDistance(meters) {
    if (typeof meters !== 'number' || !isFinite(meters)) return null;
    if (meters < 1) return '<1 m';
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

function formatRemaining(ms) {
    if (ms == null || ms <= 0) return null;
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return '<1m';
}

function toDate(value) {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? null : d;
}

// Great-circle distance in metres between two {latitude, longitude}
// points. Mean Earth radius (6 371 008 m); accurate to better than
// 0.5% anywhere on the surface, which is well below the precision
// the user cares about for "how far am I from the meeting point".
// Returns null on missing / non-numeric inputs so the caller can
// hide the line cleanly.
function haversineMeters(a, b) {
    if (!a || !b) return null;
    const lat1 = typeof a.latitude  === 'number' ? a.latitude  : null;
    const lon1 = typeof a.longitude === 'number' ? a.longitude : null;
    const lat2 = typeof b.latitude  === 'number' ? b.latitude  : null;
    const lon2 = typeof b.longitude === 'number' ? b.longitude : null;
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
    const R = 6371008;
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const sLat = Math.sin(dLat / 2);
    const sLon = Math.sin(dLon / 2);
    const h = sLat * sLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sLon * sLon;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Distill a display name (or fallback URI) down to 1–2 uppercase
// initials for the avatar pin. Handles three common shapes:
//   • Multi-word display name → first letter of the first two words
//     ("John Doe" → "JD", "Mary Jane Wilkins" → "MJ").
//   • Single-word name → first two letters ("Alice" → "AL").
//   • URI / email-like string → first two letters of the local part
//     ("ag@ag-projects.com" → "AG", "sip:bob@…" → "BO").
// Returns "?" when the input is empty or unusable so the avatar still
// renders a stable shape rather than collapsing.
function initialsFromName(name) {
    if (!name) return '?';
    const cleaned = String(name).trim();
    if (!cleaned) return '?';
    if (cleaned.includes('@')) {
        const local = cleaned.split('@')[0]
            .replace(/^sip:/i, '')
            .replace(/^sips:/i, '');
        return (local.slice(0, 2) || '?').toUpperCase();
    }
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return ((parts[0][0] || '') + (parts[1][0] || '')).toUpperCase();
}

// Small static-map component. Positions a 3x3 grid of tiles so that the
// requested center (lat/lng — the midpoint of the two points if a peer
// is provided) lands exactly at the centre of MAP_WIDTH x MAP_HEIGHT,
// then plots the owner pin and (when present) the peer pin at their
// respective pixel offsets.
//
// Behaviour with peerCoords:
//   • The view is centered on the midpoint of the two points.
//   • Zoom is picked to fit both points with padding (see pickZoomToFit).
//   • A blue "peer" pin is added alongside the red "owner" pin.
//   • If the two points coincide (common in testing), both pins overlap
//     at the centre of the frame — visually still a single marker, but
//     the distance label below will show "0 m" so the user can tell the
//     pairing is working.
const StaticMap = memo((props) => {
    const {
        latitude,
        longitude,
        peerLatitude,
        peerLongitude,
        destinationLatitude,
        destinationLongitude,
        ownerInitials,
        peerInitials,
    } = props;

    // owner = local user; peer = the other party. Either side may be
    // missing on the very first tick of an incoming bubble (peerCoords
    // for the incoming case is the local user's own coords, which the
    // pairing path stamps once it's seen at least one of our outgoing
    // ticks). Treat both as nullable so we never project a pin off
    // NaN coords.
    const hasOwner =
        typeof latitude === 'number' &&
        typeof longitude === 'number';
    const hasPeer =
        typeof peerLatitude === 'number' &&
        typeof peerLongitude === 'number';
    const hasDestination =
        typeof destinationLatitude === 'number' &&
        typeof destinationLongitude === 'number';

    const owner = hasOwner ? { latitude, longitude } : null;
    const peer = hasPeer ? { latitude: peerLatitude, longitude: peerLongitude } : null;
    const destination = hasDestination
        ? { latitude: destinationLatitude, longitude: destinationLongitude }
        : null;

    // Collect every point we want visible. The frame is sized +
    // centred to fit the bounding box of whichever ones are known
    // so the user sees the full picture: where they are, where the
    // peer is, and where they're heading. Falls back to a sensible
    // default if everything is missing (shouldn't happen — caller
    // already gates on hasCoords).
    const visiblePoints = [];
    if (owner) visiblePoints.push(owner);
    if (peer) visiblePoints.push(peer);
    if (destination) visiblePoints.push(destination);

    const zoom = visiblePoints.length > 1
        ? pickZoomToFitPoints(visiblePoints)
        : (typeof props.zoom === 'number' ? props.zoom : DEFAULT_ZOOM);

    const center = visiblePoints.length > 1
        ? centroid(visiblePoints)
        : (visiblePoints[0] || {latitude: 0, longitude: 0});

    const centerFrac = latLngToTileFrac(center.latitude, center.longitude, zoom);
    const xTile = Math.floor(centerFrac.xFrac);
    const yTile = Math.floor(centerFrac.yFrac);
    const pxInTileX = (centerFrac.xFrac - xTile) * TILE_SIZE;
    const pxInTileY = (centerFrac.yFrac - yTile) * TILE_SIZE;

    const centerX = MAP_WIDTH / 2;
    const centerY = MAP_HEIGHT / 2;

    // Project a lat/lng to pixel coords inside this frame, taking the
    // chosen center into account.
    const project = (lat, lng) => {
        const p = latLngToTileFrac(lat, lng, zoom);
        const x = centerX + (p.xFrac - centerFrac.xFrac) * TILE_SIZE;
        const y = centerY + (p.yFrac - centerFrac.yFrac) * TILE_SIZE;
        return { x, y };
    };

    const tiles = [];
    // Slightly wider grid when multiple points might be near the edges
    // of the frame — cheap insurance against blank strips at the side.
    // The tile cache dedupes across bubbles so extra tiles here cost a
    // first-paint only.
    const span = visiblePoints.length > 1 ? 2 : 1;
    for (let dx = -span; dx <= span; dx++) {
        for (let dy = -span; dy <= span; dy++) {
            const tx = xTile + dx;
            const ty = yTile + dy;
            // Skip tiles that are off the world at this zoom level.
            if (tx < 0 || ty < 0 || tx >= centerFrac.maxTile || ty >= centerFrac.maxTile) continue;

            const left = centerX - pxInTileX + dx * TILE_SIZE;
            const top = centerY - pxInTileY + dy * TILE_SIZE;

            tiles.push(
                <Image
                    key={`${zoom}-${tx}-${ty}`}
                    source={{ uri: tileUrl(zoom, tx, ty) }}
                    style={{
                        position: 'absolute',
                        left,
                        top,
                        width: TILE_SIZE,
                        height: TILE_SIZE,
                    }}
                />
            );
        }
    }

    // Render pins. Three colours, three roles:
    //   • Red    — owner (this device's position).
    //   • Blue   — peer (the other party in this share).
    //   • Green  — meeting destination (carried in metadata.destination,
    //              picked by the requester via the simulator today, or
    //              by a future map-picker UI).
    // Pin tip offset: width/2 horizontally and full height vertically so
    // the tip sits exactly on the plotted point. Destination is rendered
    // BEHIND the live owner/peer pins so when someone walks onto the
    // destination point, their live pin sits on top and stays visible.
    //
    // Overlap nudge: when two pins project to within a couple of
    // pixels of each other (e.g. both phones on the same desk: 1–5 m
    // apart), the second-drawn pin completely covers the first, and
    // the user thinks the missing colour just isn't being rendered.
    // We bump the peer (and destination, if it overlaps owner) by a
    // small fixed offset so all colours remain visible. The label
    // below the map still shows the true distance — only the pin
    // *display* is shifted.
    const ownerPos = owner ? project(owner.latitude, owner.longitude) : null;
    const rawPeerPos = hasPeer ? project(peer.latitude, peer.longitude) : null;
    const rawDestPos = destination
        ? project(destination.latitude, destination.longitude)
        : null;
    const PIN_OVERLAP_PX = 8;
    const PIN_NUDGE_PX = 14;
    const nudgeIfOverlap = (a, b, dx, dy) => {
        if (!a || !b) return a;
        const ddx = Math.abs(a.x - b.x);
        const ddy = Math.abs(a.y - b.y);
        if (ddx < PIN_OVERLAP_PX && ddy < PIN_OVERLAP_PX) {
            return {x: a.x + dx, y: a.y + dy};
        }
        return a;
    };
    // Peer nudges right of owner; destination nudges left of owner so
    // a fully-coincident triple still leaves three pins individually
    // visible.
    const peerPos = nudgeIfOverlap(rawPeerPos, ownerPos, PIN_NUDGE_PX, 0);
    let destinationPos = nudgeIfOverlap(rawDestPos, ownerPos, -PIN_NUDGE_PX, 0);
    // And one more pass: keep destination clear of peer too.
    destinationPos = nudgeIfOverlap(destinationPos, peerPos, 0, -PIN_NUDGE_PX);

    // Tiny helper for the round initials avatar that replaces the
    // owner / peer pins. Centred on its own position via half-width
    // / half-height offsets in the wrapper. White stroke + drop
    // shadow so the avatar reads cleanly on busy map tiles. Size 30
    // is intentionally a touch bigger than the prior 28 px pin so
    // two letters fit comfortably without clipping at higher zooms.
    const AVATAR_SIZE = 30;
    const AVATAR_HALF = AVATAR_SIZE / 2;
    const renderAvatar = (pos, color, initials, key) => (
        <View
            key={key}
            pointerEvents="none"
            style={[
                styles.pin,
                {
                    left: pos.x - AVATAR_HALF,
                    top: pos.y - AVATAR_HALF,
                    width: AVATAR_SIZE,
                    height: AVATAR_SIZE,
                    borderRadius: AVATAR_HALF,
                    backgroundColor: color,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 2,
                    borderColor: '#fff',
                    // Subtle shadow so the avatar lifts off the map
                    // tiles. RN handles iOS / Android shadow props
                    // separately; both get something.
                    shadowColor: '#000',
                    shadowOpacity: 0.25,
                    shadowRadius: 2,
                    shadowOffset: {width: 0, height: 1},
                    elevation: 3,
                },
            ]}
        >
            <Text style={{
                color: '#fff',
                fontSize: 11,
                fontWeight: '700',
                lineHeight: 13,
            }}>
                {initials || '?'}
            </Text>
        </View>
    );

    return (
        <View style={styles.mapFrame}>
            {tiles}
            {/* Destination keeps a flag-style pin — it's a place,
                not a person, so an avatar circle would be misleading.
                Map-marker icon, green, anchored bottom-tip on the
                projected pixel. */}
            {destinationPos ? (
                <View
                    pointerEvents="none"
                    style={[
                        styles.pin,
                        { left: destinationPos.x - 14, top: destinationPos.y - 26 },
                    ]}
                >
                    <Icon name="map-marker" size={28} color="#27AE60" />
                </View>
            ) : null}
            {peerPos ? renderAvatar(peerPos, '#2E86DE', peerInitials, 'peer-avatar') : null}
            {ownerPos ? renderAvatar(ownerPos, '#E74C3C', ownerInitials, 'owner-avatar') : null}
        </View>
    );
});

// Prototype bubble for a live-location message. Renders inside the normal
// GiftedChat bubble wrapper (via renderMessageText) so the bubble background
// and tail still come from ChatBubble.
const LocationBubble = memo(({ currentMessage, metadata, onLongPress, ownerName, peerName }) => {
    // We need GiftedChat's own context here so we can hand it back to the
    // host's `onLongMessagePress(context, message)` — the ActionSheet APIs
    // that contextual menu uses live on `context.actionSheet()`.
    const chatContext = useContext(GiftedChatContext);

    const meta = metadata || currentMessage?.metadata;

    // Compute peer-coords derived values with null-safe guards so the
    // hooks below can run unconditionally (rules-of-hooks — we cannot
    // early-return before the useRef/useEffect pair).
    const metaValue = meta && meta.value ? meta.value : null;
    const peerCoordsSafe = meta && meta.peerCoords ? meta.peerCoords : null;
    const peerLatitudeSafe =
        peerCoordsSafe && typeof peerCoordsSafe.latitude === 'number' ? peerCoordsSafe.latitude : null;
    const peerLongitudeSafe =
        peerCoordsSafe && typeof peerCoordsSafe.longitude === 'number' ? peerCoordsSafe.longitude : null;
    const hasPeerSafe = peerLatitudeSafe != null && peerLongitudeSafe != null;

    if (!meta || !metaValue) return null;

    const { latitude, longitude, accuracy } = metaValue;
    // `hasCoords` gates the real map render. The sender fires the origin
    // tick immediately with null lat/lng (to avoid a 10–15s black-hole
    // wait on the GPS cold start), so the first render of this bubble
    // can legitimately have no coordinates yet. We render a "Locating…"
    // placeholder card in that case; the same bubble is updated in place
    // once the follow-up tick lands with real coords.
    const hasCoords =
        typeof latitude === 'number' && typeof longitude === 'number';

    // Meeting-session pairing data injected by app.js's
    // _propagatePeerCoordsForSession. Present only when this bubble is
    // part of an "Until we meet" share AND the peer side's latest tick
    // has been received on this device. Either field may be missing
    // independently.
    const peerCoords = peerCoordsSafe;
    const peerLatitude = peerLatitudeSafe;
    const peerLongitude = peerLongitudeSafe;
    const hasPeer = hasPeerSafe;
    // One-shot share: a single tick was sent and the receiver should
    // render a static "Shared location" instead of the live-update
    // affordances. Hides the expires-in line, the peer-distance line,
    // the to-meeting-point line and tweaks the bubble title.
    const isOneShot = !!(meta && meta.one_shot);

    const distanceLabel = (!isOneShot && hasPeer)
        ? formatDistance(meta.distanceMeters) : null;

    const tickAt =
        toDate(meta.value.timestamp) || toDate(meta.timestamp) || null;
    const expiresAt = toDate(meta.expires);
    const remainingMs = expiresAt ? expiresAt.getTime() - Date.now() : null;
    const isExpired = expiresAt != null && remainingMs <= 0;

    const isIncoming = currentMessage?.direction === 'incoming';

    // "Distance to meeting point" — each device computes against ITS
    // OWN coords so the same bubble reads as "your remaining walk"
    // on both ends. The local user's coords depend on bubble
    // direction:
    //   • OUTGOING bubble (we sent it):  meta.value is our coords.
    //   • INCOMING bubble (peer sent it): meta.peerCoords is our
    //     coords (the propagation layer stamps "the OTHER side" into
    //     peerCoords regardless of direction).
    // The line is hidden entirely when either coord is missing or
    // when no destination has been chosen for this share.
    const myCoords = isIncoming
        ? (meta.peerCoords && typeof meta.peerCoords.latitude === 'number'
            ? meta.peerCoords : null)
        : (meta.value && typeof meta.value.latitude === 'number'
            ? meta.value : null);
    const dest = (meta.destination
            && typeof meta.destination.latitude === 'number'
            && typeof meta.destination.longitude === 'number')
        ? meta.destination
        : null;
    const toDestMeters = (!isOneShot && myCoords && dest)
        ? haversineMeters(myCoords, dest)
        : null;
    const toDestLabel = (toDestMeters != null && isFinite(toDestMeters))
        ? formatDistance(toDestMeters)
        : null;
    const textColor = isIncoming ? '#fff' : '#000';
    const subColor = isIncoming ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)';

    const openMap = () => {
        // Guard: without coords (placeholder "Locating…" state) there's
        // nothing to hand off to the maps app. The footer button is
        // disabled in that state too, but double-check here in case
        // something else (long-press accelerator, etc.) calls us.
        if (!hasCoords) return;

        // Pick the right anchor point for the external map. We
        // intentionally hand off ONE point — not a directions URL —
        // so Google Maps / Apple Maps drops a single pin and lets
        // the user tap Directions themselves and pick walking /
        // driving / transit / cycling. No route line is auto-drawn.
        // Priority:
        //   1. The shared meeting destination (green pin) — that's
        //      the actionable place when this is a meet share.
        //   2. The peer's last known position (blue pin) — used when
        //      we know the peer but not a destination, so the user
        //      can navigate to them.
        //   3. The owner's coords (red pin) — single timed share or
        //      "where am I" tap, original behaviour.
        const dest = meta.destination
                && typeof meta.destination.latitude === 'number'
                && typeof meta.destination.longitude === 'number'
            ? meta.destination
            : null;

        let anchorLat = latitude;
        let anchorLng = longitude;
        let anchorLabel = 'Shared location';
        if (dest) {
            anchorLat = dest.latitude;
            anchorLng = dest.longitude;
            anchorLabel = 'Meeting point';
        } else if (hasPeer) {
            anchorLat = peerLatitude;
            anchorLng = peerLongitude;
            anchorLabel = 'Peer location';
        }

        const ios = `maps://?ll=${anchorLat},${anchorLng}&q=${anchorLat},${anchorLng}`;
        const android = `geo:${anchorLat},${anchorLng}?q=${anchorLat},${anchorLng}`
            + `(${encodeURIComponent(anchorLabel)})`;
        const fallback = `https://maps.google.com/?q=${anchorLat},${anchorLng}`;
        const primary = Platform.OS === 'ios' ? ios : android;
        Linking.openURL(primary).catch(() => {
            Linking.openURL(fallback).catch(() => {});
        });
    };

    const remaining = formatRemaining(remainingMs);
    const expirationLine = isExpired
        ? 'Sharing ended'
        : remaining
        ? `Expires in ${remaining}`
        : null;

    // Surface the contextual menu (Reply / Delete / Pin / Forward / etc.)
    // for this message. We delegate to the same handler that every other
    // bubble's long-press uses, passing GiftedChat's context so the
    // ActionSheet can be shown.
    const triggerMenu = () => {
        if (typeof onLongPress === 'function') {
            onLongPress(chatContext, currentMessage);
        }
    };

    // Wrapped in a plain View (not TouchableOpacity) so a stray tap on the
    // map or info area no longer fires openMap / hijacks the user to an
    // external maps app. All intentional actions now live in the footer
    // bar below: menu-dots for message actions (single tap), Open in Maps
    // for the handoff that the whole bubble used to trigger. Long-press
    // anywhere on the card is kept as a fallback for parity with other
    // message bubbles — GiftedChat itself routes long-presses on the
    // surrounding bubble to the same handler, so this is mostly a
    // belt-and-braces safety net for touches that land on our custom
    // content before they bubble up.
    return (
        <View style={styles.card}>
            <TouchableOpacity
                activeOpacity={1}
                onLongPress={triggerMenu}
                delayLongPress={300}
                accessibilityLabel="Shared location"
            >
                {hasCoords ? (() => {
                    // Goal: both ends of a meet share render the SAME
                    // map — same colour anchored to the same person —
                    // so a quick glance at either device tells you
                    // "AG is the red dot, FL is the blue dot",
                    // regardless of which side you happen to be on.
                    //
                    // The data layer keeps things author-anchored:
                    //   • metadata.value     = the bubble author's coords
                    //   • metadata.peerCoords = the OTHER side's coords
                    // …so red(value) / blue(peerCoords) is the same
                    // pairing on both devices. The only thing that
                    // flips between sides is which person is "us".
                    //
                    // To keep colour↔person stable, we therefore swap
                    // only the LABELS on incoming bubbles:
                    //   • OUTGOING: red = me      (ownerName)
                    //               blue = peer   (peerName)
                    //   • INCOMING: red = author  (peerName, since
                    //                              the author IS the peer
                    //                              from this device's POV)
                    //               blue = me     (ownerName)
                    // Both devices end up showing identical avatars
                    // at identical coords.
                    const redInitials = initialsFromName(
                        isIncoming ? peerName : ownerName
                    );
                    const blueInitials = initialsFromName(
                        isIncoming ? ownerName : peerName
                    );
                    return (
                        <StaticMap
                            latitude={latitude}
                            longitude={longitude}
                            peerLatitude={peerLatitude}
                            peerLongitude={peerLongitude}
                            destinationLatitude={
                                meta.destination
                                    && typeof meta.destination.latitude === 'number'
                                    ? meta.destination.latitude
                                    : undefined
                            }
                            destinationLongitude={
                                meta.destination
                                    && typeof meta.destination.longitude === 'number'
                                    ? meta.destination.longitude
                                    : undefined
                            }
                            ownerInitials={redInitials}
                            peerInitials={blueInitials}
                        />
                    );
                })() : (
                    // No coords yet — sender fired an origin tick
                    // immediately with placeholder lat/lng while waiting
                    // for the first GPS fix. Render a grey frame with a
                    // spinner-ish icon and "Locating…" label so the user
                    // has immediate visual confirmation that the share
                    // started. The same bubble will rerender as the
                    // StaticMap branch once the follow-up tick lands.
                    <View style={[styles.mapFrame, styles.placeholderFrame]}>
                        <Icon
                            name="crosshairs-gps"
                            size={32}
                            color="#888"
                        />
                        <Text style={styles.placeholderText}>
                            Locating…
                        </Text>
                    </View>
                )}

                <View style={styles.info}>
                    <Text
                        style={[styles.title, { color: textColor }]}
                        numberOfLines={1}
                    >
                        {isOneShot
                            ? 'Shared location'
                            : (isExpired
                                ? 'Location (expired)'
                                : (hasCoords ? 'Current location' : 'Current location (acquiring)'))}
                    </Text>
                    {/* Coords used to be shown as "lat, lng ± accuracy" but
                        the raw numbers aren't actually useful to the user —
                        the map pin above makes the position visible, and
                        "Open in Maps" in the footer handles precise lookup.
                        The only useful numeric readout is the peer distance,
                        which only exists during an "Until we meet" session.
                        Everything else has been pruned so the bubble stays
                        compact and the distance line (when it's present)
                        doesn't get buried between visually-similar rows. */}
                    {distanceLabel ? (
                        <Text
                            style={[styles.sub, { color: subColor }]}
                            numberOfLines={1}
                        >
                            {distanceLabel} apart
                        </Text>
                    ) : null}
                    {toDestLabel ? (
                        <Text
                            style={[styles.sub, { color: subColor }]}
                            numberOfLines={1}
                        >
                            {toDestLabel} to meeting point
                        </Text>
                    ) : null}
                    {/* GiftedChat's bubble footer already shows createdAt
                        which is refreshed on every tick — no need to duplicate
                        the last-update time inside the bubble body. The
                        expires-in line moved down into the footer action bar
                        so it sits centered between the menu and open-maps
                        icons. */}
                    <Text
                        style={[styles.attribution, { color: subColor }]}
                        numberOfLines={1}
                    >
                        {ATTRIBUTION}
                    </Text>
                </View>
            </TouchableOpacity>

            {/* Footer action bar — mirrors the small action strip image
                bubbles have. Menu on the left (single tap → same contextual
                menu other bubbles open on long-press); "expires in …" in
                the middle (flex:1 + textAlign:center so it always sits
                centered between the two icons, regardless of label width);
                Open in Maps on the right replaces the old "tap the whole
                bubble to open maps" behaviour, which was firing on any
                accidental touch. */}
            <View style={styles.footer}>
                <TouchableOpacity
                    onPress={triggerMenu}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel="Message options"
                    style={styles.footerButton}
                >
                    {/* Hamburger ("sandwich") — matches the menu affordance
                        used on the other bubbles in the chat. */}
                    <Icon
                        name="menu"
                        size={20}
                        color={textColor}
                    />
                </TouchableOpacity>
                <Text
                    style={[styles.footerExpires, { color: subColor }]}
                    numberOfLines={1}
                >
                    {isOneShot ? '' : (expirationLine || '')}
                </Text>
                <TouchableOpacity
                    onPress={openMap}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel="Open shared location in Maps"
                    style={styles.footerButton}
                    // Open-in-Maps is meaningless in the "Locating…"
                    // placeholder state (no coords to hand off). Dim
                    // and disable until the real coords arrive and the
                    // map renders above.
                    disabled={!hasCoords}
                >
                    <Icon
                        name="map-search-outline"
                        size={20}
                        color={textColor}
                        style={!hasCoords ? { opacity: 0.35 } : null}
                    />
                </TouchableOpacity>
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
    card: {
        padding: 8,
        width: MAP_WIDTH + 16, // card padding
    },
    mapFrame: {
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#e9ecef',
    },
    // Used while waiting for the first GPS fix — replaces the tile
    // grid with a flat grey card centered on an icon + "Locating…"
    // label. Shares mapFrame's dimensions so the bubble doesn't
    // resize when real coords arrive.
    placeholderFrame: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    placeholderText: {
        marginTop: 6,
        fontSize: 13,
        color: '#555',
    },
    pin: {
        position: 'absolute',
        width: 28,
        height: 28,
    },
    info: {
        marginTop: 6,
    },
    title: {
        fontSize: 15,
        fontWeight: '600',
    },
    coords: {
        fontSize: 13,
        marginTop: 2,
    },
    sub: {
        fontSize: 12,
        marginTop: 2,
    },
    // Attribution: required by OSM (ODbL) and CartoDB's terms, but
    // visually softened so it reads as a legal footnote rather than a
    // UI element. 8px + 0.35 opacity is the smallest we can reasonably
    // go while still satisfying the providers' "visible and legible"
    // attribution rules — anyone looking for it can find it, but it
    // doesn't compete with the actual map content.
    attribution: {
        fontSize: 8,
        marginTop: 2,
        opacity: 0.35,
    },
    // Lower action bar beneath the map + info. Kept visually subtle (thin
    // divider above, no fill) so it reads as a footer rather than a
    // coloured button strip. Menu dots on the left, "open in maps" on
    // the right — matches the affordance pattern of image bubbles.
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 6,
        paddingTop: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: 'rgba(0,0,0,0.15)',
    },
    footerButton: {
        paddingHorizontal: 6,
        paddingVertical: 4,
    },
    // Middle label in the footer row — flex:1 eats the space between the
    // two icons, textAlign:center keeps the label visually centered under
    // the image regardless of its length.
    footerExpires: {
        flex: 1,
        textAlign: 'center',
        fontSize: 12,
        paddingHorizontal: 6,
    },
});

export default LocationBubble;
