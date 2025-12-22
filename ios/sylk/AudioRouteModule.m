//
//  SYLK
/*
 * Copyright (c) 2025 Adrian Georgescu ag@ag-projects.com
 *
 * Permission to use, copy, modify, and distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */


#import "AudioRouteModule.h"
#import <AVFoundation/AVFoundation.h>
#import <React/RCTLog.h>

@implementation AudioRouteModule {
  BOOL _hasListeners;
  NSString *_currentRoute;
  NSString *_origCategory;
  AVAudioSessionCategoryOptions _origOptions;
  AVAudioSessionMode _origMode;
  BOOL _started;
}

RCT_EXPORT_MODULE(AudioRouteModule);

#pragma mark - RCTEventEmitter overrides

- (NSArray<NSString *> *)supportedEvents {
  //NSLog(@"[sylk_app][AudioRouteModule] supportedEvents");
  return @[@"CommunicationsDevicesChanged"];
}

+ (BOOL)requiresMainQueueSetup {
  NSLog(@"[sylk_app][AudioRouteModule] requiresMainQueueSetup");
  // We access AVAudioSession and register notifications — run on main queue for safety.
  return YES;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        NSLog(@"[sylk_app][AudioRouteModule] init: configuring AVAudioSession for VoIP");

        NSError *err = nil;
        AVAudioSession *session = [AVAudioSession sharedInstance];

        // Configure for communication (VOIP)
        BOOL categorySet = [session setCategory:AVAudioSessionCategoryPlayAndRecord
                                    withOptions:(AVAudioSessionCategoryOptionAllowBluetooth)
                                          error:&err];
        if (!categorySet) {
            NSLog(@"[sylk_app][AudioRouteModule] Failed to set category: %@", err);
        } else {
            NSLog(@"[sylk_app][AudioRouteModule] setCategory: PlayAndRecord OK");
        }

        BOOL modeSet = [session setMode:AVAudioSessionModeVoiceChat error:&err];
        if (!modeSet) {
            NSLog(@"[sylk_app][AudioRouteModule] Failed to set mode: %@", err);
        } else {
            NSLog(@"[sylk_app][AudioRouteModule] setMode: VoiceChat OK");
        }

    }
    return self;
}

- (void)startObserving {
  NSLog(@"[sylk_app][AudioRouteModule] startObserving");
  _hasListeners = YES;
  // subscribe to route-change notifications
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(handleRouteChange:)
                                               name:AVAudioSessionRouteChangeNotification
                                             object:nil];
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(handleInterruption:)
                                               name:AVAudioSessionInterruptionNotification
                                             object:nil];
}

