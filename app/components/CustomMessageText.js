import React from 'react';
import { View, StyleSheet, Linking, Dimensions } from 'react-native';
import ParsedText from 'react-native-parsed-text';
import Icon from 'react-native-vector-icons/FontAwesome';
import DarkModeManager from '../DarkModeManager';

// Hard pixel cap for the text row. Computed once per screen size so
// the bubble's intrinsic max-width is explicit — this is what lets
// long text WRAP (the Samsung Android 16 + accessibility-font path
// previously relied on `flex: 1` on the Text to force wrapping,
// which had the side effect of stretching SHORT bubbles to the
// same max width). 85% of the smaller dimension gives wrap a
// believable bound on both portrait and landscape without
// computing it per-render.
const _SCREEN = Dimensions.get('window');
const TEXT_ROW_MAX_WIDTH = Math.floor(Math.min(_SCREEN.width, _SCREEN.height) * 0.85);

export const CustomMessageText = ({ currentMessage, extraStyles, labelProps }) => {
  if (!currentMessage || !currentMessage.text) return null;

  const isIncoming = currentMessage.direction === 'incoming';

  // Pull text + link colours from the active theme so they read
  // correctly against the bubble colour ChatBubble paints.
  //
  // Night theme:
  //   incoming bubble = green   → incoming text = white (legacy)
  //   outgoing bubble = white   → outgoing text = black
  // Day theme (WhatsApp-styled):
  //   incoming bubble = white   → incoming text = dark (#111B21)
  //   outgoing bubble = #DCF8C6 → outgoing text = dark (#111B21)
  //
  // Without this lookup the incoming bubble in Day mode painted
  // white-on-white and the body was invisible.
  const theme = DarkModeManager.getTheme();
  const incomingTextColor = theme.bubbleIncomingText;
  const outgoingTextColor = theme.bubbleOutgoingText;
  const incomingLinkColor = theme.isDark ? '#FFFFFF' : '#1E88E5';
  const outgoingLinkColor = '#1E88E5';

  const linkStyle = {
    color: isIncoming ? incomingLinkColor : outgoingLinkColor,
    textDecorationLine: 'underline',
  };

  return (
    <View
      style={[
        styles.messageTextContainer,
        extraStyles,
        // Row container with an EXPLICIT max width. The max-width
        // is what makes long text wrap on Android (RN's Text wraps
        // when the bounding container is constrained); without it
        // the row would grow to the screen edge minus the bubble
        // margin and a single long line would clip on Samsung
        // accessibility-font setups (original "one trimmed line"
        // bug). The previous fix used flex:1 on the ParsedText
        // below — that forced wrapping but ALSO made even short
        // bubbles ("OK") stretch to the same width, because
        // flex:1 in a row container fills available space.
        // Pixel cap + no-flex-grow on the Text gives short text
        // a content-sized bubble and long text a wrapping bubble.
        // alignSelf: 'flex-start' makes the row size to content
        // within the cap rather than stretching to fill an
        // ancestor's column-flex stretch default.
        {
          flexDirection: 'row',
          alignItems: 'center',
          marginLeft: 10,
          flexWrap: 'wrap',
          maxWidth: TEXT_ROW_MAX_WIDTH,
          alignSelf: 'flex-start',
        },
      ]}
    >
      {/* File icon if present */}
		  {currentMessage.metadata?.filename && (
			<Icon
			  name="file"
			  size={40}
			  color="gray"
			  style={styles.chatSendArrow}
			/>
		  )}

		  {/* Message text with clickable links.
		      flexShrink: 1 lets the Text shrink inside the row when
		      needed (so it wraps within the row's maxWidth bound
		      added above). The earlier flex: 1 here forced the Text
		      to GROW to fill the row, which is what made every
		      bubble — even single-word ones — stretch to the bound;
		      that's been swapped for flexShrink-only. The Samsung
		      Android 16 "one trimmed line" bug is now prevented by
		      the row's explicit maxWidth instead, so wrapping still
		      kicks in on accessibility-font setups. */}
		  <ParsedText
			style={[
			  styles.messageText,
			  { color: isIncoming ? incomingTextColor : outgoingTextColor, flexShrink: 1 },
			]}
			parse={[
			  {
				pattern: /((https?:\/\/|[\w.+-]+:\/\/)[^\s]+)/g,
				style: linkStyle,
				onPress: (url) => {
				  console.log('Link clicked:', url, currentMessage.text);
				  Linking.openURL(url)
				},
			  },
			  {
				pattern: /#(\w+)/,
				style: styles.hashtag,
				onPress: (hashtag) =>
				  console.log('Hashtag clicked:', hashtag),
			  },
			]}

			childrenProps={{ ...labelProps }}
		  >
        {currentMessage.text}
      </ParsedText>
    </View>
  );
};

const styles = StyleSheet.create({
  messageTextContainer: {
    paddingRight: 16,
    paddingTop: 6,
    paddingBottom: 4,
  },

  // Base text style. Colour is no longer baked in here — it's
  // computed per-render from the active theme + message direction
  // (see incomingTextColor / outgoingTextColor above) so flipping
  // Day/Night doesn't leave white-on-white bubbles behind.
  messageText: {
  },

  hashtag: {
    color: '#1e90ff',
  },
  chatSendArrow: {
    marginRight: 5,
  },
});
