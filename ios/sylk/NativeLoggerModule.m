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

@end
