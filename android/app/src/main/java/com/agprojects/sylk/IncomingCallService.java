package com.agprojects.sylk;

import android.app.ActivityManager;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Bundle;

import android.util.Log;

import java.util.Set;
import java.util.HashSet;
import java.util.Map;
import java.util.Arrays;
import java.util.HashMap;
import java.io.File;

import androidx.annotation.Nullable;
import androidx.core.app.Person;
import androidx.core.content.ContextCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;

import com.facebook.react.ReactApplication;
import com.facebook.react.ReactInstanceManager;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.provider.Settings;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteDatabaseLockedException;
import android.database.sqlite.SQLiteException;
import android.content.Context;
import java.util.ArrayList;
import java.util.List;

import android.os.Vibrator;
import android.os.VibrationEffect;

import android.telecom.DisconnectCause;

import androidx.localbroadcastmanager.content.LocalBroadcastManager;
import androidx.lifecycle.ProcessLifecycleOwner;
import android.content.Context;



public class IncomingCallService extends Service {

    public static final String CHANNEL_ID = "incoming-sylk-calls";

    // Separate low-importance channel used only to satisfy Android's
    // startForegroundService → startForeground contract on entry paths
    // that immediately tear the service down (accept / reject / cancel /
    // error early-return). Importance MIN so the placeholder doesn't
    // ring, vibrate, or visually compete with the real CallStyle
    // notification on CHANNEL_ID. See onStartCommand's preamble for the
    // full rationale.
    public static final String COMPLIANCE_CHANNEL_ID = "sylk-call-service-compliance";

    // Stable notification id for the compliance placeholder. Distinct
    // from any per-call notification id (Math.abs(callId.hashCode()))
    // so the placeholder updates / cancels independently of the real
    // CallStyle notification.
    private static final int COMPLIANCE_NOTIFICATION_ID = 1;

    public static final Set<String> handledCalls = new HashSet<>();
    private static final String LOG_TAG = "SYLK_APP";
    private Map<String, List<String>> contactsByTag = new HashMap<>();
    
    private Handler autoCancelHandler;
    private Runnable autoCancelRunnable;
	private MediaPlayer ringtonePlayer;
	private Map<String, Runnable> autoAnswerRunnables = new HashMap<>();
    private Handler mainHandler = new Handler(Looper.getMainLooper());
    private Vibrator vibrator; // <-- add this as a field in your class

	private Map<String, List<String>> getContactsByTag() {
		Map<String, List<String>> result = new HashMap<>();
		List<String> favorites = new ArrayList<>();
		List<String> autoanswer = new ArrayList<>();
		List<String> bypassdnd = new ArrayList<>();

		try {
			File dbFile = getApplicationContext().getDatabasePath("sylk.db");
			if (!dbFile.exists()) {
				SylkLogger.e("[call] [service] Database file not found: " + dbFile.getAbsolutePath());
				// still put empty lists in the map
				result.put("favorites", favorites);
				result.put("autoanswer", autoanswer);
				result.put("bypassdnd", bypassdnd);
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
						if (lowerTags.contains("favorite")) {
							favorites.add(uri);
						}
						if (lowerTags.contains("autoanswer")) {
							autoanswer.add(uri);
						}
						// Match MyFirebaseMessagingService.canBypassDnd():
						// FCM uses the "bypassdnd" tag (no underscore) to
						// decide whether to let the push through during DND.
						// The ringtone path must use the same allow-list,
						// otherwise the call arrives but doesn't ring.
						if (lowerTags.contains("bypassdnd")) {
							bypassdnd.add(uri);
						}
					}
				}
				cursor.close();
			}

