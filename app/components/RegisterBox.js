import React from 'react';
import { View } from 'react-native';
import PropTypes from 'prop-types';

import RegisterForm from './RegisterForm';
import Logo from './Logo';
import styles from '../assets/styles/blink/_RegisterBox.scss';

const RegisterBox = (props) => {
    return (
        <View style={styles.registerBox}>
            <Logo />
            <RegisterForm
                registrationInProgress={props.registrationInProgress}
                handleRegistration={props.handleRegistration}
                autoLogin={props.autoLogin}
            />
        </View>
    );
};

RegisterBox.propTypes = {
    handleRegistration     : PropTypes.func.isRequired,
    registrationInProgress : PropTypes.bool,
    autoLogin              : PropTypes.bool
};

export default RegisterBox;
