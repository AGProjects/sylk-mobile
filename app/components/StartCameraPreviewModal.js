// First-time camera-start preview for the audio→video view-mode toggle
// inside a conference. Visually identical to the mid-call "Enable your
// camera?" overlay in Call.js (the audio→video upgrade flow): local
// camera preview in the upper portion of the screen + a bottom action
// panel with title "Enable your camera?" + Cancel / Enable camera
// buttons + a camera-flip control over the preview.
//
// Owned by ConferenceBox. The conference's local stream already carries
// a video track (negotiated at call start even if the user chose
// Audio); ConferenceBox enables that track before mounting this
// component so RTCView paints frames. On Cancel, ConferenceBox
// disables the track again.

import React from 'react';
import PropTypes from 'prop-types';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Button, IconButton, Portal, Text as PaperText } from 'react-native-paper';
// RNCamera (react-native-camera) is used for the preview tile instead
// of webrtc's RTCView. Same pattern as VideoBox's camera-enable modal
// (see its renderCameraEnableModal): RTCView paints black on both
// iOS and Android while the webrtc sender is gated (track.enabled =
// false / replaceTrack(null)), because the underlying capture
// session pauses. RNCamera opens an INDEPENDENT native camera handle
// for the preview that has nothing to do with the conference call,
// so frames render even though no video is going over the wire to
// other participants. The handle is released the moment the modal
// unmounts (visible=false), freeing the camera before sylkrtc
// re-engages its own capture on Accept.
import { RNCamera } from 'react-native-camera';


class StartCameraPreviewModal extends React.Component {
    state = {
        // Local camera-facing state for the RNCamera preview. Decoupled
        // from the conference's own cameraFacing — flipping the preview
        // doesn't touch the webrtc track. Defaults to front; flips on
        // each camera-flip tap.
        cameraFacing: 'front',
    };

    flipCamera = () => {
        // RNCamera owns the capture; flipping is a re-render with the
        // swapped `type` prop. No webrtc track._switchCamera here —
        // that would touch the conference's own (gated) camera handle.
        this.setState((s) => ({ cameraFacing: s.cameraFacing === 'front' ? 'back' : 'front' }));
        if (typeof this.props.onFlipCamera === 'function') {
            try { this.props.onFlipCamera(); } catch (e) { /* best effort */ }
        }
    };

    render() {
        const { visible, onStart, onCancel, insets } = this.props;
        // Safe-area insets for the bottom (Android nav bar / iOS home
        // indicator) and the top (status bar / notch).
        const _topInset = (insets && insets.top) ? insets.top : 24;
        const _bottomInset = (insets && insets.bottom) ? insets.bottom : 24;
        const _leftInset = (insets && insets.left) ? insets.left : 0;
        const _rightInset = (insets && insets.right) ? insets.right : 0;
        const _previewBottomReserve = 200 + _bottomInset + 16;

        // Landscape detection. In landscape we restructure into a 2-
        // column layout (preview 70% on the left, action panel 30%
        // on the right) per user request. Portrait keeps the
        // stacked layout below.
        const _winDims = Dimensions.get('window');
        const _isLandscape = _winDims.width > _winDims.height;

        // Wrap in Portal so the modal escapes ConferenceBox's view
        // tree and renders at the React tree root, on top of every
        // other surface. The previous implementation used a raw
        // absolute-positioned View, which on Android was being
        // clipped by an ancestor (overflow:hidden on the conference
        // grid container) and never appeared visibly — the user's
        // log showed cameraStartPreviewVisible=true but no
        // perceived modal. Portal is the same mechanism the working
        // UpgradeVideoModal uses (see its Portal+Modal pattern).
        if (!visible) {
            return null;
        }
        return (
            <Portal>
            <View
                pointerEvents="box-none"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'black',
                    zIndex: 9999,
                    elevation: 9999,
                }}
            >
                    <>
                        {/* Dim layer so the preview frame stands out
                            from the surrounding black. Same approach
                            as Call.js's upgrade prompt. */}
                        <View
                            style={{
                                ...StyleSheet.absoluteFillObject,
                                backgroundColor: 'rgba(0,0,0,0.85)',
                                zIndex: 1,
                            }}
                            pointerEvents="none"
                        />

