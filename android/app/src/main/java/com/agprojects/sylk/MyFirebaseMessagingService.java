package com.agprojects.sylk;

import android.content.Intent;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import com.facebook.react.ReactApplication;

import android.Manifest;
import androidx.core.app.ActivityCompat;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import androidx.core.app.Person;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
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
import android.database.sqlite.SQLiteDatabaseLockedException;
import android.database.sqlite.SQLiteException;
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
import java.util.UUID;

import org.json.JSONException;
import org.json.JSONObject;

import com.agprojects.sylk.Contact;

public class MyFirebaseMessagingService extends FirebaseMessagingService {

    private static final String LOG_TAG = "SYLK_APP";
	private Map<String, List<String>> contactsByTag = new HashMap<>();
	public static final Set<String> incomingCalls = new HashSet<>();
	private static final String PREF_NAME = "SylkPrefs";

	// Throttle message notifications per sender: at most one visible
	// notification per THROTTLE_NOTIFICATION_MS milliseconds.
	private static final long THROTTLE_NOTIFICATION_MS = 15_000L;
	private static final String LAST_NOTIF_PREFIX = "last_notif_";

	// Channel for both server-side rejected-call notifications AND the
	// silent missed-call notifications posted when an incoming push is
	// dropped on purpose (in-conference, app DND, OS DND).
	//
	// IMPORTANCE_LOW + setBypassDnd(true) so the entry appears on the
	// shade and lockscreen WHILE OS DND is on (the whole point of the
	// DND-drop missed-call notif), without ringing or heads-up.
	//
	// Channel id is bumped to "_v2" because Android caches user-visible
	// channel preferences after first creation — toggling setBypassDnd /
	// importance on an existing channel id is a no-op. A new id starts
	// fresh.
	public static final String REJECTED_CALLS_CHANNEL_ID = "rejected_calls_channel_v2";

