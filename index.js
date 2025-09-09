/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './app/app';
import { name as appName } from './app.json';
import './firebase-messaging'
import bgCalling from './bgCalling';
import { Text} from 'react-native-paper';
import { firebase } from '@react-native-firebase/messaging';

console.disableYellowBox = true;

//Disable font scaling
//Text.defaultProps = Text.defaultProps || {};
//Text.defaultProps.allowFontScaling = false;
AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerHeadlessTask('RNCallKeepBackgroundMessage', () => bgCalling);
