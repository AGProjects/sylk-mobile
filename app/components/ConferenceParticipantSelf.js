import React, { Component } from 'react';
import { View, Platform } from   'react-native';
import PropTypes from 'prop-types';
//const hark              = require('hark');
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';
import { RTCView } from 'react-native-webrtc';
import { Surface } from 'react-native-paper';
import { StyleSheet } from 'react-native';
import { Tooltip } from 'react-native-elements';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: 120,
    height: 90,
    elevation: 5,
    borderWidth: 0,
	zIndex: 1000,

  },

  containerBig: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderWidth: 0,
    borderColor: 'orange',
	zIndex: 1000,
  },

  video: {
    width: '100%',
    height: '100%',
  },

  muteIcon: {
    position: 'absolute',
    top: 30,
    width: '100%',
    zIndex: 2,
  },

  icon: {
    marginLeft: 'auto',
    marginRight: 'auto',
  },
});

class ConferenceParticipantSelf extends Component {
    constructor(props) {
        super(props);
        this.state = {
            active: false,
            hasVideo: false,
            sharesScreen: false,
            isLandscape: props.isLandscape,
            visible: props.visible
        }
        // this.speechEvents = null;
    }

    componentDidMount() {
        // factor it out to a function to avoid lint warning about calling setState here
        this.attachSpeechEvents();
        // this.refs.videoElement.onresize = (event) => {
        //     this.handleResize(event)
        // };
    }

    handleResize(event) {
        const resolutions = [ '1280x720', '960x540', '640x480', '640x360', '480x270','320x180'];
        const videoResolution = event.target.videoWidth + 'x' + event.target.videoHeight;
        if (resolutions.indexOf(videoResolution) === -1) {
            this.setState({sharesScreen: true});
        } else {
            this.setState({sharesScreen: false});
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
		this.setState({isLandscape: nextProps.isLandscape,
		               hasVideo: nextProps.hasVideo,
		               active: nextProps.active,
		               visible: nextProps.visible
		});
    }


    componentWillUnmount() {
        // if (this.speechEvents !== null) {
        //     this.speechEvents.stop();
        //     this.speechEvents = null;
        // }
    }

    attachSpeechEvents() {
        this.setState({hasVideo: this.props.stream.getVideoTracks().length > 0});

        // const options = {
        //     interval: 150,
        //     play: false
        // };
        // this.speechEvents = hark(this.props.stream, options);
        // this.speechEvents.on('speaking', () => {
        //     this.setState({active: true});
        // });
        // this.speechEvents.on('stopped_speaking', () => {
        //     this.setState({active: false});
        // });
    }

    render() {
        if (!this.state.visible)  {
			return;
        }
        
        if (this.props.stream == null) {
            return;
        }

        /*
        const tooltip = (
             <Tooltip id="t-myself">{this.props.identity.displayName || this.props.identity.uri}</Tooltip>
        );
        */
        
        let muteIcon
        if (this.props.audioMuted) {
            muteIcon = (
                <View style={styles.muteIcon}>
                    <Icon name="microphone-off" size={30} color="#fff" style={styles.icon}/>
                </View>
            );
        }
        
        let shiftX = this.state.isLandscape && Platform.OS === 'android' ? -48 : 0;
        let shiftY = this.state.isLandscape ? 0 : 0;
        
		// Conditional style: top-right in portrait, shifted in landscape
		
        let container = this.props.big ? styles.containerBig : styles.container;
        //console.log('container', container, shiftX, shiftY);
        
        return (
            <Surface style={[container,  { transform: [{ translateX: shiftX}, { translateY: shiftY }]}]}>
                {muteIcon}
                <RTCView objectFit="cover" 
                         style={styles.video} 
                         ref="videoElement" 
                         poster="assets/images/transparent-1px.png" 
                         streamURL={this.props.stream ? this.props.stream.toURL() : null} 
                         mirror={true}/>
            </Surface>
        );
    }
}

ConferenceParticipantSelf.propTypes = {
    visible: PropTypes.bool,
    stream: PropTypes.object.isRequired,
    identity: PropTypes.object.isRequired,
    audioMuted: PropTypes.bool.isRequired,
    generatedVideoTrack: PropTypes.bool,
    isLandscape: PropTypes.bool,
    big: PropTypes.bool
};

export default ConferenceParticipantSelf;
