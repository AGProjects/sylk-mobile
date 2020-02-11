import React from 'react';
import PropTypes from 'prop-types';
import { ScrollView } from 'react-native';

const HistoryTileBox = (props) => {
    return (
        <ScrollView>
            {props.children}
        </ScrollView>
    );
}

HistoryTileBox.propTypes = {
    children    : PropTypes.node
};


export default HistoryTileBox;
