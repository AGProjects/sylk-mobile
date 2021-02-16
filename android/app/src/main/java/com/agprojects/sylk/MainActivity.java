// SPDX-FileCopyrightText: 2020, AG Projects
// SPDX-License-Identifier: GPL-3.0-only

package com.agprojects.sylk;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import io.wazo.callkeep.RNCallKeepModule;

import android.os.Bundle;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import org.devio.rn.splashscreen.SplashScreen;
import com.facebook.react.ReactActivity;
import android.util.Log;


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
  protected void onCreate(Bundle savedInstanceState){
    //SplashScreen.show(this);
    super.onCreate(savedInstanceState);
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
}
