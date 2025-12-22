/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#import "APNSTokenModule.h"
#import "AppDelegate.h"
#import <Firebase.h>
#import <FirebaseMessaging/FirebaseMessaging.h>
#import <React/RCTBundleURLProvider.h>
#import <WebRTC/RTCLogging.h>
#import <React/RCTLog.h>
#import <PushKit/PushKit.h>
@import Firebase;
#import "RNCallKeep.h"
#import "RNVoipPushNotificationManager.h"
#import <UserNotifications/UserNotifications.h>
#import <RNCPushNotificationIOS.h>
#import <RNBackgroundDownloader.h>
#import <React/RCTLinkingManager.h>
#import <sqlite3.h>
#import "APNSTokenModule.h"
#import <UserNotifications/UserNotifications.h>
#import <React/RCTBridge.h>
#import <React/RCTEventDispatcher.h>
#import <React/RCTBundleURLProvider.h>
#import <React/RCTRootView.h>
#import <AVFoundation/AVFoundation.h>

@interface AppDelegate () <UNUserNotificationCenterDelegate>
- (BOOL)shouldDisplayMessageFromPayload:(NSDictionary *)userInfo;
@end

@implementation AppDelegate

#pragma mark - Background downloader
- (void)application:(UIApplication *)application handleEventsForBackgroundURLSession:(NSString *)identifier completionHandler:(void (^)(void))completionHandler
{
  [RNBackgroundDownloader setCompletionHandlerWithIdentifier:identifier completionHandler:completionHandler];
}

#pragma mark - Application launch
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
    UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
    center.delegate = self;
    
    AVAudioSession *session = [AVAudioSession sharedInstance]; [session setCategory:AVAudioSessionCategoryAmbient withOptions:AVAudioSessionCategoryOptionMixWithOthers error:nil];
    
    self.moduleName = @"Sylk";

    NSLog(@"[sylk_app] Application launch");

  if ([FIRApp defaultApp] == nil) {
    [FIRApp configure];
  }
    
 // React Native setup
  RCTBridge *bridge = [[RCTBridge alloc] initWithDelegate:self launchOptions:launchOptions];
  RCTRootView *rootView = [[RCTRootView alloc] initWithBridge:bridge
                                                   moduleName:@"Sylk"
                                            initialProperties:nil];
  self.window = [[UIWindow alloc] initWithFrame:[UIScreen mainScreen].bounds];
  UIViewController *rootViewController = [UIViewController new];
  rootViewController.view = rootView;
  self.window.rootViewController = rootViewController;
  [self.window makeKeyAndVisible];

  // --- Register notification categories ---
  [self registerNotificationCategories];
  
  // Set UNUserNotificationCenter delegate
  // Register for normal push notifications (required for APNs token)
  if (@available(iOS 10.0, *)) {
      UNAuthorizationOptions authOptions = UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge;
      [center requestAuthorizationWithOptions:authOptions
                            completionHandler:^(BOOL granted, NSError * _Nullable error) {
          if (granted) {
              dispatch_async(dispatch_get_main_queue(), ^{
                  [application registerForRemoteNotifications];
              });
          }
      }];
  } else {
      UIUserNotificationType allNotificationTypes = (UIUserNotificationTypeAlert | UIUserNotificationTypeSound | UIUserNotificationTypeBadge);
      UIUserNotificationSettings *settings = [UIUserNotificationSettings settingsForTypes:allNotificationTypes categories:nil];
      [application registerUserNotificationSettings:settings];
      [application registerForRemoteNotifications];
  }

   return YES;

  //return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (void)applicationDidBecomeActive:(UIApplication *)application
{
  NSLog(@"[sylk_app] Application ready");
}

- (void)registerNotificationCategories
{
  UNNotificationAction *answerAction = [UNNotificationAction actionWithIdentifier:@"ANSWER_ACTION"
                                                                            title:@"Answer"
                                                                          options:UNNotificationActionOptionForeground];
  UNNotificationAction *declineAction = [UNNotificationAction actionWithIdentifier:@"DECLINE_ACTION"
                                                                             title:@"Decline"
                                                                           options:UNNotificationActionOptionDestructive];

  UNNotificationCategory *callCategory = [UNNotificationCategory categoryWithIdentifier:@"INCOMING_CALL"
                                                                                actions:@[answerAction, declineAction]
                                                                      intentIdentifiers:@[]
                                                                                options:UNNotificationCategoryOptionCustomDismissAction];

  [[UNUserNotificationCenter currentNotificationCenter] setNotificationCategories:[NSSet setWithObject:callCategory]];
}


