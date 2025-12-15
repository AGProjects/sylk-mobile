import React, { Component } from 'react';
import { View, Text, Linking, Keyboard } from 'react-native';
import PropTypes from 'prop-types';
import ipaddr from 'ipaddr.js';
import autoBind from 'auto-bind';

import { Button, TextInput, Title, Subheading } from 'react-native-paper';
import EnrollmentModal from './EnrollmentModal';
import storage from '../storage';
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

        this.sylkDomainRef = React.createRef();

        this.state = {
            accountId: '',
            password: '',
            connected: props.connected,
            registering: false,   // login in progress
            remember: false,
            myPhoneNumber: props.myPhoneNumber,
            showEnrollmentModal: false,
            enrollmentUrl: props.enrollmentUrl,
            showServer: false,
            sylkDomain: props.sylkDomain,
            newSylkDomain: props.sylkDomain,
            serverIsValid: props.serverIsValid,
            domainChecked: false,
            SylkServerDiscovery: props.SylkServerDiscovery,
            SylkServerDiscoveryResult: props.SylkServerDiscoveryResult,
            SylkServerStatus: props.SylkServerStatus,
            serverSettingsUrl: props.serverSettingsUrl
        };
    }
    
	UNSAFE_componentWillReceiveProps(nextProps) {
		this.setState({serverIsValid: nextProps.serverIsValid,
		               sylkDomain: nextProps.sylkDomain,
		               SylkServerDiscovery: nextProps.SylkServerDiscovery,
		               SylkServerDiscoveryResult: nextProps.SylkServerDiscoveryResult,
		               enrollmentUrl: nextProps.enrollmentUrl,
		               serverSettingsUrl: nextProps.serverSettingsUrl,
		               });

		if ('SylkServerStatus' in nextProps) {
			this.setState({SylkServerStatus: nextProps.SylkServerStatus});
		}
		
		if ('newSylkDomain' in nextProps) {
			this.setState({newSylkDomain: nextProps.newSylkDomain});
		}
	}

	componentDidUpdate(prevProps, prevState) {
	    if (prevState.serverIsValid != this.state.serverIsValid) {
			console.log('serverIsValid', this.state.serverIsValid);
	    }

	    if (prevState.domainChecked != this.state.domainChecked) {
			console.log('domainChecked', this.state.domainChecked);
	    }   
	    
	    if (prevState.SylkServerDiscoveryResult != this.state.SylkServerDiscoveryResult) {
			console.log('SylkServerDiscoveryResult', prevState.SylkServerDiscoveryResult, '->', this.state.SylkServerDiscoveryResult);
			if (this.state.SylkServerDiscoveryResult == 'ready') {
				this.setState({domainChecked: true});
			}
	    }   

	    if (prevState.SylkServerDiscovery != this.state.SylkServerDiscovery) {
			console.log('SylkServerDiscovery changed', this.state.SylkServerDiscovery);
	    }   

	    if (prevState.SylkServerStatus != this.state.SylkServerStatus) {
			console.log('SylkServerStatus changed', prevState.SylkServerStatus, '->', this.state.SylkServerStatus);
	    }   

	}

    componentDidMount() {
        storage.get('account').then((account) => {
            if (account) this.setState({ ...account });
        });
    }

	helpLink() {
		let link = 'https://sylkserver.com/documentation/sipwebrtc-messaging-server/';
		Linking.openURL(link);
	}

	changeSylkDomain(value) {
		const trimmed = value.trim();
		this.setState({ selection: null });
        this.setState({ newSylkDomain: value.trim()});
	}

	async handleServerChange() {
	    console.log('handleServerChange', this.state.sylkDomain, '->', this.state.newSylkDomain);

		if (!this.state.domainChecked) {
			console.log('check new Sylk domain', this.state.newSylkDomain);
			this.props.lookupSylkServer(this.state.newSylkDomain, true);
		} else {
		    if (this.state.newSylkDomain) {
				await this.props.lookupSylkServer(this.state.newSylkDomain, false);
				this.setState({ 
					accountId: '',
					password: ''
				});
			}
			this.setState({showServer: false, domainChecked: false});
		}
	}

    handleAccountIdChange(value) {
		const trimmed = value.trim();
		this.setState({ 
			accountId: trimmed,
			password: trimmed === '' ? '' : this.state.password // reset password if accountId is empty
		});
    }

	changeServer() {
	    console.log('changeServer');
	    this.props.resetSylkServerStatus();
		this.setState({domainChecked: false});
		if (this.state.showServer) {
		    // reset to defaults
			this.setState({newSylkDomain: this.state.sylkDomain});
			this.props.lookupSylkServer(this.state.sylkDomain, true);
		} else {
			setTimeout(() => {
				this.sylkDomainRef.current?.focus();
				// Release selection on next frame so user can move cursor
				this.setState({selection: { start: 0, end: 0 }});
				if (this.state.newSylkDomain == 'sylk.link') {
					//this.setState({ newSylkDomain: "."+ this.state.newSylkDomain});
				}
				
			}, 100);
			setTimeout(() => {
				this.setState({ selection: null });
			}, 200);

		}
		
		this.setState({showServer: !this.state.showServer})
	}

    handlePasswordChange(value) {
        this.setState({ password: value.trim() });
    }

    async handleSubmit(event) {
        if (!this.validInput()) return;
        if (event) event.preventDefault();

        let account = this.state.accountId;
        console.log('account', account);
        if (!account.includes('@')) {
            account += `@${this.props.defaultDomain}`;
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

    get buttonDisabled() {
        if (this.state.sylkDomain != 'sylk.link') {
             if (!this.state.serverIsValid) {
				 return true;
             }
        }
        
		return this.props.registrationInProgress || !this.validInput();
    }
                            
    render() {   
        let serverLabel = "Chose another Sylk domain";
        if (this.state.sylkDomain != this.state.newSylkDomain || this.state.showServer) {
			serverLabel = 'Back to current Sylk domain';
        }
                
        let serverStyle = this.state.serverIsValid ? styles.recoverLink : styles.brokenServer;
        let placeholder = this.state.enrollmentUrl ? "No address? Just Sign up!" : "";
        let subtitle = this.state.showServer ? "Chose domain" : "Sign in to continue";        
        
        if (!this.state.serverIsValid) {
			serverLabel = 'Invalid domain, touch to reset';
        }
        
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
                <Subheading style={styles.subtitle}>{subtitle}</Subheading>

               {!this.state.showServer ?
                <View style={styles.row}>
                    <TextInput
                        mode="flat"
                        style={styles.input}
                        textContentType="emailAddress"
                        label="SIP address"
                        disabled={!this.state.serverIsValid}
                        placeholder={placeholder}
                        value={this.state.accountId}
                        onChangeText={this.handleAccountIdChange}
                        autoCapitalize="none"
                        returnKeyType="next"
                        onSubmitEditing={() => this.passwordInput.focus()}
                    />
                </View>
                : null}

               {!this.state.showServer ?
                <View style={styles.row}>
                    <TextInput
                        mode="flat"
                        style={styles.input}
                        label="Password"
                        textContentType="password"
                        disabled={!this.state.serverIsValid}
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
                : null}

                {(!this.state.showServer && this.state.sylkDomain != 'sylk.link') ?
                <Text style={styles.recoverLink}>
                    Sylk domain: {this.state.sylkDomain}
                </Text>
                :null}

                {this.state.showServer ?
                <View style={styles.row}>
                    <TextInput
						ref={this.sylkDomainRef}
                        mode="flat"
                        style={styles.input}
                        label="Sylk domain"
                        selection={this.state.selection}
                        editable={!this.state.domainChecked}
                        value={this.state.newSylkDomain}
                        onChangeText={this.changeSylkDomain}
                        autoCapitalize="none"
                    />
                </View>
                : null}

                {(this.state.showServer) ?
                <View style={styles.buttonRow}>
                    <Button
                        style={styles.serverButton}
                        icon="login"
                        onPress={this.handleServerChange}
                        mode="contained"
                        loading={this.state.SylkServerDiscovery}
                    >
                        {this.state.domainChecked ? 'Use domain': 'Check domain' }
                    </Button>
                </View>
                : null}

                {(this.state.SylkServerStatus && this.state.showServer ) ?
                <Text onPress={this.helpLink} style={this.state.domainChecked ? styles.goodServer : styles.brokenServer}>
                    {this.state.SylkServerStatus}
                </Text>
                : null}

				{ !this.state.showServer ? (
					<View style={styles.buttonRow}>
						{ this.state.accountId ? (
							<Button
								style={styles.button}
								icon="login"
								disabled={this.buttonDisabled}
								onPress={this.handleSubmit}
								mode="contained"
								loading={this.state.registering}
								accessibilityLabel="Sign In"
							>
								{this.state.registering ? 'Signing In...' : 'Sign In'}
							</Button>
						) : (
							this.state.enrollmentUrl ? (
								<Button
									icon="plus"
									style={styles.button}
									mode="contained"
									onPress={this.createAccount}
									disabled={
										this.state.registering ||
										this.state.accountId ||
										!this.state.serverIsValid
									}
								>
									Sign Up
								</Button>
							) : null
						)}
					</View>
				) : null }


                {!this.state.registering && this.state.accountId && this.state.serverIsValid && !this.state.showServer && this.state.serverSettingsUrl?

                <Text onPress={handleLink} style={styles.recoverLink}>
                    Recover lost password...
                </Text>
                : null }

                {(!this.state.SylkServerDiscovery && !this.state.registering) ?
                <Text onPress={this.changeServer} style={serverStyle}>
                    {serverLabel}
                </Text>
                :null}
                

                <EnrollmentModal
                    enrollmentUrl={this.state.enrollmentUrl}
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
    enrollmentUrl : PropTypes.string,
    serverSettingsUrl: PropTypes.string,
    defaultDomain: PropTypes.string,
    sylkDomain: PropTypes.string,
    serverIsValid: PropTypes.bool,
    handleSignIn: PropTypes.func.isRequired,
    handleEnrollment: PropTypes.func.isRequired,
    registrationInProgress: PropTypes.bool.isRequired,
    connected: PropTypes.bool,
    orientation: PropTypes.string,
    isTablet: PropTypes.bool,
    myPhoneNumber: PropTypes.string,
    lookupSylkServer: PropTypes.func,
    SylkServerDiscovery: PropTypes.bool,
    SylkServerDiscoveryResult: PropTypes.string,
    SylkServerStatus: PropTypes.string,
    resetSylkServerStatus: PropTypes.func
};

export default RegisterForm;
