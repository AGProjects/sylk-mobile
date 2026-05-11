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

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;


public class IncomingCallActivity extends AppCompatActivity {

    private static final String LOG_TAG = "SYLK_APP";
    private static final long TIMEOUT_MS = 60 * 1000; // 60 seconds

    private String callId;
    private int notificationId;
    private String mediaType;
    private String from_uri;
    private String to_uri;
    private String event;
    private boolean phoneLocked;

    private Handler timeoutHandler = new Handler(Looper.getMainLooper());
    private Runnable timeoutRunnable;

    private final BroadcastReceiver closeReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {

            String sessionId = intent.getStringExtra("session-id");
            Log.d(LOG_TAG, "[CallUI] closeReceiver triggered for session: " + sessionId);
            Log.d(LOG_TAG, "[CallUI] existing callId: " + callId);
			Bundle extras = intent.getExtras();
			if (extras != null) {
				for (String key : extras.keySet()) {
					Log.d(LOG_TAG, "[CallUI]   EXTRA: " + key + " = " + extras.get(key));
				}
			}

            if (callId != null && callId.equals(sessionId)) {
                Log.d(LOG_TAG, "[CallUI] Closing IncomingCallActivity due to remote cancel");
                finish();
            }
        }
    };

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
		Log.d(LOG_TAG, "[CallUI] IncomingCallActivity onCreate");

        // Check if device is locked
        KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (keyguardManager != null && !keyguardManager.isKeyguardLocked()) {
            Log.d(LOG_TAG, "[CallUI] Phone is unlocked, skip alert panel");
            finish();
            return;
        } else {
            Log.d(LOG_TAG, "[CallUI] Phone is locked");
        }

        setContentView(R.layout.activity_incoming_call);

        if (getIntent() != null) {
            callId = getIntent().getStringExtra("session-id");
            notificationId = Math.abs(callId != null ? callId.hashCode() : 0);
            mediaType = getIntent().getStringExtra("media-type");
            from_uri = getIntent().getStringExtra("from_uri");
            to_uri = getIntent().getStringExtra("to_uri");
            event = getIntent().getStringExtra("event");
            phoneLocked = getIntent().getBooleanExtra("phoneLocked", false);
        }

        Log.d(LOG_TAG, "[CallUI] IncomingCallActivity phoneLocked=" + phoneLocked);
        Log.d(LOG_TAG, "[CallUI] IncomingCallActivity mediaType=" + mediaType);

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
			Log.e(LOG_TAG, "[CallUI] Error fetching display_name from DB", e);
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

		TextView callingLabel = findViewById(R.id.callingLabelText);
		callingLabel.setText("is calling");

		// Show the full SIP URI under the "is calling" line. Hide it if the
		// displayed name is already the URI (no contact match) so we don't
		// duplicate the same string.
		TextView callerUri = findViewById(R.id.callerUriText);
		if (from_uri != null && !from_uri.equals(displayName)) {
			callerUri.setText(from_uri);
			callerUri.setVisibility(android.view.View.VISIBLE);
		} else {
			callerUri.setVisibility(android.view.View.GONE);
		}

		// Single Accept / Decline pair. Accept honours the call's media-type:
		// a video call accepts as video, anything else as audio. The in-app
		// UI handles the rest after the SIP session is connected.
		Button acceptButton = findViewById(R.id.acceptButton);
		Button declineButton = findViewById(R.id.declineButton);

		final String acceptAction = "video".equalsIgnoreCase(mediaType)
				? "ACTION_ACCEPT_VIDEO"
				: "ACTION_ACCEPT_AUDIO";

		acceptButton.setOnClickListener(v -> sendAcceptIntent(acceptAction));
		declineButton.setOnClickListener(v -> sendRejectIntent());

        Log.d(LOG_TAG, "[CallUI] IncomingCallActivity alert panel displayed");

	}

	// Utility methods
	private void sendRejectIntent() {
		Log.d(LOG_TAG, "[CallUI] Reject pressed for call: " + callId);
	
		Intent intent = new Intent(this, IncomingCallActionReceiver.class)
				.setAction("ACTION_REJECT_CALL")
				.putExtra("session-id", callId)
				.putExtra("phoneLocked", phoneLocked)
				.putExtra("from_uri", from_uri)
				.putExtra("event", event)
				.putExtra("media-type", mediaType)
				.putExtra("to_uri", to_uri)
				.putExtra("notification-id", notificationId);
	
		sendBroadcast(intent);
		finish();
	}

	private void sendAcceptIntent(String action) {
		Log.d(LOG_TAG, "[CallUI] Accept pressed for call: " + callId + ", action: " + action);
		Intent intent = new Intent(this, IncomingCallActionReceiver.class)
				.setAction(action)
				.putExtra("session-id", callId)
				.putExtra("phoneLocked", phoneLocked ? "true" : "false")
				.putExtra("from_uri", from_uri)
				.putExtra("media-type", mediaType)
				.putExtra("event", event)
				.putExtra("to_uri", to_uri)
				.putExtra("notification-id", notificationId);
	
		sendBroadcast(intent);
		finish();
	}

    @Override
    protected void onResume() {
        super.onResume();
        // Register the close receiver
        //Log.d(LOG_TAG, "onResume");
        IntentFilter filter = new IntentFilter("ACTION_CLOSE_INCOMING_CALL_ACTIVITY");
        LocalBroadcastManager.getInstance(this).registerReceiver(closeReceiver, filter);

        // Schedule the auto-dismiss after 60 seconds
        timeoutRunnable = () -> {
            Log.d(LOG_TAG, "[CallUI] Timeout reached, dismissing IncomingCallActivity for call: " + callId);
            finish();
        };
        timeoutHandler.postDelayed(timeoutRunnable, TIMEOUT_MS);
    }

    @Override
    protected void onPause() {
        super.onPause();
        LocalBroadcastManager.getInstance(this).unregisterReceiver(closeReceiver);
        //Log.d(LOG_TAG, "onPause");

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