	private void createNotificationChannel() {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			NotificationManager manager = getSystemService(NotificationManager.class);
			if (manager == null) return;

			// Tear down the legacy IMPORTANCE_HIGH channel once. Idempotent.
			manager.deleteNotificationChannel("rejected_calls_channel");

			if (manager.getNotificationChannel(REJECTED_CALLS_CHANNEL_ID) != null) return;

			NotificationChannel channel = new NotificationChannel(
					REJECTED_CALLS_CHANNEL_ID,
					"Missed / rejected calls",
					NotificationManager.IMPORTANCE_LOW
			);
			channel.setDescription("Missed-call entries (DND, in conference) and server-side rejected calls");
			channel.setBypassDnd(true);
			channel.setSound(null, null);
			channel.enableVibration(false);
			channel.enableLights(false);

			manager.createNotificationChannel(channel);
			SylkLogger.d("[call] [fcm] Rejected/missed-calls channel created (" + REJECTED_CALLS_CHANNEL_ID + ")");
		}
	}

	private void createMessageChannel() {
		ensureMessageChannel(this);
	}

	// Dedicated low-importance channel for the silent badge-driver
	// notifications. IMPORTANCE_MIN is the only level Android guarantees
	// will NOT raise a status-bar icon or shade alert — even
	// PRIORITY_LOW + setSilent(true) on an IMPORTANCE_HIGH channel
	// still produced visible "phantom push" entries on the user's
	// shade after every restart, because notification visibility is
	// gated by the channel's importance, not the per-notification
	// priority. This channel keeps setShowBadge(true) so the launcher
	// dot/count still updates from setNumber().
	public static void ensureBadgeChannel(Context context) {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			String channelId = "messages_badge_channel";
			String channelName = "Sylk Unread Badge";

			NotificationManager manager = context.getSystemService(NotificationManager.class);
			if (manager == null) return;
			NotificationChannel existing = manager.getNotificationChannel(channelId);
			if (existing != null) return;

			NotificationChannel channel = new NotificationChannel(
				channelId,
				channelName,
				NotificationManager.IMPORTANCE_MIN
			);
			channel.setShowBadge(true);
			channel.setDescription("Keeps the app icon badge in sync with unread messages");
			channel.setSound(null, null);
			channel.enableVibration(false);
			channel.enableLights(false);
			manager.createNotificationChannel(channel);
			SylkLogger.d("[call] [fcm] Badge-only channel was created");
		}
	}

	// Static so setUnreadForContact (called from JS via UnreadModule) can
	// guarantee the channel exists before posting the silent badge-driver
	// notification. Previously the channel was only ever created from
	// onMessageReceived, so any flow that bypassed FCM (e.g. WS-delivered
	// message processed by JS in the foreground while FCM was simultaneously
	// dropping its delivery on a SQL lock) had nowhere to post a badge from.
	// Bumped to v2 because re-creating the legacy "messages_channel" with
	// setShowBadge(false) was unreliable: deleteNotificationChannel +
	// createNotificationChannel does not always reset user-visible
	// preferences (e.g. "Show notification dot" toggled in system Settings),
	// and Motorola's ROM appears to cache the prior setShowBadge=true
	// regardless. A brand-new channel id has no legacy state and starts
	// with the desired setShowBadge(false) baseline. The legacy
	// "messages_channel" is explicitly deleted below so it doesn't linger
	// in the app's Notification settings UI.
	public static final String MESSAGES_CHANNEL_ID = "messages_channel_v2";

	public static void ensureMessageChannel(Context context) {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			String channelId = MESSAGES_CHANNEL_ID;
			String channelName = "Sylk Messages";

			NotificationManager manager = context.getSystemService(NotificationManager.class);
			if (manager == null) return;

			// Tear down the legacy channel once. Idempotent — if it's
			// already gone the call is a no-op.
			manager.deleteNotificationChannel("messages_channel");

			NotificationChannel existing_channel = manager.getNotificationChannel(channelId);
			if (existing_channel != null) {
				return;
			}

			NotificationChannel channel = new NotificationChannel(
				channelId,
				channelName,
				NotificationManager.IMPORTANCE_HIGH
			);

			// IMPORTANT: showBadge OFF on this channel. The launcher icon
			// badge is owned by `messages_badge_channel`'s single global
			// summary (refreshGlobalBadge), which carries the authoritative
			// setNumber(total). Leaving showBadge=true here meant Motorola's
			// launcher counted each per-contact loud notification on
			// messages_channel as +1 IN ADDITION to the summary's
			// setNumber, inflating the icon count by one per active
			// contact.
			channel.setShowBadge(false);
			channel.setBypassDnd(true);
			channel.setDescription("Bubble messages");

			if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
				channel.setAllowBubbles(true);
			}

			manager.createNotificationChannel(channel);
			SylkLogger.d("[call] [fcm] Messaging channel was created");
		}
	}
	
	private void showRejectedCallNotification(String fromUri, String reason) {
		String channelId = REJECTED_CALLS_CHANNEL_ID;
	
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            SylkLogger.e("[call] [fcm] POST_NOTIFICATIONS permission not granted, cannot show notification");
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

	/**
	 * Silent local notification used when an incoming-call-style push
	 * (1-1 audio/video or conference invite) is dropped because the
	 * user is unavailable for some app-controlled reason — currently:
	 *   - already mid-conference (reasonText "you were in a conference"),
	 *   - app DND on   (reasonText "Do Not Disturb"),
	 *   - OS DND on    (reasonText "system Do Not Disturb").
	 * Posted on the same "rejected_calls_channel" we already publish
	 * server-side rejects through — silent (no ringtone, no full-screen
	 * intent), just a normal-priority entry the user sees on their
	 * lockscreen / shade so they can call back / join afterwards.
	 */
	// Static so it can be called from the WSS-delivered call path via
	// SylkBridge as well as from the FCM-delivered push path. The channel
	// is IMPORTANCE_LOW + setBypassDnd(true), so the notification appears
	// on the shade/lockscreen even while OS DND is on, without ringing.
	public static void showSuppressedCallNotification(Context context, String fromUri, String event, String reasonText) {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
				ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
					!= PackageManager.PERMISSION_GRANTED) {
			SylkLogger.e("[call] [fcm] POST_NOTIFICATIONS not granted — cannot show suppressed-call notif (" + reasonText + ")");
			return;
		}

		boolean isConfInvite = "incoming_conference_request".equals(event);
		boolean isDnd = reasonText != null && reasonText.toLowerCase().contains("do not disturb");
		String who = (fromUri != null && !fromUri.isEmpty()) ? fromUri : "Unknown";
		// Compact, consistent titles for both suppression paths:
		//   DND drop          → "Missed call during DND period"
		//   In-conference drop → "Missed call during conference"
		// "Missed invite during …" replaces "Missed call …" when the event
		// is a conference invite. The body is just the caller URI; the
		// reason is already conveyed by the title.
		// Title mapping:
		//   DND  + call   → "Missed call (Do not disturb)"
		//   DND  + invite → "Missed conference (Do not disturb)"
		//   conf + call   → "Missed call (In conference)"
		//   conf + invite → "Missed conference (Already in)"
		String title;
		if (isDnd) {
			title = isConfInvite ? "Missed conference (Do not disturb)" : "Missed call (Do not disturb)";
		} else {
			title = isConfInvite ? "Missed conference (Already in)" : "Missed call (In conference)";
		}
		String body = who;

		NotificationCompat.Builder builder = new NotificationCompat.Builder(context, REJECTED_CALLS_CHANNEL_ID)
				.setSmallIcon(R.drawable.ic_notification)
				.setContentTitle(title)
				.setContentText(body)
				.setPriority(NotificationCompat.PRIORITY_LOW)
				.setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
				.setAutoCancel(true)
				.setSound(null)
				.setVibrate(new long[]{0L});

		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
			builder.setSilent(true);
		}

		NotificationManagerCompat.from(context).notify((int) System.currentTimeMillis(), builder.build());
		SylkLogger.d("[call] [fcm] Posted silent missed-call notification: " + title + " — " + body);
	}

	// Instance overload kept so the existing FCM-path call sites don't change.
	private void showSuppressedCallNotification(String fromUri, String event, String reasonText) {
		showSuppressedCallNotification(this, fromUri, event, reasonText);
	}

	// Back-compat thin wrapper — preserves the original in-conference call site.
	private void showInConferenceMissedCallNotification(String fromUri, String event) {
		showSuppressedCallNotification(fromUri, event, "you were in a conference");
	}

	private Contact getContact(String account, String uri) {
		// Display-name / tag lookup for the incoming caller. Non-critical:
		// if it fails we just fall back to using the SIP URI as the display
		// name and treat the contact as untagged (not blocked, not muted).
		// We deliberately do NOT retry on SQLITE_BUSY here — the JS thread
		// can hold the DB lock for several seconds during contact/message
		// writes, and burning that time before the call rings caused the
		// notification to land long after the caller had already cancelled
		// (~30s in production logs). Fail open immediately and let the call
		// reach the user without a friendly name.
		File dbFile = getApplicationContext().getDatabasePath("sylk.db");
		if (!dbFile.exists()) {
			SylkLogger.e("[call] [fcm] Database file not found: " + dbFile.getAbsolutePath());
			return null;
		}
	
		Contact contact = null;
		SQLiteDatabase db = null;
		Cursor cursor = null;
		try {
			db = SQLiteDatabase.openDatabase(dbFile.getPath(), null, SQLiteDatabase.OPEN_READONLY);
			String sql =
					"SELECT name, tags FROM contacts " +
					"WHERE account = ? AND (" +
					"uri = ? OR " +
					"uris = ? OR " +
					"uris LIKE ? OR " +
					"uris LIKE ? OR " +
					"uris LIKE ?" +
					")";
			String likeStart = uri + ",%";
			String likeMiddle = "%," + uri + ",%";
			String likeEnd = "%," + uri;
			cursor = db.rawQuery(sql, new String[]{ account, uri, uri, likeStart, likeMiddle, likeEnd });
			if (cursor != null && cursor.moveToFirst()) {
				String name = cursor.getString(cursor.getColumnIndexOrThrow("name"));
				String tagsRaw = cursor.getString(cursor.getColumnIndexOrThrow("tags"));
				List<String> tagsList = new ArrayList<>();
				if (tagsRaw != null && !tagsRaw.trim().isEmpty()) {
					String[] raw = tagsRaw.split(",");
					for (String t : raw) {
						String clean = t.trim().toLowerCase();
						if (!clean.isEmpty()) {
							tagsList.add(clean);
						}
					}
				}
				contact = new Contact(name, tagsList);
			}
		} catch (SQLiteDatabaseLockedException locked) {
			SylkLogger.w("[call] [fcm] getContact: DB locked — skipping name lookup, using URI");
		} catch (SQLiteException sqlEx) {
			String msg = sqlEx.getMessage();
			if (msg != null && msg.contains("SQLITE_BUSY")) {
				SylkLogger.w("[call] [fcm] getContact: DB busy — skipping name lookup");
			} else {
				SylkLogger.e("[call] [fcm] getContact: SQLite error", sqlEx);
			}
		} catch (Exception e) {
			SylkLogger.e("[call] [fcm] Failed to get contact", e);
		} finally {
			if (cursor != null) { try { cursor.close(); } catch (Exception ignore) {} }
			if (db != null) { try { db.close(); } catch (Exception ignore) {} }
		}
		return contact;
	}
	
	private boolean isAccountActive(String account, String fromUri, List<String> contactTags) {
		if (account == null) return false;
	
		File dbFile = getApplicationContext().getDatabasePath("sylk.db");
		if (!dbFile.exists()) {
			SylkLogger.e("[call] [fcm] Database file not found: " + dbFile.getAbsolutePath());
			return false;
		}
	
		// Single-shot read with NO retries. Earlier we did exponential
		// backoff retries (50/100/200/400ms) here, but observed in
		// production that each retry took ~3s because the JS thread holds
		// the DB lock for that long during contact/message writes — total
		// wait stretched to ~30s, well past the caller's patience. Better
		// to fail-open immediately on lock and ring the call than to
		// honour DND/reject preferences late. The JS handler can re-check
		// preferences once the user reaches an answer/decline action.
		boolean isActive = false;
		boolean isDnd = false;
		boolean rejectAnonymous = false;
		boolean rejectNonContacts = false;
		boolean readOk = false;
	
		SQLiteDatabase db = null;
		Cursor cursor = null;
		try {
			db = SQLiteDatabase.openDatabase(dbFile.getPath(), null, SQLiteDatabase.OPEN_READONLY);
			// Privacy flags (dnd / rejectAnonymous / rejectNonContacts)
			// live inside accounts.settings as a JSON blob:
			//   { "privacy": { "dnd": bool, "rejectAnonymous": bool,
			//                  "rejectNonContacts": bool, ... }, ... }
			// We pull the raw text and parse it with org.json.JSONObject.
			//
			// The `settings` column is guaranteed to exist by the JS
			// boot path (upgradeSQLTables -> ensureColumn pair), so we
			// no longer carry a fallback to the legacy per-column
			// query. If a push arrives before JS has ever booted on a
			// newly-installed build, the SQLiteException handlers
			// below fail open the same way they would for any other
			// transient SQL error.
			cursor = db.rawQuery(
					"SELECT active, settings FROM accounts WHERE account = ?",
					new String[]{account}
			);
			if (cursor != null && cursor.moveToFirst()) {
				isActive = "1".equals(cursor.getString(cursor.getColumnIndexOrThrow("active")));

				String settingsJson = cursor.getString(cursor.getColumnIndexOrThrow("settings"));
				if (settingsJson != null && !settingsJson.isEmpty()) {
					try {
						JSONObject root = new JSONObject(settingsJson);
						JSONObject privacy = root.optJSONObject("privacy");
						if (privacy != null) {
							isDnd            = privacy.optBoolean("dnd",               false);
							rejectAnonymous  = privacy.optBoolean("rejectAnonymous",   false);
							rejectNonContacts= privacy.optBoolean("rejectNonContacts", false);
						}
					} catch (JSONException jsonEx) {
						SylkLogger.w("[call] [fcm] settings JSON parse failed — failing open", jsonEx);
					}
				}
				SylkLogger.d("[fcm] account flags (from settings JSON): active=" + isActive
					+ " dnd=" + isDnd
					+ " rejectAnonymous=" + rejectAnonymous
					+ " rejectNonContacts=" + rejectNonContacts);
			}
			readOk = true;
		} catch (SQLiteDatabaseLockedException locked) {
			SylkLogger.w("[call] [fcm] isAccountActive: DB locked — failing open immediately so call rings");
		} catch (SQLiteException sqlEx) {
			String msg = sqlEx.getMessage();
			if (msg != null && msg.contains("SQLITE_BUSY")) {
				SylkLogger.w("[call] [fcm] isAccountActive: DB busy — failing open immediately so call rings");
			} else {
				SylkLogger.e("[call] [fcm] isAccountActive: SQLite error", sqlEx);
			}
		} catch (Exception e) {
			SylkLogger.e("[call] [fcm] Failed to read account status", e);
		} finally {
			if (cursor != null) { try { cursor.close(); } catch (Exception ignore) {} }
			if (db != null) { try { db.close(); } catch (Exception ignore) {} }
		}
	
		// If we never got a definitive read, fail OPEN so the user is
		// presented with the call. We do NOT honour rejectNonContacts /
		// rejectAnonymous / DND in this fail-open path — those preferences
		// can be re-evaluated by the JS handler once the DB is free.
		if (!readOk) {
			SylkLogger.w("[call] [fcm] isAccountActive: bypassing rejection checks for " + fromUri
				+ " due to DB lock — call will ring");
			return true;
		}
	
		if (rejectNonContacts && contactTags == null) {
			SylkLogger.e("[call] [fcm] Only my contacts can call me");
			showRejectedCallNotification(fromUri, "not in contacts list");
			return false;
		}
	
		// Anonymous caller check
		if (fromUri.contains("anonymous") && rejectAnonymous) {
			SylkLogger.e("[call] [fcm] Anonymous caller rejected");
			showRejectedCallNotification(fromUri, "anonymous caller");
			return false;
		}
	
		if (fromUri.contains("@guest.") && rejectAnonymous) {
			SylkLogger.e("[call] [fcm] Anonymous caller rejected");
			showRejectedCallNotification(fromUri, "anonymous caller");
			return false;
		}
	
		// App DND (privacy.dnd in accounts.settings JSON) is NOT enforced
		// here. The caller (onMessageReceived) re-reads the same flag via
		// isAppDndOn() and, when active without a per-contact bypassdnd,
		// drops the push and surfaces a silent "Missed call … (Do Not
		// Disturb)" notification on rejected_calls_channel — same shape
		// as the in-conference drop and the OS-DND drop. Keeping the
		// enforcement in onMessageReceived (rather than here) means a
		// single code path posts the missed-call notification for every
		// DND flavour. (isDnd is intentionally left read above so the
		// log line above continues to show the current value for
		// diagnostics.)
	
		if (!isActive) {
			SylkLogger.e("[call] [fcm] Account is not active");
			return false;
		}

		return true;
	}

	/**
	 * Read the configured SIP-focus bridge host for a given account
	 * from the accounts.settings JSON blob in sylk.db. JS persists it
	 * under conference.sipBridge whenever initConfiguration ingests
	 * fresh server config (see applySipBridgeDomain in app.js).
	 *
	 * Used by onMessageReceived to drop the duplicate
	 * "incoming_session" push that the conference focus SIP-dials in
	 * parallel with the real "incoming_conference_request" — same
	 * dedupe as iOS. Mirrors the privacy.dnd / rejectAnonymous /
	 * rejectNonContacts read pattern already used in isAccountActive
	 * above — same DB path, same SELECT, same JSONObject parse — just
	 * pulling a different key out of the dictionary.
	 *
	 * Returns null when the row is missing, the JSON is malformed,
	 * the DB is locked, or conference.sipBridge isn't set. Callers
	 * treat null as "dedupe disabled" (safe default — push still
	 * rings).
	 */
	private String readSipBridgeDomainForAccount(String account) {
		if (account == null || account.isEmpty()) return null;

		File dbFile = getApplicationContext().getDatabasePath("sylk.db");
		if (!dbFile.exists()) {
			SylkLogger.w("[call] [fcm] readSipBridgeDomain: database file not found");
			return null;
		}

		String sipBridge = null;
		SQLiteDatabase db = null;
		Cursor cursor = null;
		try {
			db = SQLiteDatabase.openDatabase(dbFile.getPath(), null, SQLiteDatabase.OPEN_READONLY);
			cursor = db.rawQuery(
					"SELECT settings FROM accounts WHERE account = ?",
					new String[]{account}
			);
			if (cursor != null && cursor.moveToFirst()) {
				String settingsJson = cursor.getString(cursor.getColumnIndexOrThrow("settings"));
				if (settingsJson != null && !settingsJson.isEmpty()) {
					try {
						JSONObject root = new JSONObject(settingsJson);
						JSONObject conference = root.optJSONObject("conference");
						if (conference != null) {
							String raw = conference.optString("sipBridge", null);
							if (raw != null) {
								String trimmed = raw.trim().toLowerCase();
								if (!trimmed.isEmpty()) sipBridge = trimmed;
							}
						}
					} catch (JSONException jsonEx) {
						SylkLogger.w("[call] [fcm] readSipBridgeDomain: settings JSON parse failed", jsonEx);
					}
				}
			}
		} catch (SQLiteDatabaseLockedException locked) {
			SylkLogger.w("[call] [fcm] readSipBridgeDomain: DB locked — dedupe disabled for this push");
		} catch (SQLiteException sqlEx) {
			SylkLogger.w("[call] [fcm] readSipBridgeDomain: SQLite error", sqlEx);
		} catch (Exception e) {
			SylkLogger.e("[call] [fcm] readSipBridgeDomain: failed", e);
		} finally {
			if (cursor != null) { try { cursor.close(); } catch (Exception ignore) {} }
			if (db != null) { try { db.close(); } catch (Exception ignore) {} }
		}

		return sipBridge;
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

	/**
	 * Read the in-app DND flag (privacy.dnd in accounts.settings JSON)
	 * for the given account. Returns false if the row is missing, the
	 * JSON is malformed, the DB is locked, or anything else goes wrong
	 * — same fail-open posture as isAccountActive. Mirrors exactly the
	 * read isAccountActive does so the two paths can't disagree.
	 */
	private boolean isAppDndOn(String account) {
		if (account == null || account.isEmpty()) return false;

		File dbFile = getApplicationContext().getDatabasePath("sylk.db");
		if (!dbFile.exists()) {
			return false;
		}

		SQLiteDatabase db = null;
		Cursor cursor = null;
		try {
			db = SQLiteDatabase.openDatabase(dbFile.getPath(), null, SQLiteDatabase.OPEN_READONLY);
			cursor = db.rawQuery(
					"SELECT settings FROM accounts WHERE account = ?",
					new String[]{account}
			);
			if (cursor != null && cursor.moveToFirst()) {
				String settingsJson = cursor.getString(cursor.getColumnIndexOrThrow("settings"));
				if (settingsJson != null && !settingsJson.isEmpty()) {
					JSONObject root = new JSONObject(settingsJson);
					JSONObject privacy = root.optJSONObject("privacy");
					if (privacy != null) {
						return privacy.optBoolean("dnd", false);
					}
				}
			}
		} catch (Exception e) {
			SylkLogger.w("[call] [fcm] isAppDndOn: read failed (failing OFF) — " + e.getMessage());
		} finally {
			if (cursor != null) { try { cursor.close(); } catch (Exception ignore) {} }
			if (db != null) { try { db.close(); } catch (Exception ignore) {} }
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

	private boolean isAppInForeground() {
		// Sanity gate via the OS process state. MyFirebaseMessagingService
		// has no `android:process` attribute in the manifest, so it shares
		// the same process as the main React Native activity. That makes
		// ActivityManager.getMyMemoryState() a reliable signal here —
		// despite the older comment that claimed otherwise:
		//
		//   - Before swipe-kill: process holds the foreground activity →
		//     IMPORTANCE_FOREGROUND (or VISIBLE if the user just pulled
		//     down the notification shade).
		//   - After swipe-kill: Android spawns a fresh process to run
		//     the FCM service. Its importance is IMPORTANCE_FOREGROUND_SERVICE
		//     (the service is what triggered the spawn) — NOT
		//     IMPORTANCE_FOREGROUND. Crucially, the stale `appActive=true`
		//     SharedPreferences flag left behind by the previous run is
		//     still there, and the old logic blindly trusted it,
		//     producing the "JS-reported appActive=true" log line even
		//     though the activity had been swiped out.
		//
		// So: ask the OS first. If we are not in a UI-visible bucket,
		// JS cannot be running regardless of any stale flag, and we
		// clear the flag so subsequent reads elsewhere don't lie either.
		android.app.ActivityManager.RunningAppProcessInfo proc =
				new android.app.ActivityManager.RunningAppProcessInfo();
		android.app.ActivityManager.getMyMemoryState(proc);
		boolean osForeground =
				proc.importance == android.app.ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
				|| proc.importance == android.app.ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE;

		SharedPreferences prefs = getSharedPreferences("SylkPrefs", MODE_PRIVATE);

		if (!osForeground) {
			boolean staleFlag = prefs.contains("appActive") && prefs.getBoolean("appActive", false);
			SylkLogger.d("[fcm] isAppInForeground: OS importance=" + proc.importance
					+ " (not FOREGROUND/VISIBLE) — treating as background"
					+ (staleFlag ? " (cleared stale appActive=true left behind by swipe-kill)" : ""));
			if (prefs.contains("appActive")) {
				prefs.edit().remove("appActive").apply();
			}
			return false;
		}

		// OS says a UI activity is up. Trust the JS-reported flag now —
		// JS distinguishes AppState 'active' from 'inactive' (e.g.
		// notification shade pulled down) which both look the same to
		// the OS importance buckets.
		if (prefs.contains("appActive")) {
			boolean jsActive = prefs.getBoolean("appActive", false);
			SylkLogger.d("[fcm] isAppInForeground: OS=foreground, JS-reported appActive=" + jsActive);
			return jsActive;
		}

		// OS says foreground but JS hasn't reported yet (first boot
		// before AppState listener attached). Default to true so we
		// don't double-process a message that JS is about to handle
		// over the websocket.
		SylkLogger.d("[fcm] isAppInForeground: OS=foreground, no JS flag yet — defaulting to true");
		return true;
	}

	private long getLastNotificationTime(String uri) {
		SharedPreferences prefs = getSharedPreferences(PREF_NAME, MODE_PRIVATE);
		return prefs.getLong(LAST_NOTIF_PREFIX + uri, 0L);
	}

	private void setLastNotificationTime(String uri, long timestamp) {
		SharedPreferences prefs = getSharedPreferences(PREF_NAME, MODE_PRIVATE);
		prefs.edit().putLong(LAST_NOTIF_PREFIX + uri, timestamp).apply();
	}

	private boolean shouldThrottleNotification(String uri) {
		long last = getLastNotificationTime(uri);
		if (last == 0L) {
			return false;
		}
		long elapsed = System.currentTimeMillis() - last;
		return elapsed < THROTTLE_NOTIFICATION_MS;
	}

	private int getUnreadForContact(String uri) {
		SharedPreferences prefs = getSharedPreferences("SylkPrefs", MODE_PRIVATE);
		return prefs.getInt("unread_chat_" + uri, 0);
	}
	
	private void incrementUnreadForContact(String uri) {
		SharedPreferences prefs = getSharedPreferences("SylkPrefs", MODE_PRIVATE);
		int current = prefs.getInt("unread_chat_" + uri, 0) + 1;
		SylkLogger.d("[fcm] incrementUnreadForContact " + uri + " " + current);
		prefs.edit().putInt("unread_chat_" + uri, current).apply();
	}

	/**
	 * Derive a friendly display name from a SIP URI when the push payload
	 * does not carry from_display_name. Mirrors newContact() in app.js:
	 * 'john.doe@host' → 'John Doe'. Phone-number usernames are left as-is.
	 */
	private static String deriveDisplayNameFromUri(String uri) {
		if (uri == null) return "";
		int at = uri.indexOf('@');
		String user = at > 0 ? uri.substring(0, at) : uri;
		if (user.isEmpty()) return uri;
		// All digits / +digits → phone number, keep verbatim.
		if (user.matches("^\\+?[0-9]+$")) return user;
		String[] parts = user.split("[._-]+");
		StringBuilder sb = new StringBuilder();
		for (int i = 0; i < parts.length; i++) {
			String p = parts[i];
			if (p.isEmpty()) continue;
			if (sb.length() > 0) sb.append(' ');
			sb.append(Character.toUpperCase(p.charAt(0)));
			if (p.length() > 1) sb.append(p.substring(1).toLowerCase());
		}
		String out = sb.toString().trim();
		return out.isEmpty() ? user : out;
	}

	/**
	 * Persist an incoming push message directly into sylk.db so the RN
	 * app finds it on the next chat open — no in-app payload fetch
	 * required. Mirrors the schema saveIncomingMessage / saveSylkContact
	 * write from JS (see app.js initSQL / createTables).
	 *
	 *   - INSERT OR IGNORE into contacts so a brand-new sender renders
	 *     with a friendly display name when WS hasn't delivered yet.
	 *     The PRIMARY KEY (account, contact_id) is a UUID; we only seed
	 *     a row when no existing contact matches (account, uri).
	 *   - INSERT OR IGNORE into messages with the 16-column shape
	 *     saveIncomingMessage uses. PRIMARY KEY (account, msg_id)
	 *     dedupes against the eventual WS / journal arrival.
	 *
	 * PGP-enveloped bodies are stored verbatim with encrypted=1 — JS
	 * holds the private key and decrypts at render time. Failures are
	 * swallowed: a push that can't be persisted still gets a
	 * notification, and the WS path will eventually backfill SQL.
	 */
	private void insertIncomingMessageToSql(String account,
											String fromUri,
											String messageId,
											String content,
											String contentType,
											String fromDisplayName) {
		if (account == null || account.isEmpty()
				|| fromUri == null || fromUri.isEmpty()
				|| messageId == null || messageId.isEmpty()) {
			SylkLogger.w("[message] [fcm] insertIncomingMessageToSql: missing required fields");
			return;
		}

		File dbFile = getApplicationContext().getDatabasePath("sylk.db");
		if (!dbFile.exists()) {
			SylkLogger.w("[message] [fcm] insertIncomingMessageToSql: database file not found");
			return;
		}

		// Detect PGP envelope. JS uses the same string check
		// (indexOf '-----BEGIN PGP MESSAGE-----' / '-----END PGP MESSAGE-----')
		// to drive its encrypted column value. We can't decrypt natively —
		// the private key lives in JS state — so we just preserve the
		// ciphertext and let getMessages handle decrypt-on-render.
		// Mirror the JS-side arrival entry (app.js:
		// "[message] handleIncomingMessage <id> from <uri> <contentType>")
		// so APPLOG reads identically whether the message arrived via push
		// or via the websocket.
		SylkLogger.d("[message] handleIncomingMessage " + messageId
				+ " from " + fromUri
				+ " " + (contentType == null ? "text/plain" : contentType)
				+ " (via push)");

		String safeContent = content == null ? "" : content;
		boolean isEncrypted = safeContent.indexOf("-----BEGIN PGP MESSAGE-----") > -1
				&& safeContent.indexOf("-----END PGP MESSAGE-----") > -1;
		int encrypted = isEncrypted ? 1 : 0;

		String safeContentType = contentType == null ? "text/plain" : contentType;
		// file-transfer rows mirror message.content into the metadata
		// column (saveIncomingMessage line ~30338); all other rows leave
		// metadata empty.
		String metadata = safeContentType.equals("application/sylk-file-transfer")
				? safeContent
				: "";

		long nowMs = System.currentTimeMillis();
		long unixSec = nowMs / 1000L;
		// timestamp column stores the JSON-stringified Date the JS path
		// writes — JSON.stringify(new Date()) produces "\"2026-05-29T...\""
		// including the surrounding quotes — so we emit the same shape
		// here. JS reads this back through a JSON.parse reviver.
		String isoTs = isoFromMillis(nowMs);
		String tsCol = "\"" + isoTs + "\"";

		SQLiteDatabase db = null;
		try {
			db = SQLiteDatabase.openDatabase(
					dbFile.getPath(), null, SQLiteDatabase.OPEN_READWRITE);
			try { db.execSQL("PRAGMA busy_timeout = 5000"); } catch (Exception ignore) {}

			// ---- contact upsert ----
			// We need to know whether a row already exists AND, if so,
			// what its unread_messages list looks like so we can append
			// this message id (saveSylkContact in JS rebuilds the whole
			// list from contact.unread; we do the equivalent append-and-
			// dedup directly on the comma-separated column).
			boolean contactExists = false;
			String existingUnread = "";
			Cursor c = null;
			try {
				c = db.rawQuery(
						"SELECT unread_messages FROM contacts WHERE account = ? AND uri = ? LIMIT 1",
						new String[]{account, fromUri});
				if (c != null && c.moveToFirst()) {
					contactExists = true;
					String col = c.getString(0);
					existingUnread = col == null ? "" : col;
				}
			} catch (Exception lookupEx) {
				SylkLogger.w("[message] [fcm] contact lookup failed: " + lookupEx.getMessage());
			} finally {
				if (c != null) { try { c.close(); } catch (Exception ignore) {} }
			}

			if (!contactExists) {
				// Brand-new sender. INSERT the contact stub with this
				// msg_id already seeded in unread_messages and timestamp
				// set to the message arrival time, so the contacts list
				// renders the unread badge immediately on next chat-list
				// read — without waiting for the WS journal sync.
				String resolvedName = (fromDisplayName != null && !fromDisplayName.trim().isEmpty())
						? fromDisplayName.trim()
						: deriveDisplayNameFromUri(fromUri);
				String contactId = UUID.randomUUID().toString();
				try {
					db.execSQL(
							"INSERT OR IGNORE INTO contacts ("
									+ "contact_id, remote_id, account, uri, uris, email, photo, "
									+ "timestamp, name, organization, unread_messages, tags, "
									+ "participants, public_key, direction, last_call_media, "
									+ "conference, last_call_id, last_call_duration, "
									+ "last_call_timestamp, properties, local_properties"
									+ ") VALUES (?, '', ?, ?, '', '', '', ?, ?, '', ?, '', "
									+ "'', '', 'incoming', '', 0, '', 0, NULL, '', '')",
							new Object[]{contactId, account, fromUri, unixSec, resolvedName, messageId});
					SylkLogger.d("[message] [fcm] inserted contact stub for " + fromUri
							+ " name=" + resolvedName + " unread=" + messageId);
				} catch (Exception contactEx) {
					SylkLogger.w("[message] [fcm] contact INSERT failed: " + contactEx.getMessage());
				}
			} else {
				// Existing contact — append messageId to unread_messages
				// (dedupe) and bump timestamp so the chat list lifts the
				// row to the top with an incremented unread badge.
				//
				// SQLite's MAX(col, ?) is a SCALAR function (different
				// from the MAX() aggregate): it returns the larger of
				// the column value and the bound parameter for each row.
				// This mirrors saveIncomingMessage's
				//   if (_wsTsMs > _contactTsMs) contact.timestamp = ...
				// guard so an out-of-order push or a push that lands
				// after the WS already advanced contact.timestamp can't
				// regress the last-activity clock.
				String newUnread = appendUnreadId(existingUnread, messageId);
				try {
					db.execSQL(
							"UPDATE contacts SET unread_messages = ?, timestamp = MAX(timestamp, ?) "
									+ "WHERE account = ? AND uri = ?",
							new Object[]{newUnread, unixSec, account, fromUri});
					int unreadCount = newUnread.isEmpty()
							? 0
							: newUnread.split(",").length;
					SylkLogger.d("[message] [fcm] updated contact unread for " + fromUri
							+ " unread=" + newUnread + " count=" + unreadCount
							+ " ts<=MAX(existing," + unixSec + ")");
				} catch (Exception updEx) {
					SylkLogger.w("[message] [fcm] contact UPDATE failed: " + updEx.getMessage());
				}
			}

			// ---- message insert ----
			db.execSQL(
					"INSERT OR IGNORE INTO messages ("
							+ "account, encrypted, msg_id, timestamp, unix_timestamp, "
							+ "content, content_type, metadata, from_uri, to_uri, "
							+ "direction, received, related_action, related_msg_id, "
							+ "disposition_notification, expire"
							+ ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'incoming', 1, NULL, NULL, '', 0)",
					new Object[]{
							account, encrypted, messageId, tsCol, unixSec,
							safeContent, safeContentType, metadata, fromUri, account
					});
			// Mirror the JS-side save log
			// (app.js: "save incoming [message] <id> from <uri>") so
			// APPLOG reads identically whether the row was written by
			// JS or by the native FCM handler.
			SylkLogger.d("save incoming [message] " + messageId
					+ " from " + fromUri
					+ " encrypted=" + encrypted + " (via push)");
		} catch (SQLiteDatabaseLockedException locked) {
			SylkLogger.w("[message] [fcm] DB locked, message not persisted: " + messageId);
		} catch (SQLiteException sqlEx) {
			SylkLogger.w("[message] [fcm] SQLite error persisting message", sqlEx);
		} catch (Exception e) {
			SylkLogger.e("[message] [fcm] insertIncomingMessageToSql failed", e);
		} finally {
			if (db != null) { try { db.close(); } catch (Exception ignore) {} }
		}
	}

	/**
	 * Decide whether an incoming push message may be persisted into
	 * sylk.db for this account/sender. Mirrors the same four-condition
	 * rejection set the existing isAccountActive() implements for calls,
	 * minus the showRejectedCallNotification side effect (we don't want
	 * a "rejected call" banner firing on a rejected message):
	 *
	 *   - account row missing or active != '1'  → false
	 *   - rejectAnonymous && (anonymous fromUri) → false
	 *   - rejectNonContacts && no contact known  → false
	 *
	 * DND, mute, and active-chat suppression all PASS — those gate the
	 * notification UI only, not storage. saveIncomingMessage in JS
	 * persists muted/DND-suppressed messages too.
	 */
	private boolean isInsertAllowedForAccount(String account, String fromUri, List<String> contactTags) {
		if (account == null || account.isEmpty()) return false;

		File dbFile = getApplicationContext().getDatabasePath("sylk.db");
		if (!dbFile.exists()) return false;

		boolean isActive = false;
		boolean rejectAnonymous = false;
		boolean rejectNonContacts = false;
		boolean readOk = false;

		SQLiteDatabase db = null;
		Cursor cursor = null;
		try {
			db = SQLiteDatabase.openDatabase(dbFile.getPath(), null, SQLiteDatabase.OPEN_READONLY);
			cursor = db.rawQuery("SELECT active, settings FROM accounts WHERE account = ?",
					new String[]{account});
			if (cursor != null && cursor.moveToFirst()) {
				isActive = "1".equals(cursor.getString(cursor.getColumnIndexOrThrow("active")));
				String settingsJson = cursor.getString(cursor.getColumnIndexOrThrow("settings"));
				if (settingsJson != null && !settingsJson.isEmpty()) {
					try {
						JSONObject root = new JSONObject(settingsJson);
						JSONObject privacy = root.optJSONObject("privacy");
						if (privacy != null) {
							rejectAnonymous   = privacy.optBoolean("rejectAnonymous",   false);
							rejectNonContacts = privacy.optBoolean("rejectNonContacts", false);
						}
					} catch (JSONException jsonEx) {
						SylkLogger.w("[message] [fcm] insert: settings JSON parse failed — failing open", jsonEx);
					}
				}
				readOk = true;
			}
		} catch (SQLiteDatabaseLockedException locked) {
			// Fail open on DB lock — better to land the message in SQL
			// than to drop it because the JS thread happened to be writing.
			SylkLogger.w("[message] [fcm] insert: DB locked — failing open");
			return true;
		} catch (SQLiteException sqlEx) {
			SylkLogger.w("[message] [fcm] insert: SQLite error — failing open", sqlEx);
			return true;
		} catch (Exception e) {
			SylkLogger.e("[message] [fcm] insert: account-flag read failed — failing open", e);
			return true;
		} finally {
			if (cursor != null) { try { cursor.close(); } catch (Exception ignore) {} }
			if (db != null) { try { db.close(); } catch (Exception ignore) {} }
		}

		if (!readOk) {
			// Account row simply doesn't exist — never write a row for
			// an account we don't know about (would orphan in SQL).
			return false;
		}

		if (!isActive) return false;

		if (rejectNonContacts && (contactTags == null)) {
			SylkLogger.d("[message] [fcm] insert: rejectNonContacts blocks " + fromUri);
			return false;
		}

		if (rejectAnonymous && fromUri != null
				&& (fromUri.contains("anonymous") || fromUri.contains("@guest."))) {
			SylkLogger.d("[message] [fcm] insert: rejectAnonymous blocks " + fromUri);
			return false;
		}

		return true;
	}

	/**
	 * Append a single msg_id to the comma-separated unread_messages
	 * column for a contact, deduping against any id that is already
	 * present. Empty existing -> just the new id; otherwise comma-join
	 * the existing list with the new id appended only when missing.
	 * Empty / null new id is a no-op (returns the existing list).
	 *
	 * Mirrors the effect of contact.unread.push(id) +
	 * unread_messages = contact.unread.toString() in saveSylkContact.
	 */
	private static String appendUnreadId(String existing, String newId) {
		if (newId == null || newId.isEmpty()) return existing == null ? "" : existing;
		if (existing == null || existing.isEmpty()) return newId;
		for (String id : existing.split(",")) {
			if (newId.equals(id.trim())) return existing; // already there
		}
		return existing + "," + newId;
	}

	/**
	 * ISO-8601 millisecond timestamp string, UTC zone — same shape that
	 * (new Date()).toISOString() produces in JS so the SQL value matches
	 * the existing JS-written rows byte-for-byte.
	 */
	private static String isoFromMillis(long ms) {
		java.text.SimpleDateFormat sdf =
				new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
		sdf.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
		return sdf.format(new java.util.Date(ms));
	}
	
	public static void setUnreadForContact(Context context, String uri, int count) {
		// Route count==0 through resetUnreadForContact so the per-contact loud
		// notification (posted with setNumber(N) when the message arrived) is
		// actually cancelled. Without this, JS reading messages drops the JS
		// counter and the global badge to 0 but the orphan per-contact
		// notification stays in the shade — and Motorola/Samsung launchers
		// sum setNumber across every active notification when computing the
		// icon badge, so the launcher icon stays at 1 even though everything
		// else has moved to 0. resetUnreadForContact has its own early-return
		// for prev==0 && no throttle, so this is still cheap when there is
		// nothing to clean up.
		if (count <= 0) {
			resetUnreadForContact(context, uri);
			return;
		}
		SharedPreferences prefs = context.getSharedPreferences("SylkPrefs", Context.MODE_PRIVATE);
		// Silent no-op when the stored value already matches: this method is
		// invoked from JS's reconcile loop (updateTotalUnread) and we don't
		// want to log / rewrite prefs / re-post the badge notification when
		// nothing actually changed.
		int prev = prefs.getInt("unread_chat_" + uri, 0);
		if (prev == count) {
			return;
		}
		SylkLogger.d("[fcm] setUnreadForContact " + uri + " " + count + " (was " + prev + ")");
		prefs.edit().putInt("unread_chat_" + uri, count).apply();

		// Eagerly reconcile both notification channels here — JS calls
		// into us at startup via updateTotalUnread, so this guarantees
		// the channels exist with their current desired settings (badge
		// OFF on messages_channel, ON on messages_badge_channel) without
		// waiting for the next FCM delivery to trigger ensureMessageChannel.
		// The internal guard inside ensureMessageChannel detects a stale
		// setShowBadge=true on the existing channel and re-creates it,
		// which is how the user upgrades to the new badge policy without
		// uninstalling the app.
		ensureMessageChannel(context);

		// Refresh the global launcher badge.  See refreshGlobalBadge for
		// why this is a single summary notification rather than N
		// per-contact silent ones (Android's AutoGroup summary kept
		// inflating the count by +1 once we had ≥2 active notifications).
		refreshGlobalBadge(context);
	}

	// Single source of truth for the launcher icon badge. Posts (or
	// cancels) ONE silent notification on messages_badge_channel whose
	// setNumber reflects the sum of every per-contact unread we currently
	// have stored in SharedPreferences. Using one notification means:
	//   * No Android AutoGroup summary is auto-created (avoids the
	//     phantom +1 the user saw).
	//   * The launcher reads setNumber from a single source — no
	//     summing across N per-contact notifications.
	//   * Real FCM alerts on messages_channel can still post per-contact
	//     visible bubbles for "you got a message" without affecting the
	//     count, as long as those carry setNumber(0).
	public static final int GLOBAL_BADGE_NOTIFICATION_ID = 0xBADE7;
	public static final String UNREAD_NOTIFICATION_GROUP = "sylk_unread_group";

	public static int getTotalUnreadCountStatic(Context context) {
		SharedPreferences prefs = context.getSharedPreferences("SylkPrefs", Context.MODE_PRIVATE);
		int total = 0;
		Map<String, ?> all = prefs.getAll();
		for (Map.Entry<String, ?> entry : all.entrySet()) {
			String key = entry.getKey();
			if (key.startsWith("unread_chat_")) {
				Object value = entry.getValue();
				if (value instanceof Integer) {
					total += (Integer) value;
				}
			}
		}
		return total;
	}

	// Returns a per-contact snapshot of native unread counters as a flat
	// uri -> count map. Used by JS's updateTotalUnread for comparison logging
	// so we can see when the native side and JS state drift apart.
	public static java.util.HashMap<String, Integer> getAllUnreadStatic(Context context) {
		SharedPreferences prefs = context.getSharedPreferences("SylkPrefs", Context.MODE_PRIVATE);
		java.util.HashMap<String, Integer> result = new java.util.HashMap<>();
		Map<String, ?> all = prefs.getAll();
		final String prefix = "unread_chat_";
		for (Map.Entry<String, ?> entry : all.entrySet()) {
			String key = entry.getKey();
			if (key.startsWith(prefix)) {
				Object value = entry.getValue();
				if (value instanceof Integer && ((Integer) value) > 0) {
					result.put(key.substring(prefix.length()), (Integer) value);
				}
			}
		}
		return result;
	}

	public static void refreshGlobalBadge(Context context) {
		SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
		int total = getTotalUnreadCountStatic(context);
		// Skip when the badge total hasn't moved since we last posted/cancelled.
		// JS's reconcile loop and the per-contact native helpers all funnel
		// through this method; without this guard a 30-contact reconcile
		// where nothing changed produces 30 redundant badge refreshes.
		int last = prefs.getInt("last_badge_total", -1);
		if (total == last) {
			return;
		}
		prefs.edit().putInt("last_badge_total", total).apply();
		if (total <= 0) {
			NotificationManagerCompat.from(context).cancel(GLOBAL_BADGE_NOTIFICATION_ID);
			SylkLogger.d("[fcm] refreshGlobalBadge: total=0, cancelled global badge");
			return;
		}
		ensureBadgeChannel(context);

		Intent intent = new Intent(context, MainActivity.class);
		intent.setAction(Intent.ACTION_VIEW);
		intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);

		PendingIntent tapIntent = PendingIntent.getActivity(
				context,
				GLOBAL_BADGE_NOTIFICATION_ID,
				intent,
				PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
		);

		// Standalone (NOT a group summary). Empirically, Motorola's
		// NotificationMonitorService treats "GROUP_SUMMARY with no live
		// children" as a hideable notification and excludes it from the
		// launcher badge — which surfaced as JS=4, badge=0 after the JS
		// startup reconcile fired before any per-contact FCM child had
		// arrived. VISIBILITY_PRIVATE (instead of SECRET) keeps the
		// notification eligible for badge counting on Moto's launcher
		// while still hiding details on the lockscreen.
		NotificationCompat.Builder builder =
				new NotificationCompat.Builder(context, "messages_badge_channel")
						.setSmallIcon(R.drawable.ic_notification)
						.setContentTitle("Unread messages")
						.setContentText(total + " unread")
						.setAutoCancel(true)
						.setNumber(total)
						.setPriority(NotificationCompat.PRIORITY_MIN)
						.setOnlyAlertOnce(true)
						.setContentIntent(tapIntent)
						.setCategory(NotificationCompat.CATEGORY_STATUS)
						.setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
						.setDefaults(0)
						.setSound(null)
						.setVibrate(new long[]{0L});

		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
			builder.setSilent(true);
		}

		NotificationManagerCompat.from(context).notify(GLOBAL_BADGE_NOTIFICATION_ID, builder.build());
		SylkLogger.d("[fcm] refreshGlobalBadge: posted setNumber=" + total);
	}

	public static int getUnreadForContact(Context context, String uri) {
		SharedPreferences prefs = context.getSharedPreferences("SylkPrefs", Context.MODE_PRIVATE);
		SylkLogger.d("[fcm] getUnreadForContact " + uri);
		return prefs.getInt("unread_chat_" + uri, 0);
	}

	public static void resetUnreadForContact(Context context, String uri) {
		SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
		// Silent no-op when the contact was already at zero AND has no
		// pending notification throttle entry — there's nothing to reset.
		// JS's reconcile loop hits this method once per contact, so without
		// this guard we'd log/rewrite/refresh the badge for every contact
		// in the address book on every contacts-array reassignment.
		int prev = prefs.getInt("unread_chat_" + uri, 0);
		boolean hasThrottle = prefs.contains(LAST_NOTIF_PREFIX + uri);
		if (prev == 0 && !hasThrottle) {
			return;
		}
		SylkLogger.d("[fcm] resetUnreadForContact " + uri + " (was " + prev + ")");

		// Reset unread counter and clear the notification throttle so the next
		// incoming message from this sender produces a notification immediately.
		prefs.edit()
				.putInt("unread_chat_" + uri, 0)
				.remove(LAST_NOTIF_PREFIX + uri)
				.apply();

		// Cancel the per-contact loud notification (and any stale per-contact
		// silent badge from earlier builds — same id).
		int notificationId = uri.hashCode();
		NotificationManagerCompat.from(context).cancel(notificationId);

		// Remove dynamic shortcut
		String shortcutId = "chat_" + uri.replaceAll("[^a-zA-Z0-9_]", "_");
		ShortcutManagerCompat.removeDynamicShortcuts(context, Collections.singletonList(shortcutId));

		// Recompute the global launcher badge from the remaining counters.
		refreshGlobalBadge(context);
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
            SylkLogger.d("[call] [fcm] No event found in FCM payload");
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
			SylkLogger.w("[call] [fcm] Missing event");
			return;
        }

        String lookupAccount = null;
        String callId = null;
        String fromUri = null;
        String toUri = null;

        if (event.equals("incoming_session") || event.equals("incoming_conference_request") || event.equals("cancel")) {
			callId = data.get("session-id");
			if (callId == null || callId.trim().isEmpty()) {
				SylkLogger.w("[call] [fcm] [drop] Missing callId (event=" + event + ")");
				return;
			}
			callId = callId.trim();
		}

		// Snapshot the AudioManager mode at the very moment the push
		// arrives — Telecom will flip it to RINGTONE / IN_COMMUNICATION
		// over the next few seconds, and AudioRouteModule.stop() uses this
		// pre-call snapshot as the restore target so the user returns to
		// whatever mode they were in (NORMAL / RINGTONE / NORMAL with music
		// focus, etc.) instead of staying stuck on IN_COMMUNICATION.
		if (event.equals("incoming_session") || event.equals("incoming_conference_request")) {
			try {
				android.media.AudioManager am = (android.media.AudioManager)
						getApplicationContext().getSystemService(Context.AUDIO_SERVICE);
				if (am != null) {
					SylkLogger.d("[call] [fcm] audio mode at push receipt: "
							+ AudioRouteModule.getAudioModeDescription(am.getMode())
							+ " (event=" + event + ", callId=" + callId + ")");
				}
				SylkLogger.d("[call] [fcm] SylkTelecom.CONNECTIONS at push receipt: size="
						+ SylkTelecom.CONNECTIONS.size()
						+ " keys=" + SylkTelecom.CONNECTIONS.keySet());
				AudioRouteModule.capturePreCallMode(
						getApplicationContext(),
						"FCM.onMessageReceived:" + event);
			} catch (Throwable t) {
				SylkLogger.w("[call] [fcm] failed to capture audio mode at push receipt", t);
			}
		}

		SharedPreferences prefs = getApplicationContext().getSharedPreferences("SylkPrefs", Context.MODE_PRIVATE);			

        if (event.equals("incoming_session") || event.equals("incoming_conference_request") || event.equals("message")) {
	        fromUri = data.get("from_uri");
			if (fromUri == null || fromUri.trim().isEmpty()) {
				SylkLogger.w("[call] [fcm] [drop] Missing fromUri (event=" + event + ", callId=" + callId + ")");
				if (callId != null ) {
					IncomingCallService.handledCalls.add(callId);
				}
				return;
			}

			fromUri = fromUri.trim().toLowerCase();

	        if (event.equals("incoming_session")) {
				String activeCall = prefs.getString("currentCall", null);
				if (activeCall != null && activeCall.equals(fromUri)) {
					SylkLogger.d("[call] [fcm] [drop] already in call with " + activeCall + " (callId=" + callId + ")");
					return;
				}
			}

			toUri = data.get("to_uri");
			if (toUri == null || toUri.trim().isEmpty()) {
				IncomingCallService.handledCalls.add(callId);
				SylkLogger.w("[call] [fcm] [drop] Missing toUri (event=" + event + ", from=" + fromUri + ", callId=" + callId + ")");
				return;
			}

			toUri = toUri.trim().toLowerCase();

			if (event.equals("incoming_session")) {
				lookupAccount = toUri;

				// Drop the SIP-focus dial-in twin of a conferenceInvite.
				// When a sylk user invites someone to a conference, the
				// server sends BOTH:
				//   1) an "incoming_conference_request" push (the real
				//      sylk conference invite, from_uri = inviter),
				//   2) an "incoming_session" push generated by the
				//      conference focus SIP-dialing the invitee
				//      (from_uri = <room>@<sipBridge>).
				// They arrive ~1 s apart and confuse the user (two
				// rings, the wrong one tapped sticks the call at
				// "Connecting..."). The sipBridge host is part of the
				// per-account server configuration that JS persists
				// into the accounts.settings JSON blob under
				// conference.sipBridge — same blob this service
				// already reads for privacy.dnd etc. (see
				// isAccountActive above). If from_uri's host matches,
				// suppress this push entirely. Empty / missing means
				// dedupe is disabled (safe default — call rings).
				//
				// Unconditional on Android (vs. foreground-only on
				// iOS): Android doesn't surface a "Tap to join" bubble
				// for the second push the way iOS CallKit does — the
				// foreground-background distinction isn't needed here.
				String sipBridgeDomain = readSipBridgeDomainForAccount(lookupAccount);
				if (sipBridgeDomain != null && !sipBridgeDomain.isEmpty()) {
					int atIdx = fromUri.indexOf('@');
					if (atIdx >= 0 && atIdx + 1 < fromUri.length()) {
						String host = fromUri.substring(atIdx + 1);
						// Drop any URI parameters (";transport=…" etc.)
						int semi = host.indexOf(';');
						if (semi >= 0) host = host.substring(0, semi);
						if (host.equalsIgnoreCase(sipBridgeDomain)) {
							SylkLogger.d("[call] [fcm] [drop] sipBridge twin of conferenceInvite from " + fromUri
									+ " (host '" + host + "' matches configured sipBridge '" + sipBridgeDomain
									+ "', callId=" + callId + ")");
							if (callId != null) {
								IncomingCallService.handledCalls.add(callId);
							}
							return;
						}
					}
				}
			}
		}

        if (event.equals("incoming_session") || event.equals("incoming_conference_request")) {
			incomingCalls.add(callId);

			// In-conference gate. While the user is mid-conference (flag
			// set by JS via SylkBridge.setInConference on enter/leave),
			// any incoming-call-style push — a 1-1 audio/video call
			// (incoming_session) or a conference invite
			// (incoming_conference_request) — would otherwise fire the
			// loud full-screen Telecom ringer and disrupt the active
			// conference media. Drop the push silently and surface a
			// regular silent local notification so the user knows they
			// had a missed call to return after hanging up. Mirrors the
			// iOS shouldDisplayMessageFromPayload gate.
			if (prefs.getBoolean("inConference", false)) {
				IncomingCallService.handledCalls.add(callId);
				SylkLogger.d("[call] [fcm] [drop] in conference, suppressing "
						+ event + " from " + fromUri
						+ " (callId=" + callId + ")");
				showInConferenceMissedCallNotification(fromUri, event);
				return;
			}

			if (event.equals("incoming_conference_request")) {
				String account = data.get("account");
				if (account == null || account.trim().isEmpty()) {
					SylkLogger.w("[call] [fcm] [drop] Missing account on conferenceInvite (from=" + fromUri + ", callId=" + callId + ")");
					return;
				}
				lookupAccount = account.trim().toLowerCase();
			}

			SylkLogger.d("[call] [fcm]" + event + " " + callId + " from " + fromUri + " to " + lookupAccount);

			// Wake JS NOW (before any UI / notification / Telecom work)
			// so it can kick a WSS reconnect during the ringing window
			// instead of after the user presses Accept. See
			// ReactEventEmitter.sendCallPrepEvent javadoc for the full
			// rationale.
			//
			// On Android the JS thread doesn't process FCM data pushes
			// until something tickles the bridge — by default that's
			// the user's Accept tap, which can be 2-10 s after FCM
			// arrival. During that gap, the OS may have suspended the
			// WSS socket and sylk-server may have decided we're
			// unreachable (resulting in the 480 Temporarily
			// Unavailable the user diagnosed). Emitting a bridge event
			// here wakes the JS thread immediately; it runs
			// scheduleBackToForeground / handleRegistration; the WSS
			// re-registers DURING ringing; by Accept-time, the
			// device's acceptCall has a live WSS to ride on.
			//
			// Best-effort: if RN isn't running (truly cold process),
			// sendCallPrepEvent silently drops. The classic accept
			// path still wakes the activity.
			try {
				if (getApplicationContext() instanceof ReactApplication) {
					ReactEventEmitter.sendCallPrepEvent(
						callId,
						fromUri,
						toUri,
						event,
						(ReactApplication) getApplicationContext()
					);
				}
			} catch (Throwable t) {
				SylkLogger.w("[call] [fcm] prep event emit threw", t);
			}

			List<String> tags = new ArrayList<>();
            Contact contact = getContact(lookupAccount, fromUri);
			String displayName = fromUri;

			if (contact != null) {
				displayName = contact.getDisplayName();
                tags = contact.getTags();
			
				SylkLogger.d("[call] [fcm] Display name: " + displayName);
				SylkLogger.d("[call] [fcm] Tags: " + tags);
						
			} else {
				SylkLogger.d("[call] [fcm] Unknown contact");
			}

			if (isBlocked(tags)) {
				IncomingCallService.handledCalls.add(callId);
				SylkLogger.w("[call] [fcm] [drop] caller " + fromUri + " is blocked (callId=" + callId + ")");
				return;
			}

			if (isMuted(tags)) {
				IncomingCallService.handledCalls.add(callId);
				SylkLogger.d("[call] [fcm] [drop] caller " + fromUri + " is muted (callId=" + callId + ")");
				return;
			}

			if (!isAccountActive(lookupAccount, fromUri, tags)) {
				IncomingCallService.handledCalls.add(callId);
				// isAccountActive logs the specific reason internally
				// (inactive account, rejectAnonymous, rejectNonContacts, …);
				// this line is the single greppable drop summary so the
				// Logs window shows it alongside every other drop.
				SylkLogger.d("[call] [fcm] [drop] account/privacy rules rejected "
						+ event + " from " + fromUri + " to " + lookupAccount
						+ " (callId=" + callId + ")");
				return;
			}

			// DND gates. Both now have the SAME semantics: hard drop the
			// push and surface a silent missed-call notification on
			// rejected_calls_channel (same channel + style as the
			// in-conference suppression path). The user sees a "Missed
			// call from X (Do Not Disturb)" entry afterwards instead of
			// the full incoming-call UI ringing / showing
			// "Collecting ICE candidates…" mid-DND.
			//
			//   OS DND  — Android system Do Not Disturb (interruption
			//             filter ≠ ALL). Body suffix: "system Do Not Disturb".
			//   App DND — privacy.dnd in accounts.settings JSON (the bell
			//             on the navbar). Body suffix: "Do Not Disturb".
			//
			// Contacts tagged bypassdnd override both — push falls through
			// and rings normally.
			boolean osDnd  = isDndEnabled(this);
			boolean appDnd = isAppDndOn(lookupAccount);
			boolean bypass = canBypassDnd(tags);

			if ((osDnd || appDnd) && bypass) {
				SylkLogger.d("[call] [fcm] DND bypass for " + fromUri
					+ " (osDnd=" + osDnd + " appDnd=" + appDnd + ")");
			}

			if (osDnd && !bypass) {
				IncomingCallService.handledCalls.add(callId);
				SylkLogger.d("[call] [fcm] [drop] OS DND active, dropping " + event + " from " + fromUri + " (callId=" + callId + ")");
				showSuppressedCallNotification(fromUri, event, "system Do Not Disturb");
				return; // notification dropped
			}

			if (appDnd && !bypass) {
				IncomingCallService.handledCalls.add(callId);
				SylkLogger.d("[call] [fcm] [drop] App DND active, dropping " + event + " from " + fromUri + " (callId=" + callId + ")");
				showSuppressedCallNotification(fromUri, event, "Do Not Disturb");
				return; // notification dropped
			}

            Intent serviceIntent = new Intent(this, IncomingCallService.class);
            // Pass all FCM data to service
            for (Map.Entry<String, String> entry : data.entrySet()) {
                serviceIntent.putExtra(entry.getKey(), entry.getValue());
            }

            serviceIntent.putExtra("displayName", displayName);
            serviceIntent.putExtra("phoneLocked", phoneLocked);
            // suppress_ringtone is no longer used by App DND (the call is
            // dropped before reaching the service). Always false here; kept
            // for backward-compat with any other caller that may still read it.
            serviceIntent.putExtra("suppress_ringtone", false);
			SylkLogger.d("[call] [fcm] phoneLocked: " + phoneLocked);

			ContextCompat.startForegroundService(this, serviceIntent);

        } else if (event.equals("cancel")) {

			if (!incomingCalls.contains(callId)) {
				SylkLogger.d("[call] [fcm] missing corresponding incoming call " + callId);
				return;
			}

			if (IncomingCallService.handledCalls.contains(callId)) {
				//SylkLogger.d("[call] [fcm] cancel already handled: " + callId);
				return;
			}

			SylkLogger.d("[call] [fcm]" + event + " " + callId);
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
				SylkLogger.w("[message] [fcm] Message error: missing messageId");
				return;
			}

			// Dump the full FCM data payload as soon as we know this is a
			// message push. Mirrors the visibility we already have for
			// incoming calls and is the only way to confirm whether the
			// server is actually shipping from_display_name on the
			// account-message channel — the per-field reads below only
			// pull a handful of keys, so a missing field is invisible
			// without this generic dump.
			StringBuilder _payload = new StringBuilder();
			_payload.append("[message] [fcm] payload {");
			boolean _first = true;
			for (Map.Entry<String, String> _e : data.entrySet()) {
				if (!_first) _payload.append(", ");
				_first = false;
				_payload.append(_e.getKey()).append("=").append(_e.getValue());
			}
			_payload.append("}");
			SylkLogger.d(_payload.toString());

			List<String> tags = new ArrayList<>();
            Contact contact = getContact(toUri, fromUri);
			// Prefer the SIP "From" display name carried by the push over
			// our locally-stored contact name, so a stranger's first
			// message can surface as "Alice Foo" rather than the bare URI.
			// If the field is missing we fall back to fromUri (the legacy
			// behaviour), and the local DB lookup below still wins over
			// either when a real contact exists.
			String pushDisplayName = data.get("from_display_name");
			String displayName = (pushDisplayName != null && !pushDisplayName.trim().isEmpty())
					? pushDisplayName.trim()
					: fromUri;

			SylkLogger.w("[message] [fcm]" + event + " " + messageId
					+ " from " + fromUri + " to " + toUri
					+ " pushDisplayName=" + (pushDisplayName != null ? pushDisplayName : "(none)"));

			if (fromUri.equals(toUri)) {
				SylkLogger.d("[message] [fcm] Skipping notification for my own account");
				return;
			}

			if (contact != null) {
				displayName = contact.getDisplayName();
                tags = contact.getTags();

				SylkLogger.d("[message] [fcm] Display name: " + displayName);
				SylkLogger.d("[message] [fcm] Tags: " + tags);

			} else {
				SylkLogger.d("[message] [fcm] Unknown contact");
			}

			if (isBlocked(tags)) {
				SylkLogger.w("[message] [fcm] Message from " + fromUri + " is blocked");
				return;
			}

			// Persist directly to sylk.db ONLY when the app is NOT in the
			// foreground. When the app IS foreground, the live websocket
			// connection delivers the same msg_id and JS's
			// saveIncomingMessage path writes the row — running the
			// native INSERT there would race against the JS write and
			// only ever no-op via INSERT OR IGNORE.
			//
			// The insert is otherwise gated by:
			//   1. blocked contact (isBlocked above already returned)
			//   2. disabled account (active != '1')
			//   3. rejectAnonymous && anonymous sender
			//   4. rejectNonContacts && unknown sender
			// Mute, DND, and active-chat suppression all PASS — those
			// gate the NOTIFICATION UI only. saveIncomingMessage in JS
			// persists muted/DND-suppressed messages too.
			String content = data.get("content");
			String contentType = data.get("content_type");
			boolean _insertAppForeground = isAppInForeground();
			if (_insertAppForeground) {
				SylkLogger.d("[message] [fcm] App is foreground — skipping native SQL insert; WS will deliver "
						+ messageId);
			} else {
				List<String> _insertTags = (contact != null) ? tags : null;
				if (isInsertAllowedForAccount(toUri, fromUri, _insertTags)) {
					insertIncomingMessageToSql(toUri, fromUri, messageId, content, contentType, pushDisplayName);
				} else {
					SylkLogger.w("[message] [fcm] Insert skipped for "
							+ fromUri + " (account=" + toUri
							+ "): disabled / rejectAnonymous / rejectNonContacts");
				}
			}

			if (isMuted(tags)) {
				SylkLogger.d("[message] [fcm] Skipping notification: user " + fromUri + " is muted");
				return;
			}

			if (!isAccountActive(toUri, fromUri, tags)) {
				SylkLogger.w("[message] [fcm] Message from " + fromUri + " is not allowed");
				return;
			}

			// DND + bypass logic
			boolean dnd = isDndEnabled(this);

			if (dnd && !canBypassDnd(tags)) {
				SylkLogger.d("[message] [fcm] DND active, dropping message from " + fromUri);
				return; // notification dropped
			}

			if (dnd && canBypassDnd(tags)) {
				SylkLogger.d("[message] [fcm] DND bypass for " + fromUri);
			}

			// Active-chat suppression. JS writes SylkPrefs.currentChat
			// when the user enters a chat, clears it on exit. BUT swipe-
			// kill skips the cleanup — the pref keeps pointing at the
			// last-opened chat forever. If we trust it blindly, the very
			// next push from that sender after a cold start gets
			// silently swallowed because we think the user is still in
			// the chat. Cross-check with the OS process state
			// (isAppInForeground already does the same dance for
			// appActive) and treat a stale activeChat as "no active
			// chat", clearing it as a side effect so subsequent code
			// paths that read it directly don't lie either.
			boolean appInForeground = isAppInForeground();
			String activeChat = prefs.getString("currentChat", null);

			if (activeChat != null && !appInForeground) {
				SylkLogger.w("[message] [fcm] Stale currentChat=" + activeChat
						+ " (OS reports app is background) — clearing and ignoring");
				prefs.edit().remove("currentChat").apply();
				activeChat = null;
			}

			if (activeChat != null && activeChat.equals(fromUri)) {
				// User is genuinely in this chat right now, skip
				// showing notification/bubble.
				SylkLogger.d("[message] [fcm] Skipping notification: user is in chat " + activeChat);
				return;
			}

			if (activeChat != null) {
			    SylkLogger.d("[message] [fcm] Active chat " + activeChat);
			} else {
			    SylkLogger.d("[message] [fcm] No active chat");
			}

			// Skip increment if app is in foreground — JS side will count this
			// message via setUnreadForContact and we would otherwise double-count.
			// (appInForeground was computed above for the activeChat stale-pref check.)
			if (appInForeground) {
				SylkLogger.d("[message] [fcm] App in foreground, JS handles unread counter for " + fromUri);
			} else {
				// increase unread badge counter
				incrementUnreadForContact(fromUri);
			}

			// IMPORTANT: setNumber on a per-contact notification must be the
			// PER-CONTACT count, not the total across the whole inbox. The
			// launcher already sums setNumber across every active notification
			// to build the icon badge, so passing the global total here would
			// inflate the badge by O(N²) (each contact's notification carrying
			// the sum, then the launcher summing those sums). Symptom before
			// this fix: living233=2 + florig=2 in-app, but launcher showed 6
			// because florig's notification got setNumber(4) (=total) on top
			// of living233's existing setNumber(2).
			int unreadCount = getUnreadForContact(fromUri);
			SylkLogger.d("[message] [fcm] Per-contact unread for " + fromUri + ":" + unreadCount
					+ " (total inbox=" + getTotalUnreadCount() + ")");

			// Throttle the alert for visible notifications: if we showed a
			// notification for this sender less than THROTTLE_NOTIFICATION_MS
			// ago we still update the existing notification (so the launcher
			// badge reflects the new count) but we do it silently — no sound,
			// no vibration, no heads-up banner.
			boolean throttled = shouldThrottleNotification(fromUri);
			if (throttled) {
				long elapsed = System.currentTimeMillis() - getLastNotificationTime(fromUri);
				SylkLogger.d("[message] [fcm] Throttling notification alert for " + fromUri
						+ " (last alerted " + elapsed + "ms ago, window "
						+ THROTTLE_NOTIFICATION_MS + "ms) — updating count silently");
			}

			// ----- CHANNEL -----
			String channelId = MESSAGES_CHANNEL_ID;

			// ----- INTENT -----
			Intent intent = new Intent(this, MainActivity.class);
			intent.setAction(Intent.ACTION_VIEW);
			intent.setData(Uri.parse("sylk://message/incoming/" + fromUri));
			intent.putExtra("fromUri", fromUri);
			intent.putExtra("id", messageId);
			intent.putExtra("content", content);
			intent.putExtra("contentType", contentType);
			// Forward the SIP "From" display name so the JS-side
			// notificationTapped handler (DeviceEventEmitter) can pass it
			// into incomingMessageFromPush. Used by the auto-create-contact
			// path to land a friendly name on a first-time sender instead
			// of an empty / URI-derived one.
			if (pushDisplayName != null && !pushDisplayName.trim().isEmpty()) {
				intent.putExtra("fromDisplayName", pushDisplayName.trim());
			}
			
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
					.setName(displayName)
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
                .addMessage("Message from " + fromUri, System.currentTimeMillis(), displayName);

			
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
			// NOTE: deliberately no setNumber here. The launcher icon
			// badge is driven exclusively by the global summary
			// notification posted by refreshGlobalBadge.
			// `messages_channel` now has setShowBadge(false), so these
			// per-contact loud notifications don't contribute to the
			// icon count — they only handle the heads-up alert and
			// shade entry for "you got a message".
			NotificationCompat.Builder builder =
					new NotificationCompat.Builder(this, channelId)
							.setSmallIcon(R.drawable.ic_notification)
							.setContentTitle("New message") // header
							.setContentText("Message from " + displayName) // second line
							.setAutoCancel(true)
							.setPriority(throttled
									? NotificationCompat.PRIORITY_LOW
									: NotificationCompat.PRIORITY_HIGH)
							.setStyle(style)
							.setContentIntent(tapIntent)
							.setBubbleMetadata(bubbleData)
							.setShortcutId(shortcutId)
							.setCategory(NotificationCompat.CATEGORY_MESSAGE)
							.setVisibility(NotificationCompat.VISIBILITY_PRIVATE);

			// When throttling, suppress sound / vibration / heads-up banner but
			// still post so Android updates the launcher badge (setNumber).
			if (throttled) {
				builder.setOnlyAlertOnce(true);
				builder.setDefaults(0);
				builder.setSound(null);
				builder.setVibrate(new long[]{0L});
				if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
					builder.setSilent(true);
				}
			}

			// ----- SEND -----
			int nid = fromUri.hashCode();
			NotificationManagerCompat.from(this).notify(nid, builder.build());

			// Update the global launcher badge after the per-contact prefs
			// changed (only if we actually incremented above — appInForeground
			// case is JS's responsibility).
			if (!appInForeground) {
				refreshGlobalBadge(this);
			}

			if (throttled) {
				SylkLogger.d("[message] [fcm] Silent notification update for " + fromUri
						+ " (count=" + unreadCount + ")");
			} else {
				setLastNotificationTime(fromUri, System.currentTimeMillis());
				SylkLogger.d("[message] [fcm] Notification alerted for " + fromUri
						+ " (count=" + unreadCount + "), next throttle window "
						+ THROTTLE_NOTIFICATION_MS + "ms");
			}

        } else {
            SylkLogger.d("[call] [fcm] Unhandled event: " + event);
        }
    }
}
