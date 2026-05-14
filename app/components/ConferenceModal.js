import React, { useState, useEffect, useRef } from 'react';
import { Modal, View, Pressable, Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet } from 'react-native';
import { Button, Text, TextInput, Chip, Surface } from 'react-native-paper';
import { Platform } from 'react-native';
import PropTypes from 'prop-types';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/ContentStyles';

// ---------------------------------------------------------------------------
// FancyRandomWords room-name generator.
//
// Used to pre-fill the "Join conference" room field so the user can either:
//   • tap straight through to Audio / Video and start a fresh ad-hoc room
//     with a memorable name, or
//   • tap the × inside the field to clear it and type their own room name.
//
// Format matches the existing Sylk web client convention seen across the
// codebase (e.g. "DaffodilFlyChill0"): Adjective + Noun + Adverb + single
// digit, every word capitalised, no separators. Picking entirely
// lower-case ASCII words keeps it valid as a SIP user-part with no
// further sanitisation.
// ---------------------------------------------------------------------------
const FANCY_ADJECTIVES = [
  'Brave', 'Calm', 'Clever', 'Cosmic', 'Crisp', 'Daring', 'Dreamy',
  'Eager', 'Electric', 'Fancy', 'Fluffy', 'Gentle', 'Golden', 'Happy',
  'Jolly', 'Kind', 'Lucky', 'Merry', 'Misty', 'Noble', 'Quick',
  'Quiet', 'Royal', 'Shiny', 'Silver', 'Snowy', 'Stormy', 'Sunny',
  'Swift', 'Tender', 'Vivid', 'Witty', 'Zen',
];
const FANCY_NOUNS = [
  'Apple', 'Bear', 'Breeze', 'Cloud', 'Comet', 'Crane', 'Daisy',
  'Dolphin', 'Echo', 'Falcon', 'Feather', 'Flame', 'Forest',
  'Frost', 'Galaxy', 'Garden', 'Glacier', 'Harbor', 'Horizon',
  'Island', 'Lake', 'Lantern', 'Lotus', 'Meadow', 'Moon', 'Mountain',
  'Ocean', 'Orchid', 'Otter', 'Panda', 'Pearl', 'Phoenix', 'Rain',
  'River', 'Spark', 'Star', 'Sun', 'Thunder', 'Tiger', 'Valley',
  'Vine', 'Whale', 'Willow', 'Wind',
];
const FANCY_ADVERBS = [
  'Bright', 'Calmly', 'Daily', 'Fast', 'Gladly', 'Happily', 'Lightly',
  'Loudly', 'Nicely', 'Proud', 'Quickly', 'Quietly', 'Safely', 'Slow',
  'Smartly', 'Softly', 'Sweetly', 'Wisely',
];

