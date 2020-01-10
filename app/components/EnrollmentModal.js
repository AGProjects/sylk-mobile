import React, { Component } from 'react';
import { View, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import PropTypes from 'prop-types';
import superagent from 'superagent';
import autoBind from 'auto-bind';
import { Modal, Portal, Button, TextInput, Title, Surface, HelperText, Snackbar } from 'react-native-paper';

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

    handleFormFieldChange(event) {
        event.preventDefault();
        let state = {};
        state[event.target.name] = event.target.value;
        this.setState(state);
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
                <Modal visible={this.props.show} onDismiss={this.onHide}>
                    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : null} enabled pointerEvents="box-none">
                        <Surface style={styles.container}>
                            <ScrollView style={styles.inner}>
                                <Title style={styles.title}>Create account</Title>
                                <View>
                                    <View>
                                        <TextInput
                                            label="Display name"
                                            name="yourName"
                                            type="text"
                                            placeholder="Alice"
                                            onChange={this.handleFormFieldChange}
                                            required
                                            value={this.state.yourName}
                                            disabled={this.state.enrolling}
                                        />
                                    </View>
                                </View>
                                <View>
                                    <View>
                                        <View>
                                            <TextInput
                                                label="Username"
                                                name="username"
                                                placeholder="alice"
                                                onChange={this.handleFormFieldChange}
                                                required
                                                value={this.state.username}
                                                disabled={this.state.enrolling}
                                            />
                                            <HelperText
                                                type="info"
                                                visible={true}
                                            >
                                                @{config.enrollmentDomain}
                                            </HelperText>
                                        </View>
                                    </View>
                                </View>
                                <View>
                                    <View>
                                        <TextInput
                                            label="Password"
                                            name="password"
                                            secureTextEntry={true}
                                            textContentType="password"
                                            onChangeText={this.handleFormFieldChange}
                                            required value={this.state.password}
                                            disabled={this.state.enrolling}
                                        />
                                    </View>
                                </View>
                                <View>
                                    <View>
                                        <TextInput
                                            label="Verify password"
                                            secureTextEntry={true}
                                            textContentType="password"
                                            name="password2"
                                            onChange={this.handleFormFieldChange}
                                            required value={this.state.password2}
                                            disabled={this.state.enrolling}
                                        />
                                    </View>
                                </View>
                                <View>
                                    <View>
                                        <TextInput
                                            label="E-Mail"
                                            textContentType="emailAddress"
                                            name="email"
                                            placeholder="alice@atlanta.example.com"
                                            onChange={this.handleFormFieldChange}
                                            required value={this.state.email}
                                            disabled={this.state.enrolling}
                                        />
                                    </View>
                                </View>
                                <View>
                                    <Button
                                        icon={buttonIcon}
                                        loading={this.state.enrolling}
                                        disabled={this.state.enrolling}
                                        onPress={this.enrollmentFormSubmitted}
                                    >
                                        {buttonText}
                                    </Button>
                                </View>
                                <Snackbar
                                    visible={this.state.errorVisible}
                                    duration={2000}
                                    onDismiss={() => this.setState({ errorVisible: false })}

                                >{this.state.error}</Snackbar>
                            </ScrollView>
                        </Surface>
                    </KeyboardAvoidingView>
                </Modal>
            </Portal>
        );
    }
}

EnrollmentModal.propTypes = {
    handleEnrollment: PropTypes.func.isRequired,
    show: PropTypes.bool.isRequired
};

export default EnrollmentModal;
