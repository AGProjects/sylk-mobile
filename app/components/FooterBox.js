// SPDX-FileCopyrightText: 2020, AG Projects
// SPDX-License-Identifier: GPL-3.0-only

import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import styles from '../assets/styles/blink/_Footer.scss';

const FooterBox = () => {
    return (
        <View style={styles.container}>
            <Text style={styles.text}>&copy; AG Projects</Text>
        </View>
    );
};

export default FooterBox
