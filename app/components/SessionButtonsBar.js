import React from 'react';
import PropTypes from 'prop-types';
import { View, TouchableHighlight, Animated } from 'react-native';
import { IconButton } from 'react-native-paper';
import utils from '../utils';

// SessionButtonsBar — the call/action button row extracted out of ReadyBox.
// It hosts the chat, audio-call, video-call, record-audio, share-location,
// delete, stop, cancel-share, conference, send-audio, share-content and
// QR-code buttons that render under the main app navbar. This component is
// purely presentational: ReadyBox computes every visibility flag, disabled
// flag, style class and handler and passes them in as explicit props (the
// same decoupled pattern used for the AudioRecorder extraction). It renders
// null when `visible` is false so the caller doesn't have to gate it.
function SessionButtonsBar(props) {
    const {
        visible,
        isFolded,
        uriGroupClass,
        buttonGroupClass,
        styles,

        selectedContact,
        shareToContacts,
        inviteContacts,

        // Per-platform button style classes (computed in ReadyBox.render).
        greenButtonClass,
        disabledGreenButtonClass,
        blueButtonClass,
        disabledBlueButtonClass,
        redButtonClass,
        purpleButtonClass,
        recordIcon,

        // Visibility gates.
        showCallButtons,
        showAudioRecordButton,
        showLocationShareButton,
        showAudioDeleteButton,
        showAudioStopButton,
        showConferenceButton,
        showAudioSendButton,
        showQRCodeButton,

        // Disabled gates.
        chatButtonDisabled,
        callButtonDisabled,
        videoButtonDisabled,
        conferenceButtonDisabled,
        // Share-to-contacts: no recipient picked yet -> Share is a no-op
        // (shareContent() would just tear the share session down and drop
        // the incoming file), so the button stays greyed until at least
        // one contact is ticked in the list.
        shareContentDisabled,

        // Location-share visual state.
        isSharingCurrentContact,
        locationSharePulse,

        // Send-audio disabled gate.
        recordingFile,

        // Handlers.
        onChat,
        onAudioCall,
        onVideoCall,
        onRecordAudio,
        onShareLocation,
        onDeleteAudio,
        onStopAudioPlayer,
        onCancelShareContent,
        onShowConferenceModal,
        onSendAudioFile,
        onShareContent,
        onToggleQRCodeScanner,
    } = props;

    if (!visible) {
        return null;
    }

    return (
        <View style={uriGroupClass}>

            {isFolded ?
            // On foldables, hide the whole call/action
            // button row (audio, video, mic, delete, share,
            // etc.) when on the cover display. The Back-to-
            // call branch (in ReadyBox) still runs when a call is in
            // progress, so nothing important is lost.
            null
            :

            <View style={[buttonGroupClass, {borderWidth: 0, borderColor: 'white'}]}>
                  {!selectedContact && !shareToContacts && !inviteContacts?
                  <View style={styles.buttonContainer}>
                      <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                        style={chatButtonDisabled ? disabledGreenButtonClass : greenButtonClass}
                        size={32}
                        disabled={chatButtonDisabled}
                        onPress={onChat}
                        icon="chat"
                    />
                    </TouchableHighlight>
                  </View>
                  : null }

                  {showCallButtons ?
                  <View style={styles.buttonContainer}>
                      <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                            style={callButtonDisabled ? disabledGreenButtonClass : greenButtonClass}
                            size={32}
                            disabled={callButtonDisabled}
                            onPress={onAudioCall}
                            icon="phone"
                        />
                    </TouchableHighlight>
                  </View>

                  : null }

                  {showCallButtons?
                  <View style={styles.buttonContainer}>
                      <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                            style={videoButtonDisabled ? disabledGreenButtonClass : greenButtonClass}
                            size={32}
                            disabled={videoButtonDisabled}
                            onPress={onVideoCall}
                            icon="video"
                        />
                    </TouchableHighlight>
                  </View>
                  : null }

                  {/* Recording-preview Play button moved
                      into the recording panel itself,
                      next to the slider/wave. The
                      action-bar position is hidden to
                      avoid duplication. */}


                  {showAudioRecordButton?
                  <View style={styles.buttonContainer}>
                      <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                        style={blueButtonClass}
                        size={32}
                        onPress={onRecordAudio}
                        icon={recordIcon}
                    />
                    </TouchableHighlight>
                  </View>
                  : null }

                  {/* "Share location" button — sits AFTER the
                      Record-audio button so the three comm
                      actions (Audio call, Video call, Record
                      audio) stay grouped, with the location
                      share as a distinct category on the
                      right. Purple fill further separates it
                      visually from the green call buttons and
                      the blue record button. Delegates to the
                      same NavigationBar toggle that the kebab
                      menu's "Share location..." item uses
                      (via the startLocationShare prop, wired
                      in app.js). Gated on the contact having
                      a PGP public key, because location
                      metadata ships encrypted with no
                      plaintext fallback. */}
                  {showLocationShareButton?
                  <View style={styles.buttonContainer}>
                      {/* While a share is live for the
                          currently-selected chat, swap the
                          purple pin for a red pulsing
                          map-marker-radius. That makes the
                          in-chat indicator unmistakable
                          (matching the NavBar one the user
                          sees from other screens) and lets
                          the tap drop them into the
                          Stop-sharing dialog via the same
                          pin handler. The Animated.View
                          wraps the button so the pulse
                          applies to the whole circle, not
                          just the glyph. */}
                      <TouchableHighlight style={styles.roundshape}>
                        <Animated.View style={isSharingCurrentContact ? { opacity: locationSharePulse } : null}>
                            <IconButton
                                style={isSharingCurrentContact ? [purpleButtonClass, { backgroundColor: 'rgba(220, 53, 69, 0.95)' }] : purpleButtonClass}
                                size={32}
                                // Paper v5 renamed the glyph-tint
                                // prop from `color` → `iconColor`;
                                // `color` is silently ignored, which
                                // is why the pin was still rendering
                                // in the default dark theme tint.
                                iconColor="white"
                                onPress={onShareLocation}
                                icon={isSharingCurrentContact ? "map-marker-radius" : "map-marker"}
                                accessibilityLabel={isSharingCurrentContact ? "Location sharing active — tap to stop" : "Share location"}
                            />
                        </Animated.View>
                    </TouchableHighlight>
                  </View>
                  : null }

                  {showAudioDeleteButton ?
                  <View style={styles.buttonContainer}>
                      <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                            style={redButtonClass}
                            size={32}
                            onPress={onDeleteAudio}
                            icon="cancel"
                        />
                    </TouchableHighlight>
                  </View>
                  : null }

                  {showAudioStopButton ?
                  <View style={styles.buttonContainer}>
                      <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                            style={redButtonClass}
                            size={32}
                            onPress={() => {
                                // Diagnostic: the "top Stop button" the user
                                // reports as unresponsive. Log the tap the
                                // instant it fires, before delegating to the
                                // parent handler — if this line appears but
                                // playback continues, the tap registered and
                                // the fault is downstream in onStopAudioPlayer.
                                try { utils.timestampedLog('[applog] [audio] [top-stop] tap'); } catch (_e) {}
                                onStopAudioPlayer();
                            }}
                            icon="pause"
                        />
                    </TouchableHighlight>
                  </View>
                  : null }


                  { shareToContacts ?
                  <View style={styles.buttonContainer}>
                      <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                            style={redButtonClass}
                            size={32}
                            onPress={onCancelShareContent}
                            icon="cancel"
                        />
                    </TouchableHighlight>
                  </View>
                  : null}

                  {showConferenceButton ?
                  <View style={styles.buttonContainer}>
                      <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                            style={conferenceButtonDisabled ? disabledBlueButtonClass : blueButtonClass}
                            disabled={conferenceButtonDisabled}
                            size={32}
                            onPress={onShowConferenceModal}
                            icon="account-group"
                        />
                    </TouchableHighlight>
                  </View>
                  : null }

                  {/* Invite-mode Cancel / Invite buttons used to
                      live HERE in the top action strip. They
                      were relocated to the right side of the
                      search bar (see the URIContainerClass
                      block in ReadyBox) so the action
                      pair sits adjacent to the picker input —
                      one row, one focus area, no jump-up-then-
                      look-back-down for the user. */}

                  {showAudioSendButton ?
                  <View style={styles.buttonContainer}>
                      <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                            style={blueButtonClass}
                            disabled={!recordingFile}
                            size={32}
                            onPress={onSendAudioFile}
                            icon="share"
                        />
                    </TouchableHighlight>
                  </View>
                  : null }

                  { shareToContacts ?
                  <View style={styles.buttonContainer}>
                      <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                            style={shareContentDisabled ? disabledBlueButtonClass : blueButtonClass}
                            disabled={shareContentDisabled}
                            size={32}
                            onPress={onShareContent}
                            icon="share"
                        />
                    </TouchableHighlight>
                  </View>
                  : null }

                  { showQRCodeButton ?
                  <View style={styles.buttonContainer}>
                      <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                            onPress={onToggleQRCodeScanner}
                            style={styles.qrCodeButton}
                            disabled={!showQRCodeButton}
                            size={32}
                            icon="qrcode"
                        />
                    </TouchableHighlight>
                  </View>
                  : null}
            </View>
            }

        </View>
    );
}

