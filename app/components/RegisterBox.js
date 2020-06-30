import React from 'react';
import { View } from 'react-native';
import PropTypes from 'prop-types';

import RegisterForm from './RegisterForm';
import Logo from './Logo';
import styles from '../assets/styles/blink/_RegisterBox.scss';


const RegisterBox = (props) => {
    const containerClass = props.orientation === 'landscape' ? styles.landscapeRegisterBox : styles.portraitRegisterBox;

    return (
        <View style={containerClass}>
        <View>
            <Logo/>
        </View>
        <View>
            <RegisterForm
                registrationInProgress={props.registrationInProgress}
                handleRegistration={props.handleRegistration}
                autoLogin={props.autoLogin}
                orientation={props.orientation}
            />
        </View>
        </View>
    );
};

RegisterBox.propTypes = {
    handleRegistration     : PropTypes.func.isRequired,
    registrationInProgress : PropTypes.bool,
    autoLogin              : PropTypes.bool,
    orientation            : PropTypes.string
};

export default RegisterBox;
