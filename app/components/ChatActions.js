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
		this.props.recordAudio();
    }

    renderIcon () {
        if (this.state.texting || this.state.sendingImage || (this.props.selectedContact && this.props.selectedContact.tags.indexOf('test') > -1)) {
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
            <View>
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
    selectedContact: PropTypes.object
}

export default CustomActions;
