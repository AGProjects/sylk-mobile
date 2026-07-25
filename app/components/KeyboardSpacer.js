// In-repo replacement for the dead, locally-patched react-native-keyboard-spacer
// (2026-07-23). Pure JS — a bottom spacer View whose height animates to the
// on-screen keyboard height, so content above it lifts clear of the keyboard.
// Reproduces the old library's behavior and API 1:1 (default export, `topSpacing`
// / `onToggle` / `style` props), so the call sites only change their import path.
//
// Chosen over react-native-keyboard-controller: that library would require
// adding react-native-reanimated (a heavy native dep + babel plugin, not
// installed) and a root <KeyboardProvider> — disproportionate for two small
// spacer usages (KeyBoardAwareDialog iOS-only, and ChatBox off-by-default).
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import {
    Keyboard,
    LayoutAnimation,
    View,
    Dimensions,
    Platform,
    StyleSheet,
} from 'react-native';

const styles = StyleSheet.create({
    container: {
        left: 0,
        right: 0,
        bottom: 0,
    },
});

// Matches react-native-keyboard-spacer's fallback animation (used on Android,
// which doesn't provide keyboard duration/easing in the event).
const defaultAnimation = {
    duration: 500,
    create: {
        duration: 300,
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
    },
    update: {
        type: LayoutAnimation.Types.spring,
        springDamping: 200,
    },
};

export default class KeyboardSpacer extends Component {
    constructor(props) {
        super(props);
        this.state = { keyboardSpace: 0, isKeyboardOpened: false };
        this._listeners = [];
    }

    componentDidMount() {
        // iOS gives will-show/hide (with duration/easing) for a smooth lift;
        // Android only fires did-show/hide.
        const updateListener = Platform.OS === 'android' ? 'keyboardDidShow' : 'keyboardWillShow';
        const resetListener = Platform.OS === 'android' ? 'keyboardDidHide' : 'keyboardWillHide';
        this._listeners = [
            Keyboard.addListener(updateListener, this.updateKeyboardSpace),
            Keyboard.addListener(resetListener, this.resetKeyboardSpace),
        ];
    }

    componentWillUnmount() {
        this._listeners.forEach((listener) => listener.remove());
    }

    updateKeyboardSpace = (event) => {
        if (!event.endCoordinates) {
            return;
        }
        let animationConfig = defaultAnimation;
        if (Platform.OS === 'ios' && event.duration && event.easing) {
            animationConfig = LayoutAnimation.create(
                event.duration,
                LayoutAnimation.Types[event.easing],
                LayoutAnimation.Properties.opacity,
            );
        }
        LayoutAnimation.configureNext(animationConfig);

        const screenHeight = Dimensions.get('window').height;
        const keyboardSpace = (screenHeight - event.endCoordinates.screenY) + (this.props.topSpacing || 0);
        this.setState({ keyboardSpace, isKeyboardOpened: true }, () => {
            if (this.props.onToggle) {
                this.props.onToggle(true, keyboardSpace);
            }
        });
    };

    resetKeyboardSpace = (event) => {
        let animationConfig = defaultAnimation;
        if (Platform.OS === 'ios' && event && event.duration && event.easing) {
            animationConfig = LayoutAnimation.create(
                event.duration,
                LayoutAnimation.Types[event.easing],
                LayoutAnimation.Properties.opacity,
            );
        }
        LayoutAnimation.configureNext(animationConfig);

        this.setState({ keyboardSpace: 0, isKeyboardOpened: false }, () => {
            if (this.props.onToggle) {
                this.props.onToggle(false, 0);
            }
        });
    };

    render() {
        return (
            <View style={[styles.container, { height: this.state.keyboardSpace }, this.props.style]} />
        );
    }
}

KeyboardSpacer.propTypes = {
    topSpacing: PropTypes.number,
    onToggle: PropTypes.func,
    style: PropTypes.oneOfType([PropTypes.object, PropTypes.number, PropTypes.array]),
};

KeyboardSpacer.defaultProps = {
    topSpacing: 0,
    onToggle: null,
    style: null,
};
