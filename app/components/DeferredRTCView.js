import React from 'react';
import { RTCView } from 'react-native-webrtc';

// DeferredRTCView
// ----------------
// A drop-in replacement for react-native-webrtc's <RTCView> that NEVER
// carries a streamURL on its very first render. It mounts the underlying
// native view with streamURL=null, then applies the real streamURL on the
// next tick (a separate UIManager batch).
//
// Why this exists:
// When an RTCView is created with a non-null streamURL in the same native
// createView batch, react-native-webrtc's RTCVideoViewManager.setStreamURL
// calls WebRTCModule.getStreamForReactTag() synchronously ON THE UI THREAD
// while that thread holds the NativeViewHierarchyManager monitor. That call
// blocks on a FutureTask waiting for the single WebRTC executor; meanwhile
// the RN "mqt_native_modules" thread is blocked waiting for the very same
// NativeViewHierarchyManager monitor. The result is a circular wait that
// freezes the UI thread for >5s and produces an "Input dispatching timed
// out" ANR — reproducible whenever a video call is answered and the call
// surface mounts its RTCViews.
//
// Deferring the streamURL to the next tick guarantees createView has already
// committed (and released the view-hierarchy lock) before the stream lookup
// runs, so the lookup can never deadlock against the mount. This pairs with
// patches/react-native-webrtc+124.0.7.patch, which additionally bounds the
// native getStreamForReactTag() wait so no code path can hang the UI thread.
//
// All props are forwarded unchanged, including `ref` (forwarded to the
// underlying RTCView) and `key`.
class DeferredRTCViewInner extends React.Component {
    constructor(props) {
        super(props);
        this.state = { ready: false };
        this._timer = null;
    }

    componentDidMount() {
        // setTimeout(0) — not requestAnimationFrame — so the streamURL is
        // applied in a subsequent JS->native UIManager batch, after this
        // view's createView has been flushed.
        this._timer = setTimeout(() => {
            this._timer = null;
            this.setState({ ready: true });
        }, 0);
    }

    componentWillUnmount() {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    }

    render() {
        const { streamURL, forwardedRef, ...rest } = this.props;
        return (
            <RTCView
                {...rest}
                ref={forwardedRef}
                streamURL={this.state.ready ? (streamURL || null) : null}
            />
        );
    }
}

const DeferredRTCView = React.forwardRef((props, ref) => (
    <DeferredRTCViewInner {...props} forwardedRef={ref} />
));

DeferredRTCView.displayName = 'DeferredRTCView';

export default DeferredRTCView;
