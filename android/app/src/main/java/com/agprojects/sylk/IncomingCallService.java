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
import android.content.Context;
import java.util.ArrayList;
import java.util.List;

import android.os.Vibrator;
import android.os.VibrationEffect;

import androidx.localbroadcastmanager.content.LocalBroadcastManager;
import androidx.lifecycle.ProcessLifecycleOwner;
import android.content.Context;



public class IncomingCallService extends Service {

    public static final String CHANNEL_ID = "incoming-sylk-calls";
    public static final Set<String> handledCalls = new HashSet<>();
    private static final String LOG_TAG = "[SYLK CALL SERVICE]";
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
	
		try {
			File dbFile = getApplicationContext().getDatabasePath("sylk.db");
			if (!dbFile.exists()) {
				Log.e(LOG_TAG, "Database file not found: " + dbFile.getAbsolutePath());
				// still put empty lists in the map
				result.put("favorites", favorites);
				result.put("autoanswer", autoanswer);
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
					}
				}
				cursor.close();
			}
	
			db.close();
		} catch (Exception e) {
			Log.e(LOG_TAG, "Failed to read contacts from database", e);
		}
	
		result.put("favorites", favorites);
		result.put("autoanswer", autoanswer);
	
		return result;
	}

	private boolean isFavorite(String from_uri) {
		if (from_uri == null) return false;
		List<String> favorites = contactsByTag.get("favorites");
		return favorites != null && favorites.contains(from_uri);
	}
	
	private boolean isAutoAnswer(String from_uri) {
		if (from_uri == null) return false;
		List<String> autoanswer = contactsByTag.get("autoanswer");
		return autoanswer != null && autoanswer.contains(from_uri);
	}	

	private void startRingtone(String from_uri) {
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
		
		Log.d(LOG_TAG, "Current ringer mode: " + modeString);

		boolean isFavorite = isFavorite(from_uri);
	
		// Check ringer mode
		if (!isFavorite && ringerMode == AudioManager.RINGER_MODE_SILENT) {
			Log.d(LOG_TAG, "Do Not Disturb or silent mode, not playing ringtone");
			return;
		}
	
		try {
			// Start ringtone
			Uri ringtoneUri = Settings.System.DEFAULT_RINGTONE_URI; // default ringtone
			ringtonePlayer = new MediaPlayer();
			ringtonePlayer.setDataSource(this, ringtoneUri);
			ringtonePlayer.setAudioAttributes(
				new AudioAttributes.Builder()
					.setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
					.setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
					.build()
			);
			ringtonePlayer.setLooping(true);
			ringtonePlayer.setVolume(1.0f, 1.0f);
			ringtonePlayer.prepare();
			ringtonePlayer.start();
			//Log.d(LOG_TAG, "Ringtone started");
	
			if (vibrator != null && vibrator.hasVibrator() && ringerMode == AudioManager.RINGER_MODE_VIBRATE) {
				long[] pattern = {0, 1000, 3000}; // wait, vibrate, pause
				if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
					vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0)); // 0 = repeat
				} else {
					vibrator.vibrate(pattern, 0); // deprecated but works on older devices
				}
				//Log.d(LOG_TAG, "Vibration started");
			} else {
				//Log.d(LOG_TAG, "Not vibrating (ringer mode not VIBRATE or vibrator missing)");
			}
	
		} catch (Exception e) {
			Log.e(LOG_TAG, "Failed to start ringtone/vibration", e);
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
			//Log.d(LOG_TAG, "Ringtone stopped");
		}
	
		// Stop vibration
		try {
			if (vibrator != null) {
				vibrator.cancel();
				//Log.d(LOG_TAG, "Vibration stopped");
			}
		} catch (Exception e) {
			Log.e(LOG_TAG, "Error stopping vibration", e);
		}
		
		vibrator = null;
	}

	private void createCallNotificationChannel() {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			NotificationManager nm = getSystemService(NotificationManager.class);
	
			NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
			if (existing != null) {
				nm.deleteNotificationChannel(CHANNEL_ID);
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
        contactsByTag = getContactsByTag();
        
        if (intent == null || intent.getExtras() == null) {
            Log.w(LOG_TAG, "Started with null intent, stop now");
            return START_NOT_STICKY;
        }

		Bundle extras = intent.getExtras();
		if (extras != null) {
			for (String key : extras.keySet()) {
				//Log.d(LOG_TAG, "  EXTRA: " + key + " = " + extras.get(key));
			}
		}

        String action = intent.getAction();
        String event = intent.getStringExtra("event");
        String callId = intent.getStringExtra("session-id");
        String from_uri = intent.getStringExtra("from_uri");
        String to_uri = intent.getStringExtra("to_uri");
        String mediaType = intent.getStringExtra("media-type");
        String displayName = intent.getStringExtra("from_display_name");
        boolean phoneLocked = intent.getBooleanExtra("phoneLocked", false);

		int notificationId = Math.abs(callId.hashCode());

        if (callId == null) {
            Log.w(LOG_TAG, "Missing callId");
            return START_NOT_STICKY;
        }

		Log.w(LOG_TAG, "onStartCommand " + event + " " + callId + " from " + from_uri + " " + displayName);
		//Log.w(LOG_TAG, "phoneLocked " + phoneLocked);
		//Log.w(LOG_TAG, "action " + action);
		//Log.w(LOG_TAG, "displayName " + displayName);

        if (handledCalls.contains(callId)) {
			Log.d(LOG_TAG, "Call " + callId + " already handled, skipping");
            return START_NOT_STICKY;
		}

        if ("cancel".equals(action) || "ACTION_REJECT_CALL".equals(action)) {
            Log.d(LOG_TAG, "action received: " + action + " for " + callId);
			stopRingtone();
	        handledCalls.add(callId);
			// Cancel auto-answer if scheduled
			Runnable scheduled = autoAnswerRunnables.remove(callId);
			if (scheduled != null) {
				mainHandler.removeCallbacks(scheduled);
				Log.d(LOG_TAG, "Canceled auto-answer for call: " + callId);
			}

			Intent closeActivityIntent = new Intent("ACTION_CLOSE_INCOMING_CALL_ACTIVITY");
			closeActivityIntent.putExtra("session-id", callId);
			LocalBroadcastManager.getInstance(this).sendBroadcast(closeActivityIntent);
    
            cancelNotification(notificationId);
			Log.d(LOG_TAG, "Stop " + callId);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (event == null) {
            Log.w(LOG_TAG, "Missing event");
            return START_NOT_STICKY;
        }
           
		if ("ACTION_ACCEPT_AUDIO".equals(action) || "ACTION_ACCEPT_VIDEO".equals(action)) {		 
			Log.d(LOG_TAG, "Starting app for accepted call " + callId + " from " + from_uri);
			stopRingtone();
			String acceptedMediaType = "ACTION_ACCEPT_AUDIO".equals(action) ? "audio" : "video";
			handleAcceptCall(callId, from_uri, to_uri, acceptedMediaType, Math.abs(callId.hashCode()), phoneLocked, event);
			return START_NOT_STICKY;
		}

		// Handle incoming session
		if ("incoming_session".equals(event) || "incoming_conference_request".equals(event)) {

			createCallNotificationChannel();
            startRingtone(from_uri);
            
			if ("incoming_session".equals(event) && isAutoAnswer(from_uri)) {
    			startAutoAnswerCountdownWithProgress(event, callId, from_uri, displayName, to_uri, mediaType, phoneLocked, notificationId, 20);
			}

			showIncomingCallNotification(event, callId, from_uri, displayName, to_uri, mediaType, phoneLocked, "");

			// Auto-cancel fallback after 60s
			autoCancelHandler = new Handler(Looper.getMainLooper());
			autoCancelRunnable = () -> {
				stopRingtone();
				cancelNotification(notificationId);
				Log.d(LOG_TAG, "Stop " + callId);
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
        String title = mediaType + " call from ";
		
		if (displayName != null) {
			callerName = displayName;
		}

		title = title + callerName;
		
		String acceptAction = "ACTION_ACCEPT_AUDIO";
		
		if ("video".equalsIgnoreCase(mediaType)) {
			acceptAction = "ACTION_ACCEPT_VIDEO";
		}

		//Log.d(LOG_TAG, "acceptAction = " + acceptAction);
		
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

		Log.d(LOG_TAG, title);
	
		int notificationId = Math.abs(callId.hashCode());
	
		// Fullscreen Intent (opens RN call screen)
		Intent fullScreenIntent = new Intent(this, IncomingCallActivity.class);
		fullScreenIntent.putExtra("session-id", callId);
		fullScreenIntent.putExtra("from_uri", from_uri);
		fullScreenIntent.putExtra("to_uri", to_uri);
		fullScreenIntent.putExtra("event", event);
	
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
		
		startForeground(notificationId, notification);
	}

	private void handleAcceptCall(String callId, String from_uri, String to_uri, String mediaType, int notificationId, boolean phoneLocked, String event) {
		stopRingtone();

		if (callId == null) return;
	
		Log.d(LOG_TAG, "handleAcceptCall called for call: " + callId + " phoneLocked: " + phoneLocked + " event " + event );
		Log.d(LOG_TAG, "handleAcceptCall from_uri: " + from_uri);
		Log.d(LOG_TAG, "handleAcceptCall to_uri: " + to_uri);
		Log.d(LOG_TAG, "handleAcceptCall mediaType: " + mediaType);
		
		String action = "ACTION_ACCEPT_AUDIO";
		if ("video".equalsIgnoreCase(mediaType)) {
			action = "ACTION_ACCEPT_VIDEO";
		}
	
		// Cancel any scheduled auto-answer countdown
		Runnable scheduled = autoAnswerRunnables.remove(callId);
		if (scheduled != null) {
			new Handler(Looper.getMainLooper()).removeCallbacks(scheduled);
			Log.d(LOG_TAG, "Cancelled scheduled auto-answer for call: " + callId);
		}
	
		handledCalls.add(callId);
	
		cancelNotification(notificationId);
	
		Log.d(LOG_TAG, "-- Launching Sylk app");
		Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
		if (launchIntent != null) {
			launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
			launchIntent.putExtra("session-id", callId);
			launchIntent.putExtra("from_uri", from_uri);
			launchIntent.putExtra("to_uri", to_uri);
			launchIntent.putExtra("media-type", mediaType);
			launchIntent.putExtra("event", event);
			launchIntent.putExtra("phoneLocked", phoneLocked);
			startActivity(launchIntent);
			Log.d(LOG_TAG, "RN app launched for call: " + callId);
		}

		// RN app alive → send event only
		if (getApplication() instanceof ReactApplication) {
			ReactEventEmitter.sendEventToReact(action, callId, from_uri, to_uri, false, event, (ReactApplication) getApplication());
			Log.d(LOG_TAG, "Sent React Native event for call: " + callId);
		}
	
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
					Log.d(LOG_TAG, "Countdown stopped for handled call " + callId);
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
					Log.d(LOG_TAG, "Countdown finished, auto-accepting call " + callId);
	
					handledCalls.add(callId);
					autoAnswerRunnables.remove(callId);
	
					handleAcceptCall(
							callId,
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
	
		Log.d(LOG_TAG, "Scheduled auto-answer countdown for call "
				+ callId + " (" + seconds + "s)");
	
		handler.post(countdownRunnable);
	}
	
    private void cancelNotification(int notificationId) {
        if (autoCancelHandler != null && autoCancelRunnable != null) {
			//Log.d(LOG_TAG, "Timer canceled: " + notificationId);
            autoCancelHandler.removeCallbacks(autoCancelRunnable);
            autoCancelHandler = null;
            autoCancelRunnable = null;
        }
        NotificationManagerCompat.from(this).cancel(notificationId);
        stopForeground(true);
        //Log.d(LOG_TAG, "Notification canceled: " + notificationId);
    }

    @Override
    public void onDestroy() {
        if (autoCancelHandler != null && autoCancelRunnable != null) {
            autoCancelHandler.removeCallbacks(autoCancelRunnable);
        }
        //Log.d(LOG_TAG, "Destroyed");
        stopForeground(true);
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
	
}
