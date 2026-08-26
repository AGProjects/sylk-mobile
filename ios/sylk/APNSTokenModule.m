#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>
#import <UserNotifications/UserNotifications.h>
#import <UIKit/UIKit.h>
#import "AppDelegate.h"
#import "SylkLogger.h"
#import <Contacts/Contacts.h>

@interface APNSTokenModule : RCTEventEmitter <RCTBridgeModule>
- (void)sendTokenToJS:(NSString *)token;
@end

// Shared app-group storage for the {uri: display_name} map read by
// SylkNotificationService to retitle incoming message pushes.
static NSString *const kSylkAppGroup = @"group.com.agprojects.sylk-ios";
static NSString *const kSylkDisplayNamesKey = @"contactDisplayNames";

// File-based shared {uri: display_name} map, read by the
// SylkNotificationService extension to retitle message-push banners. A
// plain file (not App Group NSUserDefaults) is used because defaults do
// not reliably reach an extension process and can be lock-screen
// protected. Written with NSFileProtectionNone so the NSE can read it on
// the lock screen. Must NOT be deleted by purgeAppGroupContainer — see
// the preserve-list in SharedDataModule.purgeAppGroupContainer.
static NSString *SylkDisplayNamesFilePath(void) {
    NSURL *c = [[NSFileManager defaultManager]
        containerURLForSecurityApplicationGroupIdentifier:kSylkAppGroup];
    return c ? [[c URLByAppendingPathComponent:@"contactDisplayNames.plist"] path] : nil;
}

static void SylkWriteDisplayNamesFile(NSDictionary *names) {
    NSString *path = SylkDisplayNamesFilePath();
    if (path == nil) { return; }
    NSData *data = [NSPropertyListSerialization
        dataWithPropertyList:(names ?: @{})
                      format:NSPropertyListBinaryFormat_v1_0
                     options:0
                       error:NULL];
    if (data == nil) { return; }
    NSError *werr = nil;
    if (![data writeToFile:path
                   options:(NSDataWritingAtomic | NSDataWritingFileProtectionNone)
                     error:&werr]) {
        [SylkLogger log:@"[push] display-name map file write failed: %@",
            werr.localizedDescription];
    }
}


// Shared app-group storage for the set of contact URIs tagged
// `bypassdnd`. SylkNotificationService reads this to raise that
// sender's message push to UNNotificationInterruptionLevelTimeSensitive,
// which is the only way an alert push breaks through a system Focus /
// Do Not Disturb (the default `active` level is exactly what a Focus
// silences). The extension cannot consult sylk.db — that lives in the
// app's OWN container, not the app group (see AppDelegate
// sylkDatabasePath) — so the tag has to be mirrored here, the same way
// display names are.
//
// Stored as a flat array of lowercased URIs. Written with
// NSFileProtectionNone so the NSE can read it on the lock screen, which
// is precisely when a DND bypass matters. Must NOT be deleted by
// purgeAppGroupContainer — see the preserve-list in
// SharedDataModule.purgeAppGroupContainer.
static NSString *const kSylkBypassDndKey = @"contactBypassDnd";

static NSString *SylkBypassDndFilePath(void) {
    NSURL *c = [[NSFileManager defaultManager]
        containerURLForSecurityApplicationGroupIdentifier:kSylkAppGroup];
    return c ? [[c URLByAppendingPathComponent:@"contactBypassDnd.plist"] path] : nil;
}

static void SylkWriteBypassDndFile(NSArray<NSString *> *uris) {
    NSString *path = SylkBypassDndFilePath();
    if (path == nil) { return; }
    NSData *data = [NSPropertyListSerialization
        dataWithPropertyList:(uris ?: @[])
                      format:NSPropertyListBinaryFormat_v1_0
                     options:0
                       error:NULL];
    if (data == nil) { return; }
    NSError *werr = nil;
    if (![data writeToFile:path
                   options:(NSDataWritingAtomic | NSDataWritingFileProtectionNone)
                     error:&werr]) {
        [SylkLogger log:@"[push] bypassdnd set file write failed: %@",
            werr.localizedDescription];
    }
}