SessionButtonsBar.propTypes = {
    visible: PropTypes.bool,
    isFolded: PropTypes.bool,
    uriGroupClass: PropTypes.any,
    buttonGroupClass: PropTypes.any,
    styles: PropTypes.object.isRequired,

    selectedContact: PropTypes.object,
    shareToContacts: PropTypes.bool,
    inviteContacts: PropTypes.bool,

    greenButtonClass: PropTypes.any,
    disabledGreenButtonClass: PropTypes.any,
    blueButtonClass: PropTypes.any,
    disabledBlueButtonClass: PropTypes.any,
    redButtonClass: PropTypes.any,
    purpleButtonClass: PropTypes.any,
    recordIcon: PropTypes.string,

    showCallButtons: PropTypes.bool,
    showAudioRecordButton: PropTypes.bool,
    showLocationShareButton: PropTypes.bool,
    showAudioDeleteButton: PropTypes.bool,
    showAudioStopButton: PropTypes.bool,
    showConferenceButton: PropTypes.bool,
    showAudioSendButton: PropTypes.bool,
    showQRCodeButton: PropTypes.bool,

    chatButtonDisabled: PropTypes.bool,
    callButtonDisabled: PropTypes.bool,
    videoButtonDisabled: PropTypes.bool,
    conferenceButtonDisabled: PropTypes.bool,
    shareContentDisabled: PropTypes.bool,

    isSharingCurrentContact: PropTypes.bool,
    locationSharePulse: PropTypes.any,

    recordingFile: PropTypes.any,

    onChat: PropTypes.func,
    onAudioCall: PropTypes.func,
    onVideoCall: PropTypes.func,
    onRecordAudio: PropTypes.func,
    onShareLocation: PropTypes.func,
    onDeleteAudio: PropTypes.func,
    onStopAudioPlayer: PropTypes.func,
    onCancelShareContent: PropTypes.func,
    onShowConferenceModal: PropTypes.func,
    onSendAudioFile: PropTypes.func,
    onShareContent: PropTypes.func,
    onToggleQRCodeScanner: PropTypes.func,
};

export default SessionButtonsBar;
