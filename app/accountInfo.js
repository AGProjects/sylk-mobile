// app/accountInfo.js
//
// Small HTTP Digest client for the cdrtool JSON endpoint
// (account_info.phtml). Lets the app read the user's mobile number,
// PSTN balance and currency, and write the mobile number back —
// authenticated with the SIP account credentials the user already
// typed into Sylk.
//
// Why digest: the cdrtool server has an existing helper
// (getSipAccountFromHTTPDigest) that validates HTTP Digest responses
// against the same HA1 the SIP proxy uses. The realm in the challenge
// must be the SIP domain, so we always pass ?realm=user@domain on the
// URL — that makes the server challenge with realm="<sip_domain>" and
// the user's normal SIP password works directly.
//
// No new npm deps: we reuse the crypto-js that's already in the app
// (see app/utils.js for the existing import).

import CryptoJS from 'crypto-js';

const md5 = (s) => CryptoJS.MD5(s).toString(CryptoJS.enc.Hex);

/**
 * Validate a new SIP account password.
 *
 * Rules (mirrored on the server side in sylk_account_settings.phtml):
 *   • ≥ 6 characters
 *   • at least one lowercase letter
 *   • at least one uppercase letter
 *   • at least one digit
 *
 * Returns null on success, or a human-readable error string.
 * Whitespace-only is rejected on length. The exact rule list is
 * baked into the message so the user knows what to fix without
 * having to guess which class is missing.
 */
export function validateSipPassword(value) {
    const v = value == null ? '' : String(value);
    if (v.length < 6) {
        return 'Password must be at least 6 characters, with upper case, lower case, and a number.';
    }
    if (!/[a-z]/.test(v) || !/[A-Z]/.test(v) || !/\d/.test(v)) {
        return 'Password must include upper case, lower case, and a number.';
    }
    return null;
}

/**
 * Sentinel "placeholder" caller-Id that the SIP proxy uses to
 * mean "no Caller-Id is set on this account". Operationally
 * indistinguishable from an empty rpid for our purposes: outgoing
 * PSTN calls go out with a generic identity (or get rejected by
 * the carrier), and we want the app to behave as if the field is
 * blank — show the change UI, gate outgoing PSTN calls with the
 * SetCallerIdModal prompt, leave the SetCallerIdModal pre-fill
 * empty so the user types a real number rather than starting
 * from the sentinel.
 *
 * The wire form on the server-stored rpid is the 00 variant
 * ("0019999999999") because cdrtool normalizes + → 00 before
 * writing. We accept both shapes so the helper is robust against
 * any future caller that hasn't been through that normalisation.
 *
 * Returns true when the value should be treated as "unset".
 */
export function isPlaceholderCallerId(value) {
    const v = (value == null ? '' : String(value)).trim();
    if (v === '') return false;          // empty is "empty", handled by callers
    return v === '+19999999999' || v === '0019999999999';
}

/**
 * Validate a PSTN caller-Id / mobile number.
 *
 * Rules:
 *   • Empty string is allowed — clears the field on the server.
 *   • Otherwise must start with "+" or "00".
 *   • Body must be 7–15 digits, no other characters (no spaces,
 *     dashes, parentheses). Callers should strip cosmetic
 *     punctuation before passing the value in.
 *
 * Returns null on success, or a human-readable error string. Used by
 * both App.setServerCallerId (the round-trip caller) and the modal
 * (which surfaces the message inline so the user gets feedback
 * before the network roundtrip).
 */
export function validateCallerId(value) {
    const v = (value == null ? '' : String(value)).trim();
    if (v === '') return null;
    if (!/^(\+|00)\d{7,15}$/.test(v)) {
        return 'Must start with + or 00 and contain only digits (7–15 digits total).';
    }
    return null;
}

// Parse a WWW-Authenticate: Digest ... header into { realm, nonce, qop,
// opaque, algorithm, ... }. Tolerant of single/double quotes and of
// directives appearing in any order.
function parseDigestChallenge(headerValue) {
    if (!headerValue) return null;
    const stripped = headerValue.replace(/^\s*Digest\s+/i, '');
    const out = {};
    const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,]+))/g;
    let m;
    while ((m = re.exec(stripped)) !== null) {
        out[m[1].toLowerCase()] = (m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4])).trim();
    }
    return out.nonce && out.realm ? out : null;
}

