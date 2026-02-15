package com.agprojects.sylk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import android.os.Bundle;

import android.os.Build;
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

    private static final String LOG_TAG = "[SYLK_ACT_RECEIVE]";
    
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }

		Bundle extras = intent.getExtras();
		if (extras != null) {
			for (String key : extras.keySet()) {
				//Log.d(LOG_TAG, "  EXTRA: " + key + " = " + extras.get(key));
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

        // Only handle local user actions (Accept/Reject)
        if (action.startsWith("ACTION_ACCEPT") || action.equals("ACTION_REJECT_CALL")) {
            Log.d(LOG_TAG, "User action: " + action + " for call: " + callUUID);
            //Log.d(LOG_TAG, "event " + event);

            // Cancel notification immediately
            if (notificationId != -1) {
                NotificationManagerCompat.from(context).cancel(notificationId);
                Log.d(LOG_TAG, "Notification canceled immediately: " + notificationId);
            }

			//Log.d(LOG_TAG, "phoneLocked: " + phoneLocked);
			if (action.startsWith("ACTION_ACCEPT")) {
				ReactEventEmitter.sendEventToReact(action, callUUID, from_uri, to_uri, phoneLocked,  event, (ReactApplication) context.getApplicationContext());
            }

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
                Log.d(LOG_TAG, "Unknown action received: " + action);
        }
    }
}
