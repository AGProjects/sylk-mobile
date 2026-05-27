import React, { useState, useEffect, useRef } from 'react';
import { Modal, View, Image, ActivityIndicator, TouchableOpacity, TouchableWithoutFeedback, KeyboardAvoidingView, ScrollView, Platform, Linking, Dimensions, Pressable, StyleSheet } from 'react-native';
import { Text, Button, Surface, TextInput, Switch, Checkbox, Divider } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PropTypes from 'prop-types';
import utils from '../utils';
import { validateCallerId, validateSipPassword, isPlaceholderCallerId } from '../accountInfo';
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
  // Myself-only: the user's own mobile phone number. Captured
  // automatically on the first PSTN dial via READ_PHONE_NUMBERS
  // (see App.ensurePstnCallerIdCaptured) and editable here so the
  // user can correct or override what was read from the SIM. Used
  // as Caller ID on outgoing PSTN calls and quoted to billing on
  // top-up payments. Saved via setMyPhoneNumber on close so an
  // empty edit still persists (allows clearing the field).
  myPhoneNumber,
  setMyPhoneNumber,
  // Optional Android helper: when the user taps the empty Mobile
  // number field, this is called to (a) prompt READ_PHONE_NUMBERS
  // and (b) return the SIM-read value. We pre-fill the input with
  // the result so the user can review and tap Save (or edit /
  // clear). Returns '' on iOS, on permission denial, or when the
  // SIM has no MSISDN — in which case we leave the field empty.
  readDevicePhoneNumber,
  // Myself-only: opens the PaymentInfoModal in the 'credit'
  // template. Bound to the "Add credit" button rendered next to
  // the PSTN credit row, so the user can review the bank-transfer
  // details from inside My Account without first having to trigger
  // a failed PSTN dial. We dismiss this modal before invoking so
  // the two Modals don't try to stack (RN doesn't reliably show a
  // Modal on top of another Modal — silently fails on iOS).
  openPaymentInfoModal,
  // Server-side snapshot (mobile number, PSTN balance, currency,
  // prepaid flag, today's debit/credit). Null until the first
  // successful fetch. We display the balance + currency under the
  // Email field on the "My account" view. The mobile number from
  // the server can differ from myPhoneNumber (which is the SIM /
  // device-side capture); we show both, server value labelled.
  accountInfo,
  accountInfoError,
  refreshAccountInfo,
  // True when the active server published an accountInfoUrl in
  // sylk-config.json. When false the server-info section (PSTN
  // credit / caller-Id / refresh icon) is suppressed entirely —
  // there's nothing to refresh against.
  accountInfoAvailable,
  openSetCallerIdModal,
  // Optional: write the PSTN caller-Id back to the server. If not
  // provided, the field is shown read-only.
  setServerCallerId,
  // Optional: mirror the Email field back to the SIP account record
  // on Save. Round-trips through App.setServerEmail → POST
  // sylk_settings.phtml action=set_email.
  setServerEmail,
  // Optional: change the SIP account password on the server (and
  // mirror locally). Field is pre-filled with currentPassword and
  // read-only until the user taps the in-field "Change" affix; on
  // Save we only push if the value actually differs from the
  // original. Surfaced only on the myself view.
  changeSipPassword,
  currentPassword,
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
  // Pre-filled with the current SIP password and read-only by
  // default; the in-field "Change" affix flips passwordEditable to
  // true so the user can edit it. On Save we only push when the
  // value differs from currentPassword — opening the modal and
  // saving without touching the field is a no-op.
  const [newPassword, setNewPassword] = useState(currentPassword || '');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState(null);
  const [passwordEditable, setPasswordEditable] = useState(false);
  // Caret position the field should adopt on pencil-tap. null =
  // uncontrolled (RN places the caret on tap). Setting to
  // {start: N, end: N} when entering edit mode puts the caret at the
  // end of the pre-filled current password. Cleared to null after
  // the first onSelectionChange so the user can move the caret
  // freely once they're editing.
  const [passwordSelection, setPasswordSelection] = useState(null);
  // Ref to the password TextInput so we can programmatically focus
  // it on pencil-tap. We keep the underlying TextInput permanently
  // editable={true} and gate "read-only" purely visually via an
  // absolute-positioned Pressable overlay that swallows taps until
  // the user taps the pencil. This is necessary because RN ignores
  // focus() on a non-editable TextInput, AND switching editable
  // from false→true in a setState-then-focus dance breaks the user
  // gesture chain (focus() outside the immediate gesture is
  // suppressed by both iOS and Android keyboard heuristics).
  const passwordInputRef = useRef(null);
  // Inline error for the Mobile-number / PSTN caller-Id field.
  // Mirrors the server-side validation rule (digits only, 7–15 long,
  // leading '+' or '00') so the user gets the rejection before the
  // round-trip. Cleared whenever the user edits the field.
  const [mobileError, setMobileError] = useState(null);
  // Inline error for the Email field. Same shape as mobileError —
  // checked on every keystroke (via utils.isEmailAddress) so the
  // user sees the rejection before Save. Empty string is allowed
  // (it clears the server-side field).
  const [emailError, setEmailError] = useState(null);
  // Myself-only mobile-number field. Local edit buffer; committed
  // to per-account settings via setMyPhoneNumber on save.
  const [mobileNumber, setMobileNumber] = useState(myPhoneNumber || '');
  // One-shot guard for the focus-time SIM lookup. Without it, a
  // user who focuses the empty field, deletes the auto-filled
  // number, then refocuses would re-trigger the permission /
  // SIM-read flow and the deletion would silently undo itself.
  // Lives in a ref because it must NOT trigger a re-render — it
  // only gates an event handler.
  const mobileLookupAttempted = useRef(false);
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
      setNewPassword(currentPassword || '');
      setShowPassword(false);
      setPasswordError(null);
      setPasswordEditable(false);
      setPasswordSelection(null);
      setMobileError(null);
      setEmailError(null);
      setMobileNumber(myPhoneNumber || '');
      // Fresh modal session — let the focus-time SIM lookup fire
      // exactly once again (gated on the field being empty).
      mobileLookupAttempted.current = false;
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
  }, [show, propUri, propDisplayName, propOrg, propEmail, selectedContact, myPhoneNumber, currentPassword]);

  // accountInfo is fetched once on app start (App.loadAccount) and
  // again whenever the user taps the refresh icon next to the info
  // box below. We DELIBERATELY do not refresh on modal open — the
  // values are stable enough that an automatic round-trip on every
  // open felt wasteful (especially since the modal is also used for
  // contact edits where the endpoint isn't even hit). The on-screen
  // value is whatever the last fetch produced; the refresh button
  // gives the user explicit control when they want it current.
  const [accountInfoLoading, setAccountInfoLoading] = useState(false);

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

  // "Add credit" button next to PSTN credit. Closes this modal
  // first, then opens the PaymentInfoModal on the next event-loop
  // tick (after the fade-out animation begins) so we never have two
  // Modal components mounted/visible at the same time — RN's iOS
  // bridge silently no-ops the second Modal when both are mounted,
  // and Android can render the second backdrop on top of the first.
  const handleOpenPaymentInfo = () => {
    if (typeof openPaymentInfoModal !== 'function') return;
    close();
    setTimeout(() => {
      try { openPaymentInfoModal(); } catch (e) { /* never propagate */ }
    }, 250);
  };

  const handleOpenSetCallerId = () => {
    if (typeof openSetCallerIdModal !== 'function') return;
    close();
    setTimeout(() => {
      try { openSetCallerIdModal(); } catch (e) { /* never propagate */ }
    }, 250);
  };

  const handleSave = async () => {
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

    // Myself-only: validate-then-persist the mobile number. The
    // inline error shown next to the field is set/cleared on every
    // keystroke; we re-run the check here to defend against a stale
    // value being submitted (e.g. paste, autofill bypassing
    // onChangeText). Empty is allowed; anything else must match
    // /^(\+|00)\d{7,15}$/. On failure we surface the error and
    // bail out of the save instead of close()ing.
    if (myself && typeof setMyPhoneNumber === 'function') {
      const trimmed = (mobileNumber || '').trim();
      const merr = validateCallerId(trimmed);
      if (merr) {
        setMobileError(merr);
        return;
      }
      if (trimmed !== (myPhoneNumber || '')) {
        setMyPhoneNumber(trimmed);

        // Mirror the value to the server-side PSTN caller-Id setting
        // (sylk_account_settings.phtml ?action=set_caller_id) so the
        // SIP proxy uses the same number on outgoing PSTN calls.
        // Fire-and-forget on the UI level: errors are logged but
        // never block the modal close, otherwise a transient network
        // hiccup would trap the user inside the dialog. The local
        // setting is the source of truth for the next session — the
        // next refreshAccountInfo() reconciliation will pull whatever
        // the server actually stored.
        if (typeof setServerCallerId === 'function') {
          setServerCallerId(trimmed).catch((e) => {
            console.log('setServerCallerId failed:', e && e.message);
          });
        }
      }
    }

    // Myself-only: push the email field to the SIP account record on
    // the server. We send it whenever the email value has changed
    // from what was originally loaded (server wins on the next
    // refreshAccountInfo, so we only need to push deltas the user
    // actually typed). Re-validate here so a stale value (paste,
    // autofill bypassing onChangeText) can't slip through — on
    // failure we surface the error and bail out of close().
    if (myself && typeof setServerEmail === 'function') {
      const trimmed = (email || '').trim();
      const original = (propEmail || '').trim();
      if (trimmed && !utils.isEmailAddress(trimmed)) {
        setEmailError('Invalid email address');
        return;
      }
      if (trimmed !== original) {
        setServerEmail(trimmed).catch((e) => {
          console.log('setServerEmail failed:', e && e.message);
        });
      }
    }

    // Myself-only: if the user opened the password field for editing
    // AND actually changed the value, push the new one to the
    // server. The field is pre-filled with the current password and
    // read-only until "Change" is tapped, so the common path
    // (modal opens, user saves other edits, modal closes) never
    // touches the password endpoint. We await this one because:
    //   • a successful change rewrites state.password locally, and
    //     downstream consumers should see the new value before any
    //     other save-side work fires.
    //   • a failure should be visible — the modal stays open with
    //     the typed value and an inline error so the user can fix
    //     and retry.
    if (myself
        && passwordEditable
        && typeof changeSipPassword === 'function'
        && (newPassword || '') !== (currentPassword || '')
        && (newPassword || '').length > 0) {
      try {
        await changeSipPassword(newPassword);
        setPasswordEditable(false);
      } catch (e) {
        setPasswordError((e && e.message) || 'Password change failed');
        return;
      }
    }

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
  let title = myself ? "My Blink account" : 'Edit Contact';
  
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
   		    <Surface style={[containerStyles.modalSurface, { maxHeight: surfaceMaxHeight }]}>
				{/* react-native-paper warns when overflow:hidden is
				    set on Surface itself (it clips the shadow). Per
				    its docs the fix is to wrap the children in a
				    View that carries the overflow style. NOTE: do
				    NOT add `flex: 1` here — the Surface uses
				    maxHeight (no explicit height), so a flexing
				    child collapses to 0 dp and the modal renders as
				    a thin line. Matching borderRadius keeps the
				    rounded-corner clipping that motivated the
				    original overflow:hidden. */}
				<View style={{ overflow: 'hidden', borderRadius: 10 }}>
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
				{/* Title row with the Blink logo on the left. The
				    logo is only shown on the My-account view —
				    regular contact edits and the Public-key view
				    keep the original centered title. blink-grey
				    renders cleanly on both light and dark themes
				    so we don't need to pick per-theme. */}
				{myself && !publicKey ? (
				  <View style={{
				    flexDirection: 'row',
				    alignItems: 'center',
				    justifyContent: 'flex-start',
				    marginLeft: 20,
				    marginBottom: 8,
				  }}>
				    <Image
				      source={require('../assets/images/blink-48.png')}
				      style={{ width: 32, height: 32, marginRight: 10, resizeMode: 'contain' }}
				    />
				    <Text style={containerStyles.title}>{title}</Text>
				  </View>
				) : (
				  <Text style={containerStyles.title}>{title}</Text>
				)}

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
                      {/* Myself-only Mobile number field. Populated
                          from accountSetting.account.myPhoneNumber
                          (auto-captured off the SIM on first PSTN
                          dial via READ_PHONE_NUMBERS) and editable
                          so the user can correct, override, or fill
                          it in manually (iOS — Apple never exposes
                          the SIM number to apps — and edge-case
                          Androids where getPhoneNumber() returned
                          nothing). Persisted on Save via
                          setMyPhoneNumber. phone-pad keyboard, no
                          autocapitalize, autofill turned off so the
                          OS doesn't try to inject a contact card. */}
                      {myself && (
                        <TextInput
                          mode="flat"
                          label="Mobile number"
                          // Validate as the user types — same rule as
                          // App.setServerCallerId (digits only, 7–15
                          // long, leading '+' or '00'). Clearing the
                          // field is allowed. The error is shown
                          // inline just below; Save is gated on it.
                          onChangeText={(t) => {
                            setMobileNumber(t);
                            setMobileError(validateCallerId(t));
                          }}
                          error={!!mobileError}
                          value={mobileNumber}
                          keyboardType="phone-pad"
                          autoCapitalize="none"
                          autoCorrect={false}
                          autoComplete="off"
                          importantForAutofill="no"
                          textContentType="telephoneNumber"
                          // Focus-time SIM lookup: when the user
                          // taps an empty Mobile number field on
                          // Android, prompt READ_PHONE_NUMBERS and
                          // pre-fill the input with the SIM-read
                          // number. Gated so it fires at most once
                          // per modal session — a user who clears
                          // the auto-filled number doesn't have it
                          // silently re-injected on the next focus.
                          // iOS / denial / no-MSISDN return '' from
                          // the helper, in which case the field
                          // stays empty and the user can type
                          // their number manually.
                          onFocus={async () => {
                            if (mobileLookupAttempted.current) return;
                            if ((mobileNumber || '').length > 0) return;
                            if (typeof readDevicePhoneNumber !== 'function') return;
                            mobileLookupAttempted.current = true;
                            try {
                              const num = await readDevicePhoneNumber();
                              if (num && (mobileNumber || '').length === 0) {
                                setMobileNumber(num);
                              }
                            } catch (e) {
                              // Helper already logs — never let a
                              // permission / read failure raise
                              // out of the focus handler.
                            }
                          }}
                        />
                      )}
                      {myself && mobileError ? (
                        <Text style={{ fontSize: 12, color: '#b22', marginTop: 2, paddingHorizontal: 4 }}>
                          {mobileError}
                        </Text>
                      ) : null}
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
                        // Live validation. Empty is allowed; anything
                        // else has to match utils.isEmailAddress —
                        // the same helper the contact-save sanitizer
                        // uses. Inline error is shown below; Save is
                        // gated on it.
                        onChangeText={(t) => {
                          setEmail(t);
                          const v = (t || '').trim();
                          setEmailError(
                            v && !utils.isEmailAddress(v)
                              ? 'Invalid email address'
                              : null
                          );
                        }}
                        error={!!emailError}
                        value={email}
                      />
                      {emailError ? (
                        <Text style={{ fontSize: 12, color: '#b22', marginTop: 2, paddingHorizontal: 4 }}>
                          {emailError}
                        </Text>
                      ) : null}

                    {/* ── Change-password field ─────────────────────
                        Myself-only. Empty by default; non-empty value
                        is committed on Save via App.changeSipPassword
                        (which talks to sylk_account_settings.phtml
                        and then rewrites the local accounts row).
                        Hidden behind a show/hide eye icon since we're
                        capturing a secret. The trailing inline error
                        is populated from handleSave's catch arm so
                        the user sees "Password must be at least 6
                        characters" / "Password change is disabled"
                        without having to scroll or guess. */}
                    {myself && typeof changeSipPassword === 'function' && (
                      <View style={{ position: 'relative' }}>
                        <TextInput
                          ref={passwordInputRef}
                          mode="flat"
                          label={
                            <Text style={{ fontSize: 12 }}>
                              {passwordEditable ? 'New password' : 'Password'}
                            </Text>
                          }
                          autoCapitalize="none"
                          autoCorrect={false}
                          autoComplete="off"
                          importantForAutofill="no"
                          textContentType={passwordEditable ? 'newPassword' : 'password'}
                          // Masked by default; in edit mode we
                          // un-mask so the user can see what they're
                          // editing. Eye on the right toggles back
                          // to masked at any time.
                          secureTextEntry={!showPassword}
                          // Read-only by default. Tapping the pencil
                          // (left) flips it writable, un-masks the
                          // field, and focuses the input with the
                          // caret at the end of the current value.
                          // Eye stays on the right in both modes.
                          // Always editable underneath; an absolute
                          // Pressable overlay rendered after this
                          // TextInput (see below) catches taps in
                          // read-only mode and routes them through
                          // the same pencil flow. This keeps
                          // focus() callable from a real user
                          // gesture, which is the only way iOS /
                          // Android reliably bring up the keyboard.
                          editable={true}
                          selection={passwordSelection}
                          onSelectionChange={() => {
                            // Release the controlled selection
                            // after the caret-to-end placement has
                            // taken effect so subsequent taps /
                            // drags can move the caret freely.
                            if (passwordSelection !== null) {
                                setPasswordSelection(null);
                            }
                          }}
                          left={!passwordEditable ? (
                            <TextInput.Icon
                              icon="pencil-outline"
                              onPress={() => {
                                // Tap pencil → enter edit mode,
                                // KEEP the pre-filled password, but
                                // park the caret at the end so the
                                // user can append / backspace from
                                // there. focus() runs synchronously
                                // inside the gesture so the keyboard
                                // pops up. Save is gated on
                                // (newPassword !== currentPassword
                                // && passes validateSipPassword), so
                                // saving without editing is a no-op.
                                setPasswordError(null);
                                const end = (newPassword || '').length;
                                setPasswordSelection({ start: end, end });
                                setPasswordEditable(true);
                                if (passwordInputRef.current
                                    && typeof passwordInputRef.current.focus === 'function') {
                                    try { passwordInputRef.current.focus(); } catch (_) {}
                                }
                              }}
                            />
                          ) : null}
                          right={
                            <TextInput.Icon
                              icon={showPassword ? 'eye-off' : 'eye'}
                              onPress={() => setShowPassword(v => !v)}
                            />
                          }
                          value={newPassword}
                          onChangeText={(t) => {
                            setNewPassword(t);
                            // Empty is allowed (no-op on Save); any
                            // non-empty value is checked against the
                            // strength rule (≥6 chars, upper+lower
                            // +digit) so the user sees the rejection
                            // before they hit Save.
                            setPasswordError(
                              t.length === 0 ? null : validateSipPassword(t)
                            );
                          }}
                        />
                        {/* Tap-blocker overlay. Sits ON TOP of the
                            TextInput when in read-only mode and
                            swallows taps in the text area itself.
                            Left and right edges are inset by ~48dp
                            each so the pencil (left affix) and eye
                            (right affix) icons remain tappable.
                            Tapping anywhere in the middle is
                            equivalent to tapping the pencil — same
                            empty-the-field-and-focus flow. */}
                        {!passwordEditable && (
                          <Pressable
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 48,
                              right: 48,
                              bottom: 0,
                              zIndex: 1,
                            }}
                            onPress={() => {
                              // Same flow as pencil: keep the
                              // pre-filled value, park the caret at
                              // the end, focus inside the gesture.
                              setPasswordError(null);
                              const end = (newPassword || '').length;
                              setPasswordSelection({ start: end, end });
                              setPasswordEditable(true);
                              if (passwordInputRef.current
                                  && typeof passwordInputRef.current.focus === 'function') {
                                  try { passwordInputRef.current.focus(); } catch (_) {}
                              }
                            }}
                          />
                        )}
                        {passwordError ? (
                          <Text style={{ fontSize: 12, color: '#b22', marginTop: 2, paddingHorizontal: 4 }}>
                            {passwordError}
                          </Text>
                        ) : passwordEditable && (newPassword || '').length === 0 ? (
                          // Small helper line that acts as a low-key
                          // placeholder describing the strength rule
                          // while the field is empty. Hidden once
                          // the user starts typing — at that point
                          // passwordError carries either null (valid)
                          // or the specific rule that's failing, so
                          // the hint is no longer needed.
                          <Text style={{ fontSize: 11, opacity: 0.55, marginTop: 2, paddingHorizontal: 4 }}>
                            Min 6 chars · upper · lower · number
                          </Text>
                        ) : null}
                      </View>
                    )}

                    {/* ── Server-side account snapshot ──────────────
                        Read-only line under the Email field on the
                        My Account view. Sourced from cdrtool's
                        account_info.phtml via HTTP Digest using the
                        SIP credentials (see app/accountInfo.js).
                        Refreshed when the modal opens by the
                        useEffect above. We render:
                          • PSTN credit + currency (if prepaid)
                          • Server-stored mobile number (if any)
                          • An error / loading hint instead, so the
                            user knows whether the value they see is
                            current or stale.
                        Hidden on the edit-contact view since the
                        endpoint is per-logged-in-user. */}
                    {/* The whole server-info block (rows + refresh
                        icon) is suppressed when:
                          • the active server hasn't published an
                            accountInfoUrl in sylk-config.json —
                            nothing to refresh against, no orphan
                            refresh button.
                          • PSTN is unusable (explicitly disabled
                            server-side, or prepaid with no credit).
                        Loading / error states render in the
                        accountInfoAvailable branch so the user sees
                        the spinner and the refresh button while a
                        fetch is in flight. */}
                    {myself && accountInfoAvailable && !(accountInfo && accountInfo.pstn && (
                        accountInfo.pstn.enabled === false
                        || (accountInfo.pstn.prepaid
                            && typeof accountInfo.pstn.balance === 'number'
                            && accountInfo.pstn.balance <= 0)
                    )) && (
                      <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginTop: 8,
                        marginBottom: 4,
                        paddingHorizontal: 4,
                      }}>
                        {/* Left: the actual snapshot lines. Flex=1
                            so it takes all remaining width and the
                            refresh icon on the right stays anchored. */}
                        <View style={{ flex: 1 }}>
                          {accountInfoLoading && !accountInfo ? (
                            <Text style={{ fontSize: 12, opacity: 0.6 }}>
                              Loading account info…
                            </Text>
                          ) : accountInfo ? (
                            <>
                              {/* PSTN rows are hidden entirely when
                                  PSTN is disabled server-side
                                  (pstn.enabled === false). The values
                                  are still in state — they're just
                                  irrelevant when the user can't place
                                  PSTN calls at all. */}
                              {/* Prepaid: show balance + "Add
                                  credit". Postpaid: show a single
                                  "Postpaid account" line so the user
                                  can see at a glance which billing
                                  model the SIP account is on
                                  (replaces the credit row entirely).
                                  Either way we only render when PSTN
                                  is enabled. */}
                              {accountInfo.pstn
                                && accountInfo.pstn.enabled !== false
                                && accountInfo.pstn.prepaid === false ? (
                                <Text style={{ fontSize: 13, opacity: 0.75 }}>
                                  Postpaid account
                                </Text>
                              ) : null}
                              {accountInfo.pstn
                                && accountInfo.pstn.enabled !== false
                                && accountInfo.pstn.prepaid === true
                                && accountInfo.pstn.balance !== null
                                && accountInfo.pstn.balance !== undefined && (
                                // PSTN credit line + inline "Add
                                // credit" affordance. Same row, label
                                // on the left, compact text-mode
                                // button on the right. The button
                                // hands off to handleOpenPaymentInfo
                                // below, which closes this modal
                                // first and then opens the
                                // PaymentInfoModal — RN can't reliably
                                // stack two Modals, so dismiss-then-
                                // open avoids the "second modal
                                // doesn't appear on iOS" trap.
                                <View style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                }}>
                                  <Text style={{ fontSize: 13, opacity: 0.75 }}>
                                    PSTN credit: {Number(accountInfo.pstn.balance).toFixed(2)} {accountInfo.pstn.currency || ''}
                                  </Text>
                                  {typeof openPaymentInfoModal === 'function' ? (
                                    <Button
                                      mode="text"
                                      compact
                                      uppercase={false}
                                      onPress={handleOpenPaymentInfo}
                                      style={{ marginLeft: 4, marginVertical: -6 }}
                                      labelStyle={{ fontSize: 13 }}
                                    >
                                      Add credit
                                    </Button>
                                  ) : null}
                                </View>
                              )}
                              {accountInfo.pstn
                                && accountInfo.pstn.enabled !== false
                                && accountInfo.pstn.caller_id
                                && !isPlaceholderCallerId(accountInfo.pstn.caller_id) ? (
                                <View style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                }}>
                                  <Text style={{ fontSize: 13, opacity: 0.75 }}>
                                    PSTN caller Id: {accountInfo.pstn.caller_id}
                                  </Text>
                                  {typeof openSetCallerIdModal === 'function' ? (
                                    <Button
                                      mode="text"
                                      compact
                                      uppercase={false}
                                      onPress={handleOpenSetCallerId}
                                      style={{ marginLeft: 4, marginVertical: -6 }}
                                      labelStyle={{ fontSize: 13 }}
                                    >
                                      Change
                                    </Button>
                                  ) : null}
                                </View>
                              ) : null}
                            </>
                          ) : accountInfoError ? (
                            // Error envelope. Constrained to the same
                            // ~2-row height the success branch
                            // occupies, with an inner ScrollView so a
                            // long server payload / stack trace
                            // doesn't expand the modal. nestedScroll
                            // lets the inner scroller work even when
                            // the outer modal ScrollView is bouncing.
                            <View style={{
                              maxHeight: 36,
                              borderWidth: 1,
                              borderColor: '#f1c2c2',
                              borderRadius: 4,
                              backgroundColor: '#fdf6f6',
                            }}>
                              <ScrollView
                                nestedScrollEnabled
                                showsVerticalScrollIndicator
                                contentContainerStyle={{ paddingHorizontal: 6, paddingVertical: 2 }}
                              >
                                <Text style={{ fontSize: 11, color: '#b22', lineHeight: 14 }}>
                                  {accountInfoError}
                                </Text>
                              </ScrollView>
                            </View>
                          ) : null}
                        </View>

                        {/* Right: tappable refresh icon. While a
                            refresh is in flight we swap to an
                            ActivityIndicator so the user gets visual
                            feedback. Disabled when no refresh
                            helper is wired (defensive — the prop is
                            always supplied from App today). hitSlop
                            keeps the tap target generous without
                            growing the visible icon. */}
                        {typeof refreshAccountInfo === 'function' && (
                          accountInfoLoading ? (
                            <ActivityIndicator
                              size="small"
                              style={{ marginLeft: 8, width: 24, height: 24 }}
                            />
                          ) : (
                            <TouchableOpacity
                              onPress={() => {
                                setAccountInfoLoading(true);
                                refreshAccountInfo()
                                  .catch(() => { /* surfaced via accountInfoError */ })
                                  .finally(() => { setAccountInfoLoading(false); });
                              }}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              style={{ marginLeft: 8, padding: 2 }}
                              accessibilityLabel="Refresh account info"
                            >
                              <Icon name="refresh" size={20} color="#555" />
                            </TouchableOpacity>
                          )
                        )}
                      </View>
                    )}

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

                    {/* "Delete account on server…" used to live here.
                        Moved into DeleteAccountModal so the local and
                        server-side delete actions sit together. */}
                    {!(myself && deleteAccountUrl) ? (
                      selectedContact?.prettyStorage && !keyboardVisible && (
                        <Text style={styles.small}>Storage usage: {selectedContact.prettyStorage}</Text>
                      )
                    ) : null}

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
                    {myself && openDeleteAccount && !keyboardVisible && (() => {
                      // Bottom row: Server label on the left,
                      // "Delete account" link on the right. Server
                      // prefers the thor_node (specific cluster
                      // member) and falls back to sip_proxy; falsy
                      // when neither is set so the left slot becomes
                      // an empty spacer and the link still pins to
                      // the right.
                      const srv = (accountInfo && accountInfo.server) || {};
                      const thor  = (srv.thor_node && String(srv.thor_node).trim()) || '';
                      const proxy = (srv.sip_proxy && String(srv.sip_proxy).trim()) || '';
                      // thor_node wins when present (it's the
                      // specific cluster member); fall back to the
                      // proxy. Labels differ so the user can tell
                      // which kind of server they're looking at.
                      let serverPrefix = '';
                      let serverValue  = '';
                      if (thor) {
                          serverPrefix = 'SIP Thor node';
                          serverValue  = thor;
                      } else if (proxy) {
                          serverPrefix = 'SIP Proxy server';
                          serverValue  = proxy;
                      }
                      return (
                        <View style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          paddingTop: 4,
                          paddingBottom: 10,
                          paddingHorizontal: 10,
                        }}>
                          {serverValue ? (
                            <Text style={{ fontSize: 11, opacity: 0.55, flexShrink: 1, marginRight: 8 }} numberOfLines={1}>
                              {serverPrefix}: {serverValue}
                            </Text>
                          ) : (
                            <View />
                          )}
                          <Text
                            onPress={openDeleteAccount}
                            accessibilityRole="button"
                            accessibilityLabel="Delete account"
                            style={{ fontSize: 12, color: '#c62828', textDecorationLine: 'underline' }}
                          >
                            Delete account
                          </Text>
                        </View>
                      );
                    })()}

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
                </View>
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
  myPhoneNumber: PropTypes.string,
  setMyPhoneNumber: PropTypes.func,
  readDevicePhoneNumber: PropTypes.func,
  openPaymentInfoModal: PropTypes.func,
  accountInfo: PropTypes.object,
  accountInfoError: PropTypes.string,
  refreshAccountInfo: PropTypes.func,
  accountInfoAvailable: PropTypes.bool,
  openSetCallerIdModal: PropTypes.func,
  setServerCallerId: PropTypes.func,
  changeSipPassword: PropTypes.func,
  setServerEmail: PropTypes.func,
};

export default EditContactModal;
