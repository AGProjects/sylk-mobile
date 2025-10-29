import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Platform, View, Modal, KeyboardAvoidingView, TouchableWithoutFeedback } from 'react-native';
import { Text, Button, Surface, TextInput } from 'react-native-paper';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/ContentStyles';

// ✅ Sanitize each participant
const sanitizeParticipant = (item, accountId, defaultDomain) => {
  if (!item) return null;
  item = item.trim().toLowerCase();

  // Only ASCII letters, numbers, and limited symbols
  if (!/^[a-z0-9._-]+(@[a-z0-9.-]+)?$/.test(item)) return null;
  if (item === accountId) return null;

  if (!item.includes('@')) return item;

  const [user, domain] = item.split('@');
  if (domain === defaultDomain) return user;
  return item;
};

// ✅ Split and clean participants into array
const splitAndSanitizeParticipants = (str, accountId, defaultDomain) => {
  if (!str) return [];
  return str
    .split(/[\s,]+/) // split by commas or spaces
    .map(p => sanitizeParticipant(p, accountId, defaultDomain))
    .filter(Boolean);
};

// ✅ Convert array to "aaa, bbb, ccc"
const formatParticipantsForDisplay = (arr) => arr.join(', ');

const EditConferenceModal = ({
  show,
  close,
  selectedContact,
  displayName: initialDisplayName,
  invitedParties: initialInvited,
  room,
  accountId,
  defaultDomain,
  saveConference
}) => {
  const [displayName, setDisplayName] = useState(initialDisplayName || '');
  const [participantsStr, setParticipantsStr] = useState('');

  useEffect(() => {
    let participants = [];
    if (initialInvited?.length > 0) {
      participants = initialInvited;
    } else if (selectedContact?.participants?.length > 0) {
      participants = selectedContact.participants;
    }

    // Only sanitize incoming props, not user typing
    const sanitized = splitAndSanitizeParticipants(participants.join(', '), accountId, defaultDomain);
    setParticipantsStr(formatParticipantsForDisplay(sanitized));
    setDisplayName(initialDisplayName || '');
  }, [initialInvited, selectedContact, initialDisplayName, accountId, defaultDomain]);

  const handleSave = () => {
    const participants = splitAndSanitizeParticipants(participantsStr, accountId, defaultDomain);
    const formatted = formatParticipantsForDisplay(participants);
    setParticipantsStr(formatted);

    const name = displayName || selectedContact?.uri;
    saveConference?.(selectedContact?.uri, participants, name);
    close?.();
  };

  if (!show) return null;

  return (
    <Modal
      style={containerStyles.container}
      visible={show}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <TouchableWithoutFeedback onPress={close}>
        <View style={containerStyles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
          >
            <TouchableWithoutFeedback onPress={() => {}}>
              <Surface style={containerStyles.modalSurface}>
                <Text style={containerStyles.title}>Configure conference</Text>
                <Text style={styles.subtitle}>Room {room}</Text>

                <TextInput
                  mode="flat"
                  label="Display name"
                  value={displayName}
                  onChangeText={setDisplayName}
                  autoCapitalize="words"
                />

                <TextInput
                  mode="flat"
                  label="People you wish to invite when you join the room"
                  placeholder="Accounts separated by , or spaces"
                  value={participantsStr}
                  onChangeText={setParticipantsStr}
                  autoCapitalize="none"
                />

                <View style={styles.buttonRow}>
                  <Button
                    mode="contained"
                    style={styles.button}
                    onPress={handleSave}
                    icon="content-save"
                  >
                    Save
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

EditConferenceModal.propTypes = {
  room: PropTypes.string,
  displayName: PropTypes.string,
  show: PropTypes.bool,
  close: PropTypes.func.isRequired,
  saveConference: PropTypes.func,
  invitedParties: PropTypes.array,
  selectedContact: PropTypes.object,
  defaultDomain: PropTypes.string,
  accountId: PropTypes.string,
};

export default EditConferenceModal;
