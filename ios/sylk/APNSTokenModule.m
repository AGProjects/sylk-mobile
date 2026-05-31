#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>
#import "AppDelegate.h"
#import "SylkLogger.h"

@interface APNSTokenModule : RCTEventEmitter <RCTBridgeModule>
- (void)sendTokenToJS:(NSString *)token;
@end

@implementation APNSTokenModule

RCT_EXPORT_MODULE();

- (NSArray<NSString *> *)supportedEvents {
  return @[@"apnsToken"];
}

// Sends token to JS safely on main thread
- (void)sendTokenToJS:(NSString *)token {
  if (!token) return;
  dispatch_async(dispatch_get_main_queue(), ^{
      [self sendEventWithName:@"apnsToken" body:token];
  });
}

// Called from JS to emit cached token if any
RCT_EXPORT_METHOD(emitCachedAPNSToken)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    AppDelegate *app = (AppDelegate *)[UIApplication sharedApplication].delegate;
    [SylkLogger log:@"[push] emitCachedAPNSToken called, cached token = %@", app.cachedAPNSToken ?: @"<nil>"];

    if (app.cachedAPNSToken) {
        [self sendEventWithName:@"apnsToken" body:app.cachedAPNSToken];
    }
  });
}

// JS-triggered push notification permission prompt. Used to defer the
// iOS user-notification dialog out of didFinishLaunchingWithOptions —
// JS calls this once the user has successfully logged in for the first
// time so the prompt lands inside a context the user understands.
RCT_EXPORT_METHOD(requestNotificationPermission)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    AppDelegate *app = (AppDelegate *)[UIApplication sharedApplication].delegate;
    [app requestPushNotificationPermission];
  });
}

@end

