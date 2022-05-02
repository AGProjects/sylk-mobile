package com.agprojects.sylk;

import android.content.Intent;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import io.wazo.callkeep.RNCallKeepModule;

import android.os.Bundle;
import android.system.ErrnoException;
import android.system.Os;
import java.io.File;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import org.devio.rn.splashscreen.SplashScreen;
import com.facebook.react.ReactActivity;
import android.util.Log;

import android.annotation.SuppressLint;
import android.os.Build;
import android.os.PowerManager;
import android.view.WindowManager;
 

public class MainActivity extends ReactActivity {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  @Override
  protected String getMainComponentName() {
    return "Sylk";
  }

  @Override
  public void invokeDefaultOnBackPressed() {
     // do not call super.invokeDefaultOnBackPressed() as it will close the app.  Instead lets just put it in the background.
     moveTaskToBack(true);
  }

  @Override
  public void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
  }

  @Override
  protected void onCreate(Bundle savedInstanceState){
    //SplashScreen.show(this);
    super.onCreate(savedInstanceState);
    try {
      Os.setenv("EXTERNAL_STORAGE", getExternalFilesDir(null).getAbsolutePath(), true);
      System.loadLibrary("indy");
    } catch (ErrnoException e) {
      e.printStackTrace();
    }
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
      super.onRequestPermissionsResult(requestCode, permissions, grantResults);
      switch (requestCode) {
          case RNCallKeepModule.REQUEST_READ_PHONE_STATE:
              RNCallKeepModule.onRequestPermissionsResult(requestCode, permissions, grantResults);
              break;
      }
  }
  
  @Override
  protected void onStart() {
     super.onStart();
     if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
       setShowWhenLocked(true);
       setTurnScreenOn(true);
     } else {
       PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
       PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.FULL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "myapp:wakeLock");
       wl.acquire();

       getWindow().addFlags(
               WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
               | WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
               | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
               | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
       );
     }
   }
}