- (void)stopObserving {
  NSLog(@"[sylk_app][AudioRouteModule] stopObserving");
  _hasListeners = NO;
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)dealloc {
  NSLog(@"[sylk_app][AudioRouteModule] dealloc");
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

#pragma mark - Helpers

- (NSDictionary *)deviceDictForPort:(AVAudioSessionPortDescription *)port typeForIOS:(BOOL)isInput {
  if (!port) return @{};
  NSString *type = [self typeStringForPortType:port.portType];
  NSString *name = port.portName ?: @"UNKNOWN";
  NSString *uid = port.UID ?: @"";
  //NSLog(@"[sylk_app][AudioRouteModule] deviceDictForPort name=%@ type=%@ uid=%@", name, type, uid);
  return @{@"id": uid, @"name": name, @"type": type};
}

- (NSString *)typeStringForPortType:(NSString *)portType {
  // Map AVAudioSession port type constants
  //NSLog(@"[sylk_app][AudioRouteModule] typeStringForPortType: %@", portType);
  if ([portType isEqualToString:AVAudioSessionPortBuiltInReceiver]) return @"BUILTIN_EARPIECE";
  if ([portType isEqualToString:AVAudioSessionPortBuiltInSpeaker]) return @"BUILTIN_SPEAKER";
  if ([portType isEqualToString:AVAudioSessionPortHeadsetMic]) return @"WIRED_HEADSET";
  if ([portType isEqualToString:AVAudioSessionPortBluetoothHFP]) return @"BLUETOOTH_SCO";
  if ([portType isEqualToString:AVAudioSessionPortBluetoothA2DP]) return @"BLUETOOTH_A2DP";
  if ([portType isEqualToString:AVAudioSessionPortUSBAudio]) return @"USB_DEVICE";
  if ([portType isEqualToString:AVAudioSessionPortHDMI]) return @"HDMI";
  if ([portType isEqualToString:AVAudioSessionPortCarAudio]) return @"CAR_AUDIO";
  if ([portType isEqualToString:AVAudioSessionPortBluetoothLE]) return @"BLUETOOTH_LE";
  if ([portType isEqualToString:AVAudioSessionPortBuiltInMic] || [portType isEqualToString:@"MicrophoneBuiltIn"]) return @"BUILTIN_MIC";
    
    return [NSString stringWithFormat:@"UNKNOWN (%@)", portType];
}

- (NSArray *)getAudioInputsArray {
  //NSLog(@"[sylk_app][AudioRouteModule] getAudioInputsArray");
  NSMutableArray *arr = [NSMutableArray array];
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSArray<AVAudioSessionPortDescription *> *inputs = session.availableInputs;
  for (AVAudioSessionPortDescription *p in inputs) {
    [arr addObject:[self deviceDictForPort:p typeForIOS:YES]];
  }
  //NSLog(@"[sylk_app][AudioRouteModule] inputs=%@", arr);
  return arr;
}

- (NSArray *)getAudioOutputsArray {
    //NSLog(@"[sylk_app][AudioRouteModule] getAudioOutputsArray (currentRoute outputs + virtuals)");

    NSMutableArray *arr = [NSMutableArray array];
    AVAudioSession *session = [AVAudioSession sharedInstance];
    AVAudioSessionRouteDescription *route = session.currentRoute;

    // Add actual outputs
    for (AVAudioSessionPortDescription *p in route.outputs) {
        NSString *type = [self typeStringForPortType:p.portType];
        // Only include allowed VOIP-capable types
        if ([type isEqualToString:@"BUILTIN_EARPIECE"] ||
            [type isEqualToString:@"BUILTIN_SPEAKER"] ||
            [type isEqualToString:@"WIRED_HEADSET"] ||
            [type isEqualToString:@"BLUETOOTH_SCO"]) {
            [arr addObject:[self deviceDictForPort:p typeForIOS:NO]];
        } else {
            //NSLog(@"[sylk_app][AudioRouteModule] skipping output type %@", type);
        }
    }

    // Add missing inputs to outputs (for VOIP-capable devices)
    NSArray *inputs = [self getAudioInputsArray];
    for (NSDictionary *input in inputs) {
        NSString *type = input[@"type"];
        if (([type isEqualToString:@"WIRED_HEADSET"] || [type isEqualToString:@"BLUETOOTH_SCO"]) &&
            ![arr containsObject:input]) {
            //NSLog(@"[sylk_app][AudioRouteModule] adding input to outputs: %@", input);
            [arr addObject:input];
        }
    }

    // Always append virtual outputs: Speaker + Earpiece (if not already present)
    BOOL hasSpeaker = NO;
    BOOL hasEarpiece = NO;
    for (NSDictionary *d in arr) {
        NSString *t = d[@"type"];
        if ([t isEqualToString:@"BUILTIN_SPEAKER"]) hasSpeaker = YES;
        if ([t isEqualToString:@"BUILTIN_EARPIECE"]) hasEarpiece = YES;
    }

    if (!hasSpeaker) {
        NSDictionary *speaker = @{@"id": @"builtin_speaker", @"name": @"Speaker", @"type": @"BUILTIN_SPEAKER"};
        //NSLog(@"[sylk_app][AudioRouteModule] adding virtual output: Speaker");
        [arr addObject:speaker];
    }

    if (!hasEarpiece) {
        NSDictionary *earpiece = @{@"id": @"builtin_earpiece", @"name": @"Earpiece", @"type": @"BUILTIN_EARPIECE"};
        //NSLog(@"[sylk_app][AudioRouteModule] adding virtual output: Earpiece");
        [arr addObject:earpiece];
    }

    BOOL bluetoothSCOFound = NO;

    for (NSDictionary *d in inputs) {
      NSString *type = d[@"type"];
      if ([type isEqualToString:@"BLUETOOTH_SCO"]) {
        bluetoothSCOFound = YES;
        break;
      }
    }

    if (bluetoothSCOFound) {
      NSMutableArray *filtered = [NSMutableArray array];
      for (NSDictionary *d in arr) {
        NSString *type = d[@"type"];
        if (![type isEqualToString:@"BUILTIN_EARPIECE"]) {
          [filtered addObject:d];
        } else {
          //NSLog(@"[sylk_app][AudioRouteModule] (filter) Removing earpiece because BT SCO input detected");
        }
      }
      arr = filtered;
    }
    
    //NSLog(@"[sylk_app][AudioRouteModule] outputs=%@", arr);

    return arr;
}


- (NSDictionary *)getCurrentRouteInfoDictionary {
    AVAudioSession *session = [AVAudioSession sharedInstance];
    AVAudioSessionRouteDescription *route = session.currentRoute;

    NSMutableArray *inputs = [[self getAudioInputsArray] mutableCopy];
    NSMutableArray *outputs = [[self getAudioOutputsArray] mutableCopy];

    NSDictionary *selected = nil;

    if (route.outputs.count > 0) {
        NSLog(@"[sylk_app][AudioRouteModule] currentRoute: outputs exist, picking first output");
        AVAudioSessionPortDescription *firstOutput = route.outputs.firstObject;
        selected = [self deviceDictForPort:firstOutput typeForIOS:NO];
        NSLog(@"[sylk_app][AudioRouteModule] initial selected device from output: %@", selected);

        // Try to find same device in inputs by UID
        BOOL usedInputType = NO;
        for (NSDictionary *input in inputs) {
            if ([input[@"id"] isEqualToString:selected[@"id"]]) {
                NSMutableDictionary *mutableSelected = [selected mutableCopy];
                mutableSelected[@"type"] = input[@"type"];
                selected = [mutableSelected copy];
                usedInputType = YES;
                //NSLog(@"[sylk_app][AudioRouteModule] matched selected device in inputs, using input type: %@", selected[@"type"]);
                break;
            }
        }
        if (!usedInputType) {
            //NSLog(@"[sylk_app][AudioRouteModule] selected device not found in inputs, keeping output type: %@", selected[@"type"]);
        }

        // If selected device not in inputs, add it as input-only
        BOOL foundInInputs = NO;
        for (NSDictionary *input in inputs) {
            if ([input[@"id"] isEqualToString:selected[@"id"]]) {
                foundInInputs = YES;
                break;
            }
        }
        if (!foundInInputs) {
            NSDictionary *inputOnlyDevice = @{@"id": selected[@"id"],
                                              @"name": selected[@"name"],
                                              @"type": selected[@"type"]};
            [inputs addObject:inputOnlyDevice];
            //NSLog(@"[sylk_app][AudioRouteModule] added selected device to inputs: %@", inputOnlyDevice);
        } else {
            //NSLog(@"[sylk_app][AudioRouteModule] selected device already exists in inputs");
        }

        // If selected device not in outputs, add it as output-only
        BOOL foundInOutputs = NO;
        for (NSDictionary *output in outputs) {
            if ([output[@"id"] isEqualToString:selected[@"id"]]) {
                foundInOutputs = YES;
                break;
            }
        }
        if (!foundInOutputs) {
            NSDictionary *outputOnlyDevice = @{@"id": selected[@"id"],
                                               @"name": selected[@"name"],
                                               @"type": selected[@"type"]};
            [outputs addObject:outputOnlyDevice];
            NSLog(@"[sylk_app][AudioRouteModule] added selected device to outputs: %@", outputOnlyDevice);
        } else {
            NSLog(@"[sylk_app][AudioRouteModule] selected device already exists in outputs");
        }

        if (selected[@"type"]) {
            _currentRoute = selected[@"type"];
            NSLog(@"[sylk_app][AudioRouteModule] _currentRoute updated to: %@", _currentRoute);
        }

        return selected;
    } else {
        NSLog(@"[sylk_app][AudioRouteModule] no outputs in current route");
    }

    // Fallback: no outputs, return virtual current route if known
    if (_currentRoute) {
        NSDictionary *fallback = @{@"id": @"", @"name": @"", @"type": _currentRoute};
        NSLog(@"[sylk_app][AudioRouteModule] returning fallback currentRoute: %@", _currentRoute);
        return fallback;
    } else {
        NSLog(@"[sylk_app][AudioRouteModule] no current route known, returning empty dictionary");
    }

    return @{};
}



#pragma mark - Notification handlers

- (void)handleRouteChange:(NSNotification *)note {
  // Called when AVAudioSession route changes (headset plug/unplug, BT connect/disconnect, speaker toggle)
  //NSLog(@"[sylk_app][AudioRouteModule] handleRouteChange: %@", note.userInfo);
  if (_hasListeners) {
    [self sendReactNativeEvent];
  }
}

- (void)handleInterruption:(NSNotification *)note {
  // handle interruptions (eg. phone call) — emit event so RN side can refresh state
  NSLog(@"[sylk_app][AudioRouteModule] handleInterruption: %@", note.userInfo);
  if (_hasListeners) {
    [self sendReactNativeEvent];
  }
}

- (void)forceSelectBestDeviceAtStart
{
  NSArray *inputs = [self getAudioInputsArray];
  NSArray *outputs = [self getAudioOutputsArray];

  NSMutableArray *all = [NSMutableArray array];
  [all addObjectsFromArray:outputs];
  [all addObjectsFromArray:inputs];

  // Priority list
  NSArray *priority = @[
    @"BLUETOOTH_SCO",
    @"WIRED_HEADSET",
    @"BUILTIN_EARPIECE",
    @"BUILTIN_SPEAKER"
  ];

  for (NSString *type in priority) {
    for (NSDictionary *dev in all) {
      if ([dev[@"type"] isEqualToString:type]) {
        NSLog(@"[sylk_app][AudioRouteModule] FORCE selecting start device %@", dev);
        [self switchAudioRouteInternal:dev];
        return;
      }
    }
  }

  NSLog(@"[sylk_app][AudioRouteModule] No eligible device to force-select");
}

#pragma mark - Sending RN event

- (void)sendReactNativeEvent {
  @try {
    //NSLog(@"[sylk_app][AudioRouteModule] sendReactNativeEvent (pre-check bridge)");
    // Safe bridge check: older/newer RN may or may not have isValid
    BOOL bridgeReady = NO;
    if (self.bridge) {
      if ([self.bridge respondsToSelector:@selector(isValid)]) {
        bridgeReady = [self.bridge isValid];
      } else {
        // best-effort assume ready if non-nil
        bridgeReady = YES;
      }
    }
    if (!bridgeReady) {
      NSLog(@"[sylk_app][AudioRouteModule] bridge not ready; skipping emit");
      return;
    }

    NSDictionary *selected = [self getCurrentRouteInfoDictionary];
    NSArray *inputs = [self getAudioInputsArray];
    NSArray *outputs = [self getAudioOutputsArray];

    // Keep Android-style logic commented out for Bluetooth filtering (left intentionally)
    /*
    // If selected type is BLUETOOTH*, filter outputs to only bluetooth entries (mimic Android logic)
    NSString *selectedType = selected[@"type"];
    if (selectedType != nil && [selectedType hasPrefix:@"BLUETOOTH"]) {
      NSMutableArray *filtered = [NSMutableArray array];
      for (NSDictionary *dev in outputs) {
        NSString *t = dev[@"type"];
        if (t != nil && [t hasPrefix:@"BLUETOOTH"]) {
          [filtered addObject:dev];
        }
      }
      outputs = filtered;
    }
    */

    NSDictionary *payload = @{
      @"inputs": inputs,
      @"outputs": outputs,
      @"selected": selected ?: @{},
      @"mode": [self audioModeString]
    };

    //NSLog(@"[sylk_app][AudioRouteModule] emitting CommunicationsDevicesChanged payload=%@", payload);

    [self sendEventWithName:@"CommunicationsDevicesChanged" body:payload];
  } @catch (NSException *ex) {
    RCTLogError(@"[sylk_app][AudioRouteModule] sendReactNativeEvent ERROR: %@", ex);
  }
}

- (NSString *)audioModeString {
  // iOS does not have exact equivalents to Android modes; return category/mode for info
  AVAudioSession *s = [AVAudioSession sharedInstance];
  NSString *cat = s.category ?: @"UNKNOWN";
  NSString *mode = s.mode ?: @"UNKNOWN";
  return [NSString stringWithFormat:@"%@/%@", cat, mode];
}

#pragma mark - Exposed methods

RCT_EXPORT_METHOD(getEvent)
{
  NSLog(@"[sylk_app][AudioRouteModule] getEvent called");
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendReactNativeEvent];
  });
}

