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
  NSDictionary *_lastKnownBtDevice; // cached so BT stays in the list while earpiece is active
}

RCT_EXPORT_MODULE(AudioRouteModule);

#pragma mark - RCTEventEmitter overrides

- (NSArray<NSString *> *)supportedEvents {
  //NSLog(@"[SYLK_APP] [Audio] supportedEvents");
  return @[@"CommunicationsDevicesChanged"];
}

+ (BOOL)requiresMainQueueSetup {
  NSLog(@"[SYLK_APP] [Audio] requiresMainQueueSetup");
  // We access AVAudioSession and register notifications — run on main queue for safety.
  return YES;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        NSLog(@"[SYLK_APP] [Audio] init: configuring AVAudioSession for VoIP");

        NSError *err = nil;
        AVAudioSession *session = [AVAudioSession sharedInstance];

        // Configure for communication (VOIP)
        BOOL categorySet = [session setCategory:AVAudioSessionCategoryPlayAndRecord
                                    withOptions:(AVAudioSessionCategoryOptionAllowBluetooth)
                                          error:&err];
        if (!categorySet) {
            NSLog(@"[SYLK_APP] [Audio] Failed to set category: %@", err);
        } else {
            NSLog(@"[SYLK_APP] [Audio] setCategory: PlayAndRecord OK");
        }

        BOOL modeSet = [session setMode:AVAudioSessionModeVoiceChat error:&err];
        if (!modeSet) {
            NSLog(@"[SYLK_APP] [Audio] Failed to set mode: %@", err);
        } else {
            NSLog(@"[SYLK_APP] [Audio] setMode: VoiceChat OK");
        }

    }
    return self;
}

