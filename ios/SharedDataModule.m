#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>

@interface SharedDataModule : RCTEventEmitter <RCTBridgeModule>
@property (nonatomic, strong) NSString *pendingData;
@end

@implementation SharedDataModule

// Only one RCT_EXPORT_MODULE per class
RCT_EXPORT_MODULE();

static NSString *activeChatJID = nil;

+ (BOOL)requiresMainQueueSetup
{
  NSLog(@"[sylk_share] requiresMainQueueSetup called");
  return YES;
}

// --- NEW METHOD: get App Group container path ---
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
          NSLog(@"[sylk_share] Failed to delete %@: %@", fileURL.lastPathComponent, removeError);
      } else {
          NSLog(@"[sylk_share] Deleted %@", fileURL.lastPathComponent);
      }
  }
  
  resolve(@(YES));
}

RCT_EXPORT_METHOD(setActiveChat:(NSString * _Nullable)jid)
{
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];

    if (jid != nil && [jid length] > 0) {
        [defaults setObject:jid forKey:@"activeChatJID"];
        NSLog(@"[SharedDataModule] Active chat set to %@", jid);
    } else {
        [defaults removeObjectForKey:@"activeChatJID"];
        NSLog(@"[SharedDataModule] Active chat cleared");
    }

    [defaults synchronize]; // ensure it's written immediately
}

@end
