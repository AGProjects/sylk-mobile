import React, { useState, useEffect, useRef, Fragment, Component } from 'react';
import { View } from 'react-native';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import moment from 'moment';
import { StyleSheet } from 'react-native';
import { Platform, Dimensions} from 'react-native';
import momentFormat from 'moment-duration-format';
import { Text, Appbar, Menu, Divider } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import utils from '../utils';

const styles = StyleSheet.create({
  container: {
    position: 'absolute', // float above video
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,         // ensures it's on top
  },
});


class ConferenceHeader extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            call: this.props.call,
            displayName: this.props.callContact ? this.props.callContact.name : this.props.remoteUri,
            callState: this.props.call ? this.props.call.state : null,
            participants: this.props.participants,
            startTime: this.props.callState ? this.props.callState.startTime : null,
            reconnectingCall: this.props.reconnectingCall,
            info: this.props.info,
            remoteUri: this.props.remoteUri,
            menuVisible: false,
            audioMenuVisible: false,
            chatView: this.props.chatView,
            audioView: this.props.audioView,
            isLandscape: this.props.isLandscape,
            visible:  this.props.visible,
            audioOnly: this.props.audioOnly,
            enableMyVideo: this.props.enableMyVideo,
			availableAudioDevices : this.props.availableAudioDevices,
			selectedAudioDevice: this.props.selectedAudioDevice,
			insets: this.props.insets
        }

        this.duration = null;
        this.timer = null;
        this._isMounted = false;
        this.menuRef = React.createRef();
    }

    componentDidMount() {
        this._isMounted = true;

        if (!this.state.call) {
            return;
        }

        if (this.state.call.state === 'established') {
            this.startTimer();
        }
        this.state.call.on('stateChanged', this.callStateChanged);
        this.setState({callState: this.state.call.state});
    }

    startTimer() {
        if (this.timer !== null) {
            // already armed
            return;
        }

        // TODO: consider using window.requestAnimationFrame
        const startTime = this.state.startTime || new Date();
        this.timer = setInterval(() => {
            const duration = moment.duration(new Date() - startTime);

            if (this.duration > 3600) {
                this.duration = duration.format('hh:mm:ss', {trim: false});
            } else {
                this.duration = duration.format('mm:ss', {trim: false});
            }
        }, 1000);
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
            nextProps.call.on('stateChanged', this.callStateChanged);

            if (this.state.call !== null) {
                this.state.call.removeListener('stateChanged', this.callStateChanged);
            }

            this.setState({call: nextProps.call});
        }

        this.setState({info: nextProps.info,
                       remoteUri: nextProps.remoteUri,
                       displayName: nextProps.callContact ? nextProps.callContact.name : nextProps.remoteUri,
                       startTime: nextProps.callState ? nextProps.callState.startTime : null,
                       chatView: nextProps.chatView,
                       audioView: nextProps.audioView,
                       isLandscape: nextProps.isLandscape,
                       visible: nextProps.visible,
                       audioOnly: nextProps.audioOnly,
                       enableMyVideo: nextProps.enableMyVideo,
                       participants: nextProps.participants,
					   availableAudioDevices: nextProps.availableAudioDevices,
					   selectedAudioDevice: nextProps.selectedAudioDevice,
					   insets: nextProps.insets
					   });
    }

    callStateChanged(oldState, newState, data) {
        if (newState === 'established' && this._isMounted && !this.props.terminated) {
            this.startTimer();
        }

        if (newState === 'terminated') {
            if (this.state.call) {
                this.state.call.removeListener('stateChanged', this.callStateChanged);
            }

            clearTimeout(this.timer);
            this.duration = null;
            this.timer = null;
        }

        if (!this._isMounted) {
            return;
        }

        this.setState({callState: newState});
    }

    goBack() {
       this.props.goBackFunc();
    }

    hangUp() {
        console.log('Hangup');
        this.props.hangUpFunc();
    }

    handleMenu(event) {
        //console.log('handleMenu', event);
        switch (event) {
            case 'back':
                this.goBack();
                break;
            case 'invite':
                this.props.inviteToConferenceFunc();
                break;
            case 'hangup':
                this.hangUp();
                break;
            case 'chat':
                this.props.toggleChatFunc();
                break;
            case 'speakers':
                this.props.toggleDrawer();
                break;
            case 'share':
                this.props.toggleInviteModal();
                break;
            case 'myVideo':
                this.props.toggleMyVideo();
                break;
            default:
                break;
        }

        this.setState({menuVisible: false});
    }

    render() {
        //console.log('render conf header lanscape =', this.state.isLandscape);
        
        if (!this.state.visible) {
			return (null);
        }

        let videoHeader;
        let callButtons;

        if (this.props.terminated) {
            clearTimeout(this.timer);
            this.duration = null;
            this.timer = null;
        }

        const room = this.state.remoteUri.split('@')[0];
        let displayName = (this.state.displayName && this.state.displayName !== this.state.remoteUri) ? this.state.displayName : room;
        let callDetail = '';
        
        displayName = 'Room ' + displayName;

        if (this.state.reconnectingCall) {
            callDetail = 'Reconnecting call...';
        } else if (this.state.terminated) {
            callDetail = 'Conference ended';
        } else if (this.duration) {
            callDetail = this.duration;
            if (this.state.participants > 0) {
                var participants = this.state.participants + 1;
                callDetail = callDetail +  ' - ' + participants + ' participant' + (participants > 1 ? 's' : '');
            } else {
                callDetail = callDetail + ' and nobody joined yet';
            }
        } else {
			callDetail = 'Nobody joined yet';
        }

        if (this.state.info && callDetail) {
            //callDetail = callDetail + ' - ' + this.state.info;
        }

        let myVideoTitle = this.state.enableMyVideo ? 'Hide mirror' : 'Show mirror';
        
		const { width, height } = Dimensions.get('window');
		const topInset = this.state.insets.top || 0;
		const bottomInset = this.state.insets.bottom || 0;
		const rightInset = this.state.insets.right || 0;

        let chatTitle = this.state.chatView ? 'Hide chat' : 'Show chat';

		const navBarWidth = this.state.isLandscape ? width - rightInset : width;
		const marginLeft = this.state.isLandscape ? -rightInset : 0;
		
/*
				<Appbar.Action color="white" onPress={() => this.handleMenu('invite')} icon="account-plus" />
				<Appbar.Action color="white" onPress={() => this.handleMenu('share')} icon="share-variant" />
*/

        let barContainer = {
				backgroundColor: 'rgba(34,34,34,.7)',
				marginLeft: marginLeft,
				marginTop: -topInset,
				width: navBarWidth,
				borderColor: 'red',
				borderWidth: 0,
				height: this.props.height,
		}
        
        return (
			<Appbar.Header
			  style={[barContainer]}
			  dark={true}
			>
			  <Appbar.BackAction onPress={this.goBack} color="white" />
			
			  {/* Title + Subtitle */}
			  <View style={{ flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
				<Text style={{ fontSize: 18, fontWeight: 'bold', color: 'white' }}>
				  {displayName}
				</Text>
				<Text style={{ fontSize: 14, color: 'white' }}>
				  {callDetail}
				</Text>
			  </View>
			
			  {/* Right-aligned buttons */}
			  <View style={{ flexDirection: 'row', alignItems: 'center'}}>
				{this.state.isLandscape &&
				  this.props.buttons.bottom?.map((btn, idx) => (
					<View key={idx} style={{ marginLeft: 8 }}>
					  {btn}
					</View>
				  ))
				}

				{this.props.buttons.additional}

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
                    <Menu.Item onPress={() => this.handleMenu('invite')} icon="account-plus" title="Invite participants..." />
                    <Menu.Item onPress={() => this.handleMenu('share')} icon="share-variant" title="Share web link..." />
                    {this.state.participants > 1 && !this.state.audioOnly?
                    <Menu.Item onPress={() => this.handleMenu('speakers')} icon="account-tie" title="Select speakers..." />
                    : null}
                    {!this.props.audioOnly && this.props.participants > 0?
                    <Menu.Item onPress={() => this.handleMenu('myVideo')} icon="video" title={myVideoTitle} />
                    : null}
                    
					<Divider />

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
							const deviceTitle = utils.availableAudioDeviceNames[device] || device;
				
							return (
								<Menu.Item
									key={device}
									title={
										isSelected
											? `✓ ${deviceTitle}`        // show selected
											: deviceTitle
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

			  </View>
			</Appbar.Header>
			);
		}
	}


ConferenceHeader.propTypes = {
    visible: PropTypes.bool,
    height: PropTypes.number,
    remoteUri: PropTypes.string.isRequired,
    call: PropTypes.object,
    isTablet: PropTypes.bool,
    isLandscape: PropTypes.bool,
    participants: PropTypes.number,
    buttons: PropTypes.object.isRequired,
    reconnectingCall: PropTypes.bool,
    audioOnly: PropTypes.bool,
    terminated: PropTypes.bool,
    info: PropTypes.string,
    callContact: PropTypes.object,
    toggleChatFunc: PropTypes.func,
    toggleAudioParticipantsFunc: PropTypes.func,
    goBackFunc: PropTypes.func,
    hangUpFunc: PropTypes.func,
    toggleInviteModal: PropTypes.func,
    inviteToConferenceFunc: PropTypes.func,
    audioView: PropTypes.bool,
    chatView: PropTypes.bool,
    callState: PropTypes.object,
    toggleDrawer: PropTypes.func,
    enableMyVideo: PropTypes.bool,    
    toggleMyVideo: PropTypes.func,
    availableAudioDevices: PropTypes.array,
    selectedAudioDevice: PropTypes.string,
    selectAudioDevice: PropTypes.func,
    insets: PropTypes.object
};

export default ConferenceHeader;

