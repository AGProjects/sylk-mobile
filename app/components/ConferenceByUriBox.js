import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import autoBind from 'auto-bind';
import { View } from 'react-native';
import { Title, Button, TextInput } from 'react-native-paper';

import Conference from './Conference';

class ConferenceByUriBox extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            displayName: ''
        };

        this._notificationCenter = null;
    }

    componentDidMount() {
        this._notificationCenter = this.props.notificationCenter();
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (!this.props.currentCall && nextProps.currentCall) {
            nextProps.currentCall.on('stateChanged', this.callStateChanged);
        }
    }

    callStateChanged(oldState, newState, data) {
        if (newState === 'terminated') {
            this._notificationCenter.postSystemNotification('Thanks for calling with Sylk!');
        }
    }

    handleDisplayNameChange(event) {
        this.setState({displayName: event.target.value});
    }

    handleSubmit(event) {
        event.preventDefault();
        let displayName;
        if (this.state.displayName === '') {
            this.setState({displayName: 'Guest'});
            displayName = 'Guest';
        } else {
            displayName = this.state.displayName;
            // Bug in SIPSIMPLE, display name can't end with \ else we don't join chat
            if (displayName.endsWith('\\')) {
                displayName = displayName.slice(0, -1);
            }
        }
        this.props.handler(displayName, this.props.targetUri);
    }

    render() {
        let content;

        if (this.props.localMedia !== null) {
            content = (
                <Conference
                    notificationCenter = {this.props.notificationCenter}
                    localMedia = {this.props.localMedia}
                    account = {this.props.account}
                    currentCall = {this.props.currentCall}
                    targetUri = {this.props.targetUri}
                    hangupCall = {this.props.hangupCall}
                    shareScreen = {this.props.shareScreen}
                    generatedVideoTrack = {this.props.generatedVideoTrack}
                />
            );
        } else {
            const classes = classNames({
                'capitalize' : true,
                'btn'        : true,
                'btn-lg'     : true,
                'btn-block'  : true,
                'btn-primary': true
            });

            const friendlyName = this.props.targetUri.split('@')[0];

            content = (
                <Fragment>
                    <Title>You're about to join a conference! {friendlyName}</Title>
                    <View >
                        <TextInput
                            mode="outlined"
                            label="Name"
                            placeholder="Enter your name (optional)"
                            value={this.state.displayName}
                            onChange={this.handleDisplayNameChange}
                        />
                    </View>
                    <Button type="submit" onPress={this.handleSubmit} icon="sign-in">Join</Button>
                </Fragment>
            );
        }

        return (
            <View>
                {content}
            </View>
        );
    }
}

ConferenceByUriBox.propTypes = {
    notificationCenter  : PropTypes.func.isRequired,
    handler             : PropTypes.func.isRequired,
    hangupCall          : PropTypes.func.isRequired,
    shareScreen         : PropTypes.func.isRequired,
    targetUri           : PropTypes.string,
    localMedia          : PropTypes.object,
    account             : PropTypes.object,
    currentCall         : PropTypes.object,
    generatedVideoTrack : PropTypes.bool
};


export default ConferenceByUriBox;
