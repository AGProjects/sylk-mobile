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

package com.agprojects.sylk;

import android.content.Context;
import android.media.AudioManager;
import android.media.AudioDeviceInfo;
import android.os.Build;
import android.util.Log;
import android.os.Handler;
import android.os.Looper;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;


import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableMapKeySetIterator;

import com.facebook.react.modules.core.DeviceEventManagerModule;

import android.media.AudioFocusRequest;
import android.media.AudioAttributes;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothHeadset;

import java.util.List;
import java.util.Set;
import java.util.HashSet;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

import com.agprojects.sylk.BluetoothScoManager;


public class AudioRouteModule extends ReactContextBaseJavaModule {
        
    private final ReactApplicationContext reactContext;
    private BroadcastReceiver headsetReceiver;
    public static AudioRouteModule instance;
    private BluetoothHeadset bluetoothHeadset = null;
    private int lastScoState = AudioManager.SCO_AUDIO_STATE_DISCONNECTED;
    private AudioManager.OnAudioFocusChangeListener audioFocusListener;
    // Periodic event fields
    private Handler handler = new Handler(Looper.getMainLooper());
    private Runnable periodicRunnable = null;
    private int periodicIntervalMs = 0; // 0 = disabled
    private BluetoothScoManager scoManager;
    private static final String TAG = "SYLK";
    private final AudioManager audioManager;
    private int origAudioMode = AudioManager.MODE_INVALID;
    private boolean started = false;
    private String currentRoute = "BUILTIN_EARPIECE";

    private Object communicationDeviceListener; // holds the listener only on supported API
    private boolean listenerStarted = false;
    // When the user requests BT routing before SCO is established, store the target
    // device here and apply it as soon as SCO audio connects.
    private Map<String, String> pendingBtDevice = null;

