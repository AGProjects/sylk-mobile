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
	private static final String PREF_NAME = "SylkPrefs";

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
			String channelName = "Sylk Messages";

			NotificationManager manager = getSystemService(NotificationManager.class);
			NotificationChannel existing_channel = manager.getNotificationChannel(channelId);
			boolean mustCreate = false;

			if (existing_channel != null) {
				boolean canBypass = existing_channel.canBypassDnd();
				boolean hasBadge = existing_channel.canShowBadge();

				if (!hasBadge || !canBypass) {
					manager.deleteNotificationChannel(channelId);
					mustCreate = true;
				}
			} else {
				mustCreate = true;
			}

            if (!mustCreate) {
				return;	
            }

			mustCreate = true;

			NotificationChannel channel = new NotificationChannel(
				channelId,
				channelName,
				NotificationManager.IMPORTANCE_HIGH
			);

			channel.setShowBadge(true);
			channel.setBypassDnd(true);
			channel.setDescription("Bubble messages");

			if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
				channel.setAllowBubbles(true);
			}

			manager.createNotificationChannel(channel);
			Log.d(LOG_TAG, "Messaging channel was created");
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

	private List<String> getTagsForContact(String account, String uri) {
		List<String> tagsList = null; // null means "contact not found"
	
		try {
			File dbFile = getApplicationContext().getDatabasePath("sylk.db");
			if (!dbFile.exists()) {
				Log.e(LOG_TAG, "Database file not found: " + dbFile.getAbsolutePath());
				return null;
			}
	
			SQLiteDatabase db = SQLiteDatabase.openDatabase(
					dbFile.getPath(),
					null,
					SQLiteDatabase.OPEN_READONLY
			);
	
			Cursor cursor = db.rawQuery(
					"SELECT tags FROM contacts WHERE account = ? AND uri = ?",
					new String[]{ account, uri }
			);
	
			if (cursor != null) {
				if (cursor.moveToFirst()) {
					String tags = cursor.getString(cursor.getColumnIndexOrThrow("tags"));
	
					if (tags != null && !tags.trim().isEmpty()) {
						// Split and trim tags
						String[] raw = tags.split(",");
						tagsList = new ArrayList<>();
						for (String t : raw) {
							String clean = t.trim().toLowerCase();
							if (!clean.isEmpty()) {
								tagsList.add(clean);
							}
						}
					} else {
						// Contact exists but has no tags
						tagsList = new ArrayList<>();
					}
				}
				cursor.close();
			}
	
			db.close();
	
		} catch (Exception e) {
			Log.e(LOG_TAG, "Failed to get tags for contact", e);
		}

		Log.d(LOG_TAG, "Tags for " + uri + ": " + tagsList);

		return tagsList;  
		// null → no contact found
		// empty list → contact exists but no tags
	}
	
	private boolean isAccountActive(String account, String fromUri, List<String> contactTags) {
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
	
			cursor = db.rawQuery(
					"SELECT active, dnd, reject_anonymous, reject_non_contacts FROM accounts WHERE account = ?",
					new String[]{account}
			);
	
			if (cursor != null && cursor.moveToFirst()) {
				isActive = "1".equals(cursor.getString(cursor.getColumnIndexOrThrow("active")));
				isDnd = "1".equals(cursor.getString(cursor.getColumnIndexOrThrow("dnd")));
				rejectAnonymous = "1".equals(cursor.getString(cursor.getColumnIndexOrThrow("reject_anonymous")));
				rejectNonContacts = "1".equals(cursor.getString(cursor.getColumnIndexOrThrow("reject_non_contacts")));
			}
	
		} catch (Exception e) {
			Log.e(LOG_TAG, "Failed to read account status", e);
		} finally {
			if (cursor != null) cursor.close();
			if (db != null) db.close();
		}
	
		if (rejectNonContacts && contactTags == null) {
			Log.e(LOG_TAG, "Only my contacts can call me");
			showRejectedCallNotification(fromUri, "not in contacts list");
			return false;
		}
	
		// Anonymous caller check
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
	
		// Do Not Disturb
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

	private boolean isBlocked(List<String> contactTags) {
		// No tags → contact does not exist → not blocked
		if (contactTags == null) {
			return false;
		}
	
		// Check if "block" tag is present
		for (String tag : contactTags) {
			if (tag != null && tag.equalsIgnoreCase("blocked")) {
				return true;
			}
		}
	
		return false;
	}

	private boolean canBypassDnd(List<String> contactTags) {
		if (contactTags == null) {
			return false;  // No tags → cannot bypass
		}
	
		for (String tag : contactTags) {
			if (tag != null && tag.equalsIgnoreCase("bypassdnd")) {
				return true;
			}
		}
	
		return false;
	}

	private boolean isMuted(List<String> contactTags) {
		// No tags → not muted
		if (contactTags == null) {
			return false;
		}
	
		for (String tag : contactTags) {
			if (tag != null && tag.equalsIgnoreCase("muted")) {
				return true;
			}
		}
	
		return false;
	}

	private boolean isDndEnabled(Context context) {
		NotificationManager manager =
				(NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
	
		if (manager == null) return false;
	
		// If user did NOT grant policy access → you cannot detect DND accurately
		if (!manager.isNotificationPolicyAccessGranted()) {
			// Treat it as OFF (safe fallback)
			return false;
		}
	
		int filter = manager.getCurrentInterruptionFilter();
	
		return filter == NotificationManager.INTERRUPTION_FILTER_NONE ||     // Total silence
			   filter == NotificationManager.INTERRUPTION_FILTER_PRIORITY;   // Priority only (DND ON)
	}

	public static String getLauncherClassName(Context context) {
		Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
		return launchIntent.getComponent().getClassName();
	}

	private int getUnreadForContact(String uri) {
		SharedPreferences prefs = getSharedPreferences("SylkPrefs", MODE_PRIVATE);
		return prefs.getInt("unread_chat_" + uri, 0);
	}
	
	private void incrementUnreadForContact(String uri) {
		SharedPreferences prefs = getSharedPreferences("SylkPrefs", MODE_PRIVATE);
		int current = prefs.getInt("unread_chat_" + uri, 0) + 1;
		Log.d("[SYLK]", "incrementUnreadForContact " + uri + " " + current);
		prefs.edit().putInt("unread_chat_" + uri, current).apply();
	}
	
	public static void setUnreadForContact(Context context, String uri, int count) {
		SharedPreferences prefs = context.getSharedPreferences("SylkPrefs", Context.MODE_PRIVATE);
		Log.d("[SYLK]", "setUnreadForContact " + uri + " " + count);
		prefs.edit().putInt("unread_chat_" + uri, count).apply();
	}
	
	public static int getUnreadForContact(Context context, String uri) {
		SharedPreferences prefs = context.getSharedPreferences("SylkPrefs", Context.MODE_PRIVATE);
		Log.d("[SYLK]", "getUnreadForContact " + uri);
		return prefs.getInt("unread_chat_" + uri, 0);
	}

    public static void resetUnreadForContact(Context context, String uri) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
		Log.d("[SYLK]", "resetUnreadForContact " + uri);
        prefs.edit().putInt("unread_chat_" + uri, 0).apply();
    }
	
	private int getTotalUnreadCount() {
		SharedPreferences prefs = getSharedPreferences("SylkPrefs", MODE_PRIVATE);
	
		int total = 0;
	
		Map<String, ?> all = prefs.getAll();
		for (Map.Entry<String, ?> entry : all.entrySet()) {
			String key = entry.getKey();
	
			// only count keys that belong to unread_chat_<contactUri>
			if (key.startsWith("unread_chat_")) {
				Object value = entry.getValue();
	
				if (value instanceof Integer) {
					total += (Integer) value;
				}
			}
		}
	
		return total;
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

        String lookupAccount = null;
        String callId = null;
        String fromUri = null;
        String toUri = null;

        if (event.equals("incoming_session") || event.equals("incoming_conference_request") || event.equals("cancel")) {
			callId = data.get("session-id");
			if (callId == null || callId.trim().isEmpty()) {
				Log.w(LOG_TAG, "Missing callId");
				return;
			}
			callId = callId.trim();
		}

		SharedPreferences prefs = getApplicationContext().getSharedPreferences("SylkPrefs", Context.MODE_PRIVATE);			

        if (event.equals("incoming_session") || event.equals("incoming_conference_request") || event.equals("message")) {
	        fromUri = data.get("from_uri");
			if (fromUri == null || fromUri.trim().isEmpty()) {
				Log.w(LOG_TAG, "Missing fromUri");
				if (callId != null ) {
					IncomingCallService.handledCalls.add(callId);
				}
				return;
			}

			fromUri = fromUri.trim().toLowerCase();
	
	        if (event.equals("incoming_session")) {
				String activeCall = prefs.getString("currentCall", null);
				if (activeCall != null && activeCall.equals(fromUri)) {
					Log.d("[SYLK]", "Skipping notification: already in call with " + activeCall);
					return;
				}
			}

			toUri = data.get("to_uri");
			if (toUri == null || toUri.trim().isEmpty()) {
				IncomingCallService.handledCalls.add(callId);
				Log.w(LOG_TAG, "Missing toUri");
				return;
			}

			toUri = toUri.trim().toLowerCase();

			if (event.equals("incoming_session")) {
				lookupAccount = toUri;
			}
		}

        if (event.equals("incoming_session") || event.equals("incoming_conference_request")) {
			incomingCalls.add(callId);

			if (event.equals("incoming_conference_request")) {
				String account = data.get("account");
				if (account == null || account.trim().isEmpty()) {
					Log.w(LOG_TAG, "Missing account");
					return;
				}
				lookupAccount = account.trim().toLowerCase();
			}

			Log.d(LOG_TAG, event + " " + callId + " from " + fromUri + " to " + lookupAccount);

            List<String> tags = getTagsForContact(lookupAccount, fromUri);

			if (isBlocked(tags)) {
				IncomingCallService.handledCalls.add(callId);
				Log.w(LOG_TAG, "Caller " + fromUri + " is blocked");
				return;
			}

			if (isMuted(tags)) {
				IncomingCallService.handledCalls.add(callId);
				Log.d("[SYLK]", "Skipping notification: user " + fromUri + " is muted");
				return;
			}

			if (!isAccountActive(lookupAccount, fromUri, tags)) {
				IncomingCallService.handledCalls.add(callId);
				return;
			}
	
			// DND + bypass logic
			boolean dnd = isDndEnabled(this);

			if (dnd && !canBypassDnd(tags)) {
				IncomingCallService.handledCalls.add(callId);
				Log.d("[SYLK]", "DND active, dropping message from " + fromUri);
				return; // notification dropped
			}
			
			if (dnd && canBypassDnd(tags)) {
				Log.d("[SYLK]", "DND bypass for " + fromUri);
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
			stopIntent.setAction("cancel");
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

			Log.w(LOG_TAG, event + " " + messageId + " from " + fromUri);

            List<String> tags = getTagsForContact(toUri, fromUri);

			if (isBlocked(tags)) {
				Log.w(LOG_TAG, "Message from " + fromUri + " is blocked");
				return;
			}

			if (isMuted(tags)) {
				Log.d("[SYLK]", "Skipping notification: user " + fromUri + " is muted");
				return;
			}

			if (!isAccountActive(toUri, fromUri, tags)) {
				Log.w(LOG_TAG, "Message from " + fromUri + " is not allowed");
				return;
			}

			// DND + bypass logic
			boolean dnd = isDndEnabled(this);

			if (dnd && !canBypassDnd(tags)) {
				Log.d("[SYLK]", "DND active, dropping message from " + fromUri);
				return; // notification dropped
			}
			    
			if (dnd && canBypassDnd(tags)) {
				Log.d("[SYLK]", "DND bypass for " + fromUri);
			}

			// inside onMessageReceived or wherever you handle the message
			String activeChat = prefs.getString("currentChat", null);
			
			if (activeChat != null && activeChat.equals(fromUri)) {
				// User is already in this chat, skip showing notification/bubble
				Log.d("[SYLK]", "Skipping notification: user is in chat " + activeChat);
				return;
			}

			// increase unread badge counter
			incrementUnreadForContact(fromUri);
			int unreadCount = getTotalUnreadCount();
			Log.d("[SYLK]", "Badge unread counter:" + unreadCount);
			
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
							.setNumber(unreadCount)
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