- (void)startObserving {
  NSLog(@"[SYLK_APP] [Audio] startObserving");
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
  NSLog(@"[SYLK_APP] [Audio] stopObserving");
  _hasListeners = NO;
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)dealloc {
  NSLog(@"[SYLK_APP] [Audio] dealloc");
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

#pragma mark - Helpers

- (NSDictionary *)deviceDictForPort:(AVAudioSessionPortDescription *)port typeForIOS:(BOOL)isInput {
  if (!port) return @{};
  NSString *type = [self typeStringForPortType:port.portType];
  NSString *name = port.portName ?: @"UNKNOWN";
  NSString *uid = port.UID ?: @"";
  //NSLog(@"[SYLK_APP] [Audio] deviceDictForPort name=%@ type=%@ uid=%@", name, type, uid);
  return @{@"id": uid, @"name": name, @"type": type};
}

- (NSString *)typeStringForPortType:(NSString *)portType {
  // Map AVAudioSession port type constants
  //NSLog(@"[SYLK_APP] [Audio] typeStringForPortType: %@", portType);
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
  //NSLog(@"[SYLK_APP] [Audio] getAudioInputsArray");
  NSMutableArray *arr = [NSMutableArray array];
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSArray<AVAudioSessionPortDescription *> *inputs = session.availableInputs;
  for (AVAudioSessionPortDescription *p in inputs) {
    [arr addObject:[self deviceDictForPort:p typeForIOS:YES]];
  }
  //NSLog(@"[SYLK_APP] [Audio] inputs=%@", arr);
  return arr;
}

- (NSArray *)getAudioOutputsArray {
    // Build a deduplicated, type-keyed output list for VoIP use.
    // We track by type (not object identity) to avoid duplicates that arise when
    // the same physical device appears in both currentRoute.outputs and availableInputs
    // with different UIDs.
    //
    // Rules:
    //  1. BUILTIN_EARPIECE and BUILTIN_SPEAKER are always present — the user must be
    //     able to select them even when a BT headset is connected.
    //  2. BT (HFP) and wired headsets are added when present in availableInputs (iOS
    //     exposes them there for input-capable ports used in HFP mode).
    //  3. Any active output from currentRoute that isn't covered above is included too.
    //  4. No earpiece-removal filter when BT is present (that hid earpiece from the menu).

    NSMutableDictionary *byType = [NSMutableDictionary dictionary]; // type → dict
    AVAudioSession *session = [AVAudioSession sharedInstance];

    // Step 1: seed from availableInputs (catches BT HFP, wired headset).
    // Also update the cached BT device whenever we see one.
    for (AVAudioSessionPortDescription *p in session.availableInputs) {
        NSString *type = [self typeStringForPortType:p.portType];
        if ([type isEqualToString:@"BLUETOOTH_SCO"] || [type isEqualToString:@"WIRED_HEADSET"]) {
            if (!byType[type]) {
                NSDictionary *dev = [self deviceDictForPort:p typeForIOS:NO];
                byType[type] = dev;
                if ([type isEqualToString:@"BLUETOOTH_SCO"]) {
                    _lastKnownBtDevice = dev; // cache for when AllowBluetooth is removed
                }
            }
        }
    }

    // If AllowBluetooth was removed (earpiece mode), BT disappears from availableInputs
    // but is still physically connected. Include the cached device so the user can still
    // switch back to BT from the menu.
    if (!byType[@"BLUETOOTH_SCO"] && _lastKnownBtDevice) {
        byType[@"BLUETOOTH_SCO"] = _lastKnownBtDevice;
        NSLog(@"[SYLK_APP] [Audio] using cached BT device: %@", _lastKnownBtDevice);
    }

    // Step 2: pick up anything active in currentRoute that we haven't seen yet
    for (AVAudioSessionPortDescription *p in session.currentRoute.outputs) {
        NSString *type = [self typeStringForPortType:p.portType];
        if ([type isEqualToString:@"BUILTIN_EARPIECE"] ||
            [type isEqualToString:@"BUILTIN_SPEAKER"] ||
            [type isEqualToString:@"WIRED_HEADSET"] ||
            [type isEqualToString:@"BLUETOOTH_SCO"]) {
            if (!byType[type]) {
                byType[type] = [self deviceDictForPort:p typeForIOS:NO];
            }
        }
    }

    // Step 3: always guarantee speaker exists.
    // Earpiece is only shown when NO headset (BT or wired) is connected.
    // With a headset connected, iOS routes to it by hardware/OS design and the
    // earpiece option is non-functional, so hiding it avoids user confusion.
    if (!byType[@"BUILTIN_SPEAKER"]) {
        byType[@"BUILTIN_SPEAKER"] = @{@"id": @"builtin_speaker", @"name": @"Speaker", @"type": @"BUILTIN_SPEAKER"};
    }
    BOOL headsetConnected = (byType[@"WIRED_HEADSET"] != nil || byType[@"BLUETOOTH_SCO"] != nil);
    if (!headsetConnected && !byType[@"BUILTIN_EARPIECE"]) {
        byType[@"BUILTIN_EARPIECE"] = @{@"id": @"builtin_earpiece", @"name": @"Earpiece", @"type": @"BUILTIN_EARPIECE"};
    }
    if (headsetConnected) {
        [byType removeObjectForKey:@"BUILTIN_EARPIECE"];
    }

    // Return in a consistent order: wired > BT > earpiece > speaker
    // (wired headset first since it has hardware priority when connected)
    NSArray *order = @[@"WIRED_HEADSET", @"BLUETOOTH_SCO", @"BUILTIN_EARPIECE", @"BUILTIN_SPEAKER"];
    NSMutableArray *arr = [NSMutableArray array];
    for (NSString *type in order) {
        if (byType[type]) [arr addObject:byType[type]];
    }

    //NSLog(@"[SYLK_APP] [Audio] outputs=%@", arr);
    return arr;
}


- (NSDictionary *)getCurrentRouteInfoDictionary {
    AVAudioSession *session = [AVAudioSession sharedInstance];
    AVAudioSessionRouteDescription *route = session.currentRoute;

    NSMutableArray *inputs = [[self getAudioInputsArray] mutableCopy];
    NSMutableArray *outputs = [[self getAudioOutputsArray] mutableCopy];

    NSDictionary *selected = nil;

    if (route.outputs.count > 0) {
        NSLog(@"[SYLK_APP] [Audio] currentRoute: outputs exist, picking first output");
        AVAudioSessionPortDescription *firstOutput = route.outputs.firstObject;
        selected = [self deviceDictForPort:firstOutput typeForIOS:NO];
        NSLog(@"[SYLK_APP] [Audio] initial selected device from output: %@", selected);

        // Try to find same device in inputs by UID
        BOOL usedInputType = NO;
        for (NSDictionary *input in inputs) {
            if ([input[@"id"] isEqualToString:selected[@"id"]]) {
                NSMutableDictionary *mutableSelected = [selected mutableCopy];
                mutableSelected[@"type"] = input[@"type"];
                selected = [mutableSelected copy];
                usedInputType = YES;
                //NSLog(@"[SYLK_APP] [Audio] matched selected device in inputs, using input type: %@", selected[@"type"]);
                break;
            }
        }
        if (!usedInputType) {
            //NSLog(@"[SYLK_APP] [Audio] selected device not found in inputs, keeping output type: %@", selected[@"type"]);
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
            //NSLog(@"[SYLK_APP] [Audio] added selected device to inputs: %@", inputOnlyDevice);
        } else {
            //NSLog(@"[SYLK_APP] [Audio] selected device already exists in inputs");
        }

        // Note: we no longer add selected back to outputs here — getAudioOutputsArray
        // already includes all available devices consistently via type-keyed deduplication.

        if (selected[@"type"]) {
            _currentRoute = selected[@"type"];
            NSLog(@"[SYLK_APP] [Audio] _currentRoute updated to: %@", _currentRoute);
        }

        return selected;
    } else {
        NSLog(@"[SYLK_APP] [Audio] no outputs in current route");
    }

    // Fallback: no outputs, return virtual current route if known
    if (_currentRoute) {
        NSDictionary *fallback = @{@"id": @"", @"name": @"", @"type": _currentRoute};
        NSLog(@"[SYLK_APP] [Audio] returning fallback currentRoute: %@", _currentRoute);
        return fallback;
    } else {
        NSLog(@"[SYLK_APP] [Audio] no current route known, returning empty dictionary");
    }

    return @{};
}



#pragma mark - Notification handlers

- (void)handleRouteChange:(NSNotification *)note {
  // Called when AVAudioSession route changes (headset plug/unplug, BT connect/disconnect, speaker toggle)
  AVAudioSessionRouteChangeReason reason = [note.userInfo[AVAudioSessionRouteChangeReasonKey] unsignedIntegerValue];

  // Clear cached BT device if it has been physically disconnected
  if (reason == AVAudioSessionRouteChangeReasonOldDeviceUnavailable) {
      BOOL btStillAvailable = NO;
      for (AVAudioSessionPortDescription *p in [AVAudioSession sharedInstance].availableInputs) {
          if ([p.portType isEqualToString:AVAudioSessionPortBluetoothHFP]) {
              btStillAvailable = YES;
              break;
          }
      }
      if (!btStillAvailable) {
          NSLog(@"[SYLK_APP] [Audio] BT device disconnected, clearing cache");
          _lastKnownBtDevice = nil;
      }
  }

  if (_hasListeners) {
    [self sendReactNativeEvent];
  }
}

- (void)handleInterruption:(NSNotification *)note {
  // handle interruptions (eg. phone call) — emit event so RN side can refresh state
  NSLog(@"[SYLK_APP] [Audio] handleInterruption: %@", note.userInfo);
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
        NSLog(@"[SYLK_APP] [Audio] FORCE selecting start device %@", dev);
        [self switchAudioRouteInternal:dev];
        return;
      }
    }
  }

  NSLog(@"[SYLK_APP] [Audio] No eligible device to force-select");
}

