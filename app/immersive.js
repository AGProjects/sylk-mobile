// Inlined replacement for the dead react-native-immersive package
// (2026-07-22) — same on()/off() API, served natively by
// SylkBridge.setImmersive. Android only; no-ops elsewhere, matching the
// old lib's behavior. Used by the video call / conference fullscreen UI
// (ConferenceBox, VideoBox, app.js).
import { NativeModules, Platform } from 'react-native';

const Immersive = {
    on: () => {
        if (Platform.OS !== 'android') {
            return;
        }
        try {
            NativeModules.SylkBridge.setImmersive(true);
        } catch (e) {
            console.log('Immersive.on failed:', e && e.message);
        }
    },
    off: () => {
        if (Platform.OS !== 'android') {
            return;
        }
        try {
            NativeModules.SylkBridge.setImmersive(false);
        } catch (e) {
            console.log('Immersive.off failed:', e && e.message);
        }
    },
};

export default Immersive;
