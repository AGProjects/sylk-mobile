package com.agprojects.sylk;

import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
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
            SylkLogger.d("[call] [ui] closeReceiver triggered for session: " + sessionId);
            SylkLogger.d("[call] [ui] existing callId: " + callId);
			Bundle extras = intent.getExtras();
			if (extras != null) {
				for (String key : extras.keySet()) {
					SylkLogger.d("[call] [ui] EXTRA: " + key + " = " + extras.get(key));
				}
			}

            if (callId != null && callId.equals(sessionId)) {
                SylkLogger.d("[call] [ui] Closing IncomingCallActivity due to remote cancel");
                finish();
            }
        }
    };

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
		SylkLogger.d("[call] [ui] IncomingCallActivity onCreate");

        // Check if device is locked
        KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (keyguardManager != null && !keyguardManager.isKeyguardLocked()) {
            SylkLogger.d("[call] [ui] Phone is unlocked, skip alert panel");
            finish();
            return;
        } else {
            SylkLogger.d("[call] [ui] Phone is locked");
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

        SylkLogger.d("[call] [ui] IncomingCallActivity phoneLocked=" + phoneLocked);
        SylkLogger.d("[call] [ui] IncomingCallActivity mediaType=" + mediaType);

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
			SylkLogger.e("[call] [ui] Error fetching display_name from DB", e);
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

		// On foldables (e.g. Galaxy Z Fold / Razr) the lock-screen overlay can
		// be shown on the narrow cover display. The default 220dp logo plus
		// 48dp buttons with an 80dp bottom margin overflow that ~300–380dp
		// canvas. Detect the cover-display width and shrink the central logo,
		// the bottom button bar and the top notification bubble so everything
		// fits without scrolling/clipping.
		applyFoldedScalingIfNeeded();

        SylkLogger.d("[call] [ui] IncomingCallActivity alert panel displayed");

	}

	/**
	 * Detect a narrow (folded cover) screen and rescale the central Sylk
	 * logo + Accept/Decline buttons so the overlay fits. We base the check on
	 * the smallest screen dimension in dp: a typical phone is ≥ 360dp wide,
	 * Galaxy Z Fold cover ≈ 320dp, Razr cover ≈ 373dp. Anything ≤ 400dp gets
	 * the compact treatment so we comfortably cover all current cover
	 * displays without affecting normal phones.
	 */
	private void applyFoldedScalingIfNeeded() {
		try {
			DisplayMetrics metrics = getResources().getDisplayMetrics();
			float density = metrics.density;
			float widthDp = metrics.widthPixels / density;
			float heightDp = metrics.heightPixels / density;
			float smallestDp = Math.min(widthDp, heightDp);

			boolean isFolded = smallestDp <= 400f;
			SylkLogger.d("[call] [ui] IncomingCallActivity widthDp=" + widthDp
					+ " heightDp=" + heightDp
					+ " smallestDp=" + smallestDp
					+ " isFolded=" + isFolded);

			if (!isFolded) {
				return;
			}

			ImageView logo = findViewById(R.id.appLogo);
			if (logo != null) {
				// 220dp → ~120dp on cover display.
				int logoPx = dpToPx(120);
				ViewGroup.LayoutParams lp = logo.getLayoutParams();
				lp.width = logoPx;
				lp.height = logoPx;
				logo.setLayoutParams(lp);
			}

			LinearLayout buttonContainer = findViewById(R.id.buttonContainer);
			if (buttonContainer != null) {
				ViewGroup.LayoutParams blp = buttonContainer.getLayoutParams();
				if (blp instanceof ViewGroup.MarginLayoutParams) {
					// 80dp → 32dp keeps the buttons clear of the bottom edge
					// without taking up half the cover display.
					((ViewGroup.MarginLayoutParams) blp).bottomMargin = dpToPx(32);
					buttonContainer.setLayoutParams(blp);
				}
			}

			// Shrink the Accept / Decline buttons themselves: 140x48 dp is too
			// wide for ~320dp cover screens (two buttons + 32dp gap overflow).
			int btnWidthPx = dpToPx(108);
			int btnHeightPx = dpToPx(40);
			int btnSidePx = dpToPx(8);

			View acceptBtn = findViewById(R.id.acceptButton);
			View declineBtn = findViewById(R.id.declineButton);
			if (acceptBtn != null) {
				ViewGroup.LayoutParams alp = acceptBtn.getLayoutParams();
				alp.width = btnWidthPx;
				alp.height = btnHeightPx;
				if (alp instanceof ViewGroup.MarginLayoutParams) {
					((ViewGroup.MarginLayoutParams) alp).setMarginStart(btnSidePx);
				}
				acceptBtn.setLayoutParams(alp);
				if (acceptBtn instanceof Button) {
					((Button) acceptBtn).setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
				}
			}
			if (declineBtn != null) {
				ViewGroup.LayoutParams dlp = declineBtn.getLayoutParams();
				dlp.width = btnWidthPx;
				dlp.height = btnHeightPx;
				if (dlp instanceof ViewGroup.MarginLayoutParams) {
					((ViewGroup.MarginLayoutParams) dlp).setMarginEnd(btnSidePx);
				}
				declineBtn.setLayoutParams(dlp);
				if (declineBtn instanceof Button) {
					((Button) declineBtn).setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
				}
			}

			// Tighten the top notification bubble so the caller name row also
			// fits inside the narrow canvas — drop its top margin and side
			// padding a bit.
			View bubble = findViewById(R.id.notificationBubble);
			if (bubble != null) {
				ViewGroup.LayoutParams nlp = bubble.getLayoutParams();
				if (nlp instanceof ViewGroup.MarginLayoutParams) {
					ViewGroup.MarginLayoutParams mlp = (ViewGroup.MarginLayoutParams) nlp;
					mlp.topMargin = dpToPx(16);
					mlp.leftMargin = dpToPx(4);
					mlp.rightMargin = dpToPx(4);
					bubble.setLayoutParams(mlp);
				}
				int padPx = dpToPx(10);
				bubble.setPadding(padPx, padPx, padPx, padPx);
			}
		} catch (Exception e) {
			SylkLogger.e("[call] [ui] applyFoldedScalingIfNeeded failed", e);
		}
	}

	private int dpToPx(int dp) {
		float density = getResources().getDisplayMetrics().density;
		return Math.round(dp * density);
	}

	// Utility methods
	private void sendRejectIntent() {
		SylkLogger.d("[call] [ui] Reject pressed for call: " + callId);
	
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
		SylkLogger.d("[call] [ui] Accept pressed for call: " + callId + ", action: " + action);
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
        //SylkLogger.d("[call] [ui] onResume");
        IntentFilter filter = new IntentFilter("ACTION_CLOSE_INCOMING_CALL_ACTIVITY");
        LocalBroadcastManager.getInstance(this).registerReceiver(closeReceiver, filter);

        // Schedule the auto-dismiss after 60 seconds
        timeoutRunnable = () -> {
            SylkLogger.d("[call] [ui] Timeout reached, dismissing IncomingCallActivity for call: " + callId);
            finish();
        };
        timeoutHandler.postDelayed(timeoutRunnable, TIMEOUT_MS);
    }

    @Override
    protected void onPause() {
        super.onPause();
        LocalBroadcastManager.getInstance(this).unregisterReceiver(closeReceiver);
        //SylkLogger.d("[call] [ui] onPause");

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
