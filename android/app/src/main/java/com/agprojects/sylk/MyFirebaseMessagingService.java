package com.agprojects.sylk;

import android.content.Intent;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationManagerCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.content.Context;

import android.app.KeyguardManager;
import android.content.Context;

import java.util.Map;
import java.util.HashMap;
import java.io.File;
import java.util.Set;
import java.util.ArrayList;
import java.util.List;


public class MyFirebaseMessagingService extends FirebaseMessagingService {

    private static final String LOG_TAG = "[SYLK FCM SERVICE]";
	private Map<String, List<String>> contactsByTag = new HashMap<>();

	private Map<String, List<String>> getContactsByTag() {
		Map<String, List<String>> result = new HashMap<>();
		List<String> favorites = new ArrayList<>();
		List<String> blocked = new ArrayList<>();
		List<String> autoanswer = new ArrayList<>();
	
		try {		
			File dbFile = getApplicationContext().getDatabasePath("sylk.db");
			if (!dbFile.exists()) {
				Log.e(LOG_TAG, "Database file not found: " + dbFile.getAbsolutePath());
				// still put empty lists in the map
				result.put("blocked", blocked);
				return result;
			}
	
			SQLiteDatabase db = SQLiteDatabase.openDatabase(
					dbFile.getPath(),
					null,
					SQLiteDatabase.OPEN_READONLY
			);
	
			Cursor cursor = db.rawQuery("SELECT uri, tags FROM contacts", new String[]{});
	
			if (cursor != null) {
				while (cursor.moveToNext()) {
					String uri = cursor.getString(cursor.getColumnIndexOrThrow("uri"));
					String tags = cursor.getString(cursor.getColumnIndexOrThrow("tags"));
	
					if (tags != null) {
						String lowerTags = tags.toLowerCase();
						if (lowerTags.contains("block")) {
							blocked.add(uri);
						}
					}
				}
				cursor.close();
			}
	
			db.close();
	
		} catch (Exception e) {
			Log.e(LOG_TAG, "Failed to read contacts from database", e);
		}
	
		result.put("blocked", blocked);
		return result;
	}
	
	private boolean isAccountActive(String account) {
		if (account == null) return false;
	
		File dbFile = getApplicationContext().getDatabasePath("sylk.db");
		if (!dbFile.exists()) {
			Log.e(LOG_TAG, "Database file not found: " + dbFile.getAbsolutePath());
			return false;
		}
	
		SQLiteDatabase db = null;
		Cursor cursor = null;
		boolean isActive = false;
	
		try {
			db = SQLiteDatabase.openDatabase(dbFile.getPath(), null, SQLiteDatabase.OPEN_READONLY);
	
			// Parameterized query to prevent SQL injection
			cursor = db.rawQuery("SELECT active FROM accounts WHERE account = ?", new String[]{account});
	
			if (cursor != null && cursor.moveToFirst()) {
				String activeValue = cursor.getString(cursor.getColumnIndexOrThrow("active"));
				isActive = "1".equals(activeValue);
			} else {
				// Account not found
				isActive = false;
			}
	
		} catch (Exception e) {
			Log.e(LOG_TAG, "Failed to read account status", e);
			isActive = false;
		} finally {
			if (cursor != null) cursor.close();
			if (db != null) db.close();
		}
	
		return isActive;
	}

	private boolean isBlocked(String fromUri) {
		if (fromUri == null) return false;
		List<String> blocked = contactsByTag.get("blocked");
		return blocked != null && blocked.contains(fromUri);
	}

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

        //Log.d(LOG_TAG, "Remote message data: " + data.toString());

        String event = data.get("event");
        String callId = data.get("session-id");
        
        if (event == null || event.trim().isEmpty()) {
			Log.w(LOG_TAG, "Missing event");
			return;
        }

		if (callId == null || callId.trim().isEmpty()) {
			Log.w(LOG_TAG, "Missing call id");
			return;
        }

        Log.d(LOG_TAG, event + " " + callId);

        if (event.equals("incoming_session") || event.equals("incoming_conference_request")) {
			String toUri = data.get("to_uri");
			if (toUri == null || toUri.trim().isEmpty()) {
				Log.w(LOG_TAG, "Missing toUri");
				return;
			}

			if (!isAccountActive(toUri)) {
				Log.w(LOG_TAG, "Account is not active: " + toUri);
				return;
			}

			String fromUri = data.get("from_uri");
			if (fromUri == null || fromUri.trim().isEmpty()) {
				Log.w(LOG_TAG, "Missing fromUri");
				return;
			}

			contactsByTag = getContactsByTag();
	
			if (isBlocked(fromUri)) {
				Log.w(LOG_TAG, "Caller is blocked");
				return;
			}
			
            Intent serviceIntent = new Intent(this, IncomingCallService.class);
            // Pass all FCM data to service
            for (Map.Entry<String, String> entry : data.entrySet()) {
                serviceIntent.putExtra(entry.getKey(), entry.getValue());
            }
            
            serviceIntent.putExtra("phoneLocked", phoneLocked);
			Log.d(LOG_TAG, "phoneLocked: " + phoneLocked);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }

        } else if (event.equals("cancel")) {
			if (IncomingCallService.handledCalls.contains(callId)) {
				Log.d(LOG_TAG, "cancel already handled: " + callId);
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
    
        } else {
            //Log.d(LOG_TAG, "Unhandled event: " + event);
        }
    }
}
