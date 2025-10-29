import React from 'react';
import {  Platform, Linking } from 'react-native';
import { Modal, View, TouchableWithoutFeedback, Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet } from 'react-native';
import { Text, IconButton, Surface, Portal } from 'react-native-paper';
import PropTypes from 'prop-types';
import Share from 'react-native-share';
import utils from '../utils';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/ContentStyles';

const CallMeMaybeModal = ({ show, close, callUrl, notificationCenter }) => {

  const sipUri = callUrl.split('/').slice(-1)[0];

  const handleClipboardButton = () => {
    utils.copyToClipboard(callUrl);
    notificationCenter().postSystemNotification('Call me', { body: 'Web address copied to the clipboard' });
    close();
  };

  const handleEmailButton = () => {
    const emailMessage = `You can call me using a Web browser at ${callUrl} or a SIP client at ${sipUri} ` +
      'or by using Sylk client freely downloadable from http://sylkserver.com';
    const subject = encodeURIComponent('Call me, maybe?');
    const body = encodeURIComponent(emailMessage);
    const mailtoUrl = `mailto:?subject=${subject}&body=${body}`;

    Linking.openURL(mailtoUrl).catch(err => console.error('Error opening mail app', err));
    close();
  };

  const handleShareButton = () => {
    const options = {
      subject: 'Call me, maybe?',
      message: `You can call me using a Web browser at ${callUrl} or a SIP client at ${sipUri} or by using the freely available Sylk WebRTC client app at http://sylkserver.com`
    };

    Share.open(options)
      .then(() => close())
      .catch(() => close());
  };

	const handleClose = () => {
	  close();           // call parent close
	};

  if (!show) return null;

   const title= "Call me, maybe?";

  return (
    <Modal
	  style={containerStyles.container}
      visible={show}
      transparent
      animationType="fade"
      onRequestClose={handleClose} // Android back button
    >

      {/* Dismiss modal when tapping outside */}
      <TouchableWithoutFeedback onPress={handleClose}>
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

              <Text style={styles.body}>Others can call you with a SIP client at:</Text>
              <Text style={styles.link}>{sipUri}</Text>

              <Text style={styles.body}>or with a Web browser at:</Text>
              <Text style={styles.link}>{callUrl}</Text>

              <Text style={styles.body}>Share this address with others:</Text>

              <View style={styles.iconContainer}>
                <IconButton size={34} onPress={handleClipboardButton} icon="content-copy" />
                <IconButton size={34} onPress={handleEmailButton} icon="email" />
                <IconButton size={34} onPress={handleShareButton} icon="share-variant" />
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

CallMeMaybeModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func.isRequired,
  callUrl: PropTypes.string,
  notificationCenter: PropTypes.func.isRequired
};

export default CallMeMaybeModal;

