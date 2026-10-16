/*
 * accountStorage.js
 *
 * Contact avatars from SylkServer account storage, as Sylk Mobile sees them.
 *
 * Spec: Blink docs/CONTACT-AVATARS.md ("Sylk Mobile implementation"). Blink
 * talks to the storage over HTTP; WebSocket clients get the pictures on the
 * addressbook contacts they already fetch (SylkServer contact_avatars.py):
 *
 *   - the fetch carries the etags we have cached ([{id, etag}]); every
 *     contact with a stored picture comes back with `avatar` = {etag,
 *     content_type, size, modified, device_id}, plus the picture data only
 *     where our etag differs. sylkrtc takes the data off the contacts and
 *     hands it over in an 'avatars' event: applyAvatars().
 *   - a picture is set or removed by a contact update carrying
 *     avatar = {data, content_type, device_id} or {remove: true, device_id}.
 *     The result is echoed to every device of the account in the same
 *     'avatars' event: the stored picture with its data, {code: 204} after a
 *     removal, {code, error} when storing failed (413, 507).
 *   - the server deletes the picture of a deleted contact, and collects
 *     orphans; there is no client garbage collection.
 *   - application/sylk-storage-changed (a change made over HTTP, by Blink)
 *     asks for a refetch, which brings the new data.
 *
 * Avatars are stored under the XCAP contact id (the row's remote_id). The
 * cache mirrors what the server addressbook says: reconcile() on every
 * settle drops what is gone and refetches what is missing.
 *
 * Pictures of this device are the ones set in Sylk's contact editor AND the
 * phone's address book photos (contact.photo): both are the user's, both go
 * to the server. A photo from the phonebook is taken into the index once per
 * version (index.state.phonebook[localId] = hash of the source) and from
 * there follows the same rules as one set in the editor. A picture set in
 * the editor wins over the phonebook one for the same contact.
 *
 * Display precedence (photoFor):
 *   1. a picture of this device that is still waiting to be uploaded
 *   2. the stored avatar, from the cache
 *   3. a picture of this device on an account without account storage
 *   4. nothing -- the caller falls back to contact.photo, then initials.
 *
 * The user is asked to choose between a server picture and one set on this
 * device only at the first sync of each account (index.state.first_sync_done).
 * After it, a picture set here that was never uploaded is newer than the
 * server's, and is uploaded without asking.
 *
 * Per-contact local state lives in this module's own index, keyed by the
 * LOCAL contact id (contact.id), because a picture can be set before the
 * contact has reached the server and has a remote_id. Nothing here is ever
 * written to the contacts table, and the avatar never goes into XCAP.
 *
 * No React Native imports: the file system, transport, clock and the app
 * callbacks are injected, so the whole state machine runs under node.
 */

'use strict';

const STORAGE_CHANGED_CONTENT_TYPE = 'application/sylk-storage-changed';
// Blink's token requests and the server's replies reach every device of the
// account; mobile has no use for them and drops them.
const API_TOKEN_CONTENT_TYPE = 'application/sylk-api-token';
const AVATARS_NAMESPACE = 'avatars';
const AVATAR_CONTENT_TYPE = 'image/jpeg';

const PENDING_RETRY_INTERVAL = 300 * 1000;
// A refetch to recover missing pictures at most this often.
const REFETCH_MIN_INTERVAL = 600 * 1000;
// An upload or removal whose echo did not come back within this is retried.
const ECHO_TIMEOUT = 60 * 1000;
// Another modal is up: try the choice window again after this.
const ASK_RETRY_DELAY = 5000;

const NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

function validName(name) {
    return typeof name === 'string' && NAME_RE.test(name);
}

function parseJson(text) {
    if (text === null || text === undefined) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
}

// application/sylk-storage-changed body, or null.
function parseStorageChanged(text) {
    const d = parseJson(typeof text === 'string' ? text : String(text || ''));
    if (!d || typeof d !== 'object') return null;
    if (typeof d.namespace !== 'string' || typeof d.id !== 'string') return null;
    if (d.op !== 'put' && d.op !== 'delete') return null;
    return d;
}

function isControlType(contentType) {
    return contentType === STORAGE_CHANGED_CONTENT_TYPE || contentType === API_TOKEN_CONTENT_TYPE;
}

// Who uploaded a picture, for a human.
function deviceLabel(deviceId, ownDeviceId) {
    if (!deviceId) return 'unknown device';
    if (ownDeviceId && String(deviceId) === String(ownDeviceId)) return 'This device';
    return 'Device ' + String(deviceId).slice(0, 8);
}

function extensionFor(contentType) {
    const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
    if (ct === 'image/jpeg' || ct === 'image/jpg') return 'jpg';
    if (ct === 'image/webp') return 'webp';
    if (ct === 'image/png') return 'png';
    return 'bin';
}

function safeFileName(id) {
    return String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96);
}

// A short fingerprint of a phonebook photo's bytes, to tell a new version.
function sourceHash(text) {
    let h1 = 0x811c9dc5;
    let h2 = 5381;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = ((h2 * 33) ^ c) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + text.length.toString(16);
}

// Photo uris the phonebook pass reads: local files and content uris, not
// remote pictures.
function readablePhoto(uri) {
    if (!uri || typeof uri !== 'string') return false;
    return !/^https?:/i.test(uri.trim());
}

const EMPTY_INDEX = () => ({ v: 1, cache: {}, local: {}, state: {} });

