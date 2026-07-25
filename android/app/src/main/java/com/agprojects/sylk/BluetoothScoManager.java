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
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.os.Build;


public class BluetoothScoManager {
    private static final String TAG = "SYLK_APP";

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
    // Minimum time a SCO session must stay CONNECTED before a subsequent
    // disconnect is treated as a genuine drop (refreshing the retry
    // budget) rather than a connect→disconnect bounce (which keeps
    // burning the budget down). See the SCO receiver for the rationale.
    private static final long STABLE_MS = 10000;
    private long scoConnectedAtMs = 0;
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
					SylkLogger.d("[audio] [bt] BluetoothHeadset profile state=" + profileStateToString(state));
				
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
                    //SylkLogger.d("[audio] [bt] SCO state=" + scoStateToString(state) + " (isBluetoothScoOn=" + audioManager.isBluetoothScoOn() + ")");
                    if (state == AudioManager.SCO_AUDIO_STATE_DISCONNECTED) {
						if (!userRequestedSco) {
							//SylkLogger.d("[audio] [bt] SCO disconnected but user did NOT request SCO → no retry");
							return;
						}

                        // Retry budget. Two fixes over the original:
                        //   1. The retry used to call startScoIfNeeded(),
                        //      which RESETS retryCount — so MAX_RETRIES
                        //      never bounded anything and every log line
                        //      said "retry 1" forever. Retries now go
                        //      through retrySco(), which leaves the
                        //      counter alone.
                        //   2. A CONNECTED event used to reset the budget
                        //      immediately, so a connect→disconnect bounce
                        //      loop (OS repeatedly failing to hold SCO,
                        //      e.g. phantom bonded headset or Telecom
                        //      route tug-of-war) also retried forever.
                        //      The budget now only refreshes when the
                        //      SCO session survived STABLE_MS — a genuine
                        //      mid-call drop gets fresh retries, a bounce
                        //      burns through the budget and stops.
                        if (scoConnectedAtMs > 0
                                && System.currentTimeMillis() - scoConnectedAtMs >= STABLE_MS) {
                            retryCount = 0;
                        }
                        scoConnectedAtMs = 0;
                        if (retryCount < MAX_RETRIES) {
                            retryCount++;
                            SylkLogger.d("[audio] [bt] SCO disconnected, retrying in " + RETRY_DELAY_MS + "ms (retry " + retryCount + "/" + MAX_RETRIES + ")");
                            handler.postDelayed(BluetoothScoManager.this::retrySco, RETRY_DELAY_MS);
                        } else {
                            SylkLogger.d("[audio] [bt] SCO retry budget exhausted — giving up until next explicit request");
                        }
                    } else if (state == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
                        scoConnectedAtMs = System.currentTimeMillis();
                        if (scoConnectedListener != null) {
                            scoConnectedListener.onScoConnected();
                        }
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
                        //SylkLogger.d("[audio] [bt] BluetoothHeadset proxy connected");
                    }
                }

                @Override
                public void onServiceDisconnected(int profile) {
                    if (profile == BluetoothProfile.HEADSET) {
                        bluetoothHeadset = null;
                        //SylkLogger.d("[audio] [bt] BluetoothHeadset proxy disconnected");
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

	// Separate listener fired when SCO audio channel actually connects.
	// AudioRouteModule uses this to re-apply a pending BT device route that
	// was requested while SCO was still establishing.
	public interface ScoConnectedListener {
		void onScoConnected();
	}

	private ScoConnectedListener scoConnectedListener;

	public void setScoConnectedListener(ScoConnectedListener listener) {
		this.scoConnectedListener = listener;
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
		retryCount = 0; // reset retry counter — user explicitly wants BT
        if (isHeadsetConnected() && !audioManager.isBluetoothScoOn()) {
            SylkLogger.d("[audio] [bt] Starting Bluetooth SCO...");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // startBluetoothSco() is deprecated on API 31+ and is a no-op on many
                // OEM devices (including Motorola). On API 31+ the system establishes
                // SCO automatically when setCommunicationDevice(BLUETOOTH_SCO) is called,
                // so we only use the legacy path on older Android.
                SylkLogger.d("[audio] [bt] API 31+: SCO establishment handled by setCommunicationDevice");
            } else {
                audioManager.startBluetoothSco();
                audioManager.setBluetoothScoOn(true);
            }
        }
    }

	/**
	 * Internal retry entry used by the SCO receiver's postDelayed. Unlike
	 * startScoIfNeeded() it does NOT reset the retry budget and does NOT
	 * re-arm userRequestedSco — a cancelled/stopped session stays stopped.
	 */
	private void retrySco() {
		if (!userRequestedSco) return;
		if (isHeadsetConnected() && !audioManager.isBluetoothScoOn()) {
			SylkLogger.d("[audio] [bt] Retrying Bluetooth SCO (attempt " + retryCount + "/" + MAX_RETRIES + ")");
			if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
				// API 31+: SCO establishment is driven by the standing
				// setCommunicationDevice request — nothing to re-issue here.
			} else {
				audioManager.startBluetoothSco();
				audioManager.setBluetoothScoOn(true);
			}
		}
	}

	public void stopScoIfActive() {
		// Full teardown, unconditionally:
		//   * cancel any pending retry callbacks (a queued retry used to
		//     re-arm the whole loop after stop),
		//   * drop the userRequestedSco latch so late SCO events don't
		//     schedule fresh retries,
		//   * clear a STANDING BT communication-device request even when
		//     SCO happens to be down at this exact moment. The old code
		//     only cleared inside isBluetoothScoOn() — during a
		//     connect/disconnect bounce the call could end in the "down"
		//     phase, the clear was skipped, and the leaked request made
		//     the OS keep trying to establish SCO forever (continuous
		//     CONNECT/DISCONNECT logging long after hangup).
		handler.removeCallbacksAndMessages(null);
		userRequestedSco = false;
		retryCount = MAX_RETRIES; // prevent retry
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
			try {
				AudioDeviceInfo cur = audioManager.getCommunicationDevice();
				if (cur != null && cur.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
					SylkLogger.d("[audio] [bt] Clearing standing BT communication-device request");
					audioManager.clearCommunicationDevice();
				}
			} catch (Exception e) {
				SylkLogger.w("[audio] [bt] clearCommunicationDevice on stop failed: " + e.getMessage());
			}
		}
		if (audioManager.isBluetoothScoOn()) {
			SylkLogger.d("[audio] [bt] Stopping Bluetooth SCO...");
			audioManager.clearCommunicationDevice();
			audioManager.stopBluetoothSco();
			audioManager.setBluetoothScoOn(false);
		}
	}

    public void release() {
        handler.removeCallbacksAndMessages(null);
        try {
            context.unregisterReceiver(headsetReceiver);
        } catch (Exception e) {
            SylkLogger.w("[audio] [bt] Headset receiver already unregistered");
        }
        try {
            context.unregisterReceiver(scoStateReceiver);
        } catch (Exception e) {
            SylkLogger.w("[audio] [bt] SCO receiver already unregistered");
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
