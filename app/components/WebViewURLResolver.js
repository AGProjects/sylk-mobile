import React, { Component } from 'react';
import { View } from 'react-native';
import PropTypes from 'prop-types';
import utils from '../utils';

// Headless URL resolver. Loads a URL in a hidden WebView, watches
// navigation, and reports the FIRST destination URL the page tries to
// navigate to. Used as a fallback when plain `fetch()` can't follow a
// JavaScript-driven redirect — most notably Google's
// `maps.app.goo.gl/<id>` Firebase Dynamic Links, which serve a JS
// bootstrap page (`boq-devplatform.DurableDeepLinkUi`) that decodes a
// protobuf payload at runtime to compute the destination, with the
// redirect target nowhere in the static HTML.
//
// The component is mounted only while a resolution is in flight: the
// parent toggles `url` to a string when it wants to resolve, then sets
// it back to null on completion. The hidden View wraps the WebView in
// a 0x0 box positioned far off-screen so layout is untouched and the
// content never paints.
//
// Props:
//   url            — the short URL to load. null = idle.
//   onResolved     — (finalUrl: string) => void. Called once with the
//                    first non-idle, non-data URL the page navigates
//                    to. After this fires the parent should null `url`
//                    so the WebView unmounts.
//   onError        — (err: Error) => void. Called on load error.
//   timeoutMs      — milliseconds before giving up and calling onError
//                    with a timeout. Default 8000.
//
// Why we capture via onShouldStartLoadWithRequest rather than
// onNavigationStateChange: the request hook fires BEFORE the
// destination URL is loaded, lets us block the actual navigation
// (return false) so the WebView never bothers downloading the
// canonical page — we only need the URL string. nav-state-change
// fires after content loads, which would download the full Maps page
// for nothing.
class WebViewURLResolver extends Component {
    constructor(props) {
        super(props);
        this._fired = false;
        this._timer = null;
        this._WebView = null;
        // Last URL the WebView attempted to load — used for the
        // timeout fallback. Some Google Maps share flows (esp.
        // share-by-place-name with `?q=<address>&ftid=<placeId>`)
        // never produce a URL with inline `/@lat,lng` in the
        // WebView context — Google's geocoding redirect happens via
        // a server-side flow that depends on cookies / state we
        // don't carry. On timeout we hand whatever we have back so
        // the caller can geocode the address out of `?q=`.
        this._lastSeenUrl = null;
        // Lazy-require so the rest of the app doesn't pay any startup
        // cost (or fail to mount) when react-native-webview isn't
        // linked yet on a fresh dev install. The require happens once,
        // first time we actually try to resolve.
        try {
            this._WebView = require('react-native-webview').WebView;
        } catch (e) {
            this._WebView = null;
        }
    }

    componentDidMount() {
        this._armTimer();
    }

