#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>
#import "AppDelegate.h"

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
    NSLog(@"[APNSTokenModule] emitCachedAPNSToken called, cached token = %@", app.cachedAPNSToken ?: @"<nil>");

    if (app.cachedAPNSToken) {
        [self sendEventWithName:@"apnsToken" body:app.cachedAPNSToken];
        app.cachedAPNSToken = nil;
    }
  });
}

@end

