import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import autoBind from 'auto-bind';
import { FlatList, View, Platform, TouchableHighlight, TouchableOpacity, Dimensions} from 'react-native';
import { IconButton, Title, Button, Colors, Text, ActivityIndicator, Switch, Checkbox } from 'react-native-paper';
import { useSafeAreaInsets, initialWindowMetrics } from 'react-native-safe-area-context';
import SoundLevel from "react-native-sound-level";

import { red } from '../colors'; 

import ConferenceModal from './ConferenceModal';
import ContactsListBox from './ContactsListBox';

import FooterBox from './FooterBox';
import URIInput from './URIInput';
import utils from '../utils';
import {Keyboard} from 'react-native';
import QRCodeScanner from 'react-native-qrcode-scanner';
import { RNCamera } from 'react-native-camera';
import AudioRecord from 'react-native-audio-record';

import uuid from 'react-native-uuid';
import fileType from 'react-native-file-type';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import Sound from 'react-native-sound';

import styles from '../assets/styles/ReadyBox';

const audioRecorderPlayer = new AudioRecorderPlayer();


class ReadyBox extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.recordingStopTimer = null;

        this.state = {
            targetUri: this.props.selectedContact ? this.props.selectedContact.uri : '',
            sticky: false,
            contactsFilter: null,
            messagesCategoryFilter: null,
            historyPeriodFilter: null,
            participants: null,
            chat: (this.props.selectedContact !== null) && (this.props.call !== null),
            isTyping: this.props.isTyping,
            navigationItems: this.props.navigationItems,
            keys: this.props.keys,
			searchMessages: this.props.searchMessages,
			searchContacts: this.props.searchContacts,
			searchString: '',
			recordingDuration: 0,
			sortOrder: 'desc',
			orderBy: 'timestamp',
			showOrderBar: false,
			playRecording: false,
			level: 0,
        };

        this.ended = false;
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        if (this.ended) {
            return;
        }

        if (this.props.selectedContact) {
            this.setState({targetUri: nextProps.selectedContact ? nextProps.selectedContact.uri : '', chat: false});
        }

        if (!this.props.inviteContacts && nextProps.inviteContacts) {
            this.handleSearch('');
            this.setState({chat: false});
        }

        if (this.props.selectedContact !== nextProps.selectedContact && nextProps.selectedContact) {
            this.setState({chat: !this.chatDisabledForUri(nextProps.selectedContact.uri)});
            this.setState({playRecording: false});
        }

        if (this.props.selectedContact !== nextProps.selectedContact ) {
            this.setState({gettingSharedAsset: false});
        }

        if (nextProps.selectedContact !== this.props.selectedContact) {
           this.resetContact()
           this.setState({'messagesCategoryFilter': null});
           if (this.navigationRef && !this.props.selectedContact) {
               this.navigationRef.scrollToIndex({animated: true, index: 0});
           }
           if (this.props.selectedContact && this.props.pinned) {
               this.props.togglePinned(this.props.selectedContact.uri);
           }
        }

        if (!nextProps.historyFilter && this.props.historyFilter) {
            this.filterHistory(null);
        }

        if (nextProps.missedCalls.length === 0 && this.state.contactsFilter === 'missed') {
            this.setState({'contactsFilter': null});
        }

        if (nextProps.blockedUris.length === 0 && this.state.contactsFilter === 'blocked') {
            this.setState({'contactsFilter': null});
        }

        if (nextProps.favoriteUris.length === 0 && this.state.contactsFilter === 'favorite') {
            this.setState({'contactsFilter': null});
        }

        if (this.props.allContacts.length === 0 && nextProps.allContacts && nextProps.allContacts.length > 0) {
            this.bounceNavigation();
        }
                
        if (nextProps.searchString) {
            this.setState({'searchString': nextProps.searchString});
        }
        
        if ('playRecording' in nextProps) {
            console.log('playRecording', extProps.playRecording);
            this.setState({playRecording: nextProps.playRecording});
        }
        
        if ('recordingDuration' in nextProps) {
            this.setState({recordingDuration: nextProps.recordingDuration});
        }

        this.setState({
                        searchMessages: nextProps.searchMessages,
                        searchContacts: nextProps.searchContacts,
                        isTyping: nextProps.isTyping,
                        navigationItems: nextProps.navigationItems,
                        keys: nextProps.keys
                        });
    }

    getTargetUri(uri) {
        return utils.normalizeUri(uri, this.props.defaultDomain);
    }

    async componentDidMount() {
        this.ended = false;
    }

    componentWillUnmount() {
        this.ended = true;
    }
    
	componentDidUpdate(prevProps, prevState) {
	  if (prevState.searchMessages !== this.state.searchMessages && !this.state.searchMessages) {
            this.setState({sortOrder: 'desc', 
                           orderBy: 'timestamp',
                           messagesCategoryFilter: null
                           });
      }

		let keys = Object.keys(this.state);
		for (const key of keys) {		
			if (this.state[key] != prevState[key]) {
			    //console.log(' --- RB', key, 'has changed:', this.state[key]);
			}
		}
      
      
      if (prevState.searchContacts !== this.state.searchContacts && this.state.searchContacts) {
		  this.setState({messagesCategoryFilter: null, historyPeriodFilter: null});
		  this.props.filterHistoryFunc(null);
      }

      if (this.state.messagesCategoryFilter !== prevState.messagesCategoryFilter) {
		  console.log('messagesCategoryFilter did change', this.state.messagesCategoryFilter);
      }

      if (this.state.historyFilter !== prevState.historyFilter) {
		  if (this.state.historyFilter == 'calls' || this.state.historyFilter == 'conference') {
			  this.setState({historyPeriodFilter: 'recent'});
		  }

		  if (this.state.historyFilter == 'favorite' || this.state.historyFilter == 'test') {
			  this.setState({historyPeriodFilter: null});
		  }
      }

      if (prevState.orderBy !== this.state.orderBy) {
            if (this.state.orderBy == 'size') {
                this.setState({'sortOrder': 'desc'});
            }

            if (this.state.orderBy == 'timestamp') {
                this.setState({'sortOrder': 'desc'});
            }
      }

      if (prevState.selectedContact !== this.state.selectedContact && !prevState.selectedContact) {
        if (this.state.searchContacts) {
			this.props.toggleSearchContacts()
		}
      }
    }

    filterHistory(filter) {
       if (this.ended) {
            return;
       }

       //console.log('filterHistory', filter);

       if (this.props.selectedContact) {
           if (!filter && this.props.pinned) {
               this.props.togglePinned(this.props.selectedContact.uri);
           }

           if (filter === 'pinned') {
               this.props.togglePinned(this.props.selectedContact.uri);
               return;
           }

           if (filter === this.state.messagesCategoryFilter) {
               this.setState({'messagesCategoryFilter': null});
           } else {
               this.setState({'messagesCategoryFilter': filter});
           }
           return;
       }

       this.props.filterHistoryFunc(filter);

       if (!filter) {
           if (!this.state.historyPeriodFilter) {
               /*
               let orderBy;
               if (this.state.orderBy == 'timestamp') {
				   this.props.postSystemNotification('Sort by used storage');
				   orderBy = 'storage';
               } else {
				   this.props.postSystemNotification('Sort by last message');
				   orderBy = 'timestamp';
               }
			   this.setState({'orderBy': orderBy});
			   */
           }
           this.setState({historyPeriodFilter: null, contactsFilter: null});
       } else if (filter === 'recent') {
           filter = this.state.historyPeriodFilter === filter ? null : filter;
           this.setState({'historyPeriodFilter': filter});
       } else {
           if (filter == this.state.contactsFilter) {
			   this.setState({contactsFilter: null});
           } else {
			   this.setState({'contactsFilter': filter});
           }
       }

       this.handleSearch('');
       
    }

    chatDisabledForUri(uri) {
        if (uri.indexOf('@videoconference') > -1) {
            return true;
        }

        if (uri.indexOf('@guest') > -1) {
            return true;
        }

        if (uri.indexOf('3333@') > -1) {
            return true;
        }

        if (uri.indexOf('4444@') > -1) {
            //return true;
        }

        return false;
    }

    get showNavigationBar() {
        if (this.props.keyboardVisible) {
            return;
        }

        if (this.props.selectedContact) {
            //return false;
        }

        if (this.state.recording) {
            //return false;
        }

        return true;
    }

    get showSearchBar() {
        if (!this.state.searchMessages && !this.state.searchContacts) {
			return false;
        }
        
		if (this.state.messagesCategoryFilter == 'image') {
			return false;
		}

        if (this.props.selectedContact) {
            if (!this.state.searchMessages) {
				return false;
            }
        }

        if (this.props.showQRCodeScanner) {
            return false;
        }

        if (this.props.isTablet || (!this.props.isLandscape && this.props.selectedContact)) {
            return true;
        }

        /*
        if (this.props.call && this.props.call.state !== 'incoming' && !this.props.inviteContacts) {
            return false;
        }
        */

        return true;
    }

   get showCategoryBar() {
	   if (this.props.selectedContact) {
		   return this.state.searchMessages || this.state.messagesCategoryFilter || this.state.orderBy == 'size';
	   } else {
		   return this.state.searchContacts && this.props.allContacts.length > 10;
	   }
   }

    get showConferenceButton() {
        if (this.props.selectedContact) {
            return false;
        }
        
        if (this.state.recording || this.state.previewRecording) {
            return false;
        }

        if (this.props.shareToContacts) {
            return false;
        }
        return true;
    }

    get showCallButtons() {
        if (this.props.call || this.state.recording || this.state.playRecording || this.state.previewRecording || this.state.recordingFile || this.props.shareToContacts) {
            return false;
        }
        return true;
    }

    get showAudioSendButton() {
        if (!this.props.selectedContact) {
            return false;
        }

        if (!this.state.recordingFile) {
            return false;
        }
        return true;
    }

    get showAudioDeleteButton() {
        if (!this.state.recordingFile) {
            return false;
        }
        return true;
    }

    get showAudioStopButton() {
        return this.state.playRecording;
    }

    get showAudioRecordButton() {
        if (!this.props.selectedContact) {
            return false;
        }

        if (this.props.call) {
            return false;
        }

	    if (this.props.selectedContact && this.props.selectedContact.uri.indexOf('@videoconference') > -1) {
            return false;
        }

	    if (this.props.selectedContact && this.props.selectedContact.uri.indexOf('@guest') > -1) {
            return false;
        }
        
        if (this.props.selectedContact) {
			const els = this.props.selectedContact.uri.split('@');
			const username = els[0];
			const isNumber = utils.isPhoneNumber(username);
			
			if (isNumber && (username.startsWith('0') || username.startsWith('+'))) {
				return false;
			}
		}

	 
        if (this.state.recordingFile) {
            return false;
        }
 
        if (this.state.playRecording) {
            return false;
        }
 
        return true;
    }

    get showButtonsBar() {
        if (this.props.fullScreen) {
            return false;
        }

        if (this.props.inviteContacts) {
			return true;
        }
                        
        if (this.props.shareToContacts) {
			return true;
        }

        if (this.props.contactIsSharing) {
			return false;
        }

        if (this.state.contactsFilter === 'blocked') {
            return false;
        }

        if (this.props.keyboardVisible && this.props.selectedContact) {
            return false;
        }        

        if (this.state.orderBy === 'size' && this.props.selectedContact) {
            return false;
        }        


        if (this.state.searchMessages) {
            return false;
        }        

        if (this.props.showQRCodeScanner) {
            return false;
        }

        if (this.props.isTablet) {
            return true;
        }

        if (this.props.call) {
            return false;
        }

        if (!this.state.targetUri) {

            return false;
        }

        if (this.props.isLandscape) {
            return false;
        }

        /*
        if (this.props.selectedContact) {
            if (this.props.isLandscape && !this.props.isTablet) {
                return false;
            }
            return false;
        }
        */

        return true;
    }

    handleSearch(inputText, contact) {
        //console.log('handleSearch', inputText);
        if (this.state.searchMessages) {
            if (!inputText) {
				this.props.toggleSearchMessages();
				this.setState({searchString: ''});
			} else {
				this.setState({searchString: inputText});
			}
			return;
        }

        //console.log('handleSearch contact =', contact);

        if ((this.props.inviteContacts || this.props.shareToContacts) && contact) {
             const uri = contact.uri;
             this.props.updateSelection(uri);
             return;
        }

        if (this.props.selectedContact === contact) {
            if (this.state.chat) {
                this.setState({chat: false});
            }
            return;
        } else {
            this.setState({chat: false});
        }

        let new_value = inputText;

        if (contact) {
            if (this.state.targetUri === contact.uri) {
                new_value = '';
            }
        } else {
            contact = null;
        }

        if (this.state.targetUri === inputText) {
            new_value = '';
        }

        if (new_value === '') {
            contact = null;
        }

        if (new_value.indexOf(' ') === -1) {
            new_value = new_value.trim().toLowerCase();
        }

        //new_value = new_value.replace(' ','');

        //console.log('--- Select new contact', contact? contact.uri : null);
        //console.log('--- Select new targetUri', new_value);

        this.props.selectContact(contact);
        this.setState({targetUri: new_value});
    }

    handleTargetSelect() {
        console.log('---handleTargetSelect');
        
        if (this.state.searchMessages) {
			return;
        }

        if (this.props.connection === null) {
            this.props._notificationCenter.postSystemNotification("Server unreachable");
            return;
        }

        let uri = this.state.targetUri.toLowerCase();

        if (uri.indexOf('@videoconference.') > -1) {
            let participants;
            if (this.props.myInvitedParties && this.props.myInvitedParties.hasOwnProperty(uri)) {
                participants = this.props.myInvitedParties[uri];
            }
            this.props.startConference(uri, {audio: true, video: true, participants: this.state.participants});
        } else {
            this.props.startCall(this.getTargetUri(uri), {audio: true, video: true});
        }
    }

    shareContent() {
        this.props.shareContent();
    }

    cancelShareContent() {
        this.props.cancelShareContent();
    }

    showConferenceModal(event) {
        event.preventDefault();
        this.props.showConferenceModalFunc();
    }


    handleChat(event) {
        console.log('handleChat');
        event.preventDefault();
 
        let uri = this.state.targetUri.trim().toLowerCase();
	    this.setState({targetUri: ''});

		this.props.createChatContact(uri);
		Keyboard.dismiss();
    }

    handleAudioCall(event) {
        let uri;

        if (this.props.selectedContact) {
            uri = this.props.selectedContact.uri;
        } else {
            event.preventDefault();
            Keyboard.dismiss();
            uri = this.state.targetUri.trim().toLowerCase();
            var uri_parts = uri.split("/");
            if (uri_parts.length === 5 && uri_parts[0] === 'https:') {
                // https://webrtc.sipthor.net/conference/DaffodilFlyChill0 from external web link
                // https://webrtc.sipthor.net/call/alice@example.com from external web link
                let event = uri_parts[3];
                uri = uri_parts[4];
                if (event === 'conference') {
                    uri = uri.split("@")[0] + '@' + this.props.defaultConferenceDomain;
                }
            }
        }

        if (uri.indexOf('@videoconference.') > -1) {
            this.props.startConference(uri, {audio: true, video: false});
        } else {
            this.props.startCall(this.getTargetUri(uri), {audio: true, video: false});
        }
    }

    handleVideoCall(event) {
        //console.log('handleVideoCall')
        let uri;

        if (this.props.selectedContact) {
            uri = this.props.selectedContact.uri;
        } else {
            event.preventDefault();
            Keyboard.dismiss();
            uri = this.state.targetUri.trim().toLowerCase();
            var uri_parts = uri.split("/");
            if (uri_parts.length === 5 && uri_parts[0] === 'https:') {
                // https://webrtc.sipthor.net/conference/DaffodilFlyChill0 from external web link
                // https://webrtc.sipthor.net/call/alice@example.com from external web link
                let event = uri_parts[3];
                uri = uri_parts[4];
                if (event === 'conference') {
                    uri = uri.split("@")[0] + '@' + this.props.defaultConferenceDomain;
                }
            }
        }

        if (uri.indexOf('@videoconference.') > -1) {
            this.props.startConference(uri, {audio: true, video: true});
        } else {
            this.props.startCall(this.getTargetUri(uri), {audio: true, video: true});
        }
    }

    handleConferenceCall(targetUri, options={audio: true, video: true, participants: []}) {
        Keyboard.dismiss();
        //console.log('handleConferenceCall options', options);
        this.props.startConference(targetUri, {audio: options.audio, video: options.video, participants: options.participants});
        this.props.hideConferenceModalFunc();
    }

    get chatButtonDisabled() {
        let uri = this.state.targetUri.trim();

        if (!uri) {
            return true;
        }

        if (this.props.selectedContact) {
            return true;
        }

        if (this.props.shareToContacts) {
            return true;
        }

        let username = uri.split('@')[0];
        let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

        if (isPhoneNumber) {
            return true;
        }

        if (uri.indexOf('@') > -1) {
            let email_reg = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/;
            let validEmail = email_reg.test(uri);
            if (!validEmail) {
                return true;
            }
        }

        if (this.chatDisabledForUri(uri)) {
            return true;
        }

        return false;
    }

    get callButtonDisabled() {
        let uri = this.state.targetUri.trim();
        if (!uri || uri.indexOf(' ') > -1 || uri.indexOf('@guest.') > -1) {
            return true;
        }

        if (this.props.shareToContacts) {
            return true;
        }

        if (this.state.recording) {
            return true;
        }

        if (this.state.recordingFile) {
            return true;
        }

		const els = uri.split('@');
        const username = els[0];
		const isNumber = utils.isPhoneNumber(username);

        if (isNumber) {
            return false;
        }

        if (uri.indexOf('@') > -1) {
            let email_reg = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/;
            let validEmail = email_reg.test(uri);
            if (!validEmail) {
                return true;
            }
        }

        return false;
    }

    get videoButtonDisabled() {
        let uri = this.state.targetUri.trim();
        if (!uri || uri.indexOf(' ') > -1 || uri.indexOf('@guest.') > -1) {
            return true;
        }

        if (uri.indexOf('4444@') > -1) {
            return true;
        }

        if (this.props.shareToContacts) {
            return true;
        }

        if (this.state.recording) {
            return true;
        }

        if (this.state.recordingFile) {
            return true;
        }

        let username = uri.split('@')[0];
        let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

        if (isPhoneNumber) {
            return true;
        }

        return this.callButtonDisabled;
    }

    get conferenceButtonDisabled() {
        if (!this.props.canSend()) {
            return true;
        }

        let uri = this.state.targetUri.trim();

        if (uri.indexOf(' ') > -1) {
            return true;
        }

        if (this.props.shareToContacts) {
            return true;
        }

        let username = uri.split('@')[0];
        let isPhoneNumber = username.match(/^(\+|0)(\d+)$/);

        if (isPhoneNumber) {
            return true;
        }

        if (uri.indexOf('@videoconference.') > -1) {
            return true;
        }

        var uri_parts = uri.split("/");
        if (uri_parts.length === 5 && uri_parts[0] === 'https:') {
            // https://webrtc.sipthor.net/conference/DaffodilFlyChill0 from external web link
            // https://webrtc.sipthor.net/call/alice@example.com from external web link
            let event = uri_parts[3];
            if (event === 'call') {
                return true;
            }
        }

        return false;
    }

	async startAudioPlayer() {
	    //console.log('-- RB startAudioPlayer');
		this.setState({playRecording: true});
	}

	async stopAudioPlayer() {
		this.setState({playRecording: false});
	}

    async previewAudio () {
		this.setState({previewRecording: true});

		const path = this.state.recordingFile.startsWith('file://')
		  ? this.state.recordingFile
		  : 'file://' + this.state.recordingFile;
  
        try {
			const msg = await audioRecorderPlayer.startPlayer(path);
			this.setState({previewRecording: true});
	
			audioRecorderPlayer.addPlayBackListener((e) => {
				if (e.duration === e.currentPosition) {
					this.setState({previewRecording: false});
				}
	
				this.setState({
				  currentPositionSec: e.currentPosition,
				  currentDurationSec: e.duration,
				  playTime: audioRecorderPlayer.mmssss(Math.floor(e.currentPosition)),
				  duration: audioRecorderPlayer.mmssss(Math.floor(e.duration)),
				});
			});
        } catch (e) {
			console.log('previewAudio error', e);
        }
    };

    pausePreviewAudio = async () => {
		this.setState({previewRecording: false});
        await audioRecorderPlayer.pausePlayer();
    };

    onStopPlay = async () => {
        if (!this.state.previewRecording) {
			return;
        }
        this.setState({previewRecording: false});
        audioRecorderPlayer.stopPlayer();
        audioRecorderPlayer.removePlayBackListener();
    };

    bounceNavigation() {
        return;
        
        if (this.ended) {
            return;
        }

        setTimeout(() => {
           if (this.ended) {
                return;
           }
            if (this.navigationRef && !this.props.selectedContact) {
                this.navigationRef.scrollToIndex({animated: true, index: Math.floor(this.navigationItems.length / 2)});
            }
        }, 3000);

        setTimeout(() => {
           if (this.ended) {
                return;
           }
            if (this.navigationRef && !this.props.selectedContact) {
                this.navigationRef.scrollToIndex({animated: true, index: this.navigationItems.length-1});
            }
        }, 4500);

        setTimeout(() => {
           if (this.ended) {
                return;
           }
            if (this.navigationRef && !this.props.selectedContact) {
                this.navigationRef.scrollToIndex({animated: true, index: 0});
            }
        }, 6000);
    }

    get categoryItems() {
 		let content_items = [];

        if (this.props.selectedContact) {
             
            if (this.state.orderBy !== 'size') {
				content_items.push({key: 'text', title: 'Text', enabled: true, selected: this.state.messagesCategoryFilter === 'text'});
			}
			content_items.push({key: 'audio', title: 'Audio', enabled: true, selected: this.state.messagesCategoryFilter === 'audio'});
			content_items.push({key: 'image', title: 'Image', enabled: true, selected: this.state.messagesCategoryFilter === 'image'});
			content_items.push({key: 'video', title: 'Video', enabled: true, selected: this.state.messagesCategoryFilter === 'video'});
			content_items.push({key: 'other', title: 'Other', enabled: true, selected: this.state.messagesCategoryFilter === 'other'});

            if ('pinned' in this.props.contentTypes) {
                content_items.push({key: 'pinned', title: 'Pinned', enabled: true, selected: this.props.pinned});
            }
			content_items.push({key: 'orderByTime', title: 'By Time', enabled: this.state.orderBy === 'timestamp', selected: false});
			content_items.push({key: 'orderBySize', title: 'By Size', enabled:  this.state.orderBy === 'size', selected: false});
            content_items.push({key: 'orderAscending', title: '↑ Asc', enabled: this.state.sortOrder === 'asc', selected: false});
            content_items.push({key: 'orderDescending', title: '↓ Desc', enabled: this.state.sortOrder === 'desc', selected: false});

            return content_items;
        }

        if (this.showCategoryBar) {
			content_items.push({key: 'orderByTime', title: 'Sort by most recent', enabled: this.state.orderBy === 'timestamp', selected: false});
			content_items.push({key: 'orderBySize', title: 'Sort by storage', enabled:  this.state.orderBy === 'size', selected: false});
            content_items.push({key: 'orderAscending', title: '↑ Ascending', enabled: this.state.sortOrder === 'asc', selected: false});
            content_items.push({key: 'orderDescending', title: '↓ Descending', enabled: this.state.sortOrder === 'desc', selected: false});
            return content_items;
        }
        
        return content_items;

    }

    get navigationItems() {
        let conferenceEnabled = Object.keys(this.props.myInvitedParties).length > 0 || this.state.navigationItems['conference'];
        if (this.props.inviteContacts) {
            conferenceEnabled = false;
        }

        if (this.state.recordingFile) {
			return [
              {key: "previewAudio", title: 'Play', enabled: true, selected: false},
              {key: "deleteAudio", title: 'Delete', enabled: true, selected: false},
              {key: "sendAudio", title: 'Send', enabled: true, selected: false}
              ];
        }

        if (this.props.showQRCodeScanner) {
            return [
              {key: "hideQRCodeScanner", title: 'Cancel', enabled: true, selected: false}
              ];
        }

        return [
              {key: 'recent', title: 'Recent', enabled: this.state.navigationItems['recent'], selected: this.state.historyPeriodFilter === 'recent'},
              {key: 'calls', title: 'Calls', enabled: true, selected: this.state.contactsFilter === 'calls'},
              {key: 'favorite', title: 'Favorites', enabled: this.props.favoriteUris.length > 0, selected: this.state.contactsFilter === 'favorite'},
              {key: 'autoanswer', title: 'Caregivers', enabled: this.props.hasAutoAnswerContacts, selected: this.state.contactsFilter === 'autoanswer'},
              {key: 'missed', title: 'Missed', enabled: this.props.missedCalls.length > 0, selected: this.state.contactsFilter === 'missed'},
              {key: 'blocked', title: 'Blocked', enabled: this.props.blockedUris.length > 0, selected: this.state.contactsFilter === 'blocked'},
              {key: 'conference', title: 'Conference', enabled: conferenceEnabled, selected: this.state.contactsFilter === 'conference'},
              {key: 'test', title: 'Test', enabled: !this.props.shareToContacts && !this.props.inviteContacts, selected: this.state.contactsFilter === 'test'},
              ];
    }

    get sortOrderItems() {
        return [
              {key: null, title: 'Order:', enabled: true, selected: false},
              {key: 'orderByTime', title: 'Time', enabled: true, selected: this.state.orderBy === 'timestamp'},
              {key: 'orderBySize', title: 'Size', enabled: true, selected: this.state.orderBy === 'size'},
              {key: 'divider1', title: '', enabled: true, selected: false},
              {key: 'orderAscending', title: '↑ Asc', enabled: true, selected: this.state.sortOrder === 'asc'},
              {key: 'orderDescending', title: '↓ Desc', enabled: true, selected: this.state.sortOrder === 'desc'},
              ];
    }

    renderNavigationItem(object) {
        if (!object.item.enabled) {
            return (null);
        }

        let title = object.item.title;
        let key = object.item.key;
        let buttonStyle = object.item.selected ? styles.navigationButtonSelected : styles.navigationButton;

        if (key === "hideQRCodeScanner") {
            return (<Button style={buttonStyle} onPress={() => {this.toggleQRCodeScanner()}}>{title}</Button>);
        }

        if (key === "deleteAudio") {
            return (<Button style={buttonStyle} onPress={() => {this.deleteAudio()}}>{title}</Button>);
        }

        if (key === "previewAudio") {
            return (<Button style={buttonStyle} onPress={() => {this.previewAudio()}}>{title}</Button>);
        }

        if (key === "sendAudio") {
            return (<Button style={buttonStyle} onPress={() => {this.sendAudioFile()}}>{title}</Button>);
        }

        if (key === "orderByTime") {
            return (<Button style={buttonStyle} onPress={() => {this.setState({orderBy: 'size'})}}>{title}</Button>);
        }

        if (key === "orderBySize") {
            return (<Button style={buttonStyle} onPress={() => {this.setState({orderBy: 'timestamp'})}}>{title}</Button>);
        }

        if (key === "orderAscending") {
            return (<Button style={buttonStyle} onPress={() => {this.setState({sortOrder: 'desc'})}}>{title}</Button>);
        }

        if (key === "orderDescending") {
            return (<Button style={buttonStyle} onPress={() => {this.setState({sortOrder: 'asc'})}}>{title}</Button>);
        }

        return (<Button style={buttonStyle} onPress={() => {this.filterHistory(key)}}>{title}</Button>);
    }

    renderOrderItem(object) {
        if (!object.item.enabled) {
            return (null);
        }

        let title = object.item.title;
        let key = object.item.key;
        let buttonStyle = object.item.selected ? styles.navigationButtonSelected : styles.navigationButton;

        if (key === "orderByTime") {
            return (<Button style={buttonStyle} onPress={() => {this.setState({orderBy: 'timestamp'})}}>{title}</Button>);
        }

        if (key === "orderBySize") {
            return (<Button style={buttonStyle} onPress={() => {this.setState({orderBy: 'size'})}}>{title}</Button>);
        }

        if (key === "orderAscending") {
            return (<Button style={buttonStyle} onPress={() => {this.setState({sortOrder: 'asc'})}}>{title}</Button>);
        }

        if (key === "orderDescending") {
            return (<Button style={buttonStyle} onPress={() => {this.setState({sortOrder: 'desc'})}}>{title}</Button>);
        }

        return (<Button style={buttonStyle} onPress={() => {this.filterHistory(key)}}>{title}</Button>);
    }
    
    toggleQRCodeScanner(event) {
        //console.log('Scan QR code...');
        this.props.toggleQRCodeScannerFunc();
    }

    QRCodeRead(e) {
        //console.log('QR code object:', e);
        console.log('QR code data:', e.data);
        this.props.toggleQRCodeScannerFunc();
        this.handleSearch(e.data);
    }

    get showContactsList() {
        if (this.state.recording) {
             //return false;
        }

        if (this.state.recordingFile) {
             //return false;
        }
        
        return true;
    }

    get showQRCodeButton() {
        return false;
        if (!this.props.canSend()) {
            return false;
        }

        if (this.props.shareToContacts) {
            return false;
        }

        let uri = this.state.targetUri.toLowerCase();
        return uri.length === 0 && !this.props.shareToContacts && !this.props.inviteContacts;
    }

    async recordAudio() {
        const micAllowed = await this.props.requestMicPermission('recordAudio');

        if (!micAllowed) {
            console.log('Mic not allowed');
            return;
        }

        if (!this.state.recording) {
            if (this.state.recordingFile) {
                this.deleteAudio();
            } else {
                this.onStartRecord();
            }
        } else {
            this.onStopRecord();
        }
    }

    recordAudio(event) {
        event.preventDefault();
        Keyboard.dismiss();
        this.props.recordAudio();
    }

    async sendAudioFile() {
        if (this.state.recordingFile) {
            this.setState({audioSendFinished: true});
            setTimeout(() => {
                this.setState({audioSendFinished: false});
            }, 10);
            let msg = await this.props.file2GiftedChat(this.state.recordingFile);
            this.transferFile(msg);
            this.setState({recordingFile: null, recordingDuration: 0});
        }
    }

    async transferFile(msg) {
        msg.metadata.preview = false;
        this.props.sendMessage(msg.metadata.receiver.uri, msg, 'application/sylk-file-transfer');
    }

    deleteAudioAction(event) {
        //console.log('deleteAudioAction');
        event.preventDefault();
        this.onStopPlay();
        this.deleteAudio();
    }

    async recordAudio() {
        //console.log('Start recording by user...');

        const micAllowed = await this.props.requestMicPermission('recordAudio');

        if (!micAllowed) {
            return;
        }

        if (!this.state.recording) {
            if (this.state.recordingFile) {
                this.deleteAudio();
            } else {
                this.onStartRecord();
            }
        } else {
            this.onStopRecord();
        }
    }

    deleteAudio() {
        console.log('Delete audio');
        this.setState({recordingFile: null, 
					   recordingDuration: 0,
                       recording: false, 
                       previewRecording: false});

        if (this.props.selectedContact) {
			this.props.getMessages(this.props.selectedContact.uri);
		}
    }

	stopRecordingTimer() {
		//console.log('Ready box: stopRecordingTimer');
		if (this.recordingStopTimer !== null) {
		    clearTimeout(this.recordingStopTimer);
			this.recordingStopTimer = null;
		}
	}
        
    async onStartRecord () {
		const audioOptions = {
			sampleRate: 16000,  // default 44100
			channels: 1,        // 1 or 2, default 1
			bitsPerSample: 16,  // 8 or 16, default 16
			audioSource: 6,     // android only (see below)
			wavFile: 'sylk-audio-recording.wav' // default 'audio.wav'
		};

		SoundLevel.start();
	
		SoundLevel.onNewFrame = (data) => {
			  // data.value is in dB (e.g., -40 to -5)
			  // Normalize to 0–1
			  const normalized = Math.min(Math.max((data.value + 60) / 60, 0), 1);
			  this.setState({ level: normalized });
		   };
         		
		//console.log('Start audio recording...')

        try {
            AudioRecord.init(audioOptions);
			// Register listener for incoming audio data
			AudioRecord.on('data', (data) => {
			  // `data` is base64-encoded audio chunk
			  //console.log('Audio chunk received:', data.length);
			  // You can store or process the chunk here
			});
            AudioRecord.start();
			this.setState({recording: true});

			this.recordingStopTimer = setTimeout(() => {
				//console.log('Stop recording by timer...');
				this.onStopRecord();
			}, 30000);

			this.props.vibrate();

        } catch (e) {
            console.log(e.message);
        }
    };

    stopRecording() {
        //console.log('Stop recording by user...');
        this.onStopRecord();
    }

    async onStopRecord () {
        //console.log('onStopRecord...');
        this.setState({recording: false});
        this.stopRecordingTimer();
        const result = await AudioRecord.stop();
        this.audioRecorded(result);
        this.setState({recordingFile: result});
		SoundLevel.stop();
    };

    resetContact() {
        this.stopRecordingTimer()
        this.setState({
            recording: false,
            recordingFile: null,
            recordingDuration: 0,
            audioSendFinished: false,
            searchString: ''
        });
    }

    async audioRecorded(file) {
        if (file) {
            console.log('Audio recording ready to send', file);
            try {
				const sound = new Sound(file, '', (error) => {
				  if (error) {
					console.log('Failed to load the audio', error);
					return;
				  }
				  const duration = Math.floor(sound.getDuration());
				  this.setState({recordingDuration: duration});
			    });
			} catch (e) {
				console.log('error', e);
			}
			this.setState({recording: false, recordingFile: file});
        }
    }
    
    get showBackToCallButton() {
        if (this.props.shareToContacts) {
			return false;
        }

        if (this.props.isLandscape) {
			return false;
        }
        
        if (this.props.call) {
            if (this.props.call.state !== 'incoming' && this.props.call.state !== 'terminated') {
				return true;
			}
        }

		return false;
    
    }

    render() {
    
        let URIContainerClass = styles.portraitUriInputBox;
        let uriGroupClass = styles.portraitUriButtonGroup;
        let titleClass = styles.portraitTitle;
        
        let uri = this.state.targetUri.toLowerCase();
        var uri_parts = uri.split("/");
        if (uri_parts.length === 5 && uri_parts[0] === 'https:') {
            // https://webrtc.sipthor.net/conference/DaffodilFlyChill0 from external web link
            // https://webrtc.sipthor.net/call/alice@example.com from external web link
            let event = uri_parts[3];
            uri = uri_parts[4];
            if (event === 'conference') {
                uri = uri.split("@")[0] + '@' + this.props.defaultConferenceDomain;
            }
        }

        if (this.props.isTablet) {
             titleClass = this.props.orientation === 'landscape' ? styles.landscapeTabletTitle : styles.portraitTabletTitle;
        } else {
             titleClass = this.props.orientation === 'landscape' ? styles.landscapeTitle : styles.portraitTitle;
        }

        if (this.props.isTablet) {
             uriGroupClass = this.props.orientation === 'landscape' ? styles.landscapeTabletUriButtonGroup : styles.portraitTabletUriButtonGroup;
        } else {
             uriGroupClass = this.props.orientation === 'landscape' ? styles.landscapeUriButtonGroup : styles.portraitUriButtonGroup;
        }

        if (this.props.isTablet) {
            URIContainerClass = this.props.orientation === 'landscape' ? styles.landscapeTabletUriInputBox : styles.portraitTabletUriInputBox;
        } else {
            URIContainerClass = styles.portraitUriInputBox;
        }
        
        URIContainerClass = styles.portraitUriInputBox;

        const historyContainer = this.props.orientation === 'landscape' ? styles.historyLandscapeContainer : styles.historyPortraitContainer;
        const buttonGroupClass = this.props.orientation === 'landscape' ? styles.buttonGroup : styles.buttonGroup;
        const borderClass = this.state.chat ? null : styles.historyBorder;
        let backButtonTitle = 'Back to call';

		let { width, height } = Dimensions.get('window');

		const topInset = this.props.insets?.top || 0;
		const bottomInset = this.props.insets?.bottom || 0;
		const leftInset = this.props.insets?.left || 0;
		const rightInset = this.props.insets?.right || 0;
		
		const marginRight = this.props.isLandscape ? rightInset : 0;

		let containerWidth = width - marginRight;
		let containerHeight = height;
		
		let navigationContainer = {borderWidth: 0,
						   borderColor: 'blue'
						   }
	
		let containerExtraStyles = {
//						   width: containerWidth,
//						   marginRight: marginRight,
						   borderWidth: 0,
						   borderColor: 'red'
						   }

        /*
		if (Platform.OS === 'ios') {
			if (this.props.isLandscape) {
				containerExtraStyles.width = containerWidth - rightInset;
				containerExtraStyles.marginBottom = -bottomInset;	
			}
		} else {
			if (this.props.isLandscape) {
				containerExtraStyles.width = containerWidth;
				containerExtraStyles.marginBottom = -rightInset;
			}
		}
		*/
                
        //console.log('this.props.call', this.props.call);
        if (this.showBackToCallButton) {
            if (this.props.call.hasOwnProperty('_participants')) {
                backButtonTitle = this.props.selectedContacts.length > 0 ? 'Invite people' : 'Back to conference';
            } else {
                backButtonTitle = this.props.selectedContacts.length > 0 ? 'Invite people' : 'Back to call';
            }
        }

        let greenButtonClass         = Platform.OS === 'ios' ? styles.greenButtoniOS             : styles.greenButton;
        let blueButtonClass          = Platform.OS === 'ios' ? styles.blueButtoniOS              : styles.blueButton;
        let redButtonClass           = Platform.OS === 'ios' ? styles.redButtoniOS               : styles.redButton;
        let disabledGreenButtonClass = Platform.OS === 'ios' ? styles.disabledGreenButtoniOS     : styles.disabledGreenButton;
        let disabledBlueButtonClass  = Platform.OS === 'ios' ? styles.disabledBlueButtoniOS      : styles.disabledBlueButton;
        let recordIcon               = this.state.recording ? 'pause' : 'microphone';
        let activityTitle            = this.state.recording ? "Recording audio" : "Audio recording ready";
        
        const sharedContent = this.props.sharedContent || [];
        
		const hasImages = sharedContent.some(
		  file => typeof file.mimeType === 'string' && file.mimeType.startsWith('image/')
		);

        let fileTransfersDisabled = false;

        if (this.props.selectedContact) {
            fileTransfersDisabled = false;

            if (this.props.selectedContact.tags.indexOf('test') > -1) {
                fileTransfersDisabled = true;
            }

            if (this.props.selectedContact.uri.indexOf('@videoconference') > -1) {
                fileTransfersDisabled = true;
            }

            if (this.props.selectedContact.uri.indexOf('@conference') > -1) {
                fileTransfersDisabled = true;
            }
        }

        return (
            <Fragment>
                <View style={[styles.container, containerExtraStyles]}>
                    <View>
                    {this.showCategoryBar?
                    <View style={navigationContainer}>
                        <FlatList contentContainerStyle={styles.navigationButtonGroup}
                            horizontal={true}
                            ref={(ref) => { this.navigationRef = ref; }}
                              onScrollToIndexFailed={info => {
                                const wait = new Promise(resolve => setTimeout(resolve, 10));
                                wait.then(() => {
                                  if (!this.props.selectedContact) {
                                      this.navigationRef.current?.scrollToIndex({ index: info.index, animated: true/false });
                                  }
                                });
                              }}
                            data={this.categoryItems}
                            extraData={this.state}
                            keyExtractor={(item, index) => item.key}
                            renderItem={this.renderNavigationItem}
                        />
                    </View>
                    : null}

                    {false ?
                    <View style={navigationContainer}>
                        <FlatList contentContainerStyle={styles.navigationButtonGroup}
                            horizontal={true}
                            ref={(ref) => { this.navigationRef = ref; }}
                              onScrollToIndexFailed={info => {
                                const wait = new Promise(resolve => setTimeout(resolve, 10));
                                wait.then(() => {
                                  if (!this.props.selectedContact) {
                                      this.navigationRef.current?.scrollToIndex({ index: info.index, animated: true/false });
                                  }
                                });
                              }}
                            data={this.sortOrderItems}
                            extraData={this.state}
                            keyExtractor={(item, index) => item.key}
                            renderItem={this.renderOrderItem}
                        />
                    </View>
                    : null}

                        {this.showSearchBar ?
                        <View style={URIContainerClass}>
                            <URIInput
                                defaultValue={this.state.searchMessages ? this.state.searchString : this.state.targetUri}
                                onChange={this.handleSearch}
                                onSelect={this.handleTargetSelect}
                                shareToContacts={this.props.shareToContacts}
                                inviteContacts={this.props.inviteContacts}
                                searchMessages={this.state.searchMessages}
                                //autoFocus={this.state.searchMessages}
                                autoFocus={false}
                                dark={this.props.dark}
                            />
                        </View>
                        : null}

                           {(this.showBackToCallButton && !this.showButtonsBar)?
                            <View style={buttonGroupClass}>
                                <Button
                                    mode="contained"
                                    style={styles.backButton}
                                    onPress={this.props.goBackFunc}
                                    accessibilityLabel={backButtonTitle}
                                    >{backButtonTitle}
                                </Button>
                            </View>
                            :
                            null}

                        {this.showButtonsBar ?
							<View style={uriGroupClass}>
	
                            {this.showBackToCallButton ?
                            <View style={buttonGroupClass}>
                                <Button
                                    mode="contained"
                                    labelStyle={{ fontSize: 14 }}
                                    style={styles.backButton}
                                    onPress={this.props.goBackFunc}
                                    accessibilityLabel={backButtonTitle}
                                    >{backButtonTitle}
                                </Button>
                            </View>
                            :

                            <View style={[buttonGroupClass, {borderWidth: 0, borderColor: 'white'}]}>
                                  {!this.props.selectedContact && !this.props.shareToContacts?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                        style={this.chatButtonDisabled ? disabledGreenButtonClass : greenButtonClass}
                                        size={32}
                                        disabled={this.chatButtonDisabled}
                                        onPress={this.handleChat}
                                        icon="chat"
                                    />
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  {this.showCallButtons ? 
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={this.callButtonDisabled ? disabledGreenButtonClass : greenButtonClass}
                                            size={32}
                                            disabled={this.callButtonDisabled}
                                            onPress={this.handleAudioCall}
                                            icon="phone"
                                        />
                                    </TouchableHighlight>
                                  </View>

                                  : null }

                                  {this.showCallButtons? 
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={this.videoButtonDisabled ? disabledGreenButtonClass : greenButtonClass}
                                            size={32}
                                            disabled={this.videoButtonDisabled}
                                            onPress={this.handleVideoCall}
                                            icon="video"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  {this.state.recordingFile?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={greenButtonClass}
                                            size={32}
                                            onPress={this.state.previewRecording ? this.pausePreviewAudio : this.previewAudio }
                                            icon={this.state.previewRecording ? "pause" : "play"}
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null }


                                  {this.showAudioRecordButton?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                        style={blueButtonClass}
                                        size={32}
                                        disabled={fileTransfersDisabled}
                                        onPress={this.recordAudio}
                                        icon={recordIcon}
                                    />
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  {this.showAudioDeleteButton ?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={redButtonClass}
                                            size={32}
                                            onPress={this.deleteAudio}
                                            icon="cancel"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  {this.showAudioStopButton ?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={redButtonClass}
                                            size={32}
                                            onPress={() => {this.stopAudioPlayer()}}
                                            icon="pause"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  
                                  { this.props.shareToContacts ?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={redButtonClass}
                                            size={32}
                                            onPress={this.cancelShareContent}
                                            icon="cancel"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null}

                                  {this.showConferenceButton ?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={this.conferenceButtonDisabled ? disabledBlueButtonClass : blueButtonClass}
                                            disabled={this.conferenceButtonDisabled}
                                            size={32}
                                            onPress={this.showConferenceModal}
                                            icon="account-group"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  {this.showAudioSendButton ?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={blueButtonClass}
                                            disabled={!this.state.recordingFile}
                                            size={32}
                                            onPress={this.sendAudioFile}
                                            icon="share"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  { this.props.shareToContacts ?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            style={!this.props.shareToContacts ? disabledBlueButtonClass : blueButtonClass}
                                            size={32}
                                            onPress={this.shareContent}
                                            icon="share"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null }

                                  { this.showQRCodeButton ?
                                  <View style={styles.buttonContainer}>
                                      <TouchableHighlight style={styles.roundshape}>
                                        <IconButton
                                            onPress={this.toggleQRCodeScanner}
                                            style={styles.qrCodeButton}
                                            disabled={!this.showQRCodeButton}
                                            size={32}
                                            icon="qrcode"
                                        />
                                    </TouchableHighlight>
                                  </View>
                                  : null}
                            </View>
                            }

                        </View>
                        : null}

                    </View>

					  {(this.props.autoAnswerMode && !this.props.selectedContact) ?
					  <View style={{borderColor: 'white', 
					        borderWidth: 0.25, 
					        flexDirection: 'row',
							justifyContent: 'center',
							padding: 5,
							alignItems: 'center'}}>
							<Text style={styles.autoAnswer}>Hands-Free Caregiver Calls</Text>
					  </View>
					  :  null}

					  { (this.props.shareToContacts && hasImages) ?
					  <View style={{borderColor: 'white', 
					        borderWidth: 0.25, 
					        flexDirection: 'row',
							justifyContent: 'center',
							padding: 5,
							alignItems: 'center'}}>
								{Platform.OS === 'ios' ? (
								  <Switch
									value={!this.props.resizeContent}
									onValueChange={() => this.props.toggleResizeContent()}
								  />
								) : (
								  <Checkbox
									status={!this.props.resizeContent ? 'checked' : 'unchecked'}
									onPress={() => this.props.toggleResizeContent()}
								  />
								)}

							<Text style={styles.resize}>Full size</Text>
					  </View>
					  :  null}


                    { this.state.recording  ?
                        <View style={styles.recordingContainer}>
						 <View style={{borderBottom: 30}}>
                            <Title style={styles.activityTitle}>{activityTitle}</Title>
						 </View>
						 <View
								style={{
								  width: 20,
								  height: 200,
								  backgroundColor: "#ddd",
								  overflow: "hidden",
								alignSelf: "center",   // <<— Center horizontally inside parent
								}}
							  >
								<View
								  style={{
									backgroundColor: "green",
									width: "100%",
									height: `${this.state.level * 100}%`,
									position: "absolute",
									bottom: 0,
								  }}
								/>
							  </View>
                        </View>
                    : null
                    }

                    { this.state.recordingFile  ?
                        <View style={styles.recordingContainer}>
                            <Title style={styles.activityTitle}>{activityTitle}</Title>
                            {this.state.recordingDuration ?
                            <Text style={styles.subtitle}>{this.state.recordingDuration + ' seconds'}</Text>
                            :null}
                            
                        </View>

                    : null
                    }

                    {this.showContactsList ?
                    <View style={[historyContainer, borderClass]}>

                   {this.props.showQRCodeScanner ?
                    <QRCodeScanner
                        onRead={this.QRCodeRead}
                        showMarker={true}
                        flashMode={RNCamera.Constants.FlashMode.off}
                        containerStyle={styles.QRcodeContainer}
                     />
                      :
					<ContactsListBox
						allContacts={this.props.allContacts}
						targetUri={this.state.targetUri}
						fontScale = {this.props.fontScale}
						orientation={this.props.orientation}
						setTargetUri={this.handleSearch}
						selectedContact={this.props.selectedContact}
						isTablet={this.props.isTablet}
						chat={this.state.chat && !this.props.inviteContacts}
						isLandscape={this.props.isLandscape}
						account={this.props.account}
						password={this.props.password}
						callHistoryUrl={this.props.callHistoryUrl}
						refreshHistory={this.props.refreshHistory}
						refreshFavorites={this.props.refreshFavorites}
						localHistory={this.props.localHistory}
						saveHistory={this.props.saveHistory}
						myDisplayName={this.props.myDisplayName}
						myPhoneNumber={this.props.myPhoneNumber}
						saveConference={this.props.saveConference}
						myInvitedParties = {this.props.myInvitedParties}
						favoriteUris={this.props.favoriteUris}
						blockedUris={this.props.blockedUris}
						contactsFilter={this.state.contactsFilter}
						periodFilter={this.state.historyPeriodFilter}
						defaultDomain={this.props.defaultDomain}
						allContacts = {this.props.allContacts}
						messages = {this.props.messages}
						sendMessage = {this.props.sendMessage}
						reSendMessage = {this.props.reSendMessage}
						deleteMessages = {this.props.deleteMessages}
						expireMessage = {this.props.expireMessage}
						deleteMessage = {this.props.deleteMessage}
						getMessages = {this.props.getMessages}
						pinMessage = {this.props.pinMessage}
						unpinMessage = {this.props.unpinMessage}
						confirmRead = {this.props.confirmRead}
						inviteContacts = {this.props.inviteContacts}
						shareToContacts = {this.props.shareToContacts}
						selectedContacts = {this.props.selectedContacts}
						toggleFavorite={this.props.toggleFavorite}
						toggleAutoanswer={this.props.toggleAutoanswer}
						toggleBlocked={this.props.toggleBlocked}
						togglePinned = {this.props.togglePinned}
						pinned = {this.props.pinned}
						loadEarlierMessages = {this.props.loadEarlierMessages}
						newContactFunc = {this.props.newContactFunc}
						messageZoomFactor = {this.props.messageZoomFactor}
						isTyping = {this.state.isTyping}
						call = {this.props.call}
						keys = {this.state.keys}
						downloadFile = {this.props.downloadFile}
						uploadFile = {this.props.uploadFile}
						decryptFunc = {this.props.decryptFunc}
						messagesCategoryFilter = {this.state.messagesCategoryFilter}
						isTexting = {this.props.isTexting}
						forwardMessageFunc = {this.props.forwardMessageFunc}
						requestCameraPermission = {this.props.requestCameraPermission}
						requestStoragePermissions = {this.props.requestStoragePermissions}
						requestMicPermission = {this.props.requestMicPermission}
						requestStoragePermission = {this.props.requestStoragePermission}
						startCall = {this.props.startCall}
						sourceContact = {this.props.sourceContact}
						file2GiftedChat = {this.props.file2GiftedChat}
						postSystemNotification = {this.props.postSystemNotification}
						orderBy = {this.state.orderBy}
						sortOrder = {this.state.sortOrder}
						toggleSearchMessages = {this.props.toggleSearchMessages}
						searchMessages = {this.state.searchMessages}
						searchString = {this.state.searchString}
						recordAudio = {this.recordAudio}
						dark = {this.props.dark}
						messagesMetadata = {this.props.messagesMetadata}
						contactStartShare = {this.props.contactStartShare}
						contactStopShare = {this.props.contactStopShare}
						setFullScreen = {this.props.setFullScreen}
						fullScreen = {this.props.fullScreen}
						transferProgress = {this.props.transferProgress}
						totalMessageExceeded = {this.props.totalMessageExceeded}
						requestDndPermission = {this.props.requestDndPermission}
						gettingSharedAsset = {this.state.gettingSharedAsset}
						startAudioPlayerFunc = {this.startAudioPlayer}
						stopAudioPlayerFunc = {this.stopAudioPlayer}
						playRecording = {this.state.playRecording}
						updateFileTransferMetadata = {this.props.updateFileTransferMetadata}
						isAudioRecording = {this.state.recording}
						recordingFile = {this.state.recordingFile}
						sendAudioFile = {this.sendAudioFile}
						insets = {this.props.insets}
						appState = {this.props.appState}
					/>
					}

                    </View>
                    : null
                    }

                    {this.showNavigationBar && !this.props.selectedContact ?
                    <View style={navigationContainer}>
                        <FlatList contentContainerStyle={styles.navigationButtonGroup}
                            horizontal={true}
                            ref={(ref) => { this.navigationRef = ref; }}
                              onScrollToIndexFailed={info => {
                                const wait = new Promise(resolve => setTimeout(resolve, 10));
                                wait.then(() => {
                                  if (!this.props.selectedContact) {
                                      this.navigationRef.current?.scrollToIndex({ index: info.index, animated: true/false });
                                  }
                                });
                              }}
                            data={this.navigationItems}
                            extraData={this.state}
                            keyExtractor={(item, index) => item.key}
                            renderItem={this.renderNavigationItem}
                        />
                    </View>
                    : null}


                    {this.props.isTablet && 0?
                    <View style={styles.footer}>
                        <FooterBox />
                    </View>
                        : null}

                </View>

                <ConferenceModal
                    show={this.props.showConferenceModal}
                    targetUri={uri}
                    myInvitedParties={this.props.myInvitedParties}
                    selectedContact={this.props.selectedContact}
                    handleConferenceCall={this.handleConferenceCall}
                    defaultDomain={this.props.defaultDomain}
                    accountId={this.props.account ? this.props.account.id: null}
                    lookupContacts={this.props.lookupContacts}
					defaultConferenceDomain = {this.props.defaultConferenceDomain}
                />
            </Fragment>
        );
    }
}

ReadyBox.propTypes = {
    account         : PropTypes.object,
    password        : PropTypes.string.isRequired,
    callHistoryUrl  : PropTypes.string,
    startCall       : PropTypes.func.isRequired,
    startConference : PropTypes.func.isRequired,
    orientation     : PropTypes.string,
    isTablet        : PropTypes.bool,
    isLandscape     : PropTypes.bool,
    refreshHistory  : PropTypes.bool,
    refreshFavorites: PropTypes.bool,
    saveHistory     : PropTypes.func,
    localHistory    : PropTypes.array,
    myDisplayName   : PropTypes.string,
    myPhoneNumber   : PropTypes.string,
    toggleFavorite  : PropTypes.func,
	toggleAutoanswer: PropTypes.func,
    myInvitedParties: PropTypes.object,
    toggleBlocked   : PropTypes.func,
    favoriteUris    : PropTypes.array,
    blockedUris     : PropTypes.array,
    defaultDomain   : PropTypes.string,
    selectContact   : PropTypes.func,
    lookupContacts  : PropTypes.func,
    call            : PropTypes.object,
    goBackFunc      : PropTypes.func,
    messages        : PropTypes.object,
    sendMessage     : PropTypes.func,
    reSendMessage   : PropTypes.func,
    confirmRead     : PropTypes.func,
    deleteMessage   : PropTypes.func,
    expireMessage   : PropTypes.func,
    getMessages     : PropTypes.func,
    deleteMessages  : PropTypes.func,
    pinMessage      : PropTypes.func,
    unpinMessage    : PropTypes.func,
    inviteContacts  : PropTypes.bool,
    shareToContacts  : PropTypes.bool,
    showQRCodeScanner      : PropTypes.bool,
    selectedContacts: PropTypes.array,
    updateSelection : PropTypes.func,
    loadEarlierMessages: PropTypes.func,
    newContactFunc  : PropTypes.func,
    missedCalls     : PropTypes.array,
    messageZoomFactor: PropTypes.string,
    isTyping:      PropTypes.bool,
    navigationItems: PropTypes.object,
    showConferenceModal: PropTypes.bool,
    showConferenceModalFunc: PropTypes.func,
    hideConferenceModalFunc: PropTypes.func,
    shareContent:  PropTypes.func,
    cancelShareContent: PropTypes.func,
    filterHistoryFunc:  PropTypes.func,
    historyFilter: PropTypes.string,
    fontScale: PropTypes.number,
    inviteToConferenceFunc: PropTypes.func,
    toggleQRCodeScannerFunc: PropTypes.func,
    allContacts: PropTypes.array,
    keys            : PropTypes.object,
    downloadFile    : PropTypes.func,
    uploadFile: PropTypes.func,
    decryptFunc     : PropTypes.func,
    isTexting       :PropTypes.bool,
    keyboardVisible: PropTypes.bool,
    filteredMessageIds: PropTypes.array,
    contentTypes: PropTypes.object,
    canSend: PropTypes.func,
    forwardMessageFunc: PropTypes.func,
    sourceContact: PropTypes.object,
    requestCameraPermission: PropTypes.func,
    requestStoragePermissions: PropTypes.func,
    requestDndPermission: PropTypes.func,
    requestMicPermission: PropTypes.func,
    postSystemNotification: PropTypes.func,
    toggleSearchMessages: PropTypes.func,
    toggleSearchContacts: PropTypes.func,
    searchMessages: PropTypes.bool,
    searchContacts: PropTypes.bool,
    defaultConferenceDomain: PropTypes.string,
    dark: PropTypes.bool,
    messagesMetadata: PropTypes.object,
    file2GiftedChat : PropTypes.func,
    contactStartShare: PropTypes.func,
    contactStopShare: PropTypes.func,
	contactIsSharing: PropTypes.bool,
    setFullScreen: PropTypes.func,
    fullScreen: PropTypes.bool,
    transferProgress: PropTypes.object,
    totalMessageExceeded: PropTypes.bool,
    createChatContact: PropTypes.func,
	selectAudioDevice: PropTypes.func,
	updateFileTransferMetadata: PropTypes.func,
	insets: PropTypes.object,
	vibrate: PropTypes.func,
	toggleResizeContent: PropTypes.func,
	resizeContent: PropTypes.bool,
	sharedContent: PropTypes.array,
	autoAnswerMode: PropTypes.bool,
	hasAutoAnswerContacts: PropTypes.bool,
	appState: PropTypes.string
};

export default ReadyBox;
