import React, { useState, useEffect, useRef } from 'react';
import ThemedModalSurface from './ThemedModalSurface';
import {
  Modal,
  View,
  TouchableWithoutFeedback,
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import { Text, Button, Surface, TextInput } from 'react-native-paper';
import PropTypes from 'prop-types';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/ContentStyles';
import utils from '../utils';

const AddContactModal = ({
  show,
  close,
  saveContactByUser,
  defaultDomain,
  displayName: propDisplayName,
  uri: propUri,
  organization: propOrg,
  // Optional AB provenance. When the modal is invoked off an
  // address-book row (search-source toggle = 'ab' → tap "Add"), the
  // caller forwards the AB entry's stable handle so saveContactByUser
  // can tag the new Sylk contact 'ab' and stash the record id on
  // contact.properties.ab_id. The id is opaque here — we just pass it
  // through. When invoked from the plain "+" menu, both props are
  // undefined and the saved contact looks like any other manual add.
  recordID: propRecordID,
  tags: propTags,
}) => {
  const [uri, setUri] = useState(propUri || '');
  const [displayName, setDisplayName] = useState(propDisplayName || '');
  const [organization, setOrganization] = useState(propOrg || '');

  // Focus the SIP-address field as soon as the modal opens so the user can
  // start typing the address immediately (it's the primary input even though
  // Display name renders above it).
  const uriRef = useRef(null);

  useEffect(() => {
    setUri(propUri || '');
    setDisplayName(propDisplayName || '');
    setOrganization(propOrg || '');
  }, [propUri, propDisplayName, propOrg, show]);

  useEffect(() => {
    if (!show) return undefined;
    const t = setTimeout(() => {
      if (uriRef.current && uriRef.current.focus) uriRef.current.focus();
    }, 250);
    return () => clearTimeout(t);
  }, [show]);

  // Gate Save on the shared address rule (utils.isUsableContactAddress,
  // which mirrors app.js sanitizeContact). Anything sanitizeContact
  // refuses makes newContact() return null, and saveContactByUser used to
  // dereference that null -- the 8.3.5 crash "TypeError: Cannot set
  // property 'uri' of null", reachable from a plain Save tap on e.g. a
  // display name typed into the address field, a trailing '@', or a
  // Cyrillic local part. A SIP address is an ASCII protocol identifier, so
  // non-ASCII is refused here on purpose; the contact's Email field and
  // Display name are separate and DO accept it. app.js guards the
  // dereference now, but silently dropping the save is a poor answer to a
  // typo: keep Save disabled so the user sees it before tapping.
  const uriValid = utils.isUsableContactAddress(uri, defaultDomain);

  const handleSave = () => {
    if (!uriValid) return;
    const contact = {uri: uri,
                     displayName: displayName,
                     organization: organization,
                     email: '',
                     // Pass through AB provenance untouched.
                     // saveContactByUser branches on these to tag the
                     // saved Sylk contact + persist the link.
                     recordID: propRecordID,
                     tags: propTags,
                     }
    console.log('Add contact', contact);

    saveContactByUser(contact);
    close();
  };

  const onUriChange = (value) => {
    let cleaned = value.replace(/\s|\(|\)/g, '').toLowerCase();
    // Pasted/typed phone numbers carrying separators ('+1-313-1313',
    // '+1313_1313') collapse to canonical digits — we know it's a phone
    // number, so the '-'/'_' are noise. Ordinary SIP usernames (e.g.
    // 'john-doe') keep theirs.
    if (utils.isPhoneNumber(cleaned)) {
      cleaned = cleaned.replace(/[-_]/g, '');
    }
    setUri(cleaned);
  };

  if (!show) return null;

  const title = "Add contact";

  return (
    <Modal
	  style={containerStyles.container}
      visible={show}
      transparent
      animationType="fade"
      onRequestClose={close} // Android back button
      /* iOS-only — without this, RN's Modal defaults to
         supportedOrientations: ['portrait'], which forces the
         underlying app to portrait while the modal is presented.
         Include both landscape variants so the modal inherits
         whichever orientation the user is in. */
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
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

   		    <ThemedModalSurface style={containerStyles.modalSurface}>
            {/* Modal content start */}
				<Text style={containerStyles.title}>{title}</Text>

			{/* Scrollable content above buttons */}
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
			    autoCorrect={false}
				autoCapitalize="words"
			  />

			  <TextInput
				ref={uriRef}
				mode="flat"
				label="Enter SIP address"
				onChangeText={onUriChange}
				value={uri}
  			    autoCapitalize="none"
			    autoCorrect={false}
			  />

			</ScrollView>

			  <View style={styles.buttonRow}>
					{/* Match the button pattern used in EditContactModal /
					    DeleteHistoryModal / DeleteFileTransfers — outlined
					    Cancel first, contained primary action second.
					    Also gives users a guaranteed dismiss target when
					    the tap-outside area is tiny (e.g. keyboard up). */}
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
					  disabled={!uriValid}
					  onPress={handleSave}
					  icon="content-save"
					>
					  Save
					</Button>
			   </View>

               {/* Modal content end */}
              </ThemedModalSurface>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

AddContactModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func.isRequired,
  saveContactByUser: PropTypes.func,
  defaultDomain: PropTypes.string,
  displayName: PropTypes.string,
  uri: PropTypes.string,
  organization: PropTypes.string,
  // AB provenance — both optional. recordID is the OS contact id (or
  // the AB row id we minted client-side in getABContacts); tags is the
  // initial tag list (typically ['ab']) the caller wants on the saved
  // Sylk contact. saveContactByUser merges these in.
  recordID: PropTypes.string,
  tags: PropTypes.arrayOf(PropTypes.string),
};

export default AddContactModal;

