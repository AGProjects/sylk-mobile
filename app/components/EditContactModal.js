import React, { useState, useEffect } from 'react';
import { Modal, View, TouchableOpacity, TouchableWithoutFeedback, KeyboardAvoidingView, ScrollView, Platform, Linking, Dimensions, Pressable, StyleSheet } from 'react-native';
import { Text, Button, Surface, TextInput, Switch, Checkbox, Divider } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PropTypes from 'prop-types';
import utils from '../utils';
import UserIcon from './UserIcon';
import PlatformToggle from './PlatformToggle';
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
  defaultDomain,
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
  // chatSounds / toggleChatSounds — moved to PreferencesModal.
  readReceipts,
  toggleReadReceipts,
  storageUsage,
  deleteAccountUrl,
  openDeleteAccount,
  preferredVideoCodec,
  setPreferredVideoCodec,
  // Device-level audio codec + auto-record defaults — used to label
  // the "Default (...)" button in each per-contact override row so
  // the user can see at a glance what they're overriding away from.
  preferredAudioCodec,
  enableAudioRecording,
  encryptionMode,
}) => {
  // Strip the account's default @domain off an E.164 phone-number URI
  // for editing — users dialing or pasting a number expect to see
  // "+40721253846", not "+40721253846@sylk.link". Only the @-suffix
  // matching defaultDomain is hidden; non-default domains stay so
  // the user can still edit them. saveContactByUser's sanitizeContact
  // re-appends the domain on save when the URI comes in bare.
  const _displayUriFromProp = (raw) => {
    if (!raw) return '';
    if (!defaultDomain) return raw;
    if (!raw.startsWith('+')) return raw;
    const suffix = '@' + defaultDomain;
    if (raw.toLowerCase().endsWith(suffix.toLowerCase())) {
      return raw.substring(0, raw.length - suffix.length);
    }
    return raw;
  };
  const [uri, setUri] = useState(_displayUriFromProp(propUri));
  const [displayName, setDisplayName] = useState(propDisplayName || '');
  const [organization, setOrganization] = useState(propOrg || '');
  const [email, setEmail] = useState(propEmail || '');
  const [confirm, setConfirm] = useState(false);
  const [tags, setTags] = useState([]);
  const [tagsText, setTagsText] = useState('');
  // Buffer for the "Add tag" text input. Kept separate from `tags`
  // so partial typing doesn't churn the saved-tag list on every
  // keystroke; only confirmation (Enter / + button tap) commits.
  const [newTagText, setNewTagText] = useState('');
  // Edit mode for the chip-list. Default is read-only — tapping the
  // small pencil icon next to "Tags" flips this on, exposing the ×
  // remove buttons on each chip and the Add-tag input row. Kept
  // OFF by default so the modal stays calm and users don't fat-
  // finger a tag away while just inspecting the contact.
  const [editingTags, setEditingTags] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  // Per-contact encryption mode override.
  // null  → follow the device default (set in Preferences → Encryption)
  // 'sdes' / 'zrtp_optional' / 'zrtp_mandatory' → override for this
  // contact regardless of the device default
  const [contactEncryption, setContactEncryption] = useState(
    (selectedContact && selectedContact.localProperties
      && selectedContact.localProperties.encryptionMode) || null
  );
  // Per-contact codec / recording overrides. All three follow the same
  // null = "use device default" convention used by contactEncryption
  // above:
  //   contactVideoCodec    null | 'VP9' | 'VP8' | 'H264'
  //   contactAudioCodec    null | 'opus' | 'G722' | 'PCMU' | 'PCMA'
  //   contactAutoRecord    null | true (always record) | false (never record)
  // Stored on the contact's localProperties when non-null and merged
  // back to null on save when the user picks the Default button.
  const [contactVideoCodec, setContactVideoCodec] = useState(
    (selectedContact && selectedContact.localProperties
      && selectedContact.localProperties.preferredVideoCodec) || null
  );
  const [contactAudioCodec, setContactAudioCodec] = useState(
    (selectedContact && selectedContact.localProperties
      && selectedContact.localProperties.preferredAudioCodec) || null
  );
  const [contactAutoRecord, setContactAutoRecord] = useState(
    (selectedContact && selectedContact.localProperties
      && (selectedContact.localProperties.enableAudioRecording === true
          || selectedContact.localProperties.enableAudioRecording === false))
      ? selectedContact.localProperties.enableAudioRecording
      : null
  );

  // Reset all form fields whenever modal opens or props change
  useEffect(() => {
    if (show) {
      setUri(_displayUriFromProp(propUri));
      setDisplayName(propDisplayName || '');
      setOrganization(propOrg || '');
      setEmail(propEmail || '');
      setConfirm(false);
      let initialTags = selectedContact?.tags || [];
      initialTags = [...new Set(initialTags.map(t => t.trim().toLowerCase()))];
      setTags(initialTags);
      setTagsText(initialTags.join(', '));
      setNewTagText('');
      setEditingTags(false);
      setContactEncryption(
        (selectedContact && selectedContact.localProperties
          && selectedContact.localProperties.encryptionMode) || null
      );
      setContactVideoCodec(
        (selectedContact && selectedContact.localProperties
          && selectedContact.localProperties.preferredVideoCodec) || null
      );
      setContactAudioCodec(
        (selectedContact && selectedContact.localProperties
          && selectedContact.localProperties.preferredAudioCodec) || null
      );
      setContactAutoRecord(
        (selectedContact && selectedContact.localProperties
          && (selectedContact.localProperties.enableAudioRecording === true
              || selectedContact.localProperties.enableAudioRecording === false))
          ? selectedContact.localProperties.enableAudioRecording
          : null
      );
    }
  }, [show, propUri, propDisplayName, propOrg, propEmail, selectedContact]);

	useEffect(() => {
	  setTagsText(tags.join(', '));
	}, [tags]);

	const [keyboardHeight, setKeyboardHeight] = useState(0);

	useEffect(() => {
	  // Track keyboard height in addition to visibility so the
	  // surfaceMaxHeight cap below can shrink the modal to fit
	  // the remaining vertical room. Without this, KeyboardAvoiding-
	  // View's `padding` behaviour shifts the Surface up by the
	  // keyboard height, but the Surface itself is still 85% of
	  // viewport — so the top edge slides off-screen above the
	  // status bar.
	  const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
		const h = (e && e.endCoordinates && e.endCoordinates.height) || 0;
		setKeyboardHeight(h);
		setKeyboardVisible(true);
	  });

	  const hideSub = Keyboard.addListener('keyboardDidHide', () => {
		setKeyboardHeight(0);
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

	// Drop a single tag from the list. Wired to the × on each chip.
	// Doesn't touch the named-toggle UI (Mute / Bypass DND / Read
	// receipts) — those read the same `tags` state, so removing
	// 'muted' here also flips the matching Switch back off.
	const removeTag = (tag) => {
	  setTags(prev => prev.filter(t => t !== tag));
	};

	// Reduce arbitrary user input to a strict-ASCII tag token. Tags
	// must be simple ASCII words (lowercase letters, digits, and the
	// punctuation characters '-', '_', '*') with no spaces — they're
	// stored comma-separated in SQL and compared with substring /
	// whole-word matchers across the app, so anything else (commas,
	// accented letters, emoji, other punctuation, internal
	// whitespace) would either corrupt the SQL row or silently fail
	// to match. This sanitizer:
	//   • lowercases + trims
	//   • collapses any whitespace run into a single dash
	//   • drops every character that isn't [a-z 0-9 - _ *]
	//   • collapses repeat dashes and trims leading/trailing dashes
	//     so the final tag never starts or ends with '-'
	const sanitizeTag = (raw) => {
	  if (!raw) {
		return '';
	  }
	  return raw
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9_*-]/g, '')
		.replace(/-{2,}/g, '-')
		.replace(/^-+|-+$/g, '');
	};

	// Commit whatever's in the "Add tag" buffer to the chip list,
	// passing it through sanitizeTag first. Duplicates are
	// suppressed; the input clears on success.
	const addNewTagFromInput = () => {
	  const cleaned = sanitizeTag(newTagText);
	  if (!cleaned) {
		return;
	  }
	  setTags(prev => (prev.includes(cleaned) ? prev : [...prev, cleaned]));
	  setNewTagText('');
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
      // Per-contact override slots. null → clear that override (revert
      // to device default). saveContactByUser merges localProperties
      // and treats null/undefined as "delete this key", so passing
      // null is the canonical reset.
      localProperties: {
        encryptionMode: contactEncryption || null,
        preferredVideoCodec: contactVideoCodec || null,
        preferredAudioCodec: contactAudioCodec || null,
        // Auto-record is tri-state (null / true / false). Preserve the
        // explicit boolean so the contact can opt OUT of recording
        // even when the device default is ON.
        enableAudioRecording:
          contactAutoRecord === true || contactAutoRecord === false
            ? contactAutoRecord
            : null,
      },
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
  // Match PreferencesModal's scrollable-pane treatment, but tightened
  // for this modal: EditContactModal has more chrome ABOVE the
  // ScrollView than Preferences does (avatar, title, subtitle URI),
  // and a button row + storage line BELOW it. Capping the ScrollView
  // at 55% rather than Preferences' 70% leaves room for the chrome
  // so the Surface's bottom rounded corners stay on-screen with the
  // Save / Cancel row visible. surfaceMaxHeight bounds the whole
  // Surface so the borderRadius clips cleanly even on the narrow
  // landscape orientations where 55% + chrome would still overflow.
  const viewportH = Dimensions.get('window').height;
  const scrollMaxHeight = Math.round(viewportH * 0.55);
  // Default cap is 85% of viewport — leaves a slim margin at the
  // top and bottom of the screen so the modal reads as a panel.
  // When the keyboard is up, the !keyboardVisible JSX blocks
  // collapse most of the modal's content (per-tag toggles,
  // encryption / recording / location toggles, etc.), so the
  // Surface naturally shrinks to whatever's left — title + the
  // text fields the user is editing + the Save/Cancel row. The
  // overlay's justifyContent='flex-end' + paddingBottom anchors
  // that small Surface just above the keyboard. No further cap
  // needed — earlier attempts at recomputing surfaceMaxHeight /
  // scrollMaxHeight against (viewport - keyboardHeight) made the
  // modal float oddly mid-screen with lots of empty space above.
  const surfaceMaxHeight = Math.round(viewportH * 0.85);
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

        <View
          style={[
            containerStyles.overlay,
            // When the keyboard is visible, anchor the modal to the
            // BOTTOM of the visible area instead of the vertical
            // centre. Without this override the centered modal +
            // KeyboardAvoidingView combination pushed the panel's
            // top edge off the top of the screen.
            //
            // paddingBottom is platform-dependent:
            //   • iOS: Modal doesn't auto-resize when the keyboard
            //     opens — the keyboard floats over the modal's
            //     content. We need paddingBottom = keyboardHeight +
            //     small gap so the surface sits above the keyboard.
            //   • Android: AndroidManifest's windowSoftInputMode=
            //     adjustResize already shrinks the modal's view to
            //     the area above the keyboard, so the same
            //     paddingBottom would double-count and push the
            //     surface up by 2× the keyboard height (the "now
            //     it went even higher" bug). A flat 20dp gap is
            //     enough on Android — the OS already handled the
            //     keyboard size.
            keyboardVisible && keyboardHeight > 0 ? {
              justifyContent: 'flex-end',
              paddingBottom: Platform.OS === 'ios'
                ? keyboardHeight + 20
                : 20,
            } : null,
          ]}
        >
          {/* Backdrop: a Pressable that absolute-fills the overlay,
              sitting BEHIND the Surface (rendered earlier in JSX → behind
              in z-order). Tap outside the Surface → backdrop receives
              the touch → onPress fires → modal dismissed. Tap on the
              Surface → Surface (rendered later, on top) gets the touch
              first; the Pressable underneath sees nothing. No parent
              TouchableWithoutFeedback wrapping the Surface, so no
              responder negotiation for the inner ScrollView to lose.
              This is the same shape PreferencesModal uses — fixes the
              "ScrollView pan gets dropped on Android" issue and lets
              the Surface render its borderRadius cleanly without a
              TouchableWithoutFeedback parent reshaping the layout. */}
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={close}
            accessibilityLabel="Close edit contact"
          />
          {/* KeyboardAvoidingView would default to filling the entire
              overlay (and stretching the Surface to fit) if we let it.
              Pinning it to maxHeight: surfaceMaxHeight + alignSelf
              center keeps it tightly sized around the Surface so the
              Surface's borderRadius is honoured and the rounded
              corners stay visible inside the viewport.
              `overflow: 'hidden'` on the Surface clips any child that
              would otherwise paint past the rounded corners (the
              ScrollView's content most notably). */}
          <KeyboardAvoidingView
            // When the keyboard is visible we already anchor the
            // panel via the overlay's justifyContent='flex-end' +
            // paddingBottom=keyboardHeight+20 (above). Letting KAV
            // ALSO add its `padding`/`height` behaviour on top of
            // that double-shifted the Surface and pushed its top
            // edge off the screen. behavior={null} makes KAV a
            // no-op layer in that state — the overlay positioning
            // does all the work. When the keyboard is hidden, KAV
            // reverts to its normal behaviour so any future
            // focus-while-already-open transitions still avoid
            // the keyboard naturally.
            behavior={keyboardVisible
                ? null
                : (Platform.OS === 'ios' ? 'padding' : 'height')}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
            style={{ maxHeight: surfaceMaxHeight, alignSelf: 'center', width: '100%' }}
          >
   		    <Surface style={[containerStyles.modalSurface, { maxHeight: surfaceMaxHeight, overflow: 'hidden' }]}>
				{selectedContact ? (
				  <View
					style={{
					  position: 'absolute',
					  top: 6,
					  left: 6,
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
                    {/* SIP URI subtitle removed. The same URI lives in
                        the Address / Telephone number TextInput below
                        (which the user can read and edit), so a
                        separate read-only subtitle line was redundant
                        chrome — and confusing once we started stripping
                        the @defaultDomain off phone-number rows for
                        display (the subtitle showed the full
                        "+40…@sylk.link" while the editable field
                        showed just "+40…"). Removing it leaves the
                        editable field as the single source of truth. */}

                    {/* Single outer ScrollView for the entire body —
                        same shape PreferencesModal uses. All the form
                        fields, tag toggles, tag chip list, and the
                        per-contact override sections live inside,
                        capped at scrollMaxHeight so the Save / Cancel
                        row stays pinned outside the ScrollView at the
                        bottom of the modal Surface. The various Android
                        scroll-handling props (nestedScrollEnabled,
                        directionalLockEnabled, removeClippedSubviews=
                        false) mirror PreferencesModal's tuned set so
                        gesture handoff with any nested touchables
                        stays consistent across both modals. */}
                    <ScrollView
                      style={{ maxHeight: scrollMaxHeight }}
                      contentContainerStyle={{ paddingBottom: 8 }}
                      keyboardShouldPersistTaps="handled"
                      nestedScrollEnabled={true}
                      showsVerticalScrollIndicator={true}
                      overScrollMode={Platform.OS === 'android' ? 'always' : undefined}
                      removeClippedSubviews={false}
                      directionalLockEnabled={true}
                      scrollEventThrottle={16}
                      decelerationRate="normal"
                      // Subtree-wide autofill kill switch.
                      //
                      // The per-field `autoComplete="off" +
                      // importantForAutofill="no" + textContentType="none"`
                      // trio we put on each TextInput SHOULD be enough,
                      // but Paper's <TextInput> wraps the native
                      // EditText behind an Animated layer and on some
                      // Android builds the importantForAutofill prop
                      // doesn't propagate all the way to the inner
                      // EditText — the Autofill Framework then sees a
                      // default-marked field and surfaces the saved-
                      // password sheet anyway.
                      //
                      // `noExcludeDescendants` on this ScrollView is
                      // the parent-level authoritative override:
                      // Android's Autofill Framework checks the view
                      // tree from the focused field UP to the root and
                      // honours the FIRST explicit "no" it finds. By
                      // pinning the opt-out on the ScrollView (which
                      // contains every TextInput in the edit form),
                      // we guarantee the framework hits a "no" before
                      // it can decide any descendant looks fillable —
                      // no matter what Paper does with the inner
                      // EditText props.
                      //
                      // iOS ignores this attribute; the per-field
                      // `textContentType="none"` keeps the QuickType
                      // strip clean there.
                      importantForAutofill="noExcludeDescendants"
                    >
                      {/* Address (URI) — editable for any contact except
                          the user's own account row. Contacts are keyed
                          by their internal `id` (UUID) in SQL — the URI
                          is just another column on the row — so changing
                          it here is safe: saveContactByUser preserves
                          selectedContact.id and saveSylkContact's
                          INSERT→UNIQUE→UPDATE path rewrites the uri
                          column in place. Locked for `myself` so the
                          user can't accidentally rename their own
                          account URI (which is the account identifier
                          used for SIP registration, not a free-form
                          label). The "@domain optional" hint mirrors
                          AddContactModal so users know they can paste
                          either a bare phone number / username or a
                          fully-qualified SIP URI. */}
                      {!myself && (
                        <TextInput
                          mode="flat"
                          // Switch the field label based on the URI's
                          // shape so the user sees the most accurate
                          // verb for what they're entering. The check
                          // is purely cosmetic — saveContactByUser /
                          // sanitizeContact still classify and route
                          // the URI by their own rules — but it tells
                          // a user typing "+40…" that this is a
                          // phone-number row, and a user typing
                          // "alice@…" that it's a SIP address.
                          // Drives off both: (a) the current text in
                          // the input (covers a freshly-typed +CC
                          // before the contact tag is updated), and
                          // (b) the selectedContact.tags 'tel' flag
                          // (covers an existing telephone contact
                          // even if the user transiently clears the
                          // field).
                          label={
                            (uri.trim().startsWith('+')
                              || (selectedContact
                                  && Array.isArray(selectedContact.tags)
                                  && selectedContact.tags.indexOf('tel') > -1))
                              ? 'Telephone number'
                              : 'SIP Address'
                          }
                          onChangeText={(value) =>
                            setUri(value.replace(/\s|\(|\)/g, '').toLowerCase())
                          }
                          value={uri}
                          autoCapitalize="none"
                          autoCorrect={false}
                          // Same autofill opt-out trio as the Email
                          // field below — Android's autofill service
                          // was tagging this field as a username/
                          // password row (autoCapitalize none +
                          // email-style keyboard next to a Display
                          // name input → "looks like a login form")
                          // and surfacing "Use saved password?". See
                          // the Email field's comment for the role of
                          // each prop.
                          autoComplete="off"
                          importantForAutofill="no"
                          textContentType="none"
                          // Phone-number rows get the numeric keypad
                          // (with + accessible on most layouts); SIP
                          // rows keep the email-style keyboard.
                          keyboardType={
                            (uri.trim().startsWith('+')
                              || (selectedContact
                                  && Array.isArray(selectedContact.tags)
                                  && selectedContact.tags.indexOf('tel') > -1))
                              ? 'phone-pad'
                              : 'email-address'
                          }
                        />
                      )}
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
                        // Android's autofill service was reading this
                        // field as a login form ("email-address"
                        // keyboard + autoCapitalize none next to a
                        // text input it could plausibly tag as a
                        // username/password row) and surfacing a
                        // "Use saved password?" sheet when the user
                        // focused it. Three coordinated hints kill
                        // that without disabling our own onChangeText
                        // handling:
                        //   • autoComplete="off"        — RN's
                        //     cross-platform autofill opt-out; on
                        //     Android maps to the AUTOFILL_TYPE_NONE
                        //     hint, on iOS maps to a no-op (iOS
                        //     follows textContentType below).
                        //   • importantForAutofill="no" — Android-
                        //     specific belt-and-braces. Some Pixel /
                        //     OEM builds still poke at fields that
                        //     just say autoComplete=off; the
                        //     importantForAutofill flag is the
                        //     authoritative kill switch for the
                        //     Autofill Framework.
                        //   • textContentType="none"   — iOS-specific
                        //     opt-out of the QuickType strip that
                        //     surfaces saved passwords / Keychain
                        //     entries on email-style keyboards.
                        autoComplete="off"
                        importantForAutofill="no"
                        textContentType="none"
                        onChangeText={setEmail}
                        value={email}
                      />

                    {/* Visual breathing room between the last text-
                        input row (Email) and the toggle / chip block
                        below. Without this the first checkbox row
                        sits flush against the Paper TextInput's
                        bottom border, which reads as cramped. */}
                    <View style={{ height: 16 }} />

                    {/* ── Non-text-input region ─────────────────────
                        Everything below — toggle switches, tag chips
                        + add-tag editor, the myself-only Allow/Reject/
                        Chat-sounds/Read-receipts row, the per-contact
                        Video / Audio / zRTP pickers, the storage line
                        and delete-account link — is collapsed into
                        ONE wrapper that hides whenever the soft
                        keyboard is up. Editing Display name / Address
                        / Organization / Email above triggers the IME,
                        and on Android the usable height left between
                        the focused TextInput and the Save row is only
                        a few hundred pixels — keeping these controls
                        on-screen pushed Save off the bottom and made
                        the chip list / codec pills scroll-fight the
                        TextInput for focus. The original code gated
                        only a few of these sections individually,
                        which left the codec pills and the tag chips
                        visible mid-edit. Single wrapper keeps the
                        collapse atomic. */}
                    {!keyboardVisible && (
                      <>
                    {!myself && (
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
							  <PlatformToggle
							    key={tagKey}
							    value={displayValue}
							    onValueChange={() => toggleTag(tagKey)}
							    label={isDisabled ? 'Read receipts disabled for account' : info.description}
							    disabled={isDisabled}
							    // PlatformToggle now provides its own
							    // vertical breathing room — the old
							    // per-platform marginBottom existed to
							    // patch the iOS-pill / Android-Checkbox
							    // split that no longer exists.
							    style={{opacity: rowOpacity}}
							  />
							);
						  })}

						</View>
                    )}
                      </>
                    )}
                    {/* end first half of !keyboardVisible. The tag
                        chip section below uses a SOFTER gate:
                          • hide when the keyboard is visible AND
                            the user is NOT in tag-edit mode — i.e.
                            they're typing in one of the main text
                            fields (name, email, phone…) and want
                            the screen freed for that input.
                          • keep visible when the keyboard is up AND
                            editingTags is true — i.e. the keyboard
                            popped open because the user focused the
                            Add-tag input itself, so this section is
                            exactly what they're interacting with.
                          • always visible when the keyboard isn't
                            up (idle / read-only mode).
                        Equivalent to: !keyboardVisible || editingTags. */}
                    {!myself && (!keyboardVisible || editingTags) && (
                      <View style={{ marginTop: 8 }}>
                        {/* Single wrap row: "Tags:" label, chip pills,
                            then the pencil/check toggle at the very
                            end. Everything participates in flexWrap
                            so on narrow rows the chips spill to
                            additional lines and the pencil sits
                            after the last chip wherever that ends
                            up. The label and pencil get a small
                            marginBottom matching the chips so the
                            wrapped rows align. */}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: '600',
                              marginRight: 6,
                              marginBottom: 6,
                            }}
                          >
                            Tags:
                          </Text>
                          {/* Hide tags that are driven by the
                              per-tag Switch/Checkbox above
                              (editableTags keys: bypassdnd, muted,
                              noread). Those have their own
                              dedicated toggle and would just
                              duplicate the same state if also shown
                              as removable chips down here. The
                              user pointed this out for bypassdnd
                              specifically; same logic applies to
                              every key in editableTags. */}
                          {(() => {
                            const _hidden = new Set(Object.keys(editableTags || {}));
                            const _visibleTags = tags.filter(t => !_hidden.has(t));
                            return _visibleTags.length === 0 ? (
                            <Text
                              style={{
                                fontSize: 12,
                                color: '#888',
                                marginRight: 6,
                                marginBottom: 6,
                              }}
                            >
                              No tags
                            </Text>
                          ) : (
                            _visibleTags.map(t => (
                              <View
                                key={t}
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  backgroundColor: '#e0e0e0',
                                  borderRadius: 12,
                                  paddingLeft: 10,
                                  paddingRight: editingTags ? 4 : 10,
                                  paddingVertical: 3,
                                  marginRight: 6,
                                  marginBottom: 6,
                                }}
                              >
                                <Text style={{ fontSize: 12, color: '#333' }}>{t}</Text>
                                {editingTags ? (
                                  <TouchableOpacity
                                    onPress={() => removeTag(t)}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Remove tag ${t}`}
                                    style={{ marginLeft: 4, padding: 2 }}
                                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                  >
                                    <Icon name="close-circle" size={16} color="#666" />
                                  </TouchableOpacity>
                                ) : null}
                              </View>
                            ))
                          );
                          })()}
                          <TouchableOpacity
                            onPress={() => setEditingTags(prev => !prev)}
                            accessibilityRole="button"
                            accessibilityLabel={editingTags ? 'Done editing tags' : 'Edit tags'}
                            style={{ padding: 4, marginBottom: 6 }}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          >
                            <Icon
                              name={editingTags ? 'check' : 'pencil'}
                              size={16}
                              color={editingTags ? '#27ae60' : '#555'}
                            />
                          </TouchableOpacity>
                        </View>
                        {editingTags ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <TextInput
                              mode="flat"
                              label="Add tag"
                              value={newTagText}
                              onChangeText={setNewTagText}
                              onSubmitEditing={addNewTagFromInput}
                              returnKeyType="done"
                              autoCapitalize="none"
                              autoCorrect={false}
                              dense
                              style={{ flex: 1, marginRight: 8 }}
                            />
                            <Button
                              mode="contained"
                              compact
                              onPress={addNewTagFromInput}
                              // Disabled when sanitization would yield
                              // an empty string — e.g. the user typed
                              // only spaces, emoji, or punctuation.
                              // Gives an immediate visual cue that
                              // the proposed tag isn't a valid ASCII
                              // word.
                              disabled={!sanitizeTag(newTagText)}
                              icon="plus"
                            >
                              Add
                            </Button>
                          </View>
                        ) : null}
                      </View>
                    )}

                    {/* Re-open the !keyboardVisible wrapper for the
                        remaining toggles (encryption, audio
                        recording, location privacy, account-mode
                        settings, etc.). Everything from here through
                        the existing "end !keyboardVisible group"
                        comment collapses while the keyboard is up. */}
                    {!keyboardVisible && (
                      <>
                    {myself && (
                      <PlatformToggle
                        value={rejectNonContacts}
                        onValueChange={toggleRejectNonContacts}
                        label="Allow calls only from my contacts"
                        style={[styles.checkBoxRow, {marginBottom: Platform.OS === 'ios' ? 5 : 0}]}
                      />
                    )}

                    {myself && !rejectNonContacts && (
                      <PlatformToggle
                        value={rejectAnonymous}
                        onValueChange={toggleRejectAnonymous}
                        label="Reject anonymous callers"
                        style={[styles.checkBoxRow, {marginBottom: Platform.OS === 'ios' ? 5 : 0}]}
                      />
                    )}

                    {/* Chat sounds toggle moved to PreferencesModal
                        (Chat section). It's a per-device speaker
                        preference, not a call-acceptance / privacy
                        rule, so it belongs alongside the other
                        Preferences settings rather than under My
                        Account. */}

                    {myself && (
                      <PlatformToggle
                        value={readReceipts}
                        onValueChange={toggleReadReceipts}
                        label="Read receipts"
                        style={styles.checkBoxRow}
                      />
                    )}

                    {/* Per-contact call overrides. Three sections that
                        mirror PreferencesModal's layout:
                          • Video Calls    — preferred video codec
                          • Audio Calls    — preferred audio codec
                                             + auto-record toggle
                          • zRTP Encryption — Optional / Mandatory
                        Each row leads with a grayed-out
                        "Default (<device value>)" button that clears
                        the override, then lists the alternatives the
                        user can pick to override the device-wide
                        Preferences value for THIS contact only. Stored
                        overrides that match the device default are
                        treated as "no override" — saveContactByUser
                        prunes those keys from localProperties. */}
                    {!myself && selectedContact && (() => {
                      // ── Reused codec constants. Keep in sync with
                      // PreferencesModal so the per-contact picker
                      // offers exactly the same set of choices the
                      // device-wide picker does.
                      const VIDEO_CODECS = ['VP9', 'VP8', 'H264'];
                      const AUDIO_CODECS = ['opus', 'G722', 'PCMU', 'PCMA'];
                      const ENC_OPTIONS = [
                          { value: 'zrtp_optional',  label: 'Optional' },
                          { value: 'zrtp_mandatory', label: 'Mandatory' },
                      ];

                      const deviceVideo = preferredVideoCodec || 'VP9';
                      const deviceAudio = preferredAudioCodec || 'opus';
                      const deviceEnc = encryptionMode || 'zrtp_optional';
                      const deviceEncLabel = (
                          ENC_OPTIONS.find(o => o.value === deviceEnc) || {}
                      ).label || deviceEnc;

                      const videoUsingDefault = contactVideoCodec == null
                          || contactVideoCodec === deviceVideo;
                      const audioUsingDefault = contactAudioCodec == null
                          || contactAudioCodec === deviceAudio;
                      const encUsingDefault = contactEncryption == null
                          || contactEncryption === deviceEnc;
                      const recordUsingDefault = contactAutoRecord !== true
                          && contactAutoRecord !== false;
                      const deviceRecordLabel = enableAudioRecording ? 'On' : 'Off';

                      // Shared button styles — the "Default (...)"
                      // button is rendered like the alternatives but
                      // grayed-out and disabled when it's the active
                      // choice, so the user can see which one is in
                      // effect without it competing visually.
                      //
                      // pillContent / pillLabel collapse the default
                      // react-native-paper Button vertical padding so
                      // the pills sit tighter together — Paper's
                      // default ~36px height was too tall for a row
                      // of compact pills inside a section. The label
                      // also drops to fontSize 12 with no extra
                      // vertical margin so the text doesn't hike the
                      // pill back up.
                      const pillContentStyle = { height: 28 };
                      const pillLabelStyle = {
                          fontSize: 12,
                          marginVertical: 0,
                          marginHorizontal: 8,
                          lineHeight: 14,
                      };
                      const defaultBtnStyle = (active) => ({
                          marginRight: 6,
                          marginBottom: 6,
                          opacity: active ? 0.7 : 1,
                      });
                      const altBtnStyle = {
                          marginRight: 6,
                          marginBottom: 6,
                      };
                      const defaultLabelStyle = { ...pillLabelStyle, color: '#888' };

                      return (
                        <>
                          {/* ── Video Calls ───────────────────── */}
                          <View style={{ marginTop: 12, marginBottom: 12 }}>
                            <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 4, color: '#333' }}>
                              Video Calls
                            </Text>
                            <Text style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                              Preferred video codec for calls to this contact.
                            </Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                              <Button
                                key="vc-default"
                                mode={videoUsingDefault ? 'contained' : 'outlined'}
                                compact
                                disabled={videoUsingDefault}
                                style={defaultBtnStyle(videoUsingDefault)}
                                contentStyle={pillContentStyle}
                                labelStyle={defaultLabelStyle}
                                onPress={() => setContactVideoCodec(null)}
                              >
                                {`Default (${deviceVideo})`}
                              </Button>
                              {VIDEO_CODECS.filter(c => c !== deviceVideo).map(codec => {
                                const selected = contactVideoCodec === codec;
                                return (
                                  <Button
                                    key={codec}
                                    mode={selected ? 'contained' : 'outlined'}
                                    compact
                                    style={altBtnStyle}
                                    contentStyle={pillContentStyle}
                                    labelStyle={pillLabelStyle}
                                    onPress={() => setContactVideoCodec(codec)}
                                  >
                                    {codec}
                                  </Button>
                                );
                              })}
                            </View>
                          </View>

                          <Divider style={{ marginTop: -4, marginBottom: 8 }} />

                          {/* ── Audio Calls ───────────────────── */}
                          <View style={{ marginBottom: 12 }}>
                            <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 4, color: '#333' }}>
                              Audio Calls
                            </Text>
                            <Text style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                              Preferred audio codec for calls to this contact.
                            </Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                              <Button
                                key="ac-default"
                                mode={audioUsingDefault ? 'contained' : 'outlined'}
                                compact
                                disabled={audioUsingDefault}
                                style={defaultBtnStyle(audioUsingDefault)}
                                contentStyle={pillContentStyle}
                                labelStyle={defaultLabelStyle}
                                onPress={() => setContactAudioCodec(null)}
                              >
                                {`Default (${deviceAudio})`}
                              </Button>
                              {AUDIO_CODECS.filter(c => c !== deviceAudio).map(codec => {
                                const selected = contactAudioCodec === codec;
                                return (
                                  <Button
                                    key={codec}
                                    mode={selected ? 'contained' : 'outlined'}
                                    compact
                                    style={altBtnStyle}
                                    contentStyle={pillContentStyle}
                                    labelStyle={pillLabelStyle}
                                    onPress={() => setContactAudioCodec(codec)}
                                  >
                                    {codec}
                                  </Button>
                                );
                              })}
                            </View>
                            {/* Auto-record override — exactly two pills,
                                strictly the opposite of the General
                                setting:
                                  General ON  → contact can opt OUT
                                                (Default(On) | Recording Off)
                                  General OFF → contact can opt IN
                                                (Default(Off) | Recording On)
                                Picking the same value as the device
                                default would just be "no override",
                                which is what tapping Default does — no
                                point exposing both On and Off pills on
                                each side. The stored state stays
                                tri-state (null / true / false) so the
                                saved value is unambiguous regardless
                                of which side the user is on when they
                                save. */}
                            <Text style={{ fontSize: 11, color: '#888', marginTop: 12, marginBottom: 8 }}>
                              {enableAudioRecording
                                ? 'Skip recording for calls to this contact.'
                                : 'Automatically record audio calls to this contact.'}
                            </Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                              <Button
                                key="rec-default"
                                mode={recordUsingDefault ? 'contained' : 'outlined'}
                                compact
                                disabled={recordUsingDefault}
                                style={defaultBtnStyle(recordUsingDefault)}
                                contentStyle={pillContentStyle}
                                labelStyle={defaultLabelStyle}
                                onPress={() => setContactAutoRecord(null)}
                              >
                                {`Default (${deviceRecordLabel})`}
                              </Button>
                              {enableAudioRecording ? (
                                /* General ON → opt-out pill only. */
                                <Button
                                  key="rec-off"
                                  mode={contactAutoRecord === false ? 'contained' : 'outlined'}
                                  compact
                                  style={altBtnStyle}
                                  contentStyle={pillContentStyle}
                                  labelStyle={pillLabelStyle}
                                  onPress={() => setContactAutoRecord(false)}
                                >
                                  Recording Off
                                </Button>
                              ) : (
                                /* General OFF → opt-in pill only. */
                                <Button
                                  key="rec-on"
                                  mode={contactAutoRecord === true ? 'contained' : 'outlined'}
                                  compact
                                  style={altBtnStyle}
                                  contentStyle={pillContentStyle}
                                  labelStyle={pillLabelStyle}
                                  onPress={() => setContactAutoRecord(true)}
                                >
                                  Recording On
                                </Button>
                              )}
                            </View>
                          </View>

                          <Divider style={{ marginTop: -4, marginBottom: 8 }} />

                          {/* ── zRTP Encryption ───────────────── */}
                          <View style={{ marginBottom: 12 }}>
                            <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 4, color: '#333' }}>
                              zRTP Encryption
                            </Text>
                            <Text style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                              Used for both audio and video calls to this contact.
                            </Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                              <Button
                                key="enc-default"
                                mode={encUsingDefault ? 'contained' : 'outlined'}
                                compact
                                disabled={encUsingDefault}
                                style={defaultBtnStyle(encUsingDefault)}
                                contentStyle={pillContentStyle}
                                labelStyle={defaultLabelStyle}
                                onPress={() => setContactEncryption(null)}
                              >
                                {`Default (${deviceEncLabel})`}
                              </Button>
                              {ENC_OPTIONS.filter(o => o.value !== deviceEnc).map(opt => {
                                const selected = contactEncryption === opt.value;
                                return (
                                  <Button
                                    key={opt.value}
                                    mode={selected ? 'contained' : 'outlined'}
                                    compact
                                    style={altBtnStyle}
                                    contentStyle={pillContentStyle}
                                    labelStyle={pillLabelStyle}
                                    onPress={() => setContactEncryption(opt.value)}
                                  >
                                    {opt.label}
                                  </Button>
                                );
                              })}
                            </View>
                          </View>
                        </>
                      );
                    })()}
                      </>
                    )}
                    {/* end !keyboardVisible group */}

                    </ScrollView>

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
                        /* Block save if the URI was cleared. URI is the
                           SIP/phone address — the row is meaningless
                           without it, and saveContactByUser ->
                           sanitizeContact would reject an empty uri
                           with a noisy toast. Disabling the button
                           gives an earlier, clearer affordance. */
                        disabled={!validEmail() || !uri.trim()}
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
          </KeyboardAvoidingView>
        </View>
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
  readReceipts: PropTypes.bool,
  toggleReadReceipts: PropTypes.func,
  storageUsage: PropTypes.array,
  deleteAccountUrl: PropTypes.string,
  openDeleteAccount: PropTypes.func,
};

export default EditContactModal;