/*
 * AvatarStore -- one instance per app.
 *
 * opts:
 *   fs:   { exists(path), readUtf8(path), writeUtf8(path, text),
 *           readBase64(path), writeBase64(path, b64), mkdirp(path),
 *           unlink(path), move(from, to), copy(from, to) }  -- promises
 *   rootDir: <documents>/account_storage
 *   deviceId, log(line), now(), setTimeout, clearTimeout
 *
 * hooks (configure()):
 *   sendAvatar(remoteId, avatar) -> Promise<bool>   a contact update carrying
 *       avatar {data, content_type, device_id} or {remove: true, device_id};
 *       true when the server took the request (the outcome comes back
 *       through applyAvatars)
 *   refetch(reason)                 fetch the addressbook again
 *   contacts() -> [{id, remote_id, name, uri, photo}] the local rows;
 *       photo is the phone's address book photo (uri), if any
 *   readPhoto(uri) -> Promise<base64|null>   the bytes of such a photo
 *   phonebookReady() -> bool        the phonebook was read, or cannot be
 *       (no permission): until then the first sync is not finished
 *   encodePhoto(base64) -> base64 JPEG       the 96x96 avatar built from it
 *   changed(ids)                    views showing these ids must refresh
 *   notifyUser(title, body)
 *   canAsk() -> bool                no other modal or call on screen
 *   askConflicts(items) -> Promise<{[contactId]: 'server'|'local'}>
 */
class AvatarStore {
    constructor(opts) {
        opts = opts || {};
        this.fs = opts.fs;
        this.rootDir = opts.rootDir || '';
        this.deviceId = opts.deviceId ? String(opts.deviceId) : null;
        this._log = opts.log || (() => {});
        this._now = opts.now || (() => Date.now());
        this._setTimeout = opts.setTimeout || setTimeout;
        this._clearTimeout = opts.clearTimeout || clearTimeout;
        this.hooks = {};

        this.account = null;       // the account whose index is loaded
        this.enabled = false;      // this account has account storage
        this.dir = null;
        this.index = EMPTY_INDEX();
        this.loaded = false;
        this._gen = 0;

        this._listeners = new Set();
        this.version = 0;
        this._chain = Promise.resolve();
        this._resetRuntime();
    }

    _resetRuntime() {
        this.awaiting = new Map();   // remote id -> {lid, kind: 'put'|'remove', file, reason, at}
        this.early = [];             // 'avatars' items that came before the index loaded
        this.settled = false;
        this.reconciled = false;
        this.lastRefetch = 0;
        this.asking = false;
        this.phonebookSeen = new Map();   // local id -> photo uri looked at this run
        this.lastServerContacts = null;
        if (this._askTimer) { this._clearTimeout(this._askTimer); this._askTimer = null; }
    }

    configure(hooks) { this.hooks = Object.assign({}, this.hooks, hooks || {}); }

    log(line) { try { this._log('[avatar] ' + line); } catch (e) { /* never */ } }

    // --- views ------------------------------------------------------------

