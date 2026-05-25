import React, { useState, useEffect, useRef } from 'react';
import { Modal, View, Pressable, TouchableWithoutFeedback, Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet } from 'react-native';
import { Button, Text, TextInput, Chip, Surface } from 'react-native-paper';
import { Platform } from 'react-native';
import PropTypes from 'prop-types';

import PlatformToggle from './PlatformToggle';

// 6-digit numeric room name used for the optional "people can call in
// from a phone number" path. When the dial-in checkbox is on, the room
// name itself doubles as the dial-in code that PSTN callers enter on
// their phone keypad — that's why the field switches to numeric. The
// auto-generated value is exactly 6 digits; the user is free to type a
// different number provided it is at least 4 digits long.
const random6DigitRoom = () =>
  String(Math.floor(Math.random() * 1000000)).padStart(6, '0');

// Minimum length the user is allowed to type when overriding the
// auto-generated dial-in room number. 3 or fewer digits are too easy
// to collide on and not worth defending — anything ≥ 4 is accepted.
const PSTN_ROOM_MIN_DIGITS = 4;
const PSTN_ROOM_MAX_DIGITS = 16;

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
  // Initial room field value. When a propTargetUri is supplied
  // (saved-room shortcut, chat header), we honour it. Otherwise
  // we pre-fill a freshly minted 6-digit dial-in number so the
  // user can tap Audio/Video straight away.
  const initialTargetUri = propTargetUri
    ? propTargetUri.split('@')[0]
    : random6DigitRoom();
  const [targetUri, setTargetUri] = useState(initialTargetUri);
  // "Pristine" flag — true when the field still holds the
  // auto-generated suggestion and the user hasn't touched it yet.
  // While pristine, we render the digits in a muted grey so the
  // pre-fill reads as a suggestion rather than as something the
  // user has typed. The first edit / clear flips this off and
  // the text snaps back to normal weight.
  const [pristineRoom, setPristineRoom] = useState(!propTargetUri);
  const [participants, setParticipants] = useState([]);
  const [domain, setDomain] = useState(defaultDomain);
  // PSTN dial-in toggle. When the box is ticked, the SAME room field
  // becomes the dial-in code — phone callers will enter the room
  // number on their keypad to join. Auto-generated rooms are exactly
  // 6 digits, the user may override with any number of 4–16 digits.
  // Toggling OFF restores whatever fancy-word room name was in the
  // field before, so a quick tick-untick doesn't lose the user's
  // original choice.
  // Default ON per user request — most conferences are created
  // expecting phone callers to join, so we surface a numeric room
  // straight away and let the user untick if they want a word-shaped
  // room name instead.
  const [pstnEnabled, setPstnEnabled] = useState(true);
  const savedWordRoomRef = useRef(null);

  useEffect(() => {
    // Re-sync when propTargetUri arrives or changes. If it lands
    // empty, mint a fresh 6-digit suggestion and mark the field
    // pristine (rendered greyed-out until the user edits). A
    // propTargetUri change is treated as an explicit caller value,
    // so the field is NOT pristine in that case.
    if (propTargetUri) {
      setTargetUri(propTargetUri.split('@')[0]);
      setPristineRoom(false);
    } else {
      setTargetUri(random6DigitRoom());
      setPristineRoom(true);
    }
  }, [propTargetUri]);

  // Re-seed the field every time the modal becomes visible. The
  // component stays mounted across show toggles (the `if (!show)
  // return null` guard is just a render bail-out — useState
  // values persist), so without this effect, closing and re-opening
  // would keep the previous open's text. On every false → true edge
  // of `show` we mint a fresh suggested 6-digit room into the
  // PLACEHOLDER (not the value) — unless a propTargetUri is being
  // passed in, in which case that explicit caller value still wins.
  const prevShowRef = useRef(false);
  useEffect(() => {
    if (show && !prevShowRef.current) {
      // false → true edge: mint a fresh suggested room into the
      // value, mark pristine so it renders greyed-out, and reset
      // PSTN dial-in to "on" (the per-user default).
      if (propTargetUri) {
        setTargetUri(propTargetUri.split('@')[0]);
        setPristineRoom(false);
      } else {
        setTargetUri(random6DigitRoom());
        setPristineRoom(true);
      }
      setPstnEnabled(true);
      savedWordRoomRef.current = null;
    }
    prevShowRef.current = show;
    // propTargetUri is read inside but not added to deps on
    // purpose — the dedicated propTargetUri effect above already
    // covers prop changes; this effect's only job is the edge
    // detection, so listening just on `show` keeps it cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  // PSTN-toggle side effect: ticking the box swaps the room field
  // out for a 6-digit number (phone callers will enter this on their
  // keypad), unticking restores whatever was previously in the
  // field. We hold the pre-swap value in a ref so a quick mistake
  // tap-off doesn't lose the user's original fancy-word room. The
  // restore is skipped if the user has since edited the digits to
  // something non-empty — we trust their last explicit edit.
  useEffect(() => {
    if (pstnEnabled) {
      // Remember the room name we're about to overwrite so untick
      // can restore it. Only stash on the off → on edge, never
      // on subsequent renders.
      if (savedWordRoomRef.current === null) {
        savedWordRoomRef.current = targetUri;
      }
      // Replace with a fresh 6-digit room — unless what's already
      // in the field is already a usable numeric room (≥4 digits,
      // digits-only). Lets a user paste a number, tick the box,
      // and keep what they typed.
      const allDigits = /^[0-9]+$/.test(targetUri);
      if (!allDigits || targetUri.length < PSTN_ROOM_MIN_DIGITS) {
        setTargetUri(random6DigitRoom());
      }
    } else {
      // Unticking restores the saved fancy-word room. If the user
      // edited the digits to anything non-empty (≠ pristine random
      // value), we still restore — the dial-in flow is over, the
      // saved name was the user's last "word-shaped" choice.
      if (savedWordRoomRef.current !== null) {
        setTargetUri(savedWordRoomRef.current);
      }
      savedWordRoomRef.current = null;
    }
    // targetUri is intentionally NOT in deps — this effect runs only
    // on the boolean toggle. Adding targetUri would make it re-fire
    // on every keystroke and re-overwrite the user's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pstnEnabled]);

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

  // True when the dial-in box is ticked AND the room name is a valid
  // numeric room (digits only, 4–16 chars). Used to gate the join
  // buttons and the validation warning under the field. The field
  // is pre-filled with a valid 6-digit suggestion on open, so this
  // is true straight away unless the user edits to something
  // invalid.
  const pstnRoomValid =
    !pstnEnabled
    || (/^[0-9]+$/.test(targetUri)
        && targetUri.length >= PSTN_ROOM_MIN_DIGITS
        && targetUri.length <= PSTN_ROOM_MAX_DIGITS);

  const joinConference = (withVideo) => {
    if (!targetUri) return;
    if (!pstnRoomValid) return;

    const uri = `${targetUri.replace(/[\s@()]/g, '')}@${defaultConferenceDomain}`.toLowerCase();
    const fullParticipants = participants.map((p) =>
      p.includes('@') ? p : `${p}@${defaultDomain}`
    );

    const options = {
      audio: true,
      video: withVideo,
      participants: fullParticipants,
      domain: defaultDomain,
      // PSTN dial-in flag. The room number itself is the dial-in
      // code; downstream consumers (startConference, Conference.start)
      // can read pstn===true and use the local-part of the conference
      // URI as the code that will be configured on the SIP bridge.
      pstn: !!pstnEnabled,
    };

    handleConferenceCall(uri, options);
  };

  // Reset state and close modal
  const close = () => {
    setTargetUri(propTargetUri ? propTargetUri.split('@')[0] : '');
    setParticipants([]);
    setPstnEnabled(false);
    savedWordRoomRef.current = null;
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
                      // Label and keyboard mode reflect the dial-in
                      // toggle. With dial-in ON, the same field is
                      // the numeric room code phone callers will
                      // enter on their keypad — number-pad keyboard,
                      // 16-digit cap, non-digit input is stripped.
                      label={pstnEnabled
                        ? `Enter dial-in room number (${PSTN_ROOM_MIN_DIGITS}–${PSTN_ROOM_MAX_DIGITS} digits)`
                        : 'Enter the room you wish to join'}
                      placeholder={pstnEnabled ? '123456' : 'room'}
                      keyboardType={pstnEnabled ? 'number-pad' : 'default'}
                      maxLength={pstnEnabled ? PSTN_ROOM_MAX_DIGITS : undefined}
                      value={targetUri}
                      // While the field still holds the auto-
                      // generated suggestion, render the digits in
                      // a muted grey so they read as "suggested"
                      // rather than as "typed". As soon as the user
                      // edits anything (including clearing), the
                      // text snaps back to normal weight.
                      style={pristineRoom ? { color: '#9aa0a6' } : null}
                      contentStyle={pristineRoom ? { color: '#9aa0a6' } : null}
                      onChangeText={(text) => {
                        // First edit flips the field out of pristine
                        // mode so the muted style above stops applying.
                        if (pristineRoom) setPristineRoom(false);
                        if (pstnEnabled) {
                          // Strip any non-digit so paste-of-garbage
                          // ("(021) 345-6") becomes "021345" and the
                          // field always renders a valid dial-in code.
                          setTargetUri(text.replace(/[^0-9]/g, ''));
                        } else {
                          setTargetUri(text);
                        }
                      }}
                      // Trailing × clears the field so the user can
                      // overwrite the random pre-fill with their own
                      // room name. With PSTN on we keep the same
                      // affordance — clearing lets them type a fresh
                      // number from scratch.
                      right={targetUri ? (
                        <TextInput.Icon
                          icon="close"
                          onPress={() => {
                            setTargetUri('');
                            // Tapping × counts as user interaction,
                            // so we leave pristine mode. Without
                            // this, re-typing after a clear would
                            // still render as muted suggestion text.
                            setPristineRoom(false);
                          }}
                          accessibilityLabel="Clear room name"
                        />
                      ) : null}
                    />
                    {pstnEnabled && targetUri.length > 0 && !pstnRoomValid ? (
                      <Text style={[styles.body, { color: 'orange', marginTop: 2 }]}>
                        Room must be {PSTN_ROOM_MIN_DIGITS}–{PSTN_ROOM_MAX_DIGITS} digits
                      </Text>
                    ) : null}
                    {/* Sylk Domain input was an experiment — hidden for now.
                        The conference URI is composed from defaultConferenceDomain
                        and the `domain` state is still tracked internally so any
                        downstream code that reads it keeps working. */}
                    </View>

                  ) : (
                    <Text style={styles.subtitle}>{targetUri}</Text>
                  )}

                  {/* PSTN dial-in option. When ticked, the room field
                      above swaps to a numeric keypad and the room
                      number itself doubles as the dial-in code phone
                      callers will enter to join. Toggling off
                      restores the previous (word-shaped) room name.

                      Uses the shared PlatformToggle — same sliding
                      pill used by the account / preferences panels,
                      so the look is consistent with the rest of the
                      app and a future restyle of the toggle pill
                      lands here for free.

                      Hidden when the modal is being opened for an
                      EXISTING conference contact (selectedContact
                      is already a conference): the dial-in routing
                      is a property of how the room was originally
                      provisioned on the server; we can't flip it
                      after the fact from this modal, and showing
                      the toggle in a disabled / no-op state would
                      mislead the user into thinking they're
                      changing the room. Same rule the navbar uses
                      to mark a contact as a conference — either the
                      explicit `conference` flag or the 'conference'
                      tag. */}
                  {(() => {
                    const _selTags = (selectedContact && Array.isArray(selectedContact.tags))
                        ? selectedContact.tags : [];
                    const _isExistingConference = !!(selectedContact
                        && (selectedContact.conference
                            || _selTags.indexOf('conference') > -1));
                    if (_isExistingConference) return null;
                    return (
                      <PlatformToggle
                        value={pstnEnabled}
                        onValueChange={setPstnEnabled}
                        label="Allow calling from telephones"
                        // Center the toggle row horizontally inside the
                        // modal so the label + pill cluster sits in the
                        // middle of the surface, matching the other
                        // centered chrome (room name field, participant
                        // chips). marginTop preserved.
                        style={{ marginTop: 8, alignSelf: 'center' }}
                      />
                    );
                  })()}

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
                    You can invite people once the conference starts
                  </Text>

                {/* Buttons. Disabled when there's no room name, or
                    when the dial-in box is ticked but the room number
                    isn't a valid numeric dial-in code (4–16 digits). */}
                <View style={styles.buttonRow}>
                  <Button
                    mode="contained"
                    disabled={!targetUri || !pstnRoomValid}
                    style={styles.button}
                    icon="speaker"
                    onPress={() => joinConference(false)}
                  >
                    Audio
                  </Button>
                  <Button
                    mode="contained"
                    disabled={!targetUri || !pstnRoomValid}
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


