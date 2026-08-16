import utils from '../utils';

// ---------------------------------------------------------------------
// Per-call capability advertisement
// ---------------------------------------------------------------------
//
// Both parties send one small in-call message the moment the call
// reaches 'established', listing the optional protocols this build
// speaks. The peer stashes it on the sylkrtc Call object; UI that
// depends on a peer-side feature reads it back before offering the
// control, so we never show an action the far end cannot honour.
//
// Why a call message and not SIP headers: the INVITE / 200 OK X-header
// path is already crowded (X-Sylk-User-Agent, the ZRTP capability
// header) and has to survive Janus -> OpenSIPS -> Janus, where typed
// headers get eaten. An in-dialog message rides the same channel the
// screen-sharing and pointer signals already use, is trivially
// extensible, and costs one packet per call.
//
// Why both sides send unconditionally rather than request/response:
// no round trip, no retry logic, and no ordering assumptions. Each
// side's advertisement is independent; whichever arrives first wins
// its own half of the handshake.
//
// Forward/backward compatibility rules:
//   - Unknown tokens MUST be ignored, never rejected. The list is
//     free-form; new tokens can appear at any time.
//   - A peer that sends NO capabilities message is an older build.
//     Absence means "assume nothing" -- capability-gated UI stays
//     hidden. That is the intended failure mode: the alternative
//     (assume support) is what produces requests that vanish into
//     the void on old clients.
//   - `version` is informational. Do not gate on it; gate on tokens.
//   - PSTN destinations are skipped entirely. A phone number is a
//     gateway, not a Sylk client: it can never advertise anything back
//     and has no use for ours, and pushing an unknown content type into
//     a SIP trunk is a needless interop risk. See sendCallCapabilities.

export const CAPABILITIES_CONTENT_TYPE = 'application/sylk-capabilities';

const CAPABILITIES_VERSION = 1;

// Token vocabulary. Keep these stable once shipped -- they are wire
// values, not internal identifiers.

// Can capture and transmit its own screen in place of the camera.
// Gates the "Request screen" menu item on the OTHER side: we only
// offer to ask for a screen we know the peer can produce.
export const CAP_SCREEN_SHARING = 'screen-sharing';
// Understands the request / request_accept / request_reject handshake
// carried on application/sylk-screen-sharing.
export const CAP_SCREEN_REQUEST = 'screen-request';
// Remote-pointer guidance protocol (application/sylk-pointer).
export const CAP_POINTER = 'pointer';
// In-call "escalate this call to a conference" metadata handshake.
export const CAP_CONFERENCE_REQUEST = 'conference-request';

// What THIS build can do. Everything here is implemented on both
// Android and iOS, so there is no per-platform filtering yet; when a
// token becomes platform-conditional, branch inside this function
// rather than at the call sites.
export function myCallCapabilities() {
    return [
        CAP_SCREEN_SHARING,
        CAP_SCREEN_REQUEST,
        CAP_POINTER,
        CAP_CONFERENCE_REQUEST,
    ];
}

/** True when this call's remote party is a PSTN destination (a dialled
 *  phone number) rather than a SIP/Sylk client. `conferenceDomain` is
 *  the account's configured defaultConferenceDomain, forwarded to
 *  utils.isPhoneNumber so an all-digit conference room can't be
 *  mistaken for a number; optional, and the check degrades to the
 *  legacy regex without it. */
function isPstnCall(call, conferenceDomain) {
    const uri = call && call.remoteIdentity && call.remoteIdentity.uri;
    if (typeof uri !== 'string' || !uri) return false;
    try {
        return !!utils.isPhoneNumber(uri, conferenceDomain);
    } catch (e) {
        // Never let a URI-parsing edge case block the advertisement on
        // a legitimate SIP call -- fail open, the peer just ignores an
        // unknown content type.
        return false;
    }
}

/** Send our advertisement on `call`. Fire-and-forget: a failure here
 *  only means the peer keeps capability-gated controls hidden, which
 *  is the same as talking to an older client.
 *
 *  Skipped for PSTN destinations: there is no client on the far end to
 *  read it, and the message would land in a SIP trunk / gateway that
 *  has no reason to understand application/sylk-capabilities. Because
 *  every capability-gated control keys off the peer's advertisement,
 *  and a gateway can't send one, those controls stay hidden on PSTN
 *  calls automatically -- no separate check at the UI layer. */
export function sendCallCapabilities(call, conferenceDomain) {
    if (!call || typeof call.sendMessage !== 'function') return;
    if (isPstnCall(call, conferenceDomain)) {
        utils.timestampedLog('[capabilities] skipped -- PSTN destination',
            (call.remoteIdentity && call.remoteIdentity.uri) || '(no uri)');
        // Stamp it so a renegotiation re-entry doesn't re-run the check
        // and re-log on every 'established'.
        call._sylkCapabilitiesSent = true;
        return;
    }
    // Once per call object. 'established' can be re-entered on some
    // renegotiation paths and a second advertisement would be pure
    // noise (the content is identical and the peer is idempotent).
    if (call._sylkCapabilitiesSent) return;
    call._sylkCapabilitiesSent = true;
    const capabilities = myCallCapabilities();
    try {
        call.sendMessage(
            JSON.stringify({version: CAPABILITIES_VERSION, capabilities}),
            CAPABILITIES_CONTENT_TYPE, {}, (err) => {
                if (err) {
                    // Allow a later attempt (e.g. a renegotiation-driven
                    // re-entry into 'established') to try again.
                    call._sylkCapabilitiesSent = false;
                    console.log('[capabilities] send failed:',
                        (err && err.message) || String(err));
                }
            });
        utils.timestampedLog('[capabilities] advertised ->', capabilities.join(','));
    } catch (e) {
        call._sylkCapabilitiesSent = false;
        console.log('[capabilities] send threw:', (e && e.message) || String(e));
    }
}

/** Parse a received advertisement. Returns an array of tokens, or null
 *  if the payload is unusable. */
export function parseCallCapabilities(content) {
    try {
        const parsed = JSON.parse(content);
        const list = parsed && parsed.capabilities;
        if (!Array.isArray(list)) return null;
        return list.filter(c => typeof c === 'string');
    } catch (e) {
        return null;
    }
}

/** Record the peer's advertisement on the call object.
 *
 *  The call is the right owner (not component state): it outlives
 *  VideoBox, which unmounts and remounts every time the user navigates
 *  between the call screen and the rest of the app. Same reasoning as
 *  call._remotePeerSharing and call._sylkScreenShare. */
export function setPeerCallCapabilities(call, capabilities) {
    if (!call || !Array.isArray(capabilities)) return;
    call._sylkPeerCapabilities = capabilities;
}

/** Read back the peer's advertisement. Empty array when the peer has
 *  not advertised (older build, or the message hasn't landed yet). */
export function getPeerCallCapabilities(call) {
    return (call && Array.isArray(call._sylkPeerCapabilities))
        ? call._sylkPeerCapabilities
        : [];
}

/** True only when the peer explicitly advertised `capability`. Absence
 *  is always a "no" -- see the compatibility rules at the top. */
export function peerSupportsCapability(call, capability) {
    return getPeerCallCapabilities(call).indexOf(capability) !== -1;
}
