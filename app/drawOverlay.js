// Inlined replacement for the dead, patched react-native-draw-overlay
// package (2026-07-22). The two methods it exposed — check / ask for the
// "display over other apps" (SYSTEM_ALERT_WINDOW) permission, needed so
// the incoming-call alert panel can appear over the lock screen and other
// apps — are now native methods on SylkBridge (SylkBridge.kt), which owns
// the activity-result plumbing. Android-only, matching the removed native
// module (it only existed on Android); on other platforms the methods
// resolve(true) as a no-op — the permission concept doesn't apply there,
// and the sole check call site is already Platform.OS-gated in app.js.
//
// Same default-export shape and method names as the old lib, so the
// RNDrawOverlay.<method>() call sites in app.js are untouched — only the
// import path changed.
import { NativeModules, Platform } from 'react-native';

const { SylkBridge } = NativeModules;

const RNDrawOverlay = {
    askForDisplayOverOtherAppsPermission: () => {
        if (Platform.OS !== 'android' || !SylkBridge) {
            return Promise.resolve(true);
        }
        return SylkBridge.askForDisplayOverOtherAppsPermission();
    },
    checkForDisplayOverOtherAppsPermission: () => {
        if (Platform.OS !== 'android' || !SylkBridge) {
            return Promise.resolve(true);
        }
        return SylkBridge.checkForDisplayOverOtherAppsPermission();
    },
};

export default RNDrawOverlay;
