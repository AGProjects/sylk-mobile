import React from 'react';
import { View, Text } from 'react-native';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import autoBind from 'auto-bind';
import { Appbar, Menu, Divider } from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';
import { Colors } from 'react-native-paper';
import SylkAppbarContent from './SylkAppbarContent';
import { Platform, Dimensions} from 'react-native';
import { initialWindowMetrics } from 'react-native-safe-area-context';

import styles from '../assets/styles/AudioCall';


function toTitleCase(str) {
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}


class CallOverlay extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            call: this.props.call,
            terminatedReason: this.props.terminatedReason,
            media: this.props.media ? this.props.media : 'audio',
            callState: this.props.call ? this.props.call.state : null,
            direction: this.props.call ? this.props.call.direction: null,
            startTime: this.props.callState ? this.props.callState.startTime : null,
            remoteUri: this.props.remoteUri,
            localMedia: this.props.localMedia,
            remoteDisplayName: this.props.remoteDisplayName,
            reconnectingCall: this.props.reconnectingCall,
            isLandscape: this.props.isLandscape,
            menuVisible: false,
            showUsage: false,
            enableMyVideo: this.props.enableMyVideo,
		    availableAudioDevices: this.props.availableAudioDevices,
			selectedAudioDevice: this.props.selectedAudioDevice
        }

        this.duration = null;
        this.finalDuration = null;
        this.timer = null;
        this._isMounted = true;
    }

    componentDidMount() {
        if (this.state.call) {
            if (this.state.call.state === 'established') {
                this.startTimer();
            }
            this.state.call.on('stateChanged', this.callStateChanged);
            this.setState({callState: this.state.call.state});
        }
    }

    componentWillUnmount() {
        this._isMounted = false;

        if (this.state.call) {
            this.state.call.removeListener('stateChanged', this.callStateChanged);
        }

        clearTimeout(this.timer);
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (!this._isMounted) {
            return;
        }

        if (nextProps.reconnectingCall != this.state.reconnectingCall) {
            this.setState({reconnectingCall: nextProps.reconnectingCall});
        }

        if (nextProps.call !== null && nextProps.call !== this.state.call) {
           console.log('Next call:', nextProps.call?.id);

            if (this.state.call !== null) {
			   console.log('Previous call', this.state.call?.id);
                this.state.call.removeListener('stateChanged', this.callStateChanged);
            }
            
            if (nextProps.call  !== null) {
				nextProps.call.on('stateChanged', this.callStateChanged);
            }

            this.setState({call: nextProps.call, 
                           direction: nextProps.call ? nextProps.call.direction : null});
        }

        if ('showUsage' in nextProps) {
			this.setState({showUsage: nextProps.showUsage});
        }

        this.setState({remoteDisplayName: nextProps.remoteDisplayName,
                       remoteUri: nextProps.remoteUri,
                       media: nextProps.media,
                       localMedia: nextProps.localMedia,
                       startTime: nextProps.callState ? nextProps.callState.startTime : null,
                       terminatedReason: nextProps.terminatedReason,
                       isLandscape: nextProps.isLandscape,
                       enableMyVideo: nextProps.enableMyVideo,
						availableAudioDevices: nextProps.availableAudioDevices,
						selectedAudioDevice: nextProps.selectedAudioDevice
                       });
    }

    callStateChanged(oldState, newState, data) {
        // console.log('callStateChanged', oldState, newState);
        if (newState === 'established' && this._isMounted) {
            this.startTimer();
        }

        if (newState === 'terminated') {
            if (this.state.call) {
                this.state.call.removeListener('stateChanged', this.callStateChanged);
            }

            clearTimeout(this.timer);
            this.finalDuration = this.duration;
            this.duration = null;
            this.timer = null;
        }

        if (newState === 'proceeding') {
            if (this.state.callState === 'ringing' || data.code === 110 || data.code === 180) {
                newState = 'ringing';
            }
        }

        if (!this._isMounted) {
            return;
        }

        this.setState({callState: newState});
    }

    handleMenu(event) {
        switch (event) {
            case 'hangup':
                this.props.hangupCall();
                break;
            case 'myVideo':
                this.props.toggleMyVideo();
                break;
			case 'toggleUsage':
				this.setState({showUsage: !this.state.showUsage});
                break;
            case 'swapVideo':
                this.props.swapVideo();
                break;
            default:
                break;
        }

        this.setState({menuVisible: false});
    }

    startTimer() {
        if (this.timer !== null) {
            // already armed
            return;
        }

        // TODO: consider using window.requestAnimationFrame

        this.timer = setInterval(() => {
            const duration = moment.duration(new Date() - this.state.startTime);
            if (this.duration > 3600) {
                this.duration = duration.format('hh:mm:ss', {trim: false});
            } else {
                this.duration = duration.format('mm:ss', {trim: false});
            }

            if (this.props.show) {
                this.forceUpdate();
            }
        }, 1000);
    }

    render() {
        let header = null;
        let displayName = this.state.remoteUri;

        if (this.state.remoteDisplayName && this.state.remoteDisplayName !== this.state.remoteUri) {
            displayName = this.state.remoteDisplayName;
        }

        if (this.props.show) {
            let callDetail = 'Contacting server...';

            if (this.duration) {
                callDetail = <View><Icon name="clock"/><Text>{this.duration}</Text></View>;
                callDetail = this.duration + 's';
            } else {
                if (this.state.reconnectingCall) {
                    callDetail = 'Reconnecting call...';
                } else if (this.state.callState === 'terminated') {
                    if (this.finalDuration) {
                        callDetail = 'Call ended after ' + this.finalDuration;
                    } else if (this.state.terminatedReason) {
                        callDetail = this.state.terminatedReason;
                    }
                } else if (this.state.callState === 'incoming') {
                    callDetail = 'Connecting...';
                } else if (this.state.callState === 'accepted') {
                    callDetail = 'Waiting for ' + this.state.media + '...';
                } else if (this.state.callState === 'progress') {
                    if (this.state.terminatedReason) {
                        callDetail = this.state.terminatedReason;
                    } else {
                        callDetail = "Call in progress..."
                    }
                } else if (this.state.callState === 'established') {
                    callDetail = 'Media established';
                } else if (this.state.callState) {
                    callDetail = toTitleCase(this.state.callState);
                } else if (!this.state.call) {
					callDetail = 'Making call...';
                } else if (!this.state.localMedia) {
                    if (this.state.terminatedReason) {
                        callDetail = this.state.terminatedReason;
                    } else {
                        callDetail = 'Getting local media...';
                    }
                }
            }

            //console.log(' --- render overlay', this.state.callState, this.state.call);
            if (this.props.info && this.state.showUsage) {
                callDetail = callDetail + ' ' + this.props.info;
            }

            let mediaLabel = 'Audio call';

            if (this.state.media) {
                mediaLabel = displayName;
            }
            
			const { width, height } = Dimensions.get('window');
	
			const topInset = initialWindowMetrics?.insets.top || 0;
			const bottomInset = initialWindowMetrics?.insets.bottom || 0;

			let myVideoTitle = this.state.enableMyVideo ? 'Hide mirror' : 'Show mirror';
			let myUsageTitle = this.state.showUsage ? 'Hide bandwidth' : 'Show bandwidth';
			
			//console.log(this.state.showUsage);

			let barContainer = {
				backgroundColor: 'rgba(34,34,34,.7)',
				marginLeft: this.state.isLandscape ? - bottomInset : 0,
				marginTop: 0,
				width: this.state.isLandscape ? width - bottomInset: width,
				height: 60,
			}
			
		   if (Platform.OS === 'ios') {
				 if (this.state.isLandscape) {
					 barContainer = {
						backgroundColor: 'rgba(34,34,34,.7)',
						height: 60,
						marginLeft: -topInset,
						width: width - topInset - bottomInset,
						height: this.props.height,
					}
				} else {
					barContainer = {
					  backgroundColor: 'rgba(34,34,34,.7)',
					  height: 60,
					  width: width,
					  marginTop: -topInset
					};
				}
			}
        
			header = (
				<Appbar.Header style={[barContainer]}
						dark={true}
						>
					<Appbar.BackAction onPress={() => {this.props.goBackFunc()}} />
					<SylkAppbarContent
						title={mediaLabel} subtitle={callDetail}
					/>

                <Menu
                    visible={this.state.menuVisible}
                    onDismiss={() => this.setState({menuVisible: !this.state.menuVisible})}
                    anchor={
                    <View style={{ marginLeft: 50}}>
                        <Appbar.Action
                            ref={this.menuRef}
                            color="white"
                            icon="menu"
                            onPress={() => this.setState({menuVisible: !this.state.menuVisible})}
                        />
                        </View>
                    }
                >
					{this.state.media === 'video' && (
					<>
                    <Menu.Item onPress={() => this.handleMenu('myVideo')} icon="video" title={myVideoTitle} />
                    <Menu.Item onPress={() => this.handleMenu('swapVideo')} icon="camera-switch" title={'Swap video'} />
                    <Menu.Item onPress={() => this.handleMenu('toggleUsage')} icon="network" title={myUsageTitle} />
					<Divider />
					</>
                    )}
                    <Menu.Item onPress={() => this.handleMenu('hangup')} icon="phone-hangup" title="Hangup"/>

					<Divider />
				
					<Menu
						visible={this.state.audioMenuVisible}
						onDismiss={() => this.setState({audioMenuVisible: false})}
						anchor={
							<Menu.Item
								title="Audio device"
								icon="volume-high"
								onPress={() => this.setState({audioMenuVisible: true})}
							/>
						}
					>
						{this.props.availableAudioDevices.map(device => {
							const isSelected = device === this.props.selectedAudioDevice;
				
							return (
								<Menu.Item
									key={device}
									title={
										isSelected
											? `✓ ${device}`        // show selected
											: device
									}
									onPress={() => {
										this.props.selectAudioDevice(device);
										this.setState({
											audioMenuVisible: false,
											menuVisible: false
										});
									}}
								/>
							);
						})}
					</Menu>

                </Menu>
                
				</Appbar.Header>
			);
        }
        return header;
    }
}

CallOverlay.propTypes = {
    show: PropTypes.bool.isRequired,
    remoteUri: PropTypes.string,
    localMedia: PropTypes.object,
    remoteDisplayName: PropTypes.string,
    call: PropTypes.object,
    connection: PropTypes.object,
    reconnectingCall: PropTypes.bool,
    terminatedReason : PropTypes.string,
    media: PropTypes.string,
    audioCodec: PropTypes.string,
    videoCodec: PropTypes.string,
    info: PropTypes.string,
    goBackFunc: PropTypes.func,
    callState : PropTypes.object,
    isLandscape: PropTypes.bool,
    toggleMyVideo: PropTypes.func,
    swapVideo: PropTypes.func,
    enableMyVideo: PropTypes.bool,
    hangupCall: PropTypes.func,
    availableAudioDevices : PropTypes.array,
    selectedAudioDevice : PropTypes.string,
    selectAudioDevice: PropTypes.func,
    useInCallManger: PropTypes.bool

};

export default CallOverlay;
