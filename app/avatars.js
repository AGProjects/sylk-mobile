/*
 * avatars.js
 *
 * The app-wide contact avatar store (accountStorage.AvatarStore) bound to
 * React Native (RNFS for the cache). Views read it through avatarPhotoFor()
 * / useAvatarVersion(); app.js owns the account, the addressbook transport
 * and the sync triggers.
 *
 * Spec: Blink docs/CONTACT-AVATARS.md.
 */

import { useEffect, useState } from 'react';
import { AvatarStore } from './accountStorage';

const RNFS = require('react-native-fs');

const fsAdapter = {
    exists: (p) => RNFS.exists(p),
    readUtf8: (p) => RNFS.readFile(p, 'utf8'),
    readBase64: (p) => RNFS.readFile(p, 'base64'),
    writeUtf8: (p, text) => RNFS.writeFile(p, text, 'utf8'),
    writeBase64: (p, b64) => RNFS.writeFile(p, b64, 'base64'),
    mkdirp: (p) => RNFS.mkdir(p),
    unlink: (p) => RNFS.unlink(p),
    move: (a, b) => RNFS.moveFile(a, b),
    copy: (a, b) => RNFS.copyFile(a, b),
};

const store = new AvatarStore({
    fs: fsAdapter,
    rootDir: RNFS.DocumentDirectoryPath + '/account_storage',
});

// identity -> the contact row it stands for. Set by app.js, which owns the
// contact index; a view may hold a call identity or a conversation header
// that only carries a uri.
let contactResolver = null;

export function setContactResolver(fn) {
    contactResolver = typeof fn === 'function' ? fn : null;
}

export function getAvatarStore() {
    return store;
}

function resolve(identity) {
    if (!identity) return null;
    if (!contactResolver) return identity;
    try {
        return contactResolver(identity) || identity;
    } catch (e) {
        return identity;
    }
}

// The avatar of a contact or identity as a file:// uri, or null: the caller
// then falls back to identity.photo, then the initials.
export function avatarPhotoFor(identity) {
    return store.photoFor(resolve(identity));
}

export function avatarInfoFor(identity) {
    return store.info(resolve(identity));
}

// Re-render on any avatar change.
export function useAvatarVersion() {
    const [version, setVersion] = useState(store.version);
    useEffect(() => store.subscribe((ids, v) => setVersion(v)), []);
    return version;
}

export default store;
