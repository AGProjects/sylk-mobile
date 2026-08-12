import React, { memo, useContext, useEffect, useRef, useState } from 'react';
import {
    View,
    TouchableOpacity,
    Text,
    Linking,
    Share,
    StyleSheet,
    Platform,
    Dimensions,
} from 'react-native';
import Icon from '@react-native-vector-icons/material-design-icons';
// FastImage replaces RN's built-in <Image> for the map tile grid
// because RN's default cache is unreliable across app restarts —
// memory-only on Android, opaque eviction on iOS — which means a
// share viewed yesterday would re-fetch every tile when reopened
// today, and offline the grey squares show up almost immediately.
// FastImage maintains a real persistent on-disk cache (Glide on
// Android, SDWebImage on iOS) so once the user has viewed a tile
// it renders from disk on the next paint, even with no network.
import FastImage from '@d11/react-native-fast-image';
// react-native-svg is the standard RN path-drawing surface; we use
// it here ONLY for the trail polyline overlay on top of the
// stitched tile grid. The Polyline itself is cheap (a single SVG
// child sized to the map frame) and stays a sibling of the
// FastImage tiles + pin overlays so transforms applied to the map
// frame propagate uniformly.
import Svg, { Polyline as SvgPolyline, Circle as SvgCircle, Polygon as SvgPolygon } from 'react-native-svg';
// Reused from the audio-message bubble: a thin draggable scrubber
// with a needle. Same behaviour we need for "drag through the GPS
// timeline" — onSeekStart/Change/Release callbacks expose the
// dragged percentage, which we map to a trail index here.
import AudioProgressSlider from './AudioProgressSlider';
import { LocationSharingContext } from './LocationSharingContext';
import DarkModeManager from '../DarkModeManager';
import * as storage from '../storage';

// Per-sharing-entity zoom override. LOCAL setting — this is a viewer
// preference for the user looking at this device's screen, NOT something
// that rides along in the on-wire metadata. Each share's bubble owns
// its own zoom level, keyed by the bubble's msg_id (= the origin tick's
// id, stable for the lifetime of the share regardless of how many
// follow-up ticks land). On reopen, the bubble re-loads the saved zoom
// and renders at the same level the user last chose.
const ZOOM_STORAGE_PREFIX = 'locationZoom.';

// GiftedChat clock format — matches ChatBox renderTime's dayjs('h:mm A')
// (e.g. "6:10 PM") so location-bubble times don't clash with chat-bubble times.
const _clock12 = (ms) => {
    const d = new Date(ms);
    const h24 = d.getHours();
    const ap = h24 >= 12 ? 'PM' : 'AM';
    const h12 = (h24 % 12) === 0 ? 12 : (h24 % 12);
    return `${h12}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
};
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
// Tile provider: openstreetmap.de Mapnik mirror. We previously used
// CartoDB's Voyager style, but Voyager is deliberately label-sparse at
// low zooms — pull back to a 30+ km view and only the largest 1–2
// city labels show, while villages and towns disappear entirely. The
// openstreetmap.de mirror serves the standard OSM Mapnik style which
// has much denser labelling (towns, villages, hamlets show through at
// zooms 9–12) without becoming visually crowded. They explicitly
// permit mobile-app traffic with attribution and do not require an
// API key. The OSM main tile server (tile.openstreetmap.org) by
// contrast rejects mobile UAs and serves an "access blocked" tile.
//
// To swap providers later (Mapbox, MapTiler, Stadia, our own tile
// server), replace `tileUrl` and update the attribution string.
// Everything else stays.
// ---------------------------------------------------------------------------

// Map preview footprint inside the chat bubble. Originally 230 × 150
// when the bubble was a thumbnail-sized teaser; bumped to 300 × 200
// so the user can read street-level detail without leaving the chat
// (Open in Maps is still one tap away for a full map view). 300 px
// fits comfortably inside the standard chat-message column on every
// phone we ship to (smallest usable width is ~360 dp; the bubble
// reserves ~30 px of side padding).
// Default map dimensions for the inline chat-bubble rendering. The
// fullscreen viewer (long-press → "Full screen") shadows these per-render
// with Dimensions.get('window') to maximise the map. Both StaticMap and
// the outer LocationBubble accept `mapWidth` / `mapHeight` props that
// default to these constants — see the `const MAP_WIDTH = ...` shadows
// at the top of each function body.
const DEFAULT_MAP_WIDTH = 300;
const DEFAULT_MAP_HEIGHT = 200;
const TILE_SIZE = 256;           // slippy-map tiles are always 256px square
const DEFAULT_ZOOM = 15;         // ~1 block of visible area
const MIN_ZOOM = 3;              // continent-level; we refuse to go wider.
const MAX_ZOOM = 18;             // CartoDB Voyager only serves up to 18.

const TILE_SUBDOMAINS = ['a', 'b', 'c'];
function tileUrl(z, x, y) {
    const host = TILE_SUBDOMAINS[(x + y) % TILE_SUBDOMAINS.length];
    // openstreetmap.de Mapnik mirror — OSM standard Mapnik style with
    // denser place-name labelling than CartoDB Voyager at zooms 9–13,
    // which is where our static-map view sits when peers are 10–50 km
    // apart. No API key required; mobile usage permitted with
    // attribution.
    return `https://${host}.tile.openstreetmap.de/${z}/${x}/${y}.png`;
}

// Attribution line shown below the map — required by OSM's licence.
// Keep this in sync with whatever tile provider `tileUrl` uses.
const ATTRIBUTION = '© OpenStreetMap contributors';

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
//
// `mapWidth` / `mapHeight` are passed in (rather than read from
// module-level constants) because the fullscreen viewer renders the
// SAME bubble at window dimensions — at fullscreen size the bounding
// box that fits "comfortably" is much larger and the auto-fit can
// stay at a higher zoom. Without these parameters the function would
// pick the inline-bubble's tighter zoom regardless of frame size, and
// the map would render too far out for the available canvas. Defaults
// to the inline dimensions so any caller that doesn't pass them stays
// on the original behaviour.
function pickZoomToFitPoints(points, padding = 40, mapWidth = DEFAULT_MAP_WIDTH, mapHeight = DEFAULT_MAP_HEIGHT) {
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
        if (dxPx + padding * 2 <= mapWidth && dyPx + padding * 2 <= mapHeight) {
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

// Convert a theme colour into an rgba() string at the given alpha. Handles
// the two shapes the theme actually ships: 3/6-digit hex ('#111B21',
// '#fff') and already-rgb/rgba strings (returned with the new alpha
// applied). Named CSS colours (e.g. 'green') can't be parsed to channels
// here, so we fall back to a neutral translucent grey that stays legible
// on both light and dark bubbles. Used to derive the muted secondary text
// colour from whichever primary bubble-text colour the active theme gives
// us, instead of the old hard-coded black/white that broke in Day theme.
function _toRgba(color, alpha) {
    if (typeof color !== 'string') return `rgba(0,0,0,${alpha})`;
    const c = color.trim();
    const hexMatch = c.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }
    const rgbMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
        return `rgba(${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]},${alpha})`;
    }
    // Unparseable (named colour) — neutral translucent grey reads on both.
    return `rgba(128,128,128,${alpha})`;
}

