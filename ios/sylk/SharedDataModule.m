//
//  SharedDataModule.m
//  sylk
//
//  Bridge module exposing iOS-side native helpers to React Native:
//   • App Group container access (read/purge shared container)
//   • Active chat persistence (for native message-push handling)
//   • In-conference flag (for the AppDelegate VoIP push gate that
//     silently drops incoming-call pushes while the user is in a
//     conference — see shouldDisplayMessageFromPayload).
//
//  Single source of truth: this file. The previously-orphaned
//  top-level copy at ios/SharedDataModule.m has been removed.
//

#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>
#import "SylkLogger.h"

@interface SharedDataModule : RCTEventEmitter <RCTBridgeModule>
@property (nonatomic, strong) NSString *pendingData;
@end

@implementation SharedDataModule

// Only one RCT_EXPORT_MODULE per class
RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  [SylkLogger log:@"[shared-data] requiresMainQueueSetup called"];
  return YES;
}

// Events this module relays to JS.
//
// 'sylkAutoAnswered' — an incoming call is being answered by the auto-answer
// timer rather than by the user. AppDelegate posts SylkAutoAnsweredCall just
// before it hands the answer to CallKit; JS uses it to bring the camera up
// without the "Enable your camera?" prompt (nobody is holding the phone). The
// Android equivalent rides on the IncomingCallAction payload as `autoAnswered`.
- (NSArray<NSString *> *)supportedEvents {
  return @[@"sylkAutoAnswered"];
}

// RCTEventEmitter only wants observers wired while JS actually has listeners;
// emitting outside that window logs a "sending event with no listeners" warning.
- (void)startObserving {
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(handleAutoAnswered:)
                                               name:@"SylkAutoAnsweredCall"
                                             object:nil];
}

- (void)stopObserving {
  [[NSNotificationCenter defaultCenter] removeObserver:self
                                                  name:@"SylkAutoAnsweredCall"
                                                object:nil];
}

- (void)handleAutoAnswered:(NSNotification *)note {
  NSString *callUUID = note.userInfo[@"callUUID"];
  if (!callUUID) {
    return;
  }
  [SylkLogger log:@"[shared-data] relaying auto-answer signal for %@", callUUID];
  [self sendEventWithName:@"sylkAutoAnswered" body:@{@"callUUID": callUUID}];
}

// --- Get App Group container path ---
RCT_REMAP_METHOD(appGroupContainerPath,
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *containerURL = [[NSFileManager defaultManager] containerURLForSecurityApplicationGroupIdentifier:@"group.com.agprojects.sylk-ios"];
  if (containerURL) {
      resolve(containerURL.path);
  } else {
      NSError *error = [NSError errorWithDomain:@"SharedDataModule" code:0 userInfo:@{NSLocalizedDescriptionKey:@"Could not get App Group path"}];
      reject(@"no_container", @"Could not get App Group path", error);
  }
}

