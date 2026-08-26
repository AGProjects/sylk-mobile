import React, { memo, useState, useEffect } from 'react';
import { View, Dimensions, Platform } from 'react-native';
import { Dialog, ThemeProvider } from 'react-native-paper';
import KeyboardSpacer from './KeyboardSpacer';
import getAppPaperTheme from '../paperTheme';
import containerStyles from '../assets/styles/ContainerStyles';

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

  // The card. This wrapper is the visible modal surface (the Paper Dialog
  // itself is made transparent above it), so it — not the caller — owns the
  // rounded corners and the background. It used to be a bare
  // `{ backgroundColor: '#fff' }` View: square corners in an app whose every
  // other modal is a 10dp-radius ThemedModalSurface, and hardcoded white, so
  // in Night mode it painted a white slab behind the themed content. Both are
  // fixed here rather than in each caller, since every consumer of this
  // dialog had the same two defects. overflow:'hidden' clips children (a
  // Dialog.Title with its own background, a full-bleed row) to the radius.
  const theme = getAppPaperTheme();
  const cardBg = theme.dark ? '#2A2A2A' : theme.colors.surface;
  const edge = theme.dark
    ? { borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' }
    : null;

  return (
    <Dialog
      {...rest}
      style={{ backgroundColor: 'transparent' }}
    >
      <ThemeProvider theme={theme}>
      <View
        onLayout={onLayout}
        style={[
          containerStyles.modalSurface,
          { backgroundColor: cardBg, overflow: 'hidden' },
          edge,
        ]}
      >
        {children}
      </View>
      </ThemeProvider>
      {/* iOS only: it has no window resize for the keyboard, so the spacer
          lifts the dialog above it. Android uses windowSoftInputMode=
          adjustResize, which already resizes the window and centers the
          dialog above the keyboard — adding the spacer there double-
          compensates (dialog pushed off the top, gap above the keyboard). */}
      {Platform.OS === 'ios' && <KeyboardSpacer topSpacing={topSpacing} />}
    </Dialog>
  );
});