RCT_EXPORT_METHOD(getAudioInputs:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSLog(@"[sylk_app][AudioRouteModule] getAudioInputs called");
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      NSArray *arr = [self getAudioInputsArray];
      resolve(arr);
    } @catch (NSException *ex) {
      NSLog(@"[sylk_app][AudioRouteModule] getAudioInputs EX: %@", ex);
      reject(@"ERROR", ex.reason, nil);
    }
  });
}

RCT_EXPORT_METHOD(getAudioOutputs:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSLog(@"[sylk_app][AudioRouteModule] getAudioOutputs called");
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      NSArray *arr = [self getAudioOutputsArray];
      resolve(arr);
    } @catch (NSException *ex) {
      NSLog(@"[sylk_app][AudioRouteModule] getAudioOutputs EX: %@", ex);
      reject(@"ERROR", ex.reason, nil);
    }
  });
}

RCT_EXPORT_METHOD(getCurrentRoute:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSLog(@"[sylk_app][AudioRouteModule] getCurrentRoute called");
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      NSDictionary *info = [self getCurrentRouteInfoDictionary];
      resolve(info);
    } @catch (NSException *ex) {
      //NSLog(@"[sylk_app][AudioRouteModule] getCurrentRoute EX: %@", ex);
      reject(@"ERROR", ex.reason, nil);
    }
  });
}