    public AudioRouteModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        this.audioManager = (AudioManager) reactContext.getSystemService(Context.AUDIO_SERVICE);
        instance = this;
        registerReceivers();
        Log.d(TAG, "AudioRouteModule init");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            startCommunicationDeviceListener();
        } else {
            Log.d(TAG, "Communication device listener not supported on this Android version");
        }
    }
    
    @Override
    public String getName() {
        return "AudioRouteModule";
    }

    public static void routeToBluetooth() {
        if (instance != null) {
            //
        }
    }

    public static void onHeadsetEvent() {
        if (instance != null) {
            Log.d(TAG, "Static onHeadsetEvent() invoked");
            instance.sendReactNativeEvent();
        }
    }

    private boolean hasBluetoothScoDeviceNew() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false;
    
        List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
        for (AudioDeviceInfo dev : devices) {
            if (dev.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return true;
        }
        return false;
    }

	private void acquireAudioFocus() {
		audioFocusListener = focusChange -> {
			Log.d(TAG, "AudioFocus change: " + focusChange);
		};
	
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			AudioFocusRequest request = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
				.setAudioAttributes(new AudioAttributes.Builder()
					.setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
					.setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
					.build())
				.setAcceptsDelayedFocusGain(false)
				.setOnAudioFocusChangeListener(audioFocusListener)
				.build();
			audioManager.requestAudioFocus(request);
		} else {
			audioManager.requestAudioFocus(audioFocusListener,
				AudioManager.STREAM_VOICE_CALL,
				AudioManager.AUDIOFOCUS_GAIN);
		}
	}

    private void startCommunicationDeviceListener() {
        if (listenerStarted) return;
    
        communicationDeviceListener = new AudioManager.OnCommunicationDeviceChangedListener() {
            @Override
            public void onCommunicationDeviceChanged(AudioDeviceInfo deviceInfo) {
                String deviceName = deviceInfo.getProductName() != null
                        ? deviceInfo.getProductName().toString()
                        : "UNKNOWN";

                String typeName = getDeviceTypeName(deviceInfo.getType());
                int deviceId = deviceInfo.getId();
            
                Log.d(TAG, "Communication device changed to " + deviceId + " " + deviceName + " " + typeName);
            
                sendReactNativeEvent();
            }
        };
    
        audioManager.addOnCommunicationDeviceChangedListener(
                reactContext.getMainExecutor(),
                (AudioManager.OnCommunicationDeviceChangedListener) communicationDeviceListener
        );
    
        listenerStarted = true;
    }
    
    public void stopCommunicationDeviceListener() {
        if (!listenerStarted || communicationDeviceListener == null) return;
    
        audioManager.removeOnCommunicationDeviceChangedListener(
                (AudioManager.OnCommunicationDeviceChangedListener) communicationDeviceListener
        );
    
        listenerStarted = false;
    }

    private void registerReceivers() {
        // Register on all API levels so BT/headset connect events update the device
        // list on old Android (< 31) too. getAudioOutputs() uses getDevices() (API 23+)
        // so all the sendReactNativeEvent() calls inside are safe on old Android.

        //Log.d(TAG, "Registering headset/Bluetooth/SCO receivers…");
        headsetReceiver = new BroadcastReceiver() {
            private int lastHeadsetProfileState = BluetoothProfile.STATE_DISCONNECTED;
            private int lastScoAudioState = AudioManager.SCO_AUDIO_STATE_DISCONNECTED;
            private long lastEventTime = 0;
            private static final long EVENT_COOLDOWN_MS = 100;
    
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (action == null) return;
    
                long now = System.currentTimeMillis();
                if (now - lastEventTime < EVENT_COOLDOWN_MS) {
                    return; // suppress burst spam
                }
                lastEventTime = now;
    
                switch (action) {
                    case BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED: {
                        int profileState = intent.getIntExtra(
                                BluetoothProfile.EXTRA_STATE,
                                BluetoothProfile.STATE_DISCONNECTED
                        );
                    
                        if (profileState == lastHeadsetProfileState) return;
                        lastHeadsetProfileState = profileState;
                    
                        Log.d(TAG, "BT profile state=" + headsetProfileStateToString(profileState));
                                        
                        // Notify JS so the device list updates on all Android versions.
                        // Auto-route to BT only on API 31+ (uses getAvailableCommunicationDevices).
                        if (profileState == BluetoothProfile.STATE_CONNECTED) {
                            Log.d(TAG, "BT headset connected");
                            sendReactNativeEvent(); // update device list on old Android
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                                handler.postDelayed(() -> {
                                    List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
                                    for (AudioDeviceInfo device : devices) {
                                        if (device.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
                                            Map<String, String> btDevice = new HashMap<>();
                                            btDevice.put("id", String.valueOf(device.getId()));
                                            btDevice.put("name", device.getProductName() != null
                                                    ? device.getProductName().toString() : "UNKNOWN");
                                            btDevice.put("type", "BLUETOOTH_SCO");
                                            Log.d(TAG, "Auto routing to BLUETOOTH");
                                            switchAudioRoute(btDevice);
                                            break;
                                        }
                                    }
                                }, 100);
                            }
                        } else {
                            sendReactNativeEvent(); // BT disconnected — update list
                        }
                    
                        break;
                    }
    
                    case AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED: {
                        int scoState = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1);

                        // SUPPRESS CONNECTED → CONNECTING noise
                        if (lastScoState == AudioManager.SCO_AUDIO_STATE_CONNECTED && scoState == AudioManager.SCO_AUDIO_STATE_CONNECTING) {
                            return;
                        }

                        // ignore repeated DISCONNECTED
                        if (scoState == AudioManager.SCO_AUDIO_STATE_DISCONNECTED && lastScoState == AudioManager.SCO_AUDIO_STATE_DISCONNECTED && !audioManager.isBluetoothScoOn()) {
                            return;
                        }

                        if (scoState == lastScoState) return;

                        Log.d(TAG, "BT SCO state=" + scoStateToString(scoState) + " (isBluetoothScoOn=" + audioManager.isBluetoothScoOn() + ")");

                        int prevScoState = lastScoState;
                        lastScoState = scoState; // UPDATE THE MODULE FIELD

                        if (prevScoState == AudioManager.SCO_AUDIO_STATE_CONNECTED && scoState == AudioManager.SCO_AUDIO_STATE_DISCONNECTED) {
                            sendReactNativeEvent();
                        }

                        if (prevScoState != AudioManager.SCO_AUDIO_STATE_CONNECTED && scoState == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
                            sendReactNativeEvent();
                        }

                        break;
                    }

                    case AudioManager.ACTION_AUDIO_BECOMING_NOISY:
                        Log.d(TAG, "ACTION_HEADSET_PLUG event");
                        sendReactNativeEvent();
                        break;
    
                    case Intent.ACTION_HEADSET_PLUG:
                        // Always notify JS so the device list updates on all Android versions.
                        // Auto-route to the wired device only on API 31+ (uses getAvailableCommunicationDevices).
                        sendReactNativeEvent();
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            handler.postDelayed(() -> {
                                List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
                                Log.d(TAG, "HEADSET plugged event");
                                for (AudioDeviceInfo device : devices) {
                                    if (device.getType() == AudioDeviceInfo.TYPE_WIRED_HEADSET) {
                                        Map<String, String> wiredDevice = new HashMap<>();
                                        wiredDevice.put("id", String.valueOf(device.getId()));
                                        wiredDevice.put("name", device.getProductName() != null ? device.getProductName().toString() : "UNKNOWN");
                                        wiredDevice.put("type", "WIRED_HEADSET");
                                        Log.d(TAG, "Auto route to wired headset");
                                        switchAudioRoute(wiredDevice);
                                    } else if (device.getType() == AudioDeviceInfo.TYPE_USB_HEADSET) {
                                        Map<String, String> wiredDevice = new HashMap<>();
                                        wiredDevice.put("id", String.valueOf(device.getId()));
                                        wiredDevice.put("name", device.getProductName() != null ? device.getProductName().toString() : "UNKNOWN");
                                        wiredDevice.put("type", "USB_HEADSET");
                                        Log.d(TAG, "Auto route to USB headset");
                                        switchAudioRoute(wiredDevice);
                                    } else {
                                        String typeName = getDeviceTypeName(device.getType());
                                        Log.d(TAG, "Audio device: " + device.getId() + " Type: " + device.getType() + " " + typeName);
                                    }
                                }
                            }, 50);
                        }
                        break;
                }
            }
        };
    
        IntentFilter noisyFilter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        reactContext.registerReceiver(headsetReceiver, noisyFilter);
    
        // Bluetooth headset / ACL
        IntentFilter btFilter = new IntentFilter();
        btFilter.addAction(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED);
        btFilter.addAction(BluetoothDevice.ACTION_ACL_CONNECTED);
        btFilter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED);
        reactContext.registerReceiver(headsetReceiver, btFilter);
    
        // Wired headset
        IntentFilter wiredFilter = new IntentFilter(Intent.ACTION_HEADSET_PLUG);
        reactContext.registerReceiver(headsetReceiver, wiredFilter);
    
        // SCO audio
        IntentFilter scoFilter = new IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED);
        reactContext.registerReceiver(headsetReceiver, scoFilter);
    
        //Log.d(TAG, "Receivers registered successfully");
    }

    @ReactMethod
    public void getEvent() {
        sendReactNativeEvent();
    }

	@ReactMethod
	public void getAudioMode(Promise promise) {
		try {
			int mode = audioManager.getMode();
			promise.resolve(mode);
		} catch (Exception e) {
			promise.reject("ERROR", e);
		}
	}
	
	@ReactMethod
	public void setAudioMode(int mode, Promise promise) {
		try {
			audioManager.setMode(mode);
			promise.resolve(true);
		} catch (Exception e) {
			promise.reject("ERROR", e);
		}
	}

    @ReactMethod
    public void start(ReadableMap deviceMap, Promise promise) {
        if (started) return;
        started = true;
    
        Log.d(TAG, "AudioRouteModule start");
    
        try {
            // Capture original audio state
            origAudioMode = audioManager.getMode();
            Log.d(TAG, "Original audio mode: " + getAudioModeDescription(origAudioMode));
    
            // Set communication mode
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            Log.d(TAG, "Audio mode switched to: IN_COMMUNICATION");

			acquireAudioFocus();

            sendReactNativeEvent();
    
            // Instantiate SCO manager if not yet created
            if (scoManager == null) {
                scoManager = new BluetoothScoManager(reactContext);

                // Fired when BT headset profile first connects (auto-route on headset plug-in)
                scoManager.setEventListener(() -> {
                    try {
                        List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
                        for (AudioDeviceInfo device : devices) {
                            int deviceType = device.getType();
                            if (deviceType == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
                                Log.d(TAG, "auto route to BLUETOOTH_SCO");
                                Map<String, String> btDevice = new HashMap<>();
                                btDevice.put("id", String.valueOf(device.getId()));
                                btDevice.put("name", device.getProductName() != null
                                        ? device.getProductName().toString() : "UNKNOWN");
                                btDevice.put("type", "BLUETOOTH_SCO");
                                switchAudioRoute(btDevice);
                                break;
                            }
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Error routing to BT device on headset connect", e);
                    }
                });

                // Fired when SCO audio channel is actually established (CONNECTED state).
                // If the user requested BT routing while SCO was still negotiating, apply
                // the pending route now that audio is ready.
                scoManager.setScoConnectedListener(() -> {
                    try {
                        if (pendingBtDevice != null) {
                            Log.d(TAG, "SCO connected — applying pending BT route: " + pendingBtDevice);
                            Map<String, String> device = pendingBtDevice;
                            pendingBtDevice = null;
                            // Re-look up the device by type in case id changed
                            String targetType = device.get("type");
                            List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
                            for (AudioDeviceInfo d : devices) {
                                if (getDeviceTypeName(d.getType()).equals(targetType)) {
                                    boolean result = audioManager.setCommunicationDevice(d);
                                    Log.d(TAG, "Pending BT setCommunicationDevice result=" + result
                                        + " device=" + d.getId() + " " + d.getProductName());
                                    sendReactNativeEvent();
                                    break;
                                }
                            }
                        } else {
                            // No pending manual selection — just notify JS so it can update the UI
                            sendReactNativeEvent();
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Error applying pending BT route on SCO connected", e);
                    }
                });
            }
    
            // Start SCO if a BT SCO device is available
            boolean hasBtSco = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    ? hasBluetoothScoDeviceNew()
                    : audioManager.isBluetoothScoAvailableOffCall();
    
            if (hasBtSco && scoManager != null) {
                scoManager.startScoIfNeeded();
            }
    
            // --- Route switch (if provided) ---
            if (deviceMap != null && !deviceMap.toHashMap().isEmpty()) {
                Map<String, String> device = new HashMap<>();
                ReadableMapKeySetIterator iterator = deviceMap.keySetIterator();
                while (iterator.hasNextKey()) {
                    String key = iterator.nextKey();
                    try {
                        device.put(key, deviceMap.getString(key));
                    } catch (Exception e) {
                        Log.w(TAG, "Skipping non-string value for key: " + key, e);
                    }
                }
                Log.d(TAG, "Starting with device: " + device.toString());
    
                boolean switched = switchAudioRoute(device);
                if (!switched) {
                    Log.w(TAG, "Failed to switch audio route to " + device.get("type"));
                }
            }
    
            promise.resolve(true);
    
        } catch (Exception e) {
            Log.e(TAG, "Error starting audio route", e);
            promise.reject("ERROR", e);
        }
    }

    private String getAudioModeDescription(int mode) {
        switch (mode) {
            case AudioManager.MODE_NORMAL: return "NORMAL";
            case AudioManager.MODE_RINGTONE: return "RINGTONE";
            case AudioManager.MODE_IN_CALL: return "IN_CALL";
            case AudioManager.MODE_IN_COMMUNICATION: return "IN_COMMUNICATION";
            case AudioManager.MODE_CALL_SCREENING: return "CALL_SCREENING";
            default: return "UNKNOWN(" + mode + ")";
        }
    }

    private String getDeviceTypeName(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: return "BUILTIN_EARPIECE";
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return "BUILTIN_SPEAKER";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET: return "WIRED_HEADSET";
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES: return "WIRED_HEADPHONES";
            case AudioDeviceInfo.TYPE_USB_HEADSET: return "USB_HEADSET";
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO: return "BLUETOOTH_SCO";
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP: return "BLUETOOTH_A2DP";
            case AudioDeviceInfo.TYPE_TELEPHONY: return "TELEPHONY";
            case AudioDeviceInfo.TYPE_HEARING_AID: return "HEARING_AID";
            case AudioDeviceInfo.TYPE_AUX_LINE: return "AUX_LINE";
            case AudioDeviceInfo.TYPE_LINE_ANALOG: return "LINE_ANALOG";
            case AudioDeviceInfo.TYPE_USB_DEVICE: return "USB_DEVICE";
            default: return "UNKNOWN (" + type + ")";
        }
    }

    private String headsetProfileStateToString(int state) {
        switch (state) {
            case BluetoothProfile.STATE_DISCONNECTED:
                return "DISCONNECTED";
            case BluetoothProfile.STATE_CONNECTING:
                return "CONNECTING";
            case BluetoothProfile.STATE_CONNECTED:
                return "CONNECTED";
            case BluetoothProfile.STATE_DISCONNECTING:
                return "DISCONNECTING";
            default:
                return "UNKNOWN(" + state + ")";
        }
    }

    private String scoStateToString(int state) {
        switch (state) {
            case AudioManager.SCO_AUDIO_STATE_DISCONNECTED:
                return "DISCONNECTED";
            case AudioManager.SCO_AUDIO_STATE_CONNECTED:
                return "CONNECTED";
            case AudioManager.SCO_AUDIO_STATE_CONNECTING:
                return "CONNECTING";
            case AudioManager.SCO_AUDIO_STATE_ERROR:
                return "ERROR";
            default:
                return "UNKNOWN(" + state + ")";
        }
    }

    private int getAudioDeviceTypeFromString(String type) {
        if (type == null) return -1;
    
        switch (type) {
            case "EARPIECE": return AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
            case "BUILTIN_EARPIECE": return AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
            case "BUILTIN_SPEAKER": return AudioDeviceInfo.TYPE_BUILTIN_SPEAKER;
            case "SPEAKER_PHONE": return AudioDeviceInfo.TYPE_BUILTIN_SPEAKER;
            case "WIRED_HEADSET": return AudioDeviceInfo.TYPE_WIRED_HEADSET;
            case "WIRED_HEADPHONES": return AudioDeviceInfo.TYPE_WIRED_HEADPHONES;
            case "USB_HEADSET": return AudioDeviceInfo.TYPE_USB_HEADSET;
            case "BLUETOOTH_SCO": return AudioDeviceInfo.TYPE_BLUETOOTH_SCO;
            default: return -1;
        }
    }

    @ReactMethod
    public void stop(Promise promise) {
        if (!started) return;    
        started = false;

        Log.d(TAG, "AudioRouteModule stop");

        pendingBtDevice = null;
        audioManager.setMode(origAudioMode);
        Log.d(TAG, "Audio mode restored to original " + getAudioModeDescription(origAudioMode));

        try {
            if (scoManager != null) {
                scoManager.stopScoIfActive();
                scoManager.release();  // unregister receiver and close proxy
                scoManager = null;
                //Log.d(TAG, "Bluetooth SCO stopped and manager released");
            }
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Error stopping Bluetooth SCO", e);
            promise.reject("ERROR", e);
        }
    }

    private boolean isBluetoothConnected() {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) return false;
    
        int profileState = adapter.getProfileConnectionState(BluetoothProfile.HEADSET);
        
        boolean scoBool = audioManager.isBluetoothScoOn();
        int scoState = lastScoState; // or you can read EXTRA_SCO_AUDIO_STATE
    
        //Log.d(TAG, "BT HEADSET profile state=" + headsetProfileStateToString(profileState));
        //Log.d(TAG, "BT SCO state=" + scoStateToString(scoState) + " (isBluetoothScoOn=" + scoBool + ")");
    
        return (profileState == BluetoothProfile.STATE_CONNECTED);
    }

    @ReactMethod
    public void setActiveDevice(ReadableMap deviceMap, Promise promise) {
        try {
            if (deviceMap == null) {
                promise.reject("ERROR", "No device provided");
                return;
            }
    
            // Convert ReadableMap to Map<String, String> for internal handling
            Map<String, String> device = new HashMap<>();
            ReadableMapKeySetIterator iterator = deviceMap.keySetIterator();
            while (iterator.hasNextKey()) {
                String key = iterator.nextKey();
                device.put(key, deviceMap.getString(key));
            }
    
            Log.d(TAG, "setActiveDevice " + device);
    
            boolean switched = switchAudioRoute(device);
    
            if (switched) {
                promise.resolve(true);
            } else {
                promise.reject("ERROR", "Requested audio device not available: " + device.get("type"));
            }
    
        } catch (Exception e) {
            Log.e(TAG, "setActiveDevice ERROR", e);
            promise.reject("ERROR", e);
        }
    }

    private void logWritableArray(String label, WritableArray array) {
        StringBuilder sb = new StringBuilder();
        sb.append(label).append(": [");
    
        for (int i = 0; i < array.size(); i++) {
            // assuming your "routes" array contains strings
            sb.append(array.getString(i));
    
            if (i < array.size() - 1) {
                sb.append(", ");
            }
        }
    
        sb.append("]");
    
        Log.d(TAG, sb.toString());
    }
    
    private void sendReactNativeEvent() {
        try {
            if (!reactContext.hasActiveCatalystInstance()) {
                //Log.w(TAG, "React context not active; skipping emit");
                return;
            }

            WritableMap event = Arguments.createMap();
            
            WritableArray inputs = getAudioInputs();
            event.putArray("inputs", inputs);

            WritableArray outputs = getAudioOutputs();
            Map<String, String> selectedInfo = getCurrentRouteInfo();
            
            String selectedType = selectedInfo.get("type");
            WritableMap selectedMap = Arguments.createMap();
            
            for (Map.Entry<String, String> entry : selectedInfo.entrySet()) {
                selectedMap.putString(entry.getKey(), entry.getValue());
            }
            
            // Always send all available output devices so the UI can show the full
            // device list regardless of which device is currently selected.
            // (The previous BT-only filter was hiding earpiece/speaker when BT was active.)
            event.putArray("outputs", outputs);

            event.putMap("selected", selectedMap);
    
            int mode = audioManager.getMode();
            event.putString("mode", getAudioModeDescription(mode));

            //Log.d(TAG, "--- AudioDevicesChanged payload ---");
            //logWritableArray("Inputs", inputs);
            //logWritableArray("Outputs", outputs);
            //Log.d(TAG, "Current: " + currentRoute + ", SCO: " + scoState + ", Available: " + availableList);
    
            // Emit event
            reactContext.runOnUiQueueThread(() -> {
                try {
                    reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                            .emit("CommunicationsDevicesChanged", event);
                    //Log.w(TAG, "RN event emitted");

                } catch (Exception e) {
                    Log.e(TAG, "Emit failed", e);
                }
            });
    
        } catch (Exception e) {
            Log.e(TAG, "sendReactNativeEvent ERROR", e);
        }
    }

    @ReactMethod
    public void getCurrentRoute(Promise promise) {
        try {
            Map<String, String> info = getCurrentRouteInfo();
    
            WritableMap map = Arguments.createMap();
    
            for (Map.Entry<String, String> entry : info.entrySet()) {
                map.putString(entry.getKey(), entry.getValue());
            }
    
            promise.resolve(map);
        } catch (Exception e) {
            Log.e(TAG, "getCurrentRoute ERROR", e);
            promise.reject("ERROR", e);
        }
    }

    /**
     * Internal helper to switch audio route without needing a Promise.
     * Accepts a device object (Map<String, String>) instead of a string route.
     */
    private boolean switchAudioRoute(Map<String, String> deviceMap) {
        if (deviceMap == null) return false;
    
        String targetType = deviceMap.get("type");        
        if (currentRoute == null ? targetType == null : currentRoute.equals(targetType)) {
            return true;
        }        

        //Log.d(TAG, "switchAudioRoute from " + currentRoute + " -> " + targetType);
        
        // No SCO active, switch immediately
        return switchAudioRouteInternal(deviceMap);
    }
    
    private boolean switchAudioRouteInternal(Map<String, String> deviceMap) {
        if (deviceMap == null) return false;
    
        // Add this check at the top:
		if (audioManager.getMode() != AudioManager.MODE_IN_COMMUNICATION) {
			Log.w(TAG, "Audio mode was reset, restoring MODE_IN_COMMUNICATION");
			audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
		}
    
        String type = deviceMap.get("type");
        String idStr = deviceMap.get("id");
        Log.d(TAG, "Switch audio route to audio device: " + deviceMap);
    
        try {
            List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
            AudioDeviceInfo selectedDevice = null;
    
            int deviceId = -1;
            try {
                deviceId = Integer.parseInt(idStr);
            } catch (Exception ignored) {}
    
            for (AudioDeviceInfo device : devices) {
                // Match by ID if possible
                if (device.getId() == deviceId) {
                    selectedDevice = device;
                    break;
                }
    
                // Otherwise match by type
                if (device.getType() == getAudioDeviceTypeFromString(type)) {
                    selectedDevice = device;
                    break;
                }
            }
    
            if (selectedDevice != null) {
                // Update currentRoute for logging/state
                currentRoute = type;

				//audioManager.clearCommunicationDevice();


				if (type != null && type.equals("BUILTIN_SPEAKER")) {
					// Stop BT SCO before activating speaker. When SCO is active, BT takes
					// priority over speaker in the HAL and both setCommunicationDevice(SPEAKER)
					// and setSpeakerphoneOn() will be ignored. clearCommunicationDevice() +
					// stopScoIfActive() removes BT from the audio path first.
					pendingBtDevice = null;
					if (scoManager != null) {
						scoManager.stopScoIfActive();
					}
					audioManager.clearCommunicationDevice();

					if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
						// Try the modern API first.
						Log.d(TAG, "Switching to BUILTIN_SPEAKER via setCommunicationDevice (API 31+)");
						boolean result = audioManager.setCommunicationDevice(selectedDevice);
						AudioDeviceInfo actual = audioManager.getCommunicationDevice();
						int actualId = actual != null ? actual.getId() : -1;
						Log.d(TAG, "setCommunicationDevice(BUILTIN_SPEAKER) result=" + result
							+ " communicationDevice=" + actualId);

						// On Motorola RAZR (and similar OEMs) setCommunicationDevice returns true
						// but getCommunicationDevice() still reports earpiece — the HAL silently
						// ignores the request. Detect this and fall through to the MODE_NORMAL
						// workaround path.
						if (result && actualId == selectedDevice.getId()) {
							currentRoute = type;
							return true;
						}
						Log.w(TAG, "setCommunicationDevice did not take effect (OEM override), "
							+ "falling back to MODE_NORMAL + setSpeakerphoneOn");
					}
					// Workaround for Motorola RAZR 60 (and similar OEMs) where the audio HAL
					// locks MODE_IN_COMMUNICATION and ignores both setCommunicationDevice(SPEAKER)
					// and setMode(MODE_NORMAL). Steps:
					//   1. clearCommunicationDevice() — release the HAL's routing lock
					//   2. setMode(MODE_IN_CALL) — native telephony mode; Motorola honors
					//      setSpeakerphoneOn here but not in MODE_IN_COMMUNICATION
					//   3. setSpeakerphoneOn(true)
					// We do NOT switch back to IN_COMMUNICATION while speaker is active.
					// The earpiece path below restores IN_COMMUNICATION when speaker is deselected.
					Log.d(TAG, "Forcing speaker: clearCommunicationDevice + MODE_IN_CALL + setSpeakerphoneOn(true)");
					audioManager.clearCommunicationDevice();
					audioManager.setMode(AudioManager.MODE_IN_CALL);
					audioManager.setSpeakerphoneOn(true);
					Log.d(TAG, "isSpeakerphoneOn=" + audioManager.isSpeakerphoneOn()
						+ " mode=" + getAudioModeDescription(audioManager.getMode()));
					currentRoute = type;
					return true;
				} else if (type != null && type.startsWith("BLUETOOTH")) {
					// BT routing: do NOT call clearCommunicationDevice() here —
					// clearing the routing context before SCO establishment prevents
					// the system from establishing SCO on Motorola and similar devices.
					Log.d(TAG, "Routing to BT, disabling speakerphone");
					audioManager.setSpeakerphoneOn(false);
					audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);

					if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
						// API 31+: setCommunicationDevice() triggers SCO establishment
						// automatically — no need to call startBluetoothSco() separately.
						// OnCommunicationDeviceChangedListener fires when routing completes.
						pendingBtDevice = null;
						boolean result = audioManager.setCommunicationDevice(selectedDevice);
						Log.d(TAG, "BT setCommunicationDevice result=" + result
							+ " device=" + selectedDevice.getId() + " " + selectedDevice.getProductName());
						return result;
					}

					// API < 31: legacy SCO path
					if (scoManager != null) {
						if (lastScoState == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
							Log.d(TAG, "SCO already connected, routing directly to BT");
							pendingBtDevice = null;
							boolean result = audioManager.setCommunicationDevice(selectedDevice);
							Log.d(TAG, "BT setCommunicationDevice result=" + result);
							return result;
						} else {
							Log.d(TAG, "SCO not connected, starting legacy SCO and deferring BT route");
							audioManager.setCommunicationDevice(selectedDevice);
							pendingBtDevice = new HashMap<>(deviceMap);
							scoManager.startScoIfNeeded();
							return true;
						}
					}
					boolean result = audioManager.setCommunicationDevice(selectedDevice);
					Log.d(TAG, "BT setCommunicationDevice result=" + result);
					return result;

				} else {
					// Earpiece, wired headset, etc.
					// clearCommunicationDevice() releases the HAL speaker lock so that
					// the subsequent setCommunicationDevice(earpiece/wired) takes effect.
                    Log.d(TAG, "setSpeakerphoneOff + clearCommunicationDevice, restoring MODE_IN_COMMUNICATION");
					audioManager.setSpeakerphoneOn(false);
					audioManager.clearCommunicationDevice();
					audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
				}

                boolean result = audioManager.setCommunicationDevice(selectedDevice);

                if (result) {
                    Log.d(TAG, "requested change to " + selectedDevice.getId() + " " + selectedDevice.getProductName() + " " + type + " " + getAudioDeviceTypeFromString(type));
                } else {
                    Log.d(TAG, "setCommunicationDevice failed to switch");
                }

                return result;
            } else {
                Log.d(TAG, "No matching AudioDeviceInfo found for device: " + deviceMap);
                return false;
            }
    
        } catch (Exception e) {
            Log.e(TAG, "switchAudioRouteInternal ERROR", e);
            return false;
        }
    }

	private void reapplyCurrentRoute() {
		List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
		for (AudioDeviceInfo device : devices) {
			if (getDeviceTypeName(device.getType()).equals(currentRoute)) {
				audioManager.setCommunicationDevice(device);
				Log.d(TAG, "Re-applied route to " + currentRoute);
				return;
			}
		}
	}

    private Map<String, String> getCurrentRouteInfo() {
        Map<String, String> info = new HashMap<>();
    
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) { // Android 12+
            AudioDeviceInfo device = audioManager.getCommunicationDevice();
    
            if (device != null) {
                String typeName = getDeviceTypeName(device.getType());
                String productName = device.getProductName() != null
                        ? device.getProductName().toString()
                        : "UNKNOWN";
    
                String deviceId = String.valueOf(device.getId());
    
                info.put("name", productName);
                info.put("id", deviceId);
                info.put("type", typeName);
                currentRoute = typeName;
                Log.d(TAG, "Current device: " + deviceId + " " + productName + " " + typeName);
                return info;
            }
        }
    
        // No device routed
        return info;  
    }

    @ReactMethod
    public void getAudioInputs(Promise promise) {
        //Log.e(TAG, "getAudioInputs");
        try {
            WritableArray inputs = getAudioInputs();
            promise.resolve(inputs);
        } catch (Exception e) {
            Log.e(TAG, "getAudioInputs ERROR", e);
            promise.reject("ERROR", e);
        }
    }

    @ReactMethod
    public void getAudioOutputs(Promise promise) {
        //Log.e(TAG, "getAudioOutputs");
        try {
            WritableArray outputs = getAudioOutputs();
            promise.resolve(outputs);
        } catch (Exception e) {
            Log.e(TAG, "getAudioInputs ERROR", e);
            promise.reject("ERROR", e);
        }
    }
    
    private WritableArray getAudioInputs() {
        WritableArray inputsArray = Arguments.createArray();
    
        // --- INPUTS ---
        AudioDeviceInfo[] inputs = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS);
        Set<String> seenInputNames = new HashSet<>();
        
        for (AudioDeviceInfo device : inputs) {
            String typeName;
            String productName = device.getProductName() != null
                    ? device.getProductName().toString()
                    : "UNKNOWN";
    
            //Log.d(TAG, "Input Device: " + device.getType() + ", Name: " + productName + ", ID: " + device.getId());

            switch (device.getType()) {
                case AudioDeviceInfo.TYPE_BUILTIN_MIC: typeName = "BUILTIN_MIC"; break;
                case AudioDeviceInfo.TYPE_WIRED_HEADSET: typeName = "WIRED_HEADSET"; break;
                case AudioDeviceInfo.TYPE_USB_HEADSET: typeName = "USB_HEADSET"; break;
                case AudioDeviceInfo.TYPE_AUX_LINE: typeName = "AUX_LINE"; break;
                case AudioDeviceInfo.TYPE_LINE_ANALOG: typeName = "LINE_ANALOG"; break;
                default: continue; // skip unknowns
            }
    
            WritableMap inputDevice = Arguments.createMap();
            inputDevice.putString("type", typeName);
            inputDevice.putString("name", productName);
            inputDevice.putString("id", String.valueOf(device.getId())); // <-- added device ID
    
            inputsArray.pushMap(inputDevice);
    
            Log.d(TAG, "Input Device: " + typeName + ", Name: " + productName + ", ID: " + device.getId());
        }
    
        return inputsArray;
    }

    private boolean isKnownOutputType(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE:
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_USB_HEADSET:
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
            case AudioDeviceInfo.TYPE_HDMI:
                return true;
    
            default:
                return false; // skip unknowns
        }
    }

    private WritableArray getAudioOutputs() {
        WritableArray outputsArray = Arguments.createArray();
    
        AudioDeviceInfo[] outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
    
        for (AudioDeviceInfo device : outputs) {
            int type = device.getType();
    
            // Skip Bluetooth A2DP (same as original)
            if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) continue;
    
            // Skip unknowns — keep same behavior as getAudioInputs()
            if (!isKnownOutputType(type)) continue;
    
            String productName = device.getProductName() != null
                    ? device.getProductName().toString()
                    : "UNKNOWN";
    
            WritableMap outputDevice = Arguments.createMap();
            outputDevice.putString("type", getDeviceTypeName(type));
            outputDevice.putString("name", productName);
            outputDevice.putString("id", String.valueOf(device.getId())); // <-- added device ID
    
            outputsArray.pushMap(outputDevice);
    
            Log.d(TAG, "Output Device: " + getDeviceTypeName(type) + ", Name: " + productName + ", ID: " + device.getId());
        }
    
        return outputsArray;
    }
    
    @Override
    public void onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy();
        if (headsetReceiver != null) {
            reactContext.unregisterReceiver(headsetReceiver);
            headsetReceiver = null;
        }
    }
}

