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
#import "Contact.h"
#import "SylkLogger.h"

@interface AppDelegate () <UNUserNotificationCenterDelegate>
@property (nonatomic, strong) NSMutableDictionary<NSString *, dispatch_source_t> *autoAnswerTimers;
- (BOOL)shouldDisplayMessageFromPayload:(NSDictionary *)userInfo;
- (NSString *)readSipBridgeDomainForAccount:(NSString *)account;
- (void)postInConferenceMissedCallNotificationFrom:(NSString *)fromUri event:(NSString *)event;
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

    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(onCallAnswered:)
                                                 name:@"RNCallKeepCallAnswered"
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(onCallEnded:)
                                                 name:@"RNCallKeepCallEnded"
                                               object:nil];

    self.autoAnswerTimers = [NSMutableDictionary new];

    // Clear the inConference flag on every app launch. The flag is
    // owned by JS — set at conference 'established', cleared at
    // 'terminated' — but if the process was force-killed mid-
    // conference or crashed before the terminated handler ran, the
    // NSUserDefaults entry persists and the next incoming-call push
    // gets wrongly suppressed as "in conference". Resetting at boot
    // guarantees a clean slate; JS re-sets it when a real conference
    // is in progress.
    [[NSUserDefaults standardUserDefaults] setBool:NO forKey:@"inConference"];

    AVAudioSession *session = [AVAudioSession sharedInstance]; [session setCategory:AVAudioSessionCategoryAmbient withOptions:AVAudioSessionCategoryOptionMixWithOthers error:nil];
    
    self.moduleName = @"Sylk";

    [SylkLogger log:@"[app] Application launch"];

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
  // Defining the categories (action buttons for Answer / Decline etc.)
  // is metadata only — it does NOT surface a permission prompt — so
  // we still do this at launch. The actual prompt was moved out of
  // didFinishLaunchingWithOptions; see -requestPushNotificationPermission
  // below, called from JS after first successful login.
  [self registerNotificationCategories];

   return YES;

  //return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (void)applicationDidBecomeActive:(UIApplication *)application
{
    [SylkLogger log:@"[app] Application ready"];
    for (NSString *uuid in self.autoAnswerTimers.allKeys) {
        [self cancelAutoAnswerForUUID:uuid];
    }
}

// Surfaces the iOS user-notification permission prompt and, on grant,
// registers for APNs. Pulled out of -application:didFinishLaunching… so
// it only fires when JS asks for it (after first successful login).
// Calling this when permission is already granted is a no-op for the
// user — iOS won't re-prompt — and harmlessly re-runs the APNs
// registration, which is idempotent.
- (void)requestPushNotificationPermission
{
    UIApplication *application = [UIApplication sharedApplication];
    [SylkLogger log:@"[push] requestPushNotificationPermission called from JS"];
    if (@available(iOS 10.0, *)) {
        UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
        UNAuthorizationOptions authOptions = UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge;
        [center requestAuthorizationWithOptions:authOptions
                              completionHandler:^(BOOL granted, NSError * _Nullable error) {
            [SylkLogger log:@"[push] requestAuthorization granted=%d error=%@", granted, error];
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
        //[SylkLogger log:@"[app] [db] Recursively searching in: %@", dir];

        NSDirectoryEnumerator *enumerator = [fm enumeratorAtPath:dir];
        NSString *file;
        BOOL found = NO;

        while ((file = [enumerator nextObject])) {
            if ([[file lastPathComponent] isEqualToString:dbName]) {
                NSString *fullPath = [dir stringByAppendingPathComponent:file];
                [SylkLogger log:@"[app] [db] Found sylk.db at: %@", fullPath];
                found = YES;
                break; // stop at first match
            }
        }

        if (!found) {
            //[SylkLogger log:@"[app] [db] sylk.db not found in %@", dir];
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
                //[SylkLogger log:@"[app] Found database at: %@", dbPath];
                return dbPath;
            }
        }
    }

    [SylkLogger log:@"[app] sylk.db not found in any known location"];
    return nil;
}

- (Contact * _Nullable)getContact:(NSString *)account uri:(NSString *)uri {

    Contact *contact = nil; // nil → contact not found

    @try {
        NSString *dbPath = [self sylkDatabasePath];
        if (!dbPath) {
            [SylkLogger log:@"[app] Database file not found"];
            return nil;
        }

        sqlite3 *db = NULL;
        if (sqlite3_open([dbPath UTF8String], &db) != SQLITE_OK) {
            [SylkLogger log:@"[app] Failed to open database at path %@", dbPath];
            return nil;
        }

        sqlite3_stmt *stmt = NULL;
        const char *sql = "SELECT name, tags FROM contacts WHERE account = ? AND uri = ?";

        if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {

            sqlite3_bind_text(stmt, 1, [account UTF8String], -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(stmt, 2, [uri UTF8String], -1, SQLITE_TRANSIENT);

            if (sqlite3_step(stmt) == SQLITE_ROW) {

                // ---- NAME ----
                NSString *displayName = nil;
                const char *cName = (const char *)sqlite3_column_text(stmt, 0);
                if (cName) {
                    displayName = [NSString stringWithUTF8String:cName];
                    displayName = [displayName stringByTrimmingCharactersInSet:
                        [NSCharacterSet whitespaceAndNewlineCharacterSet]];

                    if (displayName.length == 0) {
                        displayName = nil;
                    }
                }

                // ---- TAGS ----
                NSMutableArray *cleanTags = [NSMutableArray array];

                const char *cTags = (const char *)sqlite3_column_text(stmt, 1);
                if (cTags) {
                    NSString *tags = [NSString stringWithUTF8String:cTags];
                    tags = [tags stringByTrimmingCharactersInSet:
                        [NSCharacterSet whitespaceAndNewlineCharacterSet]];

                    if (tags.length > 0) {
                        NSArray *rawTags = [tags componentsSeparatedByString:@","];
                        for (NSString *t in rawTags) {
                            NSString *clean =
                                [[t stringByTrimmingCharactersInSet:
                                  [NSCharacterSet whitespaceCharacterSet]] lowercaseString];

                            if (clean.length > 0) {
                                [cleanTags addObject:clean];
                            }
                        }
                    }
                }

                contact = [[Contact alloc] initWithDisplayName:displayName
                                                          tags:cleanTags];
            }

            sqlite3_finalize(stmt);
        } else {
            [SylkLogger log:@"[app] Failed to prepare statement for getContact"];
        }

        sqlite3_close(db);

    } @catch (NSException *exception) {
        [SylkLogger log:@"[app] Exception in getContact: %@ - %@", exception.name, exception.reason];
    }

    if (contact) {
        NSString *joined = (contact.tags.count > 0)
            ? [contact.tags componentsJoinedByString:@","]
            : @"<none>";

        [SylkLogger log:@"[app] Contact found: %@ | tags: %@", contact.displayName, joined];
    }

    return contact;
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

- (BOOL)shouldAutoAnswer:(NSArray<NSString *> * _Nullable)contactTags {
    if (!contactTags) return NO;

    for (NSString *tag in contactTags) {
        if (tag && [tag caseInsensitiveCompare:@"autoanswer"] == NSOrderedSame) {
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
        [SylkLogger log:@"[app] isAccountActive called with nil or empty account, returning NO"];
        return NO;
    }

    NSFileManager *fm = [NSFileManager defaultManager];
    NSString *dbPath = [self sylkDatabasePath];

    if (!dbPath || ![fm fileExistsAtPath:dbPath]) {
        [SylkLogger log:@"[app] Database file not found at %@, returning NO", dbPath];
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
            [SylkLogger log:@"[app] Failed to open database, returning NO"];
            return NO;
        }

        // Privacy flags (dnd / rejectAnonymous / rejectNonContacts) live
        // inside accounts.settings as a JSON blob:
        //   { "privacy": { "dnd": bool, "rejectAnonymous": bool,
        //                  "rejectNonContacts": bool, ... }, ... }
        // We pull the raw text and parse it with NSJSONSerialization.
        //
        // The `settings` column is guaranteed to exist by the JS boot
        // path (upgradeSQLTables -> ensureColumn pair), so the
        // previous fallback to the legacy per-column query has been
        // removed. If prepare fails for any reason, fail open.
        NSString *query = @"SELECT active, settings FROM accounts WHERE account = ?";
        if (sqlite3_prepare_v2(db, [query UTF8String], -1, &stmt, NULL) != SQLITE_OK) {
            [SylkLogger log:@"[app] Failed to prepare statement (%s), returning NO",
                  sqlite3_errmsg(db) ?: "unknown"];
            return NO;
        }

        sqlite3_bind_text(stmt, 1, [account UTF8String], -1, SQLITE_TRANSIENT);

        if (sqlite3_step(stmt) == SQLITE_ROW) {
            isActive = (sqlite3_column_text(stmt, 0) && sqlite3_column_text(stmt, 0)[0] == '1');

            const unsigned char *settingsTextRaw = sqlite3_column_text(stmt, 1);
            if (settingsTextRaw) {
                NSString *settingsText = [NSString stringWithUTF8String:(const char *)settingsTextRaw];
                NSData *settingsData = [settingsText dataUsingEncoding:NSUTF8StringEncoding];
                NSError *jsonErr = nil;
                id parsed = [NSJSONSerialization JSONObjectWithData:settingsData
                                                            options:0
                                                              error:&jsonErr];
                if (!jsonErr && [parsed isKindOfClass:[NSDictionary class]]) {
                    NSDictionary *privacy = parsed[@"privacy"];
                    if ([privacy isKindOfClass:[NSDictionary class]]) {
                        isDnd            = [privacy[@"dnd"]               boolValue];
                        rejectAnonymous  = [privacy[@"rejectAnonymous"]   boolValue];
                        rejectNonContacts= [privacy[@"rejectNonContacts"] boolValue];
                    }
                } else if (jsonErr) {
                    [SylkLogger log:@"[app] settings JSON parse failed: %@ — failing open",
                          jsonErr.localizedDescription];
                }
            }
            // If settings column is NULL or unparseable, every flag
            // stays at its initialised NO, which is fail-open (call
            // rings, no rejection). Same semantics as a fresh-install
            // account with no preferences set yet.

            [SylkLogger log:@"[app] account flags (from settings JSON): active=%@ dnd=%@ rejectAnonymous=%@ rejectNonContacts=%@",
                  isActive ? @"YES" : @"NO",
                  isDnd ? @"YES" : @"NO",
                  rejectAnonymous ? @"YES" : @"NO",
                  rejectNonContacts ? @"YES" : @"NO"];
        }

    } @catch (NSException *ex) {
        [SylkLogger log:@"[app] Exception checking account status: %@ - %@", ex.name, ex.reason];
        return NO;
    } @finally {
        if (stmt) sqlite3_finalize(stmt);
        if (db) sqlite3_close(db);
    }

    // --- apply call rules ---

    // Only allow calls from known contacts
    if (rejectNonContacts && !contactTags) {
        [SylkLogger log:@"[app] Caller %@ not in contacts, rejecting call", fromUri];
        [self showRejectedCallNotification:fromUri reason:@"not in contacts list"];
        return NO;
    }

    // Anonymous caller check
    if (([fromUri containsString:@"anonymous"] || [fromUri containsString:@"@guest."]) && rejectAnonymous) {
        [SylkLogger log:@"[app] Anonymous caller %@ rejected", fromUri];
        [self showRejectedCallNotification:fromUri reason:@"anonymous caller"];
        return NO;
    }

    // App DND (privacy.dnd in accounts.settings JSON) used to reject
    // the call here. It no longer does. The caller is expected to
    // re-read the same flag via isAppDndOn: and decide whether to
    // suppress the ringtone — app DND now means "deliver the push
    // silently", not "drop it". (isDnd is intentionally still read
    // above so the log line continues to show the current value for
    // diagnostics.)
    (void)isDnd;

    if (!isActive) {
        [SylkLogger log:@"[app] Account %@ is not active, rejecting call", account];
        return NO;
    }

    return YES;
}

/**
 * Read the in-app DND flag (privacy.dnd in accounts.settings JSON)
 * for the given account. Returns NO if the row is missing, the
 * JSON is malformed, the DB is locked, or anything else goes wrong
 * — same fail-open posture as isAccountActive. Mirrors exactly the
 * read isAccountActive does so the two paths can't disagree.
 */
- (BOOL)isAppDndOn:(NSString *)account {
    if (!account || account.length == 0) return NO;

    NSFileManager *fm = [NSFileManager defaultManager];
    NSString *dbPath = [self sylkDatabasePath];
    if (!dbPath || ![fm fileExistsAtPath:dbPath]) return NO;

    sqlite3 *db = NULL;
    sqlite3_stmt *stmt = NULL;
    BOOL dnd = NO;

    @try {
        if (sqlite3_open([dbPath UTF8String], &db) != SQLITE_OK) {
            [SylkLogger log:@"[app] isAppDndOn: failed to open DB (failing OFF)"];
            return NO;
        }

        const char *sql = "SELECT settings FROM accounts WHERE account = ?";
        if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) != SQLITE_OK) {
            [SylkLogger log:@"[app] isAppDndOn: prepare failed (failing OFF) — %s",
                  sqlite3_errmsg(db) ?: "unknown"];
            return NO;
        }

        sqlite3_bind_text(stmt, 1, [account UTF8String], -1, SQLITE_TRANSIENT);

        if (sqlite3_step(stmt) == SQLITE_ROW) {
            const unsigned char *settingsRaw = sqlite3_column_text(stmt, 0);
            if (settingsRaw) {
                NSString *settingsText = [NSString stringWithUTF8String:(const char *)settingsRaw];
                NSData *data = [settingsText dataUsingEncoding:NSUTF8StringEncoding];
                NSError *err = nil;
                id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:&err];
                if (!err && [parsed isKindOfClass:[NSDictionary class]]) {
                    NSDictionary *privacy = ((NSDictionary *)parsed)[@"privacy"];
                    if ([privacy isKindOfClass:[NSDictionary class]]) {
                        dnd = [privacy[@"dnd"] boolValue];
                    }
                }
            }
        }
    } @catch (NSException *ex) {
        [SylkLogger log:@"[app] isAppDndOn: read failed (failing OFF) — %@", ex.reason];
        return NO;
    } @finally {
        if (stmt) sqlite3_finalize(stmt);
        if (db) sqlite3_close(db);
    }

    return dnd;
}


