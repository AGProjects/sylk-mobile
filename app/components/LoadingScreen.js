import React from 'react';
import PropTypes from 'prop-types';
import { View } from 'react-native';
import { Title, Modal, Portal } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import styles from '../assets/styles/blink/_LoadingScreen.scss';

const LoadingScreen = (props) => {
    const containerClass = props.orientation === 'landscape' ? styles.landscapeContainer : styles.portraitContainer;

    return (
        <Portal>
            <Modal dismissable={false} visible={props.show}>
                <View style={containerClass}>
                    <Icon style={styles.icon} color="white" name="network" size={48}/>
                    {props.text ?
                        <Title style={styles.title}>{props.text}</Title>
                    : null }
                </View>
            </Modal>
        </Portal>
    );
}

LoadingScreen.propTypes = {
    text: PropTypes.string,
    show: PropTypes.bool,
    orientation: PropTypes.string
};

export default LoadingScreen;
