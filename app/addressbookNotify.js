/*
 * addressbookNotify.js
 *
 * application/sylk-addressbook-update — "the server addressbook changed,
 * refetch it". Sent to our OWN account so it forks to every other device,
 * never journalled, never persisted.
 *
 * Spec: docs/messages/sylk-addressbook-update.md
 *
 * This module is pure (no RN imports, no timers of its own): it holds the
 * wire format and the two state machines that decide WHEN something may
 * happen. app.js owns the actual setTimeout / sendMessage / fetch calls and
 * feeds these objects a clock. That split is what makes the throttles
 * testable — a fuse that can only be observed by waiting five minutes on a
 * phone is a fuse nobody ever verifies.
 */

'use strict';

const CONTENT_TYPE = 'application/sylk-addressbook-update';
const PAYLOAD_VERSION = 1;

// --- send side ------------------------------------------------------------
// One tick per burst, never one per contact.
const NOTIFY_DEBOUNCE = 3000;         // quiet time after the last write
const NOTIFY_MAX_DEFER = 30000;       // ... but never defer longer than this
const NOTIFY_MIN_INTERVAL = 10000;    // floor between two ticks
const NOTIFY_FUSE_MAX = 6;            // ticks per window before we stop
const NOTIFY_FUSE_WINDOW = 300000;
const ID_LIST_CAP = 64;               // past this, drop the lists, set truncated

// --- receive side ---------------------------------------------------------
// Every device on the account gets the same tick in the same instant, so the
// fetch is always jittered: without it one desktop edit becomes a synchronised
// GET from every phone, tablet and desktop the account owns.
const FETCH_JITTER_MIN = 2000;
const FETCH_JITTER_MAX = 9000;
const FETCH_MIN_INTERVAL = 15000;     // never below FETCH_JITTER_MAX
const FETCH_FUSE_MAX = 10;            // fetches per window before backing off
const FETCH_FUSE_WINDOW = 300000;
const FETCH_BACKOFF = [30000, 60000, 120000, 300000];
const FRESHNESS_WINDOW = 120;         // seconds; checked ON ARRIVAL only

function nowSeconds() { return Math.floor(Date.now() / 1000); }

function _ids(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const id of list) {
        if (id === null || id === undefined) continue;
        const s = String(id);
        if (s && out.indexOf(s) === -1) out.push(s);
    }
    return out;
}

/*
 * Build the JSON body. Present-vs-absent is load-bearing: an empty array means
 * "nothing in that collection changed", an ABSENT field means "unknown, assume
 * everything did". So a truncated tick omits both lists rather than sending an
 * empty pair, which would claim nothing had changed.
 */
function buildTick(opts) {
    opts = opts || {};
    const truncated = !!opts.truncated;
    const body = {
        v: PAYLOAD_VERSION,
        origin: String(opts.origin || ''),
        timestamp: opts.timestamp != null ? opts.timestamp : nowSeconds(),
    };
    if (!truncated) {
        body.contactIds = _ids(opts.contactIds);
        body.groupIds = _ids(opts.groupIds);
    } else {
        body.truncated = true;
    }
    return JSON.stringify(body);
}

// Returns null for anything that isn't a v1 tick, so a caller can hand us
// garbage (or a future version) and simply ignore it.
function parseTick(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return null; }
    if (!obj || typeof obj !== 'object') return null;
    if (obj.v !== PAYLOAD_VERSION) return null;
    if (typeof obj.timestamp !== 'number') return null;
    return {
        v: obj.v,
        origin: obj.origin ? String(obj.origin) : '',
        timestamp: obj.timestamp,
        // null (not []) when the field is absent: "unknown, assume everything".
        contactIds: Array.isArray(obj.contactIds) ? _ids(obj.contactIds) : null,
        groupIds: Array.isArray(obj.groupIds) ? _ids(obj.groupIds) : null,
        truncated: !!obj.truncated,
    };
}

// Checked ON ARRIVAL, before any timer is armed — never again when the jitter
// expires, or a 30s delay on a 110s-old tick would discard a wanted fetch.
function isFresh(timestamp, nowSec, windowSec) {
    const now = nowSec != null ? nowSec : nowSeconds();
    const win = windowSec != null ? windowSec : FRESHNESS_WINDOW;
    if (typeof timestamp !== 'number') return false;
    const age = now - timestamp;
    return age >= -10 && age <= win;    // 10s of clock skew
}

