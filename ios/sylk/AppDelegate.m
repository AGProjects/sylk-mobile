/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "AppDelegate.h"

#import <React/RCTBridge.h>
#import <React/RCTBundleURLProvider.h>
#import <React/RCTRootView.h>
#import <WebRTC/RTCLogging.h>
#import <React/RCTLog.h>
#import <React/RCTLinkingManager.h>
#import <PushKit/PushKit.h>
@import Firebase;
#import "RNCallKeep.h"
#import "RNVoipPushNotificationManager.h"

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{

  // RCTSetLogThreshold(RCTLogLevelInfo - 1);
  // RTCSetMinDebugLogLevel(RTCLoggingSeverityInfo);
  if ([FIRApp defaultApp] == nil) {
    [FIRApp configure];
  }

  RCTBridge *bridge = [[RCTBridge alloc] initWithDelegate:self launchOptions:launchOptions];
  RCTRootView *rootView = [[RCTRootView alloc] initWithBridge:bridge
                                                   moduleName:@"Sylk"
                                            initialProperties:nil];

  rootView.backgroundColor = [[UIColor alloc] initWithRed:1.0f green:1.0f blue:1.0f alpha:1];

  self.window = [[UIWindow alloc] initWithFrame:[UIScreen mainScreen].bounds];
  UIViewController *rootViewController = [UIViewController new];
  rootViewController.view = rootView;
  self.window.rootViewController = rootViewController;
  [self.window makeKeyAndVisible];
  return YES;
}

- (BOOL)application:(UIApplication *)application
continueUserActivity:(NSUserActivity *)userActivity
  restorationHandler:(void(^)(NSArray * __nullable restorableObjects))restorationHandler
{
  BOOL handled = [RNCallKeep application:application
           continueUserActivity:userActivity
             restorationHandler:restorationHandler];

  if (!handled) {
    handled = [RCTLinkingManager application:application
                  continueUserActivity:userActivity
                    restorationHandler:restorationHandler];
  }

  return handled;
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index" fallbackResource:nil];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

// Handle updated push credentials
- (void)pushRegistry:(PKPushRegistry *)registry didUpdatePushCredentials:(PKPushCredentials *)credentials forType:(NSString *)type {
  // Register VoIP push token (a property of PKPushCredentials) with server
  [RNVoipPushNotificationManager didUpdatePushCredentials:credentials forType:(NSString *)type];
}

// Handle incoming pushes
- (void)pushRegistry:(PKPushRegistry *)registry didReceiveIncomingPushWithPayload:(PKPushPayload *)payload forType:(NSString *)type withCompletionHandler:(void (^)(void))completion{
  NSLog(@"Got a PUSHKIT NOTIFICATION");

  [RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:payload forType:(NSString *)type];
  // Retrieve information like handle and callerName here
  NSString *eventType = [payload.dictionaryPayload valueForKey:@"event"];
  NSLog(@"Value of eventType = %@", eventType);

  // if ([eventType isEqualToString:@"incoming_session"])
  // {
  NSString *calluuid = [payload.dictionaryPayload valueForKey:@"session-id"];
  NSString *mediaType = [payload.dictionaryPayload valueForKey:@"media-type"];
  NSString *callerName = [payload.dictionaryPayload valueForKey:@"from_display_name"];
  NSString *handle = [payload.dictionaryPayload valueForKey:@"from_uri"];

  [RNCallKeep reportNewIncomingCall:calluuid handle:handle handleType:@"generic" hasVideo:[mediaType isEqualToString:@"video"] localizedCallerName:callerName fromPushKit: YES payload:payload.dictionaryPayload withCompletionHandler:nil];
  // }
  // else {
  completion();
  // }
}

@end
