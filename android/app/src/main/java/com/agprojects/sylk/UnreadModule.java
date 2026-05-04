package com.agprojects.sylk;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;

import java.util.HashMap;
import java.util.Map;

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

	// Returns the sum of all per-contact unread counters stored on the
	// native side. JS uses this to compare against its own in-memory total
	// so we can see drift between the launcher badge and the in-app state.
	@ReactMethod
	public void getTotalUnread(Promise promise) {
		int total = MyFirebaseMessagingService.getTotalUnreadCountStatic(reactContext);
		promise.resolve(total);
	}

	// Returns a uri -> count map of every contact with a non-zero native
	// unread counter. Same purpose as getTotalUnread but lets JS log which
	// contact specifically is responsible for any drift.
	@ReactMethod
	public void getAllUnread(Promise promise) {
		HashMap<String, Integer> map = MyFirebaseMessagingService.getAllUnreadStatic(reactContext);
		WritableMap out = Arguments.createMap();
		for (Map.Entry<String, Integer> e : map.entrySet()) {
			out.putInt(e.getKey(), e.getValue());
		}
		promise.resolve(out);
	}

}
