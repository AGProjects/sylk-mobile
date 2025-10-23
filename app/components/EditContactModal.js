import React, { useState, useEffect } from 'react';
import { Modal, View, TouchableWithoutFeedback, Keyboard, Platform, Linking } from 'react-native';
import { Text, Button, Surface, TextInput, Switch, Checkbox } from 'react-native-paper';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PropTypes from 'prop-types';
import styles from '../assets/styles/blink/_EditContactModal.scss';
import utils from '../utils';

const EditContactModal = ({
  show,
  close,
  uri,
  displayName: propDisplayName,
  email: propEmail,
  organization: propOrg,
  publicKey,
  selectedContact,
  myself,
  saveContact: saveContactProp,
  deleteContact: deleteContactProp,
  deletePublicKey: deletePublicKeyProp,
  myuuid,
  rejectNonContacts,
  toggleRejectNonContacts
}) => {
  const [displayName, setDisplayName] = useState(propDisplayName || '');
  const [organization, setOrganization] = useState(propOrg || '');
  const [email, setEmail] = useState(propEmail || '');
  const [confirm, setConfirm] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    setDisplayName(propDisplayName || '');
    setOrganization(propOrg || '');
    setEmail(propEmail || '');
  }, [propDisplayName, propOrg, propEmail, show]);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleSave = () => {
    saveContactProp(displayName, organization, email);
    setConfirm(false);
    close();
  };

  const handleDelete = () => {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setConfirm(false);
    deleteContactProp(uri);
    close();
  };

  const handleDeletePublicKey = () => {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setConfirm(false);
    deletePublicKeyProp(uri);
    close();
  };

  const handleClipboard = () => {
    utils.copyToClipboard(publicKey);
    close();
  };

  const validEmail = () => {
    if (!email) return true;
    return utils.isEmailAddress(email);
  };

  if (!show) return null;

  // Dynamic top padding for keyboard
  const paddingTop = keyboardHeight > 0 ? 50 : 100;

  return (
    <Modal
      visible={show}
      transparent={true}
      animationType="fade"
      onRequestClose={close}
    >
      {/* Dimmed background overlay */}
      <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); close(); }}>
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)', // dim the app behind
          justifyContent: 'flex-start',
          paddingTop
        }}>
          <KeyboardAwareScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-start', paddingHorizontal: 16 }}
            enableOnAndroid
            keyboardShouldPersistTaps="handled"
            extraScrollHeight={30}
          >
            <TouchableWithoutFeedback onPress={() => {}}>
              <Surface style={[styles.container, { backgroundColor: 'white', borderRadius: 12, padding: 16 }]}>
                
                {/* Public Key Section */}
                {publicKey ? (
                  <>
                    <Text style={styles.title}>{displayName || uri}</Text>
                    <Text style={styles.body}>PGP Public Key</Text>
                    <Text style={styles.key}>{publicKey}</Text>
                    <View style={styles.buttonRow}>
                      <Button mode="contained" style={styles.button} disabled={confirm} onPress={handleClipboard} icon="content-copy">Copy</Button>
                      <Button mode="contained" style={styles.button} disabled={myself} onPress={handleDeletePublicKey} icon="delete">
                        {confirm ? 'Confirm delete' : 'Delete'}
                      </Button>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.title}>{uri}</Text>

                    {myself && (
                      <View style={styles.checkBoxRow}>
                        {Platform.OS === 'ios' ? (
                          <Switch value={rejectNonContacts} onValueChange={toggleRejectNonContacts} />
                        ) : (
                          <Checkbox status={rejectNonContacts ? 'checked' : 'unchecked'} onPress={toggleRejectNonContacts} />
                        )}
                        <Text> Allow calls only from my contacts</Text>
                      </View>
                    )}

                    <TextInput
                      mode="flat"
                      label="Display name"
                      onChangeText={setDisplayName}
                      value={displayName !== uri ? displayName : ''}
                      autoCapitalize="words"
                    />

                    {!myself ? (
                      <TextInput
                        mode="flat"
                        label="Organization"
                        onChangeText={setOrganization}
                        value={organization}
                        autoCapitalize="words"
                      />
                    ) : (
                      <TextInput
                        mode="flat"
                        label="Email"
                        placeholder="Used to recover the password"
                        onChangeText={setEmail}
                        value={email}
                        autoCapitalize="none"
                      />
                    )}

                    {myself && <Text style={styles.emailStatus}>Used to recover a lost password</Text>}

                    <View style={styles.buttonRow}>
                      <Button
                        mode="contained"
                        style={styles.button}
                        disabled={confirm || (myself && !validEmail())}
                        onPress={handleSave}
                        icon="content-save"
                      >
                        Save
                      </Button>

                      {!myself && (
                        <Button
                          mode="contained"
                          style={styles.button}
                          disabled={myself}
                          onPress={handleDelete}
                        >
                          {confirm ? 'Confirm delete' : 'Delete'}
                        </Button>
                      )}
                    </View>

                    {myself ? (
                      <Text onPress={() => Linking.openURL('http://delete.sylk.link')} style={styles.link}>
                        Delete account on server...
                      </Text>
                    ) : (
                      <Text>Storage usage: {selectedContact?.prettyStorage}</Text>
                    )}

                    <View style={{ flexDirection: 'row', marginTop: 8 }}>
                      <Icon style={styles.lock} name="lock" />
                      <Text style={styles.pgp}>Messages are encrypted end-to-end</Text>
                    </View>

                    <View style={{ flexDirection: 'row', marginTop: 4 }}>
                      <Text style={styles.pgp}>Device: {myuuid}</Text>
                    </View>
                  </>
                )}
              </Surface>
            </TouchableWithoutFeedback>
          </KeyboardAwareScrollView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

EditContactModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func.isRequired,
  uri: PropTypes.string,
  displayName: PropTypes.string,
  email: PropTypes.string,
  organization: PropTypes.string,
  publicKey: PropTypes.string,
  selectedContact: PropTypes.object,
  myself: PropTypes.bool,
  saveContact: PropTypes.func,
  deleteContact: PropTypes.func,
  deletePublicKey: PropTypes.func,
  myuuid: PropTypes.string,
  rejectNonContacts: PropTypes.bool,
  toggleRejectNonContacts: PropTypes.func
};

export default EditContactModal;
