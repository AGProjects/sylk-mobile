/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import <RCTAppDelegate.h>
#import <UIKit/UIKit.h>
#import <UserNotifications/UNUserNotificationCenter.h>
#import <React/RCTBridgeDelegate.h>

@interface AppDelegate : RCTAppDelegate <RCTBridgeDelegate>

// Needed for APNSTokenModule to send cached tokens
@property (nonatomic, strong) NSString *cachedAPNSToken;

// Reference to the bridge (required to get module instance)
@property (nonatomic, strong) RCTBridge *bridge;

// Triggers the iOS user-notification permission prompt + APNs
// registration. Used to be invoked unconditionally in
// didFinishLaunchingWithOptions, which surfaced the OS prompt before
// the user had even seen the app's login screen. Now exposed as a
// JS-callable hook (APNSTokenModule.requestNotificationPermission)
// so JS can fire it only after the first successful login.
- (void)requestPushNotificationPermission;

@end
