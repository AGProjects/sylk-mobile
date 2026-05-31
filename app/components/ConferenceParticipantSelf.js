import React, { Component } from 'react';
import { View, Platform, Text, TouchableOpacity, Dimensions } from   'react-native';
import PropTypes from 'prop-types';
//const hark              = require('hark');
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';
import { RTCView } from 'react-native-webrtc';
import { Surface } from 'react-native-paper';
import LinearGradient from 'react-native-linear-gradient';
import { StyleSheet } from 'react-native';
import { Tooltip } from 'react-native-elements';

const styles = StyleSheet.create({
  container: {
    // Fill the floating-PIP wrapper (120 × 160 in ConferenceBox).
    // No backgroundColor / no elevation — the parent wrapper
    // already supplies them. Adding a bg here on Android could
    // hide the wrapper's painting AND conflict with the
    // SurfaceView the RTCView uses.
    flex: 1,
    width: '100%',
    height: '100%',
    borderWidth: 0,
	zIndex: 1000,

  },

  // Default "big" container style — used in 'cover' mode. Pinned
  // edge-to-edge via absolute positioning rather than flex:1 +
  // width/height:100%, which can confuse Paper's Surface (it adds
  // shadow padding/elevation maths around the flex box and the
  // resulting "view boundaries" leave a strip of black around the
  // video instead of a true full-screen fill). With explicit top/
  // bottom/left/right:0 the Surface really does cover the parent.
  containerBig: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderWidth: 0,
    borderColor: 'orange',
	zIndex: 1000,
  },

  // Wrapper used in big + 'contain' mode. Surface is sized to the
  // camera's intrinsic aspect ratio and CENTRED inside this flex
  // box. RTCView inside uses objectFit='cover' so the video fills
  // the (now-resized) Surface with no letterbox bars — which is
  // what "scale up the image to fill up the view" means in
  // practice.
  bigContainAR: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },

  video: {
    width: '100%',
    height: '100%',
  },

  // Legacy mute-icon style — no longer used. The mute indicator is
  // now rendered INLINE with the "Myself" gradient label (see
  // render() — both share one row at the bottom of the Surface).
  // Kept here as an empty style so any external reference to
  // styles.muteIcon doesn't crash; the new placement is handled
  // directly in the render method.
  muteIcon: {},

  icon: {
    marginLeft: 'auto',
    marginRight: 'auto',
  },

  // Camera-swap button overlay (top-right of the Surface). Lives
  // INSIDE the Surface so wherever this component renders (solo
  // fullscreen, in-matrix self tile, small PIP) the swap affordance
  // follows the preview.
  //
  // top: 80 — pushes the icon below the conferenceHeader navbar
  // (60 dp tall, zIndex 2000) which would otherwise sit on top of
  // the icon and swallow its taps. The icon needs to be HIGHER
  // zIndex than the navbar would still not help — it's positioned
  // INSIDE the self-view wrapper whose zIndex (1000) lives below
  // the navbar's, and lifting the icon above 2000 would also lift
  // it above the conference action bar / Speedometer etc. Easier
  // and more robust to just place it where the navbar isn't.
  // BIG mode — full self preview (solo fullscreen or in-matrix).
  // Larger circular pill with comfortable inset. Swap at top-RIGHT.
  // The close X sits at BOTTOM-right in big mode (replacing the
  // grid icon when grid mode is active).
  swapButtonWrapperBig: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 9999,
    elevation: 24,
  },
  swapButtonBig: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // SMALL (thumbnail) — corner-hug style with only the inside
  // corner rounded, mirroring the audio-mode mute glyph.
  swapButtonWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 9999,
    elevation: 24,
  },
  swapButton: {
    width: 20,
    height: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderBottomRightRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Aspect-ratio toggle button — mirrors the swap-cameras layout but
  // anchors to the BOTTOM-RIGHT of the same video box. zIndex /
  // elevation match the swap button so it sits above every other
  // conference surface.
  arButtonWrapper: {
    position: 'absolute',
    // bottom: 10 aligns the icon's bottom edge with the "Myself"
    // gradient label's text baseline (the label sits at bottom:0
    // with paddingBottom:10, so its text bottom is ~10 dp above
    // the video edge). The aspect-ratio icon therefore shares the
    // same horizontal strip as the Myself label, just on the
    // right.
    bottom: 10,
    right: 12,
    zIndex: 9999,
    elevation: 24,
  },
  arButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // SMALL (thumbnail) — corner-hug grid icon: 0 inset, only the
  // top-left corner rounded (mirrors swap/close audio-style).
  gridButtonWrapper: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    zIndex: 9999,
    elevation: 24,
  },
  gridButton: {
    width: 20,
    height: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderTopLeftRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // BIG mode — comfortable inset + larger circular pill (matches
  // swapButtonBig). Sits at bottom-right of the full self preview.
  gridButtonWrapperBig: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    zIndex: 9999,
    elevation: 24,
  },
  gridButtonBig: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // SMALL (thumbnail) — corner-hug X: 0 inset, only the bottom-left
  // corner rounded so it integrates with the corner of the PIP.
  closeButtonWrapper: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 9999,
    elevation: 24,
  },
  closeButton: {
    width: 20,
    height: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderBottomLeftRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // BIG mode — close X at top-right pill.
  closeButtonWrapperBig: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 9999,
    elevation: 24,
  },
  closeButtonBig: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});


