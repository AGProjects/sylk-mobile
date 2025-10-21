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

@implementation AppDelegate

#pragma mark - Background downloader
- (void)application:(UIApplication *)application handleEventsForBackgroundURLSession:(NSString *)identifier completionHandler:(void (^)(void))completionHandler
{
  [RNBackgroundDownloader setCompletionHandlerWithIdentifier:identifier completionHandler:completionHandler];
}

#pragma mark - Application launch
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"Sylk";

  if ([FIRApp defaultApp] == nil) {
    [FIRApp configure];
  }

  // Set UNUserNotificationCenter delegate
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  center.delegate = self;

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

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
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
        NSLog(@"[DB Debug] Recursively searching in: %@", dir);

        NSDirectoryEnumerator *enumerator = [fm enumeratorAtPath:dir];
        NSString *file;
        BOOL found = NO;

        while ((file = [enumerator nextObject])) {
            if ([[file lastPathComponent] isEqualToString:dbName]) {
                NSString *fullPath = [dir stringByAppendingPathComponent:file];
                NSLog(@"[DB Debug] Found sylk.db at: %@", fullPath);
                found = YES;
                break; // stop at first match
            }
        }

        if (!found) {
            NSLog(@"[DB Debug] sylk.db not found in %@", dir);
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
                NSLog(@"[Push DB] Found database at: %@", dbPath);
                return dbPath;
            }
        }
    }

    NSLog(@"[Push DB] sylk.db not found in any known location");
    return nil;
}

- (NSDictionary *)getContactsByTagForAccount:(NSString *)account {
    NSLog(@"[Push DB] getContactsByTagForAccount called with account = %@", account);

    NSMutableArray *allContacts = [NSMutableArray array];
    NSMutableArray *blockedContacts = [NSMutableArray array];

    @try {
        NSString *dbPath = [self sylkDatabasePath];
        if (!dbPath) return @{ @"all": @[], @"blocked": @[] };

        sqlite3 *db = NULL;
        if (sqlite3_open([dbPath UTF8String], &db) != SQLITE_OK) {
            NSLog(@"[Push DB] Failed to open database, returning empty arrays");
            return @{ @"all": @[], @"blocked": @[] };
        }

        sqlite3_stmt *stmt = NULL;
        const char *sql = "SELECT uri, tags FROM contacts WHERE account = ?";

        if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
            sqlite3_bind_text(stmt, 1, [account UTF8String], -1, SQLITE_TRANSIENT);

            while (sqlite3_step(stmt) == SQLITE_ROW) {
                NSString *uri = nil;
                NSString *tags = nil;

                const char *cUri = (const char *)sqlite3_column_text(stmt, 0);
                if (cUri) uri = [NSString stringWithUTF8String:cUri];

                const char *cTags = (const char *)sqlite3_column_text(stmt, 1);
                if (cTags) tags = [NSString stringWithUTF8String:cTags];

                if (uri) [allContacts addObject:[uri lowercaseString]];
                if (tags && [tags.lowercaseString containsString:@"block"] && uri) {
                    [blockedContacts addObject:[uri lowercaseString]];
                }
            }

            sqlite3_finalize(stmt);
        } else {
            NSLog(@"[Push DB] Failed to prepare statement, returning empty arrays");
        }

        sqlite3_close(db);

    } @catch (NSException *exception) {
        NSLog(@"[Push DB] Exception in getContactsByTagForAccount: %@ - %@, returning empty arrays", exception.name, exception.reason);
    }

    NSLog(@"[Push DB] Returning contacts: all=%lu blocked=%lu",
          (unsigned long)allContacts.count, (unsigned long)blockedContacts.count);

    return @{ @"all": allContacts ?: @[], @"blocked": blockedContacts ?: @[] };
}