function randomCnonce() {
    // 16 hex chars is plenty for cnonce uniqueness.
    let s = '';
    for (let i = 0; i < 4; i++) {
        s += Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    }
    return s.slice(0, 16);
}

// Build the Authorization: Digest header value.
function buildDigestAuthHeader({ username, password, method, uri, challenge }) {
    const realm  = challenge.realm;
    const nonce  = challenge.nonce;
    const opaque = challenge.opaque;
    const qop    = (challenge.qop || '').split(',').map(s => s.trim()).find(Boolean) || 'auth';
    const algo   = (challenge.algorithm || 'MD5').toUpperCase();
    if (algo !== 'MD5') {
        // The server only emits MD5; bail loudly if something else shows up
        // rather than silently producing a bad response.
        throw new Error(`Unsupported digest algorithm: ${algo}`);
    }

    const cnonce = randomCnonce();
    const nc     = '00000001';

    const HA1 = md5(`${username}:${realm}:${password}`);
    const HA2 = md5(`${method}:${uri}`);
    const response = md5(`${HA1}:${nonce}:${nc}:${cnonce}:${qop}:${HA2}`);

    const parts = [
        `username="${username}"`,
        `realm="${realm}"`,
        `nonce="${nonce}"`,
        `uri="${uri}"`,
        `algorithm=${algo}`,
        `qop=${qop}`,
        `nc=${nc}`,
        `cnonce="${cnonce}"`,
        `response="${response}"`,
    ];
    if (opaque) parts.push(`opaque="${opaque}"`);
    return 'Digest ' + parts.join(', ');
}

