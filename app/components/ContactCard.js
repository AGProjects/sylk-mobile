import React, { Component, Fragment } from 'react';
import { View, SafeAreaView, FlatList, Platform, StyleSheet } from 'react-native';
import { Badge } from 'react-native-elements';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import { Card, Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import uuid from 'react-native-uuid';
import UserIcon from './UserIcon';
import { Gravatar } from 'react-native-gravatar';
import { GiftedChat } from 'react-native-gifted-chat';

import utils from '../utils';

// -------------------
// Base styles
// -------------------
const styles = StyleSheet.create({
  containerPortrait: {},
  containerLandscape: {},

  cardPortraitContainer: {
    marginTop: 0.6,
    borderRadius: 0,
  },
  cardLandscapeContainer: {
    flex: 1,
    marginLeft: 1,
    marginTop: 1,
    borderRadius: 0,
  },
  cardLandscapeTabletContainer: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 0,
  },
  cardPortraitTabletContainer: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 0,
  },

  rowContent: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  cardContent: {
    flex: 1,
    flexDirection: 'row',
  },

  title: {
    fontSize: 16,
    lineHeight: 18,
    flex: 1,
  },

  titlePaddingSmall: { paddingTop: 0 },
  titlePadding: { paddingTop: 12 },
  titlePaddingSelect: { paddingTop: 25 },
  titlePaddingBig: { paddingTop: 14 },

  subtitle: {
    paddingTop: 4,
    fontSize: 13,
    lineHeight: 20,
    flex: 1,
  },

  description: {
    fontSize: 12,
    flex: 1,
  },

  avatarContent: { marginTop: 10 },

  gravatar: {
    width: 50,
    height: 50,
    borderWidth: 0,
    borderColor: 'white',
    borderRadius: 50,
  },

  smallGravatar: {
    width: 25,
    height: 25,
    borderWidth: 2,
    borderColor: 'white',
    borderRadius: 25,
  },

  mainContent: { marginLeft: 10 },

  rightContent: {
    marginTop: 10,
    marginLeft: 60,
    marginRight: 10,
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },

  selectBox: {
    marginTop: 10,
    marginLeft: 50,
    marginRight: 30,
    alignItems: 'flex-end',
  },

  storageText: {
    fontSize: 12,
    color: '#777',
    marginTop: 4,
  },

  timestamp: {
    fontSize: 12,
    color: '#555',
    marginTop: -5,
  },

  unreadRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    height: 16,
    marginBottom: 4,
  },

  badgeContainer: {
    marginRight: 10,
    alignItems: 'center',
    minWidth: 20,
  },

  // The unread number was sitting too low inside the red dot on
  // Android. Two Android-only quirks were stacking on top of each
  // other: (1) Text views default to includeFontPadding: true, which
  // wedges extra space above and below the glyph and pushes small
  // labels visually downward inside tight containers, and (2) without
  // an explicit lineHeight, RN falls back to the font's intrinsic
  // metrics, which for the system font centres the baseline below the
  // geometric middle of a circular badge. Disabling font padding,
  // forcing textAlignVertical center, and pinning lineHeight to the
  // glyph height (≈ fontSize * 1.1) snaps the digit back into the
  // visual middle. iOS doesn't need any of this and rendered fine
  // before, so leave that branch as the original {fontSize: 9} only.
  badgeTextStyle: Platform.select({
    android: {
      fontSize: 9,
      lineHeight: 10,
      includeFontPadding: false,
      textAlignVertical: 'center',
    },
    ios: { fontSize: 9 },
  }),

  // react-native-elements' <Badge/> ships with badgeStyle = {borderWidth:
  // 1, borderColor: 'white'} baked in. On Android that white ring around
  // the rounded red dot fights the subpixel anti-aliasing on the curve
  // and reads as a fuzzy halo at small badge sizes. Override the inner
  // badgeStyle to drop the border entirely; the red fill still has clean
  // edges from RN's own rasteriser.
  badgeInnerStyle: { borderWidth: 0 },
  selectedContact: { marginTop: 15 },
  participants: { marginTop: 10 },
  participant: { fontSize: 14 },
  participantView: { marginBottom: 3 },
  recordingLabel: { marginTop: 7 },
});

