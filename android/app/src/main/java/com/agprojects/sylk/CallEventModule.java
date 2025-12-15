package com.agprojects.sylk;

import androidx.annotation.Nullable;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;

public class CallEventModule extends ReactContextBaseJavaModule {

    private static WritableMap lastEvent = null;

    public CallEventModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return "CallEventModule";
    }

    /** Called by ReactEventEmitter */
    public static synchronized void setLastEvent(WritableMap event) {
        lastEvent = event;
    }

    @ReactMethod
    public void getLastCallEvent(com.facebook.react.bridge.Promise promise) {
        if (lastEvent != null) {
            promise.resolve(lastEvent);
            lastEvent = null; // consume once
        } else {
            promise.resolve(null);
        }
    }
}