    subscribe(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    _changed(ids) {
        this.version += 1;
        const list = Array.isArray(ids) ? ids : (ids ? [ids] : []);
        for (const fn of Array.from(this._listeners)) {
            try { fn(list, this.version); } catch (e) { /* a view must not break us */ }
        }
        if (typeof this.hooks.changed === 'function') {
            try { this.hooks.changed(list); } catch (e) { /* idem */ }
        }
    }

    _path(name) { return this.dir + '/' + name; }

    _fileUri(name) {
        if (!name || !this.dir) return null;
        const p = this._path(name);
        return p.startsWith('file://') ? p : 'file://' + p;
    }

    /*
     * The picture to show for a contact, as a file:// uri, or null when the
     * caller should fall back to contact.photo and then the initials. Never
     * touches the disk or the network.
     */
    photoFor(contact) {
        if (!contact || !this.loaded) return null;
        const local = contact.id ? this.index.local[String(contact.id)] : null;
        if (local && local.file && local.pending) return this._fileUri(local.file);
        if (local && local.deletePending) return null;
        const rid = contact.remote_id ? String(contact.remote_id) : null;
        const cached = rid ? this.index.cache[rid] : null;
        if (cached && cached.file) return this._fileUri(cached.file);
        if (local && local.file && local.userSet) return this._fileUri(local.file);
        return null;
    }

    // What the editor says about the picture it shows, or null.
    info(contact) {
        if (!contact || !this.loaded) return null;
        const local = contact.id ? this.index.local[String(contact.id)] : null;
        if (local && local.file && local.pending) {
            return { source: 'pending', label: 'Set on this device, not uploaded yet', modified: local.setAt || null };
        }
        if (local && local.deletePending) return null;
        const rid = contact.remote_id ? String(contact.remote_id) : null;
        const cached = rid ? this.index.cache[rid] : null;
        if (cached && cached.file) {
            return { source: 'server', label: deviceLabel(cached.device_id, this.deviceId),
                     modified: cached.modified || null, deviceId: cached.device_id || null };
        }
        if (local && local.file && local.userSet) {
            return { source: 'local', label: 'Set on this device', modified: local.setAt || null };
        }
        return null;
    }

    hasPicture(contact) { return !!this.photoFor(contact); }

    get storageEnabled() { return this.enabled; }

    // [{id, etag}] of the cached pictures: sent with every addressbook fetch,
    // so the server sends picture data only where it changed.
    cachedEtags() {
        if (!this.loaded) return [];
        return Object.entries(this.index.cache)
            .filter(([id, e]) => e && e.etag && validName(id))
            .map(([id, e]) => ({ id, etag: e.etag }));
    }

    // --- account lifecycle ------------------------------------------------

    /*
     * Load the index of `account`. `enabled` false: the account has no
     * account storage, pictures set in the editor stay local.
     */
    async setAccount(account, enabled) {
        const acc = account ? String(account).trim().toLowerCase() : null;
        const on = !!(acc && enabled);
        if (acc && acc === this.account) {
            if (on !== this.enabled) {
                this.enabled = on;
                this.log('Account storage for ' + acc + (on ? ' enabled' : ' disabled, pictures stay local'));
            }
            return;
        }
        this._gen += 1;
        this._resetRuntime();
        this.account = acc;
        this.enabled = on;
        this.loaded = false;
        this.index = EMPTY_INDEX();
        this.dir = acc ? this.rootDir + '/' + safeFileName(acc.replace('@', '_at_')) + '/' + AVATARS_NAMESPACE : null;
        if (!acc) { this._changed([]); return; }
        const gen = this._gen;
        try {
            await this.fs.mkdirp(this.dir);
            const p = this._path('index.json');
            if (await this.fs.exists(p)) {
                const parsed = parseJson(await this.fs.readUtf8(p));
                if (parsed && typeof parsed === 'object') {
                    this.index = { v: 1, cache: parsed.cache || {}, local: parsed.local || {},
                                   state: parsed.state || {} };
                }
            }
        } catch (e) {
            this.log('Cannot read the avatar index of ' + acc + ': ' + (e && e.message));
        }
        if (gen !== this._gen) return;
        // A file that went away (cleared by the OS, a restore) is not a
        // picture: drop its entry so the view falls back cleanly.
        let dropped = 0;
        for (const [id, e] of Object.entries(this.index.cache)) {
            if (!e || !e.file || !(await this._exists(e.file))) { delete this.index.cache[id]; dropped += 1; }
        }
        for (const [id, e] of Object.entries(this.index.local)) {
            if (e && e.file && !(await this._exists(e.file))) {
                if (e.deletePending) { delete e.file; } else { delete this.index.local[id]; }
                dropped += 1;
            }
        }
        if (gen !== this._gen) return;
        this.loaded = true;
        if (dropped) await this._saveIndex();
        this.log('Avatar cache for ' + acc + ': ' + Object.keys(this.index.cache).length + ' stored, '
            + Object.keys(this.index.local).length + ' local'
            + (on ? '' : ' (no account storage, pictures stay local)'));
        this._changed([]);
        if (this.early.length) {
            const early = this.early;
            this.early = [];
            this.applyAvatars(early);
        }
    }

    reset() {
        this._gen += 1;
        this._resetRuntime();
        this.account = null;
        this.enabled = false;
        this.dir = null;
        this.loaded = false;
        this.index = EMPTY_INDEX();
        this._changed([]);
    }

    async _exists(name) {
        try { return await this.fs.exists(this._path(name)); } catch (e) { return false; }
    }

    async _unlink(name) {
        if (!name || !this.dir) return;
        await this._unlinkPath(this._path(name));
    }

    async _unlinkPath(p) {
        try { if (await this.fs.exists(p)) await this.fs.unlink(p); } catch (e) { /* best effort */ }
    }

    async _saveIndex() {
        if (!this.dir) return;
        const p = this._path('index.json');
        try {
            await this.fs.writeUtf8(p + '.tmp', JSON.stringify(this.index));
            await this._unlinkPath(p);
            await this.fs.move(p + '.tmp', p);
        } catch (e) {
            this.log('Cannot save the avatar index: ' + (e && e.message));
        }
    }

    // Serialise everything that touches the index on one worker.
    _serial(fn) {
        const run = this._chain.then(() => fn()).catch((e) => {
            this.log('Unexpected error: ' + (e && e.stack ? e.stack : e));
        });
        this._chain = run;
        return run;
    }

    // Resolves once everything queued so far has run (tests, teardown).
    idle() { return this._chain; }

    // --- cache ------------------------------------------------------------

    // Write picture data into the cache under (id, etag).
    async _storeCached(id, meta, base64) {
        const etag = meta.etag;
        const contentType = String(meta.content_type || AVATAR_CONTENT_TYPE).split(';')[0].trim();
        const name = safeFileName(id) + '.' + safeFileName(etag).slice(0, 40) + '.' + extensionFor(contentType);
        const old = this.index.cache[id];
        await this.fs.mkdirp(this.dir);
        await this.fs.writeBase64(this._path(name), base64);
        if (old && old.file && old.file !== name) await this._unlink(old.file);
        this.index.cache[id] = {
            file: name, etag, content_type: contentType,
            size: meta.size || null, device_id: meta.device_id || null, modified: meta.modified || null,
        };
    }

    async _dropCached(id) {
        const e = this.index.cache[id];
        if (!e) return false;
        delete this.index.cache[id];
        await this._unlink(e.file);
        return true;
    }

    _contacts() {
        try {
            const c = typeof this.hooks.contacts === 'function' ? this.hooks.contacts() : null;
            return Array.isArray(c) ? c : [];
        } catch (e) {
            return [];
        }
    }

    // local contact id -> remote id, and back
    _ids() {
        const ridOf = new Map();
        const lidOf = new Map();
        for (const c of this._contacts()) {
            if (c && c.id && c.remote_id) {
                ridOf.set(String(c.id), String(c.remote_id));
                lidOf.set(String(c.remote_id), String(c.id));
            }
        }
        return { ridOf, lidOf };
    }

    _refetch(reason, force) {
        const now = this._now();
        if (!force && this.lastRefetch && now - this.lastRefetch < REFETCH_MIN_INTERVAL) return;
        this.lastRefetch = now;
        this.log('Refetching the addressbook: ' + reason);
        if (typeof this.hooks.refetch === 'function') {
            try { this.hooks.refetch(reason); } catch (e) { /* never */ }
        }
    }

    // --- pictures from the server -----------------------------------------

    /*
     * sylkrtc 'avatars' event: [{id, avatar, data}] taken off the contacts of
     * a fetched addressbook or of an update echoed to the account's devices.
     * Comes before the matching dataLoaded / dataUpdated.
     */
    applyAvatars(items) {
        if (!Array.isArray(items) || !items.length || !this.account) return Promise.resolve();
        if (!this.loaded) {
            this.early.push(...items);
            return Promise.resolve();
        }
        const gen = this._gen;
        return this._serial(() => this._applyAvatars(items, gen));
    }

    async _applyAvatars(items, gen) {
        if (gen !== this._gen) return;
        const { lidOf } = this._ids();
        const changed = [];
        let stored = 0;
        for (const item of items) {
            const rid = item && item.id ? String(item.id) : null;
            const avatar = (item && item.avatar) || {};
            if (!rid || !validName(rid)) continue;
            const waiting = this.awaiting.get(rid);
            const lid = (waiting && waiting.lid) || lidOf.get(rid) || null;
            const local = lid ? this.index.local[lid] : null;

            if (avatar.code) {
                // The outcome of an upload or removal. Only the device that
                // asked has anything to do with it.
                if (!waiting) continue;
                this.awaiting.delete(rid);
                await this._outcome(rid, lid, waiting, avatar);
                changed.push(rid);
                continue;
            }
            if (!item.data || !avatar.etag) continue;

            if (waiting && waiting.kind === 'put' && avatar.device_id === this.deviceId) {
                // Our own upload, echoed: the stored copy is the picture now.
                this.awaiting.delete(rid);
                await this._storeCached(rid, avatar, item.data);
                if (local && local.pending && local.file === waiting.file) {
                    this._phonebookHandled(lid, local);
                    await this._unlink(local.file);
                    delete this.index.local[lid];
                }
                this.log('Uploaded the picture of ' + this._describe(lid, rid) + ': ' + waiting.reason
                    + ', ' + (avatar.size || '?') + ' bytes, etag ' + avatar.etag);
                changed.push(rid);
                continue;
            }
            if (local && (local.pending || local.deletePending)) {
                // Ours to settle first: the picture waiting here replaces it,
                // or a removal is under way.
                continue;
            }
            const cached = this.index.cache[rid];
            if (cached && cached.etag === avatar.etag) continue;
            await this._storeCached(rid, avatar, item.data);
            stored += 1;
            changed.push(rid);
        }
        if (changed.length) {
            await this._saveIndex();
            this._changed(changed);
        }
        if (stored) this.log('Stored ' + stored + ' picture' + (stored === 1 ? '' : 's') + ' from the server');
    }

    async _outcome(rid, lid, waiting, avatar) {
        const local = lid ? this.index.local[lid] : null;
        const who = this._describe(lid, rid);
        if (waiting.kind === 'remove') {
            if (avatar.code === 204 || avatar.code === 404) {
                this.log('Avatar of ' + who + ' deleted');
                if (local && local.deletePending) delete this.index.local[lid];
                await this._dropCached(rid);
            } else {
                this.log('Cannot delete the avatar of ' + who + ': code ' + avatar.code + ', retried later');
            }
            await this._saveIndex();
            return;
        }
        if (avatar.code === 413 || avatar.code === 507) {
            this.log('Picture of ' + who + ' not uploaded (' + waiting.reason + '): '
                + (avatar.code === 413 ? 'too large (413)' : 'account storage full (507)'));
            // Keep the old avatar (the stored one, else the phonebook photo):
            // the rejected picture goes, or the next sync would push it again.
            if (local && local.file === waiting.file) {
                this._phonebookHandled(lid, local);
                await this._unlink(local.file);
                delete this.index.local[lid];
                await this._saveIndex();
            }
            if (typeof this.hooks.notifyUser === 'function') {
                try {
                    this.hooks.notifyUser('Contact picture not saved',
                        avatar.code === 413 ? 'The picture is too large for the server'
                                            : 'The account storage on the server is full');
                } catch (e) { /* never */ }
            }
            return;
        }
        // 5xx, 404 (storage disabled), 400: kept locally and pending
        this.log('Upload of the picture of ' + who + ' postponed (' + waiting.reason + '): code '
            + avatar.code + (avatar.error ? ' (' + avatar.error + ')' : '') + ', retried later');
    }

    _describe(lid, rid) {
        const c = this._contacts().find((x) => x && ((lid && String(x.id) === String(lid))
                                                     || (rid && String(x.remote_id) === String(rid))));
        const parts = [];
        if (c && c.name) parts.push(c.name);
        if (c && c.uri) parts.push('<' + c.uri + '>');
        parts.push('(' + (rid || 'local ' + lid) + ')');
        return parts.join(' ');
    }

    // --- startup diff -----------------------------------------------------

    // The addressbook settled (the reconcile pass after a fetch finished).
    onSettled(serverContacts) {
        if (!this.loaded) return;
        this.settled = true;
        this.reconcile(serverContacts, this.reconciled ? 'settle' : 'first settle');
        this.retryPending();
    }

    onRegistered() {
        if (this.enabled && this.settled) this.retryPending();
    }

    /*
     * Make the cache equal to what the server addressbook says, and settle
     * the pictures set on this device. `serverContacts` is the fetched
     * document's contacts, each with `avatar` meta when it has a picture.
     */
    reconcile(serverContacts, reason) {
        if (!this.enabled || !this.loaded || !Array.isArray(serverContacts)) return Promise.resolve();
        const gen = this._gen;
        return this._serial(() => this._reconcile(serverContacts, reason || 'reconcile', gen));
    }

    async _reconcile(serverContacts, reason, gen) {
        if (gen !== this._gen) return;
        const contactIds = new Set();
        const objects = new Map();
        for (const s of serverContacts) {
            if (!s || !s.id) continue;
            contactIds.add(String(s.id));
            if (s.avatar && s.avatar.etag) objects.set(String(s.id), s.avatar);
        }
        this.lastServerContacts = serverContacts;
        await this._phonebookPass(contactIds, gen);
        if (gen !== this._gen) return;
        const { ridOf } = this._ids();

        const pending = new Set();
        const localPics = new Map();   // remote id -> local id
        for (const [lid, e] of Object.entries(this.index.local)) {
            if (!e) continue;
            const rid = ridOf.get(lid) || e.remoteId || null;
            if (e.pending || e.deletePending) {
                if (rid) pending.add(rid);
                continue;
            }
            if (e.userSet && e.file && rid && validName(rid) && contactIds.has(rid)) localPics.set(rid, lid);
        }

        // After the first sync there is nothing to choose: a picture of this
        // device that was never uploaded is newer than the server's (set
        // while the storage was not reachable, before the account had one,
        // or changed in the phonebook since), so it is uploaded. Phonebook
        // photos have their own first pass: devices that synced before
        // phonebook photos counted still get to choose once.
        const newer = [];
        for (const [rid, lid] of localPics) {
            const e = this.index.local[lid];
            if (this._firstDoneFor(e)) newer.push([rid, lid]);
        }
        if (newer.length) {
            for (const [rid, lid] of newer) {
                this.index.local[lid].pending = true;
                pending.add(rid);
                localPics.delete(rid);
            }
            await this._saveIndex();
            for (const [, lid] of newer) {
                const e = this.index.local[lid];
                await this._upload(lid, e && e.source === 'phonebook' ? 'phonebook photo, newer than the server'
                                                                     : 'set on this device, not uploaded yet', gen);
                if (gen !== this._gen) return;
            }
        }

        const missing = [];
        const conflicts = [];
        for (const [rid, meta] of objects) {
            if (pending.has(rid)) continue;
            const cached = this.index.cache[rid];
            const have = cached && cached.etag === meta.etag;
            if (localPics.has(rid)) {
                if (have) conflicts.push(rid); else missing.push(rid);
                continue;
            }
            if (!have) missing.push(rid);
            else if (meta.device_id !== cached.device_id || meta.modified !== cached.modified) {
                cached.device_id = meta.device_id || null;
                cached.modified = meta.modified || null;
            }
        }

        const dropped = [];
        for (const rid of Object.keys(this.index.cache)) {
            if (pending.has(rid)) continue;
            if (!objects.has(rid)) {
                await this._dropCached(rid);
                dropped.push(rid);
            }
        }
        await this._saveIndex();
        this.reconciled = true;
        this.log('Avatar sync for ' + this.account + ' (' + reason + '): ' + objects.size + ' on the server, '
            + Object.keys(this.index.cache).length + ' cached, ' + missing.length + ' missing, '
            + dropped.length + ' dropped');
        if (dropped.length) this._changed(dropped);
        if (missing.length) this._refetch(missing.length + ' picture' + (missing.length === 1 ? '' : 's') + ' missing');

        // Nothing on the server: the picture set here is pushed.
        const push = [];
        for (const [rid, lid] of localPics) {
            if (!objects.has(rid)) push.push(lid);
        }
        if (push.length) {
            for (const lid of push) this.index.local[lid].pending = true;
            await this._saveIndex();
            this.log('Uploading ' + push.length + ' pictures set on this device for contacts of '
                + this.account + ' that have none on the server');
            for (const lid of push) await this._upload(lid, 'set on this device, none on the server', gen);
        }
        if (conflicts.length) {
            this.log(conflicts.length + ' contacts of ' + this.account
                + ' have a picture both on the server and on this device, asking which to keep');
            this._askConflicts(conflicts.map((rid) => [rid, localPics.get(rid)]), gen);
        } else if (!this.asking && !missing.some((rid) => localPics.has(rid))) {
            await this._firstSyncFinished();
        }
    }

    _firstDoneFor(entry) {
        return entry && entry.source === 'phonebook' ? this.phonebookFirstDone : this.firstSyncDone;
    }

    get phonebookFirstDone() { return !!(this.index.state && this.index.state.phonebook_first_done); }

    // A phonebook photo, once handled (uploaded, or the server copy kept in
    // the choice, or refused for size), is not taken in again until it
    // changes.
    _phonebookHandled(lid, local) {
        if (!local || local.source !== 'phonebook' || !local.srcHash) return;
        const pb = Object.assign({}, (this.index.state && this.index.state.phonebook) || {});
        pb[lid] = local.srcHash;
        this.index.state = Object.assign({}, this.index.state, { phonebook: pb });
    }

    /*
     * Take the phone's address book photos into the index as pictures of
     * this device: each contact on the server with a readable photo, no
     * picture set in the editor, and a photo version not handled before.
     * Each photo is read once per run; only a new version is encoded.
     */
    async _phonebookPass(contactIds, gen) {
        if (typeof this.hooks.readPhoto !== 'function' || typeof this.hooks.encodePhoto !== 'function') return 0;
        if (!this._phonebookReady()) return 0;
        const handled = (this.index.state && this.index.state.phonebook) || {};
        let taken = 0;
        let failed = 0;
        for (const c of this._contacts()) {
            if (gen !== this._gen) return taken;
            if (!c || !c.id || !c.remote_id || !readablePhoto(c.photo)) continue;
            const lid = String(c.id);
            const rid = String(c.remote_id);
            if (!validName(rid) || !contactIds.has(rid)) continue;
            if (c.uri && String(c.uri).toLowerCase() === this.account) continue;   // own avatar: not decided
            const existing = this.index.local[lid];
            if (existing && existing.source !== 'phonebook') continue;   // set in the editor, or a removal
            if (existing && existing.pending) continue;
            if (this.phonebookSeen.get(lid) === c.photo) continue;
            this.phonebookSeen.set(lid, c.photo);
            let raw = null;
            try {
                raw = await this.hooks.readPhoto(c.photo);
            } catch (e) {
                raw = null;
            }
            if (!raw) { failed += 1; continue; }
            const hash = sourceHash(raw);
            if (handled[lid] === hash || (existing && existing.srcHash === hash)) continue;
            let jpeg = null;
            try {
                jpeg = this.hooks.encodePhoto(raw);
            } catch (e) {
                jpeg = null;
            }
            if (!jpeg) { failed += 1; continue; }
            const name = 'phonebook-' + safeFileName(lid) + '-' + this._now() + '.jpg';
            await this.fs.mkdirp(this.dir);
            await this.fs.writeBase64(this._path(name), jpeg);
            if (existing && existing.file) await this._unlink(existing.file);
            this.index.local[lid] = { file: name, userSet: true, source: 'phonebook', srcHash: hash,
                                      pending: false, setAt: this._now() };
            taken += 1;
            // let the UI breathe between encodes
            await new Promise((resolve) => this._setTimeout(resolve, 0));
        }
        if (taken || failed) {
            await this._saveIndex();
            this.log('Phonebook photos for ' + this.account + ': ' + taken + ' taken in'
                + (failed ? ', ' + failed + ' unreadable' : ''));
        }
        return taken;
    }

    // The user chose or removed a picture in the editor: the phonebook photo
    // as it is now must not override that. A later change to it does.
    async _recordPhonebookVersion(lid, uri) {
        if (!readablePhoto(uri) || typeof this.hooks.readPhoto !== 'function') return;
        let raw = null;
        try { raw = await this.hooks.readPhoto(uri); } catch (e) { raw = null; }
        if (!raw) return;
        const pb = Object.assign({}, (this.index.state && this.index.state.phonebook) || {});
        pb[lid] = sourceHash(raw);
        this.index.state = Object.assign({}, this.index.state, { phonebook: pb });
        this.phonebookSeen.set(lid, uri);
    }

    _phonebookReady() {
        if (typeof this.hooks.phonebookReady !== 'function') return true;
        try { return !!this.hooks.phonebookReady(); } catch (e) { return true; }
    }

    // The phone's address book was (re)read: look at its photos again.
    phonebookChanged() {
        if (!this.enabled || !this.loaded || !this.lastServerContacts) return Promise.resolve();
        return this.reconcile(this.lastServerContacts, 'phonebook photos');
    }

    // Whether this device has been through its first avatar sync with the
    // account: the server state read and the choice, if any, confirmed.
    get firstSyncDone() { return !!(this.index.state && this.index.state.first_sync_done); }

    // Both markers: the editor's, and the phonebook's once the phonebook
    // has been read (or cannot be).
    async _firstSyncFinished() {
        const state = Object.assign({}, this.index.state);
        let changed = false;
        if (!state.first_sync_done) {
            state.first_sync_done = this._now();
            changed = true;
            this.log('First avatar sync of ' + this.account + ' done: from now on a picture set here '
                + 'replaces the server one, nobody is asked');
        }
        if (!state.phonebook_first_done && this._phonebookReady()) {
            state.phonebook_first_done = this._now();
            changed = true;
            this.log('First phonebook photo sync of ' + this.account + ' done: from now on a changed '
                + 'phonebook photo replaces the server one, nobody is asked');
        }
        if (!changed) return;
        this.index.state = state;
        await this._saveIndex();
    }

    // --- the choice -------------------------------------------------------

    _askConflicts(conflicts, gen) {
        if (this.asking || gen !== this._gen) return;
        if (typeof this.hooks.askConflicts !== 'function') return;
        const canAsk = typeof this.hooks.canAsk === 'function' ? !!this.hooks.canAsk() : true;
        if (!canAsk) {
            // Another modal is up: ask once it is gone.
            if (this._askTimer) this._clearTimeout(this._askTimer);
            this._askTimer = this._setTimeout(() => { this._askTimer = null; this._askConflicts(conflicts, gen); }, ASK_RETRY_DELAY);
            return;
        }
        const byLocal = new Map(this._contacts().map((c) => [String(c.id), c]));
        const items = [];
        for (const [rid, lid] of conflicts) {
            const contact = byLocal.get(String(lid));
            const cached = this.index.cache[rid];
            const local = this.index.local[lid];
            if (!contact || !cached || !local || !local.file || local.pending) continue;
            const serverTime = cached.modified || 0;
            const localTime = local.setAt || 0;
            items.push({
                contactId: rid,
                localId: lid,
                name: contact.name || contact.uri || rid,
                detail: contact.uri || '',
                serverPhoto: this._fileUri(cached.file),
                serverDevice: deviceLabel(cached.device_id, this.deviceId),
                serverTime: serverTime || null,
                localPhoto: this._fileUri(local.file),
                localTime: localTime || null,
                localSource: local.source === 'phonebook' ? 'phonebook' : 'editor',
                default: localTime && localTime > serverTime ? 'local' : 'server',
            });
        }
        if (!items.length) {
            this._serial(() => this._firstSyncFinished());
            return;
        }
        items.sort((a, b) => String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()));
        this.asking = true;
        return Promise.resolve()
            .then(() => this.hooks.askConflicts(items))
            .then((choice) => this._serial(() => this._applyChoice(items, choice || {}, gen)))
            .catch((e) => this.log('Choice failed: ' + (e && e.message)))
            .then(() => { this.asking = false; });
    }

