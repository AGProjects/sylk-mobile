import React, { useRef, useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import { Dimensions, Animated } from 'react-native';


const FadeInView = props => {
    const [visible, setVisible] = useState(props.visible);
    const fadeAnim = useRef(new Animated.Value(props.visble ? 1 : 0)).current;

    const screen_width = Dimensions.get('window').width;

    let outputRange = [screen_width, 0];
    if (props.isLandscape) {
        outputRange = [screen_width, screen_width * 0.2];
    }

    useEffect(() => {
        if (!visible && props.visible === true) {
            setVisible(props.visible);
        }
        Animated.timing(
            fadeAnim,
            {
                toValue: props.visible ? 1 : 0,
                duration: 300,
                useNativeDriver: true
            }
        ).start(() => {
            setVisible(props.visible);
            if (props.visible === false && props.onClose) {
                props.onClose();
            } else if (props.onOpen) {
                props.onOpen();
            }
        });
    }, [fadeAnim, props.visible, props.isLandscape])

    return (
        <Animated.View
            style={{
                ...props.style,
                opacity: fadeAnim,
                width: props.isLandscape ? '80%' : '100%',
                transform: [{
                    translateX: fadeAnim.interpolate({
                        inputRange: [0,1],
                        outputRange: outputRange
                    })
                }],
            }}
        >
            {visible === true ? props.children : null}
        </Animated.View>
    );
};

FadeInView.propTypes = {
    visible     : PropTypes.bool.isRequired,
    style       : PropTypes.object,
    isLandscape : PropTypes.bool,
    children    : PropTypes.node,
    onClose     : PropTypes.func,
    onOpen      : PropTypes.func
};

export default FadeInView;