/**
 * start(deviceMap)
 *
 * deviceMap is optional — if provided we attempt an initial switch.
 * This method sets AVAudioSession category to PlayAndRecord (communication use-case),
 * saves original category/options to restore on stop.
 */
RCT_EXPORT_METHOD(start:(NSDictionary *)deviceMap
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSLog(@"[sylk_app][AudioRouteModule] start called deviceMap=%@", deviceMap);
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_started) {
      NSLog(@"[sylk_app][AudioRouteModule] start: already started");
      resolve(@(YES));
      return;
    }

    NSError *err = nil;
    AVAudioSession *session = [AVAudioSession sharedInstance];
    // Save original settings to restore later
    self->_origCategory = session.category ?: @"";
    self->_origOptions = session.categoryOptions;
    self->_origMode = session.mode;

    NSLog(@"[sylk_app][AudioRouteModule] Saved original category=%@ options=%lu mode=%@", self->_origCategory, (unsigned long)self->_origOptions, self->_origMode);

    BOOL activated = [session setActive:YES error:&err];
    if (!activated) {
      NSLog(@"[sylk_app][AudioRouteModule] Failed to activate session: %@", err);
      // not a hard failure: continue but notify
    } else {
      NSLog(@"[sylk_app][AudioRouteModule] setActive: YES OK");
    }

    self->_started = YES;

    // If deviceMap provided try to switch route
    if (deviceMap && deviceMap.count > 0) {
      BOOL switched = [self switchAudioRouteInternal:deviceMap];
      if (!switched) {
        NSLog(@"[sylk_app][AudioRouteModule] start: requested audio device not available: %@", deviceMap[@"type"]);
      } else {
        NSLog(@"[sylk_app][AudioRouteModule] start: switched to %@", deviceMap[@"type"]);
      }
    }

      [self forceSelectBestDeviceAtStart];
      
    // Emit initial event
    [self sendReactNativeEvent];

    resolve(@(YES));
  });
}