- (BOOL)isAccountActive:(NSString *)account fromUri:(NSString *)fromUri allUrisSet:(NSSet<NSString *> *)uniqueUris {
    if (account.length == 0) {
        NSLog(@"[Push DB] isAccountActive called with empty account, returning YES (fail-safe)");
        return YES;
    }

    NSFileManager *fm = [NSFileManager defaultManager];
    NSString *dbPath = [self sylkDatabasePath];

    if (!dbPath || ![fm fileExistsAtPath:dbPath]) {
        NSLog(@"[Push DB] Database file not found, returning YES (fail-safe allow call)");
        return YES;
    }

    sqlite3 *db = NULL;
    sqlite3_stmt *stmt = NULL;
    BOOL isActive = YES; // default allow
    BOOL isDnd = NO;
    BOOL rejectAnonymous = NO;
    BOOL rejectNonContacts = NO;

    @try {
        if (sqlite3_open([dbPath UTF8String], &db) != SQLITE_OK) {
            NSLog(@"[Push DB] Failed to open database, returning YES (fail-safe)");
            return YES;
        }

        NSString *query = @"SELECT active, dnd, reject_anonymous, reject_non_contacts FROM accounts WHERE account = ?";
        if (sqlite3_prepare_v2(db, [query UTF8String], -1, &stmt, NULL) != SQLITE_OK) {
            NSLog(@"[Push DB] Failed to prepare statement, returning YES (fail-safe)");
            return YES;
        }

        if (sqlite3_bind_text(stmt, 1, [account UTF8String], -1, SQLITE_TRANSIENT) != SQLITE_OK) {
            NSLog(@"[Push DB] Failed to bind account parameter, returning YES (fail-safe)");
            return YES;
        }

        if (sqlite3_step(stmt) == SQLITE_ROW) {
            const unsigned char *activeStr = sqlite3_column_text(stmt, 0);
            const unsigned char *dndStr = sqlite3_column_text(stmt, 1);
            const unsigned char *rejectAnonStr = sqlite3_column_text(stmt, 2);
            const unsigned char *rejectNonContactsStr = sqlite3_column_text(stmt, 3);

            isActive = (activeStr != NULL) ? ([@(sqlite3_column_double(stmt, 0)) doubleValue] != 0) : YES;
            isDnd = (dndStr != NULL) ? ([@(sqlite3_column_double(stmt, 1)) doubleValue] != 0) : NO;
            rejectAnonymous = (rejectAnonStr != NULL) ? ([@(sqlite3_column_double(stmt, 2)) doubleValue] != 0) : NO;
            rejectNonContacts = (rejectNonContactsStr != NULL) ? ([@(sqlite3_column_double(stmt, 3)) doubleValue] != 0) : NO;

            NSLog(@"[Push DB] account flags: active=%@ dnd=%@ rejectAnonymous=%@ rejectNonContacts=%@",
                  isActive ? @"YES" : @"NO",
                  isDnd ? @"YES" : @"NO",
                  rejectAnonymous ? @"YES" : @"NO",
                  rejectNonContacts ? @"YES" : @"NO");
        } else {
            NSLog(@"[Push DB] No account row found for %@, defaulting to allow call", account);
        }
    } @catch (NSException *ex) {
        NSLog(@"[Push DB] Exception checking account rules: %@ - %@, proceeding anyway", ex.name, ex.reason);
        isActive = YES; // fail-safe
    } @finally {
        if (stmt) sqlite3_finalize(stmt);
        if (db) sqlite3_close(db);
    }

    // --- apply call rules ---
    if (rejectNonContacts && ![uniqueUris containsObject:fromUri]) {
        NSLog(@"[Push DB] Caller %@ not in contacts", fromUri);
        return NO;
    }

    if (([fromUri containsString:@"anonymous"] || [fromUri containsString:@"@guest."]) && rejectAnonymous) {
        NSLog(@"[Push DB] Anonymous caller %@", fromUri);
        return NO;
    }

    if (isDnd) {
        NSLog(@"[Push DB] DND active");
        return NO;
    }

    if (!isActive) {
        NSLog(@"[Push DB] Account inactive");
        return NO;
    }

    return YES; // always allow, but logs show what would have been rejected
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
  return [RCTLinkingManager application:application openURL:url options:options];
}

#pragma mark - Foreground notification handling
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler
{
  completionHandler(UNNotificationPresentationOptionNone);
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
    NSLog(@"[APNs] Device token: %@", hexToken);

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
  NSLog(@"[VoIP Push] Failed to register for remote notifications: %@", error);
  [RNCPushNotificationIOS didFailToRegisterForRemoteNotificationsWithError:error];
}


