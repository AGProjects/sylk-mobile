import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Platform } from 'react-native';
import { Text, Button, Surface, Checkbox } from 'react-native-paper';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { TouchableWithoutFeedback, View, KeyboardAvoidingView, Modal } from 'react-native';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/ContentStyles';

const ExportPrivateKeyModal = ({ show, close, password, exportFunc, status: propStatus, publicKeyHash, backup: propBackup }) => {
  const [backupToEmail, setBackupToEmail] = useState(false);
  const [status, setStatus] = useState('');
  const [sent, setSent] = useState(false);

  // Sync props to state
  useEffect(() => {
    setStatus(propStatus || '');
    setSent(false); // reset sent state when modal is shown again
    setBackupToEmail(!!propBackup); // auto-check backupToEmail if backup prop is true
  }, [show, password, propStatus, propBackup]);

  const disableButton = !password || password.length < 6;

  const handleClose = () => {
    if (close) close();
  };

  const handleExport = () => {
    exportFunc(password, backupToEmail);
    setSent(true);
    setStatus('Enter pincode on the other device');
  };

  if (!show) return null;

console.log('backup', propBackup);
  // Conditional title and body based on backup prop
  const title = propBackup ? 'Backup private key' : 'Export private key';
  const buttonTitle = propBackup ? 'Backup' : 'Export';
  const bodyText1 = propBackup
    ? 'Backup your key so you can restore it at a later time.' // <-- edit this
    : 'To read messages using Sylk on other devices, you need the same private key on all of them.';
  const bodyText2 = propBackup
    ? 'Note down the code to use it when restoring the key'
    : 'Start Sylk on another device and enter this code when prompted:';

  return (
    <Modal
      style={containerStyles.container}
      visible={show}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={containerStyles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
          >
            <TouchableWithoutFeedback onPress={() => {}}>
              <Surface style={containerStyles.modalSurface}>
                <Text style={containerStyles.title}>{title}</Text>

                <KeyboardAwareScrollView
                  enableOnAndroid={true}
                  enableAutomaticScroll={true}
                  extraScrollHeight={120}
                  keyboardShouldPersistTaps="handled"
                >
                  <Text style={styles.body}>{bodyText1}</Text>
                  <Text style={styles.body}>{bodyText2}</Text>

                  <Text style={styles.pincode}>{password}</Text>

                  {!propBackup && !sent && (
                    <View style={[styles.checkBoxRow, { justifyContent: 'center', alignItems: 'center', marginVertical: 12 }]}>
                      <Checkbox
                        status={backupToEmail ? 'checked' : 'unchecked'}
                        onPress={() => setBackupToEmail(!backupToEmail)}
                      />
                      <Text style={{ marginLeft: 8 }}>Backup key to an email address</Text>
                    </View>
                  )}

                  {!sent && (
                    <View style={styles.buttonRow}>
                      <Button
                        mode="contained"
                        style={styles.button}
                        disabled={disableButton}
                        onPress={handleExport}
                        icon="content-save"
                        accessibilityLabel="Export private key"
                      >
                        {buttonTitle}
                      </Button>
                    </View>
                  )}

                  {sent && (
                    <View style={styles.buttonRow}>
                      <Text style={[styles.status, { marginBottom: 20 }]}>{status}</Text>
                    </View>
                  )}
                </KeyboardAwareScrollView>
              </Surface>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

ExportPrivateKeyModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func,
  password: PropTypes.string,
  exportFunc: PropTypes.func,
  status: PropTypes.string,
  publicKeyHash: PropTypes.string,
  backup: PropTypes.bool, // new prop
};

export default ExportPrivateKeyModal;