function jitterDelay(rand) {
    const r = typeof rand === 'function' ? rand() : Math.random();
    return FETCH_JITTER_MIN + Math.floor(r * (FETCH_JITTER_MAX - FETCH_JITTER_MIN));
}

function _prune(stamps, now, window) {
    while (stamps.length && now - stamps[0] > window) stamps.shift();
    return stamps;
}

/*
 * SendThrottle — accumulates a burst and answers one question: may we send
 * yet, and with what?
 *
 * The debounce collapses a burst into one tick. The floor and the fuse are the
 * second line of defence, against a BUG — an adopt-down path we missed, two
 * devices answering each other. Six addressbook bursts in five minutes is not
 * human editing, it is a loop, and the fuse tripping is a bug report rather
 * than a number to tune.
 */
class SendThrottle {
    constructor(opts) {
        opts = opts || {};
        this._now = opts.now || (() => Date.now());
        this._contacts = new Set();
        this._groups = new Set();
        this._truncated = false;
        this._firstPending = null;   // ms, when this burst started
        this._lastWrite = null;      // ms, last write that joined it
        this._lastSend = null;
        this._sends = [];            // fuse ring
        this._fuseLogged = false;
        this._suppress = 0;          // >0 while adopting server data
    }

    // Adopt-down paths wrap themselves in this: a reconcile that echoes server
    // state back up must never tell the other devices to refetch what they
    // just sent us.
    suppress() { this._suppress += 1; }
    resume() { if (this._suppress > 0) this._suppress -= 1; }
    get suppressed() { return this._suppress > 0; }

    note(kind, id) {
        if (this._suppress > 0) return false;
        const now = this._now();
        if (this._firstPending === null) this._firstPending = now;
        this._lastWrite = now;
        if (!id) {
            // An op that cannot name its id makes the whole tick truncated:
            // better to say "assume everything" than to send a list that
            // silently omits a row.
            this._truncated = true;
        } else if (kind === 'group') {
            this._groups.add(String(id));
        } else {
            this._contacts.add(String(id));
        }
        if (this._contacts.size > ID_LIST_CAP || this._groups.size > ID_LIST_CAP) {
            this._truncated = true;
        }
        return true;
    }

    noteContact(id) { return this.note('contact', id); }
    noteGroup(id) { return this.note('group', id); }

    get pending() { return this._firstPending !== null; }

    // When the caller should next look at us, in ms from now. null = nothing
    // pending. The debounce is re-armed by every write; MAX_DEFER puts a
    // ceiling on that so a slow drip cannot defer the tick forever.
    delay() {
        if (!this.pending) return null;
        const now = this._now();
        const due = Math.min(this._lastWrite + NOTIFY_DEBOUNCE,
                             this._firstPending + NOTIFY_MAX_DEFER);
        const floor = this._lastSend === null ? 0 : this._lastSend + NOTIFY_MIN_INTERVAL;
        return Math.max(0, Math.max(due, floor) - now);
    }

    // Drain the burst if it is due AND settled. `settled` is the caller's
    // answer to "is anything of ours still in flight" — a tick sent before our
    // own writes have reached the server would send the other devices to fetch
    // a document we are still writing.
    take(settled) {
        if (!this.pending) return null;
        if (this.delay() > 0) return null;
        if (settled === false) return null;

        const now = this._now();
        _prune(this._sends, now, NOTIFY_FUSE_WINDOW);
        if (this._sends.length >= NOTIFY_FUSE_MAX) {
            // Keep the ids: when the window drains they go out in one tick.
            if (!this._fuseLogged) {
                this._fuseLogged = true;
                this._fuseTrippedWith = {
                    contactIds: [...this._contacts], groupIds: [...this._groups],
                };
            }
            return null;
        }
        this._fuseLogged = false;

        // Still being written to? Then this is a MAX_DEFER flush, and the
        // lists do not describe a finished burst.
        const stillWriting = now < this._lastWrite + NOTIFY_DEBOUNCE;
        const truncated = this._truncated || stillWriting
            || this._contacts.size > ID_LIST_CAP || this._groups.size > ID_LIST_CAP;

        const out = {
            contactIds: [...this._contacts],
            groupIds: [...this._groups],
            truncated,
        };
        this._contacts.clear();
        this._groups.clear();
        this._truncated = false;
        this._firstPending = null;
        this._lastWrite = null;
        this._lastSend = now;
        this._sends.push(now);
        return out;
    }

