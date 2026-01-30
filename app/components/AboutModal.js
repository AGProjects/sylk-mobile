import React, { useRef, useState } from 'react';
import { Text, Linking, Platform } from 'react-native';
import PropTypes from 'prop-types';
import { Dialog, Portal } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  title: {
    padding: 5,
    fontSize: 24,
    textAlign: 'center',
  },
  body: {
    paddingVertical: 10,
    fontSize: 14,
    textAlign: 'center',
  },
  link: {
    paddingVertical: 10,
    fontSize: 12,
    textAlign: 'center',
    color: 'blue',
  },
  love: {
    paddingVertical: 8,
    fontSize: 12,
    textAlign: 'center',
  },
  version: {
    paddingVertical: 10,
    fontSize: 14,
    textAlign: 'center',
  },
  devMode: {
    color: '#d32f2f', // red-ish, tweak if you want
    fontWeight: '600',
  },
});

function handleLink() {
  Linking.openURL('https://ag-projects.com');
}

function handleUpdate() {
  if (Platform.OS === 'android') {
    Linking.openURL('https://play.google.com/store/apps/details?id=com.agprojects.sylk');
  } else {
    Linking.openURL('https://apps.apple.com/us/app/id1489960733');
  }
}

const REQUIRED_TAPS = 5;
const TAP_TIMEOUT = 2000;

const AboutModal = (props) => {
  const [tapCount, setTapCount] = useState(0);
  const resetTimer = useRef(null);

  const onBuildPress = () => {
    if (!props.toggleDevMode) return;

    clearTimeout(resetTimer.current);

    setTapCount(prev => {
      const next = prev + 1;
      if (next === REQUIRED_TAPS) {
        props.toggleDevMode();
        return 0;
      }

      return next;
    });

    resetTimer.current = setTimeout(() => {
      setTapCount(0);
    }, TAP_TIMEOUT);
  };

  return (
    <Portal>
      <DialogType visible={props.show} onDismiss={props.close}>
        <Dialog.Title style={styles.title}>About Sylk</Dialog.Title>
        <Dialog.Content>
          <Text style={styles.body}>
            Sylk is part of Sylk Suite, a set of real-time communications applications using IETF SIP protocol and WebRTC specifications
          </Text>

          {/* 👇 Dev mode toggle + visual indicator */}
          <Text
            style={[
              styles.version,
              props.devMode && styles.devMode,
            ]}
            onPress={onBuildPress}
          >
            Version {props.currentVersion}
            {props.devMode ? ' (dev mode)' : ''}
          </Text>

          {props.appStoreVersion && props.appStoreVersion.version > props.currentVersion ? (
            <Text onPress={handleUpdate} style={styles.link}>
              Update Sylk...
            </Text>
          ) : (
            <Text onPress={handleUpdate} style={styles.link}>
              Check App Store for update...
            </Text>
          )}

          <Text style={styles.love}>
            For family, friends and customers, with love.
          </Text>

          <Text onPress={handleLink} style={styles.link}>
            Copyright &copy; AG Projects
          </Text>
        </Dialog.Content>
      </DialogType>
    </Portal>
  );
};

AboutModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func.isRequired,
  currentVersion: PropTypes.string,
  appStoreVersion: PropTypes.object,
  buildId: PropTypes.string,
  toggleDevMode: PropTypes.func,
  devMode: PropTypes.bool,
};

export default AboutModal;
