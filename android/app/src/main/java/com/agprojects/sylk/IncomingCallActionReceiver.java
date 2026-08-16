package com.agprojects.sylk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import android.os.Bundle;

import android.os.Build;
import android.telecom.DisconnectCause;
import androidx.core.app.NotificationManagerCompat;

import com.facebook.react.ReactApplication;
import com.facebook.react.ReactInstanceManager;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import com.agprojects.sylk.ReactEventEmitter;

public class IncomingCallActionReceiver extends BroadcastReceiver {

    private static final String LOG_TAG = "SYLK_APP";
    
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }

		Bundle extras = intent.getExtras();
		if (extras != null) {
			for (String key : extras.keySet()) {
				//SylkLogger.d("[call] [action] EXTRA: " + key + " = " + extras.get(key));
			}
		}

        String action = intent.getAction();
		String callUUID = intent.getStringExtra("session-id");
		String event = intent.getStringExtra("event");
		String from_uri = intent.getStringExtra("from_uri");
		String to_uri = intent.getStringExtra("to_uri");
		String phoneLockedStr = intent.getStringExtra("phoneLocked");

		boolean phoneLocked = "true".equals(phoneLockedStr);
		int notificationId = intent.getIntExtra("notification-id", -1);
		// Fall back to a deterministic notification-id when none was supplied
		// (e.g. when this broadcast came from SylkCallConnectionService after
		// the user pressed Answer/Reject on a paired BT car kit). Matches the
		// id IncomingCallService uses.
		if (notificationId == -1 && callUUID != null) {
			notificationId = Math.abs(callUUID.hashCode());
		}

        // Only handle local user actions (Accept/Reject)
        if (action.startsWith("ACTION_ACCEPT") || action.equals("ACTION_REJECT_CALL")) {
            String rejectSource = intent.getStringExtra("reject-source");
            if (rejectSource == null) rejectSource = intent.getStringExtra("source");
            SylkLogger.d("[call] [action] User action: " + action + " for call: " + callUUID
                + (action.equals("ACTION_REJECT_CALL") ? " reject-source=" + (rejectSource == null ? "unknown" : rejectSource) : ""));
            //SylkLogger.d("[call] [action] event " + event);

            // Keep the Telecom/BT-HFP state in sync immediately so the car
            // kit's display flips out of "ringing" the moment the user taps,
            // without waiting for IncomingCallService cleanup to land.
            if (action.startsWith("ACTION_ACCEPT")) {
                SylkTelecom.setActive(callUUID);
            } else {
                SylkTelecom.endCall(callUUID, DisconnectCause.REJECTED);
            }

            // Cancel notification immediately
            if (notificationId != -1) {
                NotificationManagerCompat.from(context).cancel(notificationId);
                SylkLogger.d("[call] [action] Notification canceled immediately: " + notificationId);
            }

			//SylkLogger.d("[call] [action] phoneLocked: " + phoneLocked);
			// Emit to the JS layer for BOTH accept and reject. Previously only
			// ACTION_ACCEPT was forwarded, so a reject from the push/CallKeep
			// notification never reached JS — the call was rejected natively
			// and JS only learned about it via the server's terminated (487)
			// round-trip seconds later. Meanwhile the prewarmed peer
			// connection kept gathering ICE ("Collecting ICE candidates…")
			// for up to ~45s. Forwarding the reject lets callEventHandler ->
			// callKeepRejectCall cancel the prewarm immediately.
			ReactEventEmitter.sendEventToReact(action, callUUID, from_uri, to_uri, phoneLocked,  event, (ReactApplication) context.getApplicationContext());

			// 2. Close the IncomingCallActivity layout
			Intent closeActivityIntent = new Intent("ACTION_CLOSE_INCOMING_CALL_ACTIVITY");
			closeActivityIntent.putExtra("session-id", callUUID);
			LocalBroadcastManager.getInstance(context).sendBroadcast(closeActivityIntent);
        
            // Notify IncomingCallService to clean up
            if (notificationId != -1) {
                Intent cleanupIntent = new Intent(context, IncomingCallService.class);
                cleanupIntent.setAction(action);
                cleanupIntent.putExtra("event", event);
                cleanupIntent.putExtra("session-id", callUUID);
                cleanupIntent.putExtra("from_uri", from_uri);
                cleanupIntent.putExtra("to_uri", to_uri);
                cleanupIntent.putExtra("phoneLocked", phoneLocked);
                cleanupIntent.putExtra("notification-id", notificationId);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(cleanupIntent);
                } else {
                    context.startService(cleanupIntent);
                }
            }
        } else {
                SylkLogger.d("[call] [action] Unknown action received: " + action);
        }
    }
}
