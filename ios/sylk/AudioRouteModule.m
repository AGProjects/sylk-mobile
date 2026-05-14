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
#import "SylkLogger.h"

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
  //[SylkLogger log:@"[audio] supportedEvents"];
  return @[@"CommunicationsDevicesChanged"];
}

+ (BOOL)requiresMainQueueSetup {
  [SylkLogger log:@"[audio] requiresMainQueueSetup"];
  // We access AVAudioSession and register notifications — run on main queue for safety.
  return YES;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        [SylkLogger log:@"[audio] init: configuring AVAudioSession for VoIP"];

        NSError *err = nil;
        AVAudioSession *session = [AVAudioSession sharedInstance];

        // Configure for communication (VOIP)
        BOOL categorySet = [session setCategory:AVAudioSessionCategoryPlayAndRecord
                                    withOptions:(AVAudioSessionCategoryOptionAllowBluetooth)
                                          error:&err];
        if (!categorySet) {
            [SylkLogger log:@"[audio] Failed to set category: %@", err];
        } else {
            [SylkLogger log:@"[audio] setCategory: PlayAndRecord OK"];
        }

        BOOL modeSet = [session setMode:AVAudioSessionModeVoiceChat error:&err];
        if (!modeSet) {
            [SylkLogger log:@"[audio] Failed to set mode: %@", err];
        } else {
            [SylkLogger log:@"[audio] setMode: VoiceChat OK"];
        }

    }
    return self;
}