- (void)emitCachedAPNSToken {
    if (self.cachedAPNSToken) {
        APNSTokenModule *module = [self.bridge moduleForClass:[APNSTokenModule class]];
        if (module) {
            [module sendTokenToJS:self.cachedAPNSToken];
        }
        self.cachedAPNSToken = nil;
    }
}

- (void)debugFindSylkDatabase {
    NSFileManager *fm = [NSFileManager defaultManager];
    NSString *dbName = @"sylk.db";

    NSArray<NSString *> *searchDirs = @[
        [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject],
        [NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES) firstObject],
        [[NSBundle mainBundle] bundlePath]
    ];

    for (NSString *dir in searchDirs) {
        //NSLog(@"[DB Debug] Recursively searching in: %@", dir);

        NSDirectoryEnumerator *enumerator = [fm enumeratorAtPath:dir];
        NSString *file;
        BOOL found = NO;

        while ((file = [enumerator nextObject])) {
            if ([[file lastPathComponent] isEqualToString:dbName]) {
                NSString *fullPath = [dir stringByAppendingPathComponent:file];
                //NSLog(@"[DB Debug] Found sylk.db at: %@", fullPath);
                found = YES;
                break; // stop at first match
            }
        }

        if (!found) {
            //NSLog(@"[DB Debug] sylk.db not found in %@", dir);
        }
    }
}

- (NSString *)sylkDatabasePath {
    NSFileManager *fm = [NSFileManager defaultManager];
    NSString *dbName = @"sylk.db";

    NSArray<NSString *> *dirsToCheck = @[
        [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject],
        [NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES) firstObject],
        [NSSearchPathForDirectoriesInDomains(NSLibraryDirectory, NSUserDomainMask, YES) firstObject], // add Library/
        [[NSBundle mainBundle] bundlePath]
    ];

    for (NSString *baseDir in dirsToCheck) {
        NSArray<NSString *> *subdirs = @[@"", @"LocalDatabase"]; // check base + LocalDatabase subfolder
        for (NSString *sub in subdirs) {
            NSString *fullDir = [baseDir stringByAppendingPathComponent:sub];
            NSString *dbPath = [fullDir stringByAppendingPathComponent:dbName];
            if ([fm fileExistsAtPath:dbPath]) {
                //NSLog(@"[sylk_app] Found database at: %@", dbPath);
                return dbPath;
            }
        }
    }

    NSLog(@"[sylk_app] sylk.db not found in any known location");
    return nil;
}