    async _applyChoice(items, choice, gen) {
        if (gen !== this._gen) return;
        let server = 0;
        let local = 0;
        const changed = [];
        for (const item of items) {
            const side = choice[item.contactId];
            if (side !== 'server' && side !== 'local') continue;
            const e = this.index.local[item.localId];
            if (!e) continue;
            if (side === 'server') {
                this._phonebookHandled(item.localId, e);
                await this._unlink(e.file);
                delete this.index.local[item.localId];
                server += 1;
            } else {
                // The local picture replaces the server one for every device;
                // shown from the local file until the upload is done.
                e.pending = true;
                local += 1;
            }
            changed.push(item.contactId);
        }
        await this._saveIndex();
        this.log('Pictures chosen for ' + items.length + ' contacts of ' + this.account + ': '
            + server + ' kept from the server, ' + local + ' from this device');
        await this._firstSyncFinished();
        this._changed(changed);
        for (const item of items) {
            if (choice[item.contactId] === 'local') await this._upload(item.localId, 'kept over the server picture', gen);
        }
    }

    // --- live sync --------------------------------------------------------

    /*
     * application/sylk-storage-changed: never shown, stored or counted.
     * Changes made through the addressbook already reached us as an
     * 'avatars' event; this matters for those made over HTTP (Blink).
     */
    handleChanged(content, account) {
        const data = parseStorageChanged(content);
        if (!data) { this.log('Cannot parse a storage change'); return; }
        if (data.namespace !== AVATARS_NAMESPACE) return;
        if (data.device_id && this.deviceId && String(data.device_id) === this.deviceId) return;
        if (!this.enabled || !this.loaded) return;
        if (account && String(account).toLowerCase() !== this.account) return;
        const id = data.id;
        if (!validName(id)) return;
        const gen = this._gen;
        this._serial(async () => {
            if (gen !== this._gen) return;
            const cached = this.index.cache[id];
            if (data.op === 'put') {
                if (cached && cached.etag === data.etag) return;
                this.log('Avatar ' + id + ' replaced on ' + deviceLabel(data.device_id, this.deviceId).toLowerCase());
                // The data comes with the addressbook: fetch it (jittered and
                // throttled with the addressbook-update fetches).
                this._refetch('avatar ' + id + ' changed elsewhere', true);
            } else {
                const { lidOf } = this._ids();
                const local = lidOf.get(id) ? this.index.local[lidOf.get(id)] : null;
                if (local && local.pending) return;
                this.log('Avatar ' + id + ' deleted on ' + deviceLabel(data.device_id, this.deviceId).toLowerCase());
                if (await this._dropCached(id)) {
                    await this._saveIndex();
                    this._changed([id]);
                }
            }
        });
    }