    componentDidUpdate(prevProps) {
        if (this.props.url && this.props.url !== prevProps.url) {
            // New URL — reset the one-shot guard and re-arm timeout.
            this._fired = false;
            this._armTimer();
        }
        if (!this.props.url && this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    }

    componentWillUnmount() {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    }

    _armTimer() {
        if (this._timer) clearTimeout(this._timer);
        const ms = this.props.timeoutMs || 8000;
        this._timer = setTimeout(() => {
            this._timer = null;
            if (this._fired) return;
            // On timeout, hand whatever URL we last saw back to the
            // caller as a "best-effort" resolution. Even an address-
            // only URL is useful — the caller can geocode it via
            // Nominatim. Only fall through to onError if we never
            // saw any URL at all (genuine network / WebView failure).
            if (this._lastSeenUrl) {
                this._fire(this._lastSeenUrl);
                return;
            }
            this._fired = true;
            if (typeof this.props.onError === 'function') {
                this.props.onError(new Error('webview resolve timeout'));
            }
        }, ms);
    }

    _onShouldStartLoadWithRequest = (request) => {
        const candidate = request && request.url;
        if (!candidate) return true;
        // Skip non-real navigations entirely.
        if (candidate.startsWith('about:')) return true;
        if (candidate.startsWith('data:')) return true;
        if (candidate.startsWith('blob:')) return true;
        if (candidate.startsWith('javascript:')) return true;
        // The original URL load — let it through so the FDL JS can
        // run.
        if (candidate === this.props.url) {
            this._lastSeenUrl = candidate;
            return true;
        }
        // Track every non-trivial candidate URL we see — used by the
        // timeout fallback to hand SOMETHING useful back to the
        // caller even if we never reach a URL with inline coords.
        this._lastSeenUrl = candidate;

        // Try to extract coords from THIS candidate URL. If it has
        // them inline, we're done — capture and block the actual
        // page load (we only need the URL string).
        try {
            const coords = utils.parseSharedLocationUrl(candidate);
            if (coords && !this._fired) {
                this._fire(candidate);
                return false;
            }
        } catch (e) { /* parser never throws, but be defensive */ }

        // No coords yet. Two reasons:
        //   1. Same-host intermediate (FDL JS adding query params,
        //      e.g. maps.app.goo.gl/<id>?_iipp=1) — let it continue
        //      so the JS can produce the real redirect.
        //   2. Cross-host but coordless — e.g.
        //      maps.google.com/?q=<address>&ftid=<placeId> when the
        //      sender shared a place by NAME. Google's JS will
        //      geocode the address and redirect to a /maps/place/
        //      URL with @<lat>,<lng>; we want that next navigation,
        //      not this intermediate one. Allowing the load means
        //      the WebView actually downloads the page (~250 KB)
        //      so Google's JS can fire the further redirect — the
        //      cost of being patient.
        return true;
    };

    // Fires every time the WebView's URL changes — including the
    // post-load redirects after a page actually finishes loading.
    // Crucial for the address-only flow: the navigation that
    // produces /maps/place/<name>/@<lat>,<lng>/... happens after
    // Google's geocoding JS runs, which is after the search-page
    // load completes; that lands here, not in
    // onShouldStartLoadWithRequest.
    _onNavigationStateChange = (navState) => {
        if (this._fired) return;
        const url = navState && navState.url;
        if (!url) return;
        // Track every URL change for the timeout fallback.
        this._lastSeenUrl = url;
        try {
            const coords = utils.parseSharedLocationUrl(url);
            if (coords) {
                this._fire(url);
            }
        } catch (e) { /* never throw from a nav callback */ }
    };

    // One-shot resolver fire. Clears timer and calls onResolved with
    // the captured URL (caller re-parses to get coords). Idempotent.
    _fire(url) {
        if (this._fired) return;
        this._fired = true;
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        if (typeof this.props.onResolved === 'function') {
            this.props.onResolved(url);
        }
    }

    // Extract the host portion of a URL using a simple regex (RN
    // doesn't ship a URL parser by default in older bundles, and a
    // permissive regex avoids any try/catch chaos around bad inputs).
    _extractHost = (url) => {
        if (!url || typeof url !== 'string') return null;
        const m = url.match(/^https?:\/\/([^/?#]+)/i);
        return m ? m[1].toLowerCase() : null;
    };

    _onError = (e) => {
        if (this._fired) return;
        this._fired = true;
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        const err = (e && e.nativeEvent && e.nativeEvent.description)
            ? new Error(e.nativeEvent.description)
            : new Error('webview load error');
        if (typeof this.props.onError === 'function') {
            this.props.onError(err);
        }
    };

    render() {
        const {url} = this.props;
        if (!url) return null;
        const WebView = this._WebView;
        if (!WebView) {
            // react-native-webview not linked / installed. Fail soft.
            // Defer the onError callback to AFTER render — calling
            // setState (which the parent's onError handler will do)
            // synchronously inside render() throws "Cannot update
            // during an existing state transition". setTimeout 0
            // pushes the error into a fresh task tick when render is
            // already done.
            if (!this._fired) {
                this._fired = true;
                setTimeout(() => {
                    if (typeof this.props.onError === 'function') {
                        this.props.onError(new Error('react-native-webview not available'));
                    }
                }, 0);
            }
            return null;
        }
        return (
            // Off-screen 0x0 wrapper so layout is unaffected. Negative
            // top/left guards against any platform-specific quirk where
            // a 0x0 view would still receive a frame.
            <View
                pointerEvents="none"
                style={{
                    position: 'absolute',
                    width: 0,
                    height: 0,
                    top: -1000,
                    left: -1000,
                    opacity: 0,
                }}
            >
                <WebView
                    source={{uri: url}}
                    javaScriptEnabled={true}
                    domStorageEnabled={true}
                    cacheEnabled={true}
                    onShouldStartLoadWithRequest={this._onShouldStartLoadWithRequest}
                    onNavigationStateChange={this._onNavigationStateChange}
                    onError={this._onError}
                    onHttpError={this._onError}
                    // Suppress visible loading UI — there's nothing to
                    // see anyway since the WebView is 0x0.
                    startInLoadingState={false}
                    // Keep the WebView lightweight: no media playback,
                    // no zoom controls, no pull-to-refresh.
                    mediaPlaybackRequiresUserAction={true}
                    allowsBackForwardNavigationGestures={false}
                    // Set a desktop UA — same reason as the fetch path:
                    // Google's mobile share endpoint serves a different
                    // (more deeply-cloaked) response for mobile UAs.
                    userAgent={
                        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                        + 'AppleWebKit/537.36 (KHTML, like Gecko) '
                        + 'Chrome/120.0.0.0 Safari/537.36'
                    }
                />
            </View>
        );
    }
}

WebViewURLResolver.propTypes = {
    url       : PropTypes.string,
    onResolved: PropTypes.func,
    onError   : PropTypes.func,
    timeoutMs : PropTypes.number,
};

export default WebViewURLResolver;
