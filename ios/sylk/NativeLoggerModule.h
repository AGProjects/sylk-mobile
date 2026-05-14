//
//  NativeLoggerModule.h
//  sylk
//
//  RN bridge for SylkLogger. Exposed as NativeLogger:
//
//      NativeModules.NativeLogger.getPersistedLogs()         -> Promise<string>
//      NativeModules.NativeLogger.acknowledgePersistedLogs() -> Promise<void>
//
//  Plus a live event channel:
//
//      const em = new NativeEventEmitter(NativeModules.NativeLogger);
//      em.addListener("NativeLogLine", ({line}) => ...);
//
//  startObserving wires the SylkLogger live listener so every
//  subsequent native log line is emitted through the bridge instead
//  of persisted to disk. stopObserving clears it. JS side should
//  subscribe BEFORE calling getPersistedLogs/ack, so any line that
//  fires during the drain goes via the live stream rather than
//  hitting disk and being replayed next session.
//

#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>

@interface NativeLoggerModule : RCTEventEmitter <RCTBridgeModule>
@end