    // --- writing ----------------------------------------------------------

    /*
     * The user chose a picture in the contact editor. `jpegBase64` is the
     * encoded 96x96 avatar. Kept locally and marked pending so it shows at
     * once and survives a failed upload; uploaded right away when the
     * contact already has a server id, else on the next retry.
     */
    setPicture(contact, jpegBase64) {
        if (!contact || !contact.id || !this.loaded || !jpegBase64) return Promise.resolve(false);
        const gen = this._gen;
        return this._serial(async () => {
            if (gen !== this._gen) return false;
            const lid = String(contact.id);
            const name = 'local-' + safeFileName(lid) + '-' + this._now() + '.jpg';
            await this.fs.mkdirp(this.dir);
            await this.fs.writeBase64(this._path(name), jpegBase64);
            const old = this.index.local[lid];
            if (old && old.file) await this._unlink(old.file);
            await this._recordPhonebookVersion(lid, contact.photo);
            this.index.local[lid] = { file: name, userSet: true, pending: this.enabled, setAt: this._now() };
            await this._saveIndex();
            this._changed([contact.remote_id || lid]);
            if (this.enabled) {
                await this._upload(lid, 'set in the contact editor', gen);
            } else {
                this.log('Picture of ' + this._describe(lid, contact.remote_id) + ' kept on this device (no account storage)');
            }
            return true;
        });
    }

