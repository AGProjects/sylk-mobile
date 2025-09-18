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

async function processPendingAction(appInstance, callUUID) {
  const pendingJson = await AsyncStorage.getItem(`pendingAction:${callUUID}`);
  if (!pendingJson) return;

  const { payload, choice } = JSON.parse(pendingJson);

  if (choice === 'accept_audio') {
    appInstance.handleIncomingCall({ accept: 'audio', data: payload['data'] });
  } else if (choice === 'accept_video') {
    appInstance.handleIncomingCall({ accept: 'video', data: payload['data'] });
  }

  await AsyncStorage.removeItem(`pendingAction:${callUUID}`);
  await AsyncStorage.removeItem(`incomingCall:${callUUID}`);
}

// ----------------------
// 🔎 Check for Pending Actions
// ----------------------
async function checkPendingActions(appInstance) {
  const keys = await AsyncStorage.getAllKeys();
  const pendingKeys = keys.filter(k => k.startsWith('pendingAction:'));

  for (const key of pendingKeys) {
    const callUUID = key.split(':')[1];
    await processPendingAction(appInstance, callUUID);
  }
}

export { processPendingAction, checkPendingActions };
// ----------------------
// 2️⃣ Post incoming call notification
// ----------------------
export async function postIncomingCallNotification(callUUID, from, mediaType, data) {
  console.log('[IncomingCall] Posting notification', callUUID, from, mediaType);

  // Start ringtone
  InCallManager.stopRingtone();
  InCallManager.startRingtone('incallmanager_ringtone.mp3', 'default', true);

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

  // Save call info for killed app
  await AsyncStorage.setItem(`incomingCall:${callUUID}`, JSON.stringify({ data }));

  // Start the auto-stop timer
  startRingtoneTimeout(callUUID);

await notifee.displayNotification({
  id: callUUID.toString(),
  title: 'Incoming Call',
  body: `${from} is calling you`,
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

// ----------------------
// 3️⃣ Handle notification interactions
// ----------------------
async function handleNotificationInteraction(notification, pressAction, eventType, appInstance) {
  console.log('handleNotificationInteraction...', notification)
  if (!notification) return;

  const callUUID = notification.id;
  const callInfoJson = await AsyncStorage.getItem(`incomingCall:${callUUID}`);
  const callInfo = callInfoJson ? JSON.parse(callInfoJson) : null;
  if (!callInfo) return;


  // Ignore / Dismiss
  if (eventType === EventType.DISMISSED || pressAction?.id === 'ignore') {
    console.log('[Notifee] Call ignored', callUUID);
    InCallManager.stopRingtone();
    await notifee.cancelNotification(callUUID);
    await AsyncStorage.removeItem(`incomingCall:${callUUID}`);
    clearRingtoneTimeout(callUUID);
    return;
  }

  // Accept Audio
  if (pressAction?.id === 'accept_audio' || pressAction?.id === 'accept_video') {
    console.log('[Notifee] Accepting audio call', callUUID);
    InCallManager.stopRingtone();
    clearRingtoneTimeout(callUUID);
    // Save action + payload for replay
    // Save action + original FCM payload for replay
    await AsyncStorage.setItem(
    `pendingAction:${callUUID}`,
    JSON.stringify({ payload: callInfo, choice: pressAction.id })
    );
  
    // If app is alive, process immediately
    if (appInstance) {
      await processPendingAction(appInstance, callUUID);
    }
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

// ----------------------
// 6️⃣ Firebase background handler
// ----------------------
messaging().setBackgroundMessageHandler(async remoteMessage => {
  if (!remoteMessage?.data) return;

  const { ['session-id']: callUUID, from_display_name: from, ['media-type']: mediaType, event } = remoteMessage.data;
  console.log('[FCM BG] Message received:', event, callUUID, from, mediaType);

  if (event === 'incoming_session' || event === 'incoming_conference_request') {
    // Save full payload for later
    await AsyncStorage.setItem(
      `incomingCall:${callUUID}`,
      JSON.stringify(remoteMessage.data)
    );
    await postIncomingCallNotification(callUUID, from, mediaType, remoteMessage.data);
  } else if (event === 'cancel') {
    console.log('[FCM BG] Cancel event received', callUUID);
    InCallManager.stopRingtone();
    clearRingtoneTimeout(callUUID);
    await notifee.cancelNotification(callUUID.toString());
    await AsyncStorage.removeItem(`incomingCall:${callUUID}`);
  }
});
