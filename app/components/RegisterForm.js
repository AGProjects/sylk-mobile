import React, { Component } from 'react';
import { View, Text, Linking, Keyboard } from 'react-native';
import PropTypes from 'prop-types';
import ipaddr from 'ipaddr.js';
import autoBind from 'auto-bind';

import { Button, TextInput, Title, Subheading } from 'react-native-paper';
import EnrollmentModal from './EnrollmentModal';
import storage from '../storage';
import config from '../config';
import styles from '../assets/styles/blink/_RegisterForm.scss';

function isASCII(str) {
    return /^[\x00-\x7F]*$/.test(str);
}

function handleLink() {
    let link = 'https://mdns.sipthor.net/sip_login_reminder.phtml';
    storage.get('last_signup').then((last_signup) => {
        if (last_signup) {
            storage.get('signup').then((signup) => {
                if (signup) {
                    const email = signup[last_signup];
                    link += `?sip_filter=${last_signup}&email_filter=${email}`;
                }
                Linking.openURL(link);
            });
        } else {
            Linking.openURL(link);
        }
    });
}

class RegisterForm extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            accountId: '',
            password: '',
            connected: props.connected,
            registering: false,   // login in progress
            remember: false,
            myPhoneNumber: props.myPhoneNumber,
            showEnrollmentModal: false
        };
    }

    componentDidMount() {
        storage.get('account').then((account) => {
            if (account) this.setState({ ...account });
        });
    }

    handleAccountIdChange(value) {
		const trimmed = value.trim();
		this.setState({ 
			accountId: trimmed,
			password: trimmed === '' ? '' : this.state.password // reset password if accountId is empty
		});
    }

    handlePasswordChange(value) {
        this.setState({ password: value.trim() });
    }

    async handleSubmit(event) {
        if (!this.validInput()) return;
        if (event) event.preventDefault();

        let account = this.state.accountId;
        if (!account.includes('@')) {
            account += `@${config.defaultDomain}`;
        }

        Keyboard.dismiss();
        this.setState({ registering: true });

        const delay = new Promise(resolve => setTimeout(resolve, 5000));
        let success = false;

        try {
            await this.props.handleSignIn(account, this.state.password);
            success = true;
        } catch (err) {
            console.error('Login failed', err);
        }

        await delay;
        this.setState({ registering: false });
 
        if (success) {
            // Optionally handle post-login transition
        }
    }

    handleEnrollment(account) {
        this.setState({ showEnrollmentModal: false });
        if (account) {
            this.setState({ accountId: account.id, password: account.password, registering: true });
            this.props.handleEnrollment(account);
        }
    }

    createAccount(event) {
        event.preventDefault();
        this.setState({ showEnrollmentModal: true });
    }

    validInput() {
        const domain = this.state.accountId.includes('@')
            ? this.state.accountId.split('@')[1]
            : '';
        const validDomain =
            domain === '' ||
            (!ipaddr.IPv4.isValidFourPartDecimal(domain) &&
                !ipaddr.IPv6.isValid(domain) &&
                domain.length > 3 &&
                domain.includes('.') &&
                domain.split('.').pop().length > 0);
        return (
            this.state.accountId.length > 0 &&
            isASCII(this.state.accountId) &&
            validDomain &&
            this.state.password.length > 0 &&
            isASCII(this.state.password)
        );
    }

    render() {
        const containerClass = this.props.isTablet
            ? this.props.orientation === 'landscape'
                ? styles.landscapeTabletContainer
                : styles.portraitTabletContainer
            : this.props.orientation === 'landscape'
            ? styles.landscapeContainer
            : styles.portraitContainer;

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
                        placeholder="No account? Just press Sign up!"
                        value={this.state.accountId}
                        onChangeText={this.handleAccountIdChange}
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
   					    autoCapitalize="none"
					    autoCorrect={false}
                        value={this.state.password}
                        onChangeText={this.handlePasswordChange}
                        onSubmitEditing={this.handleSubmit}
                        secureTextEntry
                        ref={(ref) => { this.passwordInput = ref; }}
                    />
                </View>

                <View style={styles.buttonRow}>
                    { this.state.accountId ?

                    <Button
                        style={styles.button}
                        icon="login"
                        disabled={
                            this.props.registrationInProgress ||
                            !this.validInput()
                        }

                        onPress={this.handleSubmit}
                        mode="contained"
                        loading={this.state.registering}
                        accessibilityLabel="Sign In"
                    >
                        {this.state.registering ? 'Signing In...' : 'Sign In'}
                    </Button>
                    :
					<Button
						icon="plus"
						style={styles.button}
						mode="contained"
						onPress={this.createAccount}
						disabled={
							this.state.registering || this.state.accountId
						}
					>Sign Up
					</Button>
                    }
                </View>

                {!this.state.registering && this.state.accountId?

                <Text onPress={handleLink} style={styles.recoverLink}>
                    Recover lost password...
                </Text>
                : null }
                

                <EnrollmentModal
                    show={this.state.showEnrollmentModal}
                    handleEnrollment={this.handleEnrollment}
                    myPhoneNumber={this.props.myPhoneNumber}
                    orientation={this.props.orientation}
                    isTablet={this.props.isTablet}
                />
            </View>
        );
    }
}

RegisterForm.propTypes = {
    handleSignIn: PropTypes.func.isRequired,
    handleEnrollment: PropTypes.func.isRequired,
    registrationInProgress: PropTypes.bool.isRequired,
    connected: PropTypes.bool,
    orientation: PropTypes.string,
    isTablet: PropTypes.bool,
    myPhoneNumber: PropTypes.string
};

export default RegisterForm;
