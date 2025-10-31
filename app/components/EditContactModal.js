import React, { useState, useEffect } from 'react';
import { Modal, View, TouchableWithoutFeedback, KeyboardAvoidingView, ScrollView, Platform, Linking } from 'react-native';
import { Text, Button, Surface, TextInput, Switch, Checkbox } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PropTypes from 'prop-types';
import utils from '../utils';
import UserIcon from './UserIcon';
import {Gravatar, GravatarApi} from 'react-native-gravatar';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/ContentStyles';

const EditContactModal = ({
  show,
  close,
  saveContact,
  uri: propUri,
  displayName: propDisplayName,
  email: propEmail,
  organization: propOrg,
  publicKey,
  selectedContact,
  myself,
  deletePublicKey: deletePublicKeyProp,
  myuuid,
  rejectNonContacts,
  toggleRejectNonContacts,
  rejectAnonymous,
  toggleRejectAnonymous
}) => {
  const [uri, setUri] = useState(propUri || '');
  const [displayName, setDisplayName] = useState(propDisplayName || '');
  const [organization, setOrganization] = useState(propOrg || '');
  const [email, setEmail] = useState(propEmail || '');
  const [confirm, setConfirm] = useState(false);

  // Reset all form fields whenever modal opens or props change
  useEffect(() => {
    if (show) {
      setUri(propUri || '');
      setDisplayName(propDisplayName || '');
      setOrganization(propOrg || '');
      setEmail(propEmail || '');
      setConfirm(false);
    }
  }, [show, propUri, propDisplayName, propOrg, propEmail]);

  const handleSave = () => {
    const contact = {
      uri: uri.trim().toLowerCase(),
      displayName: displayName.trim(),
      organization: organization.trim(),
      email: email.toLowerCase()
    };
    saveContact(contact);
    close();
  };

  const handleClose = () => {
    setConfirm(false);
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
  let title = myself ? "My account" : 'Edit Contact';

  if (publicKey) {
	  title = 'Public key';
  }
  
  const as = 50;

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
				{selectedContact ? (
				  <View
					style={{
					  position: 'absolute',
					  top: 16,
					  left: 16,
					  zIndex: 10,
					}}
				  >
					{selectedContact.photo || selectedContact.email ? (
					  <UserIcon size={50} identity={selectedContact} />
					) : (
					  <Gravatar
						options={{
						  email: selectedContact.email,
						  parameters: { size: 50, d: 'mm' },
						  secure: true,
						}}
						style={{ width: 50, height: 50, borderRadius: 25 }}
					  />
					)}
				  </View>
				) : null}



            {/* Modal content start */}
				<Text style={containerStyles.title}>{title}</Text>

                {publicKey ? (
                  <>
                    <Text style={styles.subtitle}>{uri}</Text>
					<ScrollView
					  style={{
						height: 300,
						backgroundColor: '#f0f0f0',
						borderRadius: 4,
						borderWidth: 1,
						borderColor: '#ccc',
						padding: 8,
					  }}
					  horizontal
					  nestedScrollEnabled
					  bounces
					  showsHorizontalScrollIndicator
					  showsVerticalScrollIndicator
					>
					  <ScrollView
						style={{ flex: 1 }}
						nestedScrollEnabled
						bounces
						showsVerticalScrollIndicator
					  >
						<Text style={{ fontFamily: 'monospace', fontSize: 10, lineHeight: 12 }}>
						  {publicKey}
						</Text>
					  </ScrollView>
					</ScrollView>


                    <View style={styles.buttonRow}>
                      <Button
                        mode="contained"
                        style={styles.button}
                        disabled={confirm}
                        onPress={handleClipboard}
                        icon="content-copy"
                      >
                        Copy
                      </Button>
                    </View>

                    <Text style={styles.small}>You can use this key with other software that uses OpenPGP for encryption</Text>

                  </>
                ) : (
                  <>
                    <Text style={styles.subtitle}>{uri}</Text>

                    <ScrollView
                      style={containerStyles.scrollContainer}
                      contentContainerStyle={{ flexGrow: 1 }}
                      keyboardShouldPersistTaps="handled"
                    >
                      <TextInput
                        mode="flat"
                        label="Display name"
                        onChangeText={setDisplayName}
                        value={displayName}
                        autoCapitalize="words"
                      />
                      {!myself && (
                        <TextInput
                          mode="flat"
                          label="Organization"
                          onChangeText={setOrganization}
                          value={organization}
                          autoCapitalize="words"
                        />
                      )}
                      <TextInput
                        mode="flat"
                        label="Email"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        onChangeText={setEmail}
                        value={email}
                      />
                    </ScrollView>

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

                    {myself && !rejectNonContacts && (
                      <View style={styles.checkBoxRow}>
                        {Platform.OS === 'ios' ? (
                          <Switch value={rejectAnonymous} onValueChange={toggleRejectAnonymous} />
                        ) : (
                          <Checkbox status={rejectAnonymous ? 'checked' : 'unchecked'} onPress={toggleRejectAnonymous} />
                        )}
                        <Text> Reject anonymous callers</Text>
                      </View>
                    )}

                    <View style={styles.buttonRow}>
                      <Button
                        mode="contained"
                        style={styles.button}
                        disabled={!validEmail()}
                        onPress={handleSave}
                        icon="content-save"
                      >
                        Save
                      </Button>
                    </View>

                    {myself ? (
                      <Text
                        onPress={() => Linking.openURL('http://delete.sylk.link')}
                        style={[styles.link, { padding: 20 }]}
                      >
                        Deletion account on server...
                      </Text>
                    ) : (
                      selectedContact?.prettyStorage && (
                        <Text>Storage usage: {selectedContact.prettyStorage}</Text>
                      )
                    )}

                    {!myself ?
                    <View style={{ flexDirection: 'row', marginTop: 8 }}>
                      <Icon style={styles.lock} name="lock" />
                      <Text style={styles.small}>Messages are encrypted end-to-end</Text>
                    </View>
                    : null}

                    {false && myself && (
                      <View style={{ flexDirection: 'row', marginTop: 4 }}>
                        <Text style={styles.small}>Device Id: {myuuid}</Text>
                      </View>
                    )}
                  </>
                )}
              </Surface>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

EditContactModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func.isRequired,
  saveContact: PropTypes.func,
  uri: PropTypes.string,
  displayName: PropTypes.string,
  email: PropTypes.string,
  organization: PropTypes.string,
  publicKey: PropTypes.string,
  selectedContact: PropTypes.object,
  myself: PropTypes.bool,
  deletePublicKey: PropTypes.func,
  myuuid: PropTypes.string,
  rejectNonContacts: PropTypes.bool,
  toggleRejectNonContacts: PropTypes.func,
  rejectAnonymous: PropTypes.bool,
  toggleRejectAnonymous: PropTypes.func
};

export default EditContactModal;
