import React from 'react';
import PropTypes from 'prop-types';
import { View } from 'react-native';
import { Title, Modal, Portal, ActivityIndicator, Colors } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import styles from '../assets/styles/blink/_LoadingScreen.scss';

const LoadingScreen = (props) => {
    let containerClass;

    if (props.isTablet) {
        containerClass = props.orientation === 'landscape' ? styles.landscapeTabletContainer : styles.portraitTabletContainer;
    } else {
        containerClass = props.orientation === 'landscape' ? styles.landscapeContainer : styles.portraitContainer;
    }

    return (
        <Portal>
            <Modal dismissable={false} visible={props.show}>
                <View style={containerClass}>
                    <ActivityIndicator animating={true} size={'large'} color={Colors.red800} />
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
    orientation: PropTypes.string,
    isTablet   : PropTypes.bool

};

export default LoadingScreen;
