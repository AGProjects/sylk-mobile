//@flow
import { NativeModules, AppState } from 'react-native';
const { SylkNative } = NativeModules;

export default async (remoteMessage) => {
    console.log("Data notification received in state " + AppState.currentState, remoteMessage, SylkNative);

    if (AppState.currentState == "background" &&
        (remoteMessage.data.event === 'incoming_session' || remoteMessage.data.event === 'incoming_conference_request')
    ) {

        let event = remoteMessage.data.event;
        let callUUID = remoteMessage.data['session-id'];
        let room = remoteMessage.data['to_uri']
        let from = remoteMessage.data['from_uri']

        if (event === 'incoming_conference_request') {
            let url = 'sylk://dialer/conference/' + callUUID + '/' + room + '/' + from;
        } else if (event === 'incoming_conference_request') {
            let url = 'sylk://dialer/call/' + callUUID + '/' + from + '/' + from;
        }

        console.log('Wake up from push', url);

        SylkNative.launchMainActivity(url);

    }

    return Promise.resolve();
}