    /*
     * The user cleared the picture in the editor: the local file goes, the
     * cache entry goes at once, and the stored object is removed -- pending
     * until the server confirms.
     */
    clearPicture(contact) {
        if (!contact || !contact.id || !this.loaded) return Promise.resolve(false);
        const gen = this._gen;
        return this._serial(async () => {
            if (gen !== this._gen) return false;
            const lid = String(contact.id);
            const rid = contact.remote_id && validName(String(contact.remote_id)) ? String(contact.remote_id) : null;
            const old = this.index.local[lid];
            if (old && old.file) await this._unlink(old.file);
            delete this.index.local[lid];
            if (rid) await this._dropCached(rid);
            // Removing the picture must not bring the phonebook photo back on
            // the next pass: that version counts as handled.
            if (old && old.source === 'phonebook') this._phonebookHandled(lid, old);
            else await this._recordPhonebookVersion(lid, contact.photo);
            if (this.enabled && rid) this.index.local[lid] = { deletePending: true, remoteId: rid };
            await this._saveIndex();
            this.log('Picture of ' + this._describe(lid, rid) + ' removed in the contact editor');
            this._changed([rid || lid]);
            if (this.enabled && rid) await this._remove(rid, lid, gen);
            return true;
        });
    }

    async _send(rid, avatar) {
        if (typeof this.hooks.sendAvatar !== 'function') return false;
        try {
            return !!(await this.hooks.sendAvatar(rid, avatar));
        } catch (e) {
            this.log('Cannot send the avatar of ' + rid + ': ' + (e && e.message ? e.message : e));
            return false;
        }
    }