class ConferenceParticipantSelf extends Component {
    constructor(props) {
        super(props);
        // Seed videoDims from the live track's getSettings() so the
        // very first render in CONTAIN mode already has a camAR to
        // size the inner camera-AR box. Without this seed, the
        // RTCView's onDimensionsChange has to fire at least once
        // before camAR becomes available, and if the user toggles
        // to contain mode before that round-trip lands, the
        // contain branch silently falls back to cover (camAR null).
        // That was the "I see no purple border in mode B" symptom.
        let _seedDims = null;
        try {
            const _s = props.stream;
            const _vt = _s && _s.getVideoTracks ? _s.getVideoTracks()[0] : null;
            const _settings = _vt && typeof _vt.getSettings === 'function'
                ? _vt.getSettings() : null;
            if (_settings && _settings.width && _settings.height) {
                _seedDims = { width: _settings.width, height: _settings.height };
            }
        } catch (e) { /* best effort */ }

        this.state = {
            active: false,
            hasVideo: false,
            sharesScreen: false,
            isLandscape: props.isLandscape,
            visible: props.visible,
            // Intrinsic dimensions of the local camera frame. Seeded
            // from track.getSettings() above; refreshed by
            // RTCView.onDimensionsChange whenever the resolution
            // changes (camera swap, renegotiation).
            videoDims: _seedDims,
            // Measured size of the yellow big-mode wrapper, captured
            // via onLayout. Used to size the contain-mode inner box
            // so it fits inside yellow (which is smaller than
            // Dimensions.window on devices where the conference's
            // SafeAreaView ancestor shrinks the available area).
            wrapperLayout: null,
        }
        // this.speechEvents = null;
    }

    _onWrapperLayout = (event) => {
        const ne = event && event.nativeEvent;
        const layout = ne && ne.layout;
        if (!layout || !layout.width || !layout.height) return;
        const prev = this.state.wrapperLayout;
        if (prev && prev.width === layout.width && prev.height === layout.height) return;
        this.setState({ wrapperLayout: { width: layout.width, height: layout.height } });
    };

    componentDidMount() {
        // factor it out to a function to avoid lint warning about calling setState here
        this.attachSpeechEvents();
        // this.refs.videoElement.onresize = (event) => {
        //     this.handleResize(event)
        // };
    }

    handleResize(event) {
        const resolutions = [ '1280x720', '960x540', '640x480', '640x360', '480x270','320x180'];
        const videoResolution = event.target.videoWidth + 'x' + event.target.videoHeight;
        if (resolutions.indexOf(videoResolution) === -1) {
            this.setState({sharesScreen: true});
        } else {
            this.setState({sharesScreen: false});
        }
    }

    /** Hooked to RTCView.onDimensionsChange. Captures the intrinsic
     *  width/height of the local camera frame the first time the
     *  native side reports it, and again any time it changes (camera
     *  swap, resolution renegotiation). The values are used in
     *  render() to size the Surface to the camera's aspect ratio
     *  when aspectRatio === 'contain' so the video fills the view
     *  edge-to-edge instead of letterboxing inside a fullscreen box. */
    _onVideoDimensions = (event) => {
        const ne = event && event.nativeEvent;
        if (!ne || !ne.width || !ne.height) return;
        const prev = this.state.videoDims;
        if (prev && prev.width === ne.width && prev.height === ne.height) return;
        this.setState({ videoDims: { width: ne.width, height: ne.height } });
    };

