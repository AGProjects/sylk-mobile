#import "IdleTimerModule.h"
#import <UIKit/UIKit.h>
#import "SylkLogger.h"

@implementation IdleTimerModule

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(setIdleTimerDisabled:(BOOL)disabled)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [UIApplication sharedApplication].idleTimerDisabled = disabled;
    [SylkLogger log:@"[idle] idleTimerDisabled = %@", disabled ? @"YES" : @"NO"];
  });
}

@end
