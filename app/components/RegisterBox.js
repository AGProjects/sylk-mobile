import React from 'react';
import { View, Text  } from 'react-native';
import PropTypes from 'prop-types';

import RegisterForm from './RegisterForm';
import Logo from './Logo';
import styles from '../assets/styles/blink/_RegisterBox.scss';

const RegisterBox = (props) => {
    let containerClass;

    if (props.isTablet) {
        containerClass = props.orientation === 'landscape' ? styles.landscapeTabletRegisterBox : styles.portraitTabletRegisterBox;
    } else {
        containerClass = props.orientation === 'landscape' ? styles.landscapeRegisterBox : styles.portraitRegisterBox;
    }

    return (
        <View style={containerClass}>
            {props.showLogo ?
            <View>
                <Logo
                    orientation={props.orientation}
                    isTablet={props.isTablet}
                />

            </View>
            : null}

            <View>
                <RegisterForm
                    registrationInProgress={props.registrationInProgress}
                    handleSignIn={props.handleSignIn}
                    handleEnrollment={props.handleEnrollment}
                    orientation={props.orientation}
                    isTablet={props.isTablet}
                    connected={props.connected}
                    myPhoneNumber={props.myPhoneNumber}
                />

            </View>

        </View>
    );
};

RegisterBox.propTypes = {
    handleSignIn           : PropTypes.func.isRequired,
    handleEnrollment       : PropTypes.func.isRequired,
    registrationInProgress : PropTypes.bool,
    showLogo               : PropTypes.bool,
    orientation            : PropTypes.string,
    isTablet               : PropTypes.bool,
    connected              : PropTypes.bool,
    myPhoneNumber          : PropTypes.string
};

export default RegisterBox;