    UNSAFE_componentWillReceiveProps(nextProps) {
		this.setState({isLandscape: nextProps.isLandscape,
		               hasVideo: nextProps.hasVideo,
		               active: nextProps.active,
		               visible: nextProps.visible
		});
    }


    componentWillUnmount() {
        // if (this.speechEvents !== null) {
        //     this.speechEvents.stop();
        //     this.speechEvents = null;
        // }
    }

    attachSpeechEvents() {
        this.setState({hasVideo: this.props.stream.getVideoTracks().length > 0});

        // const options = {
        //     interval: 150,
        //     play: false
        // };
        // this.speechEvents = hark(this.props.stream, options);
        // this.speechEvents.on('speaking', () => {
        //     this.setState({active: true});
        // });
        // this.speechEvents.on('stopped_speaking', () => {
        //     this.setState({active: false});
        // });
    }

    render() {
        if (!this.state.visible)  {
			return;
        }

        if (this.props.stream == null) {
            return;
        }

        /*
        const tooltip = (
             <Tooltip id="t-myself">{this.props.identity.displayName || this.props.identity.uri}</Tooltip>
        );
        */

        // The mute-mic glyph used to live in its own absolute-positioned
        // row; it's now inlined with the "Myself" gradient label below so
        // the indicator and the name read as one bottom strip. `muteIcon`
        // is retained as a no-op placeholder so the two render paths
        // (cover and contain) don't need branching.
        const muteIcon = null;

        // Previously this applied translateX: -48 on Android landscape, a
        // magic-number hack to nudge the self-view thumbnail. It was
        // matched only by the old asymmetric corner math in ConferenceBox
        // (left: aRightInset / right: -aRightInset) and only cancelled
        // correctly when rightInset happened to equal 48. With corners
        // now symmetric at 0/0 and the PIP container extended to the
        // screen edges on Android landscape, the shift just pushes every
        // thumbnail 48px to the left of where it belongs.
        let shiftX = 0;
        let shiftY = this.state.isLandscape ? 0 : 0;

        // Camera-swap icon (top-right). zIndex 9999 + elevation 24
        // beats every other surface in the conference (header is
        // 2000, action bar 1500). Default pointerEvents on the
        // wrapper (auto via no prop) so the wrapper itself receives
        // touches and forwards them to its TouchableOpacity child.
        // The earlier `box-only` was the BUG: that mode means the
        // wrapper claims touches and its children do NOT — so the
        // TouchableOpacity inside was unreachable.
        const swapButton = (this.props.onCameraSwap && !this.props.fullScreen) ? (
            <View style={this.props.big ? styles.swapButtonWrapperBig : styles.swapButtonWrapper}>
                <TouchableOpacity
                    onPress={this.props.onCameraSwap}
                    accessibilityRole="button"
                    accessibilityLabel="Swap cameras"
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    style={this.props.big ? styles.swapButtonBig : styles.swapButton}
                    activeOpacity={0.6}
                >
                    <Icon name="camera-switch" size={this.props.big ? 22 : 14} color="#ffffff" />
                </TouchableOpacity>
            </View>
        ) : null;

        // Aspect-ratio toggle — bottom-right counterpart of the swap
        // icon, wired to the parent's toggleAspectRatio via the
        // onAspectRatioToggle prop. Same anchoring strategy as the
        // swap button: renders inside the actual video box so it
        // follows the visible video edge (yellow in cover, purple in
        // contain, the small PIP Surface for non-solo).
        //
        // Hidden in the solo-fullscreen case (user alone in the
        // room) per user request — the aspect-ratio toggle is only
        // useful with other participants on screen for comparison.
        const arButton = (this.props.onAspectRatioToggle && !this.props.isSoloFullscreen) ? (
            <View style={styles.arButtonWrapper}>
                <TouchableOpacity
                    onPress={this.props.onAspectRatioToggle}
                    accessibilityRole="button"
                    accessibilityLabel="Toggle aspect ratio"
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    style={styles.arButton}
                    activeOpacity={0.6}
                >
                    <Icon name="aspect-ratio" size={22} color="#ffffff" />
                </TouchableOpacity>
            </View>
        ) : null;

        // Layout-toggle (grid) icon — bottom-right corner of the
        // small PIP. Only rendered when an onToggleLayout callback
        // is supplied (parent gates this on visibleCount === 3).
        // Hide the grid affordance entirely when the user is alone
        // (isSoloFullscreen) — the 3-up layout doesn't apply to
        // solo, and showing an "exit grid" X here would imply the
        // user could close their own video, which we explicitly
        // don't allow when alone (per earlier requirement).
        const gridButton = (this.props.onToggleLayout && !this.props.isSoloFullscreen) ? (
            <View style={this.props.big ? styles.gridButtonWrapperBig : styles.gridButtonWrapper}>
                <TouchableOpacity
                    onPress={this.props.onToggleLayout}
                    accessibilityRole="button"
                    accessibilityLabel={this.props.threeUpRowLayout ? "Exit grid layout" : "Enter grid layout"}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    style={this.props.big ? styles.gridButtonBig : styles.gridButton}
                    activeOpacity={0.6}
                >
                    {/* Glyph reflects what tapping will SWITCH TO:
                        • In matrix (grid) mode → X means "exit
                          grid, become thumb".
                        • In PIP mode → grid means "return to grid
                          as a normal tile". threeUpRowLayout=true
                          is the PIP state in the current model. */}
                    <Icon
                        name={this.props.threeUpRowLayout ? "grid" : "close"}
                        size={this.props.big ? 22 : 14}
                        color="#ffffff"
                    />
                </TouchableOpacity>
            </View>
        ) : null;

        // Close-mirror (X) button — opposite top corner from the
        // swap-cameras icon. Tapping it sets enableMyVideo=false in
        // the parent, which hides the self-view (re-show via the
        // kebab's "Show mirror" item). Wired through a new onClose
        // prop so the parent stays in control of the state.
        //
        // Hidden entirely when the parent flags `isSoloFullscreen`
        // (user is alone in the room and the self-preview fills the
        // screen). Closing the mirror there would leave a blank black
        // screen, which the user explicitly does not want.
        const closeButton = (this.props.onClose && !this.props.isSoloFullscreen) ? (
            <View style={this.props.big ? styles.closeButtonWrapperBig : styles.closeButtonWrapper}>
                <TouchableOpacity
                    onPress={this.props.onClose}
                    accessibilityRole="button"
                    accessibilityLabel="Close mirror"
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    style={this.props.big ? styles.closeButtonBig : styles.closeButton}
                    activeOpacity={0.6}
                >
                    <Icon name="close" size={this.props.big ? 22 : 14} color="#ffffff" />
                </TouchableOpacity>
            </View>
        ) : null;

        // Bottom-edge "Myself" gradient label — now also hosts the
        // mute-mic indicator inline on the same row, so a muted local
        // user gets a clear bottom strip reading "[mic-off]  Myself".
        // flexDirection:'row' with alignItems:'center' keeps the icon
        // and the label vertically centred relative to each other.
        const myselfLabel = (
            <LinearGradient
                start={{ x: 0, y: 0.55 }}
                end={{ x: 0, y: 1 }}
                colors={['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, .5)']}
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    flexDirection: 'row',
                    alignItems: 'center',
                    // iOS in fullscreen mode (both portrait and
                    // landscape): shift the row 20 dp further to the
                    // right so it clears the phone's bottom-left
                    // rounded corner (iPhone X+). In portrait the
                    // round corner sits at the bottom-left; in
                    // landscape the bottom-left corner is also
                    // rounded (different orientation, same physical
                    // glass). Other surfaces handle the safe-area
                    // inset themselves; in fullscreen there is no
                    // SafeAreaView padding and the label would
                    // otherwise ride under the rounded corner.
                    // Same paddingLeft in fullscreen and non-fullscreen
                    // so the "Myself" label doesn't shift horizontally
                    // when the chrome toggles. (Previously the iOS
                    // fullscreen branch used 37 dp to clear the rounded
                    // bottom-left corner of the device — that
                    // discrepancy made the label visibly jump compared
                    // to remote participants' name strips.)
                    paddingLeft: 17,
                    paddingRight: 12,
                    paddingBottom: 10,
                    paddingTop: 24,
                }}
                pointerEvents="none"
            >
                {this.props.audioMuted ? (
                    <Icon
                        name="microphone-off"
                        size={18}
                        color="#ffffff"
                        style={{ marginRight: 8 }}
                    />
                ) : null}
                <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={{ color: '#ffffff', fontSize: 14, fontWeight: '600' }}
                >
                    Myself
                </Text>
            </LinearGradient>
        );

        const streamUrl = this.props.stream ? this.props.stream.toURL() : null;
        const mirror = (this.props.cameraFacing || 'front') !== 'back';

        // Aspect-ratio mode resolution.
        //   • 'cover'   → existing behaviour: Surface fills the parent
        //                 (containerBig), RTCView objectFit 'cover'.
        //                 Image fills the screen, may crop edges.
        //   • 'contain' → fill-the-view: Surface is sized to the
        //                 CAMERA's aspect ratio (not the screen's)
        //                 and centred inside the parent. RTCView
        //                 inside uses objectFit 'cover' so the video
        //                 fills that resized Surface with NO letterbox
        //                 bars. The leftover screen area outside the
        //                 Surface is just the parent's background.
        //                 Needs videoDims from onDimensionsChange —
        //                 until that lands we fall back to 'cover'.
        const isContain = this.props.aspectRatio === 'contain';
        const dims = this.state.videoDims;
        // Default to 9:16 (portrait camera) when we don't yet know
        // the camera's intrinsic dimensions — RN-WebRTC doesn't
        // always populate getSettings() with width/height, and
        // RTCView.onDimensionsChange isn't fired by every platform
        // build. With a default, the CONTAIN branch always renders
        // (so the user actually sees a different layout when they
        // toggle), and the value refreshes if onDimensionsChange
        // does fire later.
        const camAR = (dims && dims.width && dims.height)
            ? (dims.width / dims.height) : (9 / 16);

        // BIG render path (solo fullscreen / in-matrix self tile).
        // Uses a plain View rather than Paper's Surface — the Surface
        // wraps in an Animated.View that filters its inbound style
        // props through an allowlist and tacks on its own shadow
        // padding maths, which (a) leaves a visible strip of black
        // around what should be edge-to-edge video and (b) prevents
        // `position: 'absolute'` from reliably pinning to 0/0/0/0.
        // A plain View just does what we tell it. The Surface is
        // retained for the SMALL (120×90 PIP) path below where
        // Paper's elevation is still useful.
        if (this.props.big) {
            // COVER: video edge-to-edge, may crop. Wrapper is pinned
            // to the screen via absolute 0/0/0/0 so the RTCView
            // (width/height 100%) really does fill the screen.
            //
            // CONTAIN: wrapper still fills the screen (so the empty
            // letterbox area is black), but an INNER View sized to
            // the camera's aspect ratio holds the RTCView. The
            // RTCView uses objectFit='cover' to fill that inner
            // View — no letterbox bars, the video just fills the
            // (smaller, camera-AR-shaped) box.
            // BIG render path — match LocalMedia's pre-call preview
            // pattern exactly. The user confirmed that when they press
            // Video to connect, the LocalMedia local preview "fills up
            // the whole view" — and that's the look they want for the
            // post-connect, alone-in-room self surface too.
            //
            // LocalMedia's recipe (see LocalMedia.js render() and the
            // styles.container in LocalMediaStyles.js):
            //   • Outer View — flex:1, width:'100%', height:'100%'
            //   • RTCView    — objectFit='cover', explicit
            //                  width/height pulled from
            //                  Dimensions.get('window'), so the video
            //                  paints across the actual window even
            //                  when the parent has been shrunk by a
            //                  SafeAreaView ancestor.
            //
            // Reproducing it here avoids the earlier ineffective
            // attempts (position:absolute + parent-anchored top/bottom
            // didn't fill; Dimensions on the wrapper overflowed
            // because the parent's top wasn't at screen y=0; Portal
            // covered the controls).
            const _wd = Dimensions.get('window');
            // Prefer the MEASURED yellow size for contain-mode math
            // so the inner camera-AR box fits inside yellow exactly,
            // regardless of how much the SafeAreaView ancestor chain
            // shrank the wrapper. Fall back to Dimensions.window
            // before the first onLayout callback lands.
            const _measured = this.state.wrapperLayout;
            const _baseW = (_measured && _measured.width) || _wd.width;
            const _baseH = (_measured && _measured.height) || _wd.height;
            return (
                <View
                    pointerEvents="box-none"
                    onLayout={this._onWrapperLayout}
                    style={{
                        // Absolute fill so the wrapper truly matches
                        // its parent's bounds even when the parent has
                        // complex layout (e.g. a flexed sibling chain
                        // where flex:1 doesn't propagate cleanly).
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: 0,
                        backgroundColor: '#000',
                        zIndex: 1000,
                        transform: [{ translateX: shiftX }, { translateY: shiftY }],
                    }}
                >
                    {isContain && camAR ? (
                        // CONTAIN — compute the camera-AR inner box
                        // size in JS instead of relying on
                        // `aspectRatio: camAR + width:'100%' +
                        // maxHeight:'100%'`. The aspectRatio +
                        // maxHeight combination doesn't reliably
                        // clamp in Yoga when the parent is a
                        // flex:1 View — the inner box ends up
                        // taller than its parent, overflowing the
                        // yellow wrapper top and bottom (the
                        // "Myself" label ending up mid-screen and
                        // the video overflowing past the device
                        // bottom that the user reported).
                        //
                        // Recipe: fit the LARGEST rectangle with
                        // camera AR inside Dimensions.window (which
                        // matches what cover-mode uses for the
                        // RTCView), then give the inner box those
                        // explicit dimensions. With explicit width
                        // AND height, justifyContent:'center' on
                        // the centring parent places the box
                        // correctly with no overflow surprises.
                        (() => {
                            // Compute the camera-AR inner box against
                            // the YELLOW wrapper's measured size (with
                            // Dimensions.window as a fallback) rather
                            // than against the device window, so the
                            // box fits inside yellow when the
                            // SafeAreaView chain has shrunk yellow
                            // below the device-screen size.
                            const baseAR = _baseW / _baseH;
                            let _innerW, _innerH;
                            if (camAR > baseAR) {
                                _innerW = _baseW;
                                _innerH = _baseW / camAR;
                            } else {
                                _innerH = _baseH;
                                _innerW = _baseH * camAR;
                            }
                            return (
                                <View
                                    pointerEvents="box-none"
                                    style={{
                                        ...StyleSheet.absoluteFillObject,
                                        justifyContent: 'center',
                                        alignItems: 'center',
                                    }}
                                >
                                    <View
                                        pointerEvents="box-none"
                                        style={{
                                            width: _innerW,
                                            height: _innerH,
                                            backgroundColor: '#000',
                                            overflow: 'hidden',
                                        }}
                                    >
                                        <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
                                            <RTCView
                                                objectFit="cover"
                                                style={styles.video}
                                                ref="videoElement"
                                                poster="assets/images/transparent-1px.png"
                                                streamURL={streamUrl}
                                                mirror={mirror}
                                                onDimensionsChange={this._onVideoDimensions}
                                            />
                                        </View>
                                        {myselfLabel}
                                        {/* Swap-cameras (top-left),
                                            close (top-right), aspect-
                                            ratio (above action bar)
                                            live INSIDE the purple
                                            camera-AR box so they anchor
                                            to the actual visible video
                                            edge. */}
                                        {swapButton}
                                        {closeButton}
                                        {arButton}
                                        {gridButton}
                                    </View>
                                </View>
                            );
                        })()
                    ) : (
                        // COVER — RTCView fills the yellow wrapper
                        // edge-to-edge. pointerEvents="none" on the
                        // wrapper so the tap-to-toggle-fullscreen
                        // gesture on the underlying video grid still
                        // receives taps through this surface.
                        <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
                            <RTCView
                                objectFit="cover"
                                style={StyleSheet.absoluteFillObject}
                                ref="videoElement"
                                poster="assets/images/transparent-1px.png"
                                streamURL={streamUrl}
                                mirror={mirror}
                                onDimensionsChange={this._onVideoDimensions}
                            />
                        </View>
                    )}
                    {/* In COVER mode the bottom-strip "Myself" label
                        sits at the bottom of the full-window-sized
                        RTCView region; in CONTAIN it's nested inside
                        the camera-AR box. */}
                    {!(isContain && camAR) ? myselfLabel : null}
                    {muteIcon}
                    {/* In CONTAIN mode the icons live INSIDE the
                        purple camera-AR inner box (above). At the
                        YELLOW level we only render them in COVER
                        mode where the video fills yellow. */}
                    {!(isContain && camAR) ? swapButton : null}
                    {!(isContain && camAR) ? closeButton : null}
                    {!(isContain && camAR) ? arButton : null}
                    {!(isContain && camAR) ? gridButton : null}
                </View>
            );
        }

        // SMALL (120 × 160 PIP) render path. Mirrors the audio-mode
        // PIP recipe exactly because that one renders correctly on
        // both iOS and Android:
        //   • styles.container = flex:1 (no width/height %, no bg,
        //     no elevation) — the OUTER wrapper supplied by
        //     ConferenceBox already paints bg / radius / elevation.
        //   • Direct child of the container is a plain
        //     `<View style={{flex:1}}>` that hosts the RTCView. On
        //     Android, RTCView is a SurfaceView; an extra flex:1
        //     parent gives it a clean layout box. Pinning via
        //     width/height '100%' had been triggering the
        //     “video flashes then vanishes” symptom — flex:1
        //     fixes it the same way the working audio PIP does.
        //   • RTCView itself uses style={{flex:1}} (NOT
        //     width/height 100%), matching audio PIP exactly.
        return (
            <View
                pointerEvents="box-none"
                style={[styles.container,
                        { transform: [{ translateX: shiftX}, { translateY: shiftY }]}]}
            >
                {muteIcon}
                <View style={{flex: 1}}>
                    {/* zOrder=1 (media-overlay) is REQUIRED on Android
                        for the floating PIP. Android SurfaceViews are
                        composited outside the normal View hierarchy and
                        ignore both zIndex and elevation — so the matrix
                        tiles' RTCViews (also SurfaceViews) paint on top
                        of this PIP's RTCView regardless of how high
                        we lift the wrapper. zOrder=1 promotes this
                        SurfaceView above the other SurfaceViews in the
                        same window, which is what makes the PIP video
                        actually visible on Android. iOS ignores the
                        prop entirely so this is safe to set
                        unconditionally. */}
                    <RTCView
                        objectFit={this.props.aspectRatio || 'cover'}
                        style={{flex: 1}}
                        ref="videoElement"
                        poster="assets/images/transparent-1px.png"
                        streamURL={streamUrl}
                        mirror={mirror}
                        zOrder={1}
                        onDimensionsChange={this._onVideoDimensions}
                    />
                </View>
                {/* No "Myself" label in the small PIP. */}
                {swapButton}
                {closeButton}
                {gridButton}
            </View>
        );
    }
}

