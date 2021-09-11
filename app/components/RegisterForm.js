import React, { Component } from 'react';
import { View, Text, Linking, Keyboard } from 'react-native';
import PropTypes from 'prop-types';
import ipaddr from 'ipaddr.js';
import autoBind from 'auto-bind';
import FooterBox from './FooterBox';

import { Button, TextInput, Title, Subheading } from 'react-native-paper';

import EnrollmentModal from './EnrollmentModal';
import storage from '../storage';
import config from '../config';

import styles from '../assets/styles/blink/_RegisterForm.scss';

function isASCII(str) {
    return /^[\x00-\x7F]*$/.test(str);
}

function handleLink(event) {
    Linking.openURL('https://mdns.sipthor.net/sip_login_reminder.phtml');
}

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
                this.setState(Object.assign({}, account));
                if (this.props.autoLogin && this.state.password !== '') {
                    this.props.handleRegistration(this.state.accountId, this.state.password);
                }
            }
        });
    }

    handleAccountIdChange(value) {
        this.setState({accountId: value.trim()});
    }

    handlePasswordChange(value) {
        this.setState({password: value.trim()});
    }

    handleSubmit(event) {
        if (!this.validInput()) {
            return;
        }

        if (event) {
            event.preventDefault();
        }

        let account = this.state.accountId;
        if (this.state.accountId.indexOf('@') === -1 ) {
            account = this.state.accountId + '@' + config.defaultDomain;
        }

        Keyboard.dismiss();
        this.props.handleRegistration(account, this.state.password, true);
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

    validInput() {
        const domain = this.state.accountId.indexOf('@') !== -1 ? this.state.accountId.substring(this.state.accountId.indexOf('@') + 1): '';
        const validDomain = domain === '' || (!ipaddr.IPv4.isValidFourPartDecimal(domain) && !ipaddr.IPv6.isValid(domain) && domain.length > 3 && domain.indexOf('.') !== - 1 && (domain.length - 2 - domain.indexOf('.')) > 0);
        const validInput =  isASCII(this.state.accountId) && validDomain && this.state.password !== '' && isASCII(this.state.password);
        return validInput;
    }

    render() {
        let containerClass;
        if (this.props.isTablet) {
            containerClass = this.props.orientation === 'landscape' ? styles.landscapeTabletContainer : styles.portraitTabletContainer;
        } else {
            containerClass = this.props.orientation === 'landscape' ? styles.landscapeContainer : styles.portraitContainer;
        }

        return (
            <View style={containerClass}>
                <Title style={styles.title}>Sylk</Title>
                <Subheading style={styles.subtitle}>Sign in to continue</Subheading>
                    <View style={styles.row}>
                        <TextInput
                            mode="flat"
                            style={styles.input}
                            textContentType="emailAddress"
                            label="Account"
                            placeholder="Enter your account"
                            value={this.state.accountId}
                            onChangeText={this.handleAccountIdChange}
                            required
                            autoCapitalize="none"
                            returnKeyType="next"
                            onSubmitEditing={() => this.passwordInput.focus()}
                        />
                    </View>
                    <View style={styles.row}>
                        <TextInput
                            mode="flat"
                            style={styles.input}
                            label="Password"
                            textContentType="password"
                            placeholder="Password"
                            value={this.state.password}
                            onChangeText={this.handlePasswordChange}
                            onSubmitEditing={this.handleSubmit}
                            required
                            secureTextEntry={true}
                            ref={ref => {
                                this.passwordInput = ref;
                            }}
                        />
                    </View>

                    <View style={styles.buttonRow}>
                        <Button
                            style={styles.button}
                            icon="login"
                            disabled={this.props.registrationInProgress || !this.validInput()}
                            onPress={this.handleSubmit}
                            mode="contained"
                            loading={this.state.registering}
                            accessibilityLabel="Sign In"
                        >
                            Sign In
                        </Button>

                        { config.enrollmentUrl ?
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
                        : null }
                    </View>
                <Text onPress={() => handleLink()} style={styles.recoverLink}>Recover lost passsword...</Text>
                <EnrollmentModal
                   show={this.state.showEnrollmentModal}
                   handleEnrollment={this.handleEnrollment}
                   phoneNumber={this.props.phoneNumber}
                />
            </View>

        );
    }
}

RegisterForm.propTypes = {
    classes                : PropTypes.object,
    handleRegistration     : PropTypes.func.isRequired,
    registrationInProgress : PropTypes.bool.isRequired,
    autoLogin              : PropTypes.bool,
    orientation            : PropTypes.string,
    isTablet               : PropTypes.bool,
    phoneNumber            : PropTypes.string
};


export default RegisterForm;
