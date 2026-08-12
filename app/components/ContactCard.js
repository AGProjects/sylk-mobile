import React, { Component, Fragment } from 'react';
import { View, SafeAreaView, FlatList, Platform, StyleSheet } from 'react-native';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import { Card, Text, Badge } from 'react-native-paper';
import Icon from '@react-native-vector-icons/material-design-icons';
import uuid from 'react-native-uuid';
import UserIcon from './UserIcon';
import { Gravatar } from '../gravatar';
import { GiftedChat } from 'react-native-gifted-chat';

import utils from '../utils';

// -------------------
// Base styles
// -------------------
const styles = StyleSheet.create({
  containerPortrait: {},
  containerLandscape: {},

  // Borders between contact cards removed per user request. The
  // marginTop:0.6 (and marginTop:1 on landscape) used to show as a
  // hairline separator against the underlying background — now zero
  // so the cards stack flush. borderWidth:1 also stripped from the
  // tablet variants.
  cardPortraitContainer: {
    marginTop: 0,
    borderRadius: 0,
  },
  cardLandscapeContainer: {
    flex: 1,
    marginLeft: 1,
    marginTop: 0,
    borderRadius: 0,
  },
  cardLandscapeTabletContainer: {
    flex: 1,
    borderWidth: 0,
    borderRadius: 0,
  },
  cardPortraitTabletContainer: {
    flex: 1,
    borderWidth: 0,
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

  // flex:1 bounds the title/subtitle column to the space between the avatar
  // and the right-hand metadata column. Without it the column sizes to its
  // intrinsic content, and the subtitle's flex:1 Text inside subtitleRow (a
  // flex ROW, added with the incoming-location pin) collapsed to min-content —
  // clipping the 2nd line after ~10 characters. With a bounded width the Text
  // fills the real available space and ellipsizes at the true edge.
  mainContent: { marginLeft: 10, flex: 1 },

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

  // Dialpad icon rendered in the right-side metadata column for
  // contacts whose URI is a phone number. Uses the same dialpad icon
  // as the search bar's dialpad toggle. Sits in the same vertical
  // slot the storage-size text uses for chat contacts so the row
  // height stays consistent across types.
  telIcon: {
    marginTop: 4,
    alignSelf: 'flex-end',
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

  // Active outgoing location-share indicator, shown at the right of the
  // contact tile just left of the timestamp. Raised by the same amount as
  // the timestamp (marginTop: -5) so the glyph lines up with the timestamp.
  sharePin: {
    marginRight: 6,
    alignSelf: 'center',
    marginTop: -5,
  },

  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  incomingSharePin: {
    marginRight: 4,
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
	  // Active outgoing location share to THIS contact. activeLocationShares
	  // is the app-level map keyed by the contact URI we're sharing to; a
	  // truthy entry ⇒ a live share is in progress → show the pin.
	  const isSharingLocation = !!(this.props.activeLocationShares
		  && uri && this.props.activeLocationShares[uri]);
	  // Active INCOMING location share FROM this contact (someone is sharing
	  // their live location with us) — pin shows left of the last-message
	  // label until the session ends. Driven by app-level incomingLocationShareUris.
	  const hasIncomingLocationShare = !!(this.props.incomingLocationShareUris
		  && uri && this.props.incomingLocationShareUris[uri]);
	
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
	
	
	  // Determine title and subtitle.
	  // If the contact has a display name set, preserve it verbatim —
	  // just trim surrounding whitespace. Do NOT title-case or otherwise
	  // mangle it: the user (or the remote party) chose that exact
	  // capitalization on purpose ("iPhone of John", "AG Projects",
	  // "j_smith") and we shouldn't rewrite it. Only when we have to
	  // fall back to the URI local part do we run prettifyName to
	  // turn 'john.doe' / 'blue_owl' into something readable.
	  let title;
	  if (contact.name && contact.name != uri) {
		  title = contact.name.trim();
	  } else {
		  title = prettifyName(uri.split('@')[0]);
	  }
	  // Show the bare phone number (no SIP domain) when the contact's
	  // URI looks like a tel number, e.g. '+40xxxx@sylk.link' →
	  // '+40xxxx'. Also keys on the 'tel' tag so contacts saved before
	  // utils.isPhoneNumber existed (or with edge-case formats) still
	  // strip cleanly. Email/SIP user URIs keep their full form.
	  //
	  // Conference URIs (rooms hosted on the account's configured
	  // conference bridge, e.g. someroom@videoconference.sip2sip.info)
	  // are NEVER telephone contacts, even when the room name starts
	  // with a leading 0 and may legitimately have been tagged 'tel'
	  // by an older build that ran isPhoneNumber on the bare local
	  // part. We compare the URI's domain against the account's
	  // configured defaultConferenceDomain (passed in as a prop) —
	  // substring heuristics like 'conference.' aren't reliable
	  // because vanity domains can include that word without being
	  // a Sylk conference bridge.
	  const _confDomain = (this.props.defaultConferenceDomain || '').toLowerCase();
	  const _uriDomain = (typeof contact.uri === 'string' && contact.uri.indexOf('@') > -1)
	    ? contact.uri.split('@')[1].toLowerCase()
	    : '';
	  const _isConferenceUri = !!_confDomain && _uriDomain === _confDomain;
	  const isTelContact = !_isConferenceUri && (
	    utils.isPhoneNumber(contact.uri, _confDomain) ||
	    (Array.isArray(contact.tags) && contact.tags.indexOf('tel') > -1)
	  );
	  let subtitle = isTelContact ? contact.uri.split('@')[0] : contact.uri;
	
	  if (utils.isAnonymous(uri)) {
		title = 'Anonymous caller';
	  }
	
	  if (uri.indexOf('@videoconference.') > -1) {
		// Conference rooms with a saved display name (set in
		// EditConferenceModal → app.js saveConference → contacts.name
		// column) should show that name as the row title, not the
		// raw URI local part. The old branch unconditionally
		// rendered `'Room ' + localPart` and ignored the saved
		// name entirely. Same rule the non-conference branch
		// above already uses: prefer `contact.name` when it's
		// set and differs from the URI; fall back to the local
		// part otherwise (with a 'Room ' prefix so the user can
		// still see at a glance that it's a conference, since
		// the subtitle further confirms it).
		if (contact.name && contact.name !== uri) {
			// Display name set on a conference room: respect it
			// exactly as the user typed it in EditConferenceModal,
			// just trim stray whitespace. No title-casing.
			title = contact.name.trim();
		} else {
			title = 'Room ' + uri.split('@')[0];
		}
		// Subtitle reflects the media type of the LAST run of this
		// room (stamped on the contact by updateHistoryEntry via
		// the terminated branch of callStateChanged → see app.js).
		// Falls back to the generic "Conference" when we've never
		// recorded a run for this room yet (the room exists in the
		// contacts list because someone saved invitees / favourited
		// it, but it's never been dialed).
		//
		// Consistent two-word naming: "Audio Conference" / "Video
		// Conference" / "Conference". The earlier single-word
		// variant ("Audio" / "Video") was visually inconsistent
		// with the no-history fallback ("Conference").
		//
		// Two source fields, in priority order:
		//   1. contact.lastCallMediaType — in-memory only, set by
		//      app.js updateHistoryEntry the moment a call ends.
		//      Lost on app restart (not persisted to SQL).
		//   2. contact.lastCallMedia      — comma-joined string OR
		//      array of media types from the SQL `last_call_media`
		//      column. Survives restart. May carry multiple values
		//      ("audio,video") when the contact has been dialed
		//      both ways; pick the LAST entry as the most-recent
		//      run. The earlier code only read lastCallMediaType,
		//      so after a restart every saved conference flipped
		//      from "Audio" → "Conference" — the bug the user saw.
		let _mediaType = contact.lastCallMediaType;
		if (!_mediaType && contact.lastCallMedia) {
			const _arr = Array.isArray(contact.lastCallMedia)
				? contact.lastCallMedia
				: String(contact.lastCallMedia).split(',');
			const _last = _arr[_arr.length - 1];
			if (_last === 'audio' || _last === 'video') {
				_mediaType = _last;
			}
		}
		if (_mediaType === 'audio') {
			subtitle = 'Audio Conference';
		} else if (_mediaType === 'video') {
			subtitle = 'Video Conference';
		} else {
			subtitle = 'Conference';
		}
	  }
	
		// While the user is searching the contact list, the second line
		// shows the contact's URI instead of the most recent message
		// preview.
		//
		// For a REAL found contact we show the full user@domain URI as-is
		// (the real domain matters — it's who they actually are). For the
		// synthetic "exact match" row (the "call/chat exactly what I typed"
		// affordance, tagged 'synthetic') we strip the default domain since
		// it's implicit and gets re-appended automatically when
		// dialling/messaging — so a bare local username stays bare, while a
		// term that already named another domain keeps it.
		if (this.props.forceUriSubtitle) {
			// Deleted / Graveyard views: the second line always shows the
			// contact's FULL URI (user@domain) instead of the last-message
			// preview, so the user can identify exactly which account a
			// trashed / tombstoned row refers to. Overrides the conference
			// "Audio/Video Conference" subtitle too — the raw URI is the
			// most useful identifier in these lifecycle views.
			subtitle = contact.uri;
		} else if (this.props.searchMode) {
			const _isSynthetic = Array.isArray(contact.tags)
				&& contact.tags.indexOf('synthetic') > -1;
			const _u = contact.uri || '';
			if (isTelContact) {
				// Phone-number contacts collapse to the bare +number even in
				// search results — the SIP domain is never shown for tel URIs.
				subtitle = _u.split('@')[0];
			} else if (_isSynthetic) {
				const _dd = (this.props.defaultDomain || '').toLowerCase();
				const _at = _u.indexOf('@');
				subtitle = (_at > -1 && _dd && _u.slice(_at + 1).toLowerCase() === _dd)
					? _u.slice(0, _at)
					: _u;
			} else {
				subtitle = _u;
			}
		} else {
			subtitle = contact.lastMessage || subtitle;
		}
	
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
				// Merge winner (keeper): highlight the tile so the user sees which
				// contact the selection will be merged into.
				contact.mergeWinner && { backgroundColor: isDark ? '#1b3a2b' : '#d7f0dd' },
			  ]}
			  onPress={() => {
				// In select mode, a synthetic "New" (typed, not-yet-saved) row
				// can't be selected — only existing contacts. A normal tap (not
				// select mode) still opens it.
				if (this.state.selectMode && contact && contact.searchNew) return;
				this.setTargetUri(uri, contact);
			  }}
			  onLongPress={() => {
				// Don't enter select mode by long-pressing a synthetic "New" row.
				if (contact && contact.searchNew) return;
				if (this.props.onLongPress) this.props.onLongPress();
			  }}
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
					{/* Bottom-left source badge on the avatar:
					    • "New" — the synthetic typed-address row that matches no
					      saved contact (searchNew set in searchedContact).
					    • phone icon — the contact comes from the phone's OS address
					      book (pure phonebook item is type:'contact'; a saved-from-AB
					      contact carries the 'ab' tag / properties.ab_id / recordID). */}
					{(contact && contact.searchNew) ? (
					  <Text style={{ position: 'absolute', bottom: -2, left: -4,
						fontSize: 9, lineHeight: 12, color: '#ffffff', textAlign: 'center',
						backgroundColor: '#2e7d32', borderRadius: 7, overflow: 'hidden',
						paddingHorizontal: 4, minWidth: 22 }}>New</Text>
					) : ((!!(contact && (contact.type === 'contact'
						|| (Array.isArray(contact.tags) && contact.tags.indexOf('ab') > -1)
						|| (contact.properties && contact.properties.ab_id)
						|| contact.recordID))) && (
					  <View style={{ position: 'absolute', bottom: -2, left: -2,
						backgroundColor: '#888888', borderRadius: 9, width: 18, height: 18,
						alignItems: 'center', justifyContent: 'center' }}>
						<Icon name="phone" size={11} color="#ffffff" />
					  </View>
					))}
				  </View>
	
				  <View style={styles.mainContent}>
					<Text
					  variant="titleLarge"
					  numberOfLines={1}
					  style={[styles.title, titlePadding, isDark && darkStyles.textPrimary]}
					>
					  {title}
					</Text>
					<View style={styles.subtitleRow}>
					  {hasIncomingLocationShare && (
					    <Icon
					      name="map-marker-radius"
					      size={14}
					      color="rgb(220, 53, 69)"
					      style={styles.incomingSharePin}
					    />
					  )}
					  <Text
					    variant="titleMedium"
					    numberOfLines={1}
					    style={[styles.subtitle, isDark && darkStyles.textSecondary]}
					  >
					    {subtitle}
					  </Text>
					</View>
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
					{/* Active-location-share pin — right of the tile, just left
					    of the timestamp, whenever we have a live outgoing
					    location share to this contact. Same red as the pulsing
					    share indicator (SessionButtonsBar / NavBar). */}
					{isSharingLocation && (
					  <Icon
						name="map-marker-radius"
						size={16}
						color="rgb(220, 53, 69)"
						style={styles.sharePin}
					  />
					)}
					{unread ? (
					  // Folded from react-native-elements' <Badge/> onto
					  // react-native-paper's Badge (2026-07-23). Same look:
					  // the outer View reproduces RNE's containerStyle; the
					  // paper Badge is the red pill (RNE 'error' red #ff190c;
					  // paper Badge has no white ring so badgeInnerStyle's
					  // borderWidth:0 is no longer needed); badgeTextStyle
					  // carries the Android digit-centering fixes.
					  <View style={[styles.badgeContainer, isDark && darkStyles.badgeContainer]}>
						<Badge
						  size={20}
						  style={[styles.badgeTextStyle, { backgroundColor: '#ff190c' }]}
						>
						  {unread}
						</Badge>
					  </View>
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
				  {isTelContact ? (
				    // Tel contacts replace the storage-size readout
				    // with a neutral "tel" pill so the row is visually
				    // identifiable as a phone-number entry without
				    // having to read the URI.
				    <Icon name="dialpad" size={16} color="#95a5a6" style={styles.telIcon} />
				  ) : (
				    <Text style={[styles.storageText, isDark && darkStyles.textSecondary]}>
				      {contact.prettyStorage}
				    </Text>
				  )}
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
  searchMode: PropTypes.bool,
  // Deleted / Graveyard views: force the second line to show the full
  // contact URI instead of the last-message preview.
  forceUriSubtitle: PropTypes.bool,
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
  incomingLocationShareUris: PropTypes.object,
};

export default ContactCard;