    _awaitingFresh(rid) {
        const w = this.awaiting.get(rid);
        if (!w) return false;
        if (this._now() - w.at < ECHO_TIMEOUT) return true;
        this.awaiting.delete(rid);   // no echo: retried like any other
        return false;
    }

    async _upload(lid, reason, gen) {
        if (gen !== this._gen || !this.enabled) return;
        const e = this.index.local[lid];
        if (!e || !e.pending || !e.file) return;
        const { ridOf } = this._ids();
        const rid = ridOf.get(lid) || null;
        if (!rid || !validName(rid)) return;   // not on the server yet: retried later
        if (this._awaitingFresh(rid)) return;
        let data;
        try {
            data = await this.fs.readBase64(this._path(e.file));
        } catch (err) {
            this.log('Picture of ' + this._describe(lid, rid) + ' is gone from this device: ' + (err && err.message));
            delete this.index.local[lid];
            await this._saveIndex();
            return;
        }
        this.awaiting.set(rid, { lid, kind: 'put', file: e.file, reason, at: this._now() });
        const sent = await this._send(rid, { data, content_type: AVATAR_CONTENT_TYPE, device_id: this.deviceId });
        if (!sent) {
            this.awaiting.delete(rid);
            this.log('Upload of the picture of ' + this._describe(lid, rid) + ' postponed (' + reason
                + '): not sent, retried later');
        }
    }

