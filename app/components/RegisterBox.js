import React from 'react';
import { View, Text, Linking  } from 'react-native';
import PropTypes from 'prop-types';

import RegisterForm from './RegisterForm';
import Logo from './Logo';
import styles from '../assets/styles/blink/_RegisterBox.scss';
import FooterBox from './FooterBox';

function handleLink(event) {
    Linking.openURL('https://mdns.sipthor.net/sip_login_reminder.phtml');
}

const RegisterBox = (props) => {
    let containerClass;

    if (props.isTablet) {
        containerClass = props.orientation === 'landscape' ? styles.landscapeTabletRegisterBox : styles.portraitTabletRegisterBox;
    } else {
        containerClass = props.orientation === 'landscape' ? styles.landscapeRegisterBox : styles.portraitRegisterBox;
    }


    return (
        <View style={containerClass}>
            <View>
                <Logo
                    orientation={props.orientation}
                    isTablet={props.isTablet}
                />
            </View>
            <View>
                <RegisterForm
                    registrationInProgress={props.registrationInProgress}
                    handleRegistration={props.handleRegistration}
                    autoLogin={props.autoLogin}
                    orientation={props.orientation}
                    isTablet={props.isTablet}
                    phoneNumber={props.phoneNumber}
                />
                <Text onPress={() => handleLink()} style={styles.recoverLink}>Recover lost passsword...</Text>
                <FooterBox />
            </View>

        </View>
    );
};

RegisterBox.propTypes = {
    handleRegistration     : PropTypes.func.isRequired,
    registrationInProgress : PropTypes.bool,
    autoLogin              : PropTypes.bool,
    orientation            : PropTypes.string,
    isTablet               : PropTypes.bool,
    phoneNumber            : PropTypes.string
};

export default RegisterBox;
