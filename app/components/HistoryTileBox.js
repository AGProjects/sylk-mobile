import React from 'react';
import PropTypes from 'prop-types';
import { ScrollView } from 'react-native';

import styles from '../assets/styles/blink/_HistoryTileBox.scss';

const HistoryTileBox = (props) => {
    return (
        <ScrollView style={styles.container}>
            {props.children}
        </ScrollView>
    );
}

HistoryTileBox.propTypes = {
    children    : PropTypes.node
};


export default HistoryTileBox;
