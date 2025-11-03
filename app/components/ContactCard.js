import React, { Component, Fragment } from 'react';
import { View, SafeAreaView, FlatList, Platform, StyleSheet } from 'react-native';
import { Badge } from 'react-native-elements';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import {
  Card,
  Text
} from 'react-native-paper';
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
    fontSize: 16,
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
    marginLeft: 60,
    marginRight: 10,
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
    marginRight: 4,
    alignItems: 'center',
    minWidth: 20,
  },

  badgeTextStyle: { fontSize: 10 },

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
    let title = contact.name || uri.split('@')[0];
    let subtitle = contact.uri;
    const unread = contact.unread?.length || 0;

	if (uri.indexOf('@guest.') > -1) {
		title = 'Anonymous caller';			
	}

	if (uri.indexOf('@videoconference.') > -1) {
		title = 'Room ' + uri.split('@')[0];
		subtitle = 'Video conference';		
	}


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
                  style={[
                    styles.title,
                    styles.titlePadding,
                    isDark && darkStyles.textPrimary,
                  ]}
                >
                  {title}
                </Text>

                <Text
                  variant="titleMedium"
                  numberOfLines={1}
                  style={[
                    styles.subtitle,
                    isDark && darkStyles.textSecondary,
                  ]}
                >
                  {subtitle}
                </Text>
              </View>
            </Card.Content>

            <View style={styles.rightContent}>
              <View style={styles.unreadRow}>
                {unread ? (
                  <Badge
                    value={unread}
                    status="error"
                    textStyle={styles.badgeTextStyle}
                    containerStyle={[
                      styles.badgeContainer,
                      isDark && darkStyles.badgeContainer,
                    ]}
                  />
                ) : null}
                {contact.timestamp && (
                  <Text
                    style={[
                      styles.timestamp,
                      isDark && darkStyles.timestamp,
                    ]}
                  >
                    {moment(contact.timestamp).format('HH:mm')}
                  </Text>
                )}
              </View>
              <Text
                style={[styles.storageText, isDark && darkStyles.textSecondary]}
              >
                {contact.prettyStorage}
              </Text>
            </View>
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