#pragma mark - Sending RN event

- (void)sendReactNativeEvent {
  @try {
    //NSLog(@"[SYLK_APP] [Audio] sendReactNativeEvent (pre-check bridge)");
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
      NSLog(@"[SYLK_APP] [Audio] bridge not ready; skipping emit");
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

    //NSLog(@"[SYLK_APP] [Audio] emitting CommunicationsDevicesChanged payload=%@", payload);

    [self sendEventWithName:@"CommunicationsDevicesChanged" body:payload];
  } @catch (NSException *ex) {
    RCTLogError(@"[SYLK_APP] [Audio] sendReactNativeEvent ERROR: %@", ex);
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
  NSLog(@"[SYLK_APP] [Audio] getEvent called");
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendReactNativeEvent];
  });
}

RCT_EXPORT_METHOD(getAudioInputs:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSLog(@"[SYLK_APP] [Audio] getAudioInputs called");
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      NSArray *arr = [self getAudioInputsArray];
      resolve(arr);
    } @catch (NSException *ex) {
      NSLog(@"[SYLK_APP] [Audio] getAudioInputs EX: %@", ex);
      reject(@"ERROR", ex.reason, nil);
    }
  });
}

RCT_EXPORT_METHOD(getAudioOutputs:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSLog(@"[SYLK_APP] [Audio] getAudioOutputs called");
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      NSArray *arr = [self getAudioOutputsArray];
      resolve(arr);
    } @catch (NSException *ex) {
      NSLog(@"[SYLK_APP] [Audio] getAudioOutputs EX: %@", ex);
      reject(@"ERROR", ex.reason, nil);
    }
  });
}

