// Replacement for the react-native-camera preview tile (RNCamera) — 2026-07-23.
// Thin function-component wrapper over react-native-vision-camera's <Camera>,
// used purely as a live viewfinder (no photo/video/audio capture) in the
// "enable camera?" modals (StartCameraPreviewModal, VideoBox). Exposes the
// tiny slice of API those class components used:
//   <CameraPreview facing={'front'|'back'} style={...} />
// Front/back is switched by passing a different device (useCameraDevice),
// the vision-camera equivalent of RNCamera's `type` prop re-render.
//
// Wrapper needed because vision-camera is hooks-only and the call sites are
// class components (same pattern as app/components/QRScanner.js).
//
// Camera permission is intentionally NOT requested here: by the time either
// modal renders, sylkrtc has already obtained camera permission via its own
// getUserMedia flow, and vision-camera reuses the granted permission. The
// preview opens an INDEPENDENT capture session from webrtc's — the parent is
// responsible for releasing the webrtc camera first and unmounting this tile
// (which releases vision-camera's session) before webrtc reclaims the camera,
// exactly as it did with RNCamera.
import React from 'react';
import { View } from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';

const CameraPreview = ({ facing = 'front', style }) => {
    const device = useCameraDevice(facing === 'back' ? 'back' : 'front');

    // Device not resolved yet (or unavailable): render an opaque placeholder
    // so the tile's layout/background stays stable, matching RNCamera's
    // black preview area before the session opens.
    if (!device) {
        return <View style={[{ backgroundColor: 'black' }, style]} />;
    }

    return (
        <Camera
            style={style}
            device={device}
            isActive={true}
            // Viewfinder only — no capture outputs, no audio.
            photo={false}
            video={false}
            audio={false}
        />
    );
};

export default CameraPreview;
