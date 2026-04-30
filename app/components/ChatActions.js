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
        // is the delete (discard preview) trigger. Otherwise it starts
        // an audio recording, like before.
        if (this.state.sendingImage) {
            if (this.props.deleteSharingAssets) {
                this.props.deleteSharingAssets();
            }
            return;
        }
        this.props.recordAudio();
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

        let icon = "microphone";
        let color = "green";

        if (this.props.recordingFile) {
			icon = "delete";
			color = "red";
        } else if (this.props.isAudioRecording) {
            icon = "pause";
			color = "blue";
        }

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
