import React, { useRef, useState } from 'react';
import {
  Text,
  Linking,
  Platform,
  Modal,
  View,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  ScrollView,
  Dimensions,
} from 'react-native';
import PropTypes from 'prop-types';
import { Surface, Button } from 'react-native-paper';

// Share the Modal + overlay + Surface shell with EditContactModal /
// ShareLocationModal / ActiveLocationSharesModal / DeleteHistoryModal /
// DeleteFileTransfers so every dialog has the same rounded-corner card
// on a dimmed backdrop. Dropped the old Paper Dialog/Portal wrapper
// that produced a slightly different corner radius and elevation.
import containerStyles from '../assets/styles/ContainerStyles';

import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
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
  inner: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  donateButton: {
    marginTop: 12,
    marginHorizontal: 12,
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

  // Orientation-agnostic sizing: derive the scroll-body height from the current
  // window instead of a fixed 520 (which overflowed in landscape). Width is
  // capped and centred in landscape so the card doesn't stretch edge-to-edge.
  const _winH = Dimensions.get('window').height;
  const _winW = Dimensions.get('window').width;
  const _isLandscape = _winW > _winH;
  const _scrollMaxHeight = _isLandscape
    ? Math.max(160, Math.floor(_winH * 0.8))
    : Math.min(520, Math.floor(_winH * 0.8));
  // Explicit `width`, NOT maxWidth: paper v5's iOS Surface splits styles
  // across two shadow-layer views — width/alignSelf go to the outer one,
  // maxWidth to the inner one — so with maxWidth the outer white card
  // stretched full-width in landscape/tablet while the content stayed
  // capped in its left half. A single explicit width keeps both in sync.
  const _surfaceExtra = _isLandscape ? { alignSelf: 'center', width: Math.min(560, _winW * 0.85) } : null;

  return (
    <Modal
      style={containerStyles.container}
      visible={!!props.show}
      transparent
      animationType="fade"
      onRequestClose={props.close}
      /* iOS-only — without this, RN's Modal defaults to
         supportedOrientations: ['portrait'], which forces the
         underlying app to portrait while the modal is presented.
         Include both landscape variants so the modal inherits
         whichever orientation the user is in. */
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
    >
      <TouchableWithoutFeedback onPress={props.close}>
        <View style={containerStyles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
          >
            {/* Block dismiss when taps land inside the card. */}
            <TouchableWithoutFeedback onPress={() => {}}>
              <Surface style={[containerStyles.modalSurface, _surfaceExtra]}>
                <ScrollView
                  style={{ maxHeight: _scrollMaxHeight }}
                  keyboardShouldPersistTaps="handled"
                >
                  <Text style={containerStyles.title}>About Blink</Text>
                  <View style={styles.inner}>
                    <Text style={styles.body}>
                      Blink uses Sylk Suite to deliver real-time communications using the IETF SIP protocol and WebRTC specifications
                    </Text>

                    {/* Dev mode toggle + visual indicator. Five taps in
                        under TAP_TIMEOUT ms flips dev mode. */}
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

                    <Text onPress={handleUpdate} style={styles.link}>
                      Check App Store for update...
                    </Text>

                    <Text style={styles.love}>
                      For family, friends and customers, with love.
                    </Text>

                    <Text onPress={handleLink} style={styles.link}>
                      Copyright &copy; AG Projects
                    </Text>

                    {/* Donate — closes this About modal first, then
                        opens the shared PaymentInfoModal with the
                        'donate' template. The close-then-open
                        sequencing lives in the parent (NavigationBar)
                        so we just fire the callback here. */}
                    {props.onDonate ? (
                      <Button
                        mode="contained"
                        icon="hand-heart"
                        style={styles.donateButton}
                        onPress={props.onDonate}
                      >
                        Donate…
                      </Button>
                    ) : null}
                  </View>
                </ScrollView>
              </Surface>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

AboutModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func.isRequired,
  currentVersion: PropTypes.string,
  buildId: PropTypes.string,
  toggleDevMode: PropTypes.func,
  devMode: PropTypes.bool,
  onDonate: PropTypes.func,
};

export default AboutModal;
