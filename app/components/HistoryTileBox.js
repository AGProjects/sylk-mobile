import React, { Component} from 'react';
import autoBind from 'auto-bind';

import PropTypes from 'prop-types';
import { SafeAreaView, ScrollView, View, FlatList, Text } from 'react-native';

import HistoryCard from './HistoryCard';
import utils from '../utils';
import DigestAuthRequest from 'digest-auth-request';
import uuid from 'react-native-uuid';

import styles from '../assets/styles/blink/_HistoryTileBox.scss';


class HistoryTileBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            history: this.props.initialHistory,        // combined local and server history
            localHistory: this.props.localHistory,
            accountId: this.props.account.id,
            password: this.props.password,
            targetUri: this.props.targetUri,
            favoriteUris: this.props.favoriteUris,
            blockedUris: this.props.blockedUris
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
    }

    componentDidMount() {
        this.getServerHistory();
    }

    setTargetUri(uri, contact) {
        //console.log('Set target uri uri in history list', uri);
        this.props.setTargetUri(uri, contact);
        this.setState({targetUri: uri});
    }

    setFavoriteUri(uri) {
        return this.props.setFavoriteUri(uri);
    }

    setBlockedUri(uri) {
        return this.props.setBlockedUri(uri);
    }

    renderItem(item) {
        return(
            <HistoryCard
            id={item.id}
            contact={item.item}
            setFavoriteUri={this.setFavoriteUri}
            setBlockedUri={this.setBlockedUri}
            setTargetUri={this.setTargetUri}
            orientation={this.props.orientation}
            isTablet={this.props.isTablet}
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
    UNSAFE_componentWillReceiveProps(props) {
        const { refreshHistory } = this.props;
        if (props.refreshHistory !== refreshHistory) {
            this.getServerHistory();
        }
    }

    getServerHistory() {
        let history = this.props.localHistory;
        utils.timestampedLog('Requesting call history from server');
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

            if (data.placed) {
                data.placed.map(elem => {elem.direction = 'placed'; return elem});
                history = history.concat(data.placed);
            }

            if (data.received) {
                data.received.map(elem => {elem.direction = 'received'; return elem});
                history = history.concat(data.received);
            }

            if (history) {
                history.sort((a, b) => (a.startTime < b.startTime) ? 1 : -1)

                const known = [];
                history = history.filter((elem) => {
                    elem.conference = false;
                    elem.tags = [];

                    if (elem.remoteParty.indexOf('@conference.sip2sip.info') > -1) {
                        return null;
                    }

                    let username = elem.remoteParty.split('@')[0];
                    let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

                    if (isPhoneNumber) {
                        var contact_obj = this.findObjectByKey(this.props.contacts, 'remoteParty', username);
                    } else {
                        var contact_obj = this.findObjectByKey(this.props.contacts, 'remoteParty', elem.remoteParty);
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

                    if (elem.remoteParty.indexOf('@videoconference.') > -1) {
                        elem.displayName = 'Conference ' + elem.remoteParty.split('@')[0];
                        elem.remoteParty = elem.remoteParty.split('@')[0] + '@' + this.props.config.defaultConferenceDomain;
                        elem.conference = true;
                        elem.media = ['audio', 'video', 'chat'];
                    }

                    if (elem.remoteParty === this.state.accountId) {
                        elem.displayName = this.props.myDisplayName || 'Myself';
                    }

                    if (known.indexOf(elem.remoteParty) <= -1) {
                        elem.type = 'history';
                        elem.id = uuid.v4();
                        elem.tags = ['history'];

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

                        known.push(elem.remoteParty);
                        //console.log(elem);

                        return elem;
                    }
                });

                this.props.cacheHistory(history);
                this.setState({history: history});
            }
        }, (errorCode) => {
            console.log('Error getting call history from server', errorCode);
        });

    }

    render() {
        //console.log('Render history');
        //console.log('Favorite Uris:', this.state.favoriteUris);
        //console.log('Blocked Uris:', this.state.blockedUris);

        let items = this.state.history.filter(historyItem => historyItem.remoteParty.startsWith(this.props.targetUri));

        let searchExtraItems = this.props.contacts;

        if (!this.props.targetUri) {
            if (!this.findObjectByKey(items, 'remoteParty', this.echoTest.remoteParty)) {
                items.push(this.echoTest);
            }
            if (!this.findObjectByKey(items, 'remoteParty', this.videoTest.remoteParty)) {
                items.push(this.videoTest);
            }
        }

        let matchedContacts = [];
        if (this.props.targetUri && this.props.targetUri.length > 2 && !this.props.selectedContact) {
            matchedContacts = searchExtraItems.filter(contact => (contact.remoteParty.toLowerCase().search(this.props.targetUri) > -1 || contact.displayName.toLowerCase().search(this.props.targetUri) > -1));
        } else if (this.props.selectedContact && this.props.selectedContact.type === 'contact') {
            matchedContacts.push(this.props.selectedContact);
        }

        items = items.concat(matchedContacts);

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
                item.tags.splice(idx, idx);
            }

            idx = item.tags.indexOf('favorite');

            if (this.state.favoriteUris.indexOf(item.remoteParty) === -1 && idx > -1) {
                item.tags.splice(idx, idx);
            }

        });

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
                data={items}
                renderItem={this.renderItem}
                keyExtractor={item => item.id}
                key={this.props.orientation}
              />
            </SafeAreaView>
        );
    }
}

HistoryTileBox.propTypes = {
    account         : PropTypes.object.isRequired,
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
    initialHistory  : PropTypes.array,
    localHistory    : PropTypes.array,
    myDisplayName   : PropTypes.string,
    myPhoneNumber   : PropTypes.string,
    setFavoriteUri  : PropTypes.func,
    setBlockedUri   : PropTypes.func,
    favoriteUris    : PropTypes.array,
    blockedUris     : PropTypes.array
};


export default HistoryTileBox;
