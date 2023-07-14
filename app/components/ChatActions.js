import PropTypes from 'prop-types'
import React from 'react'
import autoBind from 'auto-bind';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'
import AudioRecorderPlayer from 'react-native-audio-recorder-player'
import {TouchableOpacity, View, Platform} from 'react-native'
import styles from '../assets/styles/blink/_ContactsListBox.scss';
const RNFS = require('react-native-fs');
import AudioRecord from 'react-native-audio-record';

const options = {
    sampleRate: 16000,  // default 44100
    channels: 1,        // 1 or 2, default 1
    bitsPerSample: 16,  // 8 or 16, default 16
    audioSource: 6,     // android only (see below)
    wavFile: 'sylk-audio-recording.wav' // default 'audio.wav'
};

AudioRecord.init(options);

class CustomActions extends React.Component {
    constructor(props) {

        super(props);
        autoBind(this);

        this.state = {recording: false, texting: false, sendingImage: false}
        this.timer = null;
        this.audioRecorderPlayer = new AudioRecorderPlayer();
        this.ended = false;
    }

    componentWillUnmount() {
        this.ended = true;
        this.stopRecording();
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({texting: nextProps.texting,
                       playing: nextProps.playing,
                       audioSendFinished: nextProps.audioSendFinished,
                       sendingImage: nextProps.sendingImage
                       });
        if (nextProps.audioSendFinished) {
            this.deleteAudioRecording()
        }
    }

    onActionsPress = () => {
        if (this.state.audioRecording) {
            this.setState({audioRecording: false});
            this.props.audioRecorded(null);

            /*
            if (this.state.playing) {
                this.setState({playing: false});
                this.onStopPlay();
            } else {
                this.setState({playing: true});
                this.onStartPlay()
            }
            */
        } else {
            if (this.state.playing) {
                this.props.stopPlaying();
            } else if (!this.state.recording) {
                this.setState({recording: true});
                this.props.onRecording(true);
                console.log('Recording audio start');
                this.onStartRecord();
                this.timer = setTimeout(() => {
                    this.stopRecording();
                }, 20000);
            } else {
                this.stopRecording();
            }
        }
    }

    stopRecording() {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.setState({recording: false});
        this.props.onRecording(false);
        this.onStopRecord();
    }

    renderIcon () {
        let color = "green";
        let name = this.state.recording ? "pause" : "microphone";

        if (this.state.audioRecording) {
            name = "delete";
            color = "red"
        }

        if (this.state.texting || this.state.sendingImage || this.state.playing || (this.props.selectedContact && this.props.selectedContact.tags.indexOf('test') > -1)) {
            return (<View></View>)
        }

        return (
            <View>
                    <Icon
                      type="font-awesome"
                      name={name}
                      style={styles.chatAudioIcon}
                      size={20}
                      color={color}
                    />
             </View>
         )
      }

    deleteAudioRecording() {
        this.setState({audioRecording: null});
    }

    onStartRecord = async () => {
        AudioRecord.start();

        /* bellow code only works on Android
        let path = RNFS.DocumentDirectoryPath + "/" + 'sylk-audio-recording.mp4';
        const result = await this.audioRecorderPlayer.startRecorder(path);
        this.audioRecorderPlayer.addRecordBackListener((e) => {
            this.setState({
              recordSecs: e.currentPosition,
              recordTime: this.audioRecorderPlayer.mmssss(
                Math.floor(e.currentPosition),
              ),
            });
        });
        */
    };

    onStopRecord = async () => {
        if (this.ended) {
            return;
        }

        const result = await AudioRecord.stop();
        this.props.audioRecorded(result);
        this.setState({audioRecording: result});

        /* bellow code only works on Android

        const result = await this.audioRecorderPlayer.stopRecorder();
        this.audioRecorderPlayer.removeRecordBackListener();
        this.setState({recordSecs: 0});
        */

        this.props.audioRecorded(result);
    };

    async onStartPlay () {
        const msg = await this.audioRecorderPlayer.startPlayer();
        this.audioRecorderPlayer.addPlayBackListener((e) => {
            this.setState({
              currentPositionSec: e.currentPosition,
              currentDurationSec: e.duration,
              playTime: this.audioRecorderPlayer.mmssss(Math.floor(e.currentPosition)),
              duration: this.audioRecorderPlayer.mmssss(Math.floor(e.duration)),
            });
        });
    };

    onPausePlay = async () => {
        await this.audioRecorderPlayer.pausePlayer();
    };

    onStopPlay = async () => {
        console.log('onStopPlay');
        this.audioRecorderPlayer.stopPlayer();
        this.audioRecorderPlayer.removePlayBackListener();
        this.setState({playing: false});
    };

    render() {
        let chatLeftActionsContainer = Platform.OS === 'ios' ? styles.chatLeftActionsContaineriOS : styles.chatLeftActionsContainer;

        return (
          <View style={{flexDirection: 'row'}}>
          <TouchableOpacity
            style={[chatLeftActionsContainer]}
            onPress={this.onActionsPress}
          >
            {this.renderIcon()}
          </TouchableOpacity>
          </View>
        )
    }
}

CustomActions.propTypes = {
    audioRecorded: PropTypes.func,
    onRecording: PropTypes.func,
    stopPlaying: PropTypes.func,
    options: PropTypes.object,
    texting: PropTypes.bool,
    sendingImage: PropTypes.bool,
    audioSendFinished: PropTypes.bool,
    selectedContact: PropTypes.object
}

export default CustomActions;
