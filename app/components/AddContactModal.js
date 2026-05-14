import React, { useState, useEffect } from 'react';
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

  useEffect(() => {
    setUri(propUri || '');
    setDisplayName(propDisplayName || '');
    setOrganization(propOrg || '');
  }, [propUri, propDisplayName, propOrg, show]);

  const handleSave = () => {
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
    const cleaned = value.replace(/\s|\(|\)/g, '').toLowerCase();
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
				<Text style={containerStyles.title}>{title}</Text>

			{/* Scrollable content above buttons */}
			<ScrollView
			  style={containerStyles.scrollContainer}
			  contentContainerStyle={{ flexGrow: 1 }}
			  keyboardShouldPersistTaps="handled"
			>
			  <TextInput
				mode="flat"
				label="Enter SIP address"
				onChangeText={onUriChange}
				value={uri}
  			    autoCapitalize="none"
			    autoCorrect={false}
			  />
	
			  <TextInput
				mode="flat"
				label="Display name"
				onChangeText={setDisplayName}
				value={displayName}
			    autoCorrect={false}
				autoCapitalize="words"
			  />
	
			</ScrollView>

			  <Text style={containerStyles.note}>
				The domain part is optional, it defaults to @{defaultDomain}
			  </Text>
	
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
					  disabled={!uri}
					  onPress={handleSave}
					  icon="content-save"
					>
					  Save
					</Button>
			   </View>

               {/* Modal content end */}
              </Surface>
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

