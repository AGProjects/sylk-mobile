import React, { useState, useEffect, useRef, Fragment, Component } from 'react';
import { View } from 'react-native';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import moment from 'moment';

import momentFormat from 'moment-duration-format';
import { Text, Appbar, Menu } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import styles from '../assets/styles/blink/_ConferenceHeader.scss';


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
            menuVisible: true
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

            if (this.props.show) {
                this.forceUpdate();
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
                       participants: nextProps.participants});
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

    handleMenu(event) {
        console.log('handle conference Menu', event);
        switch (event) {
            case 'back':
                this.goBack();
                break;
            case 'invite':
                this.props.inviteToConferenceFunc();
                break;
            case 'share':
                this.props.toggleInviteModal();
                break;
            default:
                break;
        }
        this.setState({menuVisible: false});
    }

    render() {

        //console.log('render conf header lanscape =', this.props.isLandscape);

        let videoHeader;
        let callButtons;

        if (this.props.terminated) {
            clearTimeout(this.timer);
            this.duration = null;
            this.timer = null;
        }

        const room = this.state.remoteUri.split('@')[0];
        let displayName = (this.state.displayName && this.state.displayName !== this.state.remoteUri) ? this.state.displayName : room;
        let callDetail;

        if (this.state.reconnectingCall) {
            callDetail = 'Reconnecting call...';
        } else if (this.state.terminated) {
            callDetail = 'Conference ended';
        } else if (this.duration) {
            callDetail = (this.props.isTablet ? 'Duration: ' : '') + this.duration;
            if (this.state.participants > 0) {
                var participants = this.state.participants + 1;
                callDetail = callDetail +  ' - ' + participants + ' participant' + (participants > 1 ? 's' : '');
            } else {
                callDetail = callDetail + ' and nobody joined yet';
            }
        }

        if (this.state.info) {
            callDetail = callDetail + ' - ' + this.state.info;
        }

        return (
        <View style={styles.container}>
            <Appbar.Header style={{backgroundColor: 'rgba(34,34,34,.7)'}}>
                <Appbar.BackAction onPress={() => {this.goBack()}} />
                 <Appbar.Content
                    title={displayName}
                    subtitle={callDetail}
                />
                {this.props.buttons.additional}

            </Appbar.Header>
            {this.props.buttons.bottom}
        </View>
        );
    }
}
/*

            <Menu
                visible={this.state.menuVisible}
                onDismiss={() => this.setState({menuVisible: !this.state.menuVisible})}
                anchor={
                    <Appbar.Action
                        ref={this.menuRef}
                        color="white"
                        icon="account-plus"
                        onPress={() => this.setState({menuVisible: !this.state.menuVisible})}
                    />
                }
            >
                <Menu.Item onPress={() => this.handleMenu('back')} title="Go back..."/>
                <Menu.Item onPress={() => this.handleMenu('invite')} icon="account-plus" title="Invite contacts"/>
                <Menu.Item onPress={() => this.handleMenu('share')} icon="share-variant" title="Share link..." />
            </Menu>
*/

ConferenceHeader.propTypes = {
    show: PropTypes.bool.isRequired,
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
    goBackFunc: PropTypes.func,
    toggleInviteModal: PropTypes.func,
    inviteToConferenceFunc: PropTypes.func,
    callState: PropTypes.object
};


export default ConferenceHeader;
