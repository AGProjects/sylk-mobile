import React, { Component } from 'react';
import { View, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import PropTypes from 'prop-types';
import superagent from 'superagent';
import autoBind from 'auto-bind';
import { Dialog, Portal, Button, TextInput, Title, Surface, HelperText, Snackbar } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_EnrollmentModal.scss';

import config from '../config';

class EnrollmentModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        // save the initial state so we can restore it later
        this.initialState = {
            yourName: '',
            username: '',
            password: '',
            password2: '',
            email: '',
            enrolling: false,
            error: '',
            errorVisible: false
        };
        this.state = Object.assign({}, this.initialState);
    }

    handleFormFieldChange(value, name) {
        this.setState({
            [name]: value
        });
    }

    enrollmentFormSubmitted(event) {
        event.preventDefault();
        // validate the password fields
        if (this.state.password !== this.state.password2) {
            this.setState({error: 'Password missmatch'});
            return;
        }
        this.setState({enrolling: true, error:''});
        superagent.post(config.enrollmentUrl)
                  .send(superagent.serialize['application/x-www-form-urlencoded']({username: this.state.username,
                                                                                   password: this.state.password,
                                                                                   email: this.state.email,
                                                                                   display_name: this.state.yourName}))   //eslint-disable-line camelcase
                  .end((error, res) => {
                      this.setState({enrolling: false});
                      if (error) {
                          this.setState({error: error.toString(), errorVisible: true});
                          return;
                      }
                      let data;
                      try {
                          data = JSON.parse(res.text);
                      } catch (e) {
                          this.setState({error: 'Could not decode response data', errorVisible: true});
                          return;
                      }
                      if (data.success) {
                          this.props.handleEnrollment({accountId: data.sip_address,
                                                       password: this.state.password});
                          this.setState(this.initialState);
                      } else if (data.error === 'user_exists') {
                          this.setState({error: 'User already exists', errorVisible: true});
                      } else {
                          this.setState({error: data.error_message, errorVisible: true});
                      }
                  });
    }

    onHide() {
        this.props.handleEnrollment(null);
        this.setState(this.initialState);
    }

    render() {
        let buttonText = 'Create';
        let buttonIcon = null;
        if (this.state.enrolling) {
            buttonIcon = "cog";
        }

        return (
            <Portal>
                <DialogType visible={this.props.show} onDismiss={this.onHide}>
                        <Surface style={styles.container}>
                            <Dialog.Title style={styles.title}>Create account</Dialog.Title>
                            <TextInput
                                mode="flat"
                                label="Display name"
                                name="yourName"
                                type="text"
                                placeholder="Alice"
                                onChangeText={(text) => {this.handleFormFieldChange(text, 'yourName');}}
                                required
                                value={this.state.yourName}
                                disabled={this.state.enrolling}
                                returnKeyType="next"
                                onSubmitEditing={() => this.usernameInput.focus()}
                            />
                            <TextInput
                                mode="flat"
                                label="Username"
                                name="username"
                                autoCapitalize="none"
                                placeholder="alice"
                                onChangeText={(text) => {this.handleFormFieldChange(text, 'username');}}
                                required

                                value={this.state.username}
                                disabled={this.state.enrolling}
                                returnKeyType="next"
                                ref={ref => {
                                    this.usernameInput = ref;
                                }}
                                onSubmitEditing={() => this.passwordInput.focus()}
                            />
                            <HelperText
                                type="info"
                                visible={true}
                            >
                                @{config.enrollmentDomain}
                            </HelperText>
                            <TextInput
                                mode="flat"
                                label="Password"
                                name="password"
                                secureTextEntry={true}
                                textContentType="password"
                                onChangeText={(text) => {this.handleFormFieldChange(text, 'password');}}
                                required value={this.state.password}
                                disabled={this.state.enrolling}
                                returnKeyType="next"
                                ref={ref => {
                                    this.passwordInput = ref;
                                }}
                                onSubmitEditing={() => this.password2Input.focus()}
                            />
                            <TextInput
                                mode="flat"
                                label="Verify password"
                                secureTextEntry={true}
                                textContentType="password"
                                name="password2"
                                onChangeText={(text) => {this.handleFormFieldChange(text, 'password2');}}
                                required value={this.state.password2}
                                disabled={this.state.enrolling}
                                returnKeyType="next"
                                ref={ref => {
                                    this.password2Input = ref;
                                }}
                                onSubmitEditing={() => this.emailInput.focus()}
                            />
                            <TextInput
                                mode="flat"
                                label="E-Mail"
                                textContentType="emailAddress"
                                name="email"
                                autoCapitalize="none"
                                placeholder="alice@atlanta.example.com"
                                onChangeText={(text) => {this.handleFormFieldChange(text, 'email');}}
                                required value={this.state.email}
                                disabled={this.state.enrolling}
                                returnKeyType="go"
                                ref={ref => {
                                    this.emailInput = ref;
                                }}
                            />
                        <Button
                            icon={buttonIcon}
                            loading={this.state.enrolling}
                            disabled={this.state.enrolling}
                            onPress={this.enrollmentFormSubmitted}
                        >
                            {buttonText}
                        </Button>
                        <Snackbar
                            visible={this.state.errorVisible}
                            duration={2000}
                            onDismiss={() => this.setState({ errorVisible: false })}
                        >
                            {this.state.error}
                        </Snackbar>
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}

EnrollmentModal.propTypes = {
    handleEnrollment: PropTypes.func.isRequired,
    show: PropTypes.bool.isRequired
};

export default EnrollmentModal;