- (NSArray<NSString *> * _Nullable)getTagsForContact:(NSString *)account uri:(NSString *)uri {
    NSArray<NSString *> *tagsList = nil; // nil → contact not found

    @try {
        NSString *dbPath = [self sylkDatabasePath];
        if (!dbPath) {
            NSLog(@"[sylk_app] Database file not found");
            return nil;
        }

        sqlite3 *db = NULL;
        if (sqlite3_open([dbPath UTF8String], &db) != SQLITE_OK) {
            NSLog(@"[sylk_app] Failed to open database at path %@", dbPath);
            return nil;
        }

        sqlite3_stmt *stmt = NULL;
        const char *sql = "SELECT tags FROM contacts WHERE account = ? AND uri = ?";

        if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
            sqlite3_bind_text(stmt, 1, [account UTF8String], -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(stmt, 2, [uri UTF8String], -1, SQLITE_TRANSIENT);

            if (sqlite3_step(stmt) == SQLITE_ROW) {
                const char *cTags = (const char *)sqlite3_column_text(stmt, 0);
                if (cTags) {
                    NSString *tags = [NSString stringWithUTF8String:cTags];
                    tags = [tags stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
                    
                    if (tags.length > 0) {
                        NSArray *rawTags = [tags componentsSeparatedByString:@","];
                        NSMutableArray *cleanTags = [NSMutableArray array];
                        for (NSString *t in rawTags) {
                            NSString *clean = [[t stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] lowercaseString];
                            if (clean.length > 0) {
                                [cleanTags addObject:clean];
                            }
                        }
                        tagsList = cleanTags;
                    } else {
                        // Contact exists but has no tags
                        tagsList = @[];
                    }
                } else {
                    // Contact exists but tags column is NULL
                    tagsList = @[];
                }
            }

            sqlite3_finalize(stmt);
        } else {
            NSLog(@"[sylk_app] Failed to prepare statement for getTagsForContact");
        }

        sqlite3_close(db);

    } @catch (NSException *exception) {
        NSLog(@"[sylk_app] Exception in getTagsForContact: %@ - %@", exception.name, exception.reason);
    }

	NSString *joined = (tagsList.count > 0)
		? [tagsList componentsJoinedByString:@","]
		: @"<none>";
	
	NSLog(@"[sylk_app] Tags for %@: %@", uri, joined);
    return tagsList;
}

- (BOOL)isBlocked:(NSArray<NSString *> * _Nullable)contactTags {
    if (!contactTags) return NO; // nil → contact does not exist → not blocked

    for (NSString *tag in contactTags) {
        if (tag && [tag caseInsensitiveCompare:@"blocked"] == NSOrderedSame) {
            return YES;
        }
    }
    return NO;
}

- (BOOL)canBypassDnd:(NSArray<NSString *> * _Nullable)contactTags {
    if (!contactTags) return NO; // nil → cannot bypass

    for (NSString *tag in contactTags) {
        if (tag && [tag caseInsensitiveCompare:@"bypassdnd"] == NSOrderedSame) {
            return YES;
        }
    }
    return NO;
}

- (BOOL)isMuted:(NSArray<NSString *> * _Nullable)contactTags {
    if (!contactTags) return NO; // nil → not muted

    for (NSString *tag in contactTags) {
        if (tag && [tag caseInsensitiveCompare:@"muted"] == NSOrderedSame) {
            return YES;
        }
    }
    return NO;
}

- (BOOL)isAccountActive:(NSString *)account
                fromUri:(NSString *)fromUri
            contactTags:(NSArray<NSString *> * _Nullable)contactTags {

    if (!account || account.length == 0) {
        NSLog(@"[sylk_app] isAccountActive called with nil or empty account, returning NO");
        return NO;
    }

    NSFileManager *fm = [NSFileManager defaultManager];
    NSString *dbPath = [self sylkDatabasePath];

    if (!dbPath || ![fm fileExistsAtPath:dbPath]) {
        NSLog(@"[sylk_app] Database file not found at %@, returning NO", dbPath);
        return NO;
    }

    sqlite3 *db = NULL;
    sqlite3_stmt *stmt = NULL;
    BOOL isActive = NO;
    BOOL isDnd = NO;
    BOOL rejectAnonymous = NO;
    BOOL rejectNonContacts = NO;

    @try {
        if (sqlite3_open([dbPath UTF8String], &db) != SQLITE_OK) {
            NSLog(@"[sylk_app] Failed to open database, returning NO");
            return NO;
        }

        NSString *query = @"SELECT active, dnd, reject_anonymous, reject_non_contacts FROM accounts WHERE account = ?";
        if (sqlite3_prepare_v2(db, [query UTF8String], -1, &stmt, NULL) != SQLITE_OK) {
            NSLog(@"[sylk_app] Failed to prepare statement, returning NO");
            return NO;
        }

        sqlite3_bind_text(stmt, 1, [account UTF8String], -1, SQLITE_TRANSIENT);

        if (sqlite3_step(stmt) == SQLITE_ROW) {
            isActive = (sqlite3_column_text(stmt, 0) && sqlite3_column_text(stmt, 0)[0] == '1');
            isDnd = (sqlite3_column_text(stmt, 1) && sqlite3_column_text(stmt, 1)[0] == '1');
            rejectAnonymous = (sqlite3_column_text(stmt, 2) && sqlite3_column_text(stmt, 2)[0] == '1');
            rejectNonContacts = (sqlite3_column_text(stmt, 3) && sqlite3_column_text(stmt, 3)[0] == '1');

            NSLog(@"[sylk_app] account flags: active=%@ dnd=%@ rejectAnonymous=%@ rejectNonContacts=%@",
                  isActive ? @"YES" : @"NO",
                  isDnd ? @"YES" : @"NO",
                  rejectAnonymous ? @"YES" : @"NO",
                  rejectNonContacts ? @"YES" : @"NO");
        }

    } @catch (NSException *ex) {
        NSLog(@"[sylk_app] Exception checking account status: %@ - %@", ex.name, ex.reason);
        return NO;
    } @finally {
        if (stmt) sqlite3_finalize(stmt);
        if (db) sqlite3_close(db);
    }

    // --- apply call rules ---

    // Only allow calls from known contacts
    if (rejectNonContacts && !contactTags) {
        NSLog(@"[sylk_app] Caller %@ not in contacts, rejecting call", fromUri);
        [self showRejectedCallNotification:fromUri reason:@"not in contacts list"];
        return NO;
    }

    // Anonymous caller check
    if (([fromUri containsString:@"anonymous"] || [fromUri containsString:@"@guest."]) && rejectAnonymous) {
        NSLog(@"[sylk_app] Anonymous caller %@ rejected", fromUri);
        [self showRejectedCallNotification:fromUri reason:@"anonymous caller"];
        return NO;
    }

    // Do Not Disturb
    if (isDnd) {
        NSLog(@"[sylk_app] DND active, rejecting call from %@", fromUri);
        [self showRejectedCallNotification:fromUri reason:@"Do not disturb now"];
        return NO;
    }

    if (!isActive) {
        NSLog(@"[sylk_app] Account %@ is not active, rejecting call", account);
        return NO;
    }

    return YES;
}


// helper - show simple local notification for rejected calls (optional)
- (void)showRejectedCallNotification:(NSString *)fromUri reason:(NSString *)reason {
  NSString *contentText = [NSString stringWithFormat:@"%@ rejected: %@", fromUri ?: @"Unknown", reason ?: @"blocked"];
  UNMutableNotificationContent *content = [UNMutableNotificationContent new];
  content.title = @"Sylk call rejected";
  content.body  = contentText;
  content.sound = [UNNotificationSound defaultSound];

  // deliver immediately
  UNTimeIntervalNotificationTrigger *trigger = [UNTimeIntervalNotificationTrigger triggerWithTimeInterval:0.1 repeats:NO];
  NSString *reqId = [[NSUUID UUID] UUIDString];
  UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:reqId content:content trigger:trigger];
  [[UNUserNotificationCenter currentNotificationCenter] addNotificationRequest:request withCompletionHandler:nil];
}

