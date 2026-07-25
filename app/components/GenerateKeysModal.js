import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Platform, View, Modal, KeyboardAvoidingView, TouchableWithoutFeedback } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/blink/_GenerateKeysModal.scss';

const GenerateKeysModal = ({ show = false, close, generateKeysFunc, confirm: propConfirm = false, confirm_again: propConfirmAgain = false }) => {
  const [confirm, setConfirm] = useState(false);
  const [confirmAgain, setConfirmAgain] = useState(false);

  // Sync props to state
  useEffect(() => {
    setConfirm(propConfirm || false);
    setConfirmAgain(propConfirmAgain || false);
  }, [propConfirm, propConfirmAgain, show]);

  const handleGenerateKeys = (event) => {
    if (event && event.preventDefault) event.preventDefault();

    if (confirmAgain) {
      setConfirm(false);
      setConfirmAgain(false);
      generateKeysFunc();
      if (close) close();
    } else if (confirm) {
      setConfirmAgain(true);
    } else {
      setConfirm(true);
    }
  };

  if (!show) return null;

  let label = 'Generate';
  if (confirm) label = 'Confirm';
  if (confirmAgain) label = 'Confirm again';

  const isConfirming = label.includes('Confirm');

  return (
    <Modal
      style={containerStyles.container}
      visible={show}
      transparent
      animationType="fade"
      onRequestClose={close}
      /* iOS-only — without this, RN's Modal defaults to
         supportedOrientations: ['portrait'], which forces the
         underlying app to portrait while the modal is presented.
         Include both landscape variants so the modal inherits
         whichever orientation the user is in. */
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
    >
      <TouchableWithoutFeedback onPress={close}>
        <View style={containerStyles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
          >
            <TouchableWithoutFeedback onPress={() => {}}>
              <Surface style={containerStyles.modalSurface}>
                <Text style={containerStyles.title}>Generate private key</Text>

                <Text style={styles.body}>
                  You should generate a private key only if you lost another device.
                </Text>

                <Text style={styles.body}>
                  If you generate a new key, previous received messages cannot be read on new devices.
                </Text>

                <View style={styles.buttonRow}>
                  <Button
                    mode="contained"
                    style={[styles.button, isConfirming && { backgroundColor: 'red' }]}
                    onPress={handleGenerateKeys}
                    icon="content-save"
                    accessibilityLabel="Generate keys"
                  >
                    {label}
                  </Button>
                </View>
              </Surface>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

GenerateKeysModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func,
  generateKeysFunc: PropTypes.func,
  confirm: PropTypes.bool,
  confirm_again: PropTypes.bool,
};

export default GenerateKeysModal;
