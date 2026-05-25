import React from 'react';
import {  Platform, Linking } from 'react-native';
import { Modal, View, TouchableWithoutFeedback, Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet } from 'react-native';
import { Text, IconButton, Surface, Portal } from 'react-native-paper';
import PropTypes from 'prop-types';
import Share from 'react-native-share';
import utils from '../utils';
import QRCode from 'react-native-qrcode-svg';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/ContentStyles';

const ShareConferenceLinkModal = ({ show, close, conferenceUrl, notificationCenter, sylkDomain, conferenceRoom, conferenceSettings }) => {

  const bulletLines = () => {
    const lines = ['• Web: ' + conferenceUrl];
    if (conferenceSettings && conferenceSettings.pstnBridge) {
      lines.push('• PSTN number: ' + conferenceSettings.pstnBridge);
    }
    if (conferenceSettings && conferenceSettings.sipBridge && conferenceRoom) {
      lines.push('• SIP audio: ' + conferenceRoom + '@' + conferenceSettings.sipBridge);
    }
    return lines.join('\n');
  };

  const handleClipboardButton = () => {
    utils.copyToClipboard(bulletLines());
    notificationCenter().postSystemNotification('Call me', { body: 'Web address copied to the clipboard' });
    close();
  };

  const handleEmailButton = () => {
    const emailMessage = 'You can join the conference using one of these:\n\n' +
      bulletLines() +
      '\n\nThe Sylk client is freely downloadable from http://sylkserver.com';
	const subject = encodeURIComponent('Join conference, maybe?');
	const body = encodeURIComponent(emailMessage);
	const mailtoUrl = `mailto:?subject=${subject}&body=${body}`;

    Linking.openURL(mailtoUrl).catch(err => console.error('Error opening mail app', err));
    close();
  };

  const handleShareButton = () => {
    const options = {
        subject: 'Join conference, maybe?',
        message: 'You can join my conference using one of these:\n\n' + bulletLines()
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
  const sylkUrl = "sylk://" + sylkDomain + "/conference/" + conferenceRoom

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

              {conferenceSettings && conferenceSettings.pstnBridge ? (
                <View style={styles.buttonRow}>
                  <Text style={styles.shareText}>
                    PSTN number: {conferenceSettings.pstnBridge}
                  </Text>
                </View>
              ) : null}

              {conferenceSettings && conferenceSettings.sipBridge && conferenceRoom ? (
                <View style={styles.buttonRow}>
                  <Text style={styles.shareText}>
                    SIP audio: {conferenceRoom}@{conferenceSettings.sipBridge}
                  </Text>
                </View>
              ) : null}

              <View style={[styles.chipsContainer, styles.iconContainer]}>
				<QRCode
				  value={sylkUrl}
				/>
              </View>

			  <View style={styles.buttonRow}>
				<Text style={styles.shareText}>
					Share the conference web link:
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
  notificationCenter: PropTypes.func.isRequired,
  sylkDomain: PropTypes.string,
  conferenceRoom: PropTypes.string,
  conferenceSettings: PropTypes.object,
};

export default ShareConferenceLinkModal;

