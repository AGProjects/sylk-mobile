import React, { Component } from 'react';
import { View, Keyboard } from 'react-native';
import PropTypes from 'prop-types';
import ipaddr from 'ipaddr.js';
import autoBind from 'auto-bind';

import { Button, TextInput, Title } from 'react-native-paper';

import EnrollmentModal from './EnrollmentModal';
import storage from '../storage';
import styles from '../assets/styles/blink/_RegisterForm.scss';

class RegisterForm extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            accountId: '',
            password: '',
            registering: false,
            remember: false,
            showEnrollmentModal: false
        };
    }

    componentDidMount() {
        storage.get('account').then((account) => {
            if (account) {
                this.setState(Object.assign({}, account, {remember: true}));
                if (this.props.autoLogin && this.state.password !== '') {
                    this.props.handleRegistration(this.state.accountId, this.state.password);
                }
            }
        });
    }

    handleAccountIdChange(value) {
        this.setState({accountId: value});
    }

    handlePasswordChange(value) {
        this.setState({password: value});
    }

    handleSubmit(event) {
        if (event) {
            event.preventDefault();
        }
        Keyboard.dismiss();
        this.props.handleRegistration(this.state.accountId, this.state.password, true);
    }

    handleEnrollment(account) {
        this.setState({showEnrollmentModal: false});
        if (account !== null) {
            this.setState({accountId: account.accountId, password: account.password, registering: true});
            this.props.handleRegistration(account.accountId, account.password);
        }
    }

    createAccount(event) {
        event.preventDefault();
        this.setState({showEnrollmentModal: true});
    }

    render() {
        const domain = this.state.accountId.substring(this.state.accountId.indexOf('@') + 1);
        const validDomain = !ipaddr.IPv4.isValidFourPartDecimal(domain) && !ipaddr.IPv6.isValid(domain);
        const validInput =  validDomain && this.state.accountId.indexOf('@') !== -1 && this.state.password !== 0;

        return (
            <View style={styles.container}>
                <Title style={styles.title}>Sign in to continue</Title>
                    <View style={styles.row}>
                        <TextInput
                            style={styles.input}
                            textContentType="emailAddress"
                            label="Sip Account"
                            placeholder="Enter your account"
                            value={this.state.accountId}
                            onChangeText={this.handleAccountIdChange}
                            required
                            autoCapitalize="none"
                        />
                    </View>
                    <View style={styles.row}>
                        <TextInput
                            style={styles.input}
                            label="Password"
                            textContentType="password"
                            placeholder="Password"
                            value={this.state.password}
                            onChangeText={this.handlePasswordChange}
                            required
                            secureTextEntry={true}
                        />
                    </View>

                    <View style={styles.row}>
                        <Button
                            style={styles.button}
                            icon="login"
                            disabled={this.props.registrationInProgress || !validInput}
                            onPress={this.handleSubmit}
                            mode="contained"
                            loading={this.state.registering}
                            accessibilityLabel="Sign In"
                        >
                            Sign In
                        </Button>
                        <Button
                            icon="plus"
                            style={styles.button}
                            mode="contained"
                            onPress={this.createAccount}
                            disabled={this.props.registrationInProgress}
                            accessibilityLabel="Sign Up"
                        >
                            Sign Up
                        </Button>
                    </View>
                <EnrollmentModal show={this.state.showEnrollmentModal} handleEnrollment={this.handleEnrollment} />
            </View>
        );
    }
}

RegisterForm.propTypes = {
    classes                : PropTypes.object,
    handleRegistration     : PropTypes.func.isRequired,
    registrationInProgress : PropTypes.bool.isRequired,
    autoLogin              : PropTypes.bool
};


export default RegisterForm;