- (void)startObserving {
  [SylkLogger log:@"[audio] startObserving"];
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
  [SylkLogger log:@"[audio] stopObserving"];
  _hasListeners = NO;
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)dealloc {
  [SylkLogger log:@"[audio] dealloc"];
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

#pragma mark - Helpers

- (NSDictionary *)deviceDictForPort:(AVAudioSessionPortDescription *)port typeForIOS:(BOOL)isInput {
  if (!port) return @{};
  NSString *type = [self typeStringForPortType:port.portType];
  NSString *name = port.portName ?: @"UNKNOWN";
  NSString *uid = port.UID ?: @"";
  //[SylkLogger log:@"[audio] deviceDictForPort name=%@ type=%@ uid=%@", name, type, uid];
  return @{@"id": uid, @"name": name, @"type": type};
}

- (NSString *)typeStringForPortType:(NSString *)portType {
  // Map AVAudioSession port type constants
  //[SylkLogger log:@"[audio] typeStringForPortType: %@", portType];
  if ([portType isEqualToString:AVAudioSessionPortBuiltInReceiver]) return @"BUILTIN_EARPIECE";
  if ([portType isEqualToString:AVAudioSessionPortBuiltInSpeaker]) return @"BUILTIN_SPEAKER";
  if ([portType isEqualToString:AVAudioSessionPortHeadsetMic]) return @"WIRED_HEADSET";
  // Output-only headphones (e.g. USB-C → 3.5mm jack adapter with no inline mic).
  // Without this case the port type comes back as "UNKNOWN (Headphones)" and the
  // device never makes it into the outputs list, so the user sees a generic
  // 'phone' fallback icon and the OS's actual route never matches the UI.
  if ([portType isEqualToString:AVAudioSessionPortHeadphones]) return @"WIRED_HEADSET";
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
  //[SylkLogger log:@"[audio] getAudioInputsArray"];
  NSMutableArray *arr = [NSMutableArray array];
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSArray<AVAudioSessionPortDescription *> *inputs = session.availableInputs;
  for (AVAudioSessionPortDescription *p in inputs) {
    [arr addObject:[self deviceDictForPort:p typeForIOS:YES]];
  }
  //[SylkLogger log:@"[audio] inputs=%@", arr];
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
        // [audio] cached BT device trace — disabled. Fires on every getter
    // call, no actionable info.
    //[SylkLogger log:@"[audio] using cached BT device: %@", _lastKnownBtDevice];
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

    //[SylkLogger log:@"[audio] outputs=%@", arr];
    return arr;
}


- (NSDictionary *)getCurrentRouteInfoDictionary {
    AVAudioSession *session = [AVAudioSession sharedInstance];
    AVAudioSessionRouteDescription *route = session.currentRoute;

    NSMutableArray *inputs = [[self getAudioInputsArray] mutableCopy];
    NSMutableArray *outputs = [[self getAudioOutputsArray] mutableCopy];

    NSDictionary *selected = nil;

    // If the user just selected WIRED_HEADSET via switchAudioRouteInternal but
    // iOS hasn't completed the route reconfiguration yet (currentRoute still
    // shows BuiltInSpeaker right after the override was cleared, or briefly
    // BuiltInReceiver while the system rebalances), emit the intended device
    // instead of the stale snapshot. Without this, the UI flashes back to
    // BUILTIN_SPEAKER or BUILTIN_EARPIECE for a fraction of a second after
    // every speaker→headset switch. The route-change observer will fire a
    // second event once iOS finishes settling, which keeps things consistent.
    //
    // Guarded by an availability check on the headphones port: if no
    // Headphones/HeadsetMic port exists anywhere in the session, the user
    // has unplugged the device — clear the override and fall through to the
    // normal logic so we don't keep reporting WIRED_HEADSET after unplug.
    if (_currentRoute && [_currentRoute isEqualToString:@"WIRED_HEADSET"]) {
        AVAudioSessionPortDescription *wiredPort = nil;
        for (AVAudioSessionPortDescription *p in route.outputs) {
            if ([p.portType isEqualToString:AVAudioSessionPortHeadphones] ||
                [p.portType isEqualToString:AVAudioSessionPortHeadsetMic]) {
                wiredPort = p;
                break;
            }
        }
        if (!wiredPort) {
            for (AVAudioSessionPortDescription *p in session.availableInputs) {
                if ([p.portType isEqualToString:AVAudioSessionPortHeadsetMic]) {
                    wiredPort = p;
                    break;
                }
            }
        }
        if (wiredPort) {
            // [audio] route-info trace — disabled.
    //[SylkLogger log:@"[audio] _currentRoute=WIRED_HEADSET, using matched port"];
            return [self deviceDictForPort:wiredPort typeForIOS:NO];
        }
        // No port to source from yet — likely iOS is still settling after a
        // speaker→headset switch. Emit a synthetic WIRED_HEADSET so the UI
        // doesn't flash back to the previous device. The handleRouteChange
        // observer will clear _currentRoute once iOS confirms the headphones
        // are actually gone (OldDeviceUnavailable), and any subsequent event
        // will land on the real route.
        // [audio] route-info trace — disabled.
        //[SylkLogger log:@"[audio] _currentRoute=WIRED_HEADSET, port not yet visible — emitting synthetic"];
        return @{@"id": @"", @"name": @"Wired headset", @"type": @"WIRED_HEADSET"};
    }

    if (route.outputs.count > 0) {
        // [audio] route-info trace — disabled.
    //[SylkLogger log:@"[audio] currentRoute: outputs exist, picking first output"];
        AVAudioSessionPortDescription *firstOutput = route.outputs.firstObject;
        selected = [self deviceDictForPort:firstOutput typeForIOS:NO];
        // [audio] route-info trace — disabled.
    //[SylkLogger log:@"[audio] initial selected device from output: %@", selected];

        // Try to find same device in inputs by UID
        BOOL usedInputType = NO;
        for (NSDictionary *input in inputs) {
            if ([input[@"id"] isEqualToString:selected[@"id"]]) {
                NSMutableDictionary *mutableSelected = [selected mutableCopy];
                mutableSelected[@"type"] = input[@"type"];
                selected = [mutableSelected copy];
                usedInputType = YES;
                //[SylkLogger log:@"[audio] matched selected device in inputs, using input type: %@", selected[@"type"]];
                break;
            }
        }
        if (!usedInputType) {
            //[SylkLogger log:@"[audio] selected device not found in inputs, keeping output type: %@", selected[@"type"]];
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
            //[SylkLogger log:@"[audio] added selected device to inputs: %@", inputOnlyDevice];
        } else {
            //[SylkLogger log:@"[audio] selected device already exists in inputs"];
        }

        // Note: we no longer add selected back to outputs here — getAudioOutputsArray
        // already includes all available devices consistently via type-keyed deduplication.

        if (selected[@"type"]) {
            _currentRoute = selected[@"type"];
            // [audio] route-info trace — disabled.
    //[SylkLogger log:@"[audio] _currentRoute updated to: %@", _currentRoute];
        }

        return selected;
    } else {
        // [audio] route-info trace — disabled.
    //[SylkLogger log:@"[audio] no outputs in current route"];
    }

    // Fallback: no outputs, return virtual current route if known
    if (_currentRoute) {
        NSDictionary *fallback = @{@"id": @"", @"name": @"", @"type": _currentRoute};
        // [audio] route-info trace — disabled.
    //[SylkLogger log:@"[audio] returning fallback currentRoute: %@", _currentRoute];
        return fallback;
    } else {
        // [audio] route-info trace — disabled.
    //[SylkLogger log:@"[audio] no current route known, returning empty dictionary"];
    }

    return @{};
}



#pragma mark - Notification handlers

- (void)handleRouteChange:(NSNotification *)note {
  // Called when AVAudioSession route changes (headset plug/unplug, BT connect/disconnect, speaker toggle)
  AVAudioSessionRouteChangeReason reason = [note.userInfo[AVAudioSessionRouteChangeReasonKey] unsignedIntegerValue];

  // Speaker drift defense. RNCallKeep's configureAudioSession runs on
  // CallKit's provider:didActivateAudioSession: and resets the audio
  // category to PlayAndRecord+AllowBluetooth+AllowBluetoothA2DP / mode=Default,
  // which causes iOS to re-evaluate the route and revert our Speaker
  // override to whatever connected device has highest priority (USB headset,
  // BT HFP, etc.). Symptom: "select Speaker → audio briefly on speaker →
  // iOS routes back to headset on its own ~300 ms later".
  //
  // If the user's intended route is BUILTIN_SPEAKER (we set _currentRoute
  // when handling the speaker request) and iOS just rerouted away from the
  // built-in speaker, re-pin the speaker. Reasons we re-apply on:
  //   - CategoryChange       (RNCallKeep.configureAudioSession ran)
  //   - Override             (some other code cleared our override)
  //   - RouteConfigurationChange / NewDeviceAvailable
  if ([_currentRoute isEqualToString:@"BUILTIN_SPEAKER"]) {
    AVAudioSession *s = [AVAudioSession sharedInstance];
    BOOL onSpeaker = NO;
    for (AVAudioSessionPortDescription *p in s.currentRoute.outputs) {
      if ([p.portType isEqualToString:AVAudioSessionPortBuiltInSpeaker]) {
        onSpeaker = YES;
        break;
      }
    }
    if (!onSpeaker) {
      [SylkLogger log:@"[audio] speaker drift detected (reason=%lu) — re-pinning speaker",
            (unsigned long)reason];
      NSError *e = nil;
      [s setCategory:AVAudioSessionCategoryPlayAndRecord
         withOptions:AVAudioSessionCategoryOptionDefaultToSpeaker
               error:&e];
      [s setMode:AVAudioSessionModeVoiceChat error:&e];
      for (AVAudioSessionPortDescription *p in s.availableInputs) {
        if ([p.portType isEqualToString:AVAudioSessionPortBuiltInMic]) {
          [s setPreferredInput:p error:&e];
          break;
        }
      }
      [s overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker error:&e];
      // Don't return — fall through and emit the event so JS sees the
      // (re-corrected) state.
    }
  }

  // Auto-switch to a freshly-plugged headset. iOS auto-routes by default,
  // but our Speaker pin (drops AllowBluetooth, preferredInput=BuiltInMic,
  // overrideOutputAudioPort=Speaker) blocks that auto-route — so plugging
  // in a headset during a speaker call would otherwise stay on speaker. The
  // standard expectation is "plug a headset → audio moves to the headset",
  // so on NewDeviceAvailable, if a wired/USB/BT headset just appeared, we
  // route to it explicitly. This also takes care of the non-speaker-pin
  // cases — a single switchAudioRouteInternal call cleans up state and
  // emits the event so JS UI updates.
  if (reason == AVAudioSessionRouteChangeReasonNewDeviceAvailable) {
      AVAudioSession *s = [AVAudioSession sharedInstance];
      // Look for a freshly available headset, in priority order:
      //   1. BT HFP (preferred when both BT and wired are present — that's
      //      the iOS default too)
      //   2. Wired headset with mic (HeadsetMic)
      //   3. Output-only headphones (Headphones, USB-C dongles, etc.)
      AVAudioSessionPortDescription *targetInput = nil;
      NSString *targetType = nil;
      for (AVAudioSessionPortDescription *p in s.availableInputs) {
          if ([p.portType isEqualToString:AVAudioSessionPortBluetoothHFP]) {
              targetInput = p;
              targetType = @"BLUETOOTH_SCO";
              break;
          }
      }
      if (!targetInput) {
          for (AVAudioSessionPortDescription *p in s.availableInputs) {
              if ([p.portType isEqualToString:AVAudioSessionPortHeadsetMic]) {
                  targetInput = p;
                  targetType = @"WIRED_HEADSET";
                  break;
              }
          }
      }
      if (!targetType) {
          // Output-only headphones — no input port to set, but the route
          // change notification will already have moved the output. Just
          // record the intent so the JS UI updates.
          for (AVAudioSessionPortDescription *p in s.currentRoute.outputs) {
              if ([p.portType isEqualToString:AVAudioSessionPortHeadphones]) {
                  targetType = @"WIRED_HEADSET";
                  break;
              }
          }
      }
      if (targetType) {
          [SylkLogger log:@"[audio] NewDeviceAvailable: auto-routing to %@", targetType];
          NSDictionary *deviceMap = @{
              @"id": (targetInput && targetInput.UID) ? targetInput.UID : @"",
              @"name": (targetInput && targetInput.portName) ? targetInput.portName : @"",
              @"type": targetType,
          };
          // switchAudioRouteInternal handles category/mode/preferred-input
          // cleanup and emits the event; for BT it restores AllowBluetooth,
          // for wired it clears the speaker override and the BuiltInMic pin.
          [self switchAudioRouteInternal:deviceMap];
          // Done — handler returns after the standard listener emit at
          // function tail.
      }
  }

  // Clear cached BT device if it has been physically disconnected
  if (reason == AVAudioSessionRouteChangeReasonOldDeviceUnavailable) {
      BOOL btStillAvailable = NO;
      BOOL wiredStillAvailable = NO;
      AVAudioSession *s = [AVAudioSession sharedInstance];
      for (AVAudioSessionPortDescription *p in s.availableInputs) {
          if ([p.portType isEqualToString:AVAudioSessionPortBluetoothHFP]) {
              btStillAvailable = YES;
          }
          if ([p.portType isEqualToString:AVAudioSessionPortHeadsetMic]) {
              wiredStillAvailable = YES;
          }
      }
      // Also check current outputs for output-only headphones (USB-C dongle):
      // those never appear in availableInputs, only in currentRoute.outputs
      // while plugged in.
      if (!wiredStillAvailable) {
          for (AVAudioSessionPortDescription *p in s.currentRoute.outputs) {
              if ([p.portType isEqualToString:AVAudioSessionPortHeadphones] ||
                  [p.portType isEqualToString:AVAudioSessionPortHeadsetMic]) {
                  wiredStillAvailable = YES;
                  break;
              }
          }
      }
      if (!btStillAvailable) {
          [SylkLogger log:@"[audio] BT device disconnected, clearing cache"];
          _lastKnownBtDevice = nil;
      }
      // If the wired headset just got unplugged and we still had it cached as
      // the current route (set by switchAudioRouteInternal), clear that hint
      // so getCurrentRouteInfoDictionary stops emitting synthetic WIRED_HEADSET
      // events and falls through to whatever iOS rerouted to (earpiece/speaker).
      if (!wiredStillAvailable && [_currentRoute isEqualToString:@"WIRED_HEADSET"]) {
          [SylkLogger log:@"[audio] wired headset unplugged, clearing _currentRoute hint"];
          _currentRoute = nil;
      }
  }

  if (_hasListeners) {
    [self sendReactNativeEvent];
  }
}

- (void)handleInterruption:(NSNotification *)note {
  // handle interruptions (eg. phone call) — emit event so RN side can refresh state
  [SylkLogger log:@"[audio] handleInterruption: %@", note.userInfo];
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
        [SylkLogger log:@"[audio] FORCE selecting start device %@", dev];
        [self switchAudioRouteInternal:dev];
        return;
      }
    }
  }

  [SylkLogger log:@"[audio] No eligible device to force-select"];
}

#pragma mark - Sending RN event

- (void)sendReactNativeEvent {
  @try {
    //[SylkLogger log:@"[audio] sendReactNativeEvent (pre-check bridge)"];
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
      // [audio] bridge-not-ready trace — disabled. Fires repeatedly
    // during boot until the bridge spins up; no actionable info.
    //[SylkLogger log:@"[audio] bridge not ready; skipping emit"];
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

    //[SylkLogger log:@"[audio] emitting CommunicationsDevicesChanged payload=%@", payload];

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
  // [audio] getter entry trace — disabled.
  //[SylkLogger log:@"[audio] getEvent called"];
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendReactNativeEvent];
  });
}

RCT_EXPORT_METHOD(getAudioInputs:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  // [audio] getter entry trace — disabled.
  //[SylkLogger log:@"[audio] getAudioInputs called"];
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      NSArray *arr = [self getAudioInputsArray];
      resolve(arr);
    } @catch (NSException *ex) {
      [SylkLogger log:@"[audio] getAudioInputs EX: %@", ex];
      reject(@"ERROR", ex.reason, nil);
    }
  });
}

RCT_EXPORT_METHOD(getAudioOutputs:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  // [audio] getter entry trace — disabled.
  //[SylkLogger log:@"[audio] getAudioOutputs called"];
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      NSArray *arr = [self getAudioOutputsArray];
      resolve(arr);
    } @catch (NSException *ex) {
      [SylkLogger log:@"[audio] getAudioOutputs EX: %@", ex];
      reject(@"ERROR", ex.reason, nil);
    }
  });
}

RCT_EXPORT_METHOD(getCurrentRoute:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  // [audio] getter entry trace — disabled.
  //[SylkLogger log:@"[audio] getCurrentRoute called"];
  dispatch_async(dispatch_get_main_queue(), ^{
    @try {
      NSDictionary *info = [self getCurrentRouteInfoDictionary];
      resolve(info);
    } @catch (NSException *ex) {
      //[SylkLogger log:@"[audio] getCurrentRoute EX: %@", ex];
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
  [SylkLogger log:@"[audio] start called deviceMap=%@", deviceMap];
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_started) {
      [SylkLogger log:@"[audio] start: already started"];
      resolve(@(YES));
      return;
    }

    NSError *err = nil;
    AVAudioSession *session = [AVAudioSession sharedInstance];
    // Save original settings to restore later
    self->_origCategory = session.category ?: @"";
    self->_origOptions = session.categoryOptions;
    self->_origMode = session.mode;

    [SylkLogger log:@"[audio] Saved original category=%@ options=%lu mode=%@", self->_origCategory, (unsigned long)self->_origOptions, self->_origMode];

    BOOL activated = [session setActive:YES error:&err];
    if (!activated) {
      [SylkLogger log:@"[audio] Failed to activate session: %@", err];
      // not a hard failure: continue but notify
    } else {
      [SylkLogger log:@"[audio] setActive: YES OK"];
    }

    self->_started = YES;

    // If deviceMap provided try to switch route
    if (deviceMap && deviceMap.count > 0) {
      BOOL switched = [self switchAudioRouteInternal:deviceMap];
      if (!switched) {
        [SylkLogger log:@"[audio] start: requested audio device not available: %@", deviceMap[@"type"]];
      } else {
        [SylkLogger log:@"[audio] start: switched to %@", deviceMap[@"type"]];
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
  [SylkLogger log:@"[audio] stop called"];
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!self->_started) {
      [SylkLogger log:@"[audio] stop: not started"];
      resolve(@(YES));
      return;
    }

    NSError *err = nil;
    AVAudioSession *session = [AVAudioSession sharedInstance];

    // restore original category/options/mode if possible
    if (self->_origCategory && self->_origCategory.length > 0) {
      BOOL ok = [session setCategory:self->_origCategory withOptions:self->_origOptions error:&err];
      if (!ok) {
        [SylkLogger log:@"[audio] Failed to restore category: %@", err];
      } else {
        [SylkLogger log:@"[audio] category restored: %@", self->_origCategory];
      }
    }

    // Fix: restore mode via setter (mode is readonly property)
    if (self->_origMode) {
      NSError *modeErr = nil;
      BOOL modeOk = [session setMode:self->_origMode error:&modeErr];
      if (!modeOk) {
        [SylkLogger log:@"[audio] Failed to restore mode: %@", modeErr];
      } else {
        [SylkLogger log:@"[audio] mode restored: %@", self->_origMode];
      }
    }

    BOOL deact = [session setActive:NO
                          withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation
                                error:&err];
      
      if (!deact) {
      [SylkLogger log:@"[audio] Failed to deactivate session: %@", err];
    } else {
      [SylkLogger log:@"[audio] session deactivated"];
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
    [SylkLogger log:@"[audio] setActiveDevice called: %@", deviceMap];
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!deviceMap || deviceMap.count == 0) {
            [SylkLogger log:@"[audio] setActiveDevice: no device provided"];
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
                [SylkLogger log:@"[audio] setCategory (no BT) failed: %@", err];
            } else {
                [SylkLogger log:@"[audio] setCategory: removed AllowBluetooth for earpiece routing"];
            }

            // Switch from VoiceChat to Default mode. In VoiceChat mode, iOS
            // automatically routes to any connected external device (wired USB headset,
            // etc.). Default mode lets the explicit preferred-input + port-override-None
            // combination actually land on the built-in receiver (earpiece).
            NSError *modeErr = nil;
            if (![session setMode:AVAudioSessionModeDefault error:&modeErr]) {
                [SylkLogger log:@"[audio] setMode Default failed: %@", modeErr];
            } else {
                [SylkLogger log:@"[audio] setMode: Default (for earpiece)"];
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
                    [SylkLogger log:@"[audio] setPreferredInput to built-in mic failed: %@", err];
                } else {
                    [SylkLogger log:@"[audio] setPreferredInput to built-in mic OK"];
                }
            } else {
                // Fallback: clear preference and hope iOS picks earpiece
                [session setPreferredInput:nil error:&err];
                [SylkLogger log:@"[audio] built-in mic not found, cleared preferred input"];
            }

            // Remove speaker override so the default earpiece route takes effect
            if (![session overrideOutputAudioPort:AVAudioSessionPortOverrideNone error:&err]) {
                [SylkLogger log:@"[audio] overrideOutputAudioPort to earpiece failed: %@", err];
            } else {
                [SylkLogger log:@"[audio] forced output to earpiece"];
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
                [SylkLogger log:@"[audio] earpiece deferred re-apply (WebRTC BT restoration guard)"];
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
            [SylkLogger log:@"[audio] setActiveDevice: switch failed for %@", type];
            reject(@"ERROR", @"Requested audio device not available", nil);
        }
    });
}


