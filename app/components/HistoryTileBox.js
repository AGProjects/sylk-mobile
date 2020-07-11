import React from 'react';
import PropTypes from 'prop-types';
import { SafeAreaView, ScrollView, View, FlatList, Text } from 'react-native';
import HistoryCard from './HistoryCard';

import styles from '../assets/styles/blink/_HistoryTileBox.scss';

const HistoryTileBox = (props) => {

  const renderItem = ({ item }) => (
    <HistoryCard
        historyItem={item}
        orientation={props.orientation}
        setTargetUri={props.setTargetUri}
        startVideoCall={props.startVideoCall}
        startAudioCall={props.startAudioCall}
    />
  );

  let columns = props.orientation === 'landscape' ? 2 : 1;

  return (
    <SafeAreaView style={styles.container}>
      <FlatList horizontal={false}
        numColumns={columns}
        data={props.items}
        renderItem={renderItem}
        keyExtractor={item => item.sessionId}
        key={props.orientation}
      />
    </SafeAreaView>
  );

}

HistoryTileBox.propTypes = {
    items    : PropTypes.array,
    orientation : PropTypes.string,
    startAudioCall : PropTypes.func,
    startVideoCall : PropTypes.func,
    setTargetUri   : PropTypes.func
};


export default HistoryTileBox;
