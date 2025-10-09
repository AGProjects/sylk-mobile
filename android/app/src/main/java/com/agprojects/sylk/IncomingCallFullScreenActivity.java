package com.agprojects.sylk;

import android.app.Activity;
import android.os.Bundle;

public class IncomingCallFullScreenActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Just finish immediately; the notification handles the UI
        finish();
    }
}
