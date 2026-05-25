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
import { Button, IconButton, Text as PaperText } from 'react-native-paper';
import { RTCView } from 'react-native-webrtc';


class StartCameraPreviewModal extends React.Component {
    flipCamera = () => {
        // Best-effort flip in place. react-native-webrtc exposes
        // _switchCamera() on the video track; absent on older RN-WebRTC
        // builds in which case we leave the preview alone.
        try {
            const stream = this.props.localStream;
            if (!stream) return;
            const tracks = stream.getVideoTracks ? stream.getVideoTracks() : [];
            const track = tracks && tracks[0];
            if (track && typeof track._switchCamera === 'function') {
                track._switchCamera();
                if (typeof this.props.onFlipCamera === 'function') {
                    this.props.onFlipCamera();
                }
            }
        } catch (e) {
            // best effort — flipping is a nice-to-have on the preview
        }
    };

    render() {
        const { visible, localStream, mirror, onStart, onCancel } = this.props;
        const streamUrl = localStream ? localStream.toURL() : null;

        // Always mount, just toggle opacity + pointerEvents based on
        // `visible`. Returning null when not visible was forcing a
        // full mount/layout cycle on the very first visible→true
        // tap, which iOS could not finish in time for the first
        // click's render — manifesting as "first tap does nothing,
        // second tap shows the panel". Keeping the View mounted
        // (with opacity:0 + pointerEvents:'none' when inactive)
        // means the visible→true flip is a pure paint update and
        // happens in the same frame as the parent's setState.
        return (
            <View
                style={{
                    ...StyleSheet.absoluteFillObject,
                    backgroundColor: 'black',
                    zIndex: 9999,
                    elevation: 9999,
                    opacity: visible ? 1 : 0,
                }}
                pointerEvents={visible ? 'auto' : 'none'}
            >
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

                        {/* Self-view preview taking the upper portion.
                            Rounded card so it reads as a discrete
                            preview rather than the full screen. */}
                        {streamUrl ? (
                            <View
                                style={{
                                    position: 'absolute',
                                    top: 60,
                                    left: 24,
                                    right: 24,
                                    bottom: 220,
                                    backgroundColor: 'black',
                                    borderRadius: 12,
                                    overflow: 'hidden',
                                    zIndex: 2,
                                }}
                            >
                                <RTCView
                                    key={'cam-preview-' + streamUrl}
                                    streamURL={streamUrl}
                                    objectFit="cover"
                                    mirror={mirror !== false}
                                    style={StyleSheet.absoluteFillObject}
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
                        ) : (
                            <View
                                style={{
                                    position: 'absolute',
                                    top: 60,
                                    left: 24,
                                    right: 24,
                                    bottom: 220,
                                    backgroundColor: '#111',
                                    borderRadius: 12,
                                    zIndex: 2,
                                }}
                            />
                        )}

                        {/* Action panel pinned to the bottom — same
                            shape and copy as the audio-call upgrade
                            prompt so the two surfaces feel like one
                            consistent control. */}
                        <View
                            style={{
                                position: 'absolute',
                                bottom: 24,
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
                            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                                <Button onPress={onCancel}>Cancel</Button>
                                <Button
                                    mode="contained"
                                    onPress={onStart}
                                    icon="video"
                                    style={{ marginLeft: 8 }}
                                >
                                    Enable camera
                                </Button>
                            </View>
                        </View>
                </View>
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
