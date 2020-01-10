import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import styles from '../assets/styles/blink/_Footer.scss';

const FooterBox = () => {
    return (
        <View style={styles.container}>
            <View>
                <View>
                    <Text style={styles.text}>Copyright &copy;AG Projects</Text>
                </View>
            </View>
        </View>
    );
};

export default FooterBox