import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import debug from 'react-native-debug';
import { View } from 'react-native';
import { Text, IconButton, List, Appbar } from 'react-native-paper';
import autoBind from 'auto-bind';
import { RTCView } from 'react-native-webrtc';

import ConferenceDrawer from './ConferenceDrawer';
import VolumeBar from './VolumeBar';

import styles from '../assets/styles/blink/_Preview.scss';

const DEBUG = debug('blinkrtc:Preview');
debug.enable('*');

class Preview extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        let mic = { label: 'No microphone' };
        let camera = { label: 'No camera' };

        if ('camera' in this.props.selectedDevices) {
            camera = this.props.selectedDevices.camera;
        } else if (this.props.localMedia.getVideoTracks().length !== 0) {
            camera.label = camera.facing === 'environment' ? 'Back camera': 'Front camera';
        }

        if ('mic' in this.props.selectedDevices) {
            mic = this.props.selectedDevices.mic;
        } else if (this.props.localMedia.getAudioTracks().length !== 0) {
            mic.label = this.props.localMedia.getAudioTracks()[0].label;
        }

        this.state = {
            camera: camera,
            showDrawer: false,
            mic: mic,
            streamURL: null
        }
        this.devices = [];
        this.localVideo = React.createRef();
    }

    componentDidMount() {

        this.setState({streamURL: this.props.localMedia});

        navigator.mediaDevices.enumerateDevices()
            .then((devices) => {
                this.devices = devices;
                let newState = {};

                newState.camera = {label: 'No camera'};

                devices.forEach((device) => {
                    if (device.kind === 'videoinput') {
                        let label = device.facing === 'environment' ? 'Back camera': 'Front camera';
                        newState.camera = {label: label};
                    }
                });

                if (this.state.mic.label !== 'No microphone') {
                    if (!devices.find((device) => {return device.kind === 'audioinput'})) {
                        newState.mic = {label: 'No microphone'};
                    } else if (this.props.localMedia.getAudioTracks().length !== 0) {
                        newState.mic = { label: this.props.localMedia.getAudioTracks()[0].label};
                    }
                }

                if (Object.keys(newState).length != 0) {
                    this.setState(Object.assign({},newState));
                }

            })
            .catch(function(error) {
                DEBUG('Device enumeration failed: %o', error);
            });

    }

    componentWillReceiveProps(nextProps) {
        if (nextProps.localMedia !== this.props.localMedia) {
            this.setState({streamURL: nextProps.localMedia})
        }

        if (nextProps.selectedDevices !== this.props.selectedDevices) {
            let camera = {label: 'No camera'};
            let mic = {label: 'No microphone'};
            if ('camera' in nextProps.selectedDevices) {
                camera = nextProps.selectedDevices.camera;
                camera.label = camera.facing === 'environment' ? 'Back camera': 'Front camera';
            }

            if ('mic' in nextProps.selectedDevices) {
                mic = nextProps.selectedDevices.mic;
            }
            this.setState({ camera, mic });
        }
    }

    setDevice = (device) => (e) => {
        e.preventDefault();
        if (device.label !== this.state.mic.label && device.label !== this.state.camera.label) {
            this.props.setDevice(device);
        }
        this.setState({showDrawer: false});
    }

    hangupCall(event) {
        event.preventDefault();
        this.props.hangupCall(null, 'stop_preview');
    }

    toggleDrawer() {
        this.setState({showDrawer: !this.state.showDrawer});
    }

    render() {
        let cameras = [];
        let mics = [];

        this.devices.forEach((device) => {
            if (device.kind === 'videoinput') {
                device.label = device.facing === 'environment' ? 'Back camera': 'Front camera';
                cameras.push(
                    <List.Item key={device.deviceId} onPress={this.setDevice(device)} title={device.label} />
                );
            } else if (device.kind === 'audioinput') {
                mics.push(
                    <List.Item key={device.deviceId} onPress={this.setDevice(device)} title={device.label} />
                );
            }
        });

        let header = null;
        if (this.state.camera !== '') {
            header = (
                <Fragment>
                    <Appbar.Header style={{backgroundColor: 'black'}}>
                        <Appbar.Content
                            title="Video preview"
                            subtitle={this.state.camera.label}
                        />
                        { !this.state.showDrawer ?
                            <Appbar.Action icon="menu" onPress={this.toggleDrawer} />
                        : null }
                    </Appbar.Header>
                    <VolumeBar localMedia={this.props.localMedia} />
                </Fragment>
            );
        }

        let drawercontent = (
            <View>
                <List.Section>
                    <List.Subheader style={styles.subheader}>Video cameras</List.Subheader>
                    {cameras}
                </List.Section>
                <List.Section>
                    <List.Subheader style={styles.subheader}>Audio inputs</List.Subheader>
                    {mics}
                </List.Section>
            </View>
        );

        return (
            <View style={styles.container}>
                {header}
                <View style={styles.buttonContainer}>
                    <IconButton style={styles.button} color="white" onPress={this.hangupCall} icon="power" size={34} />
                </View>
                <View style={styles.videoContainer}>
                    <RTCView objectFit="cover" style={styles.video} streamURL={this.state.streamURL ? this.state.streamURL.toURL() : null} mirror={true}/>
                </View>
                <ConferenceDrawer show={this.state.showDrawer} close={this.toggleDrawer}>
                    {drawercontent}
                </ConferenceDrawer>
            </View>
        );
    }
}

Preview.propTypes = {
    hangupCall: PropTypes.func,
    localMedia: PropTypes.object.isRequired,
    setDevice: PropTypes.func.isRequired,
    selectedDevices: PropTypes.object.isRequired
};

export default Preview;
