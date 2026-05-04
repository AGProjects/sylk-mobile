import React, { useState, useEffect } from 'react';
import { Modal, View, TouchableWithoutFeedback, KeyboardAvoidingView, ScrollView, Platform, Linking } from 'react-native';
import { Text, Button, Surface, TextInput, Switch, Checkbox } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PropTypes from 'prop-types';
import utils from '../utils';
import UserIcon from './UserIcon';
import {Gravatar, GravatarApi} from 'react-native-gravatar';
import {Keyboard} from 'react-native';
import CryptoJS from "crypto-js";

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/ContentStyles';

export function generateShortChecksum(publicKey) {
  // Normalize key (important!)
  const normalizedKey = publicKey
    .replace(/\r\n/g, "\n") // normalize line endings
    .trim();

  // Hash with SHA-256
  const hash = CryptoJS.SHA256(normalizedKey);

  // Convert to hex
  const hex = hash.toString(CryptoJS.enc.Hex);

  // Return first 8 characters (32 bits)
  return hex.substring(0, 8).toUpperCase();
}

const EditContactModal = ({
  show,
  close,
  saveContactByUser,
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
  readReceipts,
  toggleReadReceipts,
  storageUsage,
  deleteAccountUrl,
  openDeleteAccount,
  preferredVideoCodec,
  setPreferredVideoCodec,
  encryptionMode,
}) => {
  const [uri, setUri] = useState(propUri || '');
  const [displayName, setDisplayName] = useState(propDisplayName || '');
  const [organization, setOrganization] = useState(propOrg || '');
  const [email, setEmail] = useState(propEmail || '');
  const [confirm, setConfirm] = useState(false);
  const [tags, setTags] = useState([]);
  const [tagsText, setTagsText] = useState('');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  // Per-contact encryption mode override.
  // null  → follow the device default (set in Preferences → Encryption)
  // 'sdes' / 'zrtp_optional' / 'zrtp_mandatory' → override for this
  // contact regardless of the device default
  const [contactEncryption, setContactEncryption] = useState(
    (selectedContact && selectedContact.localProperties
      && selectedContact.localProperties.encryptionMode) || null
  );

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
      setContactEncryption(
        (selectedContact && selectedContact.localProperties
          && selectedContact.localProperties.encryptionMode) || null
      );
    }
  }, [show, propUri, propDisplayName, propOrg, propEmail, selectedContact]);

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
      tags,
      // Per-contact encryption-mode override. null → clear the
      // override (revert to device default). saveContactByUser merges
      // localProperties and treats null/undefined as "delete this key".
      localProperties: { encryptionMode: contactEncryption || null },
    };
    saveContactByUser(contact, selectedContact);
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

	let editableTags = {
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
		description: 'Read receipts',
		invert: true
	  }
	};

	if (selectedContact && selectedContact.tags.indexOf('test') > -1) {
		editableTags = {};
	}

  const as = 50;
  
  entity = myself ? 'all' : uri;
  
  const totalUsage = getTotalPrettyStorage(entity);
  let checksum;
  
  if (publicKey) {
      checksum = generateShortChecksum(publicKey);
  } 
  
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
                      {/* Debug helper: drop the cached public key for this
                          contact so the next chat-open re-runs lookupPublicKey
                          and re-triggers the cross-domain handshake. Two-tap
                          confirm pattern (handleDeletePublicKey toggles the
                          `confirm` state on first press, performs the delete
                          on the second) so an accidental tap is recoverable. */}
                      {!myself && deletePublicKeyProp && (
                        <Button
                          mode={confirm ? 'contained' : 'outlined'}
                          style={styles.button}
                          onPress={handleDeletePublicKey}
                          icon="delete"
                          color="#c62828"
                        >
                          {confirm ? 'Tap to confirm' : 'Delete'}
                        </Button>
                      )}
                    </View>

                    <Text style={styles.small}>Checksum: {checksum}</Text>

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

							const tagPresent = tags.includes(tagKey);
							let displayValue = info.invert ? !tagPresent : tagPresent;
							// Per-contact "Read receipts" must follow the global setting:
							// if the account-level Read receipts is off, gray out the
							// per-contact override since it has no effect, and force
							// the displayed value to false regardless of the saved tag.
							const isDisabled = tagKey === 'noread' && readReceipts === false;
							if (isDisabled) {
								displayValue = false;
							}
							const rowOpacity = isDisabled ? 0.4 : 1;

							return (
							  <View key={tagKey} style={[styles.checkBoxRow, {marginBottom: Platform.OS === 'ios'? 5: 0, opacity: rowOpacity}]}>
								{Platform.OS === 'ios' ? (
								  <Switch
									value={displayValue}
									onValueChange={() => toggleTag(tagKey)}
									disabled={isDisabled}
								  />
								) : (
								  <Checkbox
									status={displayValue ? 'checked' : 'unchecked'}
									onPress={() => toggleTag(tagKey)}
									disabled={isDisabled}
								  />
								)}
								<Text> {isDisabled ? 'Read receipts disabled for account' : info.description}</Text>
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
                      <View style={[styles.checkBoxRow, {marginBottom: Platform.OS === 'ios'? 5: 0}]}>
                        {Platform.OS === 'ios' ? (
                          <Switch value={rejectNonContacts} onValueChange={toggleRejectNonContacts} />
                        ) : (
                          <Checkbox status={rejectNonContacts ? 'checked' : 'unchecked'} onPress={toggleRejectNonContacts} />
                        )}
                        <Text> Allow calls only from my contacts</Text>
                      </View>
                    )}

                    {myself && !rejectNonContacts && (
                      <View style={[styles.checkBoxRow, {marginBottom: Platform.OS === 'ios'? 5: 0}]}>
                        {Platform.OS === 'ios' ? (
                          <Switch value={rejectAnonymous} onValueChange={toggleRejectAnonymous} />
                        ) : (
                          <Checkbox status={rejectAnonymous ? 'checked' : 'unchecked'} onPress={toggleRejectAnonymous} />
                        )}
                        <Text> Reject anonymous callers</Text>
                      </View>
                    )}

                    {myself && (
                      <View style={[styles.checkBoxRow, {marginBottom: Platform.OS === 'ios'? 5: 0}]}>
                        {Platform.OS === 'ios' ? (
                          <Switch value={chatSounds} onValueChange={toggleChatSounds} />
                        ) : (
                          <Checkbox status={chatSounds ? 'checked' : 'unchecked'} onPress={toggleChatSounds} />
                        )}
                        <Text> Chat sounds</Text>
                      </View>
                    )}

                    {myself && (
                      <View style={[styles.checkBoxRow, {marginBottom: Platform.OS === 'ios'? 0: 0}]}>
                        {Platform.OS === 'ios' ? (
                          <Switch value={readReceipts} onValueChange={toggleReadReceipts} />
                        ) : (
                          <Checkbox status={readReceipts ? 'checked' : 'unchecked'} onPress={toggleReadReceipts} />
                        )}
                        <Text> Read receipts</Text>
                      </View>
                    )}

                    {/* Video codec preference is device-wide (set in
                        Preferences → Video Codecs). No per-contact
                        override — every outgoing call uses the same
                        codec on this phone. */}

                    {/* Per-contact encryption mode override. The first
                        button shows the current device default and is
                        rendered grayed-out; tapping it clears any
                        override. The remaining buttons are the modes
                        that AREN'T already the device default
                        (otherwise the default button is the same as a
                        regular button — redundant). Mirrors the old
                        per-contact codec UI. */}
                    {!myself && selectedContact && (() => {
                      const deviceDefault = encryptionMode || 'zrtp_optional';
                      // Only zRTP modes are exposed; SRTP/DTLS is the
                      // always-on transport-layer fallback.
                      const ENC_OPTIONS = [
                        { value: 'zrtp_optional',  label: 'zRTP optional' },
                        { value: 'zrtp_mandatory', label: 'zRTP mandatory' },
                      ];
                      const defaultLabel = (
                        ENC_OPTIONS.find(o => o.value === deviceDefault) || {}
                      ).label || deviceDefault;
                      const others = ENC_OPTIONS.filter(o => o.value !== deviceDefault);
                      // Stored override that matches the device default
                      // is functionally equivalent to no override.
                      const usingDefault = contactEncryption == null
                          || contactEncryption === deviceDefault;
                      return (
                        <View style={{ marginTop: 8, marginBottom: 8 }}>
                          <Text style={{ fontSize: 12, fontWeight: '600', marginBottom: 4 }}>
                            Encryption for this contact
                          </Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                            <Button
                              key="default"
                              mode={usingDefault ? 'contained' : 'outlined'}
                              compact
                              disabled={usingDefault}
                              style={{ marginRight: 6, marginBottom: 4, opacity: 0.7 }}
                              labelStyle={{ color: '#888' }}
                              onPress={() => setContactEncryption(null)}
                            >
                              {`Default (${defaultLabel})`}
                            </Button>
                            {others.map(opt => {
                              const selected = contactEncryption === opt.value;
                              return (
                                <Button
                                  key={opt.value}
                                  mode={selected ? 'contained' : 'outlined'}
                                  compact
                                  style={{ marginRight: 6, marginBottom: 4 }}
                                  onPress={() => setContactEncryption(opt.value)}
                                >
                                  {opt.label}
                                </Button>
                              );
                            })}
                          </View>
                        </View>
                      );
                    })()}

                    <View style={styles.buttonRow}>
                      {/* Matches the DeleteHistoryModal / DeleteFileTransfers
                          button pattern: outlined Cancel on the left,
                          contained primary action on the right. Keeps the
                          whole modal family consistent so the destructive
                          (or save) action is always in the same visual
                          slot. */}
                      <Button
                        mode="outlined"
                        style={styles.button}
                        onPress={close}
                        accessibilityLabel="Cancel"
                      >
                        Cancel
                      </Button>
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

                    {(myself && deleteAccountUrl) ? (
                      <Text
                        onPress={() => Linking.openURL(deleteAccountUrl)}
                        style={[styles.link, { paddingBottom: 10 }]}
                      >
                        Delete account on server...
                      </Text>
                    ) : (
                      selectedContact?.prettyStorage && !keyboardVisible && (
                        <Text style={styles.small}>Storage usage: {selectedContact.prettyStorage}</Text>
                      )
                    )}

                    {/*
                        Small "Delete account" link pinned to the bottom-right.
                        Deliberately less prominent than Save (no Button chrome,
                        smaller text, muted-destructive colour) so it does not
                        compete visually with the primary save action but is
                        still discoverable. Tapping it hands control to the
                        host (NavigationBar), which opens DeleteAccountModal
                        for a two-step confirmation before firing the real
                        destructive action via app.deleteAccount().
                    */}
                    {myself && openDeleteAccount && !keyboardVisible && (
                      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 4, paddingBottom: 10, paddingRight: 10 }}>
                        <Text
                          onPress={openDeleteAccount}
                          accessibilityRole="button"
                          accessibilityLabel="Delete account"
                          style={{ fontSize: 12, color: '#c62828', textDecorationLine: 'underline' }}
                        >
                          Delete account
                        </Text>
                      </View>
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
  saveContactByUser: PropTypes.func,
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
  readReceipts: PropTypes.bool,
  toggleReadReceipts: PropTypes.func,
  storageUsage: PropTypes.array,
  deleteAccountUrl: PropTypes.string,
  openDeleteAccount: PropTypes.func,
};

export default EditContactModal;
