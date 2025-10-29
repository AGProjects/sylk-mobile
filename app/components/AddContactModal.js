import React, { useState, useEffect } from 'react';
import { Modal, View, TouchableWithoutFeedback, Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet } from 'react-native';
import { Text, Button, Surface, TextInput } from 'react-native-paper';
import PropTypes from 'prop-types';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/ContentStyles';

const AddContactModal = ({
  show,
  close,
  saveContact,
  defaultDomain,
  displayName: propDisplayName,
  uri: propUri,
  organization: propOrg
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
                     email: ''
                     }
    console.log('Add contact', contact);
  
    saveContact(contact);
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
				label="Enter user@domain"
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
					<Button
					  mode={uri ? 'contained' : 'flat'}
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
  saveContact: PropTypes.func,
  defaultDomain: PropTypes.string,
  displayName: PropTypes.string,
  uri: PropTypes.string,
  organization: PropTypes.string,
};

export default AddContactModal;

