//@flow
import { NativeModules, AppState } from 'react-native';
const { SylkNative } = NativeModules;

//import { AppState } from 'react-native';
//import SajjadLaunchApplication from 'react-native-launch-application';

export default async (remoteMessage) => {
    console.log("Data notification received in state " + AppState.currentState, remoteMessage, SylkNative);

    if (AppState.currentState == "background" &&
        (remoteMessage.data.event === 'incoming_session' || remoteMessage.data.event === 'incoming_conference_request')
    ) {
        //rnn_hasRNHost indicates if the app has a react native host when the notification was received. This is used to determine if the app was in the background or dead. If it was dead then launch the main activity to wake enough of the phone to be useful.
        console.log('Wake up from push');
        SylkNative.launchMainActivity();
        
        //https://github.com/lvlrSajjad/react-native-launch-application
        //SajjadLaunchApplication.open("com.agprojects.sylk");
    }

    return Promise.resolve();
}
