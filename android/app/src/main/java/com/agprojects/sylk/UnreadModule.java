package com.agprojects.sylk;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;

public class UnreadModule extends ReactContextBaseJavaModule {

    private final ReactApplicationContext reactContext;

    public UnreadModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
    }

    @Override
    public String getName() {
        return "UnreadModule";
    }

	@ReactMethod
	public void setUnreadForContact(String uri, int count) {
		MyFirebaseMessagingService.setUnreadForContact(reactContext, uri, count);
	}
	
	@ReactMethod
	public void resetUnreadForContact(String uri) {
		MyFirebaseMessagingService.resetUnreadForContact(reactContext, uri);
	}
	
	@ReactMethod
	public void getUnreadForContact(String uri, Promise promise) {
		int count = MyFirebaseMessagingService.getUnreadForContact(reactContext, uri);
		promise.resolve(count);
	}

}