    async _remove(rid, lid, gen) {
        if (gen !== this._gen || !this.enabled || !validName(rid)) return;
        if (this._awaitingFresh(rid)) return;
        this.awaiting.set(rid, { lid, kind: 'remove', at: this._now(), reason: 'removed' });
        const sent = await this._send(rid, { remove: true, device_id: this.deviceId });
        if (!sent) {
            this.awaiting.delete(rid);
            this.log('Cannot delete avatar ' + rid + ' now, retried later');
        }
    }

    upload(lid, reason) {
        const gen = this._gen;
        return this._serial(() => this._upload(String(lid), reason || 'retry', gen));
    }

    retryPending() {
        if (!this.enabled || !this.loaded) return Promise.resolve();
        const gen = this._gen;
        return this._serial(async () => {
            for (const [lid, e] of Object.entries(this.index.local)) {
                if (gen !== this._gen) return;
                if (!e) continue;
                if (e.pending) await this._upload(lid, 'retry', gen);
                else if (e.deletePending && e.remoteId) await this._remove(e.remoteId, lid, gen);
            }
        });
    }

    // The server removed a contact (and its picture): forget it here too.
    expunge(remoteId, localId) {
        if (!this.loaded) return Promise.resolve();
        const gen = this._gen;
        return this._serial(async () => {
            if (gen !== this._gen) return;
            let dirty = false;
            const lid = localId ? String(localId) : null;
            if (lid && this.index.local[lid]) {
                await this._unlink(this.index.local[lid].file);
                delete this.index.local[lid];
                dirty = true;
            }
            const rid = remoteId ? String(remoteId) : null;
            if (rid && await this._dropCached(rid)) dirty = true;
            if (dirty) {
                await this._saveIndex();
                this._changed([rid || lid]);
            }
        });
    }
}

module.exports = {
    STORAGE_CHANGED_CONTENT_TYPE,
    API_TOKEN_CONTENT_TYPE,
    AVATARS_NAMESPACE,
    AVATAR_CONTENT_TYPE,
    PENDING_RETRY_INTERVAL,
    validName,
    parseStorageChanged,
    isControlType,
    deviceLabel,
    AvatarStore,
};
