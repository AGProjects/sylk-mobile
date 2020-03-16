//@flow
import { NativeModules, AppState } from 'react-native';
import Logger from './Logger';
const { SylkNative } = NativeModules;

const logger = new Logger('bgMessaging');

export default async (remoteMessage) => {
    logger.debug("Data notification received in state " + AppState.currentState, remoteMessage);
    logger.debug("rnn_hasRNHost: " + remoteMessage.rnn_hasRNHost, remoteMessage.rnn_hasRNHost);

    if(remoteMessage.command == "register_for_inbound") {
        if(AppState.currentState == "background" && !remoteMessage.rnn_hasRNHost) {
            //rnn_hasRNHost indicates if the app has a react native host when the notification was received. This is used to determine if the app was in the background or dead. If it was dead then launch the main activity to wake enough of the phone to be useful.
            SylkNative.launchMainActivity();
        }
    }

    return Promise.resolve();
}