			db.close();
		} catch (SQLiteDatabaseLockedException locked) {
			// DB locked by JS thread writes — fall through with empty
			// favorite/autoanswer lists. The call will still ring; we
			// just won't be able to apply favorite/autoanswer treatment
			// on this notification (worst case the user gets a normal
			// ring instead of an auto-answered one). NO retry: previous
			// backoff retries stretched the FCM handler to ~30s on
			// contention, well past the caller's patience.
			SylkLogger.w("[call] [service] getContactsByTag: DB locked — using empty favorite/autoanswer lists, call will ring");
		} catch (SQLiteException sqlEx) {
			String msg = sqlEx.getMessage();
			if (msg != null && msg.contains("SQLITE_BUSY")) {
				SylkLogger.w("[call] [service] getContactsByTag: DB busy — using empty lists, call will ring");
			} else {
				SylkLogger.e("[call] [service] Failed to read contacts from database (SQLite)", sqlEx);
			}
		} catch (Exception e) {
			SylkLogger.e("[call] [service] Failed to read contacts from database", e);
		}

		result.put("favorites", favorites);
		result.put("autoanswer", autoanswer);
		result.put("bypassdnd", bypassdnd);

		return result;
	}

	private boolean isFavorite(String from_uri) {
		if (from_uri == null) return false;
		List<String> favorites = contactsByTag.get("favorites");
		return favorites != null && favorites.contains(from_uri);
	}

	// Contacts the user has explicitly allowed through DND. This is the same
	// tag MyFirebaseMessagingService.canBypassDnd() checks to decide whether
	// to deliver the push; we mirror it here so the ringtone gate doesn't
	// silently drop calls that the FCM layer already approved.
	private boolean isDndBypass(String from_uri) {
		if (from_uri == null) return false;
		List<String> bypass = contactsByTag.get("bypassdnd");
		return bypass != null && bypass.contains(from_uri);
	}
	
	private boolean isAutoAnswer(String from_uri) {
		if (from_uri == null) return false;
		List<String> autoanswer = contactsByTag.get("autoanswer");
		return autoanswer != null && autoanswer.contains(from_uri);
	}	

	private void startRingtone(String from_uri, boolean suppressRingtone) {
		// App DND told us to deliver the push silently. Skip audio and
		// vibration entirely; the rest of the incoming-call UX (heads-up
		// notification, full-screen intent, Telecom hand-off) still runs
		// in the caller, so the user can see and answer the call —
		// they just aren't disturbed by sound or buzz.
		if (suppressRingtone) {
			SylkLogger.d("[CallSvc] suppress_ringtone=true (app DND, no per-contact bypass) — not ringing");
			return;
		}

		// Start vibration if system setting allows
		vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);

		if (ringtonePlayer != null && ringtonePlayer.isPlaying()) return;
	
		AudioManager audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
		int ringerMode = audioManager.getRingerMode();
	
		String modeString;
		switch (ringerMode) {
			case AudioManager.RINGER_MODE_NORMAL:
				modeString = "NORMAL";
				break;
			case AudioManager.RINGER_MODE_SILENT:
				modeString = "SILENT";
				break;
			case AudioManager.RINGER_MODE_VIBRATE:
				modeString = "VIBRATE";
				break;
			default:
				modeString = "UNKNOWN";
				break;
		}
		
		SylkLogger.d("[call] [service] Current ringer mode: " + modeString);

		boolean isFavorite = isFavorite(from_uri);
		boolean canBypassDnd = isDndBypass(from_uri);

		// DND state is independent of ringer mode. The ringer can be NORMAL
		// while DND is suppressing audio. AudioManager.getRingerMode() won't
		// tell us that — we need NotificationManager.getCurrentInterruptionFilter().
		// INTERRUPTION_FILTER_ALL means "DND off"; anything else (PRIORITY /
		// ALARMS / NONE) means DND is on in some form.
		boolean dndActive = false;
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
			NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
			if (nm != null) {
				int filter = nm.getCurrentInterruptionFilter();
				dndActive = filter != NotificationManager.INTERRUPTION_FILTER_ALL
						&& filter != NotificationManager.INTERRUPTION_FILTER_UNKNOWN;
				SylkLogger.d("[call] [service] DND interruption filter: " + filter + " (dndActive=" + dndActive + ")");
			}
		}

		// "Allowed to ring through DND/SILENT" is anyone the user has
		// allow-listed for DND bypass OR marked as a favorite. The FCM
		// layer already gates push delivery on the bypassdnd tag, so by
		// the time we get here for a DND call the caller has been vetted —
		// the only remaining job is to actually make sound.
		boolean ringThroughDnd = canBypassDnd || isFavorite;

		// Skip the ringtone for non-allowed callers in SILENT mode.
		if (!ringThroughDnd && ringerMode == AudioManager.RINGER_MODE_SILENT) {
			SylkLogger.d("[call] [service] Silent mode, not playing ringtone (caller not DND-bypass / favorite)");
			return;
		}

		try {
			// Allowed callers during DND need to escape the DND audio gate.
			// The USAGE_NOTIFICATION_RINGTONE stream is silenced by DND
			// regardless of any channel.setBypassDnd(true) flag — that flag
			// only applies to sound configured on the channel itself, not
			// to a MediaPlayer we drive manually. USAGE_ALARM is not silenced
			// by DND, so we route allowed callers through the alarm stream
			// when DND is active.
			//
			// Note: alarm volume and ring volume are separate sliders. A user
			// who has muted their ringer but left alarm volume up will hear
			// allowed callers at alarm volume during DND — that's the
			// intended outcome of the DND-bypass feature.
			boolean useAlarmRoute = ringThroughDnd && dndActive;

			int usage = useAlarmRoute
					? AudioAttributes.USAGE_ALARM
					: AudioAttributes.USAGE_NOTIFICATION_RINGTONE;
			int contentType = useAlarmRoute
					? AudioAttributes.CONTENT_TYPE_SONIFICATION
					: AudioAttributes.CONTENT_TYPE_MUSIC;

			// When playing on the alarm stream, scale playback volume to the
			// user's alarm volume so we don't blast at max — and so we don't
			// play at 0 if the alarm stream happens to be muted.
			float volume = 1.0f;
			if (useAlarmRoute) {
				int alarmMax = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM);
				int alarmCur = audioManager.getStreamVolume(AudioManager.STREAM_ALARM);
				volume = alarmMax > 0 ? (float) alarmCur / (float) alarmMax : 1.0f;
			}

			SylkLogger.d("[call] [service] Ringtone route: " + (useAlarmRoute ? "ALARM (DND bypass)" : "RINGTONE")
					+ " isFavorite=" + isFavorite + " canBypassDnd=" + canBypassDnd
					+ " dndActive=" + dndActive + " volume=" + volume);

			// Start ringtone
			Uri ringtoneUri = Settings.System.DEFAULT_RINGTONE_URI; // default ringtone
			ringtonePlayer = new MediaPlayer();
			ringtonePlayer.setDataSource(this, ringtoneUri);
			ringtonePlayer.setAudioAttributes(
				new AudioAttributes.Builder()
					.setUsage(usage)
					.setContentType(contentType)
					.build()
			);
			ringtonePlayer.setLooping(true);
			ringtonePlayer.setVolume(volume, volume);
			ringtonePlayer.prepare();
			ringtonePlayer.start();
			//SylkLogger.d("[call] [service] Ringtone started");
	
			if (vibrator != null && vibrator.hasVibrator() && ringerMode == AudioManager.RINGER_MODE_VIBRATE) {
				long[] pattern = {0, 1000, 3000}; // wait, vibrate, pause
				if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
					vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0)); // 0 = repeat
				} else {
					vibrator.vibrate(pattern, 0); // deprecated but works on older devices
				}
				//SylkLogger.d("[call] [service] Vibration started");
			} else {
				//SylkLogger.d("[call] [service] Not vibrating (ringer mode not VIBRATE or vibrator missing)");
			}
	
		} catch (Exception e) {
			SylkLogger.e("[call] [service] Failed to start ringtone/vibration", e);
		}
	}

	// Call this when the call is answered, rejected, or canceled
	private void stopRingtone() {
		// Stop ringtone
		if (ringtonePlayer != null) {
			if (ringtonePlayer.isPlaying()) {
				ringtonePlayer.stop();
			}
			ringtonePlayer.release();
			ringtonePlayer = null;
			//SylkLogger.d("[call] [service] Ringtone stopped");
		}
	
		// Stop vibration
		try {
			if (vibrator != null) {
				vibrator.cancel();
				//SylkLogger.d("[call] [service] Vibration stopped");
			}
		} catch (Exception e) {
			SylkLogger.e("[call] [service] Error stopping vibration", e);
		}
		
		vibrator = null;
	}

	// Idempotent compliance-channel creator. Min importance + no
	// sound, no vibration, no badge so the placeholder used to
	// satisfy the foreground-service contract is fully silent and
	// invisible to the user. CHANNEL_ID stays high-importance for
	// the real CallStyle ringing notification.
	private void createComplianceNotificationChannel() {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			NotificationManager nm = getSystemService(NotificationManager.class);
			if (nm.getNotificationChannel(COMPLIANCE_CHANNEL_ID) != null) {
				return;
			}
			NotificationChannel channel = new NotificationChannel(
					COMPLIANCE_CHANNEL_ID,
					"Call service",
					NotificationManager.IMPORTANCE_MIN
			);
			channel.setDescription("Internal placeholder while the call service starts");
			channel.setSound(null, null);
			channel.enableVibration(false);
			channel.setShowBadge(false);
			channel.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
			nm.createNotificationChannel(channel);
		}
	}

	// Build + post the minimal placeholder that satisfies the
	// startForegroundService contract. Called at the very top of
	// onStartCommand so every entry path is covered. If the
	// containing branch goes on to post the real CallStyle
	// notification via showIncomingCallNotification, that call
	// will reuse the same Service.startForeground machinery with a
	// different (per-call) notification id, and the placeholder
	// notification is dismissed below explicitly so the user never
	// sees both.
	private void startCompliancePlaceholder() {
		createComplianceNotificationChannel();
		// MIN-importance channel + priority MIN + null sound + empty
		// vibration is enough to make the placeholder silent on every
		// supported Android version. Not using NotificationCompat
		// .Builder.setSilent() because that method requires a newer
		// androidx.core than this project pins; the channel-level
		// silence is what does the real work on Android O+ anyway.
		Notification placeholder = new NotificationCompat.Builder(this, COMPLIANCE_CHANNEL_ID)
				.setSmallIcon(R.drawable.ic_notification)
				.setContentTitle("Sylk")
				.setOngoing(false)
				.setPriority(NotificationCompat.PRIORITY_MIN)
				.setSound(null)
				.setVibrate(new long[]{0L})
				.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
				.build();
		startForeground(COMPLIANCE_NOTIFICATION_ID, placeholder);
	}

	private void createCallNotificationChannel() {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			NotificationManager nm = getSystemService(NotificationManager.class);

			// Idempotent: create-if-missing only. The previous version
			// deleted-and-recreated so it could pick up changed channel
			// settings each launch, but Android 16+ throws
			// SecurityException("Not allowed to delete channel ... with a
			// foreground service") when the channel is still bound to a
			// previous call's IncomingCallService instance that hasn't
			// fully torn down — which is exactly what's happening here.
			// To change channel settings in a future release, bump
			// CHANNEL_ID itself (standard Android pattern for forcing a
			// fresh channel on upgrade).
			if (nm.getNotificationChannel(CHANNEL_ID) != null) {
				return;
			}

			NotificationChannel channel = new NotificationChannel(
					CHANNEL_ID,
					"Incoming Calls",
					NotificationManager.IMPORTANCE_HIGH
			);

			channel.setDescription("Incoming Sylk call notifications");
			channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
			channel.setBypassDnd(true);
			channel.enableVibration(true);
			channel.setSound(null, null);

			nm.createNotificationChannel(channel);
		}
	}

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // CRITICAL: every entry point reaches here via
        // startForegroundService() — from MyFirebaseMessagingService
        // (incoming session push) and from IncomingCallActionReceiver
        // (accept / reject / cancel notification-action receivers).
        // Android's contract requires Service.startForeground() within
        // the SDK-version-dependent grace window (~5 s on API 31, up
        // to ~60 s on later releases when triggered from a permitted
        // exemption context such as a high-priority FCM data push).
        // Miss it and the OS raises ForegroundServiceDidNotStartInTime
        // Exception on the main thread and the process is killed —
        // observed on the invitee device exactly 60 s after the
        // accept tap.
        //
        // The original code only called startForeground inside
        // showIncomingCallNotification (line ~667), which is reached
        // ONLY on the incoming_session / incoming_conference_request
        // branch. Every other branch (ACTION_ACCEPT_AUDIO/VIDEO,
        // cancel, ACTION_REJECT_CALL, handled-call dedup, missing
        // event/callId, null-intent) returned without ever satisfying
        // the contract.
        //
        // Post a silent MIN-importance placeholder up front so every
        // path is contract-compliant. Branches that subsequently call
        // showIncomingCallNotification will post their real CallStyle
        // notification on the high-importance CHANNEL_ID under a
        // different notification id, and we explicitly cancel the
        // placeholder there so the tray never shows both. Branches
        // that stopSelf() shortly after take the placeholder down
        // with them via the standard service-stop path.
        startCompliancePlaceholder();

        contactsByTag = getContactsByTag();

        if (intent == null || intent.getExtras() == null) {
            SylkLogger.w("[call] [service] Started with null intent, stop now");
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

		Bundle extras = intent.getExtras();
		if (extras != null) {
			for (String key : extras.keySet()) {
				SylkLogger.d("[call] [service] EXTRA: " + key + " = " + extras.get(key));
			}
		}

        String action = intent.getAction();
        String event = intent.getStringExtra("event");
        String callId = intent.getStringExtra("session-id");
        String to_uri = intent.getStringExtra("to_uri");
        String mediaType = intent.getStringExtra("media-type");
        String from_uri = intent.getStringExtra("from_uri");
        String remoteDisplayName = intent.getStringExtra("from_display_name");
        String displayName = intent.getStringExtra("displayName");

        boolean phoneLocked = intent.getBooleanExtra("phoneLocked", false);

        // App DND with no per-contact bypass: the FCM handler has decided
        // this push should be delivered silently. We still want the
        // notification UI, full-screen intent and Telecom hand-off; we
        // only want to skip audio and vibration.
        boolean suppressRingtone = intent.getBooleanExtra("suppress_ringtone", false);

		// Determine the caller name
		String callerName;
		
		if (displayName != null && !displayName.equalsIgnoreCase(from_uri)) {
			displayName = displayName;
		} else if (remoteDisplayName != null && !remoteDisplayName.equalsIgnoreCase(from_uri)) {
			displayName = remoteDisplayName;
		} else {
			displayName = from_uri;
		}

		int notificationId = Math.abs(callId.hashCode());

        if (callId == null) {
            SylkLogger.w("[call] [service] Missing callId");
            // Compliance placeholder was posted at the top of
            // onStartCommand to satisfy the foreground-service
            // contract; tear it down now that we're bailing.
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

		SylkLogger.w("[call] [service] onStartCommand " + event + " " + callId + " from " + from_uri + " " + displayName);
		//SylkLogger.w("[call] [service] phoneLocked " + phoneLocked);
		//SylkLogger.w("[call] [service] action " + action);
		//SylkLogger.w("[call] [service] displayName " + displayName);

        if (handledCalls.contains(callId)) {
			SylkLogger.d("[call] [service] Call " + callId + " already handled, skipping");
            // Same teardown as the null-callId path — the
            // compliance placeholder from the top of onStartCommand
            // would otherwise outlive us.
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
		}

        if ("cancel".equals(action) || "ACTION_REJECT_CALL".equals(action)) {
            SylkLogger.d("[call] [service] action received: " + action + " for " + callId);
			stopRingtone();
	        handledCalls.add(callId);
			// Cancel auto-answer if scheduled
			Runnable scheduled = autoAnswerRunnables.remove(callId);
			if (scheduled != null) {
				mainHandler.removeCallbacks(scheduled);
				SylkLogger.d("[call] [service] Canceled auto-answer for call: " + callId);
			}

			// Tell Telecom (and therefore the BT car kit / Android Auto) that
			// the call is over. "cancel" comes from FCM when the caller hung
			// up, ACTION_REJECT_CALL is a local rejection.
			int dc = "cancel".equals(action)
					? DisconnectCause.REMOTE
					: DisconnectCause.REJECTED;
			SylkTelecom.endCall(callId, dc);

			Intent closeActivityIntent = new Intent("ACTION_CLOSE_INCOMING_CALL_ACTIVITY");
			closeActivityIntent.putExtra("session-id", callId);
			LocalBroadcastManager.getInstance(this).sendBroadcast(closeActivityIntent);

            cancelNotification(notificationId);
			SylkLogger.d("[call] [service] Stop " + callId);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (event == null) {
            SylkLogger.w("[call] [service] Missing event");
            // Same teardown as the other malformed-intent early
            // returns above — the compliance placeholder posted at
            // the top of onStartCommand needs to come down with us.
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

		if ("ACTION_ACCEPT_AUDIO".equals(action) || "ACTION_ACCEPT_VIDEO".equals(action)) {
			SylkLogger.d("[call] [service] Starting app for accepted call " + callId + " from " + from_uri);
			stopRingtone();
			String acceptedMediaType = "ACTION_ACCEPT_AUDIO".equals(action) ? "audio" : "video";
			// Flip the Telecom Connection to ACTIVE so the BT car kit /
			// Android Auto switches from the ringing state to the in-call
			// state immediately, before the RN app has finished launching.
			SylkTelecom.setActive(callId);
			handleAcceptCall(callId, displayName, from_uri, to_uri, acceptedMediaType, Math.abs(callId.hashCode()), phoneLocked, event);
			return START_NOT_STICKY;
		}

		// Handle incoming session
		if ("incoming_session".equals(event) || "incoming_conference_request".equals(event)) {

			createCallNotificationChannel();
            startRingtone(from_uri, suppressRingtone);

			if ("incoming_session".equals(event) && isAutoAnswer(from_uri)) {
    			startAutoAnswerCountdownWithProgress(event, callId, from_uri, displayName, to_uri, mediaType, phoneLocked, notificationId, 20);
			}

			showIncomingCallNotification(event, callId, from_uri, displayName, to_uri, mediaType, phoneLocked, "");

			// Hand the call off to the Telecom framework as a self-managed
			// Connection. This is what makes the BT car-kit display the
			// "Incoming call from X" prompt, and what plumbs the call into
			// Android Auto. The CallStyle notification above still drives
			// the on-device lockscreen UI; the two paths run in parallel.
			SylkTelecom.presentIncomingCall(
					getApplicationContext(),
					callId,
					from_uri,
					displayName,
					mediaType);

			// Auto-cancel fallback after 60s
			autoCancelHandler = new Handler(Looper.getMainLooper());
			final String autoCancelCallId = callId;
			autoCancelRunnable = () -> {
				stopRingtone();
				SylkTelecom.endCall(autoCancelCallId, DisconnectCause.MISSED);
				cancelNotification(notificationId);
				SylkLogger.d("[call] [service] Stop " + autoCancelCallId);
				stopSelf();
			};

			autoCancelHandler.postDelayed(autoCancelRunnable, 60_000);
		}

		return START_STICKY;
    }

	private void showIncomingCallNotification(
			String event,
			String callId,
			String from_uri,
			String displayName,
			String to_uri,
			String mediaType,
			boolean phoneLocked,
			String countdownTitle
	) {

		String callerName = from_uri;
        String title = mediaType + " call from " + from_uri;
		
		if (displayName != null) {
			callerName = displayName;
		}
		
		String acceptAction = "ACTION_ACCEPT_AUDIO";
		
		if ("video".equalsIgnoreCase(mediaType)) {
			acceptAction = "ACTION_ACCEPT_VIDEO";
		}

		//SylkLogger.d("[call] [service] acceptAction = " + acceptAction);
		
		if ("incoming_conference_request".equals(event)) {
			if (callerName != null && callerName.toLowerCase().contains("anonymous")) {
				callerName = "Somebody";
			}

			if (callerName != null && callerName.toLowerCase().contains("@guest.")) {
				callerName = "Somebody";
			}

			String room = "";
			if (to_uri != null && to_uri.contains("@")) {
				room = to_uri.split("@")[0];
			}
			
			title = mediaType + " conference " + room;
		}

		title = title.substring(0, 1).toUpperCase() + title.substring(1);
		
		if (countdownTitle != null && !countdownTitle.isEmpty()) {
			if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
				title = countdownTitle;
			} else {
				title = callerName + " - " + countdownTitle;
			}
		}

		SylkLogger.d("[call] [service]" + title);
	
		int notificationId = Math.abs(callId.hashCode());
	
		// Fullscreen Intent (opens RN call screen)
		Intent fullScreenIntent = new Intent(this, IncomingCallActivity.class);
		fullScreenIntent.putExtra("session-id", callId);
		fullScreenIntent.putExtra("from_uri", from_uri);
		fullScreenIntent.putExtra("to_uri", to_uri);
		fullScreenIntent.putExtra("event", event);
		fullScreenIntent.putExtra("media-type", mediaType);
		fullScreenIntent.putExtra("phoneLocked", phoneLocked);
	
		fullScreenIntent.setFlags(
				Intent.FLAG_ACTIVITY_NEW_TASK |
				Intent.FLAG_ACTIVITY_CLEAR_TOP
		);
	
		PendingIntent fullScreenPendingIntent =
				PendingIntent.getActivity(
						this, notificationId,
						fullScreenIntent,
						PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
				);
	
		// Reject
		PendingIntent rejectIntent =
				PendingIntent.getBroadcast(
						this, notificationId + 100,
						new Intent(this, IncomingCallActionReceiver.class)
							.setAction("ACTION_REJECT_CALL")
							.putExtra("session-id", callId)
							.putExtra("from_uri", from_uri)
							.putExtra("to_uri", to_uri)
							.putExtra("event", event)
							.putExtra("media-type", mediaType)
							.putExtra("phoneLocked", phoneLocked)
							.putExtra("notification-id", notificationId),
							PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
				);
	
		// Accept
		PendingIntent acceptIntent =
				PendingIntent.getBroadcast(
						this, notificationId + 200,
						new Intent(this, IncomingCallActionReceiver.class)
							.setAction(acceptAction)
							.putExtra("session-id", callId)
							.putExtra("from_uri", from_uri) 
							.putExtra("to_uri", to_uri)
							.putExtra("event", event)
							.putExtra("media-type", mediaType)
							.putExtra("phoneLocked", phoneLocked)
							.putExtra("notification-id", notificationId),
							PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
				);
	
				NotificationCompat.Builder builder =
						new NotificationCompat.Builder(this, CHANNEL_ID)
								.setSmallIcon(R.drawable.ic_notification)
								.setCategory(NotificationCompat.CATEGORY_CALL)
								.setPriority(NotificationCompat.PRIORITY_HIGH)
								.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
								.setOngoing(true)
								.setContentText(title)
								.setAutoCancel(false)
								.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
		
		builder.setFullScreenIntent(fullScreenPendingIntent, true);

		// ---- Version-Specific Style ----
		/*
		Android Version	API Level	Constant
		Android 10	29	Q
		Android 11	30	R
		Android 12	31	S
		Android 13	33	TIRAMISU
		Android 14	34	UPSIDE_DOWN_CAKE
		Android 15	35	VANILLA_ICE_CREAM
		*/

		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
			if (Build.VERSION.SDK_INT == Build.VERSION_CODES.R) {
				callerName = title;
			}

			Person caller = new Person.Builder()
					.setName(callerName)
					.setImportant(true)
					.build();
	
			builder.setStyle(
					NotificationCompat.CallStyle.forIncomingCall(
							caller,
							rejectIntent,
							acceptIntent
					)
			);
	
		} else {
			builder
				.addAction(0, "Decline", rejectIntent)
				.addAction(0, "Answer", acceptIntent)
				.setStyle(new NotificationCompat.BigTextStyle().bigText(title));
		}
    		
		Notification notification = builder.build();

		// Swap the compliance placeholder for the real CallStyle
		// notification. startForeground() with a different
		// notification id makes the high-importance ringing
		// notification the active foreground one; we then dismiss
		// the placeholder explicitly so the tray doesn't briefly
		// show both. This is the normal "ringing" path; the
		// placeholder was only there to cover the gap between
		// startForegroundService() arriving and this real
		// notification being built.
		startForeground(notificationId, notification);
		NotificationManagerCompat.from(this).cancel(COMPLIANCE_NOTIFICATION_ID);
	}

	private void handleAcceptCall(String callId, String displayName, String from_uri, String to_uri, String mediaType, int notificationId, boolean phoneLocked, String event) {
		stopRingtone();

		if (callId == null) return;
	
		SylkLogger.d("[call] [service] handleAcceptCall called for call: " + callId + " phoneLocked: " + phoneLocked + " event " + event );
		SylkLogger.d("[call] [service] handleAcceptCall from_uri: " + from_uri);
		SylkLogger.d("[call] [service] handleAcceptCall to_uri: " + to_uri);
		SylkLogger.d("[call] [service] handleAcceptCall displayName: " + displayName);
		SylkLogger.d("[call] [service] handleAcceptCall mediaType: " + mediaType);
		
		String action = "ACTION_ACCEPT_AUDIO";
		if ("video".equalsIgnoreCase(mediaType)) {
			action = "ACTION_ACCEPT_VIDEO";
		}
	
		// Cancel any scheduled auto-answer countdown
		Runnable scheduled = autoAnswerRunnables.remove(callId);
		if (scheduled != null) {
			new Handler(Looper.getMainLooper()).removeCallbacks(scheduled);
			SylkLogger.d("[call] [service] Cancelled scheduled auto-answer for call: " + callId);
		}
	
		handledCalls.add(callId);
	
		cancelNotification(notificationId);
	
		SylkLogger.d("[call] [service] -- Launching Sylk app");
		Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
		if (launchIntent != null) {
			launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
			launchIntent.putExtra("session-id", callId);
			launchIntent.putExtra("from_uri", from_uri);
			launchIntent.putExtra("to_uri", to_uri);
			launchIntent.putExtra("media-type", mediaType);
			launchIntent.putExtra("event", event);
			launchIntent.putExtra("displayName", displayName);
			launchIntent.putExtra("phoneLocked", phoneLocked);
			startActivity(launchIntent);
			SylkLogger.d("[call] [service] RN app launched for call: " + callId);
		}

		// RN app alive → send event only
		if (getApplication() instanceof ReactApplication) {
			ReactEventEmitter.sendEventToReact(action, callId, from_uri, to_uri, false, event, (ReactApplication) getApplication());
			SylkLogger.d("[call] [service] Sent React Native event for call: " + callId);
		}

		// Drop both the compliance placeholder (always posted at the
		// top of onStartCommand) and any earlier ringing CallStyle
		// notification before stopping. stopSelf alone leaves the
		// foreground notification visible until the service-stop
		// completes, which on slower devices can flash a stale
		// "incoming call" notification AFTER the user has already
		// tapped Accept and is watching the RN app launch.
		stopForeground(true);
		NotificationManagerCompat.from(this).cancel(COMPLIANCE_NOTIFICATION_ID);
		stopSelf();
	}

	private boolean isAppInForeground() {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
			// Modern way using Lifecycle
			return ProcessLifecycleOwner.get().getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED);
		} else {
			ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
			List<ActivityManager.RunningAppProcessInfo> running = am.getRunningAppProcesses();
			if (running == null) return false;
			for (ActivityManager.RunningAppProcessInfo proc : running) {
				if (proc.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
						&& proc.processName.equals(getPackageName())) {
					return true;
				}
			}
			return false;
		}
	}

	private void startAutoAnswerCountdownWithProgress(
			String event,
			String callId,
			String from_uri,
			String displayName,
			String to_uri,
			String mediaType,
			boolean phoneLocked,
			int notificationId,
			int seconds
	) {
	
		final Handler handler = new Handler(Looper.getMainLooper());
		final long endTime = System.currentTimeMillis() + seconds * 1000L;
	
		Runnable countdownRunnable = new Runnable() {
			@Override
			public void run() {
	
				// Stop if handled externally
				if (handledCalls.contains(callId)) {
					SylkLogger.d("[call] [service] Countdown stopped for handled call " + callId);
					autoAnswerRunnables.remove(callId);
					return;
				}
	
				long remaining = (endTime - System.currentTimeMillis()) / 1000;
				if (remaining < 0) remaining = 0;

	            String countdownTitle = "Auto answering in " + remaining + "s";
	
				showIncomingCallNotification(event, callId, from_uri, displayName, to_uri, mediaType, phoneLocked, countdownTitle);
		
				if (remaining > 0) {
					handler.postDelayed(this, 1000);
				} else {
					SylkLogger.d("[call] [service] Countdown finished, auto-accepting call " + callId);
	
					handledCalls.add(callId);
					autoAnswerRunnables.remove(callId);
	
					handleAcceptCall(
							callId,
							displayName,
							from_uri,
							to_uri,
							mediaType,
							notificationId,
							phoneLocked,
							event
					);
				}
			}
		};
	
		autoAnswerRunnables.put(callId, countdownRunnable);
	
		SylkLogger.d("[call] [service] Scheduled auto-answer countdown for call "
				+ callId + " (" + seconds + "s)");
	
		handler.post(countdownRunnable);
	}
	
    private void cancelNotification(int notificationId) {
        if (autoCancelHandler != null && autoCancelRunnable != null) {
			//SylkLogger.d("[call] [service] Timer canceled: " + notificationId);
            autoCancelHandler.removeCallbacks(autoCancelRunnable);
            autoCancelHandler = null;
            autoCancelRunnable = null;
        }
        NotificationManagerCompat.from(this).cancel(notificationId);
        stopForeground(true);
        //SylkLogger.d("[call] [service] Notification canceled: " + notificationId);
    }

    @Override
    public void onDestroy() {
        if (autoCancelHandler != null && autoCancelRunnable != null) {
            autoCancelHandler.removeCallbacks(autoCancelRunnable);
        }
        //SylkLogger.d("[call] [service] Destroyed");
        stopForeground(true);
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
	
}