// --- Purge all files inside App Group ---
RCT_REMAP_METHOD(purgeAppGroupContainer,
                 purgeResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSFileManager *fm = [NSFileManager defaultManager];
  NSURL *containerURL = [fm containerURLForSecurityApplicationGroupIdentifier:@"group.com.agprojects.sylk-ios"];

  if (!containerURL) {
      NSError *error = [NSError errorWithDomain:@"SharedDataModule" code:0 userInfo:@{NSLocalizedDescriptionKey:@"Could not get App Group container"}];
      reject(@"no_container", @"Could not get App Group container", error);
      return;
  }

  NSError *error = nil;
  NSArray<NSURL *> *files = [fm contentsOfDirectoryAtURL:containerURL
                             includingPropertiesForKeys:nil
                                                options:NSDirectoryEnumerationSkipsHiddenFiles
                                                  error:&error];
  if (error) {
      reject(@"list_error", @"Failed to list files", error);
      return;
  }

  // Preserve app-managed state that lives in the SAME App Group
  // container but is NOT a share-extension leftover. This purge runs on
  // every app background (via JS purgeSharedFiles) to clear imported
  // share files — but a blanket delete also wiped:
  //   • contactDisplayNames.plist — the {uri: display_name} map the
  //     SylkNotificationService extension reads to retitle message push
  //     banners with the local contact name. Deleting it on background
  //     meant the NSE always saw an empty map and fell back to the bare
  //     URI (the "push notification shows no display name" bug).
  //   • Library — holds the App Group NSUserDefaults plist
  //     (Library/Preferences/group.com.agprojects.sylk-ios.plist). Wiping
  //     it destroyed every shared default too.
  // Only genuine share-drop artifacts should be purged here.
  NSSet<NSString *> *preserve = [NSSet setWithArray:@[
      @"contactDisplayNames.plist",
      @"Library",
      // WebRTC screen-share sockets. getDisplayMedia() binds these Unix-domain
      // sockets in THIS container so the broadcast-upload extension (SylkBroadcast)
      // can connect and stream the shared screen. The purge runs on every app
      // background — and starting a screen share backgrounds the app when the
      // broadcast begins — so without preserving these, the purge deleted the
      // live socket and the extension reported "socket file missing" (no frames
      // ever reached the peer). See react-native-webrtc ScreenCaptureController
      // (rtc_SSFD) / the SylkBroadcast SampleHandler (rtc_SSFD + rtc_SSFD_audio).
      @"rtc_SSFD",
      @"rtc_SSFD_audio",
  ]];

  // Only purge files older than 24h. A recently-created file may still be
  // in use — e.g. the WebRTC screen-share socket (rtc_SSFD) bound moments
  // ago, or a share just dropped in — and deleting it mid-use breaks the
  // feature. Age it out instead so genuinely stale leftovers are still
  // cleaned up but fresh artifacts survive a background purge.
  NSDate *cutoff = [NSDate dateWithTimeIntervalSinceNow:-24 * 60 * 60];

  for (NSURL *fileURL in files) {
      NSString *name = fileURL.lastPathComponent;
      if ([preserve containsObject:name]) {
          [SylkLogger log:@"[shared-data] Preserving %@ (app state, not a shared file)", name];
          continue;
      }
      // Skip files modified within the last 24h.
      NSDate *modDate = nil;
      NSError *dateErr = nil;
      if (![fileURL getResourceValue:&modDate forKey:NSURLContentModificationDateKey error:&dateErr]) {
          modDate = nil;
      }
      if (modDate && [modDate compare:cutoff] == NSOrderedDescending) {
          [SylkLogger log:@"[shared-data] Keeping %@ (modified %@, younger than 24h)", name, modDate];
          continue;
      }
      NSError *removeError = nil;
      [fm removeItemAtURL:fileURL error:&removeError];
      if (removeError) {
          [SylkLogger log:@"[shared-data] Failed to delete %@: %@", name, removeError];
      } else {
          [SylkLogger log:@"[shared-data] Deleted %@ (older than 24h)", name];
      }
  }

  resolve(@(YES));
}

// Persist the active-chat URI so the native message-push handler can
// suppress notifications for the conversation the user is currently
// looking at. Persisted in standardUserDefaults under "activeChatJID"
// so it survives across launches.
RCT_EXPORT_METHOD(setActiveChat:(NSString * _Nullable)jid)
{
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];

    if (jid != nil && [jid length] > 0) {
        [defaults setObject:jid forKey:@"activeChatJID"];
        [SylkLogger log:@"[shared-data] Active chat set to %@", jid];
    } else {
        [defaults removeObjectForKey:@"activeChatJID"];
        [SylkLogger log:@"[shared-data] Active chat cleared"];
    }

    [defaults synchronize]; // ensure it's written immediately
}

// Persist whether the user is currently mid-conference so the
// PushKit VoIP handler in AppDelegate (shouldDisplayMessageFromPayload)
// can drop the loud CallKit ring for an incoming call / conference
// invite and surface a silent missed-call local notification instead.
// Stored in standardUserDefaults under "inConference"; AppDelegate
// reads the same key. Mirrors the Android SylkBridge.setInConference
// path. Default (unset / NO) means "not in conference" — push rings
// normally.
RCT_EXPORT_METHOD(setInConference:(BOOL)active)
{
    [[NSUserDefaults standardUserDefaults] setBool:active forKey:@"inConference"];
    [[NSUserDefaults standardUserDefaults] synchronize];
    [SylkLogger log:@"[shared-data] inConference set to %@", active ? @"YES" : @"NO"];
}

@end
