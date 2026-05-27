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
      // Renamed from "PSTN number" to "PSTN access number" to match
      // the label used on the Join Conference panel, where the same
      // number is shown under the "Allow calling from telephones"
      // toggle. Two different labels for the same value confused
      // users into thinking they were two different numbers.
      lines.push('• PSTN access number: ' + conferenceSettings.pstnBridge);
      // The dial-in code (room number) sits immediately under the
      // PSTN access number — PSTN callers dial the access number
      // first, then enter the room number on their keypad to land
      // in the right conference, so the two pieces of information
      // are only useful together.
      if (conferenceRoom) {
        lines.push('• Room number: ' + conferenceRoom);
      }
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
                    PSTN access number: {conferenceSettings.pstnBridge}
                  </Text>
                </View>
              ) : null}

              {/* Room number sits directly after the PSTN access
                  number — PSTN callers dial the access number first,
                  then enter the room number on their keypad to land
                  in the right conference. Without the room number
                  the PSTN line on its own is useless, so we only
                  show this row when both are available. */}
              {conferenceSettings && conferenceSettings.pstnBridge && conferenceRoom ? (
                <View style={styles.buttonRow}>
                  <Text style={styles.shareText}>
                    Room number: {conferenceRoom}
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

