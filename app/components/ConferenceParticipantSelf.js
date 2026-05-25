import React, { Component } from 'react';
import { View, Platform, Text } from   'react-native';
import PropTypes from 'prop-types';
//const hark              = require('hark');
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';
import { RTCView } from 'react-native-webrtc';
import { Surface } from 'react-native-paper';
import LinearGradient from 'react-native-linear-gradient';
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
        
        // Previously this applied translateX: -48 on Android landscape, a
        // magic-number hack to nudge the self-view thumbnail. It was
        // matched only by the old asymmetric corner math in ConferenceBox
        // (left: aRightInset / right: -aRightInset) and only cancelled
        // correctly when rightInset happened to equal 48. With corners
        // now symmetric at 0/0 and the PIP container extended to the
        // screen edges on Android landscape, the shift just pushes every
        // thumbnail 48px to the left of where it belongs.
        let shiftX = 0;
        let shiftY = this.state.isLandscape ? 0 : 0;
        
		// Conditional style: top-right in portrait, shifted in landscape
		
        let container = this.props.big ? styles.containerBig : styles.container;
        //console.log('container', container, shiftX, shiftY);
        
        return (
            <Surface style={[container,  { transform: [{ translateX: shiftX}, { translateY: shiftY }]}]}>
                {muteIcon}
                <RTCView objectFit={this.props.aspectRatio || 'cover'}
                         style={styles.video}
                         ref="videoElement"
                         poster="assets/images/transparent-1px.png"
                         streamURL={this.props.stream ? this.props.stream.toURL() : null}
                         mirror={(this.props.cameraFacing || 'front') !== 'back'}/>
                {/* Bottom-edge "Myself" label, matching the gradient
                    name strip rendered on remote tiles by
                    ConferenceMatrixParticipant — so the user sees
                    their own tile labelled consistently with the
                    others when self appears in the matrix
                    (visibleCount 1 / 3). Same fade gradient and
                    typography; the static "Myself" text is enough
                    since the user's own identity is obvious. */}
                <LinearGradient
                    start={{ x: 0, y: 0.55 }}
                    end={{ x: 0, y: 1 }}
                    colors={['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, .5)']}
                    style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: 0,
                        // iOS in fullscreen mode (both portrait and
                        // landscape): shift the "Myself" label 20 dp
                        // further to the right so it clears the
                        // phone's bottom-left rounded corner
                        // (iPhone X+). In portrait the round corner
                        // sits at the bottom-left; in landscape the
                        // bottom-left corner is also rounded
                        // (different orientation, same physical
                        // glass). Other surfaces handle the safe-
                        // area inset themselves; in fullscreen there
                        // is no SafeAreaView padding and the label
                        // would otherwise ride under the rounded
                        // corner.
                        paddingLeft: (Platform.OS === 'ios'
                            && this.props.fullScreen) ? 32 : 12,
                        paddingBottom: 10,
                        paddingTop: 24,
                    }}
                    pointerEvents="none"
                >
                    <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={{ color: '#ffffff', fontSize: 14, fontWeight: '600' }}
                    >
                        Myself
                    </Text>
                </LinearGradient>
            </Surface>
        );
    }
}

ConferenceParticipantSelf.propTypes = {
    visible: PropTypes.bool,
    stream: PropTypes.object,
    identity: PropTypes.object.isRequired,
    audioMuted: PropTypes.bool.isRequired,
    generatedVideoTrack: PropTypes.bool,
    isLandscape: PropTypes.bool,
    big: PropTypes.bool,
    cameraFacing: PropTypes.string,
    // True when the conference is in fullscreen mode (navbar hidden,
    // self-view fills the screen). Used to shift the "Myself" label
    // away from the bottom-left phone corner on iOS portrait.
    fullScreen: PropTypes.bool
};

export default ConferenceParticipantSelf;