// Silent local notification used when an incoming-call / conference-
// invite push is dropped because the user is mid-conference. No
// custom sound — the OS will use the user's normal notification
// channel settings (silent if their device is silenced / focused).
// Posted with category "missed_call" so iOS surfaces it in the
// missed-call cluster on the lockscreen.
- (void)postInConferenceMissedCallNotificationFrom:(NSString *)fromUri event:(NSString *)event {
  NSString *who = (fromUri.length > 0) ? fromUri : @"Unknown";
  NSString *bodyText = [event isEqualToString:@"incoming_conference_request"]
        ? [NSString stringWithFormat:@"Conference invite from %@ (you were in a conference)", who]
        : [NSString stringWithFormat:@"From %@ (you were in a conference)", who];

  UNMutableNotificationContent *content = [UNMutableNotificationContent new];
  content.title = @"Missed call";
  content.body = bodyText;
  content.categoryIdentifier = @"missed_call";
  // No content.sound — silent on iOS unless the user has the app
  // set to ring; the request was explicitly for a silent push.

  UNTimeIntervalNotificationTrigger *trigger =
        [UNTimeIntervalNotificationTrigger triggerWithTimeInterval:0.1 repeats:NO];
  NSString *reqId = [[NSUUID UUID] UUIDString];
  UNNotificationRequest *request =
        [UNNotificationRequest requestWithIdentifier:reqId content:content trigger:trigger];
  [[UNUserNotificationCenter currentNotificationCenter] addNotificationRequest:request
                                                         withCompletionHandler:nil];
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
    [SylkLogger log:@"[app] openURL called: %@", url.absoluteString];

    if ([url.scheme isEqualToString:@"sylk"] &&
        [url.host isEqualToString:@"share"]) {

        NSURLComponents *components = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
        NSString *source = nil;

        for (NSURLQueryItem *item in components.queryItems) {
            if ([item.name isEqualToString:@"source"]) {
                source = item.value;
                break;
            }
        }

        if ([source isEqualToString:@"extension"]) {
            [SylkLogger log:@"[app] Launched from Share Extension"];
            return YES;
        }
    }

    return [RCTLinkingManager application:application openURL:url options:options];
}


