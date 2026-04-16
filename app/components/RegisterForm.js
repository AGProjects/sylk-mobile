import React, { Component } from 'react';
import { View, Text, Linking, Keyboard, ScrollView } from 'react-native';
import PropTypes from 'prop-types';
import ipaddr from 'ipaddr.js';
import autoBind from 'auto-bind';

import { Button, TextInput, Title, Subheading, IconButton } from 'react-native-paper';
import EnrollmentModal from './EnrollmentModal';
import QRCodeScanner from 'react-native-qrcode-scanner';
import { RNCamera } from 'react-native-camera';
import storage from '../storage';
import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  landscapeContainer: {
    flex: 1,
    flexDirection: 'column',
    marginHorizontal: 'auto', // RN doesn't fully support auto, see note below
    padding: 20,
    marginTop: 0,
  },

  portraitContainer: {
    flex: 1,
    flexDirection: 'column',
    marginHorizontal: 'auto',
  },

  landscapeTabletContainer: {
    flex: 1,
    flexDirection: 'column',
    marginHorizontal: 'auto',
    marginTop: 20,
    padding: 20,
  },

  portaitTabletContainer: {
    flex: 1,
    flexDirection: 'column',
    marginHorizontal: 'auto',
  },

  loadingText: {
    color: 'white',
  },

  loadingContainer: {
    paddingTop: 55,
    justifyContent: 'center',
    alignItems: 'center',
  },

  title: {
    padding: 15,
    alignSelf: 'center',
    color: 'white',
    fontSize: 36,
  },

  wsUrl: {
    color: 'white',
    fontSize: 12,
    position: 'absolute',
    bottom: 150,
    alignSelf: 'center', // optional: centers horizontally
  },

  subtitle: {
    alignSelf: 'center',
    color: 'white',
    marginBottom: 10,
    fontSize: 18,
  },

  row: {
    paddingVertical: 0,
    width: 300,
    alignSelf: 'center',
    flexDirection: 'row',
  },

  QRcodeContainer: {
    marginBottom: 100,
  },

  buttonRow: {
    flexDirection: 'row',
    width: 300,
    borderWidth: 0,
    flexDirection: 'row',      // important
    justifyContent: 'center',  // centers horizontally
    alignItems: 'center',      // optional (vertical alignment)
  },

  button: {
    marginTop: 30,
    borderRadius: 1,
    borderWidth: 2,
    width: 150,
  },

  serverButton: {
    marginTop: 30,
    borderRadius: 1,
    borderWidth: 1,
    width: 180,
    alignSelf: 'center',
  },

  input: {
    borderRadius: 0,
    flex: 1,
  },

  recoverLink: {
    marginTop: 20,
    fontSize: 12,
    textAlign: 'center',
    color: 'white',
  },

  brokenServer: {
    marginTop: 20,
    fontSize: 14,
    color: 'red',
    textAlign: 'center',
  },

  goodServer: {
    marginTop: 20,
    fontSize: 14,
    textAlign: 'center',
    color: 'green',
  },

	serverList: {
		maxHeight: 240, // ~3 buttons
		marginTop: 10,
	},
	
	serverItem: {
		marginVertical: 5,
	},
});

function isASCII(str) {
    return /^[\x00-\x7F]*$/.test(str);
}

