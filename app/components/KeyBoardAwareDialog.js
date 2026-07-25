import React, { memo, useState, useEffect } from 'react';
import { View, Dimensions, Platform } from 'react-native';
import { Dialog } from 'react-native-paper';
import KeyboardSpacer from './KeyboardSpacer';

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
      <View onLayout={onLayout} style={{ backgroundColor: '#fff' }}>
        {children}
      </View>
      {/* iOS only: it has no window resize for the keyboard, so the spacer
          lifts the dialog above it. Android uses windowSoftInputMode=
          adjustResize, which already resizes the window and centers the
          dialog above the keyboard — adding the spacer there double-
          compensates (dialog pushed off the top, gap above the keyboard). */}
      {Platform.OS === 'ios' && <KeyboardSpacer topSpacing={topSpacing} />}
    </Dialog>
  );
});
