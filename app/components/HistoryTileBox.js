import React from 'react';
import PropTypes from 'prop-types';
import { View } from 'react-native';

const HistoryTileBox = (props) => {
    return (
        <View>
            {props.children}
        </View>
    );
}

HistoryTileBox.propTypes = {
    children    : PropTypes.node
};


export default HistoryTileBox;
