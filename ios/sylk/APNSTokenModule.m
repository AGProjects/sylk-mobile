#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>
#import <UserNotifications/UserNotifications.h>
#import "AppDelegate.h"
#import "SylkLogger.h"

@interface APNSTokenModule : RCTEventEmitter <RCTBridgeModule>
- (void)sendTokenToJS:(NSString *)token;
@end

// Shared app-group storage for the {uri: display_name} map read by
// SylkNotificationService to retitle incoming message pushes.
static NSString *const kSylkAppGroup = @"group.com.agprojects.sylk-ios";
static NSString *const kSylkDisplayNamesKey = @"contactDisplayNames";

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

// Post a local notification through UNUserNotificationCenter. Replaces
// RNCPushNotificationIOS's addNotificationRequest/presentLocalNotification
// (2026-07-22). The userInfo dict is attached verbatim, so AppDelegate's
// willPresentNotification keeps reading userInfo[@"data"] exactly as it
// does for remote pushes — the {data: ...} envelope contract is owned by
// the JS callers (sendLocalNotification et al.).
RCT_EXPORT_METHOD(postLocalNotification:(NSString *)identifier
                  title:(NSString *)title
                  body:(NSString *)body
                  sound:(NSString *)sound
                  userInfo:(NSDictionary *)userInfo)
{
  UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
  content.title = title ?: @"";
  content.body = body ?: @"";
  content.userInfo = userInfo ?: @{};
  if (sound != nil && sound.length > 0) {
      content.sound = [UNNotificationSound defaultSound];
  }

  NSString *reqId = (identifier != nil && identifier.length > 0)
      ? identifier
      : [[NSUUID UUID] UUIDString];
  UNNotificationRequest *request =
      [UNNotificationRequest requestWithIdentifier:reqId
                                           content:content
                                           trigger:nil];
  [[UNUserNotificationCenter currentNotificationCenter]
      addNotificationRequest:request
       withCompletionHandler:^(NSError * _Nullable error) {
          if (error != nil) {
              [SylkLogger log:@"[push] postLocalNotification failed: %@", error];
          }
      }];
}

// Point update for a single contact create/rename, called from JS's
// saveSylkContact so the notification extension picks up the new name
// immediately instead of waiting for the next full contacts load.
// Overwrites the entry — the receiver's local edit is authoritative.
// An empty name (or a bare uri echo) removes the entry so pushes fall
// back to the sender-declared title. No-ops when nothing changes, so
// bulk contact saves don't churn the shared defaults.
RCT_EXPORT_METHOD(setContactDisplayName:(NSString *)uri
                  displayName:(NSString *)displayName)
{
  if (![uri isKindOfClass:[NSString class]] || uri.length == 0) {
    return;
  }
  NSUserDefaults *shared =
      [[NSUserDefaults alloc] initWithSuiteName:kSylkAppGroup];
  NSMutableDictionary *names =
      [[shared dictionaryForKey:kSylkDisplayNamesKey] mutableCopy]
          ?: [NSMutableDictionary new];
  NSString *key = [uri lowercaseString];
  BOOL remove = (![displayName isKindOfClass:[NSString class]]
                 || displayName.length == 0
                 || [[displayName lowercaseString] isEqualToString:key]);
  if (remove) {
    if (names[key] != nil) {
      [names removeObjectForKey:key];
      [shared setObject:names forKey:kSylkDisplayNamesKey];
      [SylkLogger log:@"[push] display-name map remove: %@ (%lu total)",
          key, (unsigned long)names.count];
    }
  } else if (![names[key] isEqual:displayName]) {
    names[key] = displayName;
    [shared setObject:names forKey:kSylkDisplayNamesKey];
    [SylkLogger log:@"[push] display-name map set: %@ -> %@ (%lu total)",
        key, displayName, (unsigned long)names.count];
  }
}

// Bulk-sync the {uri: display_name} map into the shared app-group
// defaults, where SylkNotificationService reads it to retitle incoming
// message pushes with the locally-known display name (the server only
// knows the bare URI). Called from JS after every contacts load — a
// whole-map replace, so renames and deletions stay honest.
RCT_EXPORT_METHOD(syncContactDisplayNames:(NSDictionary *)names)
{
  if (![names isKindOfClass:[NSDictionary class]]) {
    return;
  }
  NSUserDefaults *shared =
      [[NSUserDefaults alloc] initWithSuiteName:kSylkAppGroup];
  [shared setObject:names forKey:kSylkDisplayNamesKey];
  [SylkLogger log:@"[push] display-name map synced: %lu contacts",
      (unsigned long)names.count];
}

// Cold-start notification, read-and-clear. Replaces
// RNCPushNotificationIOS's getInitialNotification: AppDelegate stashes
// the userInfo from launchOptions (push-launched) or from a
// notification tap that beat the bridge (tap-launched); JS calls this
// once at startup and feeds the result to onRemoteNotification.
RCT_EXPORT_METHOD(getInitialNotification:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    AppDelegate *app = (AppDelegate *)[UIApplication sharedApplication].delegate;
    NSDictionary *info = app.initialRemoteNotification;
    app.initialRemoteNotification = nil;
    resolve(info ?: (id)kCFNull);
  });
}

@end