// Shared app-group mirror of the in-app DND flag (privacy.dnd, the bell on
// the navbar). SylkNotificationService reads it to decide whether an
// incoming MESSAGE push should be delivered quietly.
//
// Same reason as the bypassdnd set: the NSE cannot read sylk.db, so any
// state it needs has to be mirrored into the app group. Without this, app
// DND had no effect at all on message banners — the server alert push is
// rendered by iOS whatever the app thinks, which is why a text message
// still popped a bubble with the bell on.
static NSString *const kSylkAppDndKey = @"appDnd";

static NSString *SylkAppDndFilePath(void) {
    NSURL *c = [[NSFileManager defaultManager]
        containerURLForSecurityApplicationGroupIdentifier:kSylkAppGroup];
    return c ? [[c URLByAppendingPathComponent:@"appDnd.plist"] path] : nil;
}

static void SylkWriteAppDndFile(BOOL enabled) {
    NSString *path = SylkAppDndFilePath();
    if (path == nil) { return; }
    NSData *data = [NSPropertyListSerialization
        dataWithPropertyList:@{ @"dnd": @(enabled) }
                      format:NSPropertyListBinaryFormat_v1_0
                     options:0
                       error:NULL];
    if (data == nil) { return; }
    NSError *werr = nil;
    if (![data writeToFile:path
                   options:(NSDataWritingAtomic | NSDataWritingFileProtectionNone)
                     error:&werr]) {
        [SylkLogger log:@"[push] app-DND file write failed: %@", werr.localizedDescription];
    }
}

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

// Mirror privacy.dnd into the app group so SylkNotificationService can
// quiet message banners while the bell is on. Called from JS whenever the
// flag changes and once when account settings are loaded.
RCT_EXPORT_METHOD(setAppDnd:(BOOL)enabled)
{
  NSUserDefaults *shared =
      [[NSUserDefaults alloc] initWithSuiteName:kSylkAppGroup];
  [shared setBool:enabled forKey:kSylkAppDndKey];
  SylkWriteAppDndFile(enabled);
  [SylkLogger log:@"[push] app DND mirrored to app group: %s", enabled ? "ON" : "off"];
}

// Whether a SYSTEM contact card carries this URI as an email address.
//
// iOS exposes no way to read a Focus's People allow-list, and no deep link to
// it, so we cannot tell the user whether a contact is actually allowed. What
// we CAN check is the precondition, which is also the part that usually
// fails: iOS matches an incoming call or a communication notification to a
// person by resolving its handle against the address book, and a Sylk address
// goes in as an EMAIL handle. No card carrying that address means Focus can
// never allow this person, whatever the user ticks -- a definite negative,
// and an actionable one.
//
// Resolves {status, name}:
//   found        -- a card carries this address (name is its display name)
//   missing      -- address book readable, no card matches
//   unauthorized -- no Contacts permission, so we genuinely do not know
//   error        -- lookup threw; treated as "do not know", never as "no"
RCT_EXPORT_METHOD(hasSystemContactForUri:(NSString *)uri
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![uri isKindOfClass:[NSString class]] || uri.length == 0) {
    resolve(@{ @"status": @"missing" });
    return;
  }

  CNAuthorizationStatus auth =
      [CNContactStore authorizationStatusForEntityType:CNEntityTypeContacts];
  // iOS 18 added a "limited" status. Treat anything that is not a hard denial
  // as worth attempting: a limited grant can still surface a match, and if it
  // does not we fall through to "missing" rather than claiming ignorance.
  if (auth == CNAuthorizationStatusDenied || auth == CNAuthorizationStatusRestricted) {
    resolve(@{ @"status": @"unauthorized" });
    return;
  }
  if (auth == CNAuthorizationStatusNotDetermined) {
    resolve(@{ @"status": @"unauthorized" });
    return;
  }

  @try {
    CNContactStore *store = [[CNContactStore alloc] init];
    // The email predicate is a CNContact class method, NOT a CNContactStore
    // one -- the store only vends the fetch. (iOS 11+; deployment target is 15.1.)
    NSPredicate *pred = [CNContact predicateForContactsMatchingEmailAddress:uri];
    NSArray<id<CNKeyDescriptor>> *keys = @[ [CNContactFormatter descriptorForRequiredKeysForStyle:CNContactFormatterStyleFullName] ];
    NSError *err = nil;
    NSArray<CNContact *> *matches =
        [store unifiedContactsMatchingPredicate:pred keysToFetch:keys error:&err];
    if (err != nil) {
      [SylkLogger log:@"[dnd] contact lookup failed: %@", err.localizedDescription];
      resolve(@{ @"status": @"error" });
      return;
    }
    [SylkLogger log:@"[dnd] [card] email predicate for %@ -> %lu match(es)",
          uri, (unsigned long)matches.count];
    if (matches.count > 0) {
      // ALL of them. One SIP address routinely sits on more than one card -- a
      // personal entry and a work one, an unmerged duplicate, or the same
      // person from two accounts. Reporting only the first claimed a link to a
      // card that may not be the one Focus is matching against.
      NSMutableArray *all = [NSMutableArray array];
      for (CNContact *m in matches) {
        NSString *n = [CNContactFormatter stringFromContact:m
                                                      style:CNContactFormatterStyleFullName];
        [all addObject:@{ @"id": m.identifier ?: @"", @"name": n ?: @"" }];
      }
      CNContact *hit = matches.firstObject;
      NSString *name = [CNContactFormatter stringFromContact:hit
                                                       style:CNContactFormatterStyleFullName];
      resolve(@{ @"status": @"found",
                 @"name": name ?: @"",
                 @"id": hit.identifier ?: @"",
                 @"matches": all });
      return;
    }
    [SylkLogger log:@"[dnd] [card] no card carries '%@' as an email "
                     "(auth=%ld) -- check for a sip: prefix, whitespace, or the "
                     "address being on an IM/custom field instead of Email",
          uri, (long)auth];
    resolve(@{ @"status": @"missing" });
  } @catch (NSException *ex) {
    [SylkLogger log:@"[dnd] contact lookup threw: %@", ex.reason];
    resolve(@{ @"status": @"error" });
  }
}

