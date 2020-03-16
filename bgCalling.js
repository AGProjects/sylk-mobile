// @flow
import { Linking } from 'react-native';

export default async ({ name, callUUID, handle }) => {
    Linking.openURL(`sylk://dialer/call/${callUUID}/${handle}/${name}`)
    return Promise.resolve();
}