// Is the supplied bubble-background colour dark enough that white overlay
// UI (the trail scrubber) reads on top of it? Parses hex / rgb to relative
// luminance; unparseable named colours (the themes only ship 'green' for
// the Night incoming bubble, which is dark) default to dark/true so the
// white-on-green Night look is preserved. Lets the scrubber pick white vs
// blue based on the ACTUAL bubble colour instead of message direction,
// which is what left the slider white-on-white on Day-theme incoming
// bubbles.
function _isDarkColor(color) {
    if (typeof color !== 'string') return true;
    const c = color.trim();
    let r, g, b;
    const hexMatch = c.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
    } else {
        const rgbMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (!rgbMatch) return true; // named colour (e.g. 'green') → treat as dark
        r = Number(rgbMatch[1]);
        g = Number(rgbMatch[2]);
        b = Number(rgbMatch[3]);
    }
    // Perceived luminance (ITU-R BT.601). < 0.55 → dark bubble.
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.55;
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
        trail,
        // Optional override: when the parent bubble is being scrubbed
        // through its trail, these point at the trail position
        // currently selected by the slider. The owner avatar is
        // re-anchored to this point so the user can visually follow
        // their movement without us re-fitting the camera (auto-zoom
        // still uses the full trail bbox so the line stays in frame).
        scrubLatitude,
        scrubLongitude,
        // Pan offset in pixels — applied as a uniform translate to
        // every absolutely-positioned child (tiles + polyline + pins
        // + start dot). Positive panX shifts content LEFT (= the
        // camera moved RIGHT, panned east). Driven by the bubble's
        // four directional arrows; recenter button resets to (0, 0).
        // The 5x5 tile grid we render around the centre gives ~512 px
        // of pan headroom in every direction before edges go grey.
        panX = 0,
        panY = 0,
        // True when the parent bubble's "current location" button
        // has been tapped: the map should centre on the owner's
        // latest GPS fix (the `latitude`/`longitude` props) rather
        // than the centroid of all visible points. Scrub override
        // still wins over this — actively dragging the slider
        // pivots the map around the scrubbed point.
        centerOnOwner = false,
        // Map dimensions. Default to the inline-bubble size; the
        // fullscreen viewer overrides these with Dimensions.get('window')
        // so the same StaticMap fills the whole screen without any other
        // code changes. The `MAP_WIDTH` / `MAP_HEIGHT` shadows below
        // mean the rest of the projection / tile / pin math reads
        // these dynamically with zero source-line changes.
        mapWidth = DEFAULT_MAP_WIDTH,
        mapHeight = DEFAULT_MAP_HEIGHT,
        // Optional radius circle — used by ShareLocationModal's
        // destination preview to visualise the privacy radius the
        // user has chosen on the slider, drawn around the user's
        // current location. Center is decoupled from the owner pin
        // so the same machinery can serve other "show me this
        // distance ring" needs in the future. Skipped when any
        // of the three are missing.
        circleCenterLatitude,
        circleCenterLongitude,
        circleRadiusMeters,
        // When true, swap the two avatar fill colours so the LOCAL
        // user always reads as red and the peer as blue on THIS device.
        // The parent passes this on incoming bubbles: the pin coords /
        // initials are still author=owner-slot, peer=peer-slot, but the
        // receiver wants to see *themselves* (the peer slot on incoming)
        // in red. Swapping just the two colours keeps every initial
        // glued to its own pin while flipping which person is red.
        swapAvatarColors = false,
        // Meet-session START points — each party's FIRST GPS fix. Rendered as
        // small secondary dots beneath the live avatars so a live meet shows
        // all four positions: each party's start + current. `start*` pairs with
        // the owner slot (same colour as the owner avatar), `peerStart*` with
        // the peer slot. Undefined for plain shares and for the frozen
        // end-of-meet summary (which renders its own 3-point view).
        startLatitude,
        startLongitude,
        peerStartLatitude,
        peerStartLongitude,
    } = props;
    const OWNER_PIN_COLOR = swapAvatarColors ? '#2E86DE' : '#E74C3C';
    const PEER_PIN_COLOR = swapAvatarColors ? '#E74C3C' : '#2E86DE';
    const MAP_WIDTH = mapWidth;
    const MAP_HEIGHT = mapHeight;

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
    const hasScrub =
        typeof scrubLatitude === 'number' &&
        typeof scrubLongitude === 'number';

    // The owner pin's effective coordinates: scrub override wins so
    // the avatar tracks the slider; otherwise fall back to the
    // share's latest tick. The bounding box for auto-zoom is computed
    // from latitude/longitude (the latest-tick value), so dragging
    // doesn't reflow the map — the avatar simply moves along the
    // visible polyline.
    const owner = hasScrub
        ? { latitude: scrubLatitude, longitude: scrubLongitude }
        : (hasOwner ? { latitude, longitude } : null);
    const peer = hasPeer ? { latitude: peerLatitude, longitude: peerLongitude } : null;
    const destination = hasDestination
        ? { latitude: destinationLatitude, longitude: destinationLongitude }
        : null;
    // Meet START points (secondary dots). Nullable — either party may not
    // have a captured start yet on the very first ticks.
    const hasStart =
        typeof startLatitude === 'number' &&
        typeof startLongitude === 'number';
    const hasPeerStart =
        typeof peerStartLatitude === 'number' &&
        typeof peerStartLongitude === 'number';
    const start = hasStart ? { latitude: startLatitude, longitude: startLongitude } : null;
    const peerStart = hasPeerStart ? { latitude: peerStartLatitude, longitude: peerStartLongitude } : null;

    // Sanitise the optional trail. Filter out null/NaN entries so we
    // can rely on every member being a valid {latitude, longitude}
    // pair (the timestamp field is optional from here on — we only
    // need it if a future variant draws speed/colour, today the
    // polyline is uniform).
    const trailPoints = Array.isArray(trail)
        ? trail.filter((p) => p
            && typeof p.latitude === 'number'
            && typeof p.longitude === 'number')
        : [];
    const hasTrail = trailPoints.length >= 2;

    // Collect every point we want visible. The frame is sized +
    // centred to fit the bounding box of whichever ones are known
    // so the user sees the full picture: where they are, where the
    // peer is, where they're heading, AND the full path travelled
    // so far. Falls back to a sensible default if everything is
    // missing (shouldn't happen — caller already gates on hasCoords).
    const visiblePoints = [];
    if (owner) visiblePoints.push(owner);
    if (peer) visiblePoints.push(peer);
    if (destination) visiblePoints.push(destination);
    if (start) visiblePoints.push(start);
    if (peerStart) visiblePoints.push(peerStart);
    for (const p of trailPoints) visiblePoints.push(p);

    // Explicit `zoom` prop wins unconditionally — this is what lets
    // LocationBubble's +/- controls override the auto-fit value. Falls
    // back to the original auto-fit logic when no override is supplied
    // (initial render / fresh bubble that hasn't been zoomed yet).
    const zoom = (typeof props.zoom === 'number')
        ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, props.zoom))
        : (visiblePoints.length > 1
            ? pickZoomToFitPoints(visiblePoints, 40, MAP_WIDTH, MAP_HEIGHT)
            : DEFAULT_ZOOM);

    // Centre point of the rendered map.
    //   • Slider ENGAGED (hasScrub true) → centre on the scrubbed
    //     point. Zoom and pan operations pivot around it, so the
    //     user can drill into a historical position with the point
    //     staying under their finger.
    //   • centerOnOwner true (current-location button) → centre on
    //     the owner's latest GPS fix. The avatar pin lands in the
    //     middle of the frame at the user's chosen zoom level.
    //   • Otherwise → centroid of visible points (auto-fit framing
    //     so the whole trail / peer / destination cluster is in
    //     view).
    let center;
    if (hasScrub) {
        center = { latitude: scrubLatitude, longitude: scrubLongitude };
    } else if (props.focusOnTarget === 'peer' && hasPeer) {
        // Focus-cycle override — recentre on the peer's pin.
        center = { latitude: peerLatitude, longitude: peerLongitude };
    } else if (props.focusOnTarget === 'destination' && hasDestination) {
        // Focus-cycle override — recentre on the meeting destination.
        center = { latitude: destinationLatitude, longitude: destinationLongitude };
    } else if (props.focusOnTarget === 'owner' && hasOwner) {
        // Focus-cycle override — recentre on the owner's latest fix.
        center = { latitude, longitude };
    } else if (centerOnOwner && hasOwner) {
        center = { latitude, longitude };
    } else if (visiblePoints.length > 1) {
        center = centroid(visiblePoints);
    } else if (visiblePoints[0]) {
        center = visiblePoints[0];
    } else if (typeof props.fallbackCenterLatitude === 'number'
            && typeof props.fallbackCenterLongitude === 'number') {
        // No renderable pin (e.g. the dummy-origin privacy invite: owner
        // suppressed, no destination, no peer yet). Centre on the caller-
        // supplied fallback so we show a real map area instead of the
        // null-island default.
        center = {
            latitude: props.fallbackCenterLatitude,
            longitude: props.fallbackCenterLongitude,
        };
    } else {
        center = {latitude: 0, longitude: 0};
    }

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
                <FastImage
                    key={`${zoom}-${tx}-${ty}`}
                    // `priority: high` makes the visible map view
                    // jump the FastImage queue — important when many
                    // bubbles are scrolling past in a chat history.
                    // `cache: immutable` tells FastImage the URL→bytes
                    // mapping never changes (slippy-map tiles are
                    // identified by z/x/y coordinates, never re-issued
                    // with different content) so it can skip its
                    // staleness checks and serve straight from disk
                    // when offline.
                    source={{
                        uri: tileUrl(zoom, tx, ty),
                        priority: FastImage.priority.high,
                        cache: FastImage.cacheControl.immutable,
                    }}
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
    const startPos = start ? project(start.latitude, start.longitude) : null;
    const peerStartPos = peerStart ? project(peerStart.latitude, peerStart.longitude) : null;
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

    // Small secondary dot for a meet party's START position. Same colour as
    // that party's avatar (so red-owner / blue-peer stay consistent), but
    // smaller and semi-transparent so the CURRENT-position avatar reads as
    // primary. A thin white ring lifts it off the tiles. No initials — the
    // avatar already carries them at the current position.
    const START_DOT = 13;
    const START_HALF = START_DOT / 2;
    const renderStartDot = (pos, color, key) => (
        <View
            key={key}
            pointerEvents="none"
            style={[
                styles.pin,
                {
                    left: pos.x - START_HALF,
                    top: pos.y - START_HALF,
                    width: START_DOT,
                    height: START_DOT,
                    borderRadius: START_HALF,
                    backgroundColor: color,
                    opacity: 0.6,
                    borderWidth: 2,
                    borderColor: '#fff',
                    shadowColor: '#000',
                    shadowOpacity: 0.2,
                    shadowRadius: 1,
                    shadowOffset: {width: 0, height: 1},
                    elevation: 2,
                },
            ]}
        />
    );

    // Trail polyline. Project every trail point through the same
    // tile-frame transform we use for pins, then connect them with
    // an SVG polyline. The start point gets a small "A" disc so the
    // user can tell which end of the path is the origin (current
    // position is already marked by the owner avatar, which sits at
    // the LAST trail point). pointerEvents="none" so the overlay
    // doesn't intercept the bubble's tap-to-open-maps gesture.
    let trailPolyline = null;
    let trailStartMarker = null;
    if (hasTrail) {
        const projected = trailPoints.map((p) => project(p.latitude, p.longitude));
        const pointsAttr = projected
            .map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`)
            .join(' ');
        // Small directional arrowhead at each hop point so a viewer
        // can tell which way the trail flows even when zoomed out
        // (a polyline alone is ambiguous — start vs end isn't obvious
        // without comparing the "A" dot and avatar, which can be off
        // screen on dense trails). The tip of each triangle points at
        // the NEXT hop along the path; the last point inherits the
        // direction of the previous segment so the avatar end-cap
        // also reads as forward-facing. We skip the first point (its
        // "A" start dot is rendered below and would just collide) and
        // any segment shorter than `MIN_SEG_PX` projected pixels,
        // since clusters of near-coincident GPS samples produce noisy
        // arrow rotation that visually flickers as the user zooms.
        const ARROW_TIP   = 5.5;   // pixels from hop point to triangle tip
        const ARROW_BACK  = 3.5;   // pixels from hop point to triangle base
        const ARROW_HALF  = 3.5;   // half-width of triangle base
        const MIN_SEG_PX  = 4;     // skip arrows on near-zero-length segments
        const hopArrows = [];
        for (let i = 1; i < projected.length; i++) {
            // Direction vector: prefer the segment LEAVING this point;
            // fall back to the segment ENTERING it for the terminal
            // hop. This keeps the arrow rotation visually consistent
            // with the polyline's local tangent at every hop.
            let dx, dy;
            if (i < projected.length - 1) {
                dx = projected[i + 1].x - projected[i].x;
                dy = projected[i + 1].y - projected[i].y;
            } else {
                dx = projected[i].x - projected[i - 1].x;
                dy = projected[i].y - projected[i - 1].y;
            }
            const len = Math.sqrt(dx * dx + dy * dy);
            if (!(len >= MIN_SEG_PX)) continue;
            const ux = dx / len;          // unit vector along travel
            const uy = dy / len;
            const px = -uy;                // perpendicular (right-hand)
            const py = ux;
            const cx = projected[i].x;
            const cy = projected[i].y;
            const tipX  = cx + ux * ARROW_TIP;
            const tipY  = cy + uy * ARROW_TIP;
            const baseLx = cx - ux * ARROW_BACK + px * ARROW_HALF;
            const baseLy = cy - uy * ARROW_BACK + py * ARROW_HALF;
            const baseRx = cx - ux * ARROW_BACK - px * ARROW_HALF;
            const baseRy = cy - uy * ARROW_BACK - py * ARROW_HALF;
            const ptsAttr =
                `${tipX.toFixed(1)},${tipY.toFixed(1)} ` +
                `${baseLx.toFixed(1)},${baseLy.toFixed(1)} ` +
                `${baseRx.toFixed(1)},${baseRy.toFixed(1)}`;
            hopArrows.push(
                <SvgPolygon
                    key={`hop-arrow-${i}`}
                    points={ptsAttr}
                    fill="#E74C3C"
                    stroke="#ffffff"
                    strokeWidth={1}
                    strokeLinejoin="round"
                />
            );
        }
        trailPolyline = (
            <Svg
                key="trail-svg"
                width={MAP_WIDTH}
                height={MAP_HEIGHT}
                style={{ position: 'absolute', left: 0, top: 0 }}
                pointerEvents="none"
            >
                {/* Soft white halo behind the coloured stroke so the
                    path stays legible against busy map tiles (roads,
                    shaded relief) without us having to vary stroke
                    colour per zoom level. */}
                <SvgPolyline
                    points={pointsAttr}
                    stroke="#ffffff"
                    strokeOpacity={0.75}
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                />
                <SvgPolyline
                    points={pointsAttr}
                    stroke="#E74C3C"
                    strokeOpacity={0.95}
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                />
                {/* Directional arrowheads at each hop point. Rendered
                    ABOVE the polyline so the triangle sits on top of
                    the red stroke (otherwise the stroke would cover
                    the body of the arrow), but BELOW the start dot
                    so the "A" marker at the trail origin stays the
                    visually dominant end-cap. */}
                {hopArrows}
                {/* Small filled circle at the trail's start so it's
                    visually distinct from the avatar at the current
                    position. Black dot inside a white halo, sized
                    smaller than the avatar so it reads as a
                    secondary marker. */}
                <SvgCircle
                    cx={projected[0].x}
                    cy={projected[0].y}
                    r={5}
                    fill="#ffffff"
                    stroke="#000000"
                    strokeWidth={1.5}
                />
                <SvgCircle
                    cx={projected[0].x}
                    cy={projected[0].y}
                    r={2}
                    fill="#000000"
                />
            </Svg>
        );
        // Tiny "A" label adjacent to the start dot, drawn as a
        // separate <View> (rather than SvgText) because RN's font
        // rendering inside react-native-svg is uneven across
        // platforms — a plain Text node is portable and matches the
        // initials avatar typography.
        const startProj = projected[0];
        trailStartMarker = (
            <View
                key="trail-start-label"
                pointerEvents="none"
                style={{
                    position: 'absolute',
                    left: startProj.x + 6,
                    top: startProj.y - 14,
                    backgroundColor: 'rgba(255,255,255,0.85)',
                    borderRadius: 4,
                    paddingHorizontal: 3,
                    paddingVertical: 1,
                }}
            >
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#000' }}>A</Text>
            </View>
        );
    }

    // Optional privacy-radius circle. Projects the centre into the
    // same tile-frame pixel space the pins use, then converts the
    // metres radius into pixels via the Web-Mercator metres-per-pixel
    // formula at the centre latitude. We use SvgCircle so the ring
    // scales with the map's existing zoom UI — the user sees the
    // ring grow/shrink as they zoom in/out, matching their intuition
    // for "what's INSIDE the privacy zone." Skipped when any input
    // is missing or the projected radius would be sub-pixel /
    // larger than the frame (degenerate at extreme zoom-out).
    let privacyCircle = null;
    if (typeof circleCenterLatitude === 'number'
            && typeof circleCenterLongitude === 'number'
            && typeof circleRadiusMeters === 'number'
            && circleRadiusMeters > 0) {
        const cProj = project(circleCenterLatitude, circleCenterLongitude);
        // metres per pixel at this latitude / zoom (Web-Mercator).
        // 156543.03392 is the canonical "ground resolution at the
        // equator at zoom 0" constant.
        const latRad = circleCenterLatitude * Math.PI / 180;
        const metresPerPixel = (156543.03392 * Math.cos(latRad)) / Math.pow(2, zoom);
        const radiusPx = metresPerPixel > 0
            ? circleRadiusMeters / metresPerPixel
            : 0;
        // Render only when the ring would be visible — sub-pixel
        // rings are noise, and a ring larger than the diagonal of
        // the map just paints the whole frame purple. The 4×
        // diagonal cap is generous enough that the user can still
        // see the ring extending well past the visible area when
        // they're zoomed in close, but bails out at world-view
        // zooms where the ring is meaningless.
        const _diag = Math.sqrt(MAP_WIDTH * MAP_WIDTH + MAP_HEIGHT * MAP_HEIGHT);
        if (radiusPx >= 2 && radiusPx <= _diag * 4) {
            privacyCircle = (
                <Svg
                    key="privacy-circle"
                    width={MAP_WIDTH}
                    height={MAP_HEIGHT}
                    style={{ position: 'absolute', left: 0, top: 0 }}
                    pointerEvents="none"
                >
                    {/* Soft purple fill so the ring reads as a
                        "private zone" without obscuring the
                        underlying tiles or the destination pin. */}
                    <SvgCircle
                        cx={cProj.x}
                        cy={cProj.y}
                        r={radiusPx}
                        fill="rgba(142,68,173,0.12)"
                        stroke="rgba(142,68,173,0.85)"
                        strokeWidth={1.5}
                        strokeDasharray="6,4"
                    />
                </Svg>
            );
        }
    }

    // The mapFrame clips its children with overflow:hidden. The
    // inner translate-View shifts every absolutely-positioned child
    // (tiles, polyline, start dot, pins) by (-panX, -panY) so the
    // user sees a panned region of the map. Tiles outside the
    // ±~640 px headroom we pre-render show as grey, which is fine —
    // the recenter button is one tap away.
    const _panTransform = [
        { translateX: -Number(panX) || 0 },
        { translateY: -Number(panY) || 0 },
    ];
    return (
        <View style={[styles.mapFrame, {width: MAP_WIDTH, height: MAP_HEIGHT}]}>
            <View
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: MAP_WIDTH,
                    height: MAP_HEIGHT,
                    transform: _panTransform,
                }}
            >
                {tiles}
                {/* Privacy-radius circle, rendered ABOVE the tiles but
                    BELOW everything else so pins and the trail
                    polyline stay readable on top of the soft fill. */}
                {privacyCircle}
                {/* Trail rendered ABOVE the tiles but BELOW the pins so
                    the avatar/destination markers stay readable on top
                    of the polyline. */}
                {trailPolyline}
                {trailStartMarker}
                {/* Meet START dots, drawn BELOW the destination flag and the
                    live avatars so the current-position markers stay visually
                    dominant. Own start uses the owner colour, peer start the
                    peer colour, matching their respective avatars. */}
                {startPos ? renderStartDot(startPos, OWNER_PIN_COLOR, 'owner-start-dot') : null}
                {peerStartPos ? renderStartDot(peerStartPos, PEER_PIN_COLOR, 'peer-start-dot') : null}
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
                {peerPos ? renderAvatar(peerPos, PEER_PIN_COLOR, peerInitials, 'peer-avatar') : null}
                {ownerPos ? renderAvatar(ownerPos, OWNER_PIN_COLOR, ownerInitials, 'owner-avatar') : null}
            </View>
        </View>
    );
});

// Prototype bubble for a live-location message. Renders inside the normal
// GiftedChat bubble wrapper (via renderMessageText) so the bubble background
// and tail still come from ChatBubble.
const LocationBubble = memo(({ currentMessage, metadata, trail, onLongPress, ownerName, peerName, fullScreen = false, onOpenFullScreen, insets = null }) => {
    // Per-render map dimensions. Inline bubble keeps the cosy
    // 300x200 tile grid; the fullscreen viewer (long-press → "Full
    // screen") fills the whole window — minus the Modal padding /
    // close-button gutter we leave at the bottom of the screen — so
    // the user can read street-level detail without leaving the chat.
    // Both values are captured into MAP_WIDTH / MAP_HEIGHT shadows
    // immediately so the rest of the function (auto-fit math, scale
    // label, scrubber width, pan-button positions) reads them
    // transparently.
    //
    // Android insets: the fullscreen viewer lives in an RN <Modal>,
    // which on Android is its OWN edge-to-edge window — the host
    // SafeAreaView does NOT clip it, and Dimensions.get('window')
    // reports the whole screen INCLUDING the status bar (top) and the
    // gesture / navigation bar (bottom). Without subtracting the
    // safe-area insets the centered card runs UNDER those system bars
    // and its map controls (Focus/zoom at top:16, pan arrows, scrubber)
    // hide beneath them. ChatBox hands the insets down via the `insets`
    // prop (with the Android StatusBar.currentHeight fallback already
    // applied), so we shrink the width/height budget by them here. The
    // card is centered in the Modal, so removing the FULL top+bottom
    // (and left+right) inset from the budget guarantees the symmetric
    // margins clear both system bars. Insets are only meaningful in
    // fullScreen mode; the inline chat bubble ignores them.
    const _winDims = fullScreen ? Dimensions.get('window') : null;
    const _fsInsetTop = (fullScreen && insets && typeof insets.top === 'number') ? insets.top : 0;
    const _fsInsetBottom = (fullScreen && insets && typeof insets.bottom === 'number') ? insets.bottom : 0;
    const _fsInsetLeft = (fullScreen && insets && typeof insets.left === 'number') ? insets.left : 0;
    const _fsInsetRight = (fullScreen && insets && typeof insets.right === 'number') ? insets.right : 0;
    const MAP_WIDTH = fullScreen
        ? Math.max(280, Math.floor(_winDims.width - _fsInsetLeft - _fsInsetRight - 16))
        : DEFAULT_MAP_WIDTH;
    const MAP_HEIGHT = fullScreen
        ? Math.max(280, Math.floor(_winDims.height - _fsInsetTop - _fsInsetBottom - 220))
        : DEFAULT_MAP_HEIGHT;
    // We need GiftedChat's own context here so we can hand it back to the
    // host's `onLongMessagePress(context, message)` — the ActionSheet APIs
    // that contextual menu uses live on `context.actionSheet()`.
    const chatContext = useContext(GiftedChatContext);
    // Location engine (null if this bubble is somehow rendered outside the
    // NavigationBar provider — guarded everywhere below). Used to (a) tell
    // whether THIS device still has a live session backing this bubble and
    // (b) stop it straight from the map footer.
    const locationEngine = useContext(LocationSharingContext);

    // Per-sharing-entity zoom override. `null` means "use auto" (the
    // bounding-box fit picked by pickZoomToFitPoints, or DEFAULT_ZOOM
    // for single-point views). Setting a number pins the map at that
    // zoom level for THIS bubble until the user clears it. Persisted to
    // AsyncStorage on every change so reopening the chat restores the
    // user's last pick.
    const [zoomOverride, setZoomOverride] = useState(null);

    // "Focus on latest" mode. When true, StaticMap re-centres on
    // the owner's latest GPS fix (instead of the centroid of all
    // visible points), without touching the zoom level. Toggled on
    // by the current-location button and cleared by the restore
    // button or by re-engaging the slider — those actions take
    // priority for centring.
    const [focusedOnLatest, setFocusedOnLatest] = useState(false);

    // Focus-cycle target. The Focus button advances through
    // available pins on each tap: 'peer' → 'destination' → 'owner' →
    // 'peer' → … Skips targets whose coords don't exist for this
    // bubble (e.g. plain shares have no destination; one-shots have
    // no peer). Centred + zoomed-in via StaticMap's `focusOnTarget`
    // prop. null = no override (auto-fit / centroid path).
    const [focusTarget, setFocusTarget] = useState(null);

    // Optimistic "I just tapped Stop on this bubble" flag. The engine tears the
    // session down synchronously, but the live map bubble's meta only refreshes
    // to "Track ended" on the next getMessages rebuild — which is gated on
    // selectedContact and can lag (or be skipped when that state momentarily
    // flickers null). Flipping this on tap forces THIS bubble to re-render and
    // drop the Stop button immediately, instead of leaving a dead button until
    // the user reloads the chat. A fresh session = a new bubble instance = fresh
    // state, so it never needs an explicit reset.
    const [justStopped, setJustStopped] = useState(false);

    // Pan offset in pixels. {x: 0, y: 0} = no pan, view centered on
    // the auto-fit centroid (or whatever StaticMap's centering math
    // picks). Positive x = pan east (camera moves right, content
    // shifts left); positive y = pan south (content shifts up). Each
    // tap of the four directional arrows on the map applies a fixed
    // pixel step. The recenter button resets this to {0, 0} so the
    // bubble snaps back to its auto-fit framing — also handy when
    // the user has wandered off the trail and wants to find it again.
    const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

    // Trail scrubber state. `null` = not interacting; the bubble
    // shows the latest GPS fix as the owner avatar. A numeric index
    // (0..trail.length-1) means the user is dragging the slider —
    // we reposition the avatar to that historical tick and surface
    // its timestamp in a small label above the slider so the user
    // can answer "where was I at 14:32?". Reset implicitly when the
    // user lifts their finger (onSeek release fires through to
    // setScrubIndex(null)).
    const [scrubIndex, setScrubIndex] = useState(null);

    // Last-known-good coords cache. The sender's GPS can drop out
    // mid-share (entering a tunnel, walking into a building, OS
    // killing the location stream); when that happens NavigationBar
    // can emit a tick without coords, which would otherwise revert the
    // bubble to the "Locating…" placeholder and hide the map. We cache
    // the most recent good {latitude, longitude} we've seen and fall
    // back to those when the current tick is null. Caches the timestamp
    // alongside so the title can show how stale the fix is.
    const lastKnownRef = useRef(null);

    const messageKey = currentMessage && currentMessage._id;

    // Load any previously-saved zoom for this bubble on mount / when the
    // bubble's identity changes (e.g. swapping which bubble is rendered
    // because the chat scrolled). Late-arriving values get applied via
    // setZoomOverride; the dependency array deliberately keys only on
    // messageKey so we don't refetch on every parent re-render.
    // (Removed) Persisted zoom restore.
    //
    // We used to read the user's last-chosen zoom from AsyncStorage
    // here on mount and apply it as the override, so reopening a
    // share kept the same zoom level the user was previously using.
    // That conflicted with the "initial load must fit the whole
    // trail" requirement: as the trail grew over the course of a
    // share, the saved zoom (locked to an earlier, smaller
    // bounding box) became too tight, and the trail's start point
    // would land off-screen. The user reported "if I zoom out I
    // can find the start and end points but not at the initial
    // load" — exactly this situation.
    //
    // Now the bubble always opens at auto-fit (whatever zoom level
    // contains every owner / peer / destination / trail point).
    // The +/- buttons still adjust the in-session zoom, but those
    // overrides are transient — closing and reopening the chat
    // resets to auto-fit. If we want a smarter "remember zoom but
    // never below auto-fit" behaviour later, we can compare the
    // saved value to autoZoom on load and clamp; for now the
    // simpler dropped-persistence answer matches the "show me my
    // whole path" expectation.

    const meta = metadata || currentMessage?.metadata;

    // Meet-session detection — the umbrella that covers BOTH sides of
    // a meet-up handshake:
    //   • `meeting_request: true`  → requester's origin bubble
    //   • `in_reply_to` set        → accepter's reply bubble
    // For a meet-up the bubble's job is unambiguous: show BOTH parties
    // on a single map with the live distance between them. There is no
    // value in showing the historical trail polyline (the path each
    // person took to converge is just visual noise) nor in exposing a
    // scrubber slider (there is nothing meaningful to scrub through).
    // Plain timed shares ("for 4h", "until I return", etc.) keep both
    // because for those the path IS the story. Declared early so the
    // auto-fit + trail-rendering passes below can branch on it without
    // tripping the const TDZ.
    const isMeetSession = !!(meta && (meta.meeting_request === true || meta.role));

    // FROZEN MEET SUMMARY (Stage 3). When a meet ends, app.js stamps
    // meta.meetOutcome on the session's rows and keeps the map: a 3-point
    // summary (each party's point + the meeting point). SUCCESS shows each
    // party's START point, failure their LAST point (chosen in app.js by which
    // rows survive). Here we only need the outcome LABEL and to render static.
    const meetOutcome = meta && meta.meetOutcome ? meta.meetOutcome : null;
    const meetOutcomeLabel = meetOutcome === 'succeeded' ? 'Meet-up succeeded'
        : meetOutcome === 'expired' ? 'Meet-up expired'
        : meetOutcome === 'cancelled' ? 'Meet-up cancelled'
        : meetOutcome === 'ended' ? 'Meet-up ended'
        : null;

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

    const rawLatitude = metaValue.latitude;
    const rawLongitude = metaValue.longitude;
    const rawAccuracy = metaValue.accuracy;
    const hasFreshCoords =
        typeof rawLatitude === 'number' && typeof rawLongitude === 'number';

    // Refresh the last-known cache whenever a fresh tick brings real
    // coords. Stamp the ref with the tick's own timestamp (or fall back
    // to the message timestamp) so we can label "Last known X ago" if
    // the GPS later drops out.
    if (hasFreshCoords) {
        lastKnownRef.current = {
            latitude: rawLatitude,
            longitude: rawLongitude,
            accuracy: rawAccuracy,
            timestamp: metaValue.timestamp || meta.timestamp || Date.now(),
        };
    }

    // The values we actually display: prefer fresh, fall back to the
    // cached last-known position. `isStale` is true when we're showing
    // the cached value because the current tick has no coords —
    // surfaces the "Last known location" title in that case.
    const cached = lastKnownRef.current;
    const latitude = hasFreshCoords ? rawLatitude : (cached ? cached.latitude : null);
    const longitude = hasFreshCoords ? rawLongitude : (cached ? cached.longitude : null);
    const accuracy = hasFreshCoords ? rawAccuracy : (cached ? cached.accuracy : null);
    const isStale = !hasFreshCoords && cached != null;

    // `hasCoords` gates the real map render. With the null-coord
    // stripping in place (sender side blocks emission, all SQL save
    // paths reject null-coord ticks), the only way we end up here
    // without coords is a legacy SQL row from before the fix landed
    // OR a brand-new share whose first GPS fix hasn't arrived yet.
    // The last-known cache (lastKnownRef above) covers the within-
    // mount GPS-dropout case; the getMessages SQL salvage covers
    // legacy plain-share rows by overlaying the most recent trail
    // tick. Anything that still falls through is unrecoverable —
    // we hide the bubble entirely (return null below) rather than
    // leaving a "Locating…" stub the user can't act on.
    const hasCoords =
        typeof latitude === 'number' && typeof longitude === 'number';

    // No usable coords AND nothing in the cache → don't render. The
    // chat list shows nothing for this bubble until a real-coord tick
    // arrives (sender-side) or the share is re-started (legacy data).
    if (!hasCoords) {
        return null;
    }

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

    // Privacy-deferred state, lifted to the outer LocationBubble
    // scope so it's reachable by the zoom-button + pan-cluster JSX
    // below (those live outside the StaticMap IIFE that originally
    // owned these constants). Shadowed inside the IIFE doesn't
    // matter — same conditions, same values.
    const isPrivacyDeferred = !!(meta && meta.privacyDeferred);
    // The bottom strip is rendered only on the inviter's OWN view of
    // a privacy-deferred bubble (outgoing direction) and only once we
    // have a radius value to print in the hint. Bottom-anchored map
    // controls (zoom -, pan-down, restore) read this to lift
    // themselves up by ~24 px so they don't overlap the strip.
    // The strip fires whenever THIS DEVICE has a privacy radius
    // armed for this bubble (regardless of incoming/outgoing — the
    // accepter sees their own strip on the incoming request bubble
    // too). We key off `meta.localOwnerRadiusMeters` because that's
    // the local-only stamp; meta.privacyDeferredRadiusMeters is the
    // OTHER party's radius on the wire and would mislead the strip
    // text on incoming bubbles.
    const _showPrivacyStrip = isPrivacyDeferred
        && !!(meta && meta.localOwnerCoords
            && typeof meta.localOwnerRadiusMeters === 'number'
            && meta.localOwnerRadiusMeters > 0);

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
    // Privacy-deferred ticks ship the destination AS the value coords
    // (the wire stays clean — peer doesn't see the inviter's actual
    // position). The inviter's OWN device, however, has the real
    // coords stamped local-only on `meta.localOwnerCoords` (set by
    // app.js's _setLocalOwnerCoordsForBubble). We use those for the
    // OUTGOING side so the inviter sees themselves on the map and
    // gets a real distance to the meeting point.
    const _isPrivacyDeferredForDist = !!(meta && meta.privacyDeferred);
    const _localOwnCoords = (meta
            && meta.localOwnerCoords
            && typeof meta.localOwnerCoords.latitude === 'number'
            && typeof meta.localOwnerCoords.longitude === 'number')
        ? meta.localOwnerCoords
        : null;
    const myCoords = isIncoming
        ? (
            // Incoming privacy-deferred bubble (accepter's view of
            // the request bubble): prefer local-only owner coords
            // (B's real coords stamped on this device only). Fall
            // back to peerCoords for the normal incoming case.
            (_isPrivacyDeferredForDist && _localOwnCoords)
                ? _localOwnCoords
                : (meta.peerCoords && typeof meta.peerCoords.latitude === 'number'
                    ? meta.peerCoords : null)
        )
        : (
            // Outgoing privacy-deferred bubble (requester's own
            // bubble): prefer local-only owner coords (A's real
            // coords stamped on this device only — never on the
            // wire). Fall back to value coords for the normal
            // (non-deferred) outgoing case.
            (_isPrivacyDeferredForDist && _localOwnCoords)
                ? _localOwnCoords
                : (meta.value && typeof meta.value.latitude === 'number'
                    ? meta.value : null)
        );
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
    // Bubble text colour must follow the active theme, not the message
    // direction alone. The old `isIncoming ? '#fff' : '#000'` assumed an
    // incoming bubble was always dark (Night theme: incoming = green), but
    // in Day theme the incoming bubble is white (theme.bubbleIncoming =
    // '#FFFFFF'), so white text rendered white-on-white and vanished. Pull
    // the contrasting colour from the active theme's bubble-text keys
    // (bubbleIncomingText / bubbleOutgoingText) so the title/footer text
    // stays readable on either bubble in either mode — same approach the
    // image bubble's footer uses.
    const _bubbleTheme = DarkModeManager.getTheme();
    // In the fullscreen viewer the card sits on the app's themed screen
    // background (see ChatBox's fullScreenLocation wrapper), so the info
    // text follows the active day/night theme (textPrimary) rather than the
    // per-bubble text colour — otherwise the text can't contrast the backdrop.
    const textColor = fullScreen
        ? _bubbleTheme.textPrimary
        : (isIncoming
            ? _bubbleTheme.bubbleIncomingText
            : _bubbleTheme.bubbleOutgoingText);
    // Secondary (muted) text: a translucent version of the primary colour
    // so it reads as de-emphasised against whichever bubble background the
    // theme provides. Derived from textColor's RGB with reduced alpha
    // rather than a hard-coded black/white, which is what previously broke.
    const subColor = _toRgba(textColor, 0.7);
    // Does the active bubble background read as dark? Drives the trail
    // scrubber's white-vs-blue colouring below so the slider contrasts
    // with the real bubble colour rather than assuming incoming == dark.
    const _bubbleBg = isIncoming
        ? _bubbleTheme.bubbleIncoming
        : _bubbleTheme.bubbleOutgoing;
    // Fullscreen backdrop is black, so treat the surface as dark for the
    // scrubber / control colouring too.
    const bubbleIsDark = fullScreen ? DarkModeManager.isDark() : _isDarkColor(_bubbleBg);

    const openMap = () => {
        // Guard: without coords (placeholder "Locating…" state) there's
        // nothing to hand off to the maps app. The footer button is
        // disabled in that state too, but double-check here in case
        // something else (long-press accelerator, etc.) calls us.
        if (!hasCoords) return;

        // Single-point handoff to Google Maps / Apple Maps.
        //
        // Earlier we tried opening a Google Maps directions URL with
        // the trail's points as waypoints, hoping the receiver would
        // see a path A → … → B. The actual result was Google routing
        // between every consecutive pair via its road network — a
        // chaotic multi-leg car route through suburbia rather than
        // the GPS polyline we wanted. Google Maps' URL scheme has no
        // "drop these N pins without routing" mode, so any waypoint
        // approach inevitably triggers routing.
        //
        // Instead, the inline static-map preview in this bubble is
        // the canonical "see the path" view (it already renders the
        // full GPS polyline + start dot + current avatar with
        // pixel-accurate alignment). The external open is just the
        // pragmatic "navigate from here / show me on Google Maps"
        // gesture, so we hand off ONE point and let the user pick
        // walking/driving/transit themselves.
        //
        // Three cases keep the original priority:
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
    // The peer (or we) explicitly stopped the live track — stamped as
    // meta.ended by app.js._endLocationTrack on location_stop. Once a track
    // has ended, its expiry window is irrelevant, so show "Track ended"
    // instead of a stale "Expires in …" countdown. Takes precedence over the
    // expiry-based "Sharing ended".
    // `justStopped` (the user just tapped Stop on THIS bubble) is folded in so
    // the footer flips to the ended label and the Stop button drops immediately,
    // without waiting for the meta.ended repaint that a getMessages rebuild
    // brings.
    const trackEnded = !!(meta && meta.ended) || justStopped;
    // Until-I-return shares end with reason 'returned' — show "Returned"
    // rather than the generic "Track ended".
    const _endedReason = meta && meta.endedReason;
    const _endedAt = meta && meta.endedAt;
    const _returnedLabel = _endedAt
        ? `Returned at ${_clock12(_endedAt)}`
        : 'Returned';
    const expirationLine = meetOutcomeLabel
        // Frozen meet summary: the footer echoes the outcome ("Meet-up ended"
        // etc.) instead of the generic "Track ended".
        ? meetOutcomeLabel
        : trackEnded
        ? (_endedReason === 'returned' ? _returnedLabel : 'Ended')
        : isExpired
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

    // "Stop sharing" affordance on the OWNER's own live map. Shown in place of
    // the "Expires in …" countdown when THIS device is still broadcasting the
    // session this bubble represents, so the user can end it straight from the
    // map. Gated on the engine's REAL session state (a matching live entry),
    // not on meta.expires — a stale/ended bubble that still carries a future
    // expiry must NOT offer a dead Stop button. Incoming and one-shot bubbles
    // never qualify (nothing local to stop).
    const _shareUri = (meta && meta.uri) || null;
    // Session anchor the engine keys by: a plain share's == its
    // originLocationId, a meet's == its meetingSessionId. Both resolve through
    // stopLocationSharing({sessionId}) → _entryByOrigin.
    const _shareSessionId = (meta && meta.messageId) || null;
    // A plain incoming share (peer→us) has nothing local to stop, so it's gated
    // out. A MEET bubble is the exception: a meet is mutual, so either side can
    // end it — including the accepter, whose bubble arrived 'incoming'. So meet
    // bubbles are eligible regardless of direction; plain bubbles only when
    // outgoing (ours). One-shot bubbles never qualify.
    // Once THIS session's track has ended (peer stopped, we stopped, it
    // expired, or an until-I-return auto-stop) the bubble is frozen — meta.ended
    // is stamped by _endLocationTrack. Never offer Stop on an ended/expired
    // bubble: the local timer is already gone, so a tap would only relay a
    // no-op stop on the wire and the button would never clear (reported: emu
    // kept "sending another stop" after the mirror ended the share). trackEnded
    // is computed above from meta.ended; isExpired from the expiry window.
    const _stopEligible = !isOneShot && !trackEnded && !isExpired
        && (isMeetSession || !isIncoming);
    let _sessionActive = false;
    if (_stopEligible && locationEngine && _shareUri && _shareSessionId
            && typeof locationEngine.hasStoppableSessionForBubble === 'function') {
        try {
            _sessionActive = locationEngine.hasStoppableSessionForBubble(
                _shareUri, _shareSessionId, isMeetSession);
        } catch (e) { _sessionActive = false; }
    }
    const onStopShareFromMap = () => {
        if (!locationEngine || !_shareUri
                || typeof locationEngine.stopLocationSharing !== 'function') return;
        // Optimistically drop the Stop button on this bubble right away — the
        // engine teardown is synchronous but the bubble's "Track ended" repaint
        // can lag behind it.
        try { setJustStopped(true); } catch (e) { /* best-effort */ }
        try {
            // Pass the TYPE (meet vs plain) so the engine routes to the right
            // store / relay even when _shareSessionId no longer matches the
            // (post-accept) origin id, and stops the correct one of a contact's
            // two possible concurrent sessions.
            locationEngine.stopLocationSharing(_shareUri, {
                sessionId: _shareSessionId,
                meet: isMeetSession,
                reason: 'user',
            });
        } catch (e) { /* best-effort */ }
    };

    // Compute the auto-fit zoom that StaticMap would otherwise pick on
    // its own. We mirror its logic here so we know what "auto" looks
    // like at this exact moment — both for seeding the +/- buttons when
    // the user hasn't picked anything yet, and for keeping the disabled
    // states accurate at the boundaries.
    //
    // The trail (when present) is included so the auto-fit zooms out
    // far enough to show the entire path A → … → B, not just the
    // current position. Each trail point is treated as a regular
    // bounding-box contributor.
    const _autoZoomPoints = [];
    if (hasCoords) _autoZoomPoints.push({ latitude, longitude });
    if (hasPeer) _autoZoomPoints.push({ latitude: peerLatitude, longitude: peerLongitude });
    if (meta.destination
            && typeof meta.destination.latitude === 'number'
            && typeof meta.destination.longitude === 'number') {
        _autoZoomPoints.push(meta.destination);
    }
    // Privacy-deferred outgoing bubble: meta.value coords are the
    // destination (a stand-in to keep the inviter's real position off
    // the wire). The auto-fit framing must include the inviter's
    // REAL coords (meta.localOwnerCoords, stamped local-only) so the
    // map zooms out to show both the inviter's position AND the
    // destination — without this, both `hasCoords` and
    // `meta.destination` collapse onto the same point and the map
    // stays at street-level zoom centred on the destination, leaving
    // the inviter pin offscreen at their real location km away.
    if (meta.localOwnerCoords
            && typeof meta.localOwnerCoords.latitude === 'number'
            && typeof meta.localOwnerCoords.longitude === 'number') {
        _autoZoomPoints.push({
            latitude: meta.localOwnerCoords.latitude,
            longitude: meta.localOwnerCoords.longitude,
        });
    }
    // Trail points are folded into the auto-fit ONLY for plain timed
    // shares — for those, "show me the whole path" is the goal. Meet
    // sessions deliberately exclude them (we want the auto-fit zoom to
    // frame the two participants + destination, not the meandering
    // path each one took to get there). isMeetSession is computed
    // further down but the order of `const`s in this function makes
    // it available here when read; if the bubble adds a destination it
    // still contributes to the bounding box above.
    if (!isMeetSession && Array.isArray(trail)) {
        for (const p of trail) {
            if (p
                    && typeof p.latitude === 'number'
                    && typeof p.longitude === 'number') {
                _autoZoomPoints.push({latitude: p.latitude, longitude: p.longitude});
            }
        }
    }
    const autoZoom = _autoZoomPoints.length > 1
        ? pickZoomToFitPoints(_autoZoomPoints, 40, MAP_WIDTH, MAP_HEIGHT)
        : DEFAULT_ZOOM;
    // The zoom we actually render at: the saved override if the user
    // has interacted, otherwise the auto-fit value.
    const effectiveZoom = (typeof zoomOverride === 'number')
        ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomOverride))
        : autoZoom;
    const canZoomIn = effectiveZoom < MAX_ZOOM;
    const canZoomOut = effectiveZoom > MIN_ZOOM;

    // Map-scale label. Web-Mercator metres-per-pixel at a given zoom +
    // latitude is `156543.03392 * cos(lat) / 2^zoom`. Multiplying by
    // MAP_WIDTH gives the real-world width of the visible window. The
    // formula is latitude-dependent (Mercator stretches near the
    // poles), so we use whichever centre latitude the StaticMap would
    // pick — the centroid of the visible points when there's more than
    // one, the single point otherwise. Falls back to 0° if everything
    // is missing (the placeholder branch hides the scale anyway).
    let scaleCenterLat = 0;
    if (_autoZoomPoints.length > 1) {
        let sum = 0;
        for (const p of _autoZoomPoints) sum += p.latitude;
        scaleCenterLat = sum / _autoZoomPoints.length;
    } else if (_autoZoomPoints.length === 1) {
        scaleCenterLat = _autoZoomPoints[0].latitude;
    }
    const metersPerPixel = (156543.03392
        * Math.cos(scaleCenterLat * Math.PI / 180))
        / Math.pow(2, effectiveZoom);
    const mapWidthMeters = metersPerPixel * MAP_WIDTH;
    const scaleLabel = formatDistance(mapWidthMeters);

    const adjustZoom = (delta) => {
        const base = (typeof zoomOverride === 'number') ? zoomOverride : autoZoom;
        const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, base + delta));
        if (next === base && typeof zoomOverride === 'number') {
            // Already at the cap — nothing to update.
            console.log('[APPLOG] [map] ' + messageKey + ' zoom ' + (delta > 0 ? '+' : '-')
                + ' ignored (at cap, zoom=' + base + ')');
            return;
        }
        console.log('[APPLOG] [map] ' + messageKey + ' zoom ' + (delta > 0 ? '+' : '-')
            + ' ' + base + ' -> ' + next
            + (typeof zoomOverride === 'number' ? ' (override)' : ' (was auto-fit ' + autoZoom + ')'));
        setZoomOverride(next);
        // (Removed) AsyncStorage persistence of the user's zoom
        // choice. Each chat reopen now starts at auto-fit so the
        // full trail is visible — see the comment on the disabled
        // useEffect above for the full rationale.
    };

    // Single-tap behaviour:
    //   • Plain shares (one-shot OR live X-hour timed) and meeting-request
    //     replies route a tap straight to the external maps app — same
    //     thing the bottom-right "open in maps" icon does. Saves the user
    //     having to aim for the small footer icon when they just want
    //     directions.
    //   • Meeting REQUEST origin bubbles (meeting_request:true) keep the
    //     no-op tap behaviour so the bubble's contextual action ("Accept
    //     meeting request" in the long-press kebab) stays the obvious
    //     primary action — bouncing to maps from a meeting invite would
    //     be a confusing detour.
    // Long-press always opens the message contextual menu via triggerMenu,
    // matching every other bubble in the chat.
    const isMeetupRequest = !!(meta && meta.meeting_request === true);
    const tapOpensMap = !isMeetupRequest;
    // `isMeetSession` is computed near the top of LocationBubble (right
    // after `meta` is established) so the auto-fit zoom and trail
    // rendering passes can branch on it without tripping the const TDZ.

    // Slider JSX assembled here so we can render it as a SIBLING of
    // the bubble's tap-to-open-maps TouchableOpacity (in the return
    // below) rather than a descendant. When the slider was nested
    // inside the TouchableOpacity, the parent's responder grabbed
    // each touch before the slider's PanResponder could claim it
    // — the user reported "can't grab the slider anymore". Hoisting
    // the JSX to a sibling lets the slider's gesture handlers stand
    // alone with no responder competition; the bubble's tap-anywhere-
    // to-open-maps still works on the map + info area above.
    // The trail is already de-duplicated (one point per real tick) by the
    // caller that builds it from messagesMetadata — see ChatBox's trail
    // assembly, which keys on the TICK timestamp so distinct stationary ticks
    // survive while the out-echo/carbon duplicates of a single tick collapse.
    const _scrubValidTrail = Array.isArray(trail)
        ? trail.filter(p => p
            && typeof p.latitude === 'number'
            && typeof p.longitude === 'number')
        : [];
    let scrubberBlock = null;
    // Meet-session bubbles never show the slider (see `isMeetSession`
    // comment above) — the merged single-map / two-pin / live-distance
    // view is the whole point, and a scrubber would imply a history to
    // step through that doesn't apply.
    if (!isMeetSession && _scrubValidTrail.length >= 2) {
        const _maxIndex = _scrubValidTrail.length - 1;
        // Index → percentage. When not scrubbing, the needle sits
        // at the end (latest tick).
        const _scrubIdx = typeof scrubIndex === 'number'
            ? Math.max(0, Math.min(_maxIndex, scrubIndex))
            : _maxIndex;
        const _progressPct = (_scrubIdx / _maxIndex) * 100;
        const _formatTickTime = (ms) => {
            if (!Number.isFinite(ms) || ms <= 0) return '';
            const d = new Date(ms);
            const now = new Date();
            const sameDay = d.getFullYear() === now.getFullYear()
                && d.getMonth() === now.getMonth()
                && d.getDate() === now.getDate();
            if (sameDay) return _clock12(ms);
            const day = String(d.getDate()).padStart(2, '0');
            const mon = String(d.getMonth() + 1).padStart(2, '0');
            return `${day}/${mon} ${_clock12(ms)}`;
        };
        const _formatShareTime = (ms) => {
            if (!Number.isFinite(ms) || ms <= 0) return '';
            const d = new Date(ms);
            try {
                return d.toLocaleString();
            } catch (e) {
                return d.toISOString();
            }
        };
        const _scrubPoint = _scrubValidTrail[_scrubIdx];
        const _scrubTs = _scrubPoint ? _scrubPoint.timestamp : null;
        const _scrubLabel = _formatTickTime(_scrubTs);
        const _isScrubbing = typeof scrubIndex === 'number';
        const _doShare = () => {
            if (!_scrubPoint) return;
            const lat = _scrubPoint.latitude;
            const lng = _scrubPoint.longitude;
            const when = _formatShareTime(_scrubTs);
            const url = `https://maps.google.com/?q=${lat},${lng}`;
            const message = when
                ? `📍 Position on ${when}\n${url}`
                : `📍 Position\n${url}`;
            Share.share({ message }).catch((err) => {
                console.log('[location] scrub share failed',
                    err && err.message ? err.message : err);
            });
        };
        scrubberBlock = (
            <View style={[styles.scrubWrap, {width: MAP_WIDTH}]}>
                <View style={styles.scrubLabelRow}>
                    <Text
                        style={[
                            styles.scrubLabel,
                            {color: subColor, opacity: _isScrubbing ? 1 : 0.7, flexShrink: 1},
                        ]}
                        numberOfLines={1}
                    >
                        {_isScrubbing
                            ? `${_scrubLabel}  •  point ${_scrubIdx + 1}/${_scrubValidTrail.length}`
                            : `Latest: ${_scrubLabel}  •  ${_scrubValidTrail.length} points`}
                    </Text>
                    <View style={styles.scrubActions}>
                        <TouchableOpacity
                            onPress={_doShare}
                            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
                            accessibilityLabel="Share this point"
                            style={styles.scrubActionBtn}
                        >
                            <Icon
                                name="share-variant"
                                size={14}
                                color={textColor}
                            />
                        </TouchableOpacity>
                    </View>
                </View>
                <AudioProgressSlider
                    progress={_progressPct}
                    width={MAP_WIDTH}
                    height={4}
                    knobWidth={4}
                    knobHeight={16}
                    // Blue colour family matches the peer-pin tone
                    // (#2E86DE) used elsewhere on the map. A unified
                    // blue for the slider reads as "navigation /
                    // timeline UI" instead of competing with the
                    // owner-avatar red, which previously made the
                    // bar look like an extension of the avatar.
                    color={bubbleIsDark ? 'rgba(255,255,255,0.9)' : '#2E86DE'}
                    unfilledColor={bubbleIsDark
                        ? 'rgba(255,255,255,0.35)'
                        : 'rgba(46,134,222,0.25)'}
                    onSeekStart={() => {
                        // Plain console.log (no [APPLOG] tag) — start /
                        // move are dev-grade traces useful when
                        // debugging gesture handling, not the kind
                        // of user-meaningful event the [APPLOG]
                        // stream is meant to summarise.
                        console.log('[map] ' + messageKey + ' slider start at idx=' + _scrubIdx
                            + '/' + _maxIndex
                            + ' total=' + _scrubValidTrail.length);
                        setScrubIndex(_scrubIdx);
                    }}
                    onSeekChange={(pct) => {
                        const idx = Math.round((pct / 100) * _maxIndex);
                        const clamped = Math.max(0, Math.min(_maxIndex, idx));
                        // Per-move trace intentionally omitted — the
                        // [APPLOG] release line below records the point
                        // the user actually lands on. Re-enable a per-
                        // point log here if a future regression needs to
                        // inspect individual gesture frames.
                        setScrubIndex(clamped);
                    }}
                    onSeek={(pct) => {
                        const idx = Math.round((pct / 100) * _maxIndex);
                        const clamped = Math.max(0, Math.min(_maxIndex, idx));
                        const _trailPoint = _scrubValidTrail[clamped];
                        const _whenStr = _trailPoint && Number.isFinite(_trailPoint.timestamp)
                            ? new Date(_trailPoint.timestamp).toISOString()
                            : '(no-ts)';
                        const _coordsStr = _trailPoint
                                && typeof _trailPoint.latitude === 'number'
                                && typeof _trailPoint.longitude === 'number'
                            ? _trailPoint.latitude.toFixed(5) + ',' + _trailPoint.longitude.toFixed(5)
                            : '(no-coords)';
                        // High-level summary: "user scrolled the
                        // slider to point N of M, GPS fix at
                        // <timestamp>, coords lat,lng". One line
                        // per release — the only event the user
                        // actually performed — tagged [APPLOG] so
                        // it shows up in the user-action stream.
                        console.log('[APPLOG] [map] ' + messageKey + ' slider scrolled to point '
                            + (clamped + 1) + '/' + (_maxIndex + 1)
                            + ' at ' + _whenStr
                            + ' coords=' + _coordsStr);
                        setScrubIndex(clamped);
                    }}
                />
            </View>
        );
    }

    return (
        <View style={[styles.card, fullScreen && {width: MAP_WIDTH + 16}]}>
            {/* The map+info area used to also open the external maps
                viewer on a single tap, but accidental thumb-touches
                kept hijacking the chat into Google Maps. The
                bottom-right "Open in Maps" footer icon is now the
                ONLY way to launch the external viewer; the map
                itself is reserved for zoom and pan controls.
                Long-press still opens the contextual menu — that's
                the standard message-bubble gesture and doesn't
                conflict with map interactions. */}
            <TouchableOpacity
                activeOpacity={1}
                onLongPress={triggerMenu}
                delayLongPress={300}
                accessibilityLabel="Shared location"
            >
                {/* Map area + zoom controls. The View wraps both so the
                    absolutely-positioned +/- buttons are anchored to the
                    map's bounding box (top-right and bottom-right
                    corners) regardless of the surrounding TouchableOpacity
                    layout. */}
                <View style={[styles.mapWrapper, {width: MAP_WIDTH, height: MAP_HEIGHT}]}>
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
                    // Resolve the scrub override (if any) into a
                    // concrete lat/lng pair to forward to StaticMap.
                    // Filter the trail to valid points first so the
                    // index lines up with what the slider's percentage
                    // mapping uses below.
                    const _scrubTrail = Array.isArray(trail)
                        ? trail.filter(p => p
                            && typeof p.latitude === 'number'
                            && typeof p.longitude === 'number')
                        : [];
                    const _scrubPoint = (typeof scrubIndex === 'number'
                            && scrubIndex >= 0
                            && scrubIndex < _scrubTrail.length)
                        ? _scrubTrail[scrubIndex]
                        : null;
                    // Privacy-deferred origin tick: the INVITER chose
                    // a privacy radius and is still inside it, so the
                    // value coords on this metadata are the destination
                    // (a stand-in) rather than the inviter's actual
                    // position.
                    //
                    //   • OUTGOING bubble (sender's own view) — use
                    //     `meta.localOwnerCoords`, which is the
                    //     inviter's REAL coords stamped locally only
                    //     (never sent on the wire). The inviter sees
                    //     themselves on the map and the privacy
                    //     circle is anchored to their actual
                    //     position.
                    //
                    //   • INCOMING bubble (peer's view) — suppress
                    //     the inviter pin entirely. The peer sees
                    //     only the destination + their own pin
                    //     (peerCoords) once they accept and start
                    //     sharing back.
                    //
                    // The inviter pin reappears for both sides the
                    // moment a post-deferral tick with real coords
                    // lands and the metadata loses the
                    // privacyDeferred flag. (`isPrivacyDeferred` and
                    // `_showPrivacyStrip` are now defined at the
                    // outer LocationBubble scope so the zoom-button
                    // / pan-cluster JSX outside this IIFE can read
                    // them too.)
                    const _hasLocalOwnerCoords = !!(meta
                        && meta.localOwnerCoords
                        && typeof meta.localOwnerCoords.latitude === 'number'
                        && typeof meta.localOwnerCoords.longitude === 'number');
                    // Effective coords for StaticMap, by bubble role:
                    //
                    //   • OUTGOING privacy-deferred (requester's
                    //     own bubble): own pin (red) =
                    //     localOwnerCoords; peer pin (blue) untouched
                    //     (peerCoords as usual).
                    //
                    //   • INCOMING privacy-deferred (accepter's view
                    //     of the request bubble): own pin (red =
                    //     author/requester) suppressed because the
                    //     requester's value coords are the
                    //     destination placeholder; peer pin (blue =
                    //     local user / accepter) = localOwnerCoords
                    //     because the peerCoords propagation skips
                    //     deferred ticks (the wire-stand-in coord
                    //     would have rendered the accepter pin at
                    //     the destination — wrong).
                    const _effOwnerLat = (isPrivacyDeferred && !isIncoming && _hasLocalOwnerCoords)
                        ? meta.localOwnerCoords.latitude
                        : (isPrivacyDeferred ? undefined : latitude);
                    const _effOwnerLng = (isPrivacyDeferred && !isIncoming && _hasLocalOwnerCoords)
                        ? meta.localOwnerCoords.longitude
                        : (isPrivacyDeferred ? undefined : longitude);
                    const _effPeerLat = (isPrivacyDeferred && isIncoming && _hasLocalOwnerCoords)
                        ? meta.localOwnerCoords.latitude
                        : peerLatitude;
                    const _effPeerLng = (isPrivacyDeferred && isIncoming && _hasLocalOwnerCoords)
                        ? meta.localOwnerCoords.longitude
                        : peerLongitude;
                    // Format the radius (metres → "500 m" / "1.5 km")
                    // for the bottom-strip hint. Stamped by
                    // sendLocationPayload from the timer entry's
                    // excludeOriginRadiusMeters when the deferred
                    // origin tick goes out, so we don't have to
                    // re-derive it on the render side.
                    let _privacyRadiusLabel = null;
                    if (isPrivacyDeferred) {
                        // Local stamp wins — it's the THIS-DEVICE
                        // user's radius. Fall back to the wire's
                        // privacyDeferredRadiusMeters only when the
                        // local stamp is absent (rare — would mean
                        // we have a deferred bubble without our own
                        // privacy state armed yet).
                        const r = (meta && Number(meta.localOwnerRadiusMeters))
                            || (meta && Number(meta.privacyDeferredRadiusMeters));
                        if (r && r > 0) {
                            _privacyRadiusLabel = r >= 1000
                                ? `${(r / 1000).toFixed(r % 1000 === 0 ? 0 : 1)} km`
                                : `${Math.round(r)} m`;
                        }
                    }
                    // The bottom strip is rendered when the outer
                    // `_showPrivacyStrip` AND we have a label to
                    // print (`_privacyRadiusLabel`). The outer
                    // version already covers the privacyDeferred /
                    // outgoing / radius-present checks; we re-AND
                    // with `_privacyRadiusLabel` here just so a
                    // missing radius still gracefully no-ops the
                    // strip rendering even though the outer check
                    // would already have flipped to false.
                    // Privacy-radius circle for the LOCAL USER's pin
                    // — fires on both outgoing and incoming bubbles
                    // when a localOwnerCoords + localOwnerRadiusMeters
                    // pair is stamped (set by app.js for the side
                    // that's hiding their position). The circle is
                    // anchored to the local user's real coords with
                    // their CHOSEN radius — distinct from
                    // meta.privacyDeferredRadiusMeters which is the
                    // OTHER party's radius on the wire.
                    const _localOwnRadius = (typeof meta.localOwnerRadiusMeters === 'number'
                            && meta.localOwnerRadiusMeters > 0)
                        ? meta.localOwnerRadiusMeters : null;
                    const _circleLat = (isPrivacyDeferred
                            && _hasLocalOwnerCoords
                            && _localOwnRadius)
                        ? meta.localOwnerCoords.latitude : undefined;
                    const _circleLng = (isPrivacyDeferred
                            && _hasLocalOwnerCoords
                            && _localOwnRadius)
                        ? meta.localOwnerCoords.longitude : undefined;
                    const _circleR = (isPrivacyDeferred
                            && _hasLocalOwnerCoords
                            && _localOwnRadius)
                        ? _localOwnRadius : undefined;
                    return (
                        <View style={{
                            width: MAP_WIDTH,
                            height: MAP_HEIGHT,
                        }}>
                        <StaticMap
                            latitude={_effOwnerLat}
                            longitude={_effOwnerLng}
                            peerLatitude={_effPeerLat}
                            peerLongitude={_effPeerLng}
                            // Meet START dots (secondary). Only present on a
                            // live meet — ChatBox injects startCoords /
                            // peerStartCoords, matched to the owner / peer
                            // slots, and omits them once the meet is frozen.
                            startLatitude={
                                meta.startCoords
                                    && typeof meta.startCoords.latitude === 'number'
                                    ? meta.startCoords.latitude
                                    : undefined
                            }
                            startLongitude={
                                meta.startCoords
                                    && typeof meta.startCoords.longitude === 'number'
                                    ? meta.startCoords.longitude
                                    : undefined
                            }
                            peerStartLatitude={
                                meta.peerStartCoords
                                    && typeof meta.peerStartCoords.latitude === 'number'
                                    ? meta.peerStartCoords.latitude
                                    : undefined
                            }
                            peerStartLongitude={
                                meta.peerStartCoords
                                    && typeof meta.peerStartCoords.longitude === 'number'
                                    ? meta.peerStartCoords.longitude
                                    : undefined
                            }
                            circleCenterLatitude={_circleLat}
                            circleCenterLongitude={_circleLng}
                            circleRadiusMeters={_circleR}
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
                            // Fallback map centre for a bubble that has no
                            // visible pin to frame on — specifically the
                            // dummy-origin invite (privacy meet request with
                            // no destination): the inviter pin is suppressed
                            // (privacyDeferred) and there's no destination, so
                            // without this the map would centre on {0,0}.
                            // meta.value holds the dummy stand-in coords;
                            // centring there yields a sane empty map until the
                            // inviter's real position arrives and takes over.
                            // Only consulted by StaticMap when nothing else is
                            // renderable, so it's inert for every other bubble.
                            fallbackCenterLatitude={
                                meta.value && typeof meta.value.latitude === 'number'
                                    ? meta.value.latitude
                                    : undefined
                            }
                            fallbackCenterLongitude={
                                meta.value && typeof meta.value.longitude === 'number'
                                    ? meta.value.longitude
                                    : undefined
                            }
                            ownerInitials={redInitials}
                            peerInitials={blueInitials}
                            // Receiver sees themselves in red: swap the two
                            // avatar fill colours on incoming bubbles only.
                            swapAvatarColors={isIncoming}
                            zoom={effectiveZoom}
                            // Meet-session bubbles never draw the trail
                            // polyline. The two participants are always
                            // shown on the same map with the live
                            // distance — historical paths are noise in
                            // that context. (Plain timed shares keep
                            // the trail.)
                            trail={isMeetSession ? undefined : trail}
                            scrubLatitude={_scrubPoint ? _scrubPoint.latitude : undefined}
                            scrubLongitude={_scrubPoint ? _scrubPoint.longitude : undefined}
                            panX={panOffset.x}
                            panY={panOffset.y}
                            centerOnOwner={focusedOnLatest}
                            focusOnTarget={focusTarget}
                            mapWidth={MAP_WIDTH}
                            mapHeight={MAP_HEIGHT}
                        />
                        {_showPrivacyStrip ? (
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
                                <Text style={{
                                    fontSize: 11,
                                    color: '#fff',
                                    textAlign: 'center',
                                }} numberOfLines={1}>
                                    📍 Move {_privacyRadiusLabel} to share your location
                                </Text>
                            </View>
                        ) : null}
                        </View>
                    );
                })() : (
                    // No coords yet — sender fired an origin tick
                    // immediately with placeholder lat/lng while waiting
                    // for the first GPS fix. Render a grey frame with a
                    // spinner-ish icon and "Locating…" label so the user
                    // has immediate visual confirmation that the share
                    // started. The same bubble will rerender as the
                    // StaticMap branch once the follow-up tick lands.
                    <View style={[styles.mapFrame, styles.placeholderFrame, {width: MAP_WIDTH, height: MAP_HEIGHT}]}>
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
                {/* Zoom controls. Only meaningful once we have real
                    coords — there's nothing to zoom in the "Locating…"
                    placeholder. + sits in the TOP-RIGHT corner, - in
                    the BOTTOM-RIGHT corner so they don't block the
                    centre pins and stay reachable with the user's
                    thumb on either device side. */}
                {hasCoords ? (
                    <>
                        <TouchableOpacity
                            onPress={() => adjustZoom(+1)}
                            disabled={!canZoomIn}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            accessibilityLabel="Zoom in"
                            style={[
                                styles.zoomBtn,
                                styles.zoomBtnTop,
                                !canZoomIn ? styles.zoomBtnDisabled : null,
                                // Fullscreen size doubling — see the
                                // pan-cluster comment below for the
                                // _fsZoom rationale (44 → 60 px).
                                // top:16 puts this on the same row as
                                // the Focus button at top:16 left:16.
                                // The fullscreen close-X is moved
                                // BELOW these (top:90) by the modal so
                                // the map controls form a clean top
                                // row.
                                fullScreen ? {width: 60, height: 60, borderRadius: 30, top: 16, right: 16} : null,
                            ]}
                        >
                            <Icon name="plus" size={fullScreen ? 32 : 18} color="#222" />
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => adjustZoom(-1)}
                            disabled={!canZoomOut}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            accessibilityLabel="Zoom out"
                            style={[
                                styles.zoomBtn,
                                styles.zoomBtnBottom,
                                !canZoomOut ? styles.zoomBtnDisabled : null,
                                fullScreen ? {width: 60, height: 60, borderRadius: 30, right: 16} : null,
                                // Lift bottom-anchored zoom button up
                                // when the privacy-deferred bottom
                                // strip is rendered along the bottom
                                // edge (~22 px tall).
                                _showPrivacyStrip ? {bottom: (fullScreen ? 16 : 8) + 24} : null,
                            ]}
                        >
                            <Icon name="minus" size={fullScreen ? 32 : 18} color="#222" />
                        </TouchableOpacity>
                        {/* Pan compass: ↑ ← ⊙ → ↓, anchored to the
                            BOTTOM-LEFT corner so it doesn't compete
                            with the existing zoom buttons in the
                            right-edge gutter. Each direction shifts
                            the rendered pan offset by PAN_STEP px;
                            the centre button (crosshairs-gps) clears
                            both the pan offset AND the zoom override
                            so the user can always get back to the
                            auto-fit "show me my whole trail" view in
                            one tap. The 5x5 tile pre-render gives ~640
                            px of headroom in any direction before
                            edges go grey. */}
                        {(() => {
                            const PAN_STEP = 60;
                            const pan = (dx, dy) => () => setPanOffset((prev) => {
                                const next = {x: prev.x + dx, y: prev.y + dy};
                                console.log('[APPLOG] [map] ' + messageKey + ' pan '
                                    + (dx > 0 ? '→ ' : dx < 0 ? '← ' : '')
                                    + (dy > 0 ? '↓ ' : dy < 0 ? '↑ ' : '')
                                    + 'offset (' + next.x + ',' + next.y + ')');
                                return next;
                            });
                            // "Focus" button — cycles through the
                            // available pins on each tap, zooming in
                            // on the next one. Order is fixed: peer →
                            // destination → owner → (wrap). Targets
                            // missing coords are skipped, so e.g. a
                            // plain share with only owner coords
                            // simply re-centres on owner every tap.
                            // Each tap clears pan + scrub so the
                            // chosen pin lands centred at a useful
                            // zoom level (StaticMap reads
                            // `focusOnTarget` and applies a tighter
                            // zoom than the auto-fit framing). The
                            // legacy `focusedOnLatest` flag is left
                            // alone for back-compat with the
                            // auto-fit centroid path elsewhere.
                            const focusCurrent = () => {
                                // Build the available-target list in
                                // priority order. The `hasOwner` /
                                // `hasPeer` / `hasDestination` flags
                                // computed above live inside StaticMap's
                                // closure — out of scope here. Read
                                // straight off `meta` (the merged
                                // bubble metadata). Each pin's coords
                                // are stored on a different field:
                                //   • owner       → meta.value
                                //   • peer        → meta.peerCoords
                                //   • destination → meta.destination
                                const _hasC = (c) => !!(c
                                    && typeof c.latitude === 'number'
                                    && typeof c.longitude === 'number');
                                const _targets = [];
                                if (_hasC(meta && meta.peerCoords))   _targets.push('peer');
                                if (_hasC(meta && meta.destination))  _targets.push('destination');
                                if (_hasC(meta && meta.value))        _targets.push('owner');
                                if (_targets.length === 0) {
                                    console.log('[APPLOG] [map] ' + messageKey + ' focus — no pins to focus on');
                                    return;
                                }
                                // Pick the next target after the
                                // current one (wrap to start of list).
                                // null / unknown → first target.
                                const _curIdx = focusTarget
                                    ? _targets.indexOf(focusTarget)
                                    : -1;
                                const _nextIdx = (_curIdx + 1) % _targets.length;
                                const _next = _targets[_nextIdx];
                                console.log('[APPLOG] [map] ' + messageKey + ' focus cycle '
                                    + (focusTarget || '(none)')
                                    + ' → ' + _next
                                    + ' (available: ' + _targets.join(',') + ')');
                                setPanOffset({x: 0, y: 0});
                                setScrubIndex(null);
                                setFocusTarget(_next);
                                // Bump zoom in on the chosen target so
                                // the user sees street-level detail
                                // around the pin. Cap at MAX_ZOOM so
                                // we don't blow past tile-server
                                // coverage. Mirrors the manual zoom-in
                                // button's behaviour at the top end.
                                setZoomOverride(Math.min(17, MAX_ZOOM));
                            };
                            // "Restore" — back to the bubble's
                            // load-time view. Auto-fit zoom (whatever
                            // pickZoomToFitPoints picks for the
                            // visible-points bbox) + no pan + no
                            // scrub + no owner focus. The full reset.
                            const restoreView = () => {
                                console.log('[APPLOG] [map] ' + messageKey + ' restore — auto-fit, clear pan/zoom/slider/focus');
                                setPanOffset({x: 0, y: 0});
                                setZoomOverride(null);
                                setScrubIndex(null);
                                setFocusedOnLatest(false);
                                setFocusTarget(null);
                            };
                            // Bottom-strip lift: when the privacy-
                            // deferred bottom strip is rendered along
                            // the bottom edge (~22 px tall), shift any
                            // bottom-anchored controls UP by 24 px so
                            // they don't sit on top of the strip.
                            const _stripLift = _showPrivacyStrip ? 24 : 0;
                            // Fullscreen size doubling. In the
                            // fullscreen viewer the map fills the
                            // window so the inline 22/30 px controls
                            // look tiny. Double the dimensions +
                            // borderRadius + icon sizes; the position
                            // anchors stay at edge gutters but use
                            // larger gutter values too so the bigger
                            // buttons don't crowd the corners.
                            const _fsPan = fullScreen ? {
                                width: 44, height: 44, borderRadius: 22,
                            } : null;
                            const _fsZoom = fullScreen ? {
                                width: 60, height: 60, borderRadius: 30,
                            } : null;
                            const _fsRestore = fullScreen ? {
                                width: 60, height: 60, borderRadius: 30,
                                left: 16, bottom: 16,
                            } : null;
                            const _panIcon = fullScreen ? 28 : 14;
                            const _zoomIcon = fullScreen ? 32 : 18;
                            const _restoreIcon = fullScreen ? 32 : 18;
                            // Centre-axis offsets need to use the
                            // doubled half-width when fullscreen
                            // enlarges the buttons.
                            const _panHalf = fullScreen ? 22 : 11;
                            return (
                                <>
                                    <TouchableOpacity
                                        onPress={pan(0, -PAN_STEP)}
                                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                        accessibilityLabel="Pan up"
                                        style={[styles.panBtn, styles.panBtnUp, _fsPan, fullScreen && {left: (MAP_WIDTH / 2) - _panHalf}]}
                                    >
                                        <Icon name="chevron-up" size={_panIcon} color="#222" />
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        onPress={pan(-PAN_STEP, 0)}
                                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                        accessibilityLabel="Pan left"
                                        style={[styles.panBtn, styles.panBtnLeft, _fsPan, fullScreen && {top: (MAP_HEIGHT / 2) - _panHalf}]}
                                    >
                                        <Icon name="chevron-left" size={_panIcon} color="#222" />
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        onPress={focusCurrent}
                                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                        accessibilityLabel="Cycle focus through pins"
                                        style={[
                                            styles.recenterBtn,
                                            _fsZoom,
                                            // Fullscreen: top-left rail at
                                            // top:16, left:16 — same row as
                                            // the zoom + button at top:16
                                            // right:16. The close-X is
                                            // pushed BELOW this row by the
                                            // modal (top:90, left:30) so
                                            // the primary map controls
                                            // form a clean top stripe and
                                            // X sits underneath as a
                                            // secondary action. Inline
                                            // (non-fullscreen) keeps the
                                            // top:8 left:8 anchor from
                                            // styles.recenterBtn.
                                            fullScreen && {left: 16, top: 16},
                                        ]}
                                    >
                                        <Icon name="crosshairs-gps" size={_zoomIcon} color="#222" />
                                    </TouchableOpacity>
                                    {/* Inline-only fullscreen toggle.
                                        Sits BELOW the Focus button
                                        (Focus at top:8 left:8 30×30 →
                                        bottom edge y=38; this anchors
                                        at top:44 leaving 6 px gap).
                                        In fullscreen mode the user
                                        already has the close-X
                                        affordance, so we don't render
                                        this twin in that context. The
                                        kebab "Full screen" action
                                        remains as a backup entry
                                        point. */}
                                    {!fullScreen && typeof onOpenFullScreen === 'function' ? (
                                        <TouchableOpacity
                                            onPress={() => {
                                                try { onOpenFullScreen(); }
                                                catch (e) {
                                                    console.log('[map] onOpenFullScreen threw',
                                                        e && e.message ? e.message : e);
                                                }
                                            }}
                                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                            accessibilityLabel="Open map in full screen"
                                            style={[styles.recenterBtn, {top: 44}]}
                                        >
                                            <Icon name="arrow-expand" size={18} color="#222" />
                                        </TouchableOpacity>
                                    ) : null}
                                    {/* Fourth view-control button —
                                        the "restore as loaded"
                                        affordance. Sits in the
                                        BOTTOM-LEFT corner so the
                                        right edge stays a clean rail
                                        of zoom + / current-location /
                                        zoom -. Uses arrow-expand-all
                                        to suggest "fit everything in
                                        view", which is what auto-fit
                                        does. Doesn't disturb the
                                        zoom factor's persistence
                                        because zoomOverride was
                                        already non-persistent (see
                                        the load-state comment near
                                        the top of the bubble). */}
                                    <TouchableOpacity
                                        onPress={restoreView}
                                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                        accessibilityLabel="Restore initial map view"
                                        style={[
                                            styles.restoreBtn,
                                            _fsRestore,
                                            _stripLift > 0 ? {bottom: (fullScreen ? 16 : 8) + _stripLift} : null,
                                        ]}
                                    >
                                        <Icon name="arrow-expand-all" size={_restoreIcon} color="#222" />
                                    </TouchableOpacity>
                                    {/* Pan-right is back — the
                                        middle-right slot opened up
                                        again when current-location
                                        moved to the top-left corner,
                                        so the cardinal compass is
                                        complete (↑ ← → ↓) without
                                        clashing with the right-edge
                                        zoom +/-. */}
                                    <TouchableOpacity
                                        onPress={pan(PAN_STEP, 0)}
                                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                        accessibilityLabel="Pan right"
                                        style={[styles.panBtn, styles.panBtnRight, _fsPan, fullScreen && {top: (MAP_HEIGHT / 2) - _panHalf}]}
                                    >
                                        <Icon name="chevron-right" size={_panIcon} color="#222" />
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        onPress={pan(0, PAN_STEP)}
                                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                        accessibilityLabel="Pan down"
                                        style={[
                                            styles.panBtn,
                                            styles.panBtnDown,
                                            _fsPan,
                                            fullScreen && {left: (MAP_WIDTH / 2) - _panHalf},
                                            _stripLift > 0 ? {bottom: (fullScreen ? 8 : 3) + _stripLift} : null,
                                        ]}
                                    >
                                        <Icon name="chevron-down" size={_panIcon} color="#222" />
                                    </TouchableOpacity>
                                </>
                            );
                        })()}
                    </>
                ) : null}
                </View>


                <View style={styles.info}>
                    {/* Title row — "Current location" on the left,
                        map-width scale ("↔ 1.2 km") on the right.
                        Same row so the scale label reads as supplementary
                        info on the title rather than a separate stripe.
                        The scale is hidden until we have real coords (no
                        meaningful width on the placeholder) and on
                        expired bubbles it stays useful for context, so
                        we don't gate it on isExpired. */}
                    <View style={styles.titleRow}>
                        <Text
                            style={[styles.title, { color: textColor, flexShrink: 1 }]}
                            numberOfLines={1}
                        >
                            {meetOutcomeLabel
                                // Frozen meet summary — the outcome label
                                // ("Meet-up succeeded" / "…ended" / "…expired"
                                // / "…cancelled") takes precedence over every
                                // live-state title below.
                                ? meetOutcomeLabel
                                : isOneShot
                                // One-shot share: a single GPS fix, no
                                // follow-up ticks. The bubble represents
                                // "where I am right now" — labelled
                                // "Current location" so the title reads
                                // as a snapshot rather than implying an
                                // ongoing stream.
                                ? 'Current location'
                                : (isExpired
                                    ? (isMeetSession
                                        ? 'Meeting session (expired)'
                                        : 'Location (expired)')
                                    : (isStale
                                        ? (isMeetSession
                                            ? 'Meeting session (last known)'
                                            : 'Last known location')
                                        // Continuous (X-hour) share or
                                        // meet handshake. Distinct titles:
                                        //   • meet session → "Meeting
                                        //     session" (it's a handshake
                                        //     anchored to a destination,
                                        //     not just a location feed).
                                        //   • plain timed share → "Sharing
                                        //     location" (the active-verb
                                        //     framing that distinguishes
                                        //     this from the one-shot
                                        //     snapshot above).
                                        : (isMeetSession
                                            ? (hasCoords ? 'Meeting session' : 'Meeting session (acquiring)')
                                            : (hasCoords ? 'Sharing location' : 'Sharing location (acquiring)'))))}
                        </Text>
                        {hasCoords && scaleLabel ? (
                            <Text
                                style={[styles.scaleInline, { color: subColor }]}
                                numberOfLines={1}
                            >
                                {/* ⟷ : single LONG LEFT RIGHT ARROW
                                    glyph (U+27F7). Reads as one
                                    connected arrow rather than the
                                    scaffolded look of "⟵──⟶", and
                                    renders longer than the cramped
                                    "↔" we tried first. */}
                                {'⟷ ' + scaleLabel}
                            </Text>
                        ) : null}
                    </View>
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
                    {/* "X to meeting point" is a LIVE metric — hide it once the
                        meet has ended (meetOutcome set); the frozen summary's
                        outcome label is the record, and a stale distance-to-
                        destination would be misleading. */}
                    {toDestLabel && !meetOutcome ? (
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

            {/* Trail scrubber, rendered as a sibling of the
                tap-to-open-maps TouchableOpacity (not a descendant)
                so the slider's PanResponder owns its own touch
                surface — nesting it inside the TouchableOpacity made
                the parent's responder swallow drags before the
                slider could claim them. */}
            {scrubberBlock}

            {/* Footer action bar — mirrors the small action strip image
                bubbles have. Menu on the left (single tap → same contextual
                menu other bubbles open on long-press); "expires in …" in
                the middle (flex:1 + textAlign:center so it always sits
                centered between the two icons, regardless of label width);
                Open in Maps on the right replaces the old "tap the whole
                bubble to open maps" behaviour, which was firing on any
                accidental touch. */}
            <View style={styles.footer}>
                {/* Footer kebab is suppressed in fullscreen mode. The
                    contextual menu (Reply/Pin/Forward/Delete/Share/…)
                    only makes sense in the chat-list context — most
                    actions need the surrounding messages list to land
                    correctly (Forward needs a target picker, Pin needs
                    the chat header, Reply switches focus to the input
                    box, etc.). In the immersive fullscreen viewer the
                    user's intent is "look at the map" — exit fullscreen
                    first if they want to operate on the message. */}
                {!fullScreen && (
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
                )}
                {_sessionActive ? (
                    /* Session still live on THIS device — offer a one-tap Stop
                       in place of the countdown. */
                    <TouchableOpacity
                        onPress={onStopShareFromMap}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityLabel="Stop sharing location"
                        style={styles.footerStopButton}
                    >
                        <Icon name="map-marker-off" size={16} color="#d9534f" />
                        <Text style={styles.footerStopText} numberOfLines={1}>
                            Stop sharing
                        </Text>
                    </TouchableOpacity>
                ) : (
                    <Text
                        style={[styles.footerExpires, { color: subColor }]}
                        numberOfLines={1}
                    >
                        {isOneShot ? '' : (expirationLine || '')}
                    </Text>
                )}
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
        width: DEFAULT_MAP_WIDTH + 16, // card padding
    },
    // Wraps the map frame and the absolutely-positioned zoom buttons so
    // the +/- controls anchor to the map's edges rather than to the
    // surrounding card padding. Width/height for the FULLSCREEN viewer
    // are applied as inline-style overrides at the JSX call site —
    // these defaults serve the inline chat bubble.
    mapWrapper: {
        width: DEFAULT_MAP_WIDTH,
        height: DEFAULT_MAP_HEIGHT,
        position: 'relative',
    },
    mapFrame: {
        width: DEFAULT_MAP_WIDTH,
        height: DEFAULT_MAP_HEIGHT,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#e9ecef',
    },
    // Round white-with-shadow button used for the +/- zoom controls.
    // Sits over the map tiles. Two corner positions are layered on top
    // (zoomBtnTop / zoomBtnBottom) to push the same base style into the
    // requested top-right / bottom-right slots.
    zoomBtn: {
        position: 'absolute',
        right: 8,
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: 'rgba(255,255,255,0.9)',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
        elevation: 3,
    },
    zoomBtnTop: {
        top: 8,
    },
    zoomBtnBottom: {
        bottom: 8,
    },
    // When we hit MIN/MAX zoom the corresponding button greys out so
    // the user gets visual feedback that the cap was reached. The press
    // is also disabled via `disabled={true}`.
    zoomBtnDisabled: {
        opacity: 0.4,
    },
    // Pan controls spread to the cardinal edges of the map so
    // they're easy to hit without thumb-stretching to a clustered
    // corner cross. Each button is 30 px (matching the zoom +/-
    // size for visual parity); the recenter button (crosshairs)
    // sits in the BOTTOM-LEFT corner where it doesn't compete with
    // the zoom +/- pinned to the right edge.
    //
    //   ┌─────[↑]─────┐
    //   │             │
    //  [←]           [→]
    //   │             │
    //   ⊙────[↓]──────┘
    //
    // The cardinal arrows' `left` / `top` for the centre-axis
    // buttons land them dead-centre on the map's width / height.
    // Cardinal pan arrows. 22 px is ~25 % smaller than the zoom +/-
    // (30 px) which keeps the directional arrows visually subordinate
    // to the zoom controls. They also hug the edge of the map at a
    // 3 px gutter (vs 8 px for zoom) so they intrude minimally on
    // the rendered tile area.
    panBtn: {
        position: 'absolute',
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: 'rgba(255,255,255,0.9)',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
        elevation: 3,
    },
    // Centre-axis offset: (MAP_WIDTH / 2) - (button width / 2)
    //                  = (MAP_HEIGHT / 2) - (button height / 2)
    // Up — top-centre, 3 px from top edge.
    // The cardinal arrows' centre-axis offset uses the DEFAULT bubble
    // dimensions; the fullscreen viewer applies inline-style overrides
    // at the JSX call site so the arrows stay centred when the map
    // grows. (See `panBtnUp/Down/Left/Right` JSX in LocationBubble.)
    panBtnUp:     { top: 3,    left: (DEFAULT_MAP_WIDTH / 2) - 11 },
    // Down — bottom-centre.
    panBtnDown:   { bottom: 3, left: (DEFAULT_MAP_WIDTH / 2) - 11 },
    // Left — middle-left edge.
    panBtnLeft:   { left: 3,   top: (DEFAULT_MAP_HEIGHT / 2) - 11 },
    // Right — middle-right edge. Sits between the zoom + (top-right)
    // and zoom - (bottom-right) buttons.
    panBtnRight:  { right: 3,  top: (DEFAULT_MAP_HEIGHT / 2) - 11 },
    // Recenter / "back to original view" button. Sized to match the
    // zoom +/- (30 px) since it shares their semantic weight — they
    // all reset the framing in one tap — and pinned to the RIGHT
    // edge between zoom + (top-right) and zoom - (bottom-right) so
    // the three primary view-control buttons cluster vertically. The
    // smaller cardinal arrows hug the OPPOSITE three edges (top,
    // left, bottom) so the right edge stays a clean control rail.
    // Current-location button: "snap me to my latest GPS fix at the
    // current zoom factor". Pinned to the TOP-LEFT corner so the
    // four primary view controls — zoom + (top-right), zoom -
    // (bottom-right), restore (bottom-left), current-location
    // (top-left) — form one button at each map corner. The cardinal
    // pan arrows stay along the edge midpoints.
    recenterBtn: {
        position: 'absolute',
        left: 8,
        top: 8,
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: 'rgba(255,255,255,0.9)',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
        elevation: 3,
    },
    // 4th view-control button: "restore initial map view". Sized to
    // match the zoom +/- and current-location buttons (30 px) and
    // pinned to the BOTTOM-LEFT corner so the four primary view
    // controls form a corner cross when imagined together (zoom +
    // top-right, current-location middle-right, zoom - bottom-right,
    // restore bottom-left). The smaller cardinal pan arrows (22 px)
    // continue to ride the top, middle-left, and bottom edges
    // without crowding the corners.
    restoreBtn: {
        position: 'absolute',
        left: 8,
        bottom: 8,
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: 'rgba(255,255,255,0.9)',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
        elevation: 3,
    },
    // Title row beneath the map: "Current location" on the left, the
    // map-width scale label ("↔ 1.2 km") on the right. flexDirection
    // row + space-between so the scale always pins to the right edge
    // even when the title text is short.
    titleRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
    },
    // Inline scale label rendered next to the title. Smaller / lighter
    // than the title so it reads as supplementary metadata rather than
    // a heading.
    scaleInline: {
        fontSize: 11,
        marginLeft: 8,
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
    // Trail scrubber wrapper: thin 4 px slider with a 16 px needle
    // sitting between the map and the info section. Vertical padding
    // is provided by AudioProgressSlider's own touch-target padding,
    // so we just give the wrapper a small top margin to separate it
    // visually from the map's tile grid.
    scrubWrap: {
        marginTop: 4,
        width: DEFAULT_MAP_WIDTH,
    },
    scrubLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    scrubLabel: {
        fontSize: 11,
    },
    // Right-side cluster on the scrubber label row: share icon,
    // optional Live pill. flex layout so they sit snug against
    // each other and right-align beside the timestamp label.
    scrubActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    scrubActionBtn: {
        paddingHorizontal: 4,
        paddingVertical: 2,
    },
    // Live pill: a tiny rounded indicator + "Live" word that doubles
    // as a "return to latest" reset button. Matches the visual
    // language of streaming-app live badges (red dot, thin border)
    // so the affordance reads as "you're paused, tap to resume".
    scrubLivePill: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
    },
    scrubLiveDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        marginRight: 4,
    },
    scrubLiveText: {
        fontSize: 10,
        fontWeight: '600',
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
    // Occupies the same middle slot as footerExpires, but as a tappable
    // "Stop sharing" control centered between the kebab and open-in-maps icons.
    footerStopButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 2,
        paddingHorizontal: 6,
    },
    footerStopText: {
        color: '#d9534f',
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 4,
    },
});

// Named export of the inner StaticMap so other components (e.g.
// ShareLocationModal) can render a small destination preview tile
// without re-implementing slippy-map projection / pin placement /
// FastImage caching. Pass only the props the preview needs
// (destinationLatitude / destinationLongitude / mapWidth / mapHeight /
// zoom); owner / peer / trail props are all optional and the
// existing guards (`hasOwner`, `hasPeer`, `hasTrail`) make their
// rendering paths no-ops when absent. The destination shows as the
// green map-marker icon defined inline below, which is the right
// visual for "this is where we're meeting" — not a person.
export { StaticMap };

// `pickZoomToFitPoints` is also exported so the destination-preview
// modal can seed its initial zoom from the fitted value (so when
// the user pin lands, the map auto-zooms out to fit BOTH points
// rather than staying at the default street-level zoom with the
// user pin offscreen). The modal's own +/- buttons then adjust
// FROM the fitted value.
export { pickZoomToFitPoints };

export default LocationBubble;