// Read the parts of Settings > Notifications > Blink that decide whether the
// bypass we ask for is actually honoured.
//
// The one that matters is timeSensitiveSetting. SylkNotificationService marks
// pushes from a bypassdnd contact UNNotificationInterruptionLevelTimeSensitive,
// but the user owns a per-app kill switch for that ("Time Sensitive
// Notifications" on this screen). With it off, iOS silently DOWNGRADES the
// notification to .active and Focus swallows it -- no error, no callback,
// nothing the app can observe at send time. Until now the modal could not see
// this and would report the contact side as fine while every message was being
// held back by a switch two taps away.
//
// timeSensitiveSetting is iOS 15+; on anything older it is reported as
// "unsupported" rather than guessed at.
RCT_EXPORT_METHOD(getNotificationSettings:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    [[UNUserNotificationCenter currentNotificationCenter]
        getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *st) {
        NSString *(^name)(UNNotificationSetting) = ^NSString *(UNNotificationSetting v) {
            switch (v) {
                case UNNotificationSettingEnabled:     return @"enabled";
                case UNNotificationSettingDisabled:    return @"disabled";
                case UNNotificationSettingNotSupported:
                default:                               return @"unsupported";
            }
        };

        NSString *authorized = @"unknown";
        switch (st.authorizationStatus) {
            case UNAuthorizationStatusAuthorized:  authorized = @"authorized"; break;
            case UNAuthorizationStatusProvisional: authorized = @"provisional"; break;
            case UNAuthorizationStatusDenied:      authorized = @"denied"; break;
            case UNAuthorizationStatusNotDetermined: authorized = @"notDetermined"; break;
            default: break;
        }

        NSString *timeSensitive = @"unsupported";
        if (@available(iOS 15.0, *)) {
            timeSensitive = name(st.timeSensitiveSetting);
        }

        NSDictionary *out = @{
            @"authorization": authorized,
            @"timeSensitive": timeSensitive,
            @"alert":         name(st.alertSetting),
            @"sound":         name(st.soundSetting),
            @"lockScreen":    name(st.lockScreenSetting),
            @"criticalAlert": name(st.criticalAlertSetting),
        };
        [SylkLogger log:@"[dnd] [notif] auth=%@ timeSensitive=%@ alert=%@ sound=%@",
              authorized, timeSensitive, name(st.alertSetting), name(st.soundSetting)];
        // The completion handler is NOT on the main queue.
        dispatch_async(dispatch_get_main_queue(), ^{ resolve(out); });
    }];
}