// Perform one digest-authenticated request.
//
//   account:  full SIP AOR, e.g. "ag@sylk.link"
//   password: SIP account password
//   url:      base URL for account_info.phtml (no query string)
//   method:   "GET" | "POST"
//   body:     optional form-encoded string for POST
//
// Returns the parsed JSON body. Throws on auth / network / non-JSON errors.
async function digestRequest({ account, password, url, method = 'GET', body = null }) {
    if (!account || !password) throw new Error('digestRequest: missing credentials');
    if (typeof account !== 'string' || account.indexOf('@') === -1) {
        throw new Error(`digestRequest: invalid SIP account "${account}"`);
    }
    const [bareUsername, domain] = account.split('@');

    // Pass ?realm=<domain> only (sylk wire API). The server defaults
    // to "sylk.link" when the param is missing, so we could omit it
    // for the common case — we send it anyway to keep the request
    // self-describing in logs and to support non-default domains.
    const fullUrl = url + (url.indexOf('?') === -1 ? '?' : '&')
                  + 'realm=' + encodeURIComponent(domain);

    console.log('[account] [server] digestRequest', method, fullUrl,
        body ? ('| body=' + body) : '');

    // Step 1: unauthenticated probe to collect the challenge.
    const probe = await fetch(fullUrl, {
        method,
        headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
        body: body || undefined,
    });

    if (probe.status !== 401) {
        // The server is configured to allow this without auth, or something
        // else is going on. Try to return whatever it gave us.
        const text = await probe.text();
        try { return JSON.parse(text); }
        catch (e) { throw new Error(`Unexpected non-401 / non-JSON response: ${probe.status} ${text.slice(0, 200)}`); }
    }

    const wwwAuth = probe.headers.get('www-authenticate') || probe.headers.get('WWW-Authenticate');
    const challenge = parseDigestChallenge(wwwAuth);
    if (!challenge) {
        throw new Error(`Missing or unparseable WWW-Authenticate header: ${wwwAuth}`);
    }

    // The "uri" we put inside the Authorization header MUST match what
    // the server sees as the request URI. For absolute URLs, fetch
    // sends only the path+query to the server, so we use that.
    //
    // We can't use `new URL(fullUrl).pathname` here — React Native's
    // built-in URL polyfill on Android does not implement .pathname
    // (only .toString() and a handful of constructor helpers), so it
    // throws "URL.pathname not implemented" at runtime. Regex parse is
    // robust enough for our case: scheme://authority/path?query, where
    // path always starts at the first '/' after the authority.
    const requestUri = (() => {
        const m = fullUrl.match(/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\/[^/?#]*(\/[^#]*)?/);
        // Fallback: if the URL has no path component at all (e.g. just
        // "https://host"), Digest expects "/".
        return (m && m[1]) || '/';
    })();

    // Step 2: authenticated retry.
    //
    // The digest USERNAME must be the bare local-part (e.g. "ag"), not
    // the full AOR. The server's stored HA1 is computed as
    // md5("<bare>:<realm>:<password>") — see library/sip_settings.php
    // around line 11144 where it builds A1 the same way. Sending the
    // full AOR here makes the client's A1 use a different first field
    // and the response never matches, producing a 401 loop even though
    // the password is correct. The PHP side does NOT use the digest
    // username for the account lookup at this point — it already looked
    // the account up via the ?realm= query parameter — so we're free
    // to send just the bare username.
    const authHeader = buildDigestAuthHeader({
        username: bareUsername,
        password,
        method,
        uri: requestUri,
        challenge,
    });

    const headers = { Authorization: authHeader };
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';

    const resp = await fetch(fullUrl, { method, headers, body: body || undefined });
    const text = await resp.text();

    // Log every response so callers can see whether the request ended
    // good or bad. Successful GETs get a status + length summary
    // (the body is the same JSON shape every time, no need to spam).
    // Everything else is either a server-formatted error envelope
    // ({"error":"...","message":"..."}) or arbitrary text — in the
    // envelope case we pull out just the error/message fields so the
    // log line stays scannable instead of dumping a 4-key blob.
    if (method === 'GET' && resp.status < 400) {
        console.log('[account] [server] response', method, resp.status, 'OK', text.length, 'bytes');
    } else if (resp.status >= 400) {
        console.log('[account] [server] response', method, resp.status, 'FAILED — full body:', text);
    } else {
        let summary = text;
        try {
            const parsed = JSON.parse(text);
            if (parsed && parsed.ok && method !== 'GET') {
                const echo = parsed.caller_id !== undefined ? `caller_id=${parsed.caller_id}`
                           : parsed.email     !== undefined ? `email=${parsed.email}`
                           : parsed.changed   !== undefined ? `changed=${parsed.changed}`
                           : 'ok';
                summary = echo;
            }
        } catch (_) { /* not JSON — leave summary as raw text */ }
        console.log('[account] [server] response', method, resp.status, summary);
    }

    if (resp.status === 401) {
        throw new Error('Digest authentication rejected — bad SIP password?');
    }
    if (resp.status >= 400) {
        throw new Error(`account_info ${method} failed: ${resp.status} ${text.slice(0, 200)}`);
    }

    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error(`account_info returned non-JSON: ${text.slice(0, 200)}`);
    }
}

/**
 * Fetch the account snapshot.
 *
 * Returns:
 *   {
 *     account: "ag@sylk.link",
 *     mobile_number: "+31...",
 *     balance: 12.34 | null,
 *     currency: "EUR",
 *     prepaid: true,
 *     today: { debit: -0.42, credit: 0 }
 *   }
 */
export function getAccountInfo({ account, password, url }) {
    return digestRequest({ account, password, url, method: 'GET' });
}

/**
 * Update the PSTN caller-Id associated with the account.
 *
 * `callerId` should be in international format starting with '+';
 * pass empty string to clear. The server normalizes (accepts both
 * "+E.164" and "00…" forms) and validates.
 *
 * Returns: { ok: true, changed: bool, caller_id: "+31..." }
 */
export function setCallerId({ account, password, url, callerId }) {
    const body = 'action=set_caller_id'
               + '&caller_id=' + encodeURIComponent(callerId || '');
    return digestRequest({ account, password, url, method: 'POST', body });
}

/**
 * Change the SIP account's password on the server.
 *
 * `password` is the CURRENT password (used to authenticate this
 * request). `newPassword` is what the account will be set to on
 * success. Server enforces a minimum length and honours the
 * "deny-password-change" group on the SIP account; rejections come
 * back as a 4xx with { error, message }.
 *
 * IMPORTANT: after this resolves successfully, the SIP REGISTER
 * credentials the app holds are stale. The caller must update its
 * local password cache and re-register before doing anything else
 * SIP-related, or the next request will 401 with the old password.
 *
 * Returns: { ok: true, changed: true } on success.
 */
export function setSipPassword({ account, password, url, newPassword }) {
    const body = 'action=set_password'
               + '&new_password=' + encodeURIComponent(newPassword || '');
    return digestRequest({ account, password, url, method: 'POST', body });
}

/**
 * Set the email address on the SIP account record.
 * Pass empty string to clear. Returns { ok, changed, email }.
 */
export function setServerEmail({ account, password, url, email }) {
    const body = 'action=set_email'
               + '&email=' + encodeURIComponent(email || '');
    return digestRequest({ account, password, url, method: 'POST', body });
}

/**
 * Request server-side account deletion. Triggers the same flow as
 * the "Identity" tab → "Delete account" button on sip_settings.phtml:
 * the server emails a confirmation link to the user's address on
 * file; clicking that link within 2 days finalizes the removal.
 *
 * Returns { ok: true, email: "..." } on success. Throws on:
 *   • missing email on the account (HTTP 400, error="email_required")
 *   • outstanding balance history (HTTP 409, error="balance_history_present")
 *   • "deny-account-delete" group (HTTP 403, error="delete_denied")
 *   • mail relay / template failure (HTTP 502)
 */
export function requestDeleteAccount({
    account, password, url,
    requesterEntity,
    clientRequestId,
    clientTimestamp,
}) {
    // requesterEntity is a dictionary the server merges into the
    // deletion-confirmation email (rendered as a table by the
    // delete.html.tpl template). Keep it open-ended so future keys
    // can be added without coordinating both ends. Common keys:
    //   user_agent   — full Sylk UA string, "Sylk (Sony XQ-EC72 on Android 16)"
    //   platform     — "android" | "ios"
    //   os_version   — "Android 16" | "iOS 17.4"
    //   device_brand — "Sony", "Apple", "Samsung", …
    //   device_model — "XQ-EC72", "iPhone15,3", …
    //   app_version  — "4.5.2"
    //
    // clientRequestId / clientTimestamp identify THIS specific
    // tap on THIS device — persisted server-side alongside the
    // server-minted IDs so support can correlate a user complaint
    // ("I clicked delete on my phone at 09:55") with the actual
    // record in the account.account_delete_request_info Preference.
    //
    // Sent as URL-encoded form fields (requester_entity is JSON-
    // encoded). Empty/undefined values are stripped so the server
    // never has to deal with "" placeholder rows.
    let bodyParts = ['action=request_delete_account'];
    if (requesterEntity && typeof requesterEntity === 'object') {
        const clean = {};
        for (const k of Object.keys(requesterEntity)) {
            const v = requesterEntity[k];
            if (v === undefined || v === null) continue;
            const s = String(v).trim();
            if (s !== '') clean[k] = s;
        }
        if (Object.keys(clean).length > 0) {
            bodyParts.push('requester_entity=' + encodeURIComponent(JSON.stringify(clean)));
        }
    }
    if (clientRequestId) {
        bodyParts.push('client_request_id=' + encodeURIComponent(String(clientRequestId)));
    }
    if (clientTimestamp) {
        bodyParts.push('client_timestamp=' + encodeURIComponent(String(clientTimestamp)));
    }
    return digestRequest({
        account, password, url, method: 'POST',
        body: bodyParts.join('&'),
    });
}

/**
 * Cancel a pending account-deletion request. Clears the
 * account_delete_request* Preferences on the SIP account so the
 * email confirmation link previously sent is no longer valid.
 *
 * `clientRequestId` is the only ID the caller has — the server
 * compares it against the persisted client_request_id and
 * rejects with 409 request_id_mismatch on disagreement. Sending
 * no ID is still allowed (web Identity tab calls cancel without
 * a snapshot round-trip).
 *
 * server_request_id is intentionally NOT a parameter here — it
 * never leaves the server except via the email confirmation
 * link, so clients can't supply it and don't need to.
 *
 * Returns { ok: true, changed: bool }. Idempotent — calling when
 * nothing is pending returns ok:true, changed:false.
 */
export function cancelDeleteAccount({
    account, password, url,
    clientRequestId,
}) {
    let bodyParts = ['action=cancel_delete_account'];
    if (clientRequestId) {
        bodyParts.push('client_request_id=' + encodeURIComponent(String(clientRequestId)));
    }
    return digestRequest({
        account, password, url, method: 'POST',
        body: bodyParts.join('&'),
    });
}

export default {
    getAccountInfo,
    setCallerId,
    setSipPassword,
    setServerEmail,
    requestDeleteAccount,
    cancelDeleteAccount,
    isPlaceholderCallerId,
};
