import React, { Component } from 'react';
import { View, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import PropTypes from 'prop-types';
import superagent from 'superagent';
import autoBind from 'auto-bind';
import { Dialog, Portal, Button, TextInput, Text, Title, Surface, HelperText, Snackbar } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
import LoadingScreen from './LoadingScreen';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_EnrollmentModal.scss';

import config from '../config';

class EnrollmentModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        // save the initial state so we can restore it later
        this.initialState = {
            displayName: '',
            username: '',
            password: '',
            password2: '',
            email: '',
            enrolling: false,
            error: '',
            errorVisible: false,
            status: ''
        };
        this.state = Object.assign({}, this.initialState);
    }

    handleFormFieldChange(value, name) {
        if (name === 'username') {
            value = value.replace(/[^\w|\.\-]/g, '').trim().toLowerCase();
        } else if (name === 'email') {
            value = value.trim().toLowerCase();
        } else {
            value = value.trim();
        }

        this.setState({
            [name]: value
        });
    }

    get validInput() {
        let valid_input = !this.state.enrolling;
        let error;

        valid_input = valid_input && this.state.displayName.length > 2;
        if (!valid_input && !error) {
            error = 'Invalid display name';
        }

        valid_input = valid_input && this.state.username.length > 3;
        if (!valid_input && !error) {
            error = 'Invalid username';
        }

        valid_input = valid_input && this.state.password !== '';
        if (!valid_input && !error) {
            error = 'Invalid password';
        }

        valid_input = valid_input && this.state.password === this.state.password2;
        if (!valid_input && !error) {
            error = 'Passwords not equal';
        }

        valid_input = valid_input && this.state.email.indexOf('@') > -1;
        if (!valid_input && !error) {
            error = 'Email not valid';
        }

        if (!valid_input) {
            //console.log(error);
        }

        return valid_input;
    }

    enroll(event) {
        event.preventDefault();

        this.setState({enrolling: true, error:''});

        superagent.post(config.enrollmentUrl)
                  .send(superagent.serialize['application/x-www-form-urlencoded']({username: this.state.username,
                                                                                   password: this.state.password,
                                                                                   email: this.state.email,
                                                                                   phoneNumber: this.props.phoneNumber,
                                                                                   display_name: this.state.displayName}))   //eslint-disable-line camelcase
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
                          this.props.handleEnrollment({id: data.sip_address,
                                                       password: this.state.password,
                                                       displayName: this.state.displayName,
                                                       email: this.state.email});
                          this.setState(this.initialState);
                      } else if (data.error === 'user_exists') {
                          this.setState({error: 'Username is taken. Choose another one!', errorVisible: true});
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
        let buttonText = 'Sign Up';
        let buttonIcon = null;
        let loadingText = 'Enrolling...';
        let containerClass;

        if (this.state.enrolling) {
            buttonIcon = "cog";
        }

        if (this.props.isTablet) {
            containerClass = this.props.orientation === 'landscape' ? styles.landscapeTablet : styles.portraitTablet;
        } else {
            containerClass = this.props.orientation === 'landscape' ? styles.landscape : styles.portrait;
        }

        let email_reg = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/;
        let validEmail = email_reg.test(this.state.email);
        let validUsername = this.state.username.length > 3;

        let status = '';
        if (!this.state.displayName) {
            status = 'Enter display name';
        } else if (!validEmail) {
            status = 'Enter email address';
        } else if (!this.state.username) {
            status = 'Enter username';
        } else if (!this.state.password) {
            status = 'Enter password';
        } else if (this.state.password && this.state.password !== this.state.password2) {
            status = 'Password not confirmed';
        }

        return (
            <Portal>
                    <DialogType visible={this.props.show} onDismiss={this.onHide}>
                    <Dialog.Title style={styles.title}>Sign Up</Dialog.Title>
                    <LoadingScreen
                    text={loadingText}
                    show={this.state.enrolling}
                    />
                    <Surface style={styles.container}>
                    <ScrollView
                            ref={ref => {
                                this.scrollView = ref;
                            }}

                    style={containerClass}>

                        <TextInput style={styles.row}
                            mode="flat"
                            label="Display name"
                            name="displayName"
                            type="text"
                            placeholder="Seen by your contacts"
                            onChangeText={(text) => {this.handleFormFieldChange(text, 'displayName');}}
                            required
                            value={this.state.displayName}
                            disabled={this.state.enrolling}
                            returnKeyType="next"
                            onSubmitEditing={() => this.emailInput ? this.emailInput.focus() : null}
                        />
                        { this.state.displayName.length > 2 || true ?
                        <TextInput style={styles.row}
                            mode="flat"
                            label="E-mail"
                            textContentType="emailAddress"
                            name="email"
                            autoCapitalize="none"
                            placeholder="Used to recover the password"
                            value={this.state.email}
                            onChangeText={(text) => {this.handleFormFieldChange(text, 'email');}}
                            required value={this.state.email}
                            disabled={this.state.enrolling}
                            returnKeyType="go"
                            ref={ref => {
                                this.emailInput = ref;
                            }}
                            onSubmitEditing={() => this.usernameInput && validEmail ? this.usernameInput.focus() : null}
                        />
                        :
                        null }
                        { validEmail || true?
                        <TextInput style={styles.row}
                            mode="flat"
                            label="Username"
                            name="username"
                            placeholder="Enter at least 4 characters"
                            autoCapitalize="none"
                            onChangeText={(text) => {this.handleFormFieldChange(text, 'username');}}
                            required
                            value={this.state.username}
                            disabled={this.state.enrolling}
                            returnKeyType="next"
                            ref={ref => {
                                this.usernameInput = ref;
                            }}
                            onSubmitEditing={() => validUsername && this.passwordInput ? this.passwordInput.focus(): null}
                        />
                        : null}

                        { validUsername  ?

                        <TextInput style={styles.row}
                            mode="flat"
                            label="Password"
                            name="password"
                            secureTextEntry={true}
                            placeholder="Enter at least 5 characters"
                            textContentType="password"
                            onChangeText={(text) => {this.handleFormFieldChange(text, 'password');}}
                            required value={this.state.password}
                            disabled={this.state.enrolling}
                            returnKeyType="next"
                            ref={ref => {
                                this.passwordInput = ref;
                            }}
                            onSubmitEditing={() => this.state.password.length > 4 && this.password2Input ? this.password2Input.focus(): null}
                        />
                        : null}

                        { validUsername    ?
                        <TextInput style={styles.row}
                            mode="flat"
                            label="Confirm password"
                            secureTextEntry={true}
                            textContentType="password"
                            name="password2"
                            onChangeText={(text) => {this.handleFormFieldChange(text, 'password2');}}
                            onSubmitEditing={() => this.scrollView.scrollToEnd()}
                            required value={this.state.password2}
                            disabled={this.state.enrolling}
                            returnKeyType="next"
                            ref={ref => {
                                this.password2Input = ref;
                            }}
                        />
                        : null}

                        {this.validInput ?

                        <Button
                            mode="contained"
                            style={styles.button}
                            disabled={!this.validInput}
                            onPress={this.enroll}
                        >{buttonText}
                        </Button>
                        :

                       <Text style={styles.status}>{status}</Text>
                        }


                        <Snackbar style={styles.snackbar}
                            visible={this.state.errorVisible}
                            duration={4000}
                            onDismiss={() => this.setState({ errorVisible: false })}
                        >
                            {this.state.error}
                        </Snackbar>
                            </ScrollView>
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}

EnrollmentModal.propTypes = {
    handleEnrollment: PropTypes.func.isRequired,
    show: PropTypes.bool.isRequired,
    phoneNumber : PropTypes.string,
    orientation : PropTypes.string,
    isTablet    : PropTypes.bool
};

export default EnrollmentModal;
