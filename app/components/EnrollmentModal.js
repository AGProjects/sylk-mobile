import React, { Component } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import PropTypes from 'prop-types';
import superagent from 'superagent';
import autoBind from 'auto-bind';
import { Portal, Dialog, TextInput, Button, Snackbar, Surface } from 'react-native-paper';
import { Modal, TouchableWithoutFeedback, KeyboardAvoidingView, ScrollView } from 'react-native';

import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import LoadingScreen from './LoadingScreen';

import styles from '../assets/styles/blink/_EnrollmentModal.scss';
import containerStyles from '../assets/styles/ContainerStyles';

// Short, easy-to-pronounce English words used to build a memorable
// auto-suggested password (see generateMemorablePassword). Kept all
// lowercase here so the generator can apply a consistent CamelCase
// without worrying about source casing. Curated to avoid words that
// look alike when typed (no homoglyphs / no offensive terms).
const PASSWORD_WORDS = [
    'apple','berry','cloud','drive','eagle','frost','glass','honey',
    'ivory','juice','knife','lemon','maple','night','ocean','pearl',
    'quartz','river','stone','tiger','umber','vivid','whale','xenon',
    'yacht','zebra','bird','cake','dawn','echo','flame','grape',
    'harbor','iron','jelly','kite','lime','moon','nest','orange',
    'plum','quill','rain','sand','tree','urban','velvet','wind',
    'yarn','zen','copper','silver','golden','crystal','marble','willow',
    'cedar','birch','meadow','valley','canyon','breeze','ember','spark'
];

// Build a memorable password of the form Word<digit>Word,
// e.g. "Moon5River" / "Ember3Canyon". Two distinct words from
// PASSWORD_WORDS are picked at random, each capitalized, with a
// 1–9 digit sandwiched between them. Putting the digit in the
// middle (rather than the end) breaks the all-letters streak in
// the visual middle of the string, which most users find easier
// to recall than a trailing number. Total length lands in the
// 7–14 char range, satisfying typical "min 8" policies.
function generateMemorablePassword() {
    const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
    const a = PASSWORD_WORDS[Math.floor(Math.random() * PASSWORD_WORDS.length)];
    let b;
    do {
        b = PASSWORD_WORDS[Math.floor(Math.random() * PASSWORD_WORDS.length)];
    } while (b === a);
    const digit = Math.floor(Math.random() * 9) + 1; // 1..9, avoid leading-0 surprises
    return `${cap(a)}${digit}${cap(b)}`;
}

class EnrollmentModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.initialState = {
            username: '',
            password: '',
            password2: '',
            email: '',
            // Tracks whether the user has manually edited the email
            // field. While false, every keystroke in the username
            // field re-derives email as `<username>@` — handy because
            // most people reuse the same local-part across services
            // (alice@gmail.com, alice@work.com, …) so they only need
            // to type the domain. Set true the moment the user types
            // (or pastes) into the email input directly, and reset
            // back to false when they tap the trailing X to clear.
            emailUserEdited: false,
            enrolling: false,
            error: '',
            errorVisible: false,
            myPhoneNumber: props.myPhoneNumber,
            showPassword: false
        };
        this.state = { ...this.initialState };
    }

    handleFormFieldChange(value, name) {
        if (name === 'username') {
            value = value.replace(/[^\w|\.\-]/g, '').trim().toLowerCase();
            const updates = { username: value };
            // Mirror username into email as `<username>@` until the
            // user starts editing email by hand. Empty username →
            // empty email (rather than a stranded "@") so the field
            // doesn't look broken before any typing happens.
            if (!this.state.emailUserEdited) {
                updates.email = value ? `${value}@` : '';
            }
            this.setState(updates);
            return;
        }
        if (name === 'email') {
            value = value.trim().toLowerCase();
            // Any direct edit of email locks out the username→email
            // auto-mirror so we don't fight the user.
            this.setState({ email: value, emailUserEdited: true });
            return;
        }
        value = value.trim();
        this.setState({ [name]: value });
    }

    // Wipes the email field and re-arms the username→email
    // auto-mirror — typing more in username after a clear will once
    // again pre-fill `<username>@`.
    clearEmail() {
        this.setState({ email: '', emailUserEdited: false });
    }

    get validInput() {
        const { username, password, password2, email, enrolling } = this.state;
        const emailReg = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/;
        const validEmail = emailReg.test(email);

        return !enrolling &&
            username.length > 2 &&
            password !== '' &&
            password === password2 &&
            validEmail;
    }

	componentDidUpdate(prevProps) {
		if (!prevProps.show && this.props.show) {
			// Modal just opened. Auto-suggest a memorable password and
			// mirror it into the confirm field so the user doesn't have
			// to invent (and re-type) one. We only auto-fill when both
			// password fields are empty so we never clobber whatever the
			// user typed if the modal re-renders for some other reason.
			// Kept hidden by default — the user can tap the eye to
			// reveal the suggested value if they want to read or change
			// it.
			if (!this.state.password && !this.state.password2) {
				const suggested = generateMemorablePassword();
				this.setState({
					password: suggested,
					password2: suggested,
				});
			}
			setTimeout(() => {
				this.usernameInput && this.usernameInput.focus();
			}, 250); // small delay helps with Modal rendering
		}
	}

    enroll(event) {
        if (event) event.preventDefault();
        this.setState({ enrolling: true, error: '' });

        const emailReg = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/;
        const validEmail = emailReg.test(this.state.email);

        const data = {
            username: this.state.username,
            password: this.state.password,
            phoneNumber: this.state.myPhoneNumber,
            display_name: this.state.username
        };

        if (validEmail) data.email = this.state.email;

		console.log('Enrollment requested for', this.state.username);
        superagent.post(this.props.enrollmentUrl)
            .send(superagent.serialize['application/x-www-form-urlencoded'](data))
            .end((error, res) => {
                this.setState({ enrolling: false });
                if (error) return this.setState({ error: error.toString(), errorVisible: true });

                let response;
                try { response = JSON.parse(res.text); } 
                catch (e) { return this.setState({ error: 'Could not decode response data', errorVisible: true }); }

                if (response.success) {
                    console.log('Enrollment succeeded');
                    this.props.handleEnrollment({
                        id: response.sip_address,
                        password: this.state.password,
                        displayName: this.state.username,
                        email: validEmail ? this.state.email : undefined
                    });
                    this.setState(this.initialState);
                } else if (response.error === 'user_exists') {
                    console.log('Enrollment failed, user exists');
                    this.setState({ error: 'Username is taken. Choose another one!', errorVisible: true });
                } else {
                    console.log('Enrollment failed', response.error_message);
                    this.setState({ error: response.error_message, errorVisible: true });
                }
            });
    }

    onHide() {
        this.props.handleEnrollment(null);
        this.setState(this.initialState);
    }

    renderPasswordFields() {
        return (
            <>
                <View style={{ position: 'relative', marginBottom: 16 }}>
                    {/* See username field comment — same hard opt-out from
                        Android Autofill / Google Password Manager so it
                        doesn't suggest saved passwords during what is a
                        brand-new account creation. */}
                    <TextInput
                        label="Password"
                        secureTextEntry={!this.state.showPassword}
                        value={this.state.password}
                        onChangeText={(text) => this.handleFormFieldChange(text, 'password')}
                        style={{ paddingRight: 40 }}
                        disabled={this.state.enrolling}
                        returnKeyType="next"
                        ref={ref => { this.passwordInput = ref; }}
                        onSubmitEditing={() => this.password2Input && this.password2Input.focus()}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="off"
                        importantForAutofill="no"
                    />
                    <TouchableOpacity
                        style={{ position: 'absolute', right: 0, top: 12, padding: 10 }}
                        onPress={() => this.setState({ showPassword: !this.state.showPassword })}
                    >
                        <MaterialCommunityIcons
                            name={this.state.showPassword ? 'eye-off' : 'eye'}
                            size={24}
                            color="gray"
                        />
                    </TouchableOpacity>

                <TextInput
                    label="Confirm Password"
                    secureTextEntry={!this.state.showPassword}  // same toggle
                    value={this.state.password2}
                    onChangeText={(text) => this.handleFormFieldChange(text, 'password2')}
                    disabled={this.state.enrolling}
                    returnKeyType="done"
                    ref={ref => { this.password2Input = ref; }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    importantForAutofill="no"
                />
                </View>
            </>
        );
    }

    render() {
        if (!this.props.show) return null;

        const emailReg = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/;
        const validEmail = emailReg.test(this.state.email);

        return (
		<Modal
		  style={containerStyles.container}
		  visible={this.props.show}
		  transparent
		  animationType="fade"
		  onRequestClose={this.onHide}
		>
	
		  <TouchableWithoutFeedback onPress={this.onHide}>
			<View style={containerStyles.overlay}>
			  <KeyboardAvoidingView
				behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
				keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
			  >
				{/* Prevent taps inside modal from dismissing */}
				<TouchableWithoutFeedback onPress={() => {}}>
	
				<Surface style={containerStyles.modalSurface}>

					<View style={{ width: '95%', marginHorizontal: '2.5%', marginVertical: 8 }}>
					  <Text style={{ textAlign: 'center', lineHeight: 20, fontSize: 18}}>
						Create Sylk account
					  </Text>
					</View>
	
					  {/* importantForAutofill="no" hard-disables Android's
					      autofill framework for this field — Google
					      Password Manager ignored the softer
					      "username-new" hint on at least one device, so we
					      take the explicit opt-out. autoComplete="off"
					      mirrors the same intent for any framework that
					      checks the W3C-style hint. Trade-off: the OS
					      will no longer offer to SAVE the new credentials
					      after enrollment either — but that's the
					      acceptable cost of stopping incorrect FILL
					      suggestions for what is a brand new identity. */}
					  <TextInput
						style={styles.row}
						label="Username"
						autoCapitalize="none"
						autoCorrect={false}
						autoComplete="off"
						importantForAutofill="no"
						value={this.state.username}
						onChangeText={(text) => this.handleFormFieldChange(text, 'username')}
						disabled={this.state.enrolling}
						returnKeyType="next"
						ref={ref => { this.usernameInput = ref; }}
						onSubmitEditing={() => this.passwordInput && this.passwordInput.focus()}
					  />
			
					  <TextInput
						style={styles.row}
						label="E-mail for password recovery"
						keyboardType="email-address"
						autoCapitalize="none"
						autoCorrect={false}
						value={this.state.email}
						onChangeText={(text) => this.handleFormFieldChange(text, 'email')}
						disabled={this.state.enrolling}
						returnKeyType="next"
						ref={ref => { this.emailInput = ref; }}
						onSubmitEditing={() => validEmail && this.usernameInput && this.usernameInput.focus()}
						right={
							// Discreet 18px gray X — only rendered when
							// there's something to clear so an empty
							// field stays clean. Tapping it wipes the
							// email AND resets the auto-mirror flag so
							// further typing in username will resume
							// pre-filling `<username>@`.
							this.state.email ?
							<TextInput.Icon
								icon="close"
								size={18}
								color="#999"
								forceTextInputFocus={false}
								accessibilityLabel="Clear email"
								onPress={this.clearEmail}
							/>
							: null
						}
					  />
			
					{this.renderPasswordFields()}
			
					{this.validInput ? (
					  <Button
						mode="contained"
						style={styles.button}
						disabled={!this.validInput}
						onPress={this.enroll}
					  >
						Sign Up
					  </Button>
					) : (
					  <Text style={styles.status}>
						{this.state.username.length <= 3 ? 'Enter username (min 4 letters)' :
						 !validEmail ? 'Enter valid email address' :
						 !this.state.password ? 'Enter password' :
						 this.state.password !== this.state.password2 ? 'Passwords do not match' : ''}
					  </Text>
					)}
			
					<Snackbar
					  style={styles.snackbar}
					  visible={this.state.errorVisible}
					  duration={4000}
					  onDismiss={() => this.setState({ errorVisible: false })}
					>
					  {this.state.error}
					</Snackbar>
	
				</Surface>
				</TouchableWithoutFeedback>
			  </KeyboardAvoidingView>
			</View>
		  </TouchableWithoutFeedback>
		</Modal>
        );
    }
}

EnrollmentModal.propTypes = {
	enrollmentUrl: PropTypes.string,
    handleEnrollment: PropTypes.func.isRequired,
    show: PropTypes.bool.isRequired,
    myPhoneNumber: PropTypes.string,
    orientation: PropTypes.string,
    isTablet: PropTypes.bool
};

export default EnrollmentModal;
