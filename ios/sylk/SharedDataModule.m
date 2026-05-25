//
//  SharedDataModule.m
//  sylk
//
//  Created by Adrian Georgescu on 11/5/25.
//  Copyright © 2025 Facebook. All rights reserved.
//

#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>
#import "SylkLogger.h"

@interface SharedDataModule : RCTEventEmitter <RCTBridgeModule>
@end

@implementation SharedDataModule
static NSString *activeChatJID = nil;

RCT_EXPORT_MODULE();

- (instancetype)init {
  if (self = [super init]) {
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleSharedData:)
                                                 name:@"SharedDataReceived"
                                               object:nil];
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[@"SharedDataReceived"];
}

- (void)handleSharedData:(NSNotification *)notification {
  NSString *data = notification.object;
  [self sendEventWithName:@"SharedDataReceived" body:@{@"data": data ?: @""}];
}

RCT_EXPORT_METHOD(setActiveChat:(NSString *)jid)
{
    if (jid != nil && [jid length] > 0) {
        activeChatJID = [jid copy];
        [SylkLogger log:@"[shared-data] Active chat set to %@", activeChatJID];
    } else {
        activeChatJID = nil;
        [SylkLogger log:@"[shared-data] Active chat cleared"];
    }
}

// Persist the configured SIP-focus bridge host so the push-receipt
// path in AppDelegate can drop the duplicate "incoming_session" push
// the conference focus sends in parallel with a sylk
// "incoming_conference_request". Stored in standardUserDefaults under
// "sipBridgeDomain"; AppDelegate reads the same key. Setting nil or
// empty clears it (dedupe disabled — safe default if the server hasn't
// published a sipBridge value).
RCT_EXPORT_METHOD(setSipBridgeDomain:(NSString *)domain)
{
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    if (domain == nil || [domain length] == 0) {
        [defaults removeObjectForKey:@"sipBridgeDomain"];
        [SylkLogger log:@"[shared-data] sipBridgeDomain cleared"];
    } else {
        NSString *trimmed = [[domain stringByTrimmingCharactersInSet:
                              [NSCharacterSet whitespaceAndNewlineCharacterSet]]
                             lowercaseString];
        [defaults setObject:trimmed forKey:@"sipBridgeDomain"];
        [SylkLogger log:@"[shared-data] sipBridgeDomain set to %@", trimmed];
    }
}


@end
