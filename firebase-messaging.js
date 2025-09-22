// firebase-messaging.js
import { Platform } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance, AndroidColor, EventType } from '@notifee/react-native';
import InCallManager from 'react-native-incall-manager';
import { initializeApp, getApps, getApp } from 'firebase/app';
import AsyncStorage from '@react-native-async-storage/async-storage';

// timers map: callUUID -> timeoutId
const ringtoneTimers = new Map();

function startRingtoneTimeout(callUUID) {
  // Clear any existing timer for this call
  if (ringtoneTimers.has(callUUID)) {
    clearTimeout(ringtoneTimers.get(callUUID));
  }

  const timeoutId = setTimeout(async () => {
    console.log('[Timeout] Ringtone auto-stopped for call', callUUID);
    InCallManager.stopRingtone();
    await notifee.cancelNotification(callUUID.toString());
    await AsyncStorage.removeItem(`incomingCall:${callUUID}`);
    ringtoneTimers.delete(callUUID);
  }, 45 * 1000);

  ringtoneTimers.set(callUUID, timeoutId);
}

function clearRingtoneTimeout(callUUID) {
  if (ringtoneTimers.has(callUUID)) {
    clearTimeout(ringtoneTimers.get(callUUID));
    ringtoneTimers.delete(callUUID);
  }
}

function stopRingtone(callUUID) {
    InCallManager.stopRingtone();
    clearRingtoneTimeout(callUUID);
}

// ----------------------
// 1️⃣ Initialize Firebase
// ----------------------
let firebaseApp;
if (!getApps().length) {
  firebaseApp = initializeApp({
    apiKey: 'AIzaSyC0m72DF-xZbtDaQcelM8ZyMZvcVu0FeM',
    projectId: 'sylk-8f7a1',
    storageBucket: 'sylk-8f7a1.firebasestorage.app',
    messagingSenderId: '151376522833',
    appId: '1:151376522833:android:d5a01d35cd81420c4bd270',
  });
  console.log('[Firebase] Initialized app:', firebaseApp.name);
} else {
  firebaseApp = getApp();
  console.log('[Firebase] Using existing app:', firebaseApp.name);
}

// ----------------------
// Firebase background handler
// ----------------------
messaging().setBackgroundMessageHandler(async remoteMessage => {
  if (!remoteMessage?.data) return;
  const event = remoteMessage.data.event;
  const data = remoteMessage.data;

  console.log('[FCM BG] Push received:', remoteMessage.data);

  if (event === 'incoming_session' || event === 'incoming_conference_request') {
    const { ['session-id']: callUUID } = data;
	  // Start ringtone
      InCallManager.stopRingtone();
	  InCallManager.startRingtone('_BUNDLE_', 'default', true);
	  // Start the auto-stop timer
	  startRingtoneTimeout(callUUID);

    // Save full payload for later
    await AsyncStorage.setItem(`incomingCall:${callUUID}`, JSON.stringify({ data }));
    await postIncomingCallNotification(data);
  } else if (event === 'cancel') {
    const { ['session-id']: callUUID } = data;
    console.log('[FCM BG] Cancel event received', callUUID);
    stopRingtone(callUUID);
    await notifee.cancelNotification(callUUID.toString());
    await AsyncStorage.removeItem(`incomingCall:${callUUID}`);
  } else if (event === 'message') {
    console.log('[FCM BG] message event received');
    await AsyncStorage.setItem(`incomingMessage`, JSON.stringify(data));
    await postIncomingMessageNotification(data);
  }
});