// Settings > Notifications > Blink, in one tap.
//
// UIApplicationOpenNotificationSettingsURLString (iOS 16+) is the ONLY public
// deep link into a Settings pane other than the app's own root page. There is
// no equivalent for Focus -- App-Prefs:root=DO_NOT_DISTURB is private, broken
// since iOS 10, and grounds for rejection -- so the Focus instructions in the
// modal stay written out. On iOS 15 we fall back to the app's own settings
// page, which is one extra tap away from Notifications.
RCT_EXPORT_METHOD(openNotificationSettings:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(dispatch_get_main_queue(), ^{
        NSString *target = UIApplicationOpenSettingsURLString;
        if (@available(iOS 16.0, *)) {
            target = UIApplicationOpenNotificationSettingsURLString;
        }
        NSURL *url = [NSURL URLWithString:target];
        if (!url) { resolve(@{ @"opened": @NO }); return; }
        [[UIApplication sharedApplication] openURL:url options:@{} completionHandler:^(BOOL ok) {
            [SylkLogger log:@"[dnd] [notif] open %@ -> %@", target, ok ? @"ok" : @"failed"];
            resolve(@{ @"opened": @(ok) });
        }];
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
      SylkWriteDisplayNamesFile(names);
      [SylkLogger log:@"[push] display-name map remove: %@ (%lu total)",
          key, (unsigned long)names.count];
    }
  } else if (![names[key] isEqual:displayName]) {
    names[key] = displayName;
    [shared setObject:names forKey:kSylkDisplayNamesKey];
    SylkWriteDisplayNamesFile(names);
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
  [shared synchronize];

  // Authoritative write for the extension (the NSE reads this file).
  SylkWriteDisplayNamesFile(names);

  [SylkLogger log:@"[push] display-name map synced: %lu contacts",
      (unsigned long)names.count];
}

// Point update for one contact whose `bypassdnd` tag was just added or
// removed. Called from JS's saveSylkContact right after the tag list is
// normalised, so a block (which strips bypassdnd) clears this too. The
// bulk sync below only runs on full contacts loads, which is too late
// for a tag the user just toggled and a push that lands seconds later.
RCT_EXPORT_METHOD(setContactBypassDnd:(NSString *)uri
                  enabled:(BOOL)enabled)
{
  if (![uri isKindOfClass:[NSString class]] || uri.length == 0) {
    return;
  }
  NSUserDefaults *shared =
      [[NSUserDefaults alloc] initWithSuiteName:kSylkAppGroup];
  NSMutableArray<NSString *> *uris =
      [[shared arrayForKey:kSylkBypassDndKey] mutableCopy]
          ?: [NSMutableArray new];
  NSString *key = [uri lowercaseString];
  BOOL present = [uris containsObject:key];

  if (enabled && !present) {
    [uris addObject:key];
  } else if (!enabled && present) {
    [uris removeObject:key];
  } else {
    return;  // no change — don't churn the shared container
  }

  [shared setObject:uris forKey:kSylkBypassDndKey];
  SylkWriteBypassDndFile(uris);
  [SylkLogger log:@"[push] bypassdnd set %@: %@ (%lu total)",
      enabled ? @"add" : @"remove", key, (unsigned long)uris.count];
}

// Bulk-sync the bypassdnd URI set. Called from JS after every contacts
// load — a whole-list replace, so an untag done on ANOTHER device and
// arriving via address-book sync actually clears here rather than
// lingering in the extension's copy.
RCT_EXPORT_METHOD(syncContactBypassDnd:(NSArray *)uris)
{
  if (![uris isKindOfClass:[NSArray class]]) {
    return;
  }
  NSMutableArray<NSString *> *clean = [NSMutableArray new];
  for (id v in uris) {
    if ([v isKindOfClass:[NSString class]] && [(NSString *)v length] > 0) {
      NSString *key = [(NSString *)v lowercaseString];
      if (![clean containsObject:key]) { [clean addObject:key]; }
    }
  }
  NSUserDefaults *shared =
      [[NSUserDefaults alloc] initWithSuiteName:kSylkAppGroup];
  [shared setObject:clean forKey:kSylkBypassDndKey];
  [shared synchronize];

  // Authoritative write for the extension (the NSE reads this file).
  SylkWriteBypassDndFile(clean);

  [SylkLogger log:@"[push] bypassdnd set synced: %lu contacts",
      (unsigned long)clean.count];
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