RCT_EXPORT_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSLog(@"[sylk_app][AudioRouteModule] stop called");
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!self->_started) {
      NSLog(@"[sylk_app][AudioRouteModule] stop: not started");
      resolve(@(YES));
      return;
    }

    NSError *err = nil;
    AVAudioSession *session = [AVAudioSession sharedInstance];

    // restore original category/options/mode if possible
    if (self->_origCategory && self->_origCategory.length > 0) {
      BOOL ok = [session setCategory:self->_origCategory withOptions:self->_origOptions error:&err];
      if (!ok) {
        NSLog(@"[sylk_app][AudioRouteModule] Failed to restore category: %@", err);
      } else {
        NSLog(@"[sylk_app][AudioRouteModule] category restored: %@", self->_origCategory);
      }
    }

    // Fix: restore mode via setter (mode is readonly property)
    if (self->_origMode) {
      NSError *modeErr = nil;
      BOOL modeOk = [session setMode:self->_origMode error:&modeErr];
      if (!modeOk) {
        NSLog(@"[sylk_app][AudioRouteModule] Failed to restore mode: %@", modeErr);
      } else {
        NSLog(@"[sylk_app][AudioRouteModule] mode restored: %@", self->_origMode);
      }
    }

    BOOL deact = [session setActive:NO
                          withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                                error:&err];
      
      if (!deact) {
      NSLog(@"[sylk_app][AudioRouteModule] Failed to deactivate session: %@", err);
    } else {
      NSLog(@"[sylk_app][AudioRouteModule] session deactivated");
    }

    self->_started = NO;

    // Emit event so RN refreshes device list
    [self sendReactNativeEvent];

    resolve(@(YES));
  });
}