- (void)application:(UIApplication *)application didReceiveRemoteNotification:(NSDictionary *)userInfo
                                              fetchCompletionHandler:(void (^)(UIBackgroundFetchResult))completionHandler
{
  NSLog(@"[VoIP Push] Got a notification");

  NSString *eventType = userInfo[@"event"];
  NSLog(@"Value of eventType = %@", eventType);

  if ([eventType isEqualToString:@"cancel"]) {
      NSString *calluuid = userInfo[@"session-id"];
      BOOL active = [RNCallKeep isCallActive:calluuid];
      if (active) {
          [RNCallKeep endCallWithUUID:calluuid reason:2];
      }
      return completionHandler(UIBackgroundFetchResultNoData);
  }

  [RNCPushNotificationIOS didReceiveRemoteNotification:userInfo fetchCompletionHandler:completionHandler];
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
    NSLog(@"[VoIP Push notification] Raw Payload: %@", userInfo);

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

    NSLog(@"[VoIP Push] event = %@", event);
    NSLog(@"[VoIP Push] calluuid = %@", calluuid);
    NSLog(@"[VoIP Push] callId = %@", callId);
    NSLog(@"[VoIP Push] mediaType = %@", mediaType);
    NSLog(@"[VoIP Push] callerName = %@", callerName);
    NSLog(@"[VoIP Push] fromUri = %@", fromUri);
    NSLog(@"[VoIP Push] toUri = %@", toUri);
    NSLog(@"[VoIP Push] account = %@", account);

    // --- cancel event ---
    if ([event isEqualToString:@"cancel"]) {
        if (calluuid.length > 0 && [RNCallKeep isCallActive:calluuid]) {
            [RNCallKeep endCallWithUUID:calluuid reason:2];
        }
        if (completion) completion();
        return;
    }

    // --- only handle incoming_session or incoming_conference_request ---
    if (!([event isEqualToString:@"incoming_session"] || [event isEqualToString:@"incoming_conference_request"])) {
        [RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:payload forType:(NSString *)type];
        if (completion) completion();
        return;
    }

    // --- determine lookup account ---
    NSString *lookupAccount = ([event isEqualToString:@"incoming_session"]) ? toUri : account;
    NSLog(@"[VoIP Push] lookupAccount = %@", lookupAccount);

    // --- fetch contacts safely ---
    NSDictionary *contactsMap = @{ @"all": @[], @"blocked": @[] };
    @try {
        contactsMap = [self getContactsByTagForAccount:lookupAccount];
        NSLog(@"[VoIP Push] fetched contacts for account %@", lookupAccount);
    } @catch (NSException *ex) {
        NSLog(@"[VoIP Push] Exception fetching contacts: %@ - %@", ex.name, ex.reason);
        contactsMap = @{ @"all": @[], @"blocked": @[] };
    }

    NSArray *allUris = contactsMap[@"all"] ?: @[];
    NSArray *blocked = contactsMap[@"blocked"] ?: @[];
    NSSet<NSString *> *uniqueUris = [NSSet setWithArray:allUris];

    NSLog(@"[VoIP Push] allUris = %@", allUris);
    NSLog(@"[VoIP Push] blocked = %@", blocked);

    BOOL accountAllowed = YES;
    @try {
        accountAllowed = [self isAccountActive:lookupAccount fromUri:fromUri allUrisSet:uniqueUris];
    } @catch (NSException *ex) {
        NSLog(@"[VoIP Push] Exception checking account rules: %@ - %@", ex.name, ex.reason);
        accountAllowed = YES; // fail-safe allow call
    }
    
    if(!accountAllowed) {
        if (completion) completion();
        return;
    }

    // --- check blocked list ---
    if ([blocked containsObject:fromUri]) {
        NSLog(@"[VoIP Push] Caller %@ is blocked", fromUri);
        if (completion) completion();
        return;
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
            NSLog(@"[VoIP Push] Exception reporting CallKit call: %@ - %@", ex.name, ex.reason);
            if (completion) completion();
        }
    } else {
        // app active: let RN/UI handle it, call completion immediately
        if (completion) completion();
    }
}


@end
