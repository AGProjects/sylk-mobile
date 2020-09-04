import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { Title, Button, TextInput } from 'react-native-paper';
import autoBind from 'auto-bind';
import { View } from 'react-native';

import Call from './Call';

class CallByUriBox extends Component {
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
        this.props.handleCallByUri(this.state.displayName, this.props.targetUri);
    }

    render() {
        const validInput = this.state.displayName !== '';
        let content;

        if (this.props.localMedia !== null) {
            content = (
                <Call
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
            content = (
                <Fragment>
                    <Title>You've been invited to call {this.props.targetUri}</Title>
                        <View>
                            <TextInput id="inputName"
                                mode="outlined"
                                label="Name"
                                placeholder="Enter your name"
                                value={this.state.displayName}
                                onChange={this.handleDisplayNameChange}
                                required
                                autoFocus
                            />
                        </View>
                        <Button type="submit" disabled={!validInput} onPress={this.handleSubmit} icon="camera">Call</Button>
                </Fragment>
            );
        }

        return (
            <View className="cover-container">
                {content}
            </View>
        );
    }
}

CallByUriBox.propTypes = {
    handleCallByUri     : PropTypes.func.isRequired,
    notificationCenter  : PropTypes.func.isRequired,
    hangupCall          : PropTypes.func.isRequired,
    shareScreen         : PropTypes.func.isRequired,
    targetUri           : PropTypes.string,
    localMedia          : PropTypes.object,
    account             : PropTypes.object,
    currentCall         : PropTypes.object,
    generatedVideoTrack : PropTypes.bool
};


export default CallByUriBox;