// -------------------
// Dark mode styles
// -------------------
const darkStyles = StyleSheet.create({
  card: {
    backgroundColor: '#1e1e1e',
  },
  textPrimary: {
    color: '#ffffff',
  },
  textSecondary: {
    color: '#bbbbbb',
  },
  timestamp: {
    color: '#999999',
  },
  badgeContainer: {
    backgroundColor: '#333333',    
  },
});

// -------------------
// Utility functions
// -------------------
function toTitleCase(str) {
  return str.replace(/\w\S*/g, txt =>
    txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  );
}

const Item = ({ nr, uri, name }) => (
  <View style={styles.participantView}>
    {name !== uri ? (
      <Text style={styles.participant}>
        {name} ({uri})
      </Text>
    ) : (
      <Text style={styles.participant}>{uri}</Text>
    )}
  </View>
);

const renderItem = ({ item }) => <Item nr={item.nr} uri={item.uri} name={item.name} />;

function isIp(ipaddress) {
  return /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(
    ipaddress
  );
}

// -------------------
// Component
// -------------------
class ContactCard extends Component {
  constructor(props) {
    super(props);
    autoBind(this);
    this.state = {
      ...props,
      favorite: props.contact.tags.includes('favorite'),
      blocked: props.contact.tags.includes('blocked'),
      confirmRemoveFavorite: false,
      confirmPurgeChat: false,
    };
  }

  UNSAFE_componentWillReceiveProps(nextProps) {
    this.setState({
      ...nextProps,
      favorite: nextProps.contact.tags.includes('favorite'),
      blocked: nextProps.contact.tags.includes('blocked'),
    });
  }

  setTargetUri(uri, contact) {
    if (this.state.chat) return;
    this.props.setTargetUri(uri, this.state.contact);
  }

