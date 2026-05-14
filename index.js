/**
 * @format
 */

import { AppRegistry } from 'react-native';
import debug from 'debug';
import App from './app/app';
import { name as appName } from './app.json';
import './firebase-messaging'
import bgCalling from './bgCalling';
import { Text} from 'react-native-paper';
import { firebase } from '@react-native-firebase/messaging';

// Silence the per-second rn-webrtc:pc:DEBUG getStats spam.
//
// react-native-webrtc/lib/module/index.js (line ~26) calls
//   Logger.enable(`${Logger.ROOT_PREFIX}:*`)
// at module load, which routes through debug.enable('rn-webrtc:*')
// and turns on every rn-webrtc:*:DEBUG / INFO / WARN namespace
// regardless of our own preferences. ES module semantics evaluate
// the entire import graph before running any top-level statements,
// so this block ALWAYS runs after rn-webrtc has flipped logging
// on. Disable it back here.
//
// debug.disable() in debug 3.x and 4.x both call
// `createDebug.enable('')` internally — i.e. they nuke ALL
// enabled namespaces. The argument is ignored. We follow up with
// `debug.enable('-rn-webrtc:*')` so namespaces other modules want
// to keep on can be added here later by appending `,foo:*`, and
// the rn-webrtc skip pattern stays explicit.
debug.disable();
debug.enable('-rn-webrtc:*');

console.disableYellowBox = true;

//Disable font scaling
//Text.defaultProps = Text.defaultProps || {};
//Text.defaultProps.allowFontScaling = false;
AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerHeadlessTask('RNCallKeepBackgroundMessage', () => bgCalling);
