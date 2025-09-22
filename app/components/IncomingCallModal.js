import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { Headline, IconButton, Title, Portal, Modal, Surface } from 'react-native-paper';
import { View } from 'react-native';
import Logo from './Logo';
import styles from '../assets/styles/blink/_IncomingCallModal.scss';

const IncomingCallModal = ({
  contact,
  media,
  CallUUID,
  onAccept,
  onReject,
  onHide,
  playIncomingRingtone,
}) => {
  const show = CallUUID !== null;
  const hasVideo = media?.video === true;
  const callType = hasVideo ? 'video' : 'audio';

  useEffect(() => {
    if (CallUUID) {
      console.log('Alert panel mounted/updated', CallUUID);
      playIncomingRingtone?.(CallUUID);
    }
  }, [CallUUID, playIncomingRingtone]);

  if (!contact || !CallUUID) {
    return null;
  }

  const remoteIdentity = {
    uri: contact.uri,
    displayName: contact.name,
    photo: contact.photo,
  };

  return (
    <Portal>
      <Modal visible={show} onDismiss={() => onHide(CallUUID)}>
        <Surface style={styles.container}>
          <Logo />

          <Title style={styles.remoteDisplayName}>{remoteIdentity.displayName}</Title>

          {remoteIdentity.displayName !== remoteIdentity.uri && (
            <Title style={styles.remoteUri}>{remoteIdentity.uri}</Title>
          )}

          <Headline style={styles.remoteMedia}>
            is calling with {callType}
          </Headline>

          <View style={styles.buttonContainer}>
            <IconButton
              key="audio"
              style={styles.button}
              size={40}
              onPress={() => onAccept(CallUUID, { audio: true, video: false })}
              icon="phone"
            />
            {hasVideo && (
              <IconButton
                key="video"
                style={styles.button}
                size={40}
                onPress={() => onAccept(CallUUID, { audio: true, video: true })}
                icon="video"
              />
            )}
            <IconButton
              key="decline"
              style={styles.rejectButton}
              size={40}
              onPress={() => onReject(CallUUID)}
              icon="phone-hangup"
            />
            <IconButton
              key="dismiss"
              style={styles.dismissButton}
              size={40}
              onPress={() => onHide(CallUUID)}
              icon="bell-off-outline"
            />
          </View>
        </Surface>
      </Modal>
    </Portal>
  );
};

IncomingCallModal.propTypes = {
  contact: PropTypes.object,
  CallUUID: PropTypes.string,
  media: PropTypes.object,
  onAccept: PropTypes.func.isRequired,
  onReject: PropTypes.func.isRequired,
  onHide: PropTypes.func.isRequired,
  playIncomingRingtone: PropTypes.func,
};

export default IncomingCallModal;