RCT_EXPORT_METHOD(getCurrentRoute:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSLog(@"[SYLK_APP] [Audio] getCurrentRoute called");
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      NSDictionary *info = [self getCurrentRouteInfoDictionary];
      resolve(info);
    } @catch (NSException *ex) {
      //NSLog(@"[SYLK_APP] [Audio] getCurrentRoute EX: %@", ex);
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
  NSLog(@"[SYLK_APP] [Audio] start called deviceMap=%@", deviceMap);
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_started) {
      NSLog(@"[SYLK_APP] [Audio] start: already started");
      resolve(@(YES));
      return;
    }

    NSError *err = nil;
    AVAudioSession *session = [AVAudioSession sharedInstance];
    // Save original settings to restore later
    self->_origCategory = session.category ?: @"";
    self->_origOptions = session.categoryOptions;
    self->_origMode = session.mode;

    NSLog(@"[SYLK_APP] [Audio] Saved original category=%@ options=%lu mode=%@", self->_origCategory, (unsigned long)self->_origOptions, self->_origMode);

    BOOL activated = [session setActive:YES error:&err];
    if (!activated) {
      NSLog(@"[SYLK_APP] [Audio] Failed to activate session: %@", err);
      // not a hard failure: continue but notify
    } else {
      NSLog(@"[SYLK_APP] [Audio] setActive: YES OK");
    }

    self->_started = YES;

    // If deviceMap provided try to switch route
    if (deviceMap && deviceMap.count > 0) {
      BOOL switched = [self switchAudioRouteInternal:deviceMap];
      if (!switched) {
        NSLog(@"[SYLK_APP] [Audio] start: requested audio device not available: %@", deviceMap[@"type"]);
      } else {
        NSLog(@"[SYLK_APP] [Audio] start: switched to %@", deviceMap[@"type"]);
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
  NSLog(@"[SYLK_APP] [Audio] stop called");
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!self->_started) {
      NSLog(@"[SYLK_APP] [Audio] stop: not started");
      resolve(@(YES));
      return;
    }

    NSError *err = nil;
    AVAudioSession *session = [AVAudioSession sharedInstance];

    // restore original category/options/mode if possible
    if (self->_origCategory && self->_origCategory.length > 0) {
      BOOL ok = [session setCategory:self->_origCategory withOptions:self->_origOptions error:&err];
      if (!ok) {
        NSLog(@"[SYLK_APP] [Audio] Failed to restore category: %@", err);
      } else {
        NSLog(@"[SYLK_APP] [Audio] category restored: %@", self->_origCategory);
      }
    }

    // Fix: restore mode via setter (mode is readonly property)
    if (self->_origMode) {
      NSError *modeErr = nil;
      BOOL modeOk = [session setMode:self->_origMode error:&modeErr];
      if (!modeOk) {
        NSLog(@"[SYLK_APP] [Audio] Failed to restore mode: %@", modeErr);
      } else {
        NSLog(@"[SYLK_APP] [Audio] mode restored: %@", self->_origMode);
      }
    }

    BOOL deact = [session setActive:NO
                          withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                                error:&err];
      
      if (!deact) {
      NSLog(@"[SYLK_APP] [Audio] Failed to deactivate session: %@", err);
    } else {
      NSLog(@"[SYLK_APP] [Audio] session deactivated");
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
    NSLog(@"[SYLK_APP] [Audio] setActiveDevice called: %@", deviceMap);
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!deviceMap || deviceMap.count == 0) {
            NSLog(@"[SYLK_APP] [Audio] setActiveDevice: no device provided");
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
            // On iOS, overrideOutputAudioPort:None alone is not sufficient to route to
            // earpiece when a BT HFP device is connected — iOS keeps routing to BT.
            // The reliable fix is to remove AVAudioSessionCategoryOptionAllowBluetooth
            // from the category options, which tells the system the BT device should no
            // longer be used for this session. This must be done before clearing the
            // preferred input and overriding the output port.
            // Remove AllowBluetooth so BT cannot override earpiece. Do NOT add
            // DefaultToSpeaker — that routes to speaker instead of earpiece.
            BOOL categoryOk = [session setCategory:AVAudioSessionCategoryPlayAndRecord
                                       withOptions:0
                                             error:&err];
            if (!categoryOk) {
                NSLog(@"[SYLK_APP] [Audio] setCategory (no BT) failed: %@", err);
            } else {
                NSLog(@"[SYLK_APP] [Audio] setCategory: removed AllowBluetooth for earpiece routing");
            }

            // Switch from VoiceChat to Default mode. In VoiceChat mode, iOS
            // automatically routes to any connected external device (wired USB headset,
            // etc.). Default mode lets the explicit preferred-input + port-override-None
            // combination actually land on the built-in receiver (earpiece).
            NSError *modeErr = nil;
            if (![session setMode:AVAudioSessionModeDefault error:&modeErr]) {
                NSLog(@"[SYLK_APP] [Audio] setMode Default failed: %@", modeErr);
            } else {
                NSLog(@"[SYLK_APP] [Audio] setMode: Default (for earpiece)");
            }

            // Explicitly set preferred input to the built-in mic.
            // Passing nil means "no preference" and iOS picks the highest-priority input,
            // which is the wired/BT headset if connected — defeating the earpiece routing.
            // Explicitly choosing the built-in mic tells iOS to use the internal audio
            // path, which routes output to the built-in earpiece.
            AVAudioSessionPortDescription *builtInMic = nil;
            for (AVAudioSessionPortDescription *p in session.availableInputs) {
                if ([p.portType isEqualToString:AVAudioSessionPortBuiltInMic]) {
                    builtInMic = p;
                    break;
                }
            }
            if (builtInMic) {
                if (![session setPreferredInput:builtInMic error:&err]) {
                    NSLog(@"[SYLK_APP] [Audio] setPreferredInput to built-in mic failed: %@", err);
                } else {
                    NSLog(@"[SYLK_APP] [Audio] setPreferredInput to built-in mic OK");
                }
            } else {
                // Fallback: clear preference and hope iOS picks earpiece
                [session setPreferredInput:nil error:&err];
                NSLog(@"[SYLK_APP] [Audio] built-in mic not found, cleared preferred input");
            }

            // Remove speaker override so the default earpiece route takes effect
            if (![session overrideOutputAudioPort:AVAudioSessionPortOverrideNone error:&err]) {
                NSLog(@"[SYLK_APP] [Audio] overrideOutputAudioPort to earpiece failed: %@", err);
            } else {
                NSLog(@"[SYLK_APP] [Audio] forced output to earpiece");
                _currentRoute = @"BUILTIN_EARPIECE";
                switched = YES;
            }

            // react-native-webrtc manages its own RTCAudioSession and restores
            // AllowBluetooth ~200ms after we remove it, causing iOS to route back to BT.
            // Schedule a single deferred re-application to outlast that restoration.
            // This is one-shot: if the user has switched away by then, _currentRoute
            // won't be BUILTIN_EARPIECE and we bail immediately.
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(400 * NSEC_PER_MSEC)),
                           dispatch_get_main_queue(), ^{
                if (![self->_currentRoute isEqualToString:@"BUILTIN_EARPIECE"]) return;
                NSLog(@"[SYLK_APP] [Audio] earpiece deferred re-apply (WebRTC BT restoration guard)");
                AVAudioSession *s = [AVAudioSession sharedInstance];
                NSError *e = nil;
                [s setCategory:AVAudioSessionCategoryPlayAndRecord withOptions:0 error:&e];
                [s setMode:AVAudioSessionModeDefault error:&e];
                for (AVAudioSessionPortDescription *p in s.availableInputs) {
                    if ([p.portType isEqualToString:AVAudioSessionPortBuiltInMic]) {
                        [s setPreferredInput:p error:&e];
                        break;
                    }
                }
                [s overrideOutputAudioPort:AVAudioSessionPortOverrideNone error:&e];
            });
        } else {
            // Use your normal routing logic for other devices
            switched = [self switchAudioRouteInternal:deviceMap];
        }

        if (switched) {
            [self sendReactNativeEvent];
            resolve(@(YES));
        } else {
            NSLog(@"[SYLK_APP] [Audio] setActiveDevice: switch failed for %@", type);
            reject(@"ERROR", @"Requested audio device not available", nil);
        }
    });
}


