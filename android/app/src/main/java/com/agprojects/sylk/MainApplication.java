package com.agprojects.sylk;

import android.app.Application;
import android.content.Context;
import com.facebook.react.PackageList;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import com.facebook.react.ReactApplication;
import com.facebook.react.ReactNativeHost;
import com.facebook.react.ReactPackage;
import com.facebook.soloader.SoLoader;
import com.agprojects.sylk.sylk.SylkNativePackage;
import java.lang.reflect.InvocationTargetException;
import java.util.List;
import androidx.multidex.MultiDexApplication;


public class MainApplication extends Application implements ReactApplication {

  private static final String TAG = "Sylk:MainApplication";

  private final ReactNativeHost mReactNativeHost =
      new ReactNativeHost(this) {
        @Override
        public boolean getUseDeveloperSupport() {
          return BuildConfig.DEBUG;
        }

        @Override
        protected List<ReactPackage> getPackages() {
          @SuppressWarnings("UnnecessaryLocalVariable")
          List<ReactPackage> packages = new PackageList(this).getPackages();
          // Packages that cannot be autolinked yet can be added manually here, for example:
          packages.add(new SylkNativePackage());
          return packages;
        }

        @Override
        protected String getJSMainModuleName() {
          return "index";
        }
      };

  @Override
  public ReactNativeHost getReactNativeHost() {
    return mReactNativeHost;
  }

  @Override
  public void onCreate() {
    super.onCreate();
    SoLoader.init(this, /* native exopackage */ false);
  }
}
