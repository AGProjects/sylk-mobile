// copyright AG Projects 2020-2026
//
// The cleartext lifecycle envelope of an application/sylk-location-sharing
// tick, and the two payload versions it can travel in.
//
// A tick has two halves: the coordinates, PGP-armoured and readable only by the
// recipient, and a cleartext envelope naming what the tick IS — action,
// sessionId, expires, perm, deviceId, version. The envelope's `version` field
// says where those halves live on the wire:
//
//   version 1  envelope and ciphertext together in the message content, the
//              ciphertext under `value`. `metadata`, when set at all, is only
//              a mirror of the content and is ignored on receive.
//
//                content  = {"action":"location_start","value":"<PGP>", … ,"version":"1.0"}
//                metadata = null, or the same envelope minus "value"
//
//   version 2  envelope in the message metadata, content is NOTHING BUT the
//              armoured blob (and empty for a coordinate-free signal).
//
//                content  = -----BEGIN PGP MESSAGE----- …
//                metadata = {"action":"location_start", … ,"version":"2.0"}
//
// This module is the single place that knows the difference. Everything else
// in the app keeps working with one whole envelope object:
//
//   * on receive, locationEnvelope() rebuilds it from whichever version
//     arrived — so every existing parse site reads the same shape it always
//     did, and this client accepts both versions for as long as peers send
//     them;
//   * on send, splitLocationEnvelope() takes that same whole object and
//     splits it into the version 2 wire pair {content, metadata}.
//
// It mirrors, field for field, the server-side implementation in
// sylkserver/sylk/applications/webrtcgateway/location.py — the two must agree
// on which version puts the envelope where, or a tick classified one way by
// the server (which decides whether it warrants a push) would be read another
// way here.

const LOCATION_CONTENT_TYPE = 'application/sylk-location-sharing';

// The payload version this client SENDS.
const LOCATION_PAYLOAD_VERSION = '2.0';

// The version from which the metadata carries the envelope and the content is
// the bare ciphertext. Below it the content is authoritative and metadata is
// at best a mirror, so it is not read.
const METADATA_ENVELOPE_VERSION = 2;

// The one envelope key that never appears in metadata: the armoured
// coordinates. Metadata is cleartext and is relayed as a single-line CPIM
// header — the ciphertext stays in the content.
const VALUE_KEY = 'value';

const PGP_HEADER = '-----BEGIN PGP MESSAGE-----';


// Parse a value as a JSON object, or return null. Anything that is not a JSON
// OBJECT — a bare PGP blob, an array, a number, malformed JSON, empty — yields
// null rather than throwing. An object is passed through as-is, since the
// journal and some callers hand us one already parsed.
function jsonObject(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'object') {
        return Array.isArray(value) ? null : value;
    }
    if (typeof value !== 'string') {
        return null;
    }
    const text = value.trim();
    if (!text.startsWith('{')) {
        return null;
    }
    try {
        const parsed = JSON.parse(text);
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
    } catch (e) {
        return null;
    }
}


// The major payload version an envelope declares, or null. Tolerates the
// shapes a `version` field turns up in — "2", "2.0", "2.1.3", 2, 2.0 — since
// only the major number decides how the payload is laid out.
function envelopeVersion(envelope) {
    if (!envelope || typeof envelope !== 'object') {
        return null;
    }
    const version = envelope.version;
    if (version === null || version === undefined || typeof version === 'boolean') {
        return null;
    }
    if (typeof version === 'number') {
        return Number.isFinite(version) ? Math.trunc(version) : null;
    }
    if (typeof version !== 'string') {
        return null;
    }
    const major = parseInt(version.trim().split('.')[0], 10);
    return Number.isNaN(major) ? null : major;
}


// The metadata envelope, but only when it is the authoritative one: a version
// 2 (or later) tick, where the envelope lives in metadata and the content
// holds only the ciphertext. Returns null for a version 1 tick — whose
// metadata is a mirror of a content that is itself readable — and for metadata
// that is missing, unparseable, or declares no version at all.
function locationMetadata(metadata) {
    const envelope = jsonObject(metadata);
    if (envelope === null) {
        return null;
    }
    const version = envelopeVersion(envelope);
    if (version === null || version < METADATA_ENVELOPE_VERSION) {
        return null;
    }
    return envelope;
}