function handleRecoveryLink() {
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
            registering: false,   // login in progress
            remember: false,
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
            serverSettingsUrl: props.serverSettingsUrl,
            accounts: props.accounts,
            serversAccounts: props.serversAccounts,
            connection: props.connection,
            wsUrl: props.wsUrl,
            wsUrlVisible: false,
            passwordRecoveryUrl: props.passwordRecoveryUrl
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

		if ('wsUrlVisible' in nextProps) {
			this.setState({wsUrlVisible: nextProps.wsUrlVisible});
		}

		if ('SylkServerStatus' in nextProps) {
			this.setState({SylkServerStatus: nextProps.SylkServerStatus});
		}

		if ('accounts' in nextProps) {
			this.setState({accounts: nextProps.accounts});
		}

		if ('wsUrl' in nextProps) {
			this.setState({wsUrl: nextProps.wsUrl});
		}

		if ('connection' in nextProps) {
			this.setState({connection: nextProps.connection});
		}

		if ('serversAccounts' in nextProps) {
			this.setState({serversAccounts: nextProps.serversAccounts});
		}
		
		if ('newSylkDomain' in nextProps) {
			this.setState({newSylkDomain: nextProps.newSylkDomain});
		}

		if ('passwordRecoveryUrl' in nextProps) {
			this.setState({passwordRecoveryUrl: nextProps.passwordRecoveryUrl});
		}
	}

	componentDidUpdate(prevProps, prevState) {
	    if (prevState.serverIsValid != this.state.serverIsValid) {
			console.log('serverIsValid', this.state.serverIsValid);
	    }

	    if (prevState.accounts != this.state.accounts) {
			//console.log('accounts', this.state.accounts);
	    }

	    if (prevState.sylkDomain != this.state.sylkDomain) {
			console.log('sylkDomain', this.state.sylkDomain);
	    }

	    if (prevState.newSylkDomain != this.state.newSylkDomain) {
			console.log('newSylkDomain', this.state.newSylkDomain);
	    }

	    if (prevState.wsUrl != this.state.wsUrl) {
			console.log('wsUrl', this.state.wsUrl);
	    }

	    if (prevState.serversAccounts != this.state.serversAccounts) {
			console.log('serversAccounts', Object.keys(this.state.serversAccounts));		
			if (!this.state.accountId || this.state.accountId.length == 0) {
				this.initUsername();
			}
	    }

	    if (prevState.showServer != this.state.showServer) {
			console.log('showServer', this.state.showServer);
	    }

	    if (this.state.showQRCodeScanner != prevState.showQRCodeScanner && this.state.showQRCodeScanner) {
		    this.props.requestCameraPermission();
	    }

	    if (prevState.domainChecked != this.state.domainChecked) {
			//console.log('domainChecked', this.state.domainChecked);
	    }   

	    if (prevState.accountId != this.state.accountId) {
			console.log('RF accountId changed', this.state.accountId);
	    }   
	    
	    if (prevState.SylkServerDiscoveryResult != this.state.SylkServerDiscoveryResult) {
			console.log('SylkServerDiscoveryResult', prevState.SylkServerDiscoveryResult, '->', this.state.SylkServerDiscoveryResult);
			if (this.state.SylkServerDiscoveryResult == 'ready') {
				this.setState({domainChecked: true});
			}
	    }   

	    if (prevState.SylkServerDiscovery != this.state.SylkServerDiscovery) {
			console.log('SylkServerDiscovery changed', this.state.SylkServerDiscovery);
			if (!this.state.SylkServerDiscovery) {
				setTimeout(() => {
					this.setState({SylkServerStatus: ''});
					this.setState({wsUrlVisible: false});
				}, 3000);
			}
	    }   

	    if (prevState.SylkServerStatus != this.state.SylkServerStatus) {
			console.log('SylkServerStatus changed', prevState.SylkServerStatus, '->', this.state.SylkServerStatus);
	    }   
	}

    componentDidMount() {
        console.log('RF did mount');
        this.initUsername();
    }

    initUsername() {
	    if (this.state.newSylkDomain in this.state.serversAccounts) {
			const accountObject = this.state.serversAccounts[this.state.newSylkDomain];
			new_account = accountObject.account || '';
			new_password = accountObject.password || '';
			this.setState({ 
				accountId: new_account,
				password: new_password
			});
	    }    
    }

	get hasAccounts() {
		const yes = Object.keys(this.state.serversAccounts).length > 0;
		return yes;
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

	selectSylkServer = (domain) => {
		this.setState({
			newSylkDomain: domain,
			wsUrl: '',
			domainChecked: true,
			showServer: false // optional: go back to login view
		});

		setTimeout(() => {
		    this.handleServerChange(true);
		}, 10);

	};                 

	async handleServerChange(force=false) {
	    console.log('---- handleServerChange', this.state.sylkDomain, '->', this.state.newSylkDomain, this.state.domainChecked);
		this.setState({wsUrlVisible: true, wsUrl: ''});

	    let new_account = '';
	    let new_password = '';

	    if (this.state.newSylkDomain in this.state.serversAccounts) {
			const accountObject = this.state.serversAccounts[this.state.newSylkDomain];
			new_account = accountObject.account || '';
			new_password = accountObject.password || '';
	    }
	    
		if (!this.state.domainChecked) {
			this.props.lookupSylkServer(this.state.newSylkDomain, true);
		} else {
			this.setState({showServer: false, 
			               domainChecked: false});

		    if (this.state.newSylkDomain) {
				this.setState({ 
					accountId: new_account,
					password: new_password
				});
				await this.props.lookupSylkServer(this.state.newSylkDomain, false, force);
			}
		}
	}

    handleAccountIdChange(value) {
		const trimmed = value.trim();
		console.log('handleAccountIdChange');
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
				//this.sylkDomainRef.current?.focus();
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
        console.log('handleEnrollment');
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
            this.state.password && this.state.password.length > 0 &&
            isASCII(this.state.password)
        );
    }

    get buttonDisabled() {
        if (this.state.sylkDomain != 'sylk.link') {
             if (!this.state.serverIsValid) {
				 return true;
             }
        }

		 if (this.state.SylkServerDiscovery) {
			 return true;
		 }
        
		return this.props.registrationInProgress || !this.validInput();
    }

    QRCodeRead(e) {
        // console.log('QR code data:', e.data);
        this.props.toggleQRCodeScannerFunc();

		let domain;

		try {
		  const url = new URL(e.data);
		  domain = url.hostname;
		} catch {
			domain = e.data.replace(/^https?:\/\//, '');
		}        

		this.setState({
			newSylkDomain: domain
		});
    }
           
    render() {   
        const sylkServers = Object.keys(this.props.configurations);
        //console.log('sylkServers', sylkServers);
        //console.log('sylkDomain', this.props.sylkDomain);
        const sortedServers = [...sylkServers].sort((a, b) => {
			if (a === this.state.newSylkDomain) return -1;
			if (b === this.state.newSylkDomain) return 1;
			return 0;
		});

        let serverLabel = "Choose another Sylk server";
        if (this.state.sylkDomain != this.state.newSylkDomain) {
			serverLabel = 'Back to current Sylk server';
        }
                
        let serverStyle = this.state.serverIsValid ? styles.recoverLink : styles.brokenServer;
        let placeholder = this.state.enrollmentUrl ? "No address? Just Sign up!" : "";
        let subtitle = this.state.showServer ? "Choose server" : "Sign in to continue";
        
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

	   if (this.props.showQRCodeScanner) {
        return (
            <View style={containerClass}>
				<Title style={styles.title}>Sylk</Title>
                <Subheading style={styles.subtitle}>Scan domain...</Subheading>
				<QRCodeScanner
					onRead={this.QRCodeRead}
					showMarker={true}
					flashMode={RNCamera.Constants.FlashMode.off}
					containerStyle={styles.QRcodeContainer}
				 />
			</View>
		 );
		}
		
		let connection_state = this.state.connection?.state || 'disconnected';
		
		//console.log('connection_state', connection_state);
		let serverState = 'Server is ' + connection_state;
		
		if (connection_state === null) {
			serverState = "Connecting...";
		}

		if (connection_state === 'closed') {
			connection_state = "disconnected";
		}
		
		if (this.state.SylkServerDiscovery) {
			serverState = 'Discovering...'
		}

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
										!this.state.serverIsValid ||
										this.state.SylkServerDiscovery
									}
								>
									Sign Up
								</Button>
							) : null
						)}
					</View>
				) : null }

                {!this.state.registering && this.state.accountId && this.state.serverIsValid && !this.state.showServer && this.state.serverSettingsUrl && this.state.passwordRecoveryUrl ?

                <Text onPress={handleRecoveryLink} style={styles.recoverLink}>
                    Recover lost password...
                </Text>
                : null }

                {(!this.state.showServer) ?
                <Text style={styles.recoverLink}>
                    Sylk server: {this.state.sylkDomain}
                </Text>
                :null}

                {this.state.showServer ?
                <View style={styles.row}>
                    <TextInput
						ref={this.sylkDomainRef}
                        mode="flat"
                        style={styles.input}
                        label="Sylk server"
                        selection={this.state.selection}
                        editable={!this.state.domainChecked}
                        value={this.state.newSylkDomain}
                        onChangeText={this.changeSylkDomain}
                        autoCapitalize="none"
						right={
						  <TextInput.Icon
							forceTextInputFocus={false}
							icon="qrcode-scan"
							onPress={() => this.props.toggleQRCodeScannerFunc()}
						  />
						}
                    />
                </View>
                : null}

                {(this.state.showServer && sylkServers.indexOf(this.state.newSylkDomain) === -1) ?
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

                {this.hasAccounts ?
                <Text onPress={this.helpLink} style={(this.state.domainChecked || connection_state == 'ready' || this.state.SylkServerDiscovery) ? styles.goodServer : styles.brokenServer}>
                    {this.state.SylkServerStatus || serverState}
                </Text>
                : null}                

                {(!this.state.SylkServerDiscovery && !this.state.registering) ?
                <Text onPress={this.changeServer} style={serverStyle}>
                    {serverLabel}
                </Text>
                :null}

				{this.state.showServer && sortedServers.length > 0 && sylkServers.indexOf(this.state.newSylkDomain) > -1? (
					<ScrollView style={styles.serverList} nestedScrollEnabled>
						{sortedServers.map((domain, index) => {
							const isSelected = domain === this.state.newSylkDomain;
				
							return (
								<Button
									key={index}
									mode={isSelected ? "contained" : "outlined"}
									style={styles.serverItem}
									onPress={() => this.selectSylkServer(domain)}
								>
									{domain}
								</Button>
							);
						})}
					</ScrollView>
				) : null}

                <Text style={styles.wsUrl}>
                    {this.state.wsUrlVisible && false ? this.state.wsUrl : ''}
                </Text>
                
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
    handleSignIn: PropTypes.func,
    handleEnrollment: PropTypes.func,
    registrationInProgress: PropTypes.bool,
    orientation: PropTypes.string,
    isTablet: PropTypes.bool,
    myPhoneNumber: PropTypes.string,
    lookupSylkServer: PropTypes.func,
    SylkServerDiscovery: PropTypes.bool,
    SylkServerDiscoveryResult: PropTypes.string,
    SylkServerStatus: PropTypes.string,
    resetSylkServerStatus: PropTypes.func,
    showQRCodeScanner      : PropTypes.bool,
    toggleQRCodeScannerFunc: PropTypes.func,
    requestCameraPermission: PropTypes.func,
    configurations: PropTypes.object,
    accounts: PropTypes.object,
    serversAccounts: PropTypes.object,
    connection: PropTypes.object,
    wsUrl: PropTypes.string,
    passwordRecoveryUrl: PropTypes.string,
};

export default RegisterForm;