/**
 * setActiveDevice(deviceMap)
 *
 * deviceMap should contain at least a "type" or an "id" (UID) returned from getAudioInputs/getAudioOutputs.
 * For inputs we use setPreferredInput; for outputs we attempt speaker override or rely on category options.
 */

RCT_EXPORT_METHOD(setActiveDevice:(NSDictionary *)deviceMap
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
    NSLog(@"[sylk_app][AudioRouteModule] setActiveDevice called: %@", deviceMap);
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!deviceMap || deviceMap.count == 0) {
            NSLog(@"[sylk_app][AudioRouteModule] setActiveDevice: no device provided");
            reject(@"ERROR", @"No device provided", nil);
            return;
        }

        AVAudioSession *session = [AVAudioSession sharedInstance];
        NSError *err = nil;
        NSString *type = deviceMap[@"type"];
        NSString *uid = deviceMap[@"id"];

        BOOL switched = NO;

        // --- Handle built-in earpiece explicitly ---
        if ([type isEqualToString:@"BUILTIN_EARPIECE"]) {
            // Set preferred input to built-in mic
            if (![session setPreferredInput:nil error:&err]) {
                NSLog(@"[sylk_app][AudioRouteModule] setPreferredInput to built-in failed: %@", err);
            } else {
                NSLog(@"[sylk_app][AudioRouteModule] setPreferredInput to built-in OK");
            }

            // Force output to earpiece (default route)
            if (![session overrideOutputAudioPort:AVAudioSessionPortOverrideNone error:&err]) {
                NSLog(@"[sylk_app][AudioRouteModule] overrideOutputAudioPort to earpiece failed: %@", err);
            } else {
                NSLog(@"[sylk_app][AudioRouteModule] forced output to earpiece");
                _currentRoute = @"BUILTIN_EARPIECE";
                switched = YES;
            }
        } else {
            // Use your normal routing logic for other devices
            switched = [self switchAudioRouteInternal:deviceMap];
        }

        if (switched) {
            [self sendReactNativeEvent];
            resolve(@(YES));
        } else {
            NSLog(@"[sylk_app][AudioRouteModule] setActiveDevice: switch failed for %@", type);
            reject(@"ERROR", @"Requested audio device not available", nil);
        }
    });
}


#pragma mark - Internal routing