    render() {
	  const isDark = this.props.darkMode;
	  const cardContainerClass = this.state.isTablet
		? this.state.orientation === 'landscape'
		  ? styles.cardLandscapeTabletContainer
		  : styles.cardPortraitTabletContainer
		: this.state.orientation === 'landscape'
		? styles.cardLandscapeContainer
		: styles.cardPortraitContainer;
	
	  const cardHeight = this.state.fontScale <= 1 ? 75 : 70;
	  const contact = this.state.contact;
	  const uri = contact.uri;
	  const unread = contact.unread?.length || 0;
	
			function capitalizeFirstLetter(str) {
			  if (!str) return ""; // Handle empty string
			  return str[0].toUpperCase() + str.slice(1);
			}

			// Replace '.', '_', '-' separators with spaces and title-case each word
			// (e.g. 'blue_owl' -> 'Blue Owl', 'john.doe' -> 'John Doe').
			// Skips the transformation for strings that look like a full URI or a phone number.
			function prettifyName(str) {
			  if (!str) return "";
			  if (str.indexOf('@') > -1) return capitalizeFirstLetter(str);
			  if (/^[+\d][\d\s()-]*$/.test(str)) return str; // phone number - leave as-is
			  const cleaned = str.replace(/[._-]+/g, ' ').trim();
			  if (!cleaned) return capitalizeFirstLetter(str);
			  return cleaned.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
			}
	
	
	  // Determine title and subtitle
	  let title = uri.split('@')[0];
	  
	  if (contact.name != uri && contact.name) {
		  title = contact.name;
	  }
	
		title = prettifyName(title);
	  let subtitle = contact.uri;
	
	  if (uri.indexOf('@guest.') > -1) {
		title = 'Anonymous caller';
	  }
	
	  if (uri.indexOf('@videoconference.') > -1) {
		title = 'Room ' + uri.split('@')[0];
		subtitle = 'Video conference';
	  }
	
		subtitle = contact.lastMessage || subtitle;
	
	  // Determine title padding based on fontScale and selectMode
	  let titlePadding = styles.titlePadding;
	  if (this.state.fontScale < 1) titlePadding = styles.titlePaddingBig;
	  if (this.state.fontScale > 1.2) titlePadding = styles.titlePaddingSmall;
	
		return (
		  <Fragment>
			<Card
			  style={[
				cardContainerClass,
				{ minHeight: cardHeight },
				isDark && darkStyles.card,
			  ]}
			  onPress={() => this.setTargetUri(uri, contact)}
			>
			  <View style={styles.rowContent}>
				<Card.Content style={styles.cardContent}>
				  <View style={styles.avatarContent}>
					{contact.photo || !contact.email ? (
					  <UserIcon size={50} identity={contact} unread={unread} />
					) : (
					  <Gravatar
						options={{
						  email: contact.email,
						  parameters: { size: '50', d: 'mm' },
						  secure: true,
						}}
						style={styles.gravatar}
					  />
					)}
				  </View>
	
				  <View style={styles.mainContent}>
					<Text
					  variant="titleLarge"
					  numberOfLines={1}
					  style={[styles.title, titlePadding, isDark && darkStyles.textPrimary]}
					>
					  {title}
					</Text>
					<Text
					  variant="titleMedium"
					  numberOfLines={1}
					  style={[styles.subtitle, isDark && darkStyles.textSecondary]}
					>
					  {subtitle}
					</Text>
				  </View>
				</Card.Content>
	
			  {this.state.selectMode ?
				<View style={styles.selectBox}>
				  <Icon
					style={[styles.selectedContact, isDark && darkStyles.textSecondary]}
					name={contact.selected ? 'check-circle' : 'circle-outline'}
					size={20}
				  />
				</View>
			  : 
	
				<View style={styles.rightContent}>
				  <View style={styles.unreadRow}>
					{unread ? (
					  <Badge
						value={unread}
						status="error"
						textStyle={styles.badgeTextStyle}
						badgeStyle={styles.badgeInnerStyle}
						containerStyle={[styles.badgeContainer, isDark && darkStyles.badgeContainer]}
					  />
					) : null}
					{contact.timestamp && (
					<Text style={[styles.timestamp, isDark && darkStyles.timestamp]}>
					  {contact.timestamp && (
						moment(contact.timestamp).isSame(moment(), 'day')
						  ? moment(contact.timestamp).format('HH:mm') // Today
						  : moment().diff(moment(contact.timestamp), 'months') < 12
						  ? moment(contact.timestamp).format('MMM D') // Within last 12 months
						  : moment(contact.timestamp).format('MMM D YY') // Older than 12 months → show year
					  )}
					</Text>
	
					)}
				  </View>
				  <Text style={[styles.storageText, isDark && darkStyles.textSecondary]}>
					{contact.prettyStorage}
				  </Text>
				</View>
				}
			  </View>
			</Card>
		  </Fragment>
		);
	}
}

ContactCard.propTypes = {
  id: PropTypes.string,
  contact: PropTypes.object,
  selectedContact: PropTypes.object,
  setTargetUri: PropTypes.func,
  chat: PropTypes.bool,
  orientation: PropTypes.string,
  isTablet: PropTypes.bool,
  isLandscape: PropTypes.bool,
  contacts: PropTypes.array,
  defaultDomain: PropTypes.string,
  accountId: PropTypes.string,
  favoriteUris: PropTypes.array,
  messages: PropTypes.array,
  pinned: PropTypes.bool,
  unread: PropTypes.array,
  fontScale: PropTypes.number,
  selectMode: PropTypes.bool,
  darkMode: PropTypes.bool, // added
};

export default ContactCard;