#pragma mark - Open URL (Deep linking)
- (BOOL)application:(UIApplication *)application
            openURL:(NSURL *)url
            options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options
{
  NSLog(@"[sylk_share] openURL called: %@", url);
  return [RCTLinkingManager application:application openURL:url options:options];
}

#pragma mark - Foreground notification handling
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler
{
    // Full APNS payload
       NSDictionary *userInfo = notification.request.content.userInfo;

       // Your custom payload (the inner "data" dict)
       NSDictionary *data = userInfo[@"data"];
       if (![data isKindOfClass:[NSDictionary class]]) {
           data = @{}; // prevent crash
       }

       // Example usage:
       NSString *event = [data[@"event"] lowercaseString];
       NSString *fromUri = [[data[@"from_uri"] lowercaseString] copy];
       NSString *toUri   = [[data[@"to_uri"] lowercaseString] copy];

       NSString *activeChat = [[NSUserDefaults standardUserDefaults] stringForKey:@"activeChatJID"];
       if (activeChat != nil && [fromUri isEqualToString:[activeChat lowercaseString]]) {
           NSLog(@"[sylk_app] Suppressing foreground notification for %@", fromUri);
           completionHandler(UNNotificationPresentationOptionNone); // do not show banner/sound
           return;
       }

       NSLog(@"[sylk_app] willPresentNotification event=%@ from=%@ to=%@", event, fromUri, toUri);

       // If you want to apply filtering:
       BOOL allow = [self shouldDisplayMessageFromPayload:data];

       if (!allow) {
           NSLog(@"[sylk_app] Foreground notification suppressed");
           completionHandler(UNNotificationPresentationOptionNone);
           return;
       }
    
  completionHandler(UNNotificationPresentationOptionAlert | UNNotificationPresentationOptionSound | UNNotificationPresentationOptionBadge);
}

