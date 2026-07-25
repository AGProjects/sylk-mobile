// Inlined replacement for the dead react-native-gravatar package
// (2026-07-22). Pure JS, no native code: builds the Gravatar avatar URL
// (MD5 of the lower-cased/trimmed email, per the Gravatar spec) with the
// crypto-js already shipped in the app — the exact same hex MD5 the old
// lib's `gravatar-api` produced via blueimp-md5, so avatar URLs (and thus
// the CDN cache) are byte-identical. Wraps it in the same <Image> the old
// lib exported.
//
// The old package also exported `GravatarApi` (the raw `gravatar-api`
// module). It's imported in two call sites (EditContactModal, NavigationBar)
// but never actually called, so a minimal compatible object is re-exported
// to keep those named imports valid without touching them.
//
// Used by: EditContactModal.js, NavigationBar.js, ContactCard.js.
import React from 'react';
import { Image } from 'react-native';
import CryptoJS from 'crypto-js';

// Replicates querystring.stringify(parameters) for the small, flat option
// objects the app passes ({ size, d }). Preserves key order and URL-encodes.
const buildQueryString = (parameters) => {
    if (!parameters) {
        return '';
    }
    const parts = Object.keys(parameters)
        .filter((k) => parameters[k] !== undefined && parameters[k] !== null)
        .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(parameters[k]));
    return parts.length ? '?' + parts.join('&') : '';
};

// Same output as gravatar-api's imageUrl(): base + md5(email) + query.
const imageUrl = (options = {}) => {
    const email = (options.email || '').toLowerCase().trim();
    const hash = CryptoJS.MD5(email).toString();
    const baseUrl = options.secure
        ? 'https://secure.gravatar.com/avatar/'
        : 'http://www.gravatar.com/avatar/';
    return baseUrl + hash + buildQueryString(options.parameters);
};

// Compatibility stub for the old `GravatarApi` named export.
const GravatarApi = { imageUrl };

// Same render output as the old lib: an <Image> with the default 50x50
// style merged with the caller's style, sourced from the gravatar URL.
const Gravatar = ({ options, style }) => (
    <Image
        style={[{ width: 50, height: 50 }, style]}
        source={{ uri: imageUrl(options) }}
    />
);

export { Gravatar, GravatarApi };
