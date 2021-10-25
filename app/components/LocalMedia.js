import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, Dimensions, TouchableHighlight } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { IconButton, Button, Text} from 'react-native-paper';

import CallOverlay from './CallOverlay';
import styles from '../assets/styles/blink/_LocalMedia.scss';


class LocalMedia extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.localVideo = React.createRef();

        this.state = {
            localMedia: this.props.localMedia,
            historyEntry: this.props.historyEntry,
            participants: this.props.participants,
            reconnectingCall: this.props.reconnectingCall,
            declineReason: this.props.declineReason
        };

    }

    componentDidMount() {
        this.props.mediaPlaying();
    }

    //getDerivedStateFromProps(nextProps, state)
    UNSAFE_componentWillReceiveProps(nextProps) {
/*
        if (nextProps.localMedia && nextProps.localMedia !== this.state.localMedia) {
            this.props.mediaPlaying();
        }
*/

        this.setState({historyEntry: nextProps.historyEntry,
                      participants: nextProps.participants,
                      reconnectingCall: nextProps.reconnectingCall,
                      declineReason: nextProps.declineReason});
    }

    saveConference(event) {
        event.preventDefault();
        this.props.saveConference();
    }

    showSaveDialog() {
        if (!this.props.showSaveDialog) {
            return false;
        }

        return this.props.showSaveDialog();
    }

    hangupCall(event) {
        event.preventDefault();
        this.props.hangupCall('user_hangup_conference_confirmed');
    }

    render() {

        let {height, width} = Dimensions.get('window');
        let videoStyle = {
            height,
            width
        };

        const streamUrl = this.props.localMedia ? this.props.localMedia.toURL() : null;
        const buttonSize = this.props.isTablet ? 40 : 34;
        const buttonContainerClass = this.props.isTablet ? styles.tabletButtonContainer : styles.buttonContainer;

        return (
            <Fragment>
                <CallOverlay
                    show = {true}
                    remoteUri={this.props.remoteUri}
                    remoteDisplayName={this.props.remoteDisplayName}
                    call = {this.props.call}
                    connection={this.props.connection}
                    reconnectingCall={this.state.reconnectingCall}
                    media={this.props.media}
                    declineReason={this.state.declineReason}
                    goBackFunc={this.props.goBackFunc}
                />

                {this.showSaveDialog() ?
                    <View style={styles.buttonContainer}>

                    <Text style={styles.title}>Save conference maybe?</Text>
                    <Text style={styles.subtitle}>Would you like to save participants {this.state.participants.toString().replace(/,/g, ', ')} for having another conference later?</Text>
                    <Text style={styles.description}>You can find later it in your Favorites. </Text>

                    <View style={styles.buttonRow}>

                    <Button
                        mode="contained"
                        style={styles.savebutton}
                        onPress={this.saveConference}
                        icon="content-save"
                    >Save</Button>

                    <Button
                        mode="contained"
                        style={styles.backbutton}
                        onPress={this.hangupCall}
                        icon=""
                    > Back</Button>
                    </View>
                    </View>
                :
                <View style={buttonContainerClass}>
                          <TouchableHighlight style={styles.roundshape}>
                        <IconButton
                            size={buttonSize}
                            style={styles.hangupbutton}
                            icon="phone-hangup"
                            onPress={this.hangupCall}
                        />
                        </TouchableHighlight>
                </View>
                }
                <View style={styles.container}>
                    <RTCView objectFit="cover"
                             style={[styles.video, videoStyle]}
                             id="localVideo"
                             ref={this.localVideo}
                             streamURL={streamUrl}
                             mirror={true}
                             />
                </View>
            </Fragment>
        );
    }
}

LocalMedia.propTypes = {
    call                : PropTypes.object,
    remoteUri           : PropTypes.string,
    remoteDisplayName   : PropTypes.string,
    localMedia          : PropTypes.object.isRequired,
    mediaPlaying        : PropTypes.func.isRequired,
    hangupCall          : PropTypes.func,
    showSaveDialog      : PropTypes.func,
    saveConference      : PropTypes.func,
    reconnectingCall    : PropTypes.bool,
    connection          : PropTypes.object,
    participants        : PropTypes.array,
    media               : PropTypes.string,
    declineReason       : PropTypes.string,
    showLogs            : PropTypes.func,
    goBackFunc          : PropTypes.func

};


export default LocalMedia;
