import React, { Component} from 'react';
import autoBind from 'auto-bind';

import PropTypes from 'prop-types';
import { SafeAreaView, ScrollView, View, FlatList, Text } from 'react-native';

import HistoryCard from './HistoryCard';
import utils from '../utils';
import DigestAuthRequest from 'digest-auth-request';
import uuid from 'react-native-uuid';

import moment from 'moment';
import momenttz from 'moment-timezone';

import styles from '../assets/styles/blink/_HistoryTileBox.scss';


class HistoryTileBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            serverHistory: this.props.serverHistory,
            localHistory: this.props.localHistory,
            accountId: this.props.account ? this.props.account.id : '',
            password: this.props.password,
            targetUri: this.props.targetUri,
            favoriteUris: this.props.favoriteUris,
            blockedUris: this.props.blockedUris,
            isRefreshing: false,
            myInvitedParties: this.props.myInvitedParties,
            refreshHistory: this.props.refreshHistory
        }

        const echoTest = {
            remoteParty: '4444@sylk.link',
            displayName: 'Echo test',
            type: 'contact',
            label: 'Call to test microphone',
            id: uuid.v4(),
            tags: ['test']
            };

        this.echoTest = Object.assign({}, echoTest);

        const videoTest = {
            remoteParty: '3333@sylk.link',
            displayName: 'Video test',
            type: 'contact',
            label: 'Call to test video',
            id: uuid.v4(),
            tags: ['test']
            };

        this.videoTest = Object.assign({}, videoTest);
        this.ended = false;
    }

    componentDidMount() {
        this.ended = false;
    }

    componentWillUnmount() {
        this.ended = true;
    }

    setTargetUri(uri, contact) {
        //console.log('Set target uri uri in history list', uri);
        this.props.setTargetUri(uri, contact);
    }

    deleteHistoryEntry(uri) {
        this.props.deleteHistoryEntry(uri);
        this.props.setTargetUri(uri);
    }

    setFavoriteUri(uri) {
        return this.props.setFavoriteUri(uri);
    }

    saveInvitedParties(room, uris) {
        if (this.ended) {
            return;
        }

        this.props.saveInvitedParties(room, uris);
        let myInvitedParties = this.state.myInvitedParties;

        if (myInvitedParties && myInvitedParties.hasOwnProperty(room)) {
            myInvitedParties[room] = uris;
            this.setState({myInvitedParties: myInvitedParties});
        }
    }

    setBlockedUri(uri) {
        return this.props.setBlockedUri(uri);
    }

    renderItem(item) {

        let invitedParties = [];
        let uri = item.item.remoteParty;

        let username = uri.split('@')[0];

        if (this.state.myInvitedParties && this.state.myInvitedParties.hasOwnProperty(username)) {
            invitedParties = this.state.myInvitedParties[username];
        }

        return(
            <HistoryCard
            id={item.id}
            contact={item.item}
            invitedParties={invitedParties}
            setFavoriteUri={this.setFavoriteUri}
            saveInvitedParties={this.saveInvitedParties}
            setBlockedUri={this.setBlockedUri}
            deleteHistoryEntry={this.deleteHistoryEntry}
            setTargetUri={this.setTargetUri}
            orientation={this.props.orientation}
            isTablet={this.props.isTablet}
            contacts={this.props.contacts}
            defaultDomain={this.props.defaultDomain}
            />);
    }

    findObjectByKey(array, key, value) {
        for (var i = 0; i < array.length; i++) {
            if (array[i][key] === value) {
                return array[i];
            }
        }
        return null;
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (this.ended) {
            return;
        }

        if (nextProps.myInvitedParties !== this.state.myInvitedParties) {
            this.setState({myInvitedParties: nextProps.myInvitedParties});
        }

        if (nextProps.account !== null && nextProps.account !== this.props.account) {
            this.setState({accountId: nextProps.account.id});
        }

        if (nextProps.refreshHistory !== this.state.refreshHistory) {
            this.setState({refreshHistory: nextProps.refreshHistory});
            this.getServerHistory();
        }
    }

    getLocalHistory() {
        let history = this.state.localHistory;
        history.sort((a, b) => (a.startTime < b.startTime) ? 1 : -1)

        let known = [];
        let uri;

        history = history.filter((elem) => {
            uri = elem.remoteParty.toLowerCase();

            if (known.indexOf(uri) <= -1) {
                elem.type = 'history';
                if (!elem.tags) {
                    elem.tags = [];
                }
                if (elem.tags.indexOf('history') === -1) {
                    elem.tags.push('history');
                }
                if (elem.tags.indexOf('local') === -1) {
                    elem.tags.push('local');
                }

                known.push(uri);
                return elem;
            }
        });

        return history;
    }

    getFavoriteContacts() {
        let favoriteContacts = [];
        let displayName;
        let label;
        let conference;

        let contacts= this.props.contacts
        contacts = contacts.concat(this.videoTest);
        contacts = contacts.concat(this.echoTest);

        this.state.favoriteUris.forEach((uri) => {
            uri = uri.toLowerCase();
            const contact_obj = this.findObjectByKey(contacts, 'remoteParty', uri);
            displayName = contact_obj ? contact_obj.displayName : uri;
            label = contact_obj ? contact_obj.label: null;
            conference = false;
            let tags = ['favorite'];

            const history_obj = this.findObjectByKey(this.state.serverHistory, 'remoteParty', uri);
            const startTime = history_obj? history_obj.startTime : null;
            const stopTime = history_obj? history_obj.stopTime : null;
            const duration = history_obj? history_obj.duration : 0;
            let media = history_obj? history_obj.media : ['audio'];
            tags.push('history');

            if (uri.indexOf('@videoconference.') > -1) {
                displayName = uri.split('@')[0];
                uri = uri.split('@')[0] + '@' + this.props.config.defaultConferenceDomain;
                conference = true;
                media = ['audio', 'video', 'chat'];
            }

            const item = {
                remoteParty: uri,
                displayName: displayName,
                conference: conference,
                media: media,
                type: 'contact',
                startTime: startTime,
                startTime: startTime,
                duration: duration,
                label: label,
                id: uuid.v4(),
                tags: tags
                };
            favoriteContacts.push(item);
        });

        return favoriteContacts;
    }

    getBlockedContacts() {
        let blockedContacts = [];
        let contact_obj;
        let displayName;
        let label;

        let contacts= this.props.contacts
        contacts = contacts.concat(this.videoTest);
        contacts = contacts.concat(this.echoTest);

        this.state.blockedUris.forEach((uri) => {
            contact_obj = this.findObjectByKey(contacts, 'remoteParty', uri);
            displayName = contact_obj ? contact_obj.displayName : uri;
            label = contact_obj ? contact_obj.label: null;

            const item = {
                remoteParty: uri.toLowerCase(),
                displayName: displayName,
                conference: false,
                type: 'contact',
                label: label,
                id: uuid.v4(),
                tags: ['blocked']
                };
            blockedContacts.push(item);
        });

        return blockedContacts;
    }

    getServerHistory() {
        if (this.ended || !this.state.accountId || this.state.isRefreshing) {
            return;
        }

        this.setState({isRefreshing: true});

        utils.timestampedLog('Requesting call history from server');

        let history = [];
        let localTime;
        let hasMissedCalls = false;

        let getServerCallHistory = new DigestAuthRequest(
            'GET',
            `${this.props.config.serverCallHistoryUrl}?action=get_history&realm=${this.state.accountId.split('@')[1]}`,
            this.state.accountId.split('@')[0],
            this.state.password
        );

        // Disable logging
        getServerCallHistory.loggingOn = false;
        getServerCallHistory.request((data) => {
            if (data.success !== undefined && data.success === false) {
                console.log('Error getting call history from server', data.error_message);
                return;
            }

            if (data.received) {
                data.received.map(elem => {elem.direction = 'received'; return elem});
                history = history.concat(data.received);
            }

            if (data.placed) {
                data.placed.map(elem => {elem.direction = 'placed'; return elem});
                history = history.concat(data.placed);
            }

            history.sort((a, b) => (a.startTime < b.startTime) ? 1 : -1)

            if (history) {
                const known = [];
                history = history.filter((elem) => {
                    elem.conference = false;

                    if (!elem.tags) {
                        elem.tags = [];
                    }

                    if (elem.remoteParty.indexOf('@conference.') > -1) {
                        return null;
                    }

                    elem.remoteParty = elem.remoteParty.toLowerCase();

                    let username = elem.remoteParty.split('@')[0];
                    let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);
                    let contact_obj;

                    if (this.props.contacts) {
                        if (isPhoneNumber) {
                            contact_obj = this.findObjectByKey(this.props.contacts, 'remoteParty', username);
                        } else {
                            contact_obj = this.findObjectByKey(this.props.contacts, 'remoteParty', elem.remoteParty);
                        }
                    }

                    if (contact_obj) {
                        elem.displayName = contact_obj.displayName;
                        elem.photo = contact_obj.photo;
                        if (isPhoneNumber) {
                            elem.remoteParty = username;
                        }
                        // TODO update icon here
                    } else {
                        elem.photo = null;
                    }

                    if (elem.remoteParty.indexOf('@guest.') > -1) {
                        elem.remoteParty = elem.displayName.toLowerCase() + '_from_the_web@' + elem.remoteParty.split('@')[1];
                    }

                    if (elem.remoteParty.indexOf('@videoconference.') > -1) {
                        elem.displayName = elem.remoteParty.split('@')[0];
                        elem.remoteParty = elem.remoteParty.split('@')[0] + '@' + this.props.config.defaultConferenceDomain;
                        elem.conference = true;
                        elem.media = ['audio', 'video', 'chat'];
                    }

                    if (elem.remoteParty === this.state.accountId) {
                        elem.displayName = this.props.myDisplayName || 'Myself';
                    }

                    elem.type = 'history';
                    elem.id = uuid.v4();

                    if (elem.tags.indexOf('history') === -1) {
                        elem.tags.push('history');
                    }

                    elem.label = elem.direction;

                    if (!elem.displayName) {
                        elem.displayName = elem.remoteParty;
                    }

                    if (!elem.media || !Array.isArray(elem.media)) {
                        elem.media = ['audio'];
                    }

                    if (elem.remoteParty.indexOf('3333@') > -1) {
                        // see Call.js as well if we change this
                        elem.displayName = 'Video Test';
                    }
                    if (elem.remoteParty.indexOf('4444@') > -1) {
                        // see Call.js as well if we change this
                        elem.displayName = 'Echo Test';
                    }

                    if (elem.timezone !== undefined) {
                        localTime = momenttz.tz(elem.startTime, elem.timezone).toDate();
                        elem.startTime = moment(localTime).format('YYYY-MM-DD HH:mm:ss');
                        localTime = momenttz.tz(elem.stopTime, elem.timezone).toDate();
                        elem.stopTime = moment(localTime).format('YYYY-MM-DD HH:mm:ss');
                    }

                    if (known.indexOf(elem.remoteParty) <= -1) {
                        known.push(elem.remoteParty);
                        if (elem.direction === 'received' && elem.duration === 0) {
                            elem.tags.push('missed');
                            hasMissedCalls = true;
                        }
                        return elem;
                    }
                });

                this.props.cacheHistory(history);
                if (this.ended) {
                    return;
                }
                this.setState({serverHistory: history, isRefreshing: false});
                this.props.setMissedCalls(hasMissedCalls);
            }
        }, (errorCode) => {
            console.log('Error getting call history from server', errorCode);
        });

        this.setState({isRefreshing: false});
    }

    render() {
        let history = [];
        let searchExtraItems = [];
        let items = [];

        if (this.props.filter === 'favorite') {
            let favoriteContacts = this.getFavoriteContacts();
            items = favoriteContacts.filter(historyItem => historyItem.remoteParty.startsWith(this.props.targetUri));
        } else if (this.props.filter === 'blocked') {
            let blockedContacts = this.getBlockedContacts();
            items = blockedContacts.filter(historyItem => historyItem.remoteParty.startsWith(this.props.targetUri));
        } else if (this.props.filter === 'missed') {
            history = this.state.serverHistory;
            items = history.filter(historyItem => historyItem.remoteParty.startsWith(this.props.targetUri) && historyItem.tags.indexOf('missed') > -1);
        } else {
            history = this.getLocalHistory();
            history = history.concat(this.state.serverHistory);

            searchExtraItems = this.props.contacts;
            searchExtraItems.concat(this.videoTest);
            searchExtraItems.concat(this.echoTest);

            items = history.filter(historyItem => historyItem.remoteParty.startsWith(this.props.targetUri));

            let matchedContacts = [];
            if (this.props.targetUri && this.props.targetUri.length > 2 && !this.props.selectedContact) {
                matchedContacts = searchExtraItems.filter(contact => (contact.remoteParty.toLowerCase().indexOf(this.props.targetUri) > -1 || contact.displayName.toLowerCase().indexOf(this.props.targetUri) > -1));
            } else if (this.props.selectedContact && this.props.selectedContact.type === 'contact') {
                matchedContacts.push(this.props.selectedContact);
            }

            items = items.concat(matchedContacts);
        }

        const known = [];
        items.sort((a, b) => (a.startTime < b.startTime) ? 1 : -1)
        items = items.filter((elem) => {
            if (known.indexOf(elem.remoteParty) <= -1) {
                known.push(elem.remoteParty);
                return elem;
            }
        });

        if (!this.props.targetUri && !this.props.filter) {
            if (!this.findObjectByKey(items, 'remoteParty', this.echoTest.remoteParty)) {
                items.push(this.echoTest);
            }
            if (!this.findObjectByKey(items, 'remoteParty', this.videoTest.remoteParty)) {
                items.push(this.videoTest);
            }
        }

        items.forEach((item) => {
            item.showActions = false;

            if (!item.tags) {
                item.tags = [];
            }

            if (this.state.favoriteUris.indexOf(item.remoteParty) > -1 && item.tags.indexOf('favorite') === -1) {
                item.tags.push('favorite');
            }

            if (this.state.blockedUris.indexOf(item.remoteParty) > -1 && item.tags.indexOf('blocked') === -1) {
                item.tags.push('blocked');
            }

            let idx = item.tags.indexOf('blocked');
            if (this.state.blockedUris.indexOf(item.remoteParty) === -1 && idx > -1) {
                item.tags.splice(idx, 1);
            }

            idx = item.tags.indexOf('favorite');

            if (this.state.favoriteUris.indexOf(item.remoteParty) === -1 && idx > -1) {
                item.tags.splice(idx, 1);
            }

            if (item.remoteParty.indexOf('@videoconference.') === -1) {
                item.conference = false;
            }

        });

        let filteredItems = [];
        items.reverse();

        items.forEach((item) => {
            const fromDomain = '@' + item.remoteParty.split('@')[1];
            if (this.props.filter && item.tags.indexOf(this.props.filter) > -1) {
                filteredItems.push(item);
            } else if (this.state.blockedUris.indexOf(item.remoteParty) === -1 && this.state.blockedUris.indexOf(fromDomain) === -1) {
                filteredItems.push(item);
            }
        });

        items = filteredItems;
        items.sort((a, b) => (a.startTime < b.startTime) ? 1 : -1)

        if (items.length === 1) {
            items[0].showActions = true;
        }

        let columns = 1;

        if (this.props.isTablet) {
            columns = this.props.orientation === 'landscape' ? 3 : 2;
        } else {
            columns = this.props.orientation === 'landscape' ? 2 : 1;
        }

        return (
            <SafeAreaView style={styles.container}>
              <FlatList
                horizontal={false}
                numColumns={columns}
                onRefresh={this.getServerHistory}
                refreshing={this.state.isRefreshing}
                data={items}
                renderItem={this.renderItem}
                listKey={item => item.id}
                key={this.props.orientation}
              />
            </SafeAreaView>
        );
    }
}

HistoryTileBox.propTypes = {
    account         : PropTypes.object,
    password        : PropTypes.string.isRequired,
    config          : PropTypes.object.isRequired,
    targetUri       : PropTypes.string,
    selectedContact : PropTypes.object,
    contacts        : PropTypes.array,
    orientation     : PropTypes.string,
    setTargetUri    : PropTypes.func,
    isTablet        : PropTypes.bool,
    refreshHistory  : PropTypes.bool,
    cacheHistory    : PropTypes.func,
    serverHistory   : PropTypes.array,
    localHistory    : PropTypes.array,
    myDisplayName   : PropTypes.string,
    myPhoneNumber   : PropTypes.string,
    setFavoriteUri  : PropTypes.func,
    saveInvitedParties: PropTypes.func,
    myInvitedParties: PropTypes.object,
    setBlockedUri   : PropTypes.func,
    deleteHistoryEntry : PropTypes.func,
    favoriteUris    : PropTypes.array,
    blockedUris     : PropTypes.array,
    setMissedCalls  : PropTypes.func,
    filter          : PropTypes.string,
    defaultDomain   : PropTypes.string
};


export default HistoryTileBox;
