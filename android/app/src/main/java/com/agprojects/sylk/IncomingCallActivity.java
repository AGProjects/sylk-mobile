package com.agprojects.sylk;

import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.Button;
import android.widget.TextView;

import java.io.File;

import android.view.View;
import android.widget.LinearLayout;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;


public class IncomingCallActivity extends AppCompatActivity {

    private static final String LOG_TAG = "[SYLK_ACTIVITY]";
    private static final long TIMEOUT_MS = 60 * 1000; // 60 seconds

    private String callId;
    private int notificationId;
    private String mediaType;
    private String from_uri;
    private boolean phoneLocked;

    private Handler timeoutHandler = new Handler(Looper.getMainLooper());
    private Runnable timeoutRunnable;

    private final BroadcastReceiver closeReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String sessionId = intent.getStringExtra("session-id");
            Log.d(LOG_TAG, "closeReceiver triggered for session: " + sessionId);
            if (callId != null && callId.equals(sessionId)) {
                Log.d(LOG_TAG, "Closing IncomingCallActivity due to remote cancel");
                finish();
            }
        }
    };

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Check if device is locked
        KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (keyguardManager != null && !keyguardManager.isKeyguardLocked()) {
            Log.d(LOG_TAG, "Phone is unlocked, skipping layout display.");
            finish();
            return;
        } else {
            Log.d(LOG_TAG, "Phone is locked");
        }

        setContentView(R.layout.activity_incoming_call);

        if (getIntent() != null) {
            callId = getIntent().getStringExtra("session-id");
            notificationId = Math.abs(callId != null ? callId.hashCode() : 0);
            mediaType = getIntent().getStringExtra("media-type");
            from_uri = getIntent().getStringExtra("from_uri");
            phoneLocked = getIntent().getBooleanExtra("phoneLocked", false);
        }

        Log.d(LOG_TAG, "IncomingCallActivity phoneLocked=" + phoneLocked);

        String displayName = null;
		Cursor cursor = null;
		try {
			File dbFile = getApplicationContext().getDatabasePath("sylk.db");
			SQLiteDatabase db = SQLiteDatabase.openDatabase(
					dbFile.getPath(),
					null,
					SQLiteDatabase.OPEN_READONLY
			);
			String query = "SELECT * FROM contacts WHERE uri = ?";
			cursor = db.rawQuery(query, new String[]{from_uri}); // use parameterized query to avoid SQL injection
			if (cursor != null && cursor.moveToFirst()) {
				displayName = cursor.getString(cursor.getColumnIndexOrThrow("name"));
			}
		} catch (Exception e) {
			Log.e(LOG_TAG, "Error fetching display_name from DB", e);
		} finally {
			if (cursor != null) {
				cursor.close();
			}
		}

		if (displayName == null || displayName.trim().isEmpty()) {
			displayName = from_uri;
		}

        // Caller name / info
        TextView callerText = findViewById(R.id.callerNameText);
        callerText.setText(displayName);

		// Buttons
		// Inside onCreate after initializing mediaType
		LinearLayout audioContainer = findViewById(R.id.audioButtonContainer);
		LinearLayout videoContainer = findViewById(R.id.videoButtonContainer);
		
		Button acceptButton = findViewById(R.id.acceptButton);
		Button rejectButtonAudio = findViewById(R.id.rejectButtonAudio);
		
		Button acceptAudioButton = findViewById(R.id.acceptAudioButton);
		Button acceptVideoButton = findViewById(R.id.acceptVideoButton);
		Button rejectButtonVideo = findViewById(R.id.rejectButtonVideo);
		
		TextView callingLabel = findViewById(R.id.callingLabelText);
		callingLabel.setText("is calling");

		// Show correct container
		if ("video".equals(mediaType)) {
			videoContainer.setVisibility(View.VISIBLE);
			audioContainer.setVisibility(View.GONE);
		
			acceptAudioButton.setOnClickListener(v -> sendAcceptIntent("ACTION_ACCEPT_AUDIO"));
			acceptVideoButton.setOnClickListener(v -> sendAcceptIntent("ACTION_ACCEPT_VIDEO"));
			rejectButtonVideo.setOnClickListener(v -> sendRejectIntent());
		
		} else {
			audioContainer.setVisibility(View.VISIBLE);
			videoContainer.setVisibility(View.GONE);
		
			acceptButton.setOnClickListener(v -> sendAcceptIntent("ACTION_ACCEPT_AUDIO"));
			rejectButtonAudio.setOnClickListener(v -> sendRejectIntent());
		}
	}

	// Utility methods
	private void sendRejectIntent() {
		Log.d(LOG_TAG, "Reject pressed for call: " + callId);
	
		Intent intent = new Intent(this, IncomingCallActionReceiver.class)
				.setAction("ACTION_REJECT_CALL")
				.putExtra("session-id", callId)
				.putExtra("phoneLocked", phoneLocked)
				.putExtra("from_uri", from_uri)
				.putExtra("notification-id", notificationId);
	
		sendBroadcast(intent);
		finish();
	}

	private void sendAcceptIntent(String action) {
		Log.d(LOG_TAG, "Accept pressed for call: " + callId + ", action: " + action);
	
		Intent intent = new Intent(this, IncomingCallActionReceiver.class)
				.setAction(action)
				.putExtra("session-id", callId)
				.putExtra("phoneLocked", phoneLocked ? "true" : "false")
				.putExtra("from_uri", from_uri)
				.putExtra("notification-id", notificationId);
	
		sendBroadcast(intent);
		finish();
	}

    @Override
    protected void onResume() {
        super.onResume();
        // Register the close receiver
        IntentFilter filter = new IntentFilter("ACTION_CLOSE_INCOMING_CALL_ACTIVITY");
        LocalBroadcastManager.getInstance(this).registerReceiver(closeReceiver, filter);

        // Schedule the auto-dismiss after 60 seconds
        timeoutRunnable = () -> {
            Log.d(LOG_TAG, "Timeout reached, dismissing IncomingCallActivity for call: " + callId);
            finish();
        };
        timeoutHandler.postDelayed(timeoutRunnable, TIMEOUT_MS);
    }

    @Override
    protected void onPause() {
        super.onPause();
        LocalBroadcastManager.getInstance(this).unregisterReceiver(closeReceiver);

        // Remove timeout callbacks to avoid leaks
        if (timeoutRunnable != null) {
            timeoutHandler.removeCallbacks(timeoutRunnable);
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
    }
}