#pragma mark - Foreground notification handling
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler
{
    // Full APNS payload
       NSDictionary *userInfo = notification.request.content.userInfo;
       // %s + UTF8String of [obj description] to bypass unified-logging <private> redaction.
       [SylkLogger log:@"[app] willPresentNotification userInfo: %s",
             [[userInfo description] UTF8String]];

       // Your custom payload (the inner "data" dict)
       NSDictionary *data = userInfo[@"data"];
       if (![data isKindOfClass:[NSDictionary class]]) {
           data = @{}; // prevent crash
       }

       NSString *event = [data[@"event"] lowercaseString];
       NSString *fromUri = [[data[@"from_uri"] lowercaseString] copy];
       NSString *toUri   = [[data[@"to_uri"] lowercaseString] copy];

       // Meeting milestone banners ("You are close to each other",
       // "Nice to meet you!", "Meeting point reached: <peer> arrived")
       // must always present, even when the user is currently in the
       // peer's chat. They are not message notifications — they are
       // session milestones that fire at most once per meeting, and
       // suppressing them defeats their whole purpose. They also fall
       // through shouldDisplayMessageFromPayload below (unknown event ->
       // returns NO), so we short-circuit with a banner here.
       //
       // Keep this list in sync with the JS side: any `event` value
       // sent through sendLocalNotification with bypass-throttle in
       // app.js should be exempt here too, otherwise active-chat
       // suppression silently swallows the banner.
       BOOL isMeetingMilestone = ([event isEqualToString:@"meeting_proximity_near"] ||
                                  [event isEqualToString:@"meeting_proximity_met"] ||
                                  [event isEqualToString:@"meeting_arrived"] ||
                                  [event isEqualToString:@"meeting_succeeded"] ||
                                  [event isEqualToString:@"meeting_proximity_alert"]);
       if (isMeetingMilestone) {
           [SylkLogger log:@"[app] presenting meeting milestone banner event=%@ from=%@", event, fromUri];
           UNNotificationPresentationOptions mpOptions;
           if (@available(iOS 14.0, *)) {
               mpOptions = UNNotificationPresentationOptionBanner |
                           UNNotificationPresentationOptionList |
                           UNNotificationPresentationOptionSound;
           } else {
               mpOptions = UNNotificationPresentationOptionAlert |
                           UNNotificationPresentationOptionSound;
           }
           completionHandler(mpOptions);
           return;
       }

       NSString *activeChat = [[NSUserDefaults standardUserDefaults] stringForKey:@"activeChatJID"];
       if (activeChat != nil && [fromUri isEqualToString:[activeChat lowercaseString]]) {
           [SylkLogger log:@"[app] Skip notification for active chat with %@", fromUri];
           completionHandler(UNNotificationPresentationOptionNone); // do not show banner/sound
           return;
       }

       // If you want to apply filtering:
       BOOL allow = [self shouldDisplayMessageFromPayload:data];

       if (!allow) {
           [SylkLogger log:@"[app] Skip notification"];
           completionHandler(UNNotificationPresentationOptionNone);
           return;
       }

        // Use %s + [obj UTF8String] instead of %@ so iOS unified
        // logging doesn't redact the values to <private>. NSLog routes
        // through os_log with default privacy = private for %@; %s is
        // treated as public.
        [SylkLogger log:@"[app] willPresentNotification event=%s from=%s to=%s",
              [(event   ?: @"(nil)") UTF8String],
              [(fromUri ?: @"(nil)") UTF8String],
              [(toUri   ?: @"(nil)") UTF8String]];

  // iOS 14+ split UNNotificationPresentationOptionAlert into .banner (the bubble
  // at the top of the screen) and .list (the entry in Notification Center).
  // Passing just .alert on iOS 14+ is deprecated and can end up as list-only on
  // iOS 17/18/26 — the notification lands in the shade but no banner pops up.
  // Use .banner + .list explicitly when available.
  UNNotificationPresentationOptions options;
  if (@available(iOS 14.0, *)) {
      options = UNNotificationPresentationOptionBanner |
                UNNotificationPresentationOptionList |
                UNNotificationPresentationOptionSound |
                UNNotificationPresentationOptionBadge;
  } else {
      options = UNNotificationPresentationOptionAlert |
                UNNotificationPresentationOptionSound |
                UNNotificationPresentationOptionBadge;
  }
  completionHandler(options);
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
    [SylkLogger log:@"[app] Device token: %@", hexToken];

    // Send token to RN via APNSTokenModule
    // APNSTokenModule *module = [self.bridge moduleForClass:[APNSTokenModule class]];
 
    self.cachedAPNSToken = hexToken;
    // Send to JS if bridge is ready

    // Also register with FIRMessaging
    [FIRMessaging messaging].APNSToken = deviceToken;

    // RNCPushNotificationIOS still expects this
    [RNCPushNotificationIOS didRegisterForRemoteNotificationsWithDeviceToken:deviceToken];
}

