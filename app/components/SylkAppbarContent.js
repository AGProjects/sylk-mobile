import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';

const SylkAppbarContent = (props) => {
  const defaultTitleStyle = { color: 'white' };
  const defaultSubtitleStyle = { color: 'white' };

  return (
    <View style={{ flex: 1 }}>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[defaultTitleStyle, props.titleStyle]}
      >
        {props.title}
      </Text>

      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[defaultSubtitleStyle, props.subtitleStyle]}
      >
        {props.subtitle}
      </Text>
    </View>
  );
};


export default SylkAppbarContent;
