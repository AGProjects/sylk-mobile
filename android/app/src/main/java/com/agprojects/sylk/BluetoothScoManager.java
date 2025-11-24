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

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothHeadset;
import android.bluetooth.BluetoothProfile;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.os.Build;


public class BluetoothScoManager {
    private static final String TAG = "SYLK";

    private final AudioManager audioManager;
    private final BluetoothAdapter bluetoothAdapter;
    private BluetoothHeadset bluetoothHeadset;
    private final Context context;

    private final BroadcastReceiver headsetReceiver;
    private final BroadcastReceiver scoStateReceiver;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private int retryCount = 0;
    private static final int MAX_RETRIES = 3;
    private static final int RETRY_DELAY_MS = 2000;
    private boolean userRequestedSco = false;
	private BluetoothEventListener eventListener;

    public BluetoothScoManager(Context context) {
        this.context = context.getApplicationContext();
        audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();

        // Headset connection monitoring
        headsetReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
				if (BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED.equals(intent.getAction())) {
					int state = intent.getIntExtra(BluetoothProfile.EXTRA_STATE, BluetoothProfile.STATE_DISCONNECTED);
					Log.d(TAG, "BluetoothHeadset profile state=" + profileStateToString(state));
				
					if (state == BluetoothProfile.STATE_CONNECTED) {
						if (eventListener != null) {
							eventListener.onBluetoothHeadsetConnected();
						}
					}
				
					if (state != BluetoothProfile.STATE_CONNECTED) {
						stopScoIfActive();
					}
				}
            }

        };
        context.registerReceiver(headsetReceiver, new IntentFilter(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED));

        // SCO state monitoring
        scoStateReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED.equals(intent.getAction())) {
                    int state = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1);
                    //Log.d(TAG, "SCO state=" + scoStateToString(state) + " (isBluetoothScoOn=" + audioManager.isBluetoothScoOn() + ")");
                    if (state == AudioManager.SCO_AUDIO_STATE_DISCONNECTED) {
						if (!userRequestedSco) {
							//Log.d(TAG, "SCO disconnected but user did NOT request SCO → no retry");
							return;
						}

                        if (retryCount < MAX_RETRIES) {
                            retryCount++;
                            Log.d(TAG, "SCO disconnected, retrying in " + RETRY_DELAY_MS + "ms (retry " + retryCount + ")");
                            handler.postDelayed(BluetoothScoManager.this::startScoIfNeeded, RETRY_DELAY_MS);
                        }
                    } else if (state == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
                        retryCount = 0;
                    }
                }
            }
        };
        context.registerReceiver(scoStateReceiver, new IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED));

        // Initialize Bluetooth HEADSET proxy
        if (bluetoothAdapter != null) {
            bluetoothAdapter.getProfileProxy(context, new BluetoothProfile.ServiceListener() {
                @Override
                public void onServiceConnected(int profile, BluetoothProfile proxy) {
                    if (profile == BluetoothProfile.HEADSET) {
                        bluetoothHeadset = (BluetoothHeadset) proxy;
                        //Log.d(TAG, "BluetoothHeadset proxy connected");
                    }
                }

                @Override
                public void onServiceDisconnected(int profile) {
                    if (profile == BluetoothProfile.HEADSET) {
                        bluetoothHeadset = null;
                        Log.d(TAG, "BluetoothHeadset proxy disconnected");
                        stopScoIfActive();
                    }
                }
            }, BluetoothProfile.HEADSET);
        }
    }

	public void setEventListener(BluetoothEventListener listener) {
		this.eventListener = listener;
	}

	public interface BluetoothEventListener {
		void onBluetoothHeadsetConnected();
	}

    public boolean isHeadsetConnected() {
        if (bluetoothAdapter == null || bluetoothHeadset == null) return false;
        for (android.bluetooth.BluetoothDevice device : bluetoothHeadset.getConnectedDevices()) {
            if (bluetoothHeadset.getConnectionState(device) == BluetoothProfile.STATE_CONNECTED) {
                return true;
            }
        }
        return false;
    }

    public void startScoIfNeeded() {
		userRequestedSco = true;
        if (isHeadsetConnected() && !audioManager.isBluetoothScoOn()) {
            Log.d(TAG, "Starting Bluetooth SCO...");
            audioManager.startBluetoothSco();
            audioManager.setBluetoothScoOn(true);
        }
    }

	public void stopScoIfActive() {
		if (audioManager.isBluetoothScoOn()) {
			Log.d(TAG, "Stopping Bluetooth SCO...");
			audioManager.clearCommunicationDevice();
			audioManager.stopBluetoothSco();
			audioManager.setBluetoothScoOn(false);
		}
		retryCount = MAX_RETRIES; // prevent retry
	}

    public void release() {
        handler.removeCallbacksAndMessages(null);
        try {
            context.unregisterReceiver(headsetReceiver);
        } catch (Exception e) {
            Log.w(TAG, "Headset receiver already unregistered");
        }
        try {
            context.unregisterReceiver(scoStateReceiver);
        } catch (Exception e) {
            Log.w(TAG, "SCO receiver already unregistered");
        }
        if (bluetoothAdapter != null && bluetoothHeadset != null) {
            bluetoothAdapter.closeProfileProxy(BluetoothProfile.HEADSET, bluetoothHeadset);
            bluetoothHeadset = null;
        }
    }

    private String scoStateToString(int state) {
        switch (state) {
            case AudioManager.SCO_AUDIO_STATE_CONNECTED: return "CONNECTED";
            case AudioManager.SCO_AUDIO_STATE_CONNECTING: return "CONNECTING";
            case AudioManager.SCO_AUDIO_STATE_DISCONNECTED: return "DISCONNECTED";
            default: return "UNKNOWN(" + state + ")";
        }
    }

    private String profileStateToString(int state) {
        switch (state) {
            case BluetoothProfile.STATE_CONNECTED: return "CONNECTED";
            case BluetoothProfile.STATE_CONNECTING: return "CONNECTING";
            case BluetoothProfile.STATE_DISCONNECTED: return "DISCONNECTED";
            case BluetoothProfile.STATE_DISCONNECTING: return "DISCONNECTING";
            default: return "UNKNOWN(" + state + ")";
        }
    }
}