- (BOOL)switchAudioRouteInternal:(NSDictionary *)deviceMap {
  NSLog(@"[sylk_app][AudioRouteModule] switchAudioRouteInternal: %@", deviceMap);
  @try {
    NSString *type = deviceMap[@"type"];
    NSString *uid = deviceMap[@"id"];
    NSString *name = deviceMap[@"name"];

    AVAudioSession *session = [AVAudioSession sharedInstance];

    // Try to match available inputs first (preferred input)
    if (uid && uid.length > 0) {
      NSLog(@"[sylk_app][AudioRouteModule] trying match by UID: %@", uid);
      for (AVAudioSessionPortDescription *p in session.availableInputs) {
        if ([p.UID isEqualToString:uid]) {
          NSError *err = nil;
          BOOL ok = [session setPreferredInput:p error:&err];
          if (!ok) {
            NSLog(@"[sylk_app][AudioRouteModule] setPreferredInput failed: %@", err);
          } else {
            // update current route info
            _currentRoute = [self typeStringForPortType:p.portType];
            NSLog(@"[sylk_app][AudioRouteModule] setPreferredInput OK currentRoute=%@", _currentRoute);
            [self sendReactNativeEvent];
            return ok;
          }
        }
      }
    }

    // Try matching by type string
    if (type && type.length > 0) {
      NSLog(@"[sylk_app][AudioRouteModule] trying match by type: %@", type);
      // If type requests speaker explicitly
      if ([type isEqualToString:@"BUILTIN_SPEAKER"] || [type isEqualToString:@"SPEAKER_PHONE"]) {
        // Use overrideOutputAudioPort to force speaker
        NSError *err = nil;
        BOOL ok = [session overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker error:&err];
        if (!ok) {
          NSLog(@"[sylk_app][AudioRouteModule] overrideOutputAudioPort(Speaker) failed: %@", err);
        } else {
          _currentRoute = @"BUILTIN_SPEAKER";
          NSLog(@"[sylk_app][AudioRouteModule] overrideOutputAudioPort: Speaker OK");
          [self sendReactNativeEvent];
          return ok;
        }
      }

      // Wired headset/headphones: prefer input by port type first
      // We search availableInputs and current route outputs for matching port types
      NSString *targetPortType = nil;
      if ([type isEqualToString:@"WIRED_HEADSET"]) targetPortType = AVAudioSessionPortHeadsetMic;
      else if ([type isEqualToString:@"BLUETOOTH_SCO"]) targetPortType = AVAudioSessionPortBluetoothHFP;
      else if ([type isEqualToString:@"BLUETOOTH_A2DP"]) targetPortType = AVAudioSessionPortBluetoothA2DP;
      else if ([type isEqualToString:@"BUILTIN_EARPIECE"]) targetPortType = AVAudioSessionPortBuiltInReceiver;
      else if ([type isEqualToString:@"USB_DEVICE"]) targetPortType = AVAudioSessionPortUSBAudio;
      else if ([type isEqualToString:@"HDMI"]) targetPortType = AVAudioSessionPortHDMI;

      if (targetPortType) {
        NSLog(@"[sylk_app][AudioRouteModule] targetPortType = %@", targetPortType);
        // Try to set preferred input (if it's an input-capable port)
        for (AVAudioSessionPortDescription *p in session.availableInputs) {
          if ([p.portType isEqualToString:targetPortType]) {
            NSError *err = nil;
            BOOL ok = [session setPreferredInput:p error:&err];
            if (!ok) {
              NSLog(@"[sylk_app][AudioRouteModule] setPreferredInput failed: %@", err);
            } else {
              _currentRoute = [self typeStringForPortType:p.portType];
              NSLog(@"[sylk_app][AudioRouteModule] setPreferredInput OK currentRoute=%@", _currentRoute);
              [self sendReactNativeEvent];
              return ok;
            }
          }
        }

        // For outputs that are not settable via preferredInput, check current outputs (best-effort)
        for (AVAudioSessionPortDescription *p in session.currentRoute.outputs) {
          if ([p.portType isEqualToString:targetPortType]) {
            _currentRoute = [self typeStringForPortType:p.portType];
            NSLog(@"[sylk_app][AudioRouteModule] matched currentRoute output=%@", _currentRoute);
            [self sendReactNativeEvent];
            return YES;
          }
        }
      } // end if targetPortType
    } // end if type

    // If we reached here, we couldn't route exactly: return false
    NSLog(@"[sylk_app][AudioRouteModule] switchAudioRouteInternal: no match for deviceMap %@", deviceMap);
    return NO;

  } @catch (NSException *ex) {
    NSLog(@"[sylk_app][AudioRouteModule] switchAudioRouteInternal EX: %@", ex);
    RCTLogError(@"switchAudioRouteInternal EX: %@", ex);
    return NO;
  }
}

@end

