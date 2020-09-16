//@flow
import { NativeModules, AppState } from 'react-native';
const { SylkNative } = NativeModules;

export default async (remoteMessage) => {
    //console.log('Push notification received', remoteMessage.data.event, 'in state', AppState.currentState);

    if (AppState.currentState === "background") {

        let event = remoteMessage.data.event;
        let callUUID = remoteMessage.data['session-id'];
        let to = remoteMessage.data['to_uri']
        let from = remoteMessage.data['from_uri']
        let displayName = remoteMessage.data['from_display_name']
        let url;

        if (event === 'incoming_conference_request') {
            url = 'sylk://incoming/conference/' + callUUID + '/' + from + '/' + to;
        } else if (event === 'incoming_session') {
            url = 'sylk://incoming/call/' + callUUID + '/' + from + '/' + to + '/' + displayName;
        } else if (event === 'cancel') {
            url = 'sylk://cancel/call/' + callUUID;
        }

        if (url) {
            //console.log('Wake up from push with URL', url);
            SylkNative.launchMainActivity(encodeURI(url));
        }
    }

    return Promise.resolve();
}
