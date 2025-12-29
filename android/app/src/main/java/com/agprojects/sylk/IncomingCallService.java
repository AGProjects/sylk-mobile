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
			Log.d(LOG_TAG, "Ringtone started");
	
			if (vibrator != null && vibrator.hasVibrator() && ringerMode == AudioManager.RINGER_MODE_VIBRATE) {
				long[] pattern = {0, 1000, 3000}; // wait, vibrate, pause
				if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
					vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0)); // 0 = repeat
				} else {
					vibrator.vibrate(pattern, 0); // deprecated but works on older devices
				}
				Log.d(LOG_TAG, "Vibration started");
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
			Log.d(LOG_TAG, "Ringtone stopped");
		}
	
		// Stop vibration
		try {
			if (vibrator != null) {
				vibrator.cancel();
				Log.d(LOG_TAG, "Vibration stopped");
			}
		} catch (Exception e) {
			Log.e(LOG_TAG, "Error stopping vibration", e);
		}
		
		vibrator = null;
	}

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        contactsByTag = getContactsByTag();

		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
			NotificationManager nm = getSystemService(NotificationManager.class);
		
			// Check if channel exists
			NotificationChannel channel = nm.getNotificationChannel(CHANNEL_ID);
		
			// If channel exists but cannot bypass DND, delete and recreate
			if (channel == null) {
				if (channel != null) {
					nm.deleteNotificationChannel(CHANNEL_ID);
				}
		
				channel = new NotificationChannel(
						CHANNEL_ID,
						"Incoming Sylk Calls",
						NotificationManager.IMPORTANCE_HIGH
				);
				channel.setDescription("Sylk incoming call notifications");
				channel.setBypassDnd(true);
				channel.setSound(null, null);
				channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
		
				nm.createNotificationChannel(channel);
				Log.d(LOG_TAG, "Notification channel created with bypass DND");
			} else {
				//Log.d(LOG_TAG, "Channel exists, bypass DND: " + channel.canBypassDnd());
			}
		}

        if (intent == null || intent.getExtras() == null) {
            Log.w(LOG_TAG, "Started with null intent, stop now");
            return START_NOT_STICKY;
        }

		Bundle extras = intent.getExtras();
		if (extras != null) {
			for (String key : extras.keySet()) {
				Log.d(LOG_TAG, "  EXTRA: " + key + " = " + extras.get(key));
			}
		}

        // IncomingCallService → PendingIntent → BroadcastReceiver, from_uri is not being passed.

        String event = intent.getStringExtra("event");
        String callId = intent.getStringExtra("session-id");
        String from_uri = intent.getStringExtra("from_uri");
        String toUri = intent.getStringExtra("to_uri");
        String mediaType = intent.getStringExtra("media-type");
        boolean phoneLocked = intent.getBooleanExtra("phoneLocked", false);

        String title = "Sylk Incoming Call";
        String subtitle = from_uri + " is calling";
		int notificationId = Math.abs(callId.hashCode());

		Log.w(LOG_TAG, "onStartCommand " + event + " " + callId + " from " + from_uri);
		Log.w(LOG_TAG, "phoneLocked " + phoneLocked);

        if (callId == null || event == null) {
            Log.w(LOG_TAG, "Missing callId or event");
            return START_NOT_STICKY;
        }

        if (handledCalls.contains(callId)) {
			Log.d(LOG_TAG, "Call " + callId + " already handled, skipping");
            return START_NOT_STICKY;
		}

        if ("cancel".equals(event) || "ACTION_REJECT_CALL".equals(event)) {
            Log.d(LOG_TAG, "action received: " + event + " for " + callId);
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
           
		if ("ACTION_ACCEPT_AUDIO".equals(event) || "ACTION_ACCEPT_VIDEO".equals(event)) {		 
			Log.d(LOG_TAG, "Starting app for accepted call " + callId + " from " + from_uri);
			stopRingtone();
			String acceptedMediaType = "ACTION_ACCEPT_AUDIO".equals(event) ? "audio" : "video";
			handleAcceptCall(callId, from_uri, acceptedMediaType, Math.abs(callId.hashCode()), phoneLocked);
			return START_NOT_STICKY;
		}

		// Handle incoming session
		if ("incoming_session".equals(event) || "incoming_conference_request".equals(event)) {
            startRingtone(from_uri);
            
            if ("incoming_conference_request".equals(event)) {
				title = "Sylk Conference Call";
				String room = toUri.split("@")[0];
				String caller = from_uri;
				
				if (caller.contains("anonymous")) {
					caller = "Somebody";
				}

				if (caller.contains("@guest.")) {
					caller = "Somebody";
				}

				subtitle = caller + " is inviting you to the conference room " + room;
				Log.d(LOG_TAG, subtitle);
            }

			if (isAutoAnswer(from_uri)) {
    			startAutoAnswerCountdownWithProgress(callId, from_uri, mediaType, notificationId, 20, phoneLocked);
			}

            // Variant 1. This launches the main app when incoming call arrives (make sure RN app shows the alert panel)

            /*
			Intent fullScreenIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
			if (fullScreenIntent != null) {
				fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
			}
			
			PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
					this, notificationId, fullScreenIntent,
					PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
			);
			*/

            // Variant 2. This launches the fullscreen layout when incoming call arrives

  			Intent fullScreenIntent = new Intent(this, IncomingCallActivity.class);
			fullScreenIntent.putExtras(intent);
			fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
			
			PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
				this, notificationId, fullScreenIntent,
				PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
			);

            /*
			new Handler(Looper.getMainLooper()).post(() -> {
				Intent activityIntent = new Intent(this, IncomingCallActivity.class);
				activityIntent.putExtras(intent);
				activityIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
				startActivity(activityIntent);
			});
			*/

			
            // Variant 3. This launches the notifications bubble when incoming call arrives
            /*
			Intent fullScreenIntent = new Intent(this, IncomingCallFullScreenActivity.class);
			fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
			
			PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
					this, notificationId, fullScreenIntent,
					PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
			);
			*/

			// Reject button
			PendingIntent rejectPendingIntent = PendingIntent.getBroadcast(
					this, notificationId + 100,
					new Intent(this, IncomingCallActionReceiver.class)
							.setAction("ACTION_REJECT_CALL")
							.putExtra("session-id", callId)
							.putExtra("from_uri", from_uri) 
							.putExtra("phoneLocked", phoneLocked)
							.putExtra("notification-id", notificationId),
					PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
			);
		
			// Accept Audio button
			PendingIntent acceptAudioPendingIntent = PendingIntent.getBroadcast(
					this, notificationId + 200,
					new Intent(this, IncomingCallActionReceiver.class)
							.setAction("ACTION_ACCEPT_AUDIO")
							.putExtra("session-id", callId)
							.putExtra("from_uri", from_uri) 
							.putExtra("phoneLocked", phoneLocked)
							.putExtra("notification-id", notificationId),
					PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
			);
		
			// Accept Video button
			PendingIntent acceptVideoPendingIntent = PendingIntent.getBroadcast(
					this, notificationId + 300,
					new Intent(this, IncomingCallActionReceiver.class)
							.setAction("ACTION_ACCEPT_VIDEO")
							.putExtra("session-id", callId)
							.putExtra("from_uri", from_uri) 
							.putExtra("phoneLocked", phoneLocked)
							.putExtra("notification-id", notificationId),
					PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
			);
		
			// Build notification
			NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
					.setContentTitle(title)
					.setContentText(subtitle)
					.setSmallIcon(R.drawable.ic_notification)
					.setPriority(NotificationCompat.PRIORITY_HIGH)
					.setCategory(NotificationCompat.CATEGORY_CALL)
					.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
					.setOngoing(true)
					.setSound(null)
					.setFullScreenIntent(fullScreenPendingIntent, true)
					.setDefaults(0)
					.addAction(0, "Reject", rejectPendingIntent);
	
			builder.setStyle(new NotificationCompat.BigTextStyle()
				.bigText(subtitle));

            /*
			if (phoneLocked) { $
				builder.setFullScreenIntent(fullScreenPendingIntent, true); $
			} else {
				// Just a heads-up notification
				builder.setContentIntent(fullScreenPendingIntent);
			}
			*/

			builder.setGroup(null);

			if ("video".equalsIgnoreCase(mediaType)) {
				builder.addAction(0, "Audio only", acceptAudioPendingIntent);
				builder.addAction(0, "Video", acceptVideoPendingIntent);
			} else {
				builder.addAction(0, "Accept", acceptAudioPendingIntent);
			}
		
			builder.setGroup("call_" + callId);
			builder.setGroupSummary(false);
			Notification fullNotification = builder.build();
		
			// Show notification
			Log.d(LOG_TAG, "Show notification " + notificationId + " for " + callId);
			startForeground(notificationId, fullNotification);
		
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

	private void handleAcceptCall(String callId, String from_uri, String mediaType, int notificationId, boolean phoneLocked) {
		if (callId == null) return;
	
		Log.d(LOG_TAG, "handleAcceptCall called for call: " + callId + " phoneLocked: " + phoneLocked);
	
		stopRingtone();
	
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
			launchIntent.putExtra("media-type", mediaType);
			launchIntent.putExtra("event", "auto_accept");
			launchIntent.putExtra("phoneLocked", phoneLocked);
			startActivity(launchIntent);
			Log.d(LOG_TAG, "RN app launched for call: " + callId);
		}

		// RN app alive → send event only
		if (getApplication() instanceof ReactApplication) {
			ReactEventEmitter.sendEventToReact("ACTION_ACCEPT_AUDIO", callId, from_uri, false, (ReactApplication) getApplication());
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

	private void startAutoAnswerCountdownWithProgress(String callId, String from_uri, String mediaType, int notificationId, int seconds, boolean phoneLocked) {
		final Handler handler = new Handler(Looper.getMainLooper());
		final long endTime = System.currentTimeMillis() + seconds * 1000L;
	
		Runnable countdownRunnable = new Runnable() {
			@Override
			public void run() {
				// STOP if the call has been handled externally
				if (handledCalls.contains(callId)) {
					Log.d(LOG_TAG, "Countdown stopped because call " + callId + " is already handled");
					autoAnswerRunnables.remove(callId);
					return;
				}

				long remaining = (endTime - System.currentTimeMillis()) / 1000;
				if (remaining < 0) remaining = 0;
	
				//Log.d(LOG_TAG, "Auto-answer countdown for call " + callId + ": " + remaining + "s remaining");
	
				// Accept / Reject PendingIntents
				PendingIntent acceptIntent = PendingIntent.getBroadcast(
						IncomingCallService.this, notificationId + 200,
						new Intent(IncomingCallService.this, IncomingCallActionReceiver.class)
								.setAction("ACTION_ACCEPT_AUDIO")
								.putExtra("session-id", callId)
								.putExtra("from_uri", from_uri)
								.putExtra("phoneLocked", phoneLocked)
								.putExtra("notification-id", notificationId),
						PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
				);
	
				PendingIntent rejectIntent = PendingIntent.getBroadcast(
						IncomingCallService.this, notificationId + 100,
						new Intent(IncomingCallService.this, IncomingCallActionReceiver.class)
								.setAction("ACTION_REJECT_CALL")
								.putExtra("session-id", callId)
								.putExtra("from_uri", from_uri)
								.putExtra("phoneLocked", phoneLocked)
								.putExtra("notification-id", notificationId),
						PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
				);
	
				int progress = (int) (seconds - remaining);
	
				NotificationCompat.Builder builder = new NotificationCompat.Builder(
						IncomingCallService.this, CHANNEL_ID
				)
						.setContentTitle("Incoming Sylk Call")
						.setContentText(from_uri + " is calling")
						.setSmallIcon(R.drawable.ic_notification)
						.setPriority(NotificationCompat.PRIORITY_HIGH)
						.setCategory(NotificationCompat.CATEGORY_CALL)
						.setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
						.setOngoing(true)
						.setSound(null)
						.setDefaults(0)
						.setFullScreenIntent(null, true)
						.setProgress(seconds, progress, false)
						.setStyle(
							new NotificationCompat.BigTextStyle()
								.bigText(String.format("Auto accept call in %d seconds", remaining))
						)
						.addAction(0, "Reject", rejectIntent)
						.addAction(0, "Auto accept in " + remaining + "s", acceptIntent);
	
				NotificationManagerCompat.from(IncomingCallService.this)
						.notify(notificationId, builder.build());
	
				if (remaining > 0) {
					handler.postDelayed(this, 1000); // update every second
				} else {
					Log.d(LOG_TAG, "Countdown finished, auto-accepting call " + callId);
					handleAcceptCall(callId, from_uri, mediaType, notificationId, phoneLocked);
				}
			}
		};
	
		autoAnswerRunnables.put(callId, countdownRunnable);
		Log.d(LOG_TAG, "Scheduled auto-answer countdown for call " + callId + " (" + seconds + "s)");
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
        Log.d(LOG_TAG, "Notification canceled: " + notificationId);
    }

    @Override
    public void onDestroy() {
        if (autoCancelHandler != null && autoCancelRunnable != null) {
            autoCancelHandler.removeCallbacks(autoCancelRunnable);
        }
        //Log.d(LOG_TAG, "Destroyed");
        //stopForeground(true);
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
	
}
