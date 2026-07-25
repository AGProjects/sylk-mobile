// Inlined replacement for the dead react-native-proximity package
// (2026-07-22). Rather than owning a SensorManager (Android) + a
// UIDevice proximity module (iOS) ourselves, we reuse the proximity
// sensor that react-native-incall-manager already ships and already
// owns call audio with. incall-manager emits a 'Proximity' device
// event carrying {isNear: bool} on BOTH platforms; the old library
// emitted {proximity: bool}. This shim adapts the event shape so the
// single consumer (app.js handleProximity({proximity})) and every
// gate/route path downstream stay byte-for-byte unchanged.
//
// The SENSOR itself is started/stopped per call via
// InCallManager.startProximitySensor()/stopProximitySensor() in
// app.js audioManagerStart/Stop — this shim is only the event adapter.
// Subscribing here (once, at mount) is safe app-wide: 'Proximity'
// events only fire while a sensor session is active, i.e. during a
// call, which is exactly when the old always-on listener's events were
// acted on anyway (handleProximity's route branch is gated on an
// active call).
//
// Note on iOS: react-native-proximity was never actually linked on
// iOS (no podspec, absent from Podfile.lock), so its addListener threw
// on a missing native module there. incall-manager IS linked on iOS,
// so routing proximity through it makes the iOS sensor work for the
// first time and correctly scopes UIDevice.proximityMonitoringEnabled
// to call duration instead of leaving it on app-wide.
import { DeviceEventEmitter } from 'react-native';

const EVENT_NAME = 'Proximity';

const Proximity = {
    // callback receives {proximity: bool} — same shape the old lib used.
    // Returns an EmitterSubscription; the existing call site keeps using
    // .remove() on it, so app.js needs no lifecycle changes.
    addListener: (callback) => {
        return DeviceEventEmitter.addListener(EVENT_NAME, (event) => {
            const isNear = !!(event && event.isNear);
            callback({ proximity: isNear });
        });
    },

    // Kept for API compatibility with the old default export. Accepts the
    // subscription returned by addListener.
    removeListener: (subscription) => {
        try {
            if (subscription && typeof subscription.remove === 'function') {
                subscription.remove();
            }
        } catch (e) {
            console.log('Proximity.removeListener failed:', e && e.message);
        }
    },
};

export default Proximity;