const fancyRandomRoom = () => {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const digit = Math.floor(Math.random() * 10); // 0-9
  return `${pick(FANCY_ADJECTIVES)}${pick(FANCY_NOUNS)}${pick(FANCY_ADVERBS)}${digit}`;
};

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
  // Pre-fill the room field with a fancy random name when there is
  // no caller-supplied propTargetUri. The user can either tap
  // Audio / Video straight away (room exists by virtue of being
  // joined) or tap the × on the right of the field to clear it
  // and type their own name. When a propTargetUri IS supplied (the
  // modal is being opened from a saved-room shortcut or chat
  // header) it wins — we never overwrite an explicit caller value.
  const initialTargetUri = propTargetUri
    ? propTargetUri.split('@')[0]
    : fancyRandomRoom();
  const [targetUri, setTargetUri] = useState(initialTargetUri);
  const [participants, setParticipants] = useState([]);
  const [domain, setDomain] = useState(defaultDomain);

  useEffect(() => {
    // Re-sync when propTargetUri arrives or changes. If it lands
    // empty, mint a fresh fancy random name so the user always
    // has something useful in the field — typing immediately
    // replaces it via setTargetUri.
    setTargetUri(propTargetUri ? propTargetUri.split('@')[0] : fancyRandomRoom());
  }, [propTargetUri]);

  // Re-seed the field every time the modal becomes visible. The
  // component stays mounted across show toggles (the `if (!show)
  // return null` guard is just a render bail-out — useState
  // values persist), so without this effect, tapping the clear-×
  // and then closing the modal leaves an empty field for the
  // next open. The user reported exactly that: "X removed the
  // fancy names forever". On every false → true edge of `show`
  // we mint a fresh fancyRandomRoom() — unless a propTargetUri
  // is being passed in, in which case it still wins.
  const prevShowRef = useRef(false);
  useEffect(() => {
    if (show && !prevShowRef.current) {
      // false → true edge
      setTargetUri(propTargetUri ? propTargetUri.split('@')[0] : fancyRandomRoom());
    }
    prevShowRef.current = show;
    // propTargetUri is read inside but not added to deps on
    // purpose — the dedicated propTargetUri effect above already
    // covers prop changes; this effect's only job is the edge
    // detection, so listening just on `show` keeps it cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

	useEffect(() => {
	  setDomain(defaultDomain);
	}, [defaultDomain]);

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

      if (!domain) {
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
    
    const options = { audio: true, video: withVideo, participants: fullParticipants, domain: defaultDomain }; 

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

      {/* Dismiss modal when tapping outside.

          Switched from the original
            outer TouchableWithoutFeedback onPress={close}
            + inner  TouchableWithoutFeedback onPress={() => {}}
          pattern to a Pressable SIBLING that absolute-fills the
          overlay behind the Surface — same shape EditContactModal,
          PreferencesModal, and EditConferenceModal now use. The
          nested-TWF approach was a known focus / responder
          troublemaker in this codebase (TextInputs inside the
          Surface lost focus through keyboard transitions because
          the no-op inner TWF claimed touches every time the IME
          opened or closed, and ScrollView pans were stolen by the
          TWF parent on Android). The Pressable sibling sits behind
          the Surface in JSX order, so the Surface intercepts every
          touch landing on it before the backdrop can see it; taps
          outside fall through and dismiss the modal. */}
      <View style={containerStyles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={close}
          accessibilityLabel="Close join conference"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
        >

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
                      <View style={styles.chipsContainer}>
                    <TextInput
                      mode="flat"
                      autoCapitalize="none"
                      autoCorrect={false}
                      label="Enter the room you wish to join"
                      placeholder="room"
                      value={targetUri}
                      onChangeText={setTargetUri}
                      // Trailing × clears the field so the user can
                      // overwrite the fancy random pre-fill with
                      // their own room name. Tap the icon → field
                      // empties → on-screen keyboard stays up so
                      // they can start typing right away. Only
                      // surfaced when there is something to clear
                      // (Paper v5 still renders the slot whether
                      // we pass an icon or not, but giving null
                      // when empty avoids a no-op tap target).
                      right={targetUri ? (
                        <TextInput.Icon
                          icon="close"
                          onPress={() => setTargetUri('')}
                          accessibilityLabel="Clear room name"
                        />
                      ) : null}
                    />
                    {/* Sylk Domain input was an experiment — hidden for now.
                        The conference URI is composed from defaultConferenceDomain
                        and the `domain` state is still tracked internally so any
                        downstream code that reads it keeps working. */}
                    </View>

                  ) : (
                    <Text style={styles.subtitle}>{targetUri}</Text>
                  )}

                  {participants.length > 0 && (
                    <View>
                      <Text style={styles.body}>Invited participants:</Text>
                      {/* Wrapping pill row, NOT a horizontal FlatList.
                          The previous horizontal FlatList laid the
                          chips out on one line and quietly extended
                          past the modal's right edge once more than
                          two or three names were present — the
                          overflow chips lived outside the Surface's
                          `overflow: 'hidden'` and were unreachable.
                          A plain `flexDirection: 'row'` View with
                          `flexWrap: 'wrap'` keeps every chip inside
                          the Surface and stacks extras onto further
                          lines, same shape as the pill row used in
                          EditConferenceModal.

                          Labels show only the local part of each
                          participant URI — the room is bound to a
                          single conference domain so the trailing
                          "@sylk.link" / "@sip2sip.info" adds no
                          information and burns horizontal space.
                          The full URI is still preserved as the
                          chip's identity (state, key, onClose
                          target) so the data side is unchanged. */}
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {participants.map((p) => {
                          const at = p.indexOf('@');
                          const label = at > 0 ? p.substring(0, at) : p;
                          return (
                            <Chip
                              key={p}
                              style={[styles.chip, { marginRight: 6, marginBottom: 6 }]}
                              textStyle={styles.chipTextStyle}
                              icon="account"
                              onClose={() => removeParticipant(p)}
                            >
                              {label}
                            </Chip>
                          );
                        })}
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
        </KeyboardAvoidingView>
      </View>
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
  defaultConferenceDomain: PropTypes.string
};

export default ConferenceModal;


