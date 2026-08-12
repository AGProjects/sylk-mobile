// ThemedModalSurface.js
//
// A Paper <Surface> that carries its OWN scoped, Day/Night-aware theme.
// The app's global Paper theme is intentionally left light so the call
// and conference screens (built for light Paper) keep their original
// look; modals opt into theming by using this wrapper instead of a bare
// <Surface>. Because it renders a <ThemeProvider>, the card AND every
// Paper child inside it (Text, Divider, Button, TextInput, Menu, ...)
// pick up the modal theme — dark surface + light text in Night, white +
// dark in Day — without any per-child wiring.
//
// Drop-in for <Surface ...>: forwards all props; only the background is
// overridden to the scoped theme's surface colour.
import React from 'react';
import { Surface, ThemeProvider } from 'react-native-paper';
import getAppPaperTheme from '../paperTheme';

const ThemedModalSurface = ({ style, children, ...rest }) => {
  const theme = getAppPaperTheme();
  // On dark themes the card (surface) and the dimmed backdrop are both
  // near-black, so the modal's edge disappears. Lift the card a touch
  // above the app surface and add a hairline light border so its
  // boundary — and the backdrop margin around it — is visible. The
  // overlay's own padding already leaves a margin of dimmed backdrop
  // around the card; the border makes that margin read.
  const isDark = !!theme.dark;
  const cardBg = isDark ? '#2A2A2A' : theme.colors.surface;
  const edge = isDark
    ? { borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' }
    : null;
  return (
    <ThemeProvider theme={theme}>
      <Surface {...rest} style={[style, { backgroundColor: cardBg }, edge]}>
        {children}
      </Surface>
    </ThemeProvider>
  );
};

export default ThemedModalSurface;
