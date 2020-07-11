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
        isTablet={props.isTablet}
    />
  );

  let columns = 1;
  if (props.isTablet) {
      columns = props.orientation === 'landscape' ? 3 : 2;
  } else {
      columns = props.orientation === 'landscape' ? 2 : 1;
  }

  let items = props.historyItems.concat(props.contactItems);

/*
  console.log('History items', props.historyItems);
  console.log('Contacts items', props.contactItems);
  console.log('All items', items);
*/

  return (
    <SafeAreaView style={styles.container}>
      <FlatList horizontal={false}
        numColumns={columns}
        data={items}
        renderItem={renderItem}
        keyExtractor={item => item.sessionId}
        key={props.orientation}
      />
    </SafeAreaView>
  );

}

HistoryTileBox.propTypes = {
    historyItems    : PropTypes.array,
    contactItems    : PropTypes.array,
    orientation : PropTypes.string,
    startAudioCall : PropTypes.func,
    startVideoCall : PropTypes.func,
    setTargetUri   : PropTypes.func,
    isTablet       : PropTypes.bool
};


export default HistoryTileBox;
