import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import { View, TouchableWithoutFeedback} from 'react-native';
import { Appbar } from 'react-native-paper';
import FadeInView from './FadeInView';

import styles from '../assets/styles/blink/_ConfDrawer.scss';
// const styleSheet = {
//     paper: {
//         width: 350,
//         backgroundColor: Grey[100],
//         borderLeft: '1px solid rgba(0, 0, 0, 0.12)',
//         borderRight: 0
//     },
//     title: {
//         flex: '0 1 auto'
//     },
//     grow: {
//         flex: '1 1 auto'
//     },
//     toolbar: {
//         minHeight: '50px',
//         height: 50
//     }
// };

const ConferenceDrawer = props => {
    const [visible, setVisible] = useState(props.show);
    const [open, setOpen] = useState(false);

    const closed = () => {
        setVisible(false);
        setOpen(false);
    }

    const opened = () => {
        setOpen(true);
    }

    useEffect(() => {
        if (!visible && props.show === true) {
            setVisible(props.show);
        }
        if (visible && props.show === false) {
            setOpen(false);
        }
    }, [props.show])

    let returnData = null;
    let touch;
    if (open) {
        touch = (<TouchableWithoutFeedback onPress={props.close} >
            <View style={[styles.flex, styles.backdrop, props.showBackdrop !== false && styles.backdropColor]}  />
        </TouchableWithoutFeedback>);
    }
    if (visible) {
        returnData = (
            <View style={styles.container}>
                {touch}
                <FadeInView
                    style={styles.margin}
                    visible={props.show}
                    onClose={closed}
                    onOpen={opened}
                    isLandscape={props.isLandscape}
                >
                    <View style={styles.flex}>
                        <Appbar.Header dark={true} style={[styles.negative, styles.drawerColor]}>
                            <Appbar.BackAction color="#000" onPress={props.close} />
                            <Appbar.Content color="#000" title={props.title} />
                        </Appbar.Header>
                        {props.children}
                    </View>
                </FadeInView>
            </View>
        )
    }
    return (returnData)
};

ConferenceDrawer.propTypes = {
    show        : PropTypes.bool.isRequired,
    close       : PropTypes.func.isRequired,
    children    : PropTypes.node,
    isLandscape : PropTypes.bool,
    showBackdrop: PropTypes.bool,
    title       : PropTypes.string
};

export default ConferenceDrawer;
