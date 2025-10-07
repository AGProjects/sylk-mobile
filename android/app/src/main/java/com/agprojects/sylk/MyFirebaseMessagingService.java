package com.agprojects.sylk;

import android.content.Intent;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationManagerCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

import android.app.KeyguardManager;
import android.content.Context;



public class MyFirebaseMessagingService extends FirebaseMessagingService {

    private static final String LOG_TAG = "[SYLK FCM SERVICE]";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        if (data == null || !data.containsKey("event")) {
            Log.d(LOG_TAG, "No event found in FCM payload");
            return;
        }
		// inside onMessageReceived
		boolean phoneLocked = false;

		// Get the KeyguardManager
		KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
		if (km != null) {
			// Check if device is locked or in keyguard-restricted input mode
			phoneLocked = km.isKeyguardLocked();
		}

        String event = data.get("event");
        String callId = data.get("session-id");

        if (event.equals("incoming_session") || event.equals("incoming_conference_request")) {
			Log.d(LOG_TAG, event + " " + callId);
            Intent serviceIntent = new Intent(this, IncomingCallService.class);
            // Pass all FCM data to service
            for (Map.Entry<String, String> entry : data.entrySet()) {
                serviceIntent.putExtra(entry.getKey(), entry.getValue());
            }
            
            serviceIntent.putExtra("phoneLocked", phoneLocked);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }

        } else if (event.equals("cancel")) {
			if (IncomingCallService.handledCalls.contains(callId)) {
				//Log.d(LOG_TAG, "cancel already handled: " + callId);
				return;
			}

			Log.d(LOG_TAG, event + " " + callId);
			int notificationId = Math.abs(callId.hashCode());
		
			// Stop the IncomingCallService if running
			Intent stopIntent = new Intent(this, IncomingCallService.class);
			stopIntent.putExtra("event", "cancel");
			stopIntent.putExtra("session-id", callId);
			stopIntent.putExtra("notification-id", notificationId);
		
			if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
				startForegroundService(stopIntent);
			} else {
				startService(stopIntent);
			}
					
			//IncomingCallActivity.closeBubble(callId);
    
        } else {
            //Log.d(LOG_TAG, "Unhandled event: " + event);
        }
    }
}