#pragma mark - Continue user activity (e.g., CallKeep)
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

#pragma mark - React Native bundle
- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

#pragma mark - RNCPushNotificationIOS hooks
- (void)application:(UIApplication *)application didRegisterUserNotificationSettings:(UIUserNotificationSettings *)notificationSettings
{
  [RNCPushNotificationIOS didRegisterUserNotificationSettings:notificationSettings];
}

- (NSString *)hexStringFromDeviceToken:(NSData *)deviceToken {
    const unsigned char *dataBuffer = (const unsigned char *)[deviceToken bytes];
    if (!dataBuffer) return @"";
    NSMutableString *hexString  = [NSMutableString stringWithCapacity:(deviceToken.length * 2)];
    for (int i = 0; i < deviceToken.length; ++i) {
        [hexString appendFormat:@"%02x", dataBuffer[i]];
    }
    return [hexString copy];
}

- (void)application:(UIApplication *)application didRegisterForRemoteNotificationsWithDeviceToken:(NSData *)deviceToken
{
    NSString *hexToken = [self hexStringFromDeviceToken:deviceToken];
    NSLog(@"[sylk_app] Device token: %@", hexToken);

    // Send token to RN via APNSTokenModule
    APNSTokenModule *module = [self.bridge moduleForClass:[APNSTokenModule class]];
 
    self.cachedAPNSToken = hexToken;
    // Send to JS if bridge is ready

    // Also register with FIRMessaging
    [FIRMessaging messaging].APNSToken = deviceToken;

    // RNCPushNotificationIOS still expects this
    [RNCPushNotificationIOS didRegisterForRemoteNotificationsWithDeviceToken:deviceToken];
}

- (void)application:(UIApplication *)application didFailToRegisterForRemoteNotificationsWithError:(NSError *)error
{
  NSLog(@"[sylk_app] Failed to register for remote notifications: %@", error);
  [RNCPushNotificationIOS didFailToRegisterForRemoteNotificationsWithError:error];
}