    get fuseBlown() {
        _prune(this._sends, this._now(), NOTIFY_FUSE_WINDOW);
        return this._sends.length >= NOTIFY_FUSE_MAX;
    }
}

/*
 * FetchScheduler — decides when an arriving tick turns into a fetch.
 *
 * Never immediately: every device received the same tick at the same instant.
 * Never while our own writes are settling: a snapshot landing on top of our
 * own unflushed queue is how a reconcile ends up re-pushing rows we were in
 * the middle of replacing.
 */
class FetchScheduler {
    constructor(opts) {
        opts = opts || {};
        this._now = opts.now || (() => Date.now());
        this._rand = opts.rand || Math.random;
        this._armed = false;
        this._inFlight = false;
        this._pendingAfterFlight = false;
        this._lastFetch = null;
        this._fetches = [];
        this._backoffStep = 0;
        this._backoffUntil = 0;
    }

    get armed() { return this._armed; }
    get inFlight() { return this._inFlight; }

    /*
     * A tick arrived. Returns the delay in ms to arm a fetch at, or null when
     * the tick merged into a fetch that is already coming (the caller unions
     * the ids into the same pending fetch instead of arming a second one).
     */
    schedule() {
        if (this._armed) return null;
        if (this._inFlight) { this._pendingAfterFlight = true; return null; }
        const now = this._now();
        let delay = jitterDelay(this._rand);
        if (this._lastFetch !== null) {
            delay = Math.max(delay, this._lastFetch + FETCH_MIN_INTERVAL - now);
        }
        if (this._backoffUntil > now) {
            delay = Math.max(delay, this._backoffUntil - now);
        }
        this._armed = true;
        return Math.max(0, delay);
    }

    // The armed timer fired. `settled` is the caller's "are our own writes
    // finished" answer; false re-arms rather than fetching.
    fire(settled) {
        this._armed = false;
        if (settled === false) {
            const delay = this.schedule();
            return { fetch: false, retryIn: delay };
        }
        const now = this._now();
        _prune(this._fetches, now, FETCH_FUSE_WINDOW);
        if (this._fetches.length >= FETCH_FUSE_MAX) {
            // Something upstream is looping. Protect the server even though
            // the sender's own fuse should have caught this first.
            const step = Math.min(this._backoffStep, FETCH_BACKOFF.length - 1);
            this._backoffUntil = now + FETCH_BACKOFF[step];
            this._backoffStep += 1;
            const delay = this.schedule();
            return { fetch: false, backedOff: true, retryIn: delay };
        }
        this._fetches.push(now);
        this._lastFetch = now;
        this._inFlight = true;
        return { fetch: true };
    }

    // The fetch finished (either way — a failed fetch still consumed a slot).
    done() {
        this._inFlight = false;
        if (this._pendingAfterFlight) {
            this._pendingAfterFlight = false;
            return this.schedule();
        }
        return null;
    }

    // A clean, unprompted full load resets the backoff ladder.
    reset() { this._backoffStep = 0; this._backoffUntil = 0; this._fetches = []; }
}

module.exports = {
    CONTENT_TYPE,
    PAYLOAD_VERSION,
    NOTIFY_DEBOUNCE,
    NOTIFY_MAX_DEFER,
    NOTIFY_MIN_INTERVAL,
    NOTIFY_FUSE_MAX,
    NOTIFY_FUSE_WINDOW,
    ID_LIST_CAP,
    FETCH_JITTER_MIN,
    FETCH_JITTER_MAX,
    FETCH_MIN_INTERVAL,
    FETCH_FUSE_MAX,
    FETCH_FUSE_WINDOW,
    FETCH_BACKOFF,
    FRESHNESS_WINDOW,
    nowSeconds,
    buildTick,
    parseTick,
    isFresh,
    jitterDelay,
    SendThrottle,
    FetchScheduler,
};