#pragma mark - Internal routing

- (BOOL)switchAudioRouteInternal:(NSDictionary *)deviceMap {
  // [audio] switchAudioRouteInternal entry trace — disabled.
  //[SylkLogger log:@"[audio] switchAudioRouteInternal: %@", deviceMap];
  @try {
    NSString *type = deviceMap[@"type"];
    NSString *uid = deviceMap[@"id"];
    NSString *name = deviceMap[@"name"];

    AVAudioSession *session = [AVAudioSession sharedInstance];

    // Try to match available inputs first (preferred input)
    if (uid && uid.length > 0) {
      [SylkLogger log:@"[audio] trying match by UID: %@", uid];
      for (AVAudioSessionPortDescription *p in session.availableInputs) {
        if ([p.UID isEqualToString:uid]) {
          NSError *err = nil;
          BOOL ok = [session setPreferredInput:p error:&err];
          if (!ok) {
            [SylkLogger log:@"[audio] setPreferredInput failed: %@", err];
          } else {
            // update current route info
            _currentRoute = [self typeStringForPortType:p.portType];
            // [audio] setPreferredInput success trace — disabled.
    //[SylkLogger log:@"[audio] setPreferredInput OK currentRoute=%@", _currentRoute];
            [self sendReactNativeEvent];
            return ok;
          }
        }
      }
    }

    // Try matching by type string
    if (type && type.length > 0) {
      [SylkLogger log:@"[audio] trying match by type: %@", type];
      // If type requests speaker explicitly
      if ([type isEqualToString:@"BUILTIN_SPEAKER"] || [type isEqualToString:@"SPEAKER_PHONE"]) {
        // Speaker pinning. iOS doesn't actually obey
        // overrideOutputAudioPort:Speaker reliably when AllowBluetooth is set
        // and an external input device (USB headset, BT HFP) is connected —
        // it briefly honours the override, then within a few hundred ms
        // re-evaluates the route, sees the external input takes priority,
        // and silently routes back to that device. Symptom in the logs:
        // selected=BUILTIN_SPEAKER → selected=WIRED_HEADSET on the next
        // RouteChange notification.
        //
        // The fix is the same trick used for earpiece pinning further down:
        // strip AllowBluetooth from the category and force the preferred
        // input to the built-in mic, which keeps iOS on the internal audio
        // path. Then overrideOutputAudioPort:Speaker actually sticks.
        // VoiceChat mode is preserved (echo-cancellation etc.).
        NSError *catErr = nil;
        BOOL catOk = [session setCategory:AVAudioSessionCategoryPlayAndRecord
                              withOptions:AVAudioSessionCategoryOptionDefaultToSpeaker
                                    error:&catErr];
        if (!catOk) {
          [SylkLogger log:@"[audio] setCategory(speaker, no AllowBluetooth) failed: %@", catErr];
        }
        { NSError *modeErr = nil; [session setMode:AVAudioSessionModeVoiceChat error:&modeErr]; }

        // Pin the input to the built-in mic so iOS uses the internal audio
        // path (no headset / USB-mic preference fighting the speaker override).
        AVAudioSessionPortDescription *builtInMic = nil;
        for (AVAudioSessionPortDescription *p in session.availableInputs) {
          if ([p.portType isEqualToString:AVAudioSessionPortBuiltInMic]) {
            builtInMic = p;
            break;
          }
        }
        if (builtInMic) {
          NSError *prefErr = nil;
          if (![session setPreferredInput:builtInMic error:&prefErr]) {
            [SylkLogger log:@"[audio] setPreferredInput(BuiltInMic for speaker) failed: %@", prefErr];
          } else {
            [SylkLogger log:@"[audio] setPreferredInput: BuiltInMic (speaker pin)"];
          }
        }

        NSError *err = nil;
        BOOL ok = [session overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker error:&err];
        if (!ok) {
          [SylkLogger log:@"[audio] overrideOutputAudioPort(Speaker) failed: %@", err];
        } else {
          _currentRoute = @"BUILTIN_SPEAKER";
          [SylkLogger log:@"[audio] overrideOutputAudioPort: Speaker OK (AllowBluetooth dropped, built-in mic pinned)"];
          [self sendReactNativeEvent];

          // react-native-webrtc / CallKit can re-activate the audio session
          // ~200–400 ms after we set this up (peer connection negotiating,
          // CallKit's didActivateAudioSession), and that re-activation can
          // restore AllowBluetooth and clear the preferred-input pin. Schedule
          // a single deferred re-application to outlast that — same idea as
          // the earpiece deferred re-apply below, just for speaker. One-shot:
          // bails if _currentRoute has moved off BUILTIN_SPEAKER by then
          // (user picked something else in the meantime).
          dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(500 * NSEC_PER_MSEC)),
                         dispatch_get_main_queue(), ^{
            if (![self->_currentRoute isEqualToString:@"BUILTIN_SPEAKER"]) return;
            [SylkLogger log:@"[audio] speaker deferred re-apply (CallKit/WebRTC restoration guard)"];
            AVAudioSession *s = [AVAudioSession sharedInstance];
            NSError *e = nil;
            [s setCategory:AVAudioSessionCategoryPlayAndRecord
               withOptions:AVAudioSessionCategoryOptionDefaultToSpeaker
                     error:&e];
            [s setMode:AVAudioSessionModeVoiceChat error:&e];
            for (AVAudioSessionPortDescription *p in s.availableInputs) {
              if ([p.portType isEqualToString:AVAudioSessionPortBuiltInMic]) {
                [s setPreferredInput:p error:&e];
                break;
              }
            }
            [s overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker error:&e];
          });

          return ok;
        }
      }

      // Wired headset/headphones: prefer input by port type first
      // We search availableInputs and current route outputs for matching port types
      // When routing away from earpiece OR speaker to any external device:
      // 1. Restore VoiceChat mode (we switched to Default for earpiece routing)
      // 2. Clear the built-in mic preference so iOS uses the external device's mic
      // 3. Clear any speaker override (overrideOutputAudioPort:Speaker is sticky —
      //    until we explicitly remove it, audio stays on the built-in speaker even
      //    when we set a preferred input or the user has headphones plugged in).
      { NSError *modeErr = nil; [session setMode:AVAudioSessionModeVoiceChat error:&modeErr]; }
      { NSError *clearErr = nil; [session setPreferredInput:nil error:&clearErr]; }
      { NSError *ovErr = nil;    [session overrideOutputAudioPort:AVAudioSessionPortOverrideNone error:&ovErr]; }

      // Restore AllowBluetooth if we're routing to a BT device — it may have been
      // removed when earpiece was selected to prevent BT from taking over.
      if ([type isEqualToString:@"BLUETOOTH_SCO"] || [type isEqualToString:@"BLUETOOTH_A2DP"]) {
          NSError *catErr = nil;
          BOOL ok = [session setCategory:AVAudioSessionCategoryPlayAndRecord
                             withOptions:(AVAudioSessionCategoryOptionAllowBluetooth)
                                   error:&catErr];
          if (!ok) {
              [SylkLogger log:@"[audio] setCategory (restore AllowBluetooth) failed: %@", catErr];
          } else {
              [SylkLogger log:@"[audio] setCategory: restored AllowBluetooth for BT routing"];
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
        [SylkLogger log:@"[audio] targetPortType = %@", targetPortType];
        // Try to set preferred input (if it's an input-capable port)
        for (AVAudioSessionPortDescription *p in session.availableInputs) {
          if ([p.portType isEqualToString:targetPortType]) {
            NSError *err = nil;
            BOOL ok = [session setPreferredInput:p error:&err];
            if (!ok) {
              [SylkLogger log:@"[audio] setPreferredInput failed: %@", err];
            } else {
              _currentRoute = [self typeStringForPortType:p.portType];
              // [audio] setPreferredInput success trace — disabled.
    //[SylkLogger log:@"[audio] setPreferredInput OK currentRoute=%@", _currentRoute];
              [self sendReactNativeEvent];
              return ok;
            }
          }
        }

        // For outputs that are not settable via preferredInput, check current outputs (best-effort)
        for (AVAudioSessionPortDescription *p in session.currentRoute.outputs) {
          if ([p.portType isEqualToString:targetPortType]) {
            _currentRoute = [self typeStringForPortType:p.portType];
            // [audio] matched-output trace — disabled.
    //[SylkLogger log:@"[audio] matched currentRoute output=%@", _currentRoute];
            [self sendReactNativeEvent];
            return YES;
          }
        }

        // Wired-headset fallback: output-only headphones (USB-C → 3.5mm jack
        // adapter, lightning headphones, etc.) report port type `Headphones`,
        // not `HeadsetMic`, and never appear in availableInputs. iOS auto-
        // routes audio to them whenever they're plugged in, so when the user
        // taps the WIRED_HEADSET button the route is already correct — we just
        // need to acknowledge the match so the UI can update.
        //
        // We accept the switch if Headphones are present in *any* of:
        //   - currentRoute.outputs (will be true once iOS finishes rerouting
        //     after the speaker override was cleared above)
        //   - availableInputs (covers wired headsets with an inline mic that
        //     also appear here under HeadsetMic — already handled above — but
        //     guards against future iOS shifts)
        // If iOS hasn't rerouted yet, we still return YES because the override
        // clear above guarantees it will, and the AVAudioSessionRouteChange
        // observer will fire sendReactNativeEvent to sync the UI.
        if ([type isEqualToString:@"WIRED_HEADSET"]) {
          BOOL headphonesPresent = NO;
          for (AVAudioSessionPortDescription *p in session.currentRoute.outputs) {
            if ([p.portType isEqualToString:AVAudioSessionPortHeadphones] ||
                [p.portType isEqualToString:AVAudioSessionPortHeadsetMic]) {
              headphonesPresent = YES;
              break;
            }
          }
          if (!headphonesPresent) {
            for (AVAudioSessionPortDescription *p in session.availableInputs) {
              if ([p.portType isEqualToString:AVAudioSessionPortHeadsetMic]) {
                headphonesPresent = YES;
                break;
              }
            }
          }
          // If we're here we already cleared the speaker override; assume the
          // wired output exists (the JS side only offers WIRED_HEADSET as a
          // selectable option when the device is enumerated as available).
          _currentRoute = @"WIRED_HEADSET";
          [SylkLogger log:@"[audio] WIRED_HEADSET selected (headphonesPresent=%@) — speaker override cleared, trusting iOS to route",
                headphonesPresent ? @"YES" : @"NO"];
          [self sendReactNativeEvent];
          return YES;
        }
      } // end if targetPortType
    } // end if type

    // If we reached here, we couldn't route exactly: return false
    [SylkLogger log:@"[audio] switchAudioRouteInternal: no match for deviceMap %@", deviceMap];
    return NO;

  } @catch (NSException *ex) {
    [SylkLogger log:@"[audio] switchAudioRouteInternal EX: %@", ex];
    RCTLogError(@"switchAudioRouteInternal EX: %@", ex);
    return NO;
  }
}

@end

