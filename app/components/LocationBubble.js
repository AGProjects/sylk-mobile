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

const MAP_WIDTH = 230;
const MAP_HEIGHT = 150;
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

// Pick a zoom level that fits both points inside MAP_WIDTH x MAP_HEIGHT
// with a little padding on each side. Walks zoom from MAX_ZOOM down and
// returns the highest (i.e. most zoomed-in) zoom at which both points
// still fit. Falls back to DEFAULT_ZOOM for degenerate inputs (same
// point, missing coords, etc.).
function pickZoomToFit(a, b, padding = 40) {
    if (!a || !b) return DEFAULT_ZOOM;
    if (
        typeof a.latitude !== 'number' || typeof a.longitude !== 'number' ||
        typeof b.latitude !== 'number' || typeof b.longitude !== 'number'
    ) {
        return DEFAULT_ZOOM;
    }
    // Identical (or very near-identical) points: no need to zoom out.
    if (
        Math.abs(a.latitude - b.latitude) < 1e-6 &&
        Math.abs(a.longitude - b.longitude) < 1e-6
    ) {
        return DEFAULT_ZOOM;
    }
    for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
        const pa = latLngToTileFrac(a.latitude, a.longitude, z);
        const pb = latLngToTileFrac(b.latitude, b.longitude, z);
        const dxPx = Math.abs(pa.xFrac - pb.xFrac) * TILE_SIZE;
        const dyPx = Math.abs(pa.yFrac - pb.yFrac) * TILE_SIZE;
        if (dxPx + padding * 2 <= MAP_WIDTH && dyPx + padding * 2 <= MAP_HEIGHT) {
            return z;
        }
    }
    return MIN_ZOOM;
}

// Midpoint for two lat/lng points. For the small distances we care
// about (people meeting up, i.e. typically < 10 km apart) simple
// arithmetic mean is accurate to a few metres — no great-circle
// math needed.
function midpoint(a, b) {
    return {
        latitude: (a.latitude + b.latitude) / 2,
        longitude: (a.longitude + b.longitude) / 2,
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
    } = props;

    const hasPeer =
        typeof peerLatitude === 'number' &&
        typeof peerLongitude === 'number';

    const owner = { latitude, longitude };
    const peer = hasPeer ? { latitude: peerLatitude, longitude: peerLongitude } : null;

    const zoom = hasPeer
        ? pickZoomToFit(owner, peer)
        : (typeof props.zoom === 'number' ? props.zoom : DEFAULT_ZOOM);

    const center = hasPeer ? midpoint(owner, peer) : owner;

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
    // Slightly wider grid (5x5 instead of 3x3) when both points might be
    // near the edges of the frame — cheap insurance against blank strips
    // at the side. The tile cache dedupes across bubbles so extra tiles
    // here cost a first-paint only.
    const span = hasPeer ? 2 : 1;
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

    // Render pins. Owner pin is red (this-device-ish), peer pin is blue.
    // Pin tip offset: width/2 horizontally and full height vertically so
    // the tip sits exactly on the plotted point.
    const ownerPos = project(owner.latitude, owner.longitude);
    const peerPos = hasPeer ? project(peer.latitude, peer.longitude) : null;

    return (
        <View style={styles.mapFrame}>
            {tiles}
            {peerPos ? (
                <View
                    pointerEvents="none"
                    style={[
                        styles.pin,
                        { left: peerPos.x - 14, top: peerPos.y - 26 },
                    ]}
                >
                    <Icon name="map-marker" size={28} color="#2E86DE" />
                </View>
            ) : null}
            <View
                pointerEvents="none"
                style={[
                    styles.pin,
                    { left: ownerPos.x - 14, top: ownerPos.y - 26 },
                ]}
            >
                <Icon name="map-marker" size={28} color="#E74C3C" />
            </View>
        </View>
    );
});

// Prototype bubble for a live-location message. Renders inside the normal
// GiftedChat bubble wrapper (via renderMessageText) so the bubble background
// and tail still come from ChatBubble.
const LocationBubble = memo(({ currentMessage, metadata, onLongPress }) => {
    // We need GiftedChat's own context here so we can hand it back to the
    // host's `onLongMessagePress(context, message)` — the ActionSheet APIs
    // that contextual menu uses live on `context.actionSheet()`.
    const chatContext = useContext(GiftedChatContext);

    const meta = metadata || currentMessage?.metadata;
    if (!meta || !meta.value) return null;

    const { latitude, longitude, accuracy } = meta.value;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return null;
    }

    // Meeting-session pairing data injected by app.js's
    // _propagatePeerCoordsForSession. Present only when this bubble is
    // part of an "Until we meet" share AND the peer side's latest tick
    // has been received on this device. Either field may be missing
    // independently.
    const peerCoords = meta.peerCoords || null;
    const peerLatitude =
        peerCoords && typeof peerCoords.latitude === 'number' ? peerCoords.latitude : null;
    const peerLongitude =
        peerCoords && typeof peerCoords.longitude === 'number' ? peerCoords.longitude : null;
    const hasPeer = peerLatitude != null && peerLongitude != null;
    const distanceLabel = hasPeer ? formatDistance(meta.distanceMeters) : null;

    const tickAt =
        toDate(meta.value.timestamp) || toDate(meta.timestamp) || null;
    const expiresAt = toDate(meta.expires);
    const remainingMs = expiresAt ? expiresAt.getTime() - Date.now() : null;
    const isExpired = expiresAt != null && remainingMs <= 0;

    const isIncoming = currentMessage?.direction === 'incoming';
    const textColor = isIncoming ? '#fff' : '#000';
    const subColor = isIncoming ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)';

    const openMap = () => {
        const ios = `maps://?ll=${latitude},${longitude}&q=${latitude},${longitude}`;
        const android =
            `geo:${latitude},${longitude}?q=${latitude},${longitude}(Shared%20location)`;
        const fallback = `https://maps.google.com/?q=${latitude},${longitude}`;
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
                <StaticMap
                    latitude={latitude}
                    longitude={longitude}
                    peerLatitude={peerLatitude}
                    peerLongitude={peerLongitude}
                />

                <View style={styles.info}>
                    <Text
                        style={[styles.title, { color: textColor }]}
                        numberOfLines={1}
                    >
                        {isExpired ? 'Location (expired)' : 'Live location'}
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
                    {expirationLine || ''}
                </Text>
                <TouchableOpacity
                    onPress={openMap}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel="Open shared location in Maps"
                    style={styles.footerButton}
                >
                    <Icon
                        name="map-search-outline"
                        size={20}
                        color={textColor}
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
    attribution: {
        fontSize: 10,
        marginTop: 4,
        opacity: 0.7,
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