// The PGP-armoured coordinates of a tick, or null when it carries none. From
// version 2 on the content IS the armoured blob and is returned as-is; a
// version 1 content is a JSON envelope, so its `value` is returned instead.
// Coordinate-free signals — location_stop, meeting_accept, … — carry none.
function locationCoordinates(content) {
    const body = jsonObject(content);
    if (body !== null) {
        const value = body[VALUE_KEY];
        return (typeof value === 'string' && value.trim()) ? value : null;
    }
    if (typeof content !== 'string') {
        return null;
    }
    const blob = content.trim();
    return blob ? blob : null;
}


// The cleartext envelope of a location tick, as one whole object — the shape
// every caller in the app already expects, whichever version it arrived in.
//
// Version 2 and later: read from metadata, with the ciphertext spliced back in
// under `value`. Version 1 and anything without usable metadata: read from the
// content, exactly as before.
//
// Returns null when there is no readable envelope on either side, so callers
// can keep their existing `if (!wire) …` guards.
function locationEnvelope(content, metadata) {
    const fromMetadata = locationMetadata(metadata);
    if (fromMetadata === null) {
        // version 1: the content carries the whole envelope, coordinates included
        return jsonObject(content);
    }
    const coordinates = locationCoordinates(content);
    // Reassemble in the sender's original key order — the envelope leads with
    // `action`, the coordinates follow it, then the rest of the lifecycle
    // fields. Metadata is the envelope minus `value`, so slotting the
    // ciphertext back in right after `action` reproduces the exact object a
    // 1.0 peer would have sent. The server does the same when it rebuilds the
    // push payload (location_push_content in location.py), so the two
    // implementations stay literally identical.
    const envelope = {};
    for (const key of Object.keys(fromMetadata)) {
        // metadata never carries coordinates; a stray key must not fake them
        if (key === VALUE_KEY) {
            continue;
        }
        envelope[key] = fromMetadata[key];
        if (key === 'action' && coordinates) {
            envelope[VALUE_KEY] = coordinates;
        }
    }
    if (coordinates && !(VALUE_KEY in envelope)) {   // an envelope without an action
        envelope[VALUE_KEY] = coordinates;
    }
    return envelope;
}


// The envelope of an incoming sylkrtc message, or null. Convenience wrapper
// around locationEnvelope() for the common `message.content` / `message.metadata`
// pair — note `metadata` is a getter on sylkrtc's Message and may already be a
// parsed object.
function messageLocationEnvelope(message) {
    if (!message) {
        return null;
    }
    const contentType = message.contentType || message.content_type;
    if (contentType !== LOCATION_CONTENT_TYPE) {
        return null;
    }
    return locationEnvelope(message.content, message.metadata);
}


// Split a whole envelope into the version 2 wire pair.
//
// Returns {content, metadata}: the armoured blob alone as the content (the
// empty string for a coordinate-free signal, which has no coordinates to
// carry), and the rest of the envelope — stamped with this client's version —
// as the metadata object. The caller hands the pair to sylkrtc, which
// serializes the metadata into the CPIM `Metadata` header.
//
// Everything upstream keeps building one whole envelope; this is the only
// place that takes it apart.
function splitLocationEnvelope(envelope) {
    const fields = jsonObject(envelope);
    if (fields === null) {
        return null;
    }
    const metadata = Object.assign({}, fields);
    const coordinates = (typeof fields[VALUE_KEY] === 'string' && fields[VALUE_KEY].trim())
        ? fields[VALUE_KEY] : '';
    delete metadata[VALUE_KEY];
    metadata.version = LOCATION_PAYLOAD_VERSION;
    return {content: coordinates, metadata: metadata};
}


// Does this string look like a PGP-armoured body? Used to tell a version 2
// content (which does) from a version 1 envelope (which does not).
function isArmouredBlob(content) {
    return typeof content === 'string' && content.trimStart().startsWith(PGP_HEADER);
}


export {
    LOCATION_CONTENT_TYPE,
    LOCATION_PAYLOAD_VERSION,
    METADATA_ENVELOPE_VERSION,
    envelopeVersion,
    isArmouredBlob,
    jsonObject,
    locationCoordinates,
    locationEnvelope,
    locationMetadata,
    messageLocationEnvelope,
    splitLocationEnvelope,
};
