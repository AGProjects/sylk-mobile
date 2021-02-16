// SPDX-FileCopyrightText: 2020, AG Projects
// SPDX-License-Identifier: GPL-3.0-only

/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './app/app';
import { name as appName } from './app.json';
import bgMessaging from './bgMessaging';
import bgCalling from './bgCalling';

import { firebase } from '@react-native-firebase/messaging';

console.disableYellowBox = true;

// New background task registration
firebase.messaging().setBackgroundMessageHandler(bgMessaging);

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerHeadlessTask('RNCallKeepBackgroundMessage', () => bgCalling);
