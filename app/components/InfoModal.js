// InfoModal.js
//
// Small themed replacement for native Alert.alert() one-button
// notices (e.g. "Backup complete"). Uses ThemedModalSurface so it
// follows the app's Day/Night theme instead of the OS-styled system
// alert. Signature mirrors a simple alert: title + message + OK.
import React from 'react';
import PropTypes from 'prop-types';
import { Modal, View } from 'react-native';
import { Text, Button } from 'react-native-paper';
import ThemedModalSurface from './ThemedModalSurface';
import containerStyles from '../assets/styles/ContainerStyles';

const InfoModal = ({ show, title, message, close }) => (
  <Modal
    visible={!!show}
    transparent
    animationType="fade"
    onRequestClose={close}
    supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
  >
    <View style={containerStyles.overlay}>
      <ThemedModalSurface style={[containerStyles.modalSurface, { alignSelf: 'center', width: '90%', maxWidth: 480 }]}>
        {title ? <Text style={containerStyles.title}>{title}</Text> : null}
        {message ? (
          <Text style={{ fontSize: 15, textAlign: 'center', paddingHorizontal: 16, paddingBottom: 8 }}>
            {message}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: 12 }}>
          <Button mode="contained" compact onPress={close} accessibilityLabel="OK">OK</Button>
        </View>
      </ThemedModalSurface>
    </View>
  </Modal>
);

InfoModal.propTypes = {
  show: PropTypes.bool,
  title: PropTypes.string,
  message: PropTypes.string,
  close: PropTypes.func,
};

export default InfoModal;