- (void)application:(UIApplication *)application
didReceiveRemoteNotification:(NSDictionary *)userInfo
fetchCompletionHandler:(void (^)(UIBackgroundFetchResult))completionHandler
{

    NSString *(^coerceString)(id) = ^NSString *(id obj) {
        if ([obj isKindOfClass:[NSString class]]) return obj;
        if ([obj isKindOfClass:[NSNumber class]]) return [obj stringValue];
        return @"";
    };

    NSDictionary *data = userInfo[@"data"];
    NSString *event = coerceString(data[@"event"]);
    NSString *fromUri = [[coerceString(data[@"from_uri"]) lowercaseString] copy];
    NSString *toUri = [[coerceString(data[@"to_uri"]) lowercaseString] copy];

    NSLog(@"[sylk_app] Received %@ notification from %@ to %@", event, fromUri, toUri);

    // --- Handle 'cancel' event (existing logic) ---
    if ([event isEqualToString:@"cancel"]) {
        NSString *calluuid = userInfo[@"session-id"] ?: userInfo[@"data"][@"session-id"];
        BOOL active = [RNCallKeep isCallActive:calluuid];
        if (active) {
            [RNCallKeep endCallWithUUID:calluuid reason:2];
        }
        return completionHandler(UIBackgroundFetchResultNoData);
    }

    // --- Handle 'message' event (NEW LOGIC) ---
    if ([event isEqualToString:@"message"]) {
        //NSLog(@"[sylk_app] Incoming message payload: %@", userInfo);

        BOOL allow = [self shouldDisplayMessageFromPayload:data];
        
        if (!allow) {
            NSLog(@"[sylk_app] Message notification suppressed");
            return completionHandler(UIBackgroundFetchResultNoData);
        }
    }

    // --- Deliver notification to React Native ---
    [RNCPushNotificationIOS didReceiveRemoteNotification:userInfo
                                 fetchCompletionHandler:completionHandler];
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
 didReceiveNotificationResponse:(UNNotificationResponse *)response
          withCompletionHandler:(void (^)(void))completionHandler
{
  [RNCPushNotificationIOS didReceiveNotificationResponse:response];
  completionHandler();
}

- (void)application:(UIApplication *)application didReceiveLocalNotification:(UILocalNotification *)notification
{
  [RNCPushNotificationIOS didReceiveLocalNotification:notification];
}

#pragma mark - VoIP push handlers
- (void)pushRegistry:(PKPushRegistry *)registry didUpdatePushCredentials:(PKPushCredentials *)credentials forType:(PKPushType)type
{
  [RNVoipPushNotificationManager didUpdatePushCredentials:credentials forType:(NSString *)type];
}

- (void)pushRegistry:(PKPushRegistry *)registry didInvalidatePushTokenForType:(PKPushType)type
{
  // Token invalidated, notify server if necessary
}


- (void)pushRegistry:(PKPushRegistry *)registry
didReceiveIncomingPushWithPayload:(PKPushPayload *)payload
               forType:(PKPushType)type
    withCompletionHandler:(void (^)(void))completion
{
    NSDictionary *userInfo = payload.dictionaryPayload ?: @{};
    //NSLog(@"[sylk_app]Raw Payload: %@", userInfo);

    // --- nil-safe extraction ---
    NSString *(^coerceString)(id) = ^NSString *(id obj) {
        if ([obj isKindOfClass:[NSString class]]) return obj;
        if ([obj isKindOfClass:[NSNumber class]]) return [obj stringValue];
        return @"";
    };

    NSString *event = coerceString(userInfo[@"event"]);
    NSString *calluuid = coerceString(userInfo[@"session-id"]);
    NSString *callId = coerceString(userInfo[@"call-id"]);
    NSString *mediaType = coerceString(userInfo[@"media-type"]);
    NSString *callerName = coerceString(userInfo[@"from_display_name"]);
    NSString *fromUri = [[coerceString(userInfo[@"from_uri"]) lowercaseString] copy];
    NSString *toUri = [[coerceString(userInfo[@"to_uri"]) lowercaseString] copy];
    NSString *account = [[coerceString(userInfo[@"account"]) lowercaseString] copy];

    /*
    NSLog(@"[sylk_app] calluuid = %@", calluuid);
    NSLog(@"[sylk_app] callId = %@", callId);
    NSLog(@"[sylk_app] mediaType = %@", mediaType);
    NSLog(@"[sylk_app] callerName = %@", callerName);
    NSLog(@"[sylk_app] fromUri = %@", fromUri);
    NSLog(@"[sylk_app] toUri = %@", toUri);
    NSLog(@"[sylk_app] account = %@", account);
    */
    NSLog(@"[sylk_app] Received %@ from %@ to %@", event, fromUri, toUri);

    // --- only handle incoming_session or incoming_conference_request ---
    if (!([event isEqualToString:@"incoming_session"] || [event isEqualToString:@"incoming_conference_request"])) {
        [RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:payload forType:(NSString *)type];
        if (completion) completion();
        return;
    }

    BOOL allow = [self shouldDisplayMessageFromPayload:userInfo];
    
    if (!allow) {
        NSLog(@"[sylk_app] Notification suppressed");
        if (completion) completion();
    }

    // --- pass payload to RN side ---
    [RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:payload forType:(NSString *)type];

    // --- report to CallKit only if app is not active ---
    if ([[UIApplication sharedApplication] applicationState] != UIApplicationStateActive) {
        [RNVoipPushNotificationManager addCompletionHandler:calluuid completionHandler:completion];

        @try {
            [RNCallKeep reportNewIncomingCall: calluuid
                                       handle: fromUri
                                   handleType: @"generic"
                                     hasVideo: [mediaType isEqualToString:@"video"]
                          localizedCallerName: callerName
                              supportsHolding: NO
                                 supportsDTMF: YES
                             supportsGrouping: YES
                           supportsUngrouping: YES
                                  fromPushKit: YES
                                      payload: payload.dictionaryPayload
                        withCompletionHandler:^(void){
                            // completion handled by RNVoipPushNotificationManager
                        }];
        } @catch (NSException *ex) {
            NSLog(@"[sylk_app] Exception reporting CallKit call: %@ - %@", ex.name, ex.reason);
            if (completion) completion();
        }
    } else {
        // app active: let RN/UI handle it, call completion immediately
        if (completion) completion();
    }
}

- (BOOL)shouldDisplayMessageFromPayload:(NSDictionary *)data
{
    NSString *(^coerceString)(id) = ^NSString *(id obj) {
        if ([obj isKindOfClass:[NSString class]]) return obj;
        if ([obj isKindOfClass:[NSNumber class]]) return [obj stringValue];
        return @"";
    };

    // ---- 1. Read and validate event ----
    NSString *event = [[coerceString(data[@"event"]) stringByTrimmingCharactersInSet:
                        [NSCharacterSet whitespaceAndNewlineCharacterSet]] lowercaseString];

    if (event.length == 0) {
        //NSLog(@"[sylk_app] Missing event");
        return NO;
    }

    // Only care about these events
	BOOL isIncomingSession = [event isEqualToString:@"incoming_session"];
	BOOL isIncomingConf    = [event isEqualToString:@"incoming_conference_request"];
	BOOL isCancel          = [event isEqualToString:@"cancel"];
	BOOL isMessage         = [event isEqualToString:@"message"];

	if (!isIncomingSession && !isIncomingConf && !isCancel && !isMessage) {
		return NO;   // other events → deny
	}

	// ---- Determine lookupAccount ----
	NSString *lookupAccount = nil;


    NSString *toUri = coerceString(data[@"to_uri"]);
    toUri = [[toUri stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] lowercaseString];

    if (toUri.length == 0) {
        NSLog(@"[sylk_app] Missing toUri");
        return NO;
    }

    NSString *fromUri = coerceString(data[@"from_uri"]);
    fromUri = [[fromUri stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] lowercaseString];

    if (fromUri.length == 0) {
        NSLog(@"[sylk_app] Missing fromUri");
        return NO;
    }

	if (isMessage) {
		lookupAccount = toUri;
		// message_id
		NSString *messageId = coerceString(data[@"message_id"]);
		messageId = [messageId stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
		if (messageId.length == 0) {
			NSLog(@"[sylk_app] Message error: missing messageId");
			return NO;
		}
		NSLog(@"[sylk_app] %@ %@ from %@ to %@", event, messageId, fromUri, lookupAccount);
	}

    if (isIncomingConf || isIncomingSession || isCancel) {
		NSString *callId = coerceString(data[@"session-id"]);
		callId = [callId stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
		if (callId.length == 0) {
			NSLog(@"[sylk_app] Missing call id");
			return NO;
		}

		if (isCancel) {
			return YES;
		}

		if (isIncomingConf) {
			lookupAccount = [[coerceString(data[@"account"])
							  stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]]
							 lowercaseString];
		
			if (lookupAccount.length == 0) {
				NSLog(@"[sylk_app] Missing account for conference request");
				return NO;
			}
		}

		if (isIncomingSession) {
			lookupAccount = toUri;
		}

		NSLog(@"[sylk_app] %@ %@ from %@ to %@", event, callId, fromUri, lookupAccount);
	}

	NSArray<NSString *> *tags = nil;
	@try {
		tags = [self getTagsForContact:lookupAccount uri:fromUri];
	} @catch (...) {
		tags = nil;
	}

	if (![self isAccountActive:lookupAccount fromUri:fromUri contactTags:tags]) {
		NSLog(@"[sylk_app] Request rejected by account rules");
		return NO;
	}

	// Blocked?
	if ([self isBlocked:tags]) {
		NSLog(@"[sylk_app] Message from %@ is blocked", fromUri);
		return NO;
	}

	// Muted?
	if ([self isMuted:tags]) {
		NSLog(@"[sylk_app] Skipping notification: user %@ is muted", fromUri);
		return NO;
	}

    return YES;
}


@end