- (void)application:(UIApplication *)application didFailToRegisterForRemoteNotificationsWithError:(NSError *)error
{
  [SylkLogger log:@"[app] Failed to register for remote notifications: %@", error];
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

    // %s + UTF8String to bypass unified-logging <private> redaction.
    [SylkLogger log:@"[app] Received %s notification from %s to %s",
          [(event   ?: @"(nil)") UTF8String],
          [(fromUri ?: @"(nil)") UTF8String],
          [(toUri   ?: @"(nil)") UTF8String]];

    // --- Handle 'cancel' event (existing logic) ---
    if ([event isEqualToString:@"cancel"]) {
        NSString *calluuid = userInfo[@"session-id"] ?: userInfo[@"data"][@"session-id"];
        BOOL active = [RNCallKeep isCallActive:calluuid];
        if (active) {
            [RNCallKeep endCallWithUUID:calluuid reason:2];
        }
        [self cancelAutoAnswerForUUID:calluuid];
        return completionHandler(UIBackgroundFetchResultNoData);
    }

    // --- Handle 'message' event  ---
    if ([event isEqualToString:@"message"]) {
        //[SylkLogger log:@"[app] Incoming message payload: %@", userInfo];

        BOOL allow = [self shouldDisplayMessageFromPayload:data];

        if (!allow) {
            [SylkLogger log:@"[app] Message notification suppressed"];
            return completionHandler(UIBackgroundFetchResultNoData);
        }

        // Persist directly to sylk.db ONLY when the app is NOT in the
        // foreground. When foreground, the websocket connection delivers
        // the same msg_id and JS's saveIncomingMessage writes the row —
        // running the native INSERT in parallel would race against that
        // write and only ever no-op via INSERT OR IGNORE.
        UIApplicationState _insertAppState = [UIApplication sharedApplication].applicationState;
        if (_insertAppState == UIApplicationStateActive) {
            [SylkLogger log:@"[message] [apns] App is foreground — skipping native SQL insert; WS will deliver"];
        } else {
            NSString *(^coerceStr)(id) = ^NSString *(id obj) {
                if ([obj isKindOfClass:[NSString class]]) return obj;
                if ([obj isKindOfClass:[NSNumber class]]) return [obj stringValue];
                return @"";
            };
            NSString *messageId = [coerceStr(data[@"message_id"])
                                    stringByTrimmingCharactersInSet:
                                    [NSCharacterSet whitespaceAndNewlineCharacterSet]];
            NSString *msgContent = coerceStr(data[@"content"]);
            NSString *msgContentType = coerceStr(data[@"content_type"]);
            NSString *msgDisplayName = coerceStr(data[@"from_display_name"]);
            [self insertIncomingMessageToSqlForAccount:toUri
                                               fromUri:fromUri
                                             messageId:messageId
                                               content:msgContent
                                           contentType:msgContentType
                                           displayName:msgDisplayName];
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
  // First emit our own "user tapped a message notification" signal so
  // JS can navigate to the chat IMMEDIATELY. We do this BEFORE the
  // RNCPushNotificationIOS forward so the dedicated SylkPushTapped
  // listener wins the race against the generic 'notification' event
  // (the latter doesn't distinguish "delivered to OS" from "tapped by
  // user", forcing JS to guess).
  //
  // Mirrors the Android SylkDeepLink emit in MainActivity:
  // a synchronous DeviceEventEmitter event so the chat opens without
  // waiting for any AppState / lifecycle round-trip. On cold-start
  // taps the bridge may not be ready yet — RCTEventDispatcher gracefully
  // queues the emit until JS is up, OR self.bridge is nil and we
  // silently skip (the launch-time getInitialNotification path in JS
  // handles cold-start).
  @try {
      NSDictionary *userInfo = response.notification.request.content.userInfo;
      NSDictionary *data = userInfo[@"data"];
      if ([data isKindOfClass:[NSDictionary class]]) {
          NSString *event = data[@"event"];
          NSString *fromUri = data[@"from_uri"];
          if ([event isKindOfClass:[NSString class]]
              && [[event lowercaseString] isEqualToString:@"message"]
              && [fromUri isKindOfClass:[NSString class]]
              && fromUri.length > 0) {

              RCTBridge *bridge = self.bridge;
              if (bridge != nil) {
                  NSMutableDictionary *payload = [NSMutableDictionary dictionary];
                  payload[@"fromUri"] = fromUri;
                  if ([data[@"to_uri"] isKindOfClass:[NSString class]]) {
                      payload[@"toUri"] = data[@"to_uri"];
                  }
                  if ([data[@"message_id"] isKindOfClass:[NSString class]]) {
                      payload[@"messageId"] = data[@"message_id"];
                  }
                  [bridge.eventDispatcher
                      sendDeviceEventWithName:@"SylkPushTapped"
                                         body:payload];
                  [SylkLogger log:@"[app] SylkPushTapped emitted fromUri=%@", fromUri];
              } else {
                  [SylkLogger log:@"[app] SylkPushTapped skip: bridge nil (cold-start path will use getInitialNotification)"];
              }
          }
      }
  } @catch (NSException *exc) {
      [SylkLogger log:@"[app] SylkPushTapped emit threw: %@", exc.reason];
  }

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
    NSString *fromUri = [[coerceString(userInfo[@"from_uri"]) lowercaseString] copy];
    NSString *toUri = [[coerceString(userInfo[@"to_uri"]) lowercaseString] copy];
    NSString *account = [[coerceString(userInfo[@"account"]) lowercaseString] copy];
    NSString *remoteDisplayName = coerceString(userInfo[@"from_display_name"]);

    [SylkLogger log:@"[app] calluuid = %@", calluuid];
    [SylkLogger log:@"[app] callId = %@", callId];
    [SylkLogger log:@"[app] mediaType = %@", mediaType];
    [SylkLogger log:@"[app] remoteDisplayName = %@", remoteDisplayName];
    [SylkLogger log:@"[app] fromUri = %@", fromUri];
    [SylkLogger log:@"[app] toUri = %@", toUri];
    [SylkLogger log:@"[app] account = %@", account];
    [SylkLogger log:@"[app] Received push %@ from %@ to %@", event, fromUri, toUri];

    NSString *callerName = fromUri; // default fallback

    // --- only handle incoming_session or incoming_conference_request ---
    // NOTE: iOS REQUIRES every VoIP push to result in a CallKit reportNewIncomingCall
    // before completion() is called, even if we want to reject the call. Skipping this
    // triggers PKPushRegistry _terminateAppIfThereAreUnhandledVoIPPushes (SIGABRT).
    if (!([event isEqualToString:@"incoming_session"] || [event isEqualToString:@"incoming_conference_request"])) {
        [SylkLogger log:@"[app] Unsupported VoIP event '%@' — reporting+ending call to satisfy PushKit", event];
        [RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:payload forType:(NSString *)type];
        [self reportAndImmediatelyEndCallForPayload:payload
                                           calluuid:calluuid
                                            fromUri:fromUri
                                         completion:completion];
        return;
    }

    [SylkLogger log:@"[app] Raw Payload: %@", userInfo];

    BOOL allow = [self shouldDisplayMessageFromPayload:userInfo];

    if (!allow) {
        [SylkLogger log:@"[app] Notification suppressed — reporting+ending call to satisfy PushKit"];
        [self reportAndImmediatelyEndCallForPayload:payload
                                           calluuid:calluuid
                                            fromUri:fromUri
                                         completion:completion];
        return;
    }

    BOOL autoAnswer = NO;

    NSString *lookupAccount = [event isEqualToString:@"incoming_conference_request"] ? account : toUri;
    Contact *contact = nil;

    @try {
        contact = [self getContact:lookupAccount uri:fromUri];
    } @catch (...) {
        contact = nil;
    }
    
    NSArray<NSString *> *tags = contact ? contact.tags : @[];
    NSString *displayName = contact.displayName;
    
    if (!displayName || displayName.length == 0) {
        displayName = fromUri;
    }
    
    // Prefer contact display name
    if (contact.displayName.length > 0 &&
        ![contact.displayName isEqualToString:fromUri]) {

        callerName = contact.displayName;

    // Otherwise try remote display name from push
    } else if (remoteDisplayName.length > 0 &&
               ![remoteDisplayName isEqualToString:fromUri]) {

        callerName = remoteDisplayName;
    }

    [SylkLogger log:@"[app] displayName = %@", displayName];

    if (tags) {
        [SylkLogger log:@"[app] Contact tags for %@: %@",
              fromUri,
              tags.count ? [tags componentsJoinedByString:@", "] : @"<none>"];
    } else {
        [SylkLogger log:@"[app] Contact %@ not found in contacts (tags=nil)", fromUri];
    }

    autoAnswer = [self shouldAutoAnswer:tags];
    if (autoAnswer) {
        [SylkLogger log:@"[app] must autoAnswer"];
    }

    BOOL shouldScheduleAutoAnswer = autoAnswer && [UIApplication sharedApplication].applicationState == UIApplicationStateActive;

    if (autoAnswer && [UIApplication sharedApplication].applicationState != UIApplicationStateActive) {
        [SylkLogger log:@"[app] Cannot auto-answer if the app is not active"];
    }

    // App DND (privacy.dnd, the bell on the navbar) — soft gate:
    // let the push through but tell the JS side to skip the ringtone.
    // The CallKit hand-off still happens, so the call is visible and
    // answerable; only the in-app ring (the JS-side incoming-call UI
    // sound) is suppressed. Contacts tagged bypassdnd override and
    // ring normally. Mirrors the Android IncomingCallService
    // suppress_ringtone gate.
    //
    // NB: iOS's CallKit plays the system ringtone for VoIP pushes
    // and that is not silenceable per-call by a third-party app
    // (CXProviderConfiguration.ringtoneSound is provider-wide). So
    // "silent push" on iOS means the JS-side ringer is muted and
    // the system ringer rings only at whatever level the user has
    // configured at the OS Focus/Silent layer.
    BOOL appDnd = [self isAppDndOn:lookupAccount];
    BOOL bypass = [self canBypassDnd:tags];
    BOOL suppressRingtone = appDnd && !bypass;

    if (appDnd && bypass) {
        [SylkLogger log:@"[app] DND bypass for %@ (appDnd=YES)", fromUri];
    }
    if (suppressRingtone) {
        [SylkLogger log:@"[app] App DND on, delivering silent push for %@", fromUri];
    }

    // Stash the suppress_ringtone hint under the call UUID so the JS
    // side can pick it up when it wires up the incoming-call UI.
    if (calluuid.length > 0) {
        NSString *key = [NSString stringWithFormat:@"suppress_ringtone:%@",
                         [calluuid lowercaseString]];
        [[NSUserDefaults standardUserDefaults] setBool:suppressRingtone forKey:key];
    }

    // --- pass payload to RN side ---
    [RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:payload forType:(NSString *)type];

    // --- report to CallKit only if app is not active ---
    [RNVoipPushNotificationManager addCompletionHandler:calluuid completionHandler:completion];
    
    [SylkLogger log:@"[app] REPORTING CALL WITH NAME: %@", callerName];

    @try {
        [RNCallKeep reportNewIncomingCall: calluuid
                                   handle: callerName
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

        // >>> AUTO-ANSWER: schedule delayed answer
        if (shouldScheduleAutoAnswer) {
            [self scheduleAutoAnswerForUUID:calluuid delay:15];
        } else {
            [SylkLogger log:@"[app] Auto-answer is disabled"];
        }
        
    } @catch (NSException *ex) {
        [SylkLogger log:@"[app] Exception reporting CallKit call: %@ - %@", ex.name, ex.reason];
        if (completion) completion();
    }
}

// PushKit policy enforcement: every VoIP push must result in a CallKit
// reportNewIncomingCall before completion() fires, otherwise iOS aborts the app
// via -[PKPushRegistry _terminateAppIfThereAreUnhandledVoIPPushes].
//
// When we want to silently drop an incoming VoIP push (DND, blocked contact,
// muted contact, anonymous caller, account inactive, unsupported event, etc.)
// we still have to report a call to CallKit and then immediately end it. This
// satisfies the assertion without producing a visible/audible ring.
- (void)reportAndImmediatelyEndCallForPayload:(PKPushPayload *)payload
                                     calluuid:(NSString *)calluuid
                                      fromUri:(NSString *)fromUri
                                   completion:(void (^)(void))completion
{
    NSString *uuid = (calluuid.length > 0) ? calluuid : [[NSUUID UUID] UUIDString];
    NSString *handle = (fromUri.length > 0) ? fromUri : @"Unknown";

    [SylkLogger log:@"[app] Reporting+ending suppressed VoIP call uuid=%@ handle=%@", uuid, handle];

    @try {
        // Queue the end BEFORE reportNewIncomingCall's completion
        // fires. Previously endCallWithUUID lived inside the
        // withCompletionHandler block, which means iOS first
        // presented the CallKit UI, then fired completion, then we
        // ended the call — leaving a visible flash. Issuing the end
        // immediately after the report (still on the same run-loop
        // turn) lets CXProvider coalesce the two transactions: the
        // report goes in, the end is already queued, and many iOS
        // versions skip the UI presentation entirely or shorten it
        // to a single frame.
        //
        // Reason is CXCallEndedReason.answeredElsewhere (4) instead
        // of .declinedElsewhere (6). Apple's CallKit pipeline treats
        // .answeredElsewhere as "this call was handled on another
        // device" and tears the UI down without animating the
        // "declined" / missed-call sweep — observably faster.
        // Missed-call entry is still surfaced via our own
        // postInConferenceMissedCallNotificationFrom local
        // notification on the suppression paths that need it.
        [RNCallKeep reportNewIncomingCall:uuid
                                   handle:handle
                               handleType:@"generic"
                                 hasVideo:NO
                      localizedCallerName:handle
                          supportsHolding:NO
                             supportsDTMF:NO
                         supportsGrouping:NO
                       supportsUngrouping:NO
                              fromPushKit:YES
                                  payload:payload.dictionaryPayload
                    withCompletionHandler:^{
            if (completion) completion();
        }];
        [RNCallKeep endCallWithUUID:uuid reason:4];
    } @catch (NSException *ex) {
        [SylkLogger log:@"[app] Exception in reportAndImmediatelyEnd: %@ - %@", ex.name, ex.reason];
        // Still call completion so we don't dangle, but at this point PushKit
        // will likely terminate us — this catch is just to surface the error.
        if (completion) completion();
    }
}

/**
 * Read the configured SIP-focus bridge host for a given account from
 * the accounts.settings JSON blob in sylk.db. JS persists it under
 * conference.sipBridge whenever initConfiguration ingests fresh
 * server config (see applySipBridgeDomain in app.js).
 *
 * Used by -shouldDisplayMessageFromPayload to drop the duplicate
 * "incoming_session" push that the conference focus SIP-dials in
 * parallel with the real "incoming_conference_request". Mirrors
 * exactly the privacy.dnd / rejectAnonymous / rejectNonContacts read
 * pattern in -isAccountActive (line ~380-422) — same DB path, same
 * SELECT, same NSJSONSerialization parse — just pulling a different
 * key out of the resulting dictionary.
 *
 * Returns nil if the row is missing, the JSON is malformed, the DB
 * is locked, or conference.sipBridge isn't set. Callers treat nil as
 * "dedupe disabled" (safe default — same posture as the surrounding
 * privacy-flags read path).
 */
- (NSString *)readSipBridgeDomainForAccount:(NSString *)account
{
    if (account.length == 0) return nil;

    NSString *dbPath = [self sylkDatabasePath];
    NSFileManager *fm = [NSFileManager defaultManager];
    if (!dbPath || ![fm fileExistsAtPath:dbPath]) {
        [SylkLogger log:@"[app] readSipBridgeDomain: database file not found"];
        return nil;
    }

    sqlite3 *db = NULL;
    sqlite3_stmt *stmt = NULL;
    NSString *sipBridge = nil;

    @try {
        if (sqlite3_open([dbPath UTF8String], &db) != SQLITE_OK) {
            [SylkLogger log:@"[app] readSipBridgeDomain: failed to open database"];
            return nil;
        }

        NSString *query = @"SELECT settings FROM accounts WHERE account = ?";
        if (sqlite3_prepare_v2(db, [query UTF8String], -1, &stmt, NULL) != SQLITE_OK) {
            [SylkLogger log:@"[app] readSipBridgeDomain: failed to prepare statement (%s)",
                  sqlite3_errmsg(db) ?: "unknown"];
            return nil;
        }

        sqlite3_bind_text(stmt, 1, [account UTF8String], -1, SQLITE_TRANSIENT);

        if (sqlite3_step(stmt) == SQLITE_ROW) {
            const unsigned char *settingsTextRaw = sqlite3_column_text(stmt, 0);
            if (settingsTextRaw) {
                NSString *settingsText = [NSString stringWithUTF8String:(const char *)settingsTextRaw];
                NSData *settingsData = [settingsText dataUsingEncoding:NSUTF8StringEncoding];
                NSError *jsonErr = nil;
                id parsed = [NSJSONSerialization JSONObjectWithData:settingsData
                                                            options:0
                                                              error:&jsonErr];
                if (!jsonErr && [parsed isKindOfClass:[NSDictionary class]]) {
                    NSDictionary *conference = parsed[@"conference"];
                    if ([conference isKindOfClass:[NSDictionary class]]) {
                        id raw = conference[@"sipBridge"];
                        if ([raw isKindOfClass:[NSString class]]) {
                            NSString *trimmed = [[(NSString *)raw stringByTrimmingCharactersInSet:
                                                  [NSCharacterSet whitespaceAndNewlineCharacterSet]]
                                                 lowercaseString];
                            if (trimmed.length > 0) sipBridge = trimmed;
                        }
                    }
                } else if (jsonErr) {
                    [SylkLogger log:@"[app] readSipBridgeDomain: settings JSON parse failed: %@",
                          jsonErr.localizedDescription];
                }
            }
        }
    } @catch (NSException *ex) {
        [SylkLogger log:@"[app] readSipBridgeDomain: exception: %@ - %@", ex.name, ex.reason];
        sipBridge = nil;
    } @finally {
        if (stmt) sqlite3_finalize(stmt);
        if (db) sqlite3_close(db);
    }

    return sipBridge;
}

- (BOOL)shouldDisplayMessageFromPayload:(NSDictionary *)data
{

    NSString *(^coerceString)(id) = ^NSString *(id obj) {
        if ([obj isKindOfClass:[NSString class]]) return obj;
        if ([obj isKindOfClass:[NSNumber class]]) return [obj stringValue];
        return @"";
    };

    [SylkLogger log:@"[app] -- shouldDisplayMessageFromPayload: %@", data];

    // ---- 1. Read and validate event ----
    NSString *event = [[coerceString(data[@"event"]) stringByTrimmingCharactersInSet:
                        [NSCharacterSet whitespaceAndNewlineCharacterSet]] lowercaseString];

    if (event.length == 0) {
        [SylkLogger log:@"[app] Missing event"];
        return NO;
    }

    // Only care about these events
	BOOL isIncomingSession = [event isEqualToString:@"incoming_session"];
	BOOL isIncomingConf    = [event isEqualToString:@"incoming_conference_request"];
	BOOL isCancel          = [event isEqualToString:@"cancel"];
	BOOL isMessage         = [event isEqualToString:@"message"];

	if (!isIncomingSession && !isIncomingConf && !isCancel && !isMessage) {
        [SylkLogger log:@"[app] Unsupported event"];
		return NO;
	}

	// ---- Determine lookupAccount ----
	NSString *lookupAccount = nil;

    NSString *toUri = coerceString(data[@"to_uri"]);
    toUri = [[toUri stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] lowercaseString];

    if (toUri.length == 0) {
        [SylkLogger log:@"[app] Missing toUri"];
        return NO;
    }

    NSString *fromUri = coerceString(data[@"from_uri"]);
    fromUri = [[fromUri stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] lowercaseString];

    if (fromUri.length == 0) {
        [SylkLogger log:@"[app] Missing fromUri"];
        return NO;
    }

	if (isMessage) {
		lookupAccount = toUri;
		// message_id
		NSString *messageId = coerceString(data[@"message_id"]);
		messageId = [messageId stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
		if (messageId.length == 0) {
			[SylkLogger log:@"[app] Message error: missing messageId"];
			return NO;
		}

        // Self-to-self suppression. Multi-device replication echoes
        // our own outgoing messages back to all our devices with
        // from_uri == to_uri == accountId. The cross-device call-
        // recording sync (saveCallRecording's selfMsg replication)
        // is the most visible offender — every recorded call would
        // trigger a banner here. Suppress at the native layer so
        // the OS never even queues the notification UI.
        if (fromUri.length > 0 && toUri.length > 0
                && [fromUri isEqualToString:toUri]) {
            [SylkLogger log:@"[app] Skipping notification: self-to-self message from %s",
                  [fromUri UTF8String]];
            return NO;
        }

        UIApplicationState state = [UIApplication sharedApplication].applicationState;
        if (state == UIApplicationStateActive) {
            [SylkLogger log:@"[app] App is foreground and active"];
        } else if (state == UIApplicationStateInactive) {
            [SylkLogger log:@"[app] App is foreground but inactive"];
        } else if (state == UIApplicationStateBackground) {
            [SylkLogger log:@"[app] App is in the background"];
        }

        // %s + UTF8String to bypass unified-logging <private> redaction.
        [SylkLogger log:@"[app] Message %s from %s to %s",
              [(messageId     ?: @"(nil)") UTF8String],
              [(fromUri       ?: @"(nil)") UTF8String],
              [(lookupAccount ?: @"(nil)") UTF8String]];

        return YES;
	}

    if (isIncomingConf || isIncomingSession || isCancel) {
		NSString *callId = coerceString(data[@"session-id"]);
		callId = [callId stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
		if (callId.length == 0) {
			[SylkLogger log:@"[app] Missing call id"];
			return NO;
		}

		if (isCancel) {
			return YES;
		}

		// In-conference gate. JS persists this flag via
		// SharedDataModule.setInConference on conference enter/leave.
		// When set, the active CallKit / WebRTC session for the
		// conference would be ripped apart by reporting a new
		// incoming CallKit call alongside it (CXProvider hands the
		// audio session over to the new call). Suppress the push;
		// the AppDelegate-level caller will route through
		// reportAndImmediatelyEndCallForPayload so PushKit's "every
		// push must reportNewIncomingCall" contract is still met,
		// and we surface a silent local notification so the user
		// sees a missed call after the conference ends.
		if ([[NSUserDefaults standardUserDefaults] boolForKey:@"inConference"]) {
			[SylkLogger log:@"[app] In conference, suppressing %@ from %@ (callId=%@)",
				event, fromUri, callId];
			[self postInConferenceMissedCallNotificationFrom:fromUri event:event];
			return NO;
		}

		if (isIncomingConf) {
			lookupAccount = [[coerceString(data[@"account"])
							  stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]]
							 lowercaseString];
		
			if (lookupAccount.length == 0) {
				[SylkLogger log:@"[app] Missing account for conference request"];
				return NO;
			}
		}

		if (isIncomingSession) {
			lookupAccount = toUri;

			// Drop the SIP-focus dial-in twin of a conferenceInvite.
			// When a sylk user invites someone to a conference, the
			// server sends BOTH:
			//   1) an "incoming_conference_request" push (the real
			//      sylk conference invite, from_uri = inviter),
			//   2) an "incoming_session" push generated by the
			//      conference focus SIP-dialing the invitee
			//      (from_uri = <room>@<sipBridge>).
			// They arrive ~1 s apart. With the app FOREGROUND the
			// second one is pure noise — the user is already looking
			// at the conference UI (or the incoming-invite alert) and
			// a second CallKit ring just adds confusion. With the app
			// BACKGROUNDED, however, the second push is the only
			// thing that gives the user a tap-target on the lock /
			// home screen to bring the app forward if they missed
			// the first one, so we keep it in that case.
			//
			// The sipBridge host is part of the per-account server
			// configuration that JS persists into the
			// accounts.settings JSON blob (conference.sipBridge) —
			// the same blob this method already reads for privacy.dnd
			// etc. in -isAccountActive: line 380-422. If from_uri's
			// host matches the stored value AND the app is currently
			// active, suppress this push. Empty / missing sipBridge
			// disables dedupe entirely (safe default).
			UIApplicationState _appState = [UIApplication sharedApplication].applicationState;
			BOOL _isAppActive = (_appState == UIApplicationStateActive);
			NSString *sipBridgeDomain = [self readSipBridgeDomainForAccount:lookupAccount];
			if (sipBridgeDomain.length > 0) {
				NSRange atRange = [fromUri rangeOfString:@"@"];
				if (atRange.location != NSNotFound
				    && atRange.location + 1 < fromUri.length) {
					NSString *host = [fromUri substringFromIndex:atRange.location + 1];
					NSRange semi = [host rangeOfString:@";"];
					if (semi.location != NSNotFound) {
						host = [host substringToIndex:semi.location];
					}
					if ([host caseInsensitiveCompare:sipBridgeDomain] == NSOrderedSame) {
						if (_isAppActive) {
							[SylkLogger log:@"[app] Dropping incoming_session push: from_uri host '%@' matches configured sipBridge '%@' AND app is foreground (duplicate of conferenceInvite, callId=%@)",
							 host, sipBridgeDomain, callId];
							return NO;
						} else {
							[SylkLogger log:@"[app] Keeping incoming_session push despite sipBridge match (app is background — push needed to wake app, callId=%@)",
							 callId];
						}
					}
				}
			}
		}

		[SylkLogger log:@"[app] %@ %@ from %@ to %@", event, callId, fromUri, lookupAccount];
	}

    Contact *contact = nil;

    @try {
        contact = [self getContact:lookupAccount uri:fromUri];
    } @catch (...) {
        contact = nil;
    }

    NSArray<NSString *> *tags = contact ? contact.tags : @[];

	if (![self isAccountActive:lookupAccount fromUri:fromUri contactTags:tags]) {
		[SylkLogger log:@"[app] Request rejected by account rules"];
		return NO;
	}

	// Blocked?
	if ([self isBlocked:tags]) {
		[SylkLogger log:@"[app] Message from %@ is blocked", fromUri];
		return NO;
	}

	// Muted?
	if ([self isMuted:tags]) {
		[SylkLogger log:@"[app] Skipping notification: user %@ is muted", fromUri];
		return NO;
	}


    return YES;
}

/**
 * Derive a friendly display name from a SIP URI when the push payload
 * does not carry from_display_name. Mirrors newContact() in app.js:
 * 'john.doe@host' -> 'John Doe'. Phone-number usernames are left as-is.
 */
+ (NSString *)deriveDisplayNameFromUri:(NSString *)uri {
    if (uri.length == 0) return @"";
    NSRange at = [uri rangeOfString:@"@"];
    NSString *user = (at.location != NSNotFound) ? [uri substringToIndex:at.location] : uri;
    if (user.length == 0) return uri;

    NSCharacterSet *digitSet = [NSCharacterSet characterSetWithCharactersInString:@"+0123456789"];
    BOOL allDigits = YES;
    for (NSUInteger i = 0; i < user.length; i++) {
        unichar c = [user characterAtIndex:i];
        if (![digitSet characterIsMember:c]) { allDigits = NO; break; }
    }
    if (allDigits) return user;

    NSArray<NSString *> *parts = [user componentsSeparatedByCharactersInSet:
                                   [NSCharacterSet characterSetWithCharactersInString:@"._-"]];
    NSMutableArray *titled = [NSMutableArray array];
    for (NSString *p in parts) {
        if (p.length == 0) continue;
        NSString *first = [[p substringToIndex:1] uppercaseString];
        NSString *rest = p.length > 1 ? [[p substringFromIndex:1] lowercaseString] : @"";
        [titled addObject:[first stringByAppendingString:rest]];
    }
    NSString *out = [[titled componentsJoinedByString:@" "] stringByTrimmingCharactersInSet:
                      [NSCharacterSet whitespaceAndNewlineCharacterSet]];
    return out.length > 0 ? out : user;
}

/**
 * Append a single msg_id to the comma-separated unread_messages
 * column for a contact, deduping against any id already present.
 * Mirrors contact.unread.push(id) + unread_messages =
 * contact.unread.toString() in saveSylkContact.
 */
+ (NSString *)appendUnreadId:(NSString *)existing newId:(NSString *)newId {
    if (newId.length == 0) return existing ?: @"";
    if (existing.length == 0) return newId;
    NSArray<NSString *> *parts = [existing componentsSeparatedByString:@","];
    for (NSString *p in parts) {
        if ([[p stringByTrimmingCharactersInSet:
              [NSCharacterSet whitespaceAndNewlineCharacterSet]] isEqualToString:newId]) {
            return existing; // already present
        }
    }
    return [NSString stringWithFormat:@"%@,%@", existing, newId];
}

/**
 * Cheap "is this account row enabled" check used to gate the native
 * SQL insert path. Different from isAccountActive: that one also
 * applies privacy filters (rejectNonContacts / rejectAnonymous / DND)
 * which gate the notification UI; for the SQL insert we only want to
 * skip when the account row is missing or disabled (active != '1').
 */
- (BOOL)isAccountEnabled:(NSString *)account {
    if (account.length == 0) return NO;
    NSString *dbPath = [self sylkDatabasePath];
    if (dbPath.length == 0) return NO;

    sqlite3 *db = NULL;
    BOOL enabled = NO;
    @try {
        if (sqlite3_open([dbPath UTF8String], &db) != SQLITE_OK) {
            // Fail open on DB-open errors — better to land the message
            // in SQL than to drop it because of a transient issue.
            return YES;
        }
        sqlite3_busy_timeout(db, 2000);
        sqlite3_stmt *stmt = NULL;
        const char *sql = "SELECT active FROM accounts WHERE account = ?";
        if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
            sqlite3_bind_text(stmt, 1, [account UTF8String], -1, SQLITE_TRANSIENT);
            if (sqlite3_step(stmt) == SQLITE_ROW) {
                const char *col = (const char *)sqlite3_column_text(stmt, 0);
                if (col) {
                    NSString *active = [NSString stringWithUTF8String:col];
                    enabled = [active isEqualToString:@"1"];
                }
            }
        }
        if (stmt) sqlite3_finalize(stmt);
    } @catch (NSException *ex) {
        [SylkLogger log:@"[message] [apns] isAccountEnabled exception: %@", ex.reason];
        enabled = YES; // fail open
    } @finally {
        if (db) sqlite3_close(db);
    }
    return enabled;
}

/**
 * Persist an incoming push message directly into sylk.db so the RN
 * app finds it in the messages table on the next chat-open / foreground
 * cycle — no payload re-fetch from the notification on the JS side.
 * Mirrors the schema saveIncomingMessage / saveSylkContact writes from
 * JS (see app.js initSQL / createTables).
 *
 *   - INSERT OR IGNORE into contacts so a brand-new sender renders with
 *     a friendly display name when WS hasn't delivered yet.
 *   - INSERT OR IGNORE into messages with the 16-column shape
 *     saveIncomingMessage uses. PRIMARY KEY (account, msg_id) dedupes
 *     against the eventual WS / journal arrival.
 *
 * PGP-enveloped bodies are stored verbatim with encrypted=1 — JS holds
 * the private key and decrypts at render time. Failures are swallowed:
 * a push that can't be persisted still gets a notification, and the WS
 * path will eventually backfill SQL.
 */
- (void)insertIncomingMessageToSqlForAccount:(NSString *)account
                                     fromUri:(NSString *)fromUri
                                   messageId:(NSString *)messageId
                                     content:(NSString *)content
                                 contentType:(NSString *)contentType
                                 displayName:(NSString *)displayName
{
    if (account.length == 0 || fromUri.length == 0 || messageId.length == 0) {
        [SylkLogger log:@"[message] [apns] insert: missing required fields"];
        return;
    }

    // Only TWO things stop the insert:
    //   1. blocked contact
    //   2. disabled account (accounts.active != '1')
    // Mute / DND / rejectAnonymous / rejectNonContacts all pass through
    // — those gate the NOTIFICATION UI only and JS's saveIncomingMessage
    // path persists those messages too. We must match that so chat
    // history doesn't differ between push and WS delivery.
    Contact *blockedCheck = nil;
    @try { blockedCheck = [self getContact:account uri:fromUri]; } @catch (...) {}
    if (blockedCheck && [self isBlocked:blockedCheck.tags]) {
        [SylkLogger log:@"[message] [apns] insert: %@ is blocked, dropping", fromUri];
        return;
    }

    if (![self isAccountEnabled:account]) {
        [SylkLogger log:@"[message] [apns] insert: account %@ is disabled, dropping", account];
        return;
    }

    NSString *dbPath = [self sylkDatabasePath];
    if (dbPath.length == 0) {
        [SylkLogger log:@"[message] [apns] insert: database not found"];
        return;
    }

    // Mirror the JS-side arrival entry (app.js:
    // "[message] handleIncomingMessage <id> from <uri> <contentType>")
    // so APPLOG reads identically whether the message arrived via push
    // or via the websocket.
    [SylkLogger log:@"[message] handleIncomingMessage %@ from %@ %@ (via push)",
          messageId, fromUri, (contentType.length > 0 ? contentType : @"text/plain")];

    NSString *safeContent = content ?: @"";
    NSString *safeContentType = contentType.length > 0 ? contentType : @"text/plain";
    BOOL isEncrypted = ([safeContent rangeOfString:@"-----BEGIN PGP MESSAGE-----"].location != NSNotFound)
                    && ([safeContent rangeOfString:@"-----END PGP MESSAGE-----"].location != NSNotFound);
    int encrypted = isEncrypted ? 1 : 0;
    NSString *metadata = [safeContentType isEqualToString:@"application/sylk-file-transfer"] ? safeContent : @"";

    NSDate *now = [NSDate date];
    long long unixSec = (long long)[now timeIntervalSince1970];

    static NSDateFormatter *isoFmt = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        isoFmt = [[NSDateFormatter alloc] init];
        isoFmt.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";
        isoFmt.timeZone = [NSTimeZone timeZoneWithAbbreviation:@"UTC"];
        isoFmt.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    });
    // timestamp column stores the JSON-stringified Date the JS path writes —
    // JSON.stringify(new Date()) produces "\"...Z\"" including the
    // surrounding quotes — so we emit the same shape here. JS reads
    // this back through a JSON.parse reviver.
    NSString *tsCol = [NSString stringWithFormat:@"\"%@\"", [isoFmt stringFromDate:now]];

    sqlite3 *db = NULL;
    @try {
        if (sqlite3_open([dbPath UTF8String], &db) != SQLITE_OK) {
            [SylkLogger log:@"[message] [apns] insert: failed to open db at %@", dbPath];
            return;
        }
        sqlite3_busy_timeout(db, 5000);

        // ---- contact upsert ----
        // We need to know whether a row already exists AND, if so,
        // what its unread_messages list looks like so we can append
        // this message id (saveSylkContact in JS rebuilds the whole
        // list from contact.unread; we do the equivalent append-and-
        // dedup directly on the comma-separated column).
        BOOL contactExists = NO;
        NSString *existingUnread = @"";
        {
            sqlite3_stmt *stmt = NULL;
            const char *sql = "SELECT unread_messages FROM contacts WHERE account = ? AND uri = ? LIMIT 1";
            if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
                sqlite3_bind_text(stmt, 1, [account UTF8String], -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(stmt, 2, [fromUri UTF8String], -1, SQLITE_TRANSIENT);
                if (sqlite3_step(stmt) == SQLITE_ROW) {
                    contactExists = YES;
                    const char *col = (const char *)sqlite3_column_text(stmt, 0);
                    if (col) existingUnread = [NSString stringWithUTF8String:col];
                }
            }
            if (stmt) sqlite3_finalize(stmt);
        }

        if (!contactExists) {
            // Brand-new sender. INSERT the contact stub with this
            // msg_id already seeded in unread_messages and timestamp
            // set to the message arrival time, so the contacts list
            // renders the unread badge immediately on next chat-list
            // read — without waiting for the WS journal sync.
            NSString *resolvedName = (displayName.length > 0)
                ? [displayName stringByTrimmingCharactersInSet:
                   [NSCharacterSet whitespaceAndNewlineCharacterSet]]
                : [AppDelegate deriveDisplayNameFromUri:fromUri];
            if (resolvedName.length == 0) resolvedName = fromUri;
            NSString *contactId = [[[NSUUID UUID] UUIDString] lowercaseString];

            sqlite3_stmt *stmt = NULL;
            const char *sql =
                "INSERT OR IGNORE INTO contacts ("
                "contact_id, remote_id, account, uri, uris, email, photo, "
                "timestamp, name, organization, unread_messages, tags, "
                "participants, public_key, direction, last_call_media, "
                "conference, last_call_id, last_call_duration, "
                "last_call_timestamp, properties, local_properties"
                ") VALUES (?, '', ?, ?, '', '', '', ?, ?, '', ?, '', "
                "'', '', 'incoming', '', 0, '', 0, NULL, '', '')";
            if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
                sqlite3_bind_text(stmt, 1, [contactId UTF8String], -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(stmt, 2, [account UTF8String], -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(stmt, 3, [fromUri UTF8String], -1, SQLITE_TRANSIENT);
                sqlite3_bind_int64(stmt, 4, unixSec);
                sqlite3_bind_text(stmt, 5, [resolvedName UTF8String], -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(stmt, 6, [messageId UTF8String], -1, SQLITE_TRANSIENT);
                int rc = sqlite3_step(stmt);
                if (rc != SQLITE_DONE) {
                    [SylkLogger log:@"[message] [apns] insert: contact INSERT rc=%d (%s)",
                          rc, sqlite3_errmsg(db)];
                } else {
                    [SylkLogger log:@"[message] [apns] insert: contact stub for %@ name=%@ unread=%@",
                          fromUri, resolvedName, messageId];
                }
            }
            if (stmt) sqlite3_finalize(stmt);
        } else {
            // Existing contact — append messageId to unread_messages
            // (dedupe) and bump timestamp so the chat list lifts the
            // row to the top with an incremented unread badge.
            //
            // SQLite's MAX(col, ?) is a SCALAR function (different from
            // the MAX() aggregate): it returns the larger of the column
            // value and the bound parameter for each row. This mirrors
            // saveIncomingMessage's
            //   if (_wsTsMs > _contactTsMs) contact.timestamp = ...
            // guard so an out-of-order push or a push that lands after
            // the WS already advanced contact.timestamp can't regress
            // the last-activity clock.
            NSString *newUnread = [AppDelegate appendUnreadId:existingUnread newId:messageId];
            sqlite3_stmt *stmt = NULL;
            const char *sql = "UPDATE contacts SET unread_messages = ?, timestamp = MAX(timestamp, ?) WHERE account = ? AND uri = ?";
            if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
                sqlite3_bind_text(stmt, 1, [newUnread UTF8String], -1, SQLITE_TRANSIENT);
                sqlite3_bind_int64(stmt, 2, unixSec);
                sqlite3_bind_text(stmt, 3, [account UTF8String], -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(stmt, 4, [fromUri UTF8String], -1, SQLITE_TRANSIENT);
                int rc = sqlite3_step(stmt);
                if (rc != SQLITE_DONE) {
                    [SylkLogger log:@"[message] [apns] insert: contact UPDATE rc=%d (%s)",
                          rc, sqlite3_errmsg(db)];
                } else {
                    NSInteger count = newUnread.length == 0
                        ? 0
                        : [[newUnread componentsSeparatedByString:@","] count];
                    [SylkLogger log:@"[message] [apns] updated contact unread for %@ unread=%@ count=%ld ts<=MAX(existing,%lld)",
                          fromUri, newUnread, (long)count, unixSec];
                }
            }
            if (stmt) sqlite3_finalize(stmt);
        }

        // ---- message insert ----
        {
            sqlite3_stmt *stmt = NULL;
            const char *sql =
                "INSERT OR IGNORE INTO messages ("
                "account, encrypted, msg_id, timestamp, unix_timestamp, "
                "content, content_type, metadata, from_uri, to_uri, "
                "direction, received, related_action, related_msg_id, "
                "disposition_notification, expire"
                ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'incoming', 1, NULL, NULL, '', 0)";
            if (sqlite3_prepare_v2(db, sql, -1, &stmt, NULL) == SQLITE_OK) {
                sqlite3_bind_text(stmt, 1, [account UTF8String], -1, SQLITE_TRANSIENT);
                sqlite3_bind_int(stmt, 2, encrypted);
                sqlite3_bind_text(stmt, 3, [messageId UTF8String], -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(stmt, 4, [tsCol UTF8String], -1, SQLITE_TRANSIENT);
                sqlite3_bind_int64(stmt, 5, unixSec);
                sqlite3_bind_text(stmt, 6, [safeContent UTF8String], -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(stmt, 7, [safeContentType UTF8String], -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(stmt, 8, [metadata UTF8String], -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(stmt, 9, [fromUri UTF8String], -1, SQLITE_TRANSIENT);
                sqlite3_bind_text(stmt, 10, [account UTF8String], -1, SQLITE_TRANSIENT);
                int rc = sqlite3_step(stmt);
                if (rc != SQLITE_DONE) {
                    [SylkLogger log:@"[message] [apns] insert: message INSERT rc=%d (%s)",
                          rc, sqlite3_errmsg(db)];
                } else {
                    // Mirror the JS-side save log
                    // (app.js: "save incoming [message] <id> from <uri>")
                    // so APPLOG reads identically whether the row was
                    // written by JS or by the native APNs handler.
                    [SylkLogger log:@"save incoming [message] %@ from %@ encrypted=%d (via push)",
                          messageId, fromUri, encrypted];
                }
            }
            if (stmt) sqlite3_finalize(stmt);
        }
    } @catch (NSException *ex) {
        [SylkLogger log:@"[message] [apns] insert exception: %@ - %@", ex.name, ex.reason];
    } @finally {
        if (db) sqlite3_close(db);
    }
}

- (void)answerCallWithUUID:(NSString *)uuidString
{
    [SylkLogger log:@"[app] Auto-answer now for call UUID %@", uuidString];

    NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:uuidString];
    if (!uuid) return;

    CXAnswerCallAction *answerAction =
        [[CXAnswerCallAction alloc] initWithCallUUID:uuid];

    CXTransaction *transaction =
        [[CXTransaction alloc] initWithAction:answerAction];

    CXCallController *controller = [[CXCallController alloc] init];

    [controller requestTransaction:transaction completion:^(NSError * _Nullable error) {
        if (error) {
            [SylkLogger log:@"[app] Auto-answer failed: %@", error];
        } else {
            [SylkLogger log:@"[app] Auto-answer succeeded for %@", uuidString];
        }
    }];
}

- (void)cancelAutoAnswerForUUID:(NSString *)uuid
{
    NSString *key = [self normalizedUUID:uuid];
    //[SylkLogger log:@"[app] cancelAutoAnswerForUUID %@", key];
    
    dispatch_source_t timer = self.autoAnswerTimers[key];
    if (timer) {
        dispatch_source_cancel(timer);
        [self.autoAnswerTimers removeObjectForKey:key];
        [SylkLogger log:@"[app] Auto-answer cancelled for %@", key];
    } else {
        //[SylkLogger log:@"[app] Auto-answer timer not found %@", key];
    }
}

- (void)scheduleAutoAnswerForUUID:(NSString *)uuid delay:(NSTimeInterval)delay
{
    dispatch_queue_t queue = dispatch_get_main_queue();

    dispatch_source_t timer =
        dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, queue);

    dispatch_source_set_timer(
        timer,
        dispatch_time(DISPATCH_TIME_NOW, delay * NSEC_PER_SEC),
        DISPATCH_TIME_FOREVER,
        0
    );

    __weak typeof(self) weakSelf = self;

    NSString *key = [self normalizedUUID:uuid];
    
    dispatch_source_set_event_handler(timer, ^{
        //[SylkLogger log:@"[app] Auto-answer firing for %@", key];
        [weakSelf answerCallWithUUID:key];
        [weakSelf cancelAutoAnswerForUUID:key];
    });

    dispatch_resume(timer);
    self.autoAnswerTimers[key] = timer;

    [SylkLogger log:@"[app] Auto-answer scheduled in %.0fs for %@", delay, uuid];
}

- (void)provider:(CXProvider *)provider performAnswerCallAction:(CXAnswerCallAction *)action
{
    NSString *uuid = action.callUUID.UUIDString;
    [self cancelAutoAnswerForUUID:uuid];
    [action fulfill];
}

- (void)onCallAnswered:(NSNotification *)notification
{
    NSString *uuid = notification.userInfo[@"callUUID"]
                  ?: notification.userInfo[@"uuid"];

    if (!uuid) return;

    [SylkLogger log:@"[app] RNCallKeep Call answered by user %@", uuid];

    [self cancelAutoAnswerForUUID:uuid];
}

- (void)onCallEnded:(NSNotification *)notification
{
    NSString *uuid = notification.userInfo[@"callUUID"]
                  ?: notification.userInfo[@"uuid"];

    if (!uuid) return;

    [SylkLogger log:@"[app] RNCallKeep Call ended by user %@", uuid];

    [self cancelAutoAnswerForUUID:uuid];
}

- (NSString *)normalizedUUID:(NSString *)uuid
{
    return uuid.lowercaseString;
}


@end
