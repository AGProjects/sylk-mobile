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
	private static final long THROTTLE_NOTIFICATION_MS = 60_000L;
	private static final String LAST_NOTIF_PREFIX = "last_notif_";

	private void createNotificationChannel() {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			String channelId = "rejected_calls_channel";
			String channelName = "Rejected Calls";

			NotificationManager manager = getSystemService(NotificationManager.class);
			if (manager != null) {
				NotificationChannel existing = manager.getNotificationChannel(channelId);
				if (existing != null) {
					manager.deleteNotificationChannel(channelId);
					//SylkLogger.e("[call] [fcm] Deleted existing notification channel: " + channelId);
				}

				NotificationChannel channel = new NotificationChannel(
						channelId,
						channelName,
						NotificationManager.IMPORTANCE_HIGH
				);

				channel.setDescription("Notifications for rejected calls");

				manager.createNotificationChannel(channel);
				//SylkLogger.e("[call] [fcm] Notification channel created: "+ channelId);
			}
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
		String channelId = "rejected_calls_channel";
	
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
	
		// App DND (privacy.dnd in accounts.settings JSON) used to reject
		// the call here. It no longer does. The caller is expected to
		// re-read the same flag via isAppDndOn() and decide whether to
		// suppress the ringtone — app DND now means "deliver the push
		// silently", not "drop it". The OS DND path (isDndEnabled +
		// canBypassDnd) is separate and still does what it did before.
		// (isDnd is intentionally left read above so the log line above
		// continues to show the current value for diagnostics.)
	
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
		// Prefer the explicit hint JS pushes via SylkBridge.setAppActive
		// — when present and true, JS is actively handling messages over
		// the websocket and FCM must not double-count by also calling
		// incrementUnreadForContact. ActivityManager.getMyMemoryState is
		// useless here because this service runs in its own process and
		// reports BACKGROUND for itself even when the main React Native
		// app process is at IMPORTANCE_FOREGROUND.
		SharedPreferences prefs = getSharedPreferences("SylkPrefs", MODE_PRIVATE);
		if (prefs.contains("appActive")) {
			boolean jsActive = prefs.getBoolean("appActive", false);
			SylkLogger.d("[fcm] isAppInForeground: JS-reported appActive=" + jsActive);
			return jsActive;
		}

		// Fallback for the very first boot before JS has set the flag.
		android.app.ActivityManager.RunningAppProcessInfo appProcessInfo =
				new android.app.ActivityManager.RunningAppProcessInfo();
		android.app.ActivityManager.getMyMemoryState(appProcessInfo);
		return appProcessInfo.importance == android.app.ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
				|| appProcessInfo.importance == android.app.ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE;
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
				SylkLogger.w("[call] [fcm] Missing callId");
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
				SylkLogger.w("[call] [fcm] Missing fromUri");
				if (callId != null ) {
					IncomingCallService.handledCalls.add(callId);
				}
				return;
			}

			fromUri = fromUri.trim().toLowerCase();

	        if (event.equals("incoming_session")) {
				String activeCall = prefs.getString("currentCall", null);
				if (activeCall != null && activeCall.equals(fromUri)) {
					SylkLogger.d("[call] [fcm] Skipping notification: already in call with " + activeCall);
					return;
				}
			}

			toUri = data.get("to_uri");
			if (toUri == null || toUri.trim().isEmpty()) {
				IncomingCallService.handledCalls.add(callId);
				SylkLogger.w("[call] [fcm] Missing toUri");
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
							SylkLogger.d("[call] [fcm] Dropping incoming_session push: "
									+ "from_uri host '" + host
									+ "' matches configured sipBridge '" + sipBridgeDomain
									+ "' (duplicate of conferenceInvite, callId=" + callId + ")");
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

			if (event.equals("incoming_conference_request")) {
				String account = data.get("account");
				if (account == null || account.trim().isEmpty()) {
					SylkLogger.w("[call] [fcm] Missing account");
					return;
				}
				lookupAccount = account.trim().toLowerCase();
			}

			SylkLogger.d("[call] [fcm]" + event + " " + callId + " from " + fromUri + " to " + lookupAccount);

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
				SylkLogger.w("[call] [fcm] Caller " + fromUri + " is blocked");
				return;
			}

			if (isMuted(tags)) {
				IncomingCallService.handledCalls.add(callId);
				SylkLogger.d("[call] [fcm] Skipping notification: user " + fromUri + " is muted");
				return;
			}

			if (!isAccountActive(lookupAccount, fromUri, tags)) {
				IncomingCallService.handledCalls.add(callId);
				return;
			}

			// Two DND gates with different semantics:
			//
			//   OS DND (NotificationManager interruption filter):
			//     hard drop unless the contact is tagged bypassdnd.
			//     This is unchanged.
			//
			//   App DND (privacy.dnd in accounts.settings JSON, the bell
			//     on the navbar):
			//     soft gate — let the push through but tell the
			//     IncomingCallService to skip the ringtone. The
			//     notification, full-screen intent, Telecom hand-off
			//     still happen, so the call is visible and answerable;
			//     it just doesn't ring. Contacts tagged bypassdnd
			//     override this and ring normally.
			boolean osDnd  = isDndEnabled(this);
			boolean appDnd = isAppDndOn(lookupAccount);
			boolean bypass = canBypassDnd(tags);

			if (osDnd && !bypass) {
				IncomingCallService.handledCalls.add(callId);
				SylkLogger.d("[call] [fcm] OS DND active, dropping message from " + fromUri);
				return; // notification dropped
			}

			if ((osDnd || appDnd) && bypass) {
				SylkLogger.d("[call] [fcm] DND bypass for " + fromUri
					+ " (osDnd=" + osDnd + " appDnd=" + appDnd + ")");
			}

			boolean suppressRingtone = appDnd && !bypass;
			if (suppressRingtone) {
				SylkLogger.d("[call] [fcm] App DND on, delivering silent push for " + fromUri);
			}

            Intent serviceIntent = new Intent(this, IncomingCallService.class);
            // Pass all FCM data to service
            for (Map.Entry<String, String> entry : data.entrySet()) {
                serviceIntent.putExtra(entry.getKey(), entry.getValue());
            }

            serviceIntent.putExtra("displayName", displayName);
            serviceIntent.putExtra("phoneLocked", phoneLocked);
            serviceIntent.putExtra("suppress_ringtone", suppressRingtone);
			SylkLogger.d("[call] [fcm] phoneLocked: " + phoneLocked
				+ " suppress_ringtone: " + suppressRingtone);

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

			// inside onMessageReceived or wherever you handle the message
			String activeChat = prefs.getString("currentChat", null);

			if (activeChat != null && activeChat.equals(fromUri)) {
				// User is already in this chat, skip showing notification/bubble
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
			boolean appInForeground = isAppInForeground();
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

			String content = data.get("content");
			String contentType = data.get("content_type");

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
