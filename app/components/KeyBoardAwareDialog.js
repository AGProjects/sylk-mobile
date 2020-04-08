import React, { memo, useState, useEffect } from 'react';
import { View, Dimensions } from 'react-native';
import { Dialog, Colors } from 'react-native-paper';
import KeyboardSpacer from 'react-native-keyboard-spacer';

const windowHeight = Dimensions.get('window').height;
const halfWindowHeight = windowHeight / 2;

export default memo(({ children, ...rest }) => {
  const [topSpacing, setTopSpacing] = useState(10);
  const [height, setHeight] = useState(0);

  const onLayout = ({nativeEvent: { layout: {height : _height}}}) => {
    if (!height && height !== _height) {
      setHeight(_height);
    }
  };

  useEffect(() => {
    const newTopSpacing = - halfWindowHeight + height;
    setTopSpacing(newTopSpacing);
  }, [height])

  return (
    <Dialog
      {...rest}
      style={{ backgroundColor: 'transparent' }}
    >
      <View onLayout={onLayout} style={{ backgroundColor: Colors.white }}>
        {children}
      </View>
      <KeyboardSpacer topSpacing={topSpacing} />
    </Dialog>
  );
});