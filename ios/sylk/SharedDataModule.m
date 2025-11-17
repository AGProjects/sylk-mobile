//
//  SharedDataModule.m
//  sylk
//
//  Created by Adrian Georgescu on 11/5/25.
//  Copyright © 2025 Facebook. All rights reserved.
//

#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>

@interface SharedDataModule : RCTEventEmitter <RCTBridgeModule>
@end

@implementation SharedDataModule

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

@end
