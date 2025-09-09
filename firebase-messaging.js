// firebase-messaging.js
import { AppRegistry, AppState, NativeModules } from 'react-native';

const { SylkNative } = NativeModules;

export async function onMessageReceived(remoteMessage) {
    console.log('Push notification received', remoteMessage?.data?.event, 'in state', AppState.currentState);

    // You can still use AppState as a hint, but background handlers aren't tied to it
    const event = remoteMessage.data?.event;
    const callUUID = remoteMessage.data?.['session-id'];
    const to = remoteMessage.data?.['to_uri'];
    const from = remoteMessage.data?.['from_uri'];
    const displayName = remoteMessage.data?.['from_display_name'];
    const mediaType = remoteMessage.data?.['media-type'];
    let url;

    if (event === 'incoming_conference_request') {
        url = `sylk://conference/incoming/${callUUID}/${from}/${to}/${displayName}/${mediaType}`;
    } else if (event === 'incoming_session') {
        url = `sylk://call/incoming/${callUUID}/${from}/${to}/${displayName}/${mediaType}`;
    } else if (event === 'cancel') {
        url = `sylk://call/cancel/${callUUID}`;
    }

    if (url) {
        console.log('Wake up from push with URL', url);
        SylkNative.launchMainActivity(encodeURI(url));
    } else {
        console.log('Do not wake up');
    }

    return Promise.resolve();
}

// Register the headless task (Android only)
AppRegistry.registerHeadlessTask('RNFirebaseBackgroundMessage', () => onMessageReceived);