ConferenceParticipantSelf.propTypes = {
    visible: PropTypes.bool,
    stream: PropTypes.object,
    identity: PropTypes.object.isRequired,
    audioMuted: PropTypes.bool.isRequired,
    generatedVideoTrack: PropTypes.bool,
    isLandscape: PropTypes.bool,
    big: PropTypes.bool,
    cameraFacing: PropTypes.string,
    // True when the conference is in fullscreen mode (navbar hidden,
    // self-view fills the screen). Used to shift the "Myself" label
    // away from the bottom-left phone corner on iOS portrait.
    fullScreen: PropTypes.bool,
    // 'cover' (default) → fill the parent, may crop. 'contain' →
    // resize the Surface to the camera's aspect ratio (centred in
    // the parent), so the video fills that Surface with no letterbox
    // bars. See the render() AR-resolution comment.
    aspectRatio: PropTypes.string,
    // Optional callback for the top-right swap-cameras icon. Wired by
    // the parent (ConferenceBox) to its toggleCamera() so the
    // cameraFacing state stays consistent with the kebab / Video...
    // picker rows. When omitted no icon is rendered.
    onCameraSwap: PropTypes.func,
    // Optional callback for the bottom-right aspect-ratio icon.
    // Parent wires it to toggleAspectRatio. When omitted no icon
    // renders, matching the swap-icon gating.
    onAspectRatioToggle: PropTypes.func,
    // Optional callback for the top-right close (X) icon. Parent
    // typically wires it to set enableMyVideo=false to dismiss the
    // self-view; omitting the prop hides the icon.
    onClose: PropTypes.func,
    // When true, suppress the close (X) and aspect-ratio buttons.
    // Set by the parent (ConferenceBox) when the user is alone in
    // the room and the self-preview fills the screen — closing the
    // mirror there would leave a blank screen, and the AR toggle
    // doesn't add value without other participants for comparison.
    isSoloFullscreen: PropTypes.bool,
    // Optional callback for the bottom-right grid icon. Only set
    // by the parent when visibleCount === 3 — tap flips the matrix
    // between the default 2×2 (self in 4th slot) and a 3-up row/
    // column layout with self in this thumbnail.
    onToggleLayout: PropTypes.func,
    // Current state of the 3-up row/column flag — drives the icon
    // glyph (view-grid vs view-agenda) so it reads as "what tapping
    // will switch INTO".
    threeUpRowLayout: PropTypes.bool,
};

export default ConferenceParticipantSelf;
