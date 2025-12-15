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

    public AudioRouteModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        this.audioManager = (AudioManager) reactContext.getSystemService(Context.AUDIO_SERVICE);
        instance = this;
        registerReceivers();
		Log.d("SYLK", "AudioRouteModule init");

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
            Log.d("SYLK", "Static onHeadsetEvent() invoked");
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
		if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
			return;
		}

		//Log.d("SYLK", "Registering headset/Bluetooth/SCO receivers…");
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
										
						// Optional auto-route when device connects
						if (profileState == BluetoothProfile.STATE_CONNECTED) {
							Log.d(TAG, "BT headset connected");
						
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
							}, 100); // <-- 50ms delay

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
						if (scoState == AudioManager.SCO_AUDIO_STATE_DISCONNECTED && lastScoAudioState == AudioManager.SCO_AUDIO_STATE_DISCONNECTED && !audioManager.isBluetoothScoOn()) {
							return;
						}
						
						if (lastScoState == AudioManager.SCO_AUDIO_STATE_CONNECTED && scoState == AudioManager.SCO_AUDIO_STATE_DISCONNECTED) {
							sendReactNativeEvent();
						}

						if (lastScoState != AudioManager.SCO_AUDIO_STATE_CONNECTED && scoState == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
							sendReactNativeEvent();
						}

						if (scoState == lastScoAudioState) return;
						lastScoAudioState = scoState;
	
						Log.d(TAG, "BT SCO state=" + scoStateToString(scoState) + " (isBluetoothScoOn=" + audioManager.isBluetoothScoOn() + ")");
	
						break;
					}

					case AudioManager.ACTION_AUDIO_BECOMING_NOISY:
						Log.d(TAG, "ACTION_HEADSET_PLUG event");
						sendReactNativeEvent();
						break;
	
					case Intent.ACTION_HEADSET_PLUG:
						handler.postDelayed(() -> {
							List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
							Log.d(TAG, "HEADSET plugged");
						
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
									Log.d(TAG, "Other device found - ID: " + device.getId() + " Type: " + device.getType() + " " + typeName);
								}
							}
						
						}, 50); // <-- 50ms delay
					
						sendReactNativeEvent();
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
	
		//Log.d("SYLK", "Receivers registered successfully");
	}


	@ReactMethod
	public void getEvent() {
		sendReactNativeEvent();
	}

	@ReactMethod
	public void start(ReadableMap deviceMap, Promise promise) {
		if (started) return;
		started = true;
	
		Log.d("SYLK", "AudioRouteModule start");
	
		try {
			// Capture original audio state
			origAudioMode = audioManager.getMode();
			Log.d(TAG, "Original audio mode: " + getAudioModeDescription(origAudioMode));
	
			// Set communication mode
			audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
			Log.d(TAG, "Audio mode switched to: IN_COMMUNICATION");

			sendReactNativeEvent();
	
			// Instantiate SCO manager if not yet created
			if (scoManager == null) {
				scoManager = new BluetoothScoManager(reactContext);
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
							} else {
								//Log.d(TAG, "Other type of device connected: " + getDeviceTypeName(deviceType));
							}
						}
					} catch (Exception e) {
						Log.e(TAG, "Error routing to BT device on SCO connect", e);
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

		Log.d("SYLK", "AudioRouteModule stop");

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
	
		//Log.d("SYLK", "BT HEADSET profile state=" + headsetProfileStateToString(profileState));
		//Log.d("SYLK", "BT SCO state=" + scoStateToString(scoState) + " (isBluetoothScoOn=" + scoBool + ")");
	
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
	
			Log.d("SYLK", "setActiveDevice " + device);
	
			boolean switched = switchAudioRoute(device);
	
			if (switched) {
				promise.resolve(true);
			} else {
				promise.reject("ERROR", "Requested audio device not available: " + device.get("type"));
			}
	
		} catch (Exception e) {
			Log.e("SYLK", "setActiveDevice ERROR", e);
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
	
		Log.d("SYLK", sb.toString());
	}
	
	private void sendReactNativeEvent() {
		try {
			if (!reactContext.hasActiveCatalystInstance()) {
				//Log.w("SYLK", "React context not active; skipping emit");
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
			
			// --- FIXED FILTERING LOGIC ---
			if (selectedType != null && selectedType.startsWith("BLUETOOTH")) {
			
				WritableArray filteredOutputs = Arguments.createArray();
			
				for (int i = 0; i < outputs.size(); i++) {
			
					ReadableMap dev = outputs.getMap(i);   // <-- ReadableMap here
					if (dev == null) continue;
			
					String type = dev.getString("type");
					if (type != null && type.startsWith("BLUETOOTH")) {
			
						// Create a new WritableMap because ReadableMap cannot be reused
						WritableMap newDev = Arguments.createMap();
			
						// Copy fields over (assuming each device map has id, name, type, etc.)
						for (Map.Entry<String, Object> e : dev.toHashMap().entrySet()) {
							Object val = e.getValue();
							if (val instanceof String) newDev.putString(e.getKey(), (String) val);
							else if (val instanceof Boolean) newDev.putBoolean(e.getKey(), (Boolean) val);
							else if (val instanceof Double) newDev.putDouble(e.getKey(), (Double) val);
							// Add more if needed
						}
			
						filteredOutputs.pushMap(newDev);
					}
				}
			
				outputs = filteredOutputs;
			}
			
			event.putArray("outputs", outputs);

			event.putMap("selected", selectedMap);
	
			int mode = audioManager.getMode();
			event.putString("mode", getAudioModeDescription(mode));

			//Log.d("SYLK", "--- AudioDevicesChanged payload ---");
			//logWritableArray("Inputs", inputs);
			//logWritableArray("Outputs", outputs);
			//Log.d("SYLK", "Current: " + currentRoute + ", SCO: " + scoState + ", Available: " + availableList);
	
			// Emit event
			reactContext.runOnUiQueueThread(() -> {
				try {
					reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
							.emit("CommunicationsDevicesChanged", event);
					//Log.w("SYLK", "RN event emitted");

				} catch (Exception e) {
					Log.e("SYLK", "Emit failed", e);
				}
			});
	
		} catch (Exception e) {
			Log.e("SYLK", "sendReactNativeEvent ERROR", e);
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
			Log.e("SYLK", "getCurrentRoute ERROR", e);
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
	
		String type = deviceMap.get("type");
		String idStr = deviceMap.get("id");
		Log.d("SYLK", "switchAudioRouteInternal to device: " + deviceMap);
	
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

                audioManager.clearCommunicationDevice();
				// Handle speakerphone toggle

				boolean result = audioManager.setCommunicationDevice(selectedDevice);
	
				if (result) {
					Log.d("SYLK", "requested change to " + selectedDevice.getId() + " " + selectedDevice.getProductName() + " " + type);
					if (type.startsWith("BLUETOOTH") && scoManager != null) {
						scoManager.startScoIfNeeded();
					}
				} else {
					Log.d("SYLK", "setCommunicationDevice failed to switch");
				}
	
				return result;
			} else {
				Log.d("SYLK", "No matching AudioDeviceInfo found for device: " + deviceMap);
				return false;
			}
	
		} catch (Exception e) {
			Log.e("SYLK", "switchAudioRouteInternal ERROR", e);
			return false;
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
				Log.d("SYLK", "current device: " + deviceId + " " + productName + " " + typeName);
				return info;
			}
		}
	
		// No device routed
		return info;  
	}

    @ReactMethod
    public void getAudioInputs(Promise promise) {
		//Log.e("SYLK", "getAudioInputs");
        try {
            WritableArray inputs = getAudioInputs();
            promise.resolve(inputs);
        } catch (Exception e) {
            Log.e("SYLK", "getAudioInputs ERROR", e);
            promise.reject("ERROR", e);
        }
    }

    @ReactMethod
    public void getAudioOutputs(Promise promise) {
		//Log.e("SYLK", "getAudioOutputs");
        try {
            WritableArray outputs = getAudioOutputs();
            promise.resolve(outputs);
        } catch (Exception e) {
            Log.e("SYLK", "getAudioInputs ERROR", e);
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
			switch (device.getType()) {
				case AudioDeviceInfo.TYPE_BUILTIN_MIC: typeName = "BUILTIN_MIC"; break;
				case AudioDeviceInfo.TYPE_WIRED_HEADSET: typeName = "WIRED_HEADSET"; break;
				case AudioDeviceInfo.TYPE_USB_HEADSET: typeName = "USB_HEADSET"; break;
				case AudioDeviceInfo.TYPE_AUX_LINE: typeName = "AUX_LINE"; break;
				case AudioDeviceInfo.TYPE_LINE_ANALOG: typeName = "LINE_ANALOG"; break;
				default: continue; // skip unknowns
			}
	
			String productName = device.getProductName() != null
					? device.getProductName().toString()
					: "UNKNOWN";
	
			WritableMap inputDevice = Arguments.createMap();
			inputDevice.putString("type", typeName);
			inputDevice.putString("name", productName);
			inputDevice.putString("id", String.valueOf(device.getId())); // <-- added device ID
	
			inputsArray.pushMap(inputDevice);
	
			//Log.d("SYLK", "Input Device: " + typeName + ", Name: " + productName + ", ID: " + device.getId());
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
	
			//Log.d("SYLK", "Output Device: " + getDeviceTypeName(type) + ", Name: " + productName + ", ID: " + device.getId());
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

