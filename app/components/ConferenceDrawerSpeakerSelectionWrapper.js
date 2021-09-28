import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import { Title, Button } from 'react-native-paper';

import styles from '../assets/styles/blink/_ConferenceDrawerSpeakerSelectionWrapper.scss';

const ConferenceDrawerSpeakerSelectionWrapper = props => {
    let buttonText;
    let secondButtonText;
    let speaker;

    switch (props.activeSpeakers.length) {
        case 1:
            speaker = props.activeSpeakers[0];
            buttonText = speaker.identity.displayName || speaker.identity.uri;
            break;
        case 2:
            speaker = props.activeSpeakers[0];
            buttonText = speaker.identity.displayName || speaker.identity.uri;
            speaker = props.activeSpeakers[1];
            secondButtonText = speaker.identity.displayName || speaker.identity.uri;
            break;
        default:
            break;
    }

    const twoButtons = props.activeSpeakers.length >= 1;
    return (
        <Fragment>
            <Title>Active speakers</Title>
            <Button
                style={[styles.firstButton, !twoButtons && styles.onlyButton]}
                icon="account"
                mode="contained"
                onPress={() => props.selectSpeaker(1)}
            >
                {buttonText || 'Select first speaker'}
            </Button>
            { twoButtons &&
                <Button
                    style={styles.onlyButton}
                    icon="account"
                    mode="contained"
                    onPress={() => props.selectSpeaker(2)}
                >
                    {secondButtonText || 'Select second speaker'}
                </Button>
            }
        </Fragment>
    );
};

ConferenceDrawerSpeakerSelectionWrapper.propTypes = {
    selectSpeaker: PropTypes.func,
    activeSpeakers: PropTypes.array
};

export default ConferenceDrawerSpeakerSelectionWrapper;

