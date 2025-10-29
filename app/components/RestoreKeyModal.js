import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { Platform, View, TextInput, Clipboard, Modal, KeyboardAvoidingView, TouchableWithoutFeedback } from 'react-native';
import { Text, Button, Surface } from 'react-native-paper';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import OpenPGP from 'react-native-fast-openpgp';
import { decode as atob } from 'base-64';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/ContentStyles';

const RestoreKeyModal = ({ show, close, saveFunc, success }) => {
  const [password, setPassword] = useState('');
  const [privateKeyDisplay, setPrivateKeyDisplay] = useState('');
  const [fullPrivateKey, setFullPrivateKey] = useState('');
  const [decryptedSuccessfully, setDecryptedSuccessfully] = useState(false);
  const [decryptedKey, setDecryptedKey] = useState('');
  const [status, setStatus] = useState('');

  const scrollView = useRef(null);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => clearAndClose(), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  const clearAndClose = () => {
    setPassword('');
    setPrivateKeyDisplay('');
    setFullPrivateKey('');
    setDecryptedSuccessfully(false);
    setDecryptedKey('');
    setStatus('');
    close && close();
  };

  const validatePrivateKey = (text) => {
    try {
      text = atob(text);
      const beginMarker = '-----BEGIN PGP MESSAGE-----';
      const endMarker = '-----END PGP MESSAGE-----';
      const beginIndex = text.indexOf(beginMarker);
      const endIndex = text.indexOf(endMarker);
      if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) return null;
      return text.slice(beginIndex, endIndex + endMarker.length).trim();
    } catch {
      return null;
    }
  };

  const getDisplayLines = (key) =>
    key
      .split('\n')
      .slice(0, 5)
      .map((line) => (line.length > 100 ? line.slice(0, 100) + '…' : line))
      .join('\n');

  const handleButtonPress = async () => {
    // Clear button
    if (fullPrivateKey && password.length === 0 && !decryptedSuccessfully) {
      setFullPrivateKey('');
      setPrivateKeyDisplay('');
      setStatus('');
      setDecryptedSuccessfully(false);
      return;
    }

    // Paste button
    if (!fullPrivateKey) {
      try {
        const text = await Clipboard.getString();
        if (!text) return;

        const validated = validatePrivateKey(text);
        if (validated) {
          setFullPrivateKey(validated);
          setPrivateKeyDisplay(getDisplayLines(validated));
          setStatus('');
          setDecryptedSuccessfully(false);
        } else {
          setFullPrivateKey('');
          setPrivateKeyDisplay('');
          setStatus('Invalid private key');
          setDecryptedSuccessfully(false);
        }
      } catch (err) {
        console.log('Failed to paste:', err);
      }
      return;
    }

    // Decrypt key
    if (!decryptedSuccessfully && password.length > 0) {
      try {
        const decryptedContent = await OpenPGP.decryptSymmetric(fullPrivateKey, password);
        setDecryptedSuccessfully(true);
        setDecryptedKey(decryptedContent);
        setFullPrivateKey(decryptedContent);
        setPrivateKeyDisplay(getDisplayLines(decryptedContent));
        setStatus('Key decrypted successfully');
      } catch (error) {
        console.log('Error decrypting PGP private key:', error);
        setStatus('Decryption failed, check password or key');
      }
      return;
    }

    // Use key
    if (decryptedSuccessfully) {
      saveFunc(decryptedKey);
      clearAndClose();
    }
  };

  let buttonText = 'Paste';
  if (fullPrivateKey && password.length === 0 && !decryptedSuccessfully) buttonText = 'Clear';
  if (fullPrivateKey && !decryptedSuccessfully && password.length > 0) buttonText = 'Decrypt key';
  if (decryptedSuccessfully) buttonText = 'Use Key';

  if (!show) return null;
  let title = 'Restore private key';

  return (
    <Modal
	  style={containerStyles.container}
      visible={show}
      transparent
      animationType="fade"
      onRequestClose={close} // Android back button
    >

      {/* Dismiss modal when tapping outside */}
      <TouchableWithoutFeedback onPress={close}>
        <View style={containerStyles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
          >
            {/* Prevent taps inside modal from dismissing */}
            <TouchableWithoutFeedback onPress={() => {}}>

   		    <Surface style={containerStyles.modalSurface}>
				<Text style={containerStyles.title}>{title}</Text>

                  <View style={{ paddingBottom: 16 }}>
                    {/* Private key box */}
                    <View
                      style={{
                        height: 120,
                        borderWidth: 1,
                        borderColor: '#ccc',
                        padding: 8,
                        borderRadius: 4,
                        backgroundColor: '#f7f7f7',
                        marginBottom: 16,
                      }}
                    >
                      <Text style={{ fontSize: 14, lineHeight: 18 }}>
                        {privateKeyDisplay
                          ? privateKeyDisplay.split('\n').map((line, idx) => (
                              <Text key={idx}>{line}{'\n'}</Text>
                            ))
                          : 'Paste your private key here'}
                      </Text>
                    </View>

					{/* Pincode input */}
					  {fullPrivateKey && !decryptedSuccessfully && (
						<View style={{ marginBottom: 16 }}>
						  <View style={{ position: 'relative' }}>
							{!password && (
							  <Text
								style={{
								  position: 'absolute',
								  left: 12,
								  top: 10,
								  color: '#aaa',
								  fontSize: 14,
								}}
							  >
								Enter pincode
							  </Text>
							)}
							<TextInput
							  style={{
								borderWidth: 1,
								borderColor: '#ccc',
								borderRadius: 4,
								padding: 8,
								fontSize: 14,
								color: '#000',
							  }}
							  value={password}
							  onChangeText={setPassword}
							  autoCapitalize="none"
							  autoCorrect={false}
							  secureTextEntry
							  keyboardType="number-pad"
							/>
						  </View>
						</View>
					  )}

                    <Button mode="contained" style={styles.button} onPress={handleButtonPress}>
                      {buttonText}
                    </Button>

                    {/* Status */}
                    {status ? (
                      <View style={{ marginTop: 8, alignItems: 'center' }}>
                        <Text style={[styles.status, { color: 'orange' }]}>{status}</Text>
                      </View>
                    ) : null}
                  </View>
               {/* Modal content end */}
              </Surface>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

RestoreKeyModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func.isRequired,
  saveFunc: PropTypes.func.isRequired,
  success: PropTypes.bool,
};

export default RestoreKeyModal;