// --------------------------------
// Post incoming call notification
// --------------------------------
export async function postIncomingCallNotification(data) {
  console.log('[IncomingCall] Posting notification', data);

  const { ['session-id']: callUUID, from_display_name: from, from_uri: from_uri, ['media-type']: mediaType, event } = data;

  // Ensure channel exists
  await notifee.createChannel({
    id: 'incoming-call',
    name: 'Incoming Calls',
    importance: AndroidImportance.HIGH,
    sound: 'incallmanager_ringtone',
    vibration: true,
  });

  // Build actions
  const actions = [
    { title: 'Ignore', pressAction: { id: 'ignore' } }
  ];

  if (mediaType?.toLowerCase() === 'audio') {
     actions.push({ title: 'Accept', pressAction: { id: 'accept_audio', launchActivity: 'default' } });
  }

  if (mediaType?.toLowerCase() === 'video') {
    actions.push({ title: 'Accept Audio', pressAction: { id: 'accept_audio', launchActivity: 'default' } });
    actions.push({ title: 'Accept Video', pressAction: { id: 'accept_video', launchActivity: 'default' } });
  }

	await notifee.displayNotification({
	  id: callUUID.toString(),
	  title: 'Incoming Sylk call',
	  body: `${from_uri} is calling you`,
	  android: {
		channelId: 'incoming-call',
		smallIcon: 'ic_notification',
		color: AndroidColor.WHITE,
		importance: AndroidImportance.HIGH,  // heads-up
		priority: 2,                         // "max" priority
		ongoing: true,                       // keep it pinned
		fullScreenAction: {                  // 👈 keeps it on screen
		  id: 'default',
		  launchActivity: 'default',
		},
		pressAction: { id: 'default' },
		actions,
	  },
	});

  console.log('[IncomingCall] Notification displayed', callUUID);
}

export async function postIncomingMessageNotification(data) {
  console.log('[IncomingMessage] notification', data);
}


// ----------------------
// 3️⃣ Handle notification interactions
// ----------------------
async function handleNotificationInteraction(notification, pressAction, eventType, appInstance) {
	/*
	EventType.PRESS	1	Notification was tapped / pressed.
	EventType.DISMISSED	2	Notification was dismissed by the user.
	EventType.ACTION_PRESS	3	An action button on the notification was pressed.
	EventType.CANCELLED	4	Notification was programmatically cancelled (not user action).
	EventType.APP_BLOCKED	5	
	*/

  if (!notification) return;

  if (!pressAction) return;

  console.log('FCM handleNotificationInteraction ', notification)

  console.log('FCM interaction event type', eventType);
  console.log('FCM press action', pressAction);

  const callUUID = notification.id;
  const callInfoJson = await AsyncStorage.getItem(`incomingCall:${callUUID}`);
  const callInfo = callInfoJson ? JSON.parse(callInfoJson) : null;

  if (!callInfo) {
      //console.log('No call info found');
      return;
  }

  // Ignore / Dismiss
  if (eventType === EventType.DISMISSED || pressAction?.id === 'ignore') {
    console.log('[Notifee] Call ignored', callUUID);
    stopRingtone(callUUID)
    await notifee.cancelNotification(callUUID);
    await AsyncStorage.removeItem(`incomingCall:${callUUID}`);
    return;
  }

  // Accept Audio
  if (pressAction?.id === 'accept_audio' || pressAction?.id === 'accept_video') {
    console.log('[Notifee] Accepting audio call', callUUID);
    stopRingtone(callUUID);
    // Save action + payload for replay
    // Save action + original FCM payload for replay
    await AsyncStorage.setItem(`pendingAction:${callUUID}`, JSON.stringify({ payload: callInfo, choice: pressAction.id }));
  
    // If app is alive, process immediately
    if (appInstance) {
      await processPendingAction(appInstance, callUUID);
    }
  } else {
    console.log('Other FCM interaction');
    //await AsyncStorage.setItem(`pendingAction:message`,JSON.stringify({ payload: callInfo, choice: pressAction.id }));
  }
}

// ----------------------
// 4️⃣ Foreground listener
// ----------------------
export function registerForegroundListener(appInstance) {
  notifee.onForegroundEvent(async ({ type, detail = {} }) => {
    const { notification, pressAction } = detail;
    await handleNotificationInteraction(notification, pressAction, type, appInstance);
  });
}

// ----------------------
// 5️⃣ Background / killed listener
// ----------------------
notifee.onBackgroundEvent(async ({ type, detail = {} }) => {
  const { notification, pressAction } = detail;
  await handleNotificationInteraction(notification, pressAction, type);
});

