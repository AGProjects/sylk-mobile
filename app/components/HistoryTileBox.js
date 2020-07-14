import React, { Component} from 'react';
import autoBind from 'auto-bind';

import PropTypes from 'prop-types';
import { SafeAreaView, ScrollView, View, FlatList, Text } from 'react-native';
import HistoryCard from './HistoryCard';
import utils from '../utils';

import styles from '../assets/styles/blink/_HistoryTileBox.scss';


class HistoryTileBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.startItem = 0;
        this.maxItems = 10;
    }

    renderItem(item) {
        return(
            <HistoryCard
            contact={item.item}
            setTargetUri={this.props.setTargetUri}
            startVideoCall={this.props.startVideoCall}
            startAudioCall={this.props.startAudioCall}
            orientation={this.props.orientation}
            isTablet={this.props.isTablet}
            />);
    }

    render() {
        //utils.timestampedLog('Render history in', this.props.orientation);

        let columns = 1;

        if (this.props.isTablet) {
            columns = this.props.orientation === 'landscape' ? 3 : 2;
        } else {
            columns = this.props.orientation === 'landscape' ? 2 : 1;
            this.maxItems =  this.props.orientation === 'landscape' ? 50 : 8;
        }

        let allItems = this.props.historyItems.concat(this.props.contactItems);
        let items = allItems.slice(this.startItem, this.maxItems);

        return (
            <SafeAreaView style={styles.container}>
              <FlatList horizontal={false}
                numColumns={columns}
                data={items}
                renderItem={this.renderItem}
                keyExtractor={item => item.sessionId}
                key={this.props.orientation}
              />
            </SafeAreaView>
        );
    }
}

HistoryTileBox.propTypes = {
    historyItems    : PropTypes.array,
    contactItems    : PropTypes.array,
    orientation     : PropTypes.string,
    startAudioCall  : PropTypes.func,
    startVideoCall  : PropTypes.func,
    setTargetUri    : PropTypes.func,
    isTablet        : PropTypes.bool
};


export default HistoryTileBox;
