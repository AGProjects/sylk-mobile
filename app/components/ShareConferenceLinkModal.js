import React from 'react';
import {  Platform, Linking } from 'react-native';
import { Modal, View, TouchableWithoutFeedback, Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet } from 'react-native';
import { Text, IconButton, Surface, Portal } from 'react-native-paper';
import PropTypes from 'prop-types';
import Share from 'react-native-share';
import utils from '../utils';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/ContentStyles';

const ShareConferenceLinkModal = ({ show, close, conferenceUrl, notificationCenter }) => {

  const handleClipboardButton = () => {
    utils.copyToClipboard(conferenceUrl);
    notificationCenter().postSystemNotification('Call me', { body: 'Web address copied to the clipboard' });
    close();
  };

  const handleEmailButton = () => {
    const emailMessage = `You can join the conference using a Web browser at ${conferenceUrl} ` +
      'or by using Sylk client freely downloadable from http://sylkserver.com';
	const subject = encodeURIComponent('Join conference, maybe?');
	const body = encodeURIComponent(emailMessage);
	const mailtoUrl = `mailto:?subject=${subject}&body=${body}`;

    Linking.openURL(mailtoUrl).catch(err => console.error('Error opening mail app', err));
    close();
  };

  const handleShareButton = () => {
    const options = {
        subject: 'Join conference, maybe?',
        message: 'You can join my conference at ' + conferenceUrl
    };

    Share.open(options)
      .then(() => close())
      .catch(() => close());
  };

  const handleClose = () => {
	  close();           // call parent close
  };

  if (!show) return null;

  const title= "Share conference link?";

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
			  <Text style={containerStyles.title}>{title}</Text>

				<View style={styles.buttonRow}>
				<Text style={styles.link}>
					{conferenceUrl}
				</Text>
              </View>

				<View style={styles.buttonRow}>
				<Text style={styles.shareText}>
					Select an external application to share the conference web link:
				</Text>
              </View>

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

ShareConferenceLinkModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func.isRequired,
  conferenceUrl: PropTypes.string.isRequired,
  notificationCenter: PropTypes.func.isRequired
};

export default ShareConferenceLinkModal;

