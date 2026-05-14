// Mid-call audio→video upgrade confirmation modal.
//
// Surfaces on top of the active call screen (AudioCallBox) whenever the
// user taps the +video button OR the peer initiates a re-INVITE that
// adds m=video. Styled to match IncomingCallModal so the gesture is
// familiar — a Paper Portal+Modal+Surface with a header and two large
// IconButton actions (accept = green camera, reject = red hangup).
//
// Owner: Call.js. The modal does no media work itself; it just
// announces user intent. The parent decides what to do — outgoing
// upgrades call .addVideo() on confirm and stop the captured track on
// cancel; incoming upgrades call .answerUpdate() with or without a
// local stream depending on which button was tapped.

import React from 'react';
import PropTypes from 'prop-types';
import { Headline, IconButton, Title, Portal, Modal, Surface } from 'react-native-paper';
import { View } from 'react-native';
import styles from '../assets/styles/blink/_IncomingCallModal.scss';


const UpgradeVideoModal = ({
    visible,
    direction,         // 'outgoing' | 'incoming'
    remoteUri,
    remoteDisplayName,
    onAccept,
    onReject,
    onHide,
}) => {
    if (!visible) {
        return null;
    }

    // Outgoing: we're asking ourselves "OK, ready to share my camera?"
    // Incoming: the peer is asking us "I want to add video to our call".
    // Wording mirrors what IncomingCallModal does for a fresh call —
    // single line, identity above, intent below.
    const headlineText = direction === 'incoming'
        ? 'wants to add video to this call'
        : 'Add video to this call?';

    return (
        <Portal>
            <Modal visible={visible} onDismiss={onHide}>
                <Surface style={styles.container}>
                    {/* Show who the request is about. For outgoing
                        we still show the remote identity so the user
                        knows which call they're upgrading (when more
                        than one is on screen). */}
                    {remoteDisplayName ? (
                        <Title style={styles.remoteDisplayName}>
                            {remoteDisplayName}
                        </Title>
                    ) : null}
                    {remoteUri && remoteDisplayName !== remoteUri ? (
                        <Title style={styles.remoteUri}>{remoteUri}</Title>
                    ) : null}

                    <Headline style={styles.remoteMedia}>
                        {headlineText}
                    </Headline>

                    <View style={styles.buttonContainer}>
                        {/* Accept / Start camera. Matches the green
                            video IconButton inside IncomingCallModal
                            so the gesture and colour are consistent
                            across the two flows. */}
                        <IconButton
                            key="upgrade-accept"
                            style={styles.button}
                            size={40}
                            onPress={onAccept}
                            icon="video"
                        />
                        {/* Reject / Cancel. Same red hangup icon as
                            IncomingCallModal's decline button. For an
                            outgoing upgrade this just drops the local
                            request; for an incoming one we answer
                            with recvonly video. */}
                        <IconButton
                            key="upgrade-reject"
                            style={styles.rejectButton}
                            size={40}
                            onPress={onReject}
                            icon="phone-hangup"
                        />
                    </View>
                </Surface>
            </Modal>
        </Portal>
    );
};


UpgradeVideoModal.propTypes = {
    visible: PropTypes.bool.isRequired,
    direction: PropTypes.oneOf(['outgoing', 'incoming']).isRequired,
    remoteUri: PropTypes.string,
    remoteDisplayName: PropTypes.string,
    onAccept: PropTypes.func.isRequired,
    onReject: PropTypes.func.isRequired,
    onHide: PropTypes.func,
};


export default UpgradeVideoModal;
