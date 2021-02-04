// SPDX-FileCopyrightText: 2020, AG Projects
// SPDX-License-Identifier: GPL-3.0-only

// @flow
import { Linking } from 'react-native';

export default async ({ name, callUUID, handle }) => {
    Linking.openURL(`sylk://call/outgoing/${callUUID}/${handle}/${name}`)
    return Promise.resolve();
}
