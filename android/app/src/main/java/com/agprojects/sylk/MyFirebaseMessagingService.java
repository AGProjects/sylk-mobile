package com.agprojects.sylk;

import android.content.Intent;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import android.Manifest;
import androidx.core.app.ActivityCompat;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import androidx.core.app.Person;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;

import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.content.Context;
import android.content.SharedPreferences;

import android.net.Uri;

import android.app.KeyguardManager;

import java.util.Map;
import java.util.HashMap;
import java.util.HashSet;
import java.io.File;
import java.util.Set;
import java.util.ArrayList;
import java.util.List;
import java.util.Collections;


public class MyFirebaseMessagingService extends FirebaseMessagingService {

    private static final String LOG_TAG = "[SYLK_FCM]";
	private Map<String, List<String>> contactsByTag = new HashMap<>();
	public static final Set<String> incomingCalls = new HashSet<>();

	private void createNotificationChannel() {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			String channelId = "rejected_calls_channel";
			String channelName = "Rejected Calls";

			NotificationManager manager = getSystemService(NotificationManager.class);
			if (manager != null) {
				NotificationChannel existing = manager.getNotificationChannel(channelId);
				if (existing != null) {
					manager.deleteNotificationChannel(channelId);
					//Log.e(LOG_TAG, "Deleted existing notification channel: " + channelId);
				}

				NotificationChannel channel = new NotificationChannel(
						channelId,
						channelName,
						NotificationManager.IMPORTANCE_HIGH
				);

				channel.setDescription("Notifications for rejected calls");

				manager.createNotificationChannel(channel);
				//Log.e(LOG_TAG, "Notification channel created: "+ channelId);
			}
		}
	}

	private void createMessageChannel() {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			String channelId = "messages_channel";
			NotificationManager manager = getSystemService(NotificationManager.class);
	
			NotificationChannel channel = manager.getNotificationChannel(channelId);
			if (channel == null) {
				channel = new NotificationChannel(
					channelId,
					"Sylk Messages",
					NotificationManager.IMPORTANCE_HIGH
				);
	
				channel.setDescription("Bubble messages");
	
				if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
					channel.setAllowBubbles(true);
				}
	
				manager.createNotificationChannel(channel);
			}
		}
	}
	
	private void showRejectedCallNotification(String fromUri, String reason) {
		String channelId = "rejected_calls_channel";
	
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            Log.e(LOG_TAG, "POST_NOTIFICATIONS permission not granted, cannot show notification");
            return;
        }

		NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
				.setSmallIcon(R.drawable.ic_notification)
				.setContentTitle("Sylk call rejected")
				.setContentText(fromUri + " rejected: " + reason)
				.setPriority(NotificationCompat.PRIORITY_HIGH)
				.setAutoCancel(true);
	
		NotificationManagerCompat manager = NotificationManagerCompat.from(this);
		manager.notify((int) System.currentTimeMillis(), builder.build()); // unique ID
	}

	private Map<String, List<String>> getContactsByTag(String account) {
		Map<String, List<String>> result = new HashMap<>();
		List<String> favorites = new ArrayList<>();
		List<String> blocked = new ArrayList<>();
		List<String> muted = new ArrayList<>();       // NEW
		List<String> autoanswer = new ArrayList<>();
		List<String> allUris = new ArrayList<>();
	
		try {		
			File dbFile = getApplicationContext().getDatabasePath("sylk.db");
			if (!dbFile.exists()) {
				Log.e(LOG_TAG, "Database file not found: " + dbFile.getAbsolutePath());
				result.put("blocked", blocked);
				result.put("muted", muted);              // NEW
				return result;
			}
	
			SQLiteDatabase db = SQLiteDatabase.openDatabase(
					dbFile.getPath(),
					null,
					SQLiteDatabase.OPEN_READONLY
			);
	
			Cursor cursor = db.rawQuery("SELECT uri, tags FROM contacts where account = ?", new String[]{account});
	
			if (cursor != null) {
				while (cursor.moveToNext()) {
					String uri = cursor.getString(cursor.getColumnIndexOrThrow("uri"));
					String tags = cursor.getString(cursor.getColumnIndexOrThrow("tags"));
	
					allUris.add(uri);
					if (tags != null) {
						String lowerTags = tags.toLowerCase();
						if (lowerTags.contains("block")) {
							blocked.add(uri);
						}
						if (lowerTags.contains("mute")) {      // NEW
							muted.add(uri);                     // NEW
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
		result.put("muted", muted);                  // NEW
		result.put("all", allUris);
		return result;
	}
	
	private boolean isAccountActive(String account, String fromUri, Set<String> uniqueUris) {
		if (account == null) return false;
	
		File dbFile = getApplicationContext().getDatabasePath("sylk.db");
		if (!dbFile.exists()) {
			Log.e(LOG_TAG, "Database file not found: " + dbFile.getAbsolutePath());
			return false;
		}
	
		SQLiteDatabase db = null;
		Cursor cursor = null;
		boolean isActive = false;
		boolean isDnd = false;
		boolean rejectAnonymous = false;
		boolean rejectNonContacts = false;
	
		try {
			db = SQLiteDatabase.openDatabase(dbFile.getPath(), null, SQLiteDatabase.OPEN_READONLY);
	
			// Parameterized query to prevent SQL injection
			cursor = db.rawQuery("SELECT * FROM accounts WHERE account = ?", new String[]{account});
	
			if (cursor != null && cursor.moveToFirst()) {
				String activeValue = cursor.getString(cursor.getColumnIndexOrThrow("active"));
				String dndValue = cursor.getString(cursor.getColumnIndexOrThrow("dnd"));
				String rejectAnonymousValue = cursor.getString(cursor.getColumnIndexOrThrow("reject_anonymous"));
				String rejectNonContactsValue = cursor.getString(cursor.getColumnIndexOrThrow("reject_non_contacts"));
				
				isActive = "1".equals(activeValue);
				isDnd = "1".equals(dndValue);
				rejectAnonymous = "1".equals(rejectAnonymousValue);
				rejectNonContacts = "1".equals(rejectNonContactsValue);
			}
	
		} catch (Exception e) {
			Log.e(LOG_TAG, "Failed to read account status", e);
		} finally {
			if (cursor != null) cursor.close();
			if (db != null) db.close();
		}

        if (rejectNonContacts && !uniqueUris.contains(fromUri)) {
			Log.e(LOG_TAG, "Only my contacts can call me");
			showRejectedCallNotification(fromUri, "not in contacts list");
			return false;
		}

		if (fromUri.contains("anonymous") && rejectAnonymous) {
			Log.e(LOG_TAG, "Anonymous caller rejected");
			showRejectedCallNotification(fromUri, "anonymous caller");
			return false;
        }

		if (fromUri.contains("@guest.") && rejectAnonymous) {
			Log.e(LOG_TAG, "Anonymous caller rejected");
			showRejectedCallNotification(fromUri, "anonymous caller");
			return false;
        }
        
		if (isDnd) {
			Log.e(LOG_TAG, "Do not disturb me now");
			showRejectedCallNotification(fromUri, "Do not disturb now");
			return false;
        }

		if (!isActive) {
			Log.e(LOG_TAG, "Account is not active");
			return false;
        }
	
		return true;
	}

	private boolean isBlocked(String fromUri) {
		if (fromUri == null) return false;
		List<String> blocked = contactsByTag.get("blocked");
		return blocked != null && blocked.contains(fromUri);
	}

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        createNotificationChannel();
        createMessageChannel();
    
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
        
        if (event == null || event.trim().isEmpty()) {
			Log.w(LOG_TAG, "Missing event");
			return;
        }

        if (event.equals("incoming_session") || event.equals("incoming_conference_request")) {

			String callId = data.get("session-id");
			incomingCalls.add(callId);

			if (callId == null || callId.trim().isEmpty()) {
				Log.w(LOG_TAG, "Missing call id");
				return;
			}

			callId = callId.trim();
	
			String toUri = data.get("to_uri");
			if (toUri == null || toUri.trim().isEmpty()) {
				IncomingCallService.handledCalls.add(callId);
				Log.w(LOG_TAG, "Missing toUri");
				return;
			}
			
			toUri = toUri.trim().toLowerCase();

			String fromUri = data.get("from_uri");
			if (fromUri == null || fromUri.trim().isEmpty()) {
				Log.w(LOG_TAG, "Missing fromUri");
				IncomingCallService.handledCalls.add(callId);
				return;
			}

            fromUri = fromUri.trim().toLowerCase();

			Log.d(LOG_TAG, event + " " + callId + " from " + fromUri + " to " + toUri);

			Set<String> uniqueUris = new HashSet<>();
            
			if (event.equals("incoming_session")) {
				contactsByTag = getContactsByTag(toUri);
				Map<String, List<String>> contactsByTag = getContactsByTag(toUri); // or toUri if you prefer
				// Get the "all" list from the map
				List<String> allUris = contactsByTag.get("all");
				if (allUris != null) {
					uniqueUris.addAll(allUris); // ✅ add all to the set
				}

				if (!isAccountActive(toUri, fromUri, uniqueUris)) {
					IncomingCallService.handledCalls.add(callId);
					return;
				}
			}
        
            if (event.equals("incoming_conference_request")) {
				String account = data.get("account");
				if (account == null || account.trim().isEmpty()) {
					Log.w(LOG_TAG, "Missing account");
					return;
				}

				account = account.trim().toLowerCase();

				Map<String, List<String>> contactsByTag = getContactsByTag(account);
				List<String> allUris = contactsByTag.get("all");
				if (allUris != null) {
					uniqueUris.addAll(allUris); // ✅ add all to the set
				}

				if (!isAccountActive(account, fromUri, uniqueUris)) {
					IncomingCallService.handledCalls.add(callId);
					return;
				}
            }
	
			if (isBlocked(fromUri)) {
				IncomingCallService.handledCalls.add(callId);
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
			String callId = data.get("session-id");
			if (callId == null || callId.trim().isEmpty()) {
				Log.w(LOG_TAG, "Missing call id");
				return;
			}

			if (!incomingCalls.contains(callId)) {
				Log.d(LOG_TAG, "missing corresponding incoming call " + callId);
				return;
			}

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
        } else if (event.equals("message")) {
			String messageId = data.get("message_id");
			if (messageId == null || messageId.trim().isEmpty()) {
				Log.w(LOG_TAG, "Message error: missing messageId");
				return;
			}

			String fromUri = data.get("from_uri");
			if (fromUri == null || fromUri.trim().isEmpty()) {
				Log.w(LOG_TAG, "Message error: missing from");
				return;
			}

            fromUri = fromUri.trim().toLowerCase();

			Log.w(LOG_TAG, event + " " + messageId + " from " + fromUri);

			String toUri = data.get("to_uri");
			if (toUri == null || toUri.trim().isEmpty()) {
				Log.w(LOG_TAG, "Message error: missing to");
				return;
			}

            toUri = toUri.trim().toLowerCase();

			Set<String> uniqueUris = new HashSet<>();

			contactsByTag = getContactsByTag(toUri);
			Map<String, List<String>> contactsByTag = getContactsByTag(toUri); // or toUri if you prefer
			// Get the "all" list from the map
			List<String> allUris = contactsByTag.get("all");
			if (allUris != null) {
				uniqueUris.addAll(allUris);
			}

			if (!isAccountActive(toUri, fromUri, uniqueUris)) {
				Log.w(LOG_TAG, "Message from " + fromUri + " is not allowed");
				return;
			}

			if (isBlocked(fromUri)) {
				Log.w(LOG_TAG, "Message from " + fromUri + " is blocked");
				return;
			}

			// NEW: check if muted
			List<String> muted = contactsByTag.get("muted");
			if (muted != null && muted.contains(fromUri)) {
				Log.d("[SYLK]", "Skipping notification: user " + fromUri + " is muted");
				return;
			}

			// inside onMessageReceived or wherever you handle the message
			SharedPreferences prefs = getApplicationContext().getSharedPreferences("SylkPrefs", Context.MODE_PRIVATE);			
			String activeChat = prefs.getString("currentChat", null);
			
			if (activeChat != null && activeChat.equals(fromUri)) {
				// User is already in this chat, skip showing notification/bubble
				Log.d("[SYLK]", "Skipping notification: user is in chat " + activeChat);
				return;
			}
			
			String content = data.get("content");
			String contentType = data.get("content_type");

			// ----- CHANNEL -----
			String channelId = "messages_channel";
			
			// ----- INTENT -----
			Intent intent = new Intent(this, MainActivity.class);
			intent.setAction(Intent.ACTION_VIEW);
			intent.setData(Uri.parse("sylk://message/incoming/" + fromUri));
			intent.putExtra("fromUri", fromUri);
			intent.putExtra("id", messageId);
			intent.putExtra("content", content);
			intent.putExtra("contentType", contentType);
			
			intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
			
			// ----- PENDING INTENTS -----
			PendingIntent tapIntent = PendingIntent.getActivity(
					this,
					messageId.hashCode(),
					intent,
					PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
			);
			
			// IMPORTANT: Bubble requires MUTABLE PI
			PendingIntent bubbleIntent = PendingIntent.getActivity(
					this,
					("bubble_" + fromUri).hashCode(),
					intent,
					PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
			);
			
			// ----- PERSON -----
			Person person = new Person.Builder()
					.setName(fromUri)
					.build();
			
			// ----- SHORTCUT -----
			String shortcutId = "chat_" + fromUri.replaceAll("[^a-zA-Z0-9_]", "_");
			ShortcutManager shortcutManager = getSystemService(ShortcutManager.class);
			
			if (shortcutManager != null) {
				// Remove existing shortcut for this chat if present
				boolean exists = false;
				for (ShortcutInfo sc : shortcutManager.getDynamicShortcuts()) {
					if (sc.getId().equals(shortcutId)) {
						exists = true;
						break;
					}
				}
				if (exists) {
					ShortcutManagerCompat.removeDynamicShortcuts(this, Collections.singletonList(shortcutId));
				}
			
				// Build and push the shortcut
				ShortcutInfoCompat shortcut = new ShortcutInfoCompat.Builder(this, shortcutId)
						.setShortLabel("New message")
						.setLongLabel("Message from " + fromUri)
						.setIntent(intent)
						.setIcon(IconCompat.createWithResource(this, R.drawable.ic_notification))
						.build();
			
				ShortcutManagerCompat.pushDynamicShortcut(this, shortcut);
			}

			
			// ----- MESSAGING STYLE -----
			NotificationCompat.MessagingStyle style =
				new NotificationCompat.MessagingStyle(person)
                .setConversationTitle("") // keeps first line clean
                .setGroupConversation(false)
                .addMessage("Message from " + fromUri, System.currentTimeMillis(), fromUri);

			
			// ----- BUBBLE METADATA -----
			NotificationCompat.BubbleMetadata bubbleData = null;
			if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
				bubbleData = new NotificationCompat.BubbleMetadata.Builder(
						bubbleIntent,
						IconCompat.createWithResource(this, R.drawable.ic_notification)
				)
						.setDesiredHeight(600)
						.setAutoExpandBubble(true)
						.setSuppressNotification(false)
						.build();
			}
			
			// ----- BUILD NOTIFICATION -----
			NotificationCompat.Builder builder =
					new NotificationCompat.Builder(this, channelId)
							.setSmallIcon(R.drawable.ic_notification)
							.setContentTitle("New message") // header
							.setContentText("Message from " + fromUri) // second line
							.setAutoCancel(true)
							.setPriority(NotificationCompat.PRIORITY_HIGH)
							.setStyle(style)
							.setContentIntent(tapIntent)
							.setBubbleMetadata(bubbleData)
							.setShortcutId(shortcutId)
							.setCategory(NotificationCompat.CATEGORY_MESSAGE)
							.setVisibility(NotificationCompat.VISIBILITY_PRIVATE);
			
			// ----- SEND -----
			int nid = (int) System.currentTimeMillis();
			NotificationManagerCompat.from(this).notify(nid, builder.build());
			

			
    
        } else {
            Log.d(LOG_TAG, "Unhandled event: " + event);
        }
    }
}
