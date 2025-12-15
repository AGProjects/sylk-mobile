import React, { useState, useEffect } from 'react';
import { Modal, View, TouchableWithoutFeedback, Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet } from 'react-native';
import { Button, Text, TextInput, Chip, Surface } from 'react-native-paper';
import { FlatList, Platform} from 'react-native';
import PropTypes from 'prop-types';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/ContentStyles';

const ConferenceModal = ({
  show,
  handleConferenceCall,
  myInvitedParties = {},
  accountId,
  selectedContact,
  targetUri: propTargetUri,
  defaultDomain,
  defaultConferenceDomain,
}) => {
  const initialTargetUri = propTargetUri ? propTargetUri.split('@')[0] : '';
  const [targetUri, setTargetUri] = useState(initialTargetUri);
  const [participants, setParticipants] = useState([]);

  useEffect(() => {
    setTargetUri(propTargetUri ? propTargetUri.split('@')[0] : '');
  }, [propTargetUri]);

  useEffect(() => {
    handleConferenceTargetChange(targetUri);
  }, [targetUri]);

	useEffect(() => {
	  if (show && selectedContact) {
		handleConferenceTargetChange(targetUri);
	  }
	}, [selectedContact, show]);

  const sanitizeParticipants = (rawParticipants) => {
    const sanitized = [];
    rawParticipants.forEach((item) => {
      item = item.trim().toLowerCase();
      if (!item || item === accountId) return;

      const [username, domain] = item.split('@');
      if (!username) return;

      if (!domain || domain === defaultDomain) {
        sanitized.push(username);
      } else {
        sanitized.push(item);
      }
    });
    return sanitized;
  };

  const handleConferenceTargetChange = (value) => {
    let uri = value;
    let rawParticipants = [];

    if (uri) {
      const fullUri = `${uri.replace(/[\s@()]/g, '')}@${defaultConferenceDomain}`;
      if (selectedContact?.participants) {
        rawParticipants = selectedContact.participants;
      } else if (myInvitedParties[fullUri]) {
        rawParticipants = myInvitedParties[fullUri];
      }
    }

    setParticipants(sanitizeParticipants(rawParticipants));
    setTargetUri(uri);
  };

  const removeParticipant = (uriToRemove) => {
    setParticipants((prev) => prev.filter((p) => p !== uriToRemove));
  };

  const joinConference = (withVideo) => {
    if (!targetUri) return;

    const uri = `${targetUri.replace(/[\s@()]/g, '')}@${defaultConferenceDomain}`.toLowerCase();
    const fullParticipants = participants.map((p) =>
      p.includes('@') ? p : `${p}@${defaultDomain}`
    );
    
    const options = { audio: true, video: withVideo, participants: fullParticipants }; 

    handleConferenceCall(uri, options);
  };

  // Reset state and close modal
  const close = () => {
    setTargetUri(propTargetUri ? propTargetUri.split('@')[0] : '');
    setParticipants([]);
    handleConferenceCall(null);
  };

  if (!show) return null;
  
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
            {/* Modal content start */}

                <Text style={containerStyles.title}>Join conference</Text>

                {/* Scrollable content above buttons */}
                <ScrollView
                  style={styles.scrollContainer}
                  contentContainerStyle={{ flexGrow: 1 }}
                  keyboardShouldPersistTaps="handled"
                >

                  {!selectedContact ? (
                    <TextInput
                      mode="flat"
                      autoCapitalize="none"
                      label="Enter the room you wish to join"
                      placeholder="room"
                      value={targetUri}
                      onChangeText={setTargetUri}
                    />
                  ) : (
                    <Text style={styles.subtitle}>{targetUri}</Text>
                  )}

                  {participants.length > 0 && (
                    <View>
                      <Text style={styles.body}>Invited participants:</Text>
                      <View style={styles.chipsContainer}>
                        <FlatList
                          style={styles.chips}
                          horizontal
                          data={participants.map((p) => ({ key: p }))}
                          renderItem={({ item }) => (
                            <Chip
                              style={styles.chip}
                              textStyle={styles.chipTextStyle}
                              icon="account"
                              onClose={() => removeParticipant(item.key)}
                            >
                              {item.key}
                            </Chip>
                          )}
                        />
                      </View>
                    </View>
                  )}

                </ScrollView>

                  <Text style={containerStyles.note}>
                    Others can be invited once the conference starts
                  </Text>

                {/* Buttons */}
                <View style={styles.buttonRow}>
                  <Button
                    mode="contained"
                    disabled={!targetUri}
                    style={styles.button}
                    icon="speaker"
                    onPress={() => joinConference(false)}
                  >
                    Audio
                  </Button>
                  <Button
                    mode="contained"
                    disabled={!targetUri}
                    style={styles.button}
                    icon="video"
                    onPress={() => joinConference(true)}
                  >
                    Video
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

ConferenceModal.propTypes = {
  show: PropTypes.bool.isRequired,
  handleConferenceCall: PropTypes.func.isRequired,
  myInvitedParties: PropTypes.object,
  accountId: PropTypes.string,
  selectedContact: PropTypes.object,
  targetUri: PropTypes.string.isRequired,
  defaultDomain: PropTypes.string,
  defaultConferenceDomain: PropTypes.string,
};

export default ConferenceModal;


