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

// RCTEventEmitter requires this even if we don't emit anything yet —
// returning an empty array silences the "no supported events" warning.
- (NSArray<NSString *> *)supportedEvents {
  return @[];
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

  for (NSURL *fileURL in files) {
      NSError *removeError = nil;
      [fm removeItemAtURL:fileURL error:&removeError];
      if (removeError) {
          [SylkLogger log:@"[shared-data] Failed to delete %@: %@", fileURL.lastPathComponent, removeError];
      } else {
          [SylkLogger log:@"[shared-data] Deleted %@", fileURL.lastPathComponent];
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
