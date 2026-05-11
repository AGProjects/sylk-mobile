import PropTypes from 'prop-types'
import React from 'react'
import autoBind from 'auto-bind';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'
import AudioRecorderPlayer from 'react-native-audio-recorder-player'
import {TouchableOpacity, View, Platform} from 'react-native'

import styles from '../assets/styles/ContactsListBox';

class CustomActions extends React.Component {
    constructor(props) {

        super(props);
        autoBind(this);

        this.state = {recording: false, texting: false, sendingImage: false}
        this.timer = null;
        this.ended = false;
    }

    componentWillUnmount() {
        this.ended = true;
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({texting: nextProps.texting,
                       sendingImage: nextProps.sendingImage
                       });
    }

    onActionsPress = () => {
        // While previewing an attached image, the left-action button
        // is the delete (discard preview) trigger.
        if (this.state.sendingImage) {
            if (this.props.deleteSharingAssets) {
                this.props.deleteSharingAssets();
            }
            return;
        }
        // While a recording is in progress (or paused with a
        // recordingFile waiting to be sent/deleted), the left button
        // shows pause / delete. Forward the tap to recordAudio, which
        // toggles those states (start / pause / discard).
        if (this.props.isAudioRecording || this.props.recordingFile) {
            this.props.recordAudio();
            return;
        }
        // Idle / empty composer state — the left button renders
        // nothing, so this branch shouldn't fire in practice. Guard
        // anyway so a stray tap on the empty slot doesn't kick off a
        // recording (the recording mic now lives on the right).
    }

    renderIcon () {
        // Image preview state: show a red trash icon so the user can
        // discard the attachment from the input toolbar instead of
        // hunting for it inside the bubble. The wrapping View is sized
        // to match the toolbar row and centers the icon — without
        // alignItems/justifyContent here the glyph rendered visually
        // low against the input field's baseline.
        if (this.state.sendingImage) {
            return (
                <View style={{alignItems: 'center', justifyContent: 'center'}}>
                    <Icon
                      type="font-awesome"
                      name="delete"
                      style={styles.chatAudioIcon}
                      size={22}
                      color="red"
                    />
                </View>
            );
        }

        if (this.state.texting || (this.props.selectedContact && this.props.selectedContact.tags.indexOf('test') > -1)) {
            return (<View></View>)
        }

        // The default green microphone used to live here. It has been
        // moved to the right side of the input bar (renderSend in
        // ContactsListBox) so the right button can swap between mic
        // (when the composer is empty) and send (when there's text),
        // matching WhatsApp's input pattern. The left button now only
        // surfaces mid-recording controls — pause while actively
        // recording, delete to discard a paused/finished take. When
        // neither recording state is active, the left side renders
        // nothing.
        if (!this.props.recordingFile && !this.props.isAudioRecording) {
            return (<View />);
        }

        let icon = this.props.recordingFile ? "delete" : "pause";
        let color = this.props.recordingFile ? "red" : "blue";

        return (
            <View style={{alignItems: 'center', justifyContent: 'center'}}>
				<Icon
				  type="font-awesome"
				  name={icon}
				  style={styles.chatAudioIcon}
				  size={20}
				  color={color}
				/>
             </View>
         )
      }

    render() {
        return (
          <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <TouchableOpacity
            style={[styles.chatLeftActionsContainer]}
            onPress={this.onActionsPress}
          >
            {this.renderIcon()}
          </TouchableOpacity>
          </View>
        )
    }
}

CustomActions.propTypes = {
	recordAudio: PropTypes.func,
	isAudioRecording: PropTypes.bool,
	recordingFile: PropTypes.string,
    texting: PropTypes.bool,
    sendingImage: PropTypes.bool,
    deleteSharingAssets: PropTypes.func,
    selectedContact: PropTypes.object
}

export default CustomActions;