                        {/* Preview tile. Portrait: anchored top-stacked
                            above the action panel. Landscape: 70% of
                            the width on the LEFT, full height between
                            the safe-area insets. */}
                        <View
                            style={_isLandscape ? {
                                position: 'absolute',
                                top: _topInset + 12,
                                bottom: _bottomInset + 12,
                                left: _leftInset + 12,
                                width: (_winDims.width - _leftInset - _rightInset - 24) * 0.7 - 8,
                                backgroundColor: 'black',
                                borderRadius: 12,
                                overflow: 'hidden',
                                zIndex: 2,
                            } : {
                                position: 'absolute',
                                top: _topInset + 12,
                                left: 24,
                                right: 24,
                                bottom: _previewBottomReserve,
                                backgroundColor: 'black',
                                borderRadius: 12,
                                overflow: 'hidden',
                                zIndex: 2,
                            }}
                        >
                            <RNCamera
                                style={{ flex: 1 }}
                                type={this.state.cameraFacing === 'back'
                                    ? RNCamera.Constants.Type.back
                                    : RNCamera.Constants.Type.front}
                                captureAudio={false}
                                androidCameraPermissionOptions={null}
                                iosCameraPermissionOptions={null}
                            />
                            <View style={{ position: 'absolute', top: 12, right: 12 }}>
                                <IconButton
                                    icon="camera-flip"
                                    size={28}
                                    onPress={this.flipCamera}
                                    style={{ backgroundColor: 'rgba(255,255,255,0.85)' }}
                                />
                            </View>
                        </View>

                        {/* Action panel. Portrait: pinned to the
                            bottom edge. Landscape: 30% of the width
                            on the RIGHT, vertically centred. */}
                        <View
                            style={_isLandscape ? {
                                position: 'absolute',
                                top: _topInset + 12,
                                bottom: _bottomInset + 12,
                                right: _rightInset + 12,
                                width: (_winDims.width - _leftInset - _rightInset - 24) * 0.3 - 8,
                                backgroundColor: 'white',
                                borderRadius: 12,
                                paddingTop: 14,
                                paddingBottom: 14,
                                paddingHorizontal: 16,
                                elevation: 8,
                                zIndex: 3,
                                justifyContent: 'center',
                            } : {
                                position: 'absolute',
                                bottom: _bottomInset + 12,
                                left: 12,
                                right: 12,
                                backgroundColor: 'white',
                                borderRadius: 12,
                                paddingTop: 14,
                                paddingBottom: 6,
                                paddingHorizontal: 16,
                                elevation: 8,
                                zIndex: 3,
                            }}
                            pointerEvents="auto"
                        >
                            <PaperText style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 8 }}>
                                Enable your camera?
                            </PaperText>
                            <PaperText style={{ marginBottom: 12 }}>
                                Your camera will be visible to everyone in the
                                conference. Tap Enable camera to share, or
                                Cancel to keep the conference audio-only.
                            </PaperText>
                            <View style={{
                                flexDirection: _isLandscape ? 'column' : 'row',
                                justifyContent: _isLandscape ? 'flex-start' : 'flex-end',
                                alignItems: _isLandscape ? 'stretch' : 'center',
                            }}>
                                <Button onPress={onCancel} style={_isLandscape ? {marginBottom: 8} : null}>View only</Button>
                                <Button
                                    mode="contained"
                                    onPress={onStart}
                                    icon="video"
                                    style={_isLandscape ? null : { marginLeft: 8 }}
                                >
                                    Enable camera
                                </Button>
                            </View>
                        </View>
                    </>
            </View>
            </Portal>
        );
    }
}

StartCameraPreviewModal.propTypes = {
    visible:      PropTypes.bool.isRequired,
    // The active call's local stream. Parent must have enabled the
    // video track before flipping visible=true so RTCView paints.
    localStream:  PropTypes.object,
    // Mirror toggle for the local preview (front camera mirrors,
    // rear doesn't). Defaults to true if omitted.
    mirror:       PropTypes.bool,
    onStart:      PropTypes.func.isRequired,
    onCancel:     PropTypes.func.isRequired,
    // Optional notifier called after a successful camera flip, so
    // the parent can update its mirror prop if it tracks facing.
    onFlipCamera: PropTypes.func,
};

export default StartCameraPreviewModal;
