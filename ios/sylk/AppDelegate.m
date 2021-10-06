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
#import <UserNotifications/UserNotifications.h>
#import <RNCPushNotificationIOS.h>
#import <RNBackgroundDownloader.h>

@implementation AppDelegate

- (void)application:(UIApplication *)application handleEventsForBackgroundURLSession:(NSString *)identifier completionHandler:(void (^)(void))completionHandler
{
  [RNBackgroundDownloader setCompletionHandlerWithIdentifier:identifier completionHandler:completionHandler];
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{

  // RCTSetLogThreshold(RCTLogLevelInfo - 1);
  // RTCSetMinDebugLogLevel(RTCLoggingSeverityInfo);
  if ([FIRApp defaultApp] == nil) {
    [FIRApp configure];
  }

  // Define UNUserNotificationCenter
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  center.delegate = self;

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

//Called when a notification is delivered to a foreground app.
-(void)userNotificationCenter:(UNUserNotificationCenter *)center willPresentNotification:(UNNotification *)notification withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler
{
  completionHandler(UNAuthorizationOptionSound | UNAuthorizationOptionAlert | UNAuthorizationOptionBadge);
}


- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url
  sourceApplication:(NSString *)sourceApplication annotation:(id)annotation
{
  return [RCTLinkingManager
           application:application openURL:url
           sourceApplication:sourceApplication
           annotation:annotation
         ];
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

 // Required to register for notifications
 - (void)application:(UIApplication *)application didRegisterUserNotificationSettings:(UIUserNotificationSettings *)notificationSettings
 {
  [RNCPushNotificationIOS didRegisterUserNotificationSettings:notificationSettings];
 }
 // Required for the register event.
 - (void)application:(UIApplication *)application didRegisterForRemoteNotificationsWithDeviceToken:(NSData *)deviceToken
 {
  [RNCPushNotificationIOS didRegisterForRemoteNotificationsWithDeviceToken:deviceToken];
 }
 // Required for the notification event. You must call the completion handler after handling the remote notification.
 - (void)application:(UIApplication *)application didReceiveRemoteNotification:(NSDictionary *)userInfo
 fetchCompletionHandler:(void (^)(UIBackgroundFetchResult))completionHandler
 {
   NSLog(@"Got a PUSH NOTIFICATION");

   NSString *eventType = userInfo[@"event"];
   NSLog(@"Value of eventType = %@", eventType);

   if ([eventType isEqualToString:@"cancel"])
   {
     NSString *calluuid = userInfo[@"session-id"];
     BOOL active = [RNCallKeep isCallActive:calluuid];

     if (active) {
       [RNCallKeep endCallWithUUID:calluuid reason:2];

     }
     return completionHandler(UIBackgroundFetchResultNoData);
   }

   [RNCPushNotificationIOS didReceiveRemoteNotification:userInfo fetchCompletionHandler:completionHandler];
 }
 // Required for the registrationError event.
 - (void)application:(UIApplication *)application didFailToRegisterForRemoteNotificationsWithError:(NSError *)error
 {
  [RNCPushNotificationIOS didFailToRegisterForRemoteNotificationsWithError:error];
 }
 // IOS 10+ Required for localNotification event
 - (void)userNotificationCenter:(UNUserNotificationCenter *)center
 didReceiveNotificationResponse:(UNNotificationResponse *)response
          withCompletionHandler:(void (^)(void))completionHandler
 {
   [RNCPushNotificationIOS didReceiveNotificationResponse:response];
   completionHandler();
 }
 // IOS 4-10 Required for the localNotification event.
 - (void)application:(UIApplication *)application didReceiveLocalNotification:(UILocalNotification *)notification
 {
  [RNCPushNotificationIOS didReceiveLocalNotification:notification];
 }


// --- Handle updated push credentials
- (void)pushRegistry:(PKPushRegistry *)registry didUpdatePushCredentials:(PKPushCredentials *)credentials forType:(PKPushType)type {
  // Register VoIP push token (a property of PKPushCredentials) with server
  [RNVoipPushNotificationManager didUpdatePushCredentials:credentials forType:(NSString *)type];
}

- (void)pushRegistry:(PKPushRegistry *)registry didInvalidatePushTokenForType:(PKPushType)type
{
  // --- The system calls this method when a previously provided push token is no longer valid for use. No action is necessary on your part to reregister the push type. Instead, use this method to notify your server not to send push notifications using the matching push token.
}


// --- Handle incoming pushes (for ios <= 10)
- (void)pushRegistry:(PKPushRegistry *)registry didReceiveIncomingPushWithPayload:(PKPushPayload *)payload forType:(PKPushType)type {
  [RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:payload forType:(NSString *)type];
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

  [RNVoipPushNotificationManager addCompletionHandler:calluuid completionHandler:completion];

  //you can't do this check - you HAVE to call reportNewIncomingCall otherwise apple will start killing your app
  if ([[UIApplication sharedApplication] applicationState] != UIApplicationStateActive) {

     [RNCallKeep reportNewIncomingCall: calluuid
                             handle: handle
                         handleType: @"generic"
                           hasVideo: [mediaType isEqualToString:@"video"]
                localizedCallerName: callerName
                    supportsHolding: NO
                       supportsDTMF: YES
                   supportsGrouping: YES
                 supportsUngrouping: YES
                        fromPushKit: YES
                            payload: payload.dictionaryPayload
              withCompletionHandler: completion];
  }
  // }
  // else {
  //completion();
  // }
}

@end
