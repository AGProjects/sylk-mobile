import React, { useState, useEffect } from 'react';
import { Modal, View, TouchableWithoutFeedback, Keyboard } from 'react-native';
import { Text, Button, Surface, TextInput } from 'react-native-paper';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import PropTypes from 'prop-types';
import styles from '../assets/styles/blink/_AddContactModal.scss';

const AddContactModal = ({
  show,
  close,
  saveContact,
  defaultDomain,
  displayName: propDisplayName,
  uri: propUri,
  organization: propOrg
}) => {
  const [uri, setUri] = useState(propUri || '');
  const [displayName, setDisplayName] = useState(propDisplayName || '');
  const [organization, setOrganization] = useState(propOrg || '');

  useEffect(() => {
    setUri(propUri || '');
    setDisplayName(propDisplayName || '');
    setOrganization(propOrg || '');
  }, [propUri, propDisplayName, propOrg, show]);

  const handleSave = () => {
    saveContact(uri, displayName, organization);
    close();
  };

  const onUriChange = (value) => {
    const cleaned = value.replace(/\s|\(|\)/g, '').toLowerCase();
    setUri(cleaned);
  };

  if (!show) return null;

  return (
    <Modal
      visible={show}
      transparent={true}
      animationType="fade"
      onRequestClose={close}
    >
      <TouchableWithoutFeedback
        onPress={() => {
          Keyboard.dismiss(); // close keyboard if open
          close(); // dismiss modal
        }}
      >
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <KeyboardAwareScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 16 }}
            enableOnAndroid={true}
            keyboardShouldPersistTaps="handled"
            extraScrollHeight={80}
          >
            <TouchableWithoutFeedback onPress={() => { /* prevent closing when tapping inside form */ }}>
              <Surface style={[styles.container, { backgroundColor: 'white', borderRadius: 12, padding: 16 }]}>
                <Text style={styles.title}>Add contact</Text>

                <TextInput
                  mode="flat"
                  label="Enter user@domain"
                  onChangeText={onUriChange}
                  value={uri}
                  autoCapitalize="none"
                />
                <Text style={styles.domain}>
                  The domain is optional, it defaults to @{defaultDomain}
                </Text>

                <TextInput
                  mode="flat"
                  label="Display name"
                  onChangeText={setDisplayName}
                  value={displayName}
                  autoCapitalize="words"
                />

                <TextInput
                  mode="flat"
                  label="Organization"
                  onChangeText={setOrganization}
                  value={organization}
                  autoCapitalize="words"
                />

                <View style={styles.buttonRow}>
                  <Button
                    mode={uri ? 'contained' : 'flat'}
                    style={styles.button}
                    disabled={!uri}
                    onPress={handleSave}
                    icon="content-save"
                  >
                    Save
                  </Button>
                </View>
              </Surface>
            </TouchableWithoutFeedback>
          </KeyboardAwareScrollView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

AddContactModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func.isRequired,
  saveContact: PropTypes.func,
  defaultDomain: PropTypes.string,
  displayName: PropTypes.string,
  uri: PropTypes.string,
  organization: PropTypes.string,
};

export default AddContactModal;
