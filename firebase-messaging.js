// firebase-messaging.js
import messaging from '@react-native-firebase/messaging';
import { initializeApp, getApps, getApp } from 'firebase/app';
import AsyncStorage from '@react-native-async-storage/async-storage';


// ----------------------
// 1️⃣ Initialize Firebase
// ----------------------
/*
let firebaseApp;
if (!getApps().length) {
  firebaseApp = initializeApp({
    apiKey: 'AIzaSyC0m72DF-xZbtDaQcelM8ZyMZvcVu0FeM',
    projectId: 'sylk-8f7a1',
    storageBucket: 'sylk-8f7a1.firebasestorage.app',
    messagingSenderId: '151376522833',
    appId: '1:151376522833:android:d5a01d35cd81420c4bd270',
  });
  console.log('[FCM BG][Firebase] Initialized app:', firebaseApp.name);
} else {
  firebaseApp = getApp();
  console.log('[FCM BG][Firebase] Using existing app:', firebaseApp.name);
}
*/

// ----------------------
// Firebase background handler
// ----------------------
messaging().setBackgroundMessageHandler(async remoteMessage => {
  if (!remoteMessage?.data) return;
  const event = remoteMessage.data.event;
  const data = remoteMessage.data;

  console.log('[FCM BG]Push received:', remoteMessage.data);

  if (event === 'incoming_session' || event === 'incoming_conference_request') {
    const { ['session-id']: callUUID } = data;
    console.log('Storing push data...');
    AsyncStorage.setItem(`incomingCall:${callUUID}`, JSON.stringify({ data }));
  } else if (event === 'cancel') {
    const { ['session-id']: callUUID } = data;
    AsyncStorage.removeItem(`incomingCall:${callUUID}`);
  } else if (event === 'message') {
    AsyncStorage.setItem(`incomingMessage`, JSON.stringify(data));
  }
});


