import React, { Component } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import PropTypes from 'prop-types';
import superagent from 'superagent';
import autoBind from 'auto-bind';
import { Portal, Dialog, TextInput, Button, Snackbar } from 'react-native-paper';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import LoadingScreen from './LoadingScreen';
import styles from '../assets/styles/blink/_EnrollmentModal.scss';

class EnrollmentModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.initialState = {
            username: '',
            password: '',
            password2: '',
            email: '',
            enrolling: false,
            error: '',
            errorVisible: false,
            myPhoneNumber: props.myPhoneNumber,
            showPassword: false
        };
        this.state = { ...this.initialState };
    }

    handleFormFieldChange(value, name) {
        if (name === 'username') value = value.replace(/[^\w|\.\-]/g, '').trim().toLowerCase();
        else if (name === 'email') value = value.trim().toLowerCase();
        else value = value.trim();
        this.setState({ [name]: value });
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
		<Portal>
		  <Dialog visible={this.props.show} onDismiss={this.onHide}>
			<Dialog.ScrollArea>
			  <KeyboardAwareScrollView
				contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 16 }}
				enableOnAndroid={true}
				keyboardShouldPersistTaps="handled"
				extraScrollHeight={120}       
			  >
				<View style={{ width: '95%', marginHorizontal: '2.5%', marginVertical: 8 }}>
				  <Text style={{ textAlign: 'center', lineHeight: 20, fontSize: 18}}>
					Create SIP address
				  </Text>
				</View>

				  <TextInput
					style={styles.row}
					label="Username"
					autoCapitalize="none"
					autoCorrect={false}
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
				  />
		
				{this.state.username.length > 2 && this.renderPasswordFields()}
		
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
					{this.state.username.length <= 3 ? 'Enter username' :
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
			  </KeyboardAwareScrollView>
			</Dialog.ScrollArea>
		  </Dialog>
		</Portal>

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