#pragma mark - Internal routing

- (BOOL)switchAudioRouteInternal:(NSDictionary *)deviceMap {
  NSLog(@"[SYLK_APP] [Audio] switchAudioRouteInternal: %@", deviceMap);
  @try {
    NSString *type = deviceMap[@"type"];
    NSString *uid = deviceMap[@"id"];
    NSString *name = deviceMap[@"name"];

    AVAudioSession *session = [AVAudioSession sharedInstance];

    // Try to match available inputs first (preferred input)
    if (uid && uid.length > 0) {
      NSLog(@"[SYLK_APP] [Audio] trying match by UID: %@", uid);
      for (AVAudioSessionPortDescription *p in session.availableInputs) {
        if ([p.UID isEqualToString:uid]) {
          NSError *err = nil;
          BOOL ok = [session setPreferredInput:p error:&err];
          if (!ok) {
            NSLog(@"[SYLK_APP] [Audio] setPreferredInput failed: %@", err);
          } else {
            // update current route info
            _currentRoute = [self typeStringForPortType:p.portType];
            NSLog(@"[SYLK_APP] [Audio] setPreferredInput OK currentRoute=%@", _currentRoute);
            [self sendReactNativeEvent];
            return ok;
          }
        }
      }
    }

    // Try matching by type string
    if (type && type.length > 0) {
      NSLog(@"[SYLK_APP] [Audio] trying match by type: %@", type);
      // If type requests speaker explicitly
      if ([type isEqualToString:@"BUILTIN_SPEAKER"] || [type isEqualToString:@"SPEAKER_PHONE"]) {
        // Restore AllowBluetooth and VoiceChat mode in case earpiece routing
        // changed them, so BT and voice processing work correctly on speaker.
        NSError *catErr = nil;
        [session setCategory:AVAudioSessionCategoryPlayAndRecord
                 withOptions:(AVAudioSessionCategoryOptionAllowBluetooth |
                              AVAudioSessionCategoryOptionDefaultToSpeaker)
                       error:&catErr];
        { NSError *modeErr = nil; [session setMode:AVAudioSessionModeVoiceChat error:&modeErr]; }

        NSError *err = nil;
        BOOL ok = [session overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker error:&err];
        if (!ok) {
          NSLog(@"[SYLK_APP] [Audio] overrideOutputAudioPort(Speaker) failed: %@", err);
        } else {
          _currentRoute = @"BUILTIN_SPEAKER";
          NSLog(@"[SYLK_APP] [Audio] overrideOutputAudioPort: Speaker OK");
          [self sendReactNativeEvent];
          return ok;
        }
      }

      // Wired headset/headphones: prefer input by port type first
      // We search availableInputs and current route outputs for matching port types
      // When routing away from earpiece to any external device:
      // 1. Restore VoiceChat mode (we switched to Default for earpiece routing)
      // 2. Clear the built-in mic preference so iOS uses the external device's mic
      { NSError *modeErr = nil; [session setMode:AVAudioSessionModeVoiceChat error:&modeErr]; }
      { NSError *clearErr = nil; [session setPreferredInput:nil error:&clearErr]; }

      // Restore AllowBluetooth if we're routing to a BT device — it may have been
      // removed when earpiece was selected to prevent BT from taking over.
      if ([type isEqualToString:@"BLUETOOTH_SCO"] || [type isEqualToString:@"BLUETOOTH_A2DP"]) {
          NSError *catErr = nil;
          BOOL ok = [session setCategory:AVAudioSessionCategoryPlayAndRecord
                             withOptions:(AVAudioSessionCategoryOptionAllowBluetooth)
                                   error:&catErr];
          if (!ok) {
              NSLog(@"[SYLK_APP] [Audio] setCategory (restore AllowBluetooth) failed: %@", catErr);
          } else {
              NSLog(@"[SYLK_APP] [Audio] setCategory: restored AllowBluetooth for BT routing");
          }
      }

      NSString *targetPortType = nil;
      if ([type isEqualToString:@"WIRED_HEADSET"]) targetPortType = AVAudioSessionPortHeadsetMic;
      else if ([type isEqualToString:@"BLUETOOTH_SCO"]) targetPortType = AVAudioSessionPortBluetoothHFP;
      else if ([type isEqualToString:@"BLUETOOTH_A2DP"]) targetPortType = AVAudioSessionPortBluetoothA2DP;
      else if ([type isEqualToString:@"BUILTIN_EARPIECE"]) targetPortType = AVAudioSessionPortBuiltInReceiver;
      else if ([type isEqualToString:@"USB_DEVICE"]) targetPortType = AVAudioSessionPortUSBAudio;
      else if ([type isEqualToString:@"HDMI"]) targetPortType = AVAudioSessionPortHDMI;

      if (targetPortType) {
        NSLog(@"[SYLK_APP] [Audio] targetPortType = %@", targetPortType);
        // Try to set preferred input (if it's an input-capable port)
        for (AVAudioSessionPortDescription *p in session.availableInputs) {
          if ([p.portType isEqualToString:targetPortType]) {
            NSError *err = nil;
            BOOL ok = [session setPreferredInput:p error:&err];
            if (!ok) {
              NSLog(@"[SYLK_APP] [Audio] setPreferredInput failed: %@", err);
            } else {
              _currentRoute = [self typeStringForPortType:p.portType];
              NSLog(@"[SYLK_APP] [Audio] setPreferredInput OK currentRoute=%@", _currentRoute);
              [self sendReactNativeEvent];
              return ok;
            }
          }
        }

        // For outputs that are not settable via preferredInput, check current outputs (best-effort)
        for (AVAudioSessionPortDescription *p in session.currentRoute.outputs) {
          if ([p.portType isEqualToString:targetPortType]) {
            _currentRoute = [self typeStringForPortType:p.portType];
            NSLog(@"[SYLK_APP] [Audio] matched currentRoute output=%@", _currentRoute);
            [self sendReactNativeEvent];
            return YES;
          }
        }
      } // end if targetPortType
    } // end if type

    // If we reached here, we couldn't route exactly: return false
    NSLog(@"[SYLK_APP] [Audio] switchAudioRouteInternal: no match for deviceMap %@", deviceMap);
    return NO;

  } @catch (NSException *ex) {
    NSLog(@"[SYLK_APP] [Audio] switchAudioRouteInternal EX: %@", ex);
    RCTLogError(@"switchAudioRouteInternal EX: %@", ex);
    return NO;
  }
}

@end

