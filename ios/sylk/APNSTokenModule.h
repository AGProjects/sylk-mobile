#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>

@interface APNSTokenModule : RCTEventEmitter <RCTBridgeModule>
- (void)sendTokenToJS:(NSString *)token;
@end
