// CustomMessageText.js
import React from 'react';
import { View, StyleSheet, Linking } from 'react-native';
import ParsedText from 'react-native-parsed-text';
import Icon from 'react-native-vector-icons/FontAwesome';
//import styles from '../assets/styles/ContactsListBox';

export const CustomMessageText = ({ currentMessage, extraStyles, labelProps }) => {
  if (!currentMessage || !currentMessage.text) return null;

  const isIncoming = currentMessage.direction === 'incoming';
  const linkStyle = isIncoming ? styles.incomingLinkText : styles.linkText;

  return (
    <View
      style={[
        styles.messageTextContainer,
        extraStyles,
        { flexDirection: 'row', alignItems: 'center', marginLeft: 10 },
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

		  {/* Message text with clickable links */}
		  <ParsedText
			style={[
			  styles.messageText,
			  isIncoming && styles.incomingText, // 👈 conditional
			]}
			parse={[
			  {
				type: 'url',
				style: linkStyle,
				onPress: (url) => {
				  console.log('URL clicked:', url);
				  Linking.openURL(url);
				},
			  },
			  {
				pattern: /#(\w+)/,
				style: styles.hashtag,
				onPress: (hashtag) => console.log('Hashtag clicked:', hashtag),
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
    padding: 6,
  },

  messageText: {
    color: '#000',
  },

  incomingText: {
    color: '#fff',
  },

  linkText: {
    color: '#1E88E5',
    textDecorationLine: 'underline',
  },

  incomingLinkText: {
    color: 'white',
    textDecorationLine: 'underline',
  },

  hashtag: {
    color: '#1e90ff',
  },
  chatSendArrow: {
    marginRight: 5,
  },
});

