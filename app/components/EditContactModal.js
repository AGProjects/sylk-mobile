import React, { useState, useEffect } from 'react';
import { Modal, View, TouchableWithoutFeedback, KeyboardAvoidingView, ScrollView, Platform, Linking } from 'react-native';
import { Text, Button, Surface, TextInput, Switch, Checkbox } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PropTypes from 'prop-types';
import utils from '../utils';
import UserIcon from './UserIcon';
import {Gravatar, GravatarApi} from 'react-native-gravatar';
import {Keyboard} from 'react-native';

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
  toggleRejectAnonymous,
  chatSounds,
  toggleChatSounds,
  storageUsage
}) => {
  const [uri, setUri] = useState(propUri || '');
  const [displayName, setDisplayName] = useState(propDisplayName || '');
  const [organization, setOrganization] = useState(propOrg || '');
  const [email, setEmail] = useState(propEmail || '');
  const [confirm, setConfirm] = useState(false);
  const [tags, setTags] = useState([]);
  const [tagsText, setTagsText] = useState('');
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // Reset all form fields whenever modal opens or props change
  useEffect(() => {
    if (show) {
      setUri(propUri || '');
      setDisplayName(propDisplayName || '');
      setOrganization(propOrg || '');
      setEmail(propEmail || '');
      setConfirm(false);
      let initialTags = selectedContact?.tags || [];
      initialTags = [...new Set(initialTags.map(t => t.trim().toLowerCase()))];
      setTags(initialTags);
      setTagsText(initialTags.join(', '));
    }
  }, [show, propUri, propDisplayName, propOrg, propEmail]);

	useEffect(() => {
	  setTagsText(tags.join(', '));
	}, [tags]);

	useEffect(() => {
	  const showSub = Keyboard.addListener('keyboardDidShow', () => {
		setKeyboardVisible(true);
	  });
	
	  const hideSub = Keyboard.addListener('keyboardDidHide', () => {
		setKeyboardVisible(false);
	  });
	
	  return () => {
		showSub.remove();
		hideSub.remove();
	  };
	}, []);

	const handleTagsTextChange = (text) => {
	  setTagsText(text);
	
	  const parsed = text
		.split(',')
		.map(t => t.trim().toLowerCase())
		.filter(t => t.length > 0);
	
	  setTags(parsed);
	};

const getTotalPrettyStorage = (entity) => {
  if (!Array.isArray(storageUsage)) return null;

  const entry = storageUsage.find(
    item => item.remote_party === entity
  );

  return entry?.prettySize || null;
};

  const handleSave = () => {
    const contact = {
      uri: uri.trim().toLowerCase(),
      displayName: displayName.trim(),
      organization: organization.trim(),
      email: email.toLowerCase(),
      tags
    };
    saveContact(contact);
    close();
  };

	const toggleTag = (tagName) => {
	  setTags(prev => {
		const isSelected = prev.includes(tagName);
	
		if (isSelected) {
		  // Turning OFF → simply remove it
		  return prev.filter(t => t !== tagName);
		}
	
		// Turning ON:
		const newTags = [...prev, tagName];
	
		// Remove conflicting tags
		const toRemove = editableTags[tagName]?.removeTags || [];
	
		return newTags.filter(t => !toRemove.includes(t));
	  });
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
  
  const isTagVisible = (tagKey) => {
  const rule = editableTags[tagKey];

  if (!rule) return true;

  const hiddenBecause = rule.invisibleIfTags || [];

  // If selected tags include any forbidden tag → hide this option
  return !hiddenBecause.some(t => tags.includes(t));
};

const editableTags = {
  bypassdnd: {          // <── lowercase key
    description: 'Bypass Do Not Disturb',
    invisibleIfTags: ['muted', 'blocked'],
    removeTags: ['muted']
  },
  muted: {
    description: 'Mute notifications',
    invisibleIfTags: ['blocked', 'bypassdnd'],
    removeTags: ['bypassdnd']
  },
  noread: {
    description: 'No read receipts'
  }
};

  const as = 50;
  
  entity = myself ? 'all' : uri;
  
  const totalUsage = getTotalPrettyStorage(entity);
  
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

                    {!myself && !keyboardVisible && (
						<View style={{ marginTop: 0 }}>
						  {Object.entries(editableTags).map(([tagKey, info]) => {
							if (!isTagVisible(tagKey)) return null;  // ← hide if needed
						
							const isSelected = tags.includes(tagKey);
						
							return (
							  <View key={tagKey} style={styles.checkBoxRow}>
								{Platform.OS === 'ios' ? (
								  <Switch
									value={isSelected}
									onValueChange={() => toggleTag(tagKey)}
								  />
								) : (
								  <Checkbox
									status={isSelected ? 'checked' : 'unchecked'}
									onPress={() => toggleTag(tagKey)}
								  />
								)}
								<Text> {info.description}</Text>
							  </View>
							);
						  })}

					<View style={{ marginTop: 5, flexDirection: 'row', flexWrap: 'wrap' }}>
					  <Text style={{ fontSize: 12, fontWeight: '600', marginRight: 4 }}>
						Tags:
					  </Text>
					  <Text style={{ fontSize: 12, color: '#555' }}>
						{tags.length > 0 ? tags.join(', ') : 'none'}
					  </Text>
					</View>

						</View>
                    )}

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

                    {myself && (
                      <View style={styles.checkBoxRow}>
                        {Platform.OS === 'ios' ? (
                          <Switch value={chatSounds} onValueChange={toggleChatSounds} />
                        ) : (
                          <Checkbox status={chatSounds ? 'checked' : 'unchecked'} onPress={toggleChatSounds} />
                        )}
                        <Text> Chat sounds</Text>
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
                      <Button
                        mode="contained"
                        style={styles.button}
                        onPress={close}
                        icon="cancel"
                      >
                        Close
                      </Button>
                    </View>

                    {myself ? (
                      <Text
                        onPress={() => Linking.openURL('http://delete.sylk.link')}
                        style={[styles.link, { paddingBottom: 10 }]}
                      >
                        Delete account on server...
                      </Text>
                    ) : (
                      selectedContact?.prettyStorage && !keyboardVisible && (
                        <Text style={styles.small}>Storage usage: {selectedContact.prettyStorage}</Text>
                      )
                    )}

                    {!myself && false && !keyboardVisible && (
                    <View style={{ flexDirection: 'row', marginTop: 8 }}>
                      <Icon style={styles.lock} name="lock" />
                      <Text style={styles.small}>Messages are encrypted end-to-end</Text>
                    </View>
                    )}

                    {myself && false && (
                      <View style={{ flexDirection: 'row', marginTop: 4 }}>
                        <Text style={styles.small}>Device Id: {myuuid}</Text>
                        <Text style={styles.small}> | Storage usage: {totalUsage}</Text>
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
  toggleRejectAnonymous: PropTypes.func,
  chatSounds: PropTypes.bool,
  toggleChatSounds: PropTypes.func,
  storageUsage: PropTypes.array
};

export default EditContactModal;
