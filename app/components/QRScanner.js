// Replacement for the dead react-native-qrcode-scanner (which rendered
// react-native-camera internally) — 2026-07-23. Thin function-component
// wrapper over react-native-vision-camera's native code scanner, exposing
// the small slice of the old component's API the app actually used:
//   <QRScanner onRead={fn} showMarker containerStyle={...} />
// so the two class-component call sites (RegisterForm, ReadyBox) stay
// simple. onRead is called with { data } — the same shape the old
// library's onRead handler received (e.data) — so QRCodeRead is unchanged.
//
// Why a wrapper: vision-camera is hooks-only (useCameraDevice /
// useCameraPermission / useCodeScanner) and our call sites are class
// components; isolating it here keeps that surface in one file (same
// philosophy as app/immersive.js, app/proximity.js).
//
// Android note: the code scanner requires `VisionCamera_enableCodeScanner=true`
// in android/gradle.properties (pulls in the MLKit barcode model). iOS needs
// no extra flag. Camera permission (CAMERA / NSCameraUsageDescription) is
// already declared in the manifests.
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import {
    Camera,
    useCameraDevice,
    useCameraPermission,
    useCodeScanner,
} from 'react-native-vision-camera';

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'black',
    },
    markerWrap: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
    },
    marker: {
        width: 220,
        height: 220,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.9)',
        borderRadius: 12,
        backgroundColor: 'transparent',
    },
});

const QRScanner = ({ onRead, showMarker, containerStyle }) => {
    const device = useCameraDevice('back');
    const { hasPermission, requestPermission } = useCameraPermission();
    // The scanner fires continuously; deliver the first successful read once.
    // The parent hides (unmounts) the scanner on read, so this component
    // remounts fresh next time and the guard resets.
    const deliveredRef = useRef(false);

    useEffect(() => {
        if (!hasPermission) {
            requestPermission();
        }
    }, [hasPermission, requestPermission]);

    const codeScanner = useCodeScanner({
        codeTypes: ['qr'],
        onCodeScanned: (codes) => {
            if (deliveredRef.current) {
                return;
            }
            const value = codes && codes.length ? codes[0].value : null;
            if (!value) {
                return;
            }
            deliveredRef.current = true;
            if (typeof onRead === 'function') {
                // Preserve the react-native-qrcode-scanner onRead(e) contract:
                // handlers read e.data.
                onRead({ data: value });
            }
        },
    });

    // No camera / no permission yet: render the framed container so layout
    // is stable while permission resolves (matches the old component
    // occupying its container immediately).
    if (!device || !hasPermission) {
        return <View style={[styles.container, containerStyle]} />;
    }

    return (
        <View style={[styles.container, containerStyle]}>
            <Camera
                style={StyleSheet.absoluteFill}
                device={device}
                isActive={true}
                codeScanner={codeScanner}
                // Preview only, no photo/video capture; keep audio off.
                audio={false}
            />
            {showMarker ? (
                <View style={styles.markerWrap} pointerEvents="none">
                    <View style={styles.marker} />
                </View>
            ) : null}
        </View>
    );
};

export default QRScanner;
