//
//  NativeLoggerModule.m
//  sylk
//

#import "NativeLoggerModule.h"
#import "SylkLogger.h"

@implementation NativeLoggerModule {
    BOOL _hasListeners;
}

RCT_EXPORT_MODULE(NativeLogger);

+ (BOOL)requiresMainQueueSetup
{
    return NO;
}

// Reads run on a background queue — drainStart hits the file system
// (sync into the SylkLogger ioQueue). Don't tie up the JS thread.
- (dispatch_queue_t)methodQueue
{
    return dispatch_queue_create("com.agprojects.sylk.nativelogger.bridge",
                                 DISPATCH_QUEUE_SERIAL);
}

- (NSArray<NSString *> *)supportedEvents
{
    return @[@"NativeLogLine"];
}

#pragma mark - Live observation

- (void)startObserving
{
    _hasListeners = YES;
    __weak typeof(self) weakSelf = self;
    [SylkLogger setLiveListener:^(NSString *line) {
        __strong typeof(self) strongSelf = weakSelf;
        if (!strongSelf || !strongSelf->_hasListeners) return;
        // sendEventWithName is safe to call from any queue — RN
        // marshalls onto the JS thread internally.
        [strongSelf sendEventWithName:@"NativeLogLine"
                                 body:@{@"line": line ?: @""}];
    }];
}

- (void)stopObserving
{
    _hasListeners = NO;
    [SylkLogger setLiveListener:nil];
}

#pragma mark - Drain (one-shot, two-phase)

RCT_EXPORT_METHOD(getPersistedLogs:(RCTPromiseResolveBlock)resolve
                          rejecter:(RCTPromiseRejectBlock)reject)
{
    @try {
        NSString *contents = [SylkLogger drainStart] ?: @"";
        resolve(contents);
    } @catch (NSException *ex) {
        reject(@"sylk_logger_drain_failed",
               ex.reason ?: @"unknown",
               nil);
    }
}

RCT_EXPORT_METHOD(acknowledgePersistedLogs:(RCTPromiseResolveBlock)resolve
                                  rejecter:(RCTPromiseRejectBlock)reject)
{
    @try {
        [SylkLogger drainAck];
        resolve(@(YES));
    } @catch (NSException *ex) {
        reject(@"sylk_logger_ack_failed",
               ex.reason ?: @"unknown",
               nil);
    }
}

#pragma mark - JS console echo (metro.log visibility)

// Echo a single JS console line straight to the device syslog so it
// reappears in metro.log via the idevicesyslog capture ladder in
// metro-adb-logs.sh (which greps the syslog for the [SYLK_APP] tag).
//
// Why this exists: React Native 0.77 removed console-log forwarding
// over Metro (deprecated in 0.76, now CDP-only), so on iOS console.*
// output no longer reaches the Metro terminal / metro.log — only native
// SylkLogger lines do. The JS side (app.js console wrapper) calls this
// for every console.* line on iOS to restore that visibility. Android
// needs nothing here: console.* already lands in logcat under the
// ReactNativeJS tag, which the adb pipeline captures.
//
// Deliberately a bare NSLog and NOT [SylkLogger log:] — it must not feed
// SylkLogger's on-disk buffer or its live listener, otherwise a forwarded
// console line could be streamed back to JS (nativeLogReplay) and, if any
// downstream handler logged, loop. %s + [line UTF8String] keeps unified
// logging from redacting the message to <private> in the captured stream,
// matching the convention in AppDelegate.m / SylkLogger.
RCT_EXPORT_METHOD(echoToSyslog:(NSString *)line)
{
    if (![line isKindOfClass:[NSString class]] || line.length == 0) {
        return;
    }
    NSLog(@"[SYLK_APP] %s", [line UTF8String]);
}

@end
