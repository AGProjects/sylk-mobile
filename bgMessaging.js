//@flow
import { NativeModules, AppState } from 'react-native';
const { SylkNative } = NativeModules;

export default async (remoteMessage) => {
    console.log('Push notification received', remoteMessage.data.event);

    if (AppState.currentState == "background" &&
        (remoteMessage.data.event === 'incoming_session' || remoteMessage.data.event === 'incoming_conference_request')
    ) {

        let event = remoteMessage.data.event;
        let callUUID = remoteMessage.data['session-id'];
        let to = remoteMessage.data['to_uri']
        let from = remoteMessage.data['from_uri']
        let url;

        if (event === 'incoming_conference_request') {
            url = 'sylk://outgoing/conference/' + callUUID + '/' + from + '/' + to;
        } else if (event === 'incoming_session') {
            url = 'sylk://incoming/call/' + callUUID + '/' + from + '/' + to;
        }

        if (url) {
            console.log('Wake up from push with URL', url);
            SylkNative.launchMainActivity(url);
        }
    }

    return Promise.resolve();
}
