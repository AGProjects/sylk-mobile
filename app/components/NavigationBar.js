import React, { Component } from 'react';
import { Linking, Image, Platform, View , TouchableHighlight, Dimensions} from 'react-native';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Appbar, Menu, Divider, Text, IconButton, Button } from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';
import { initialWindowMetrics } from 'react-native-safe-area-context';
import { Keyboard } from 'react-native';

const blinkLogo = require('../assets/images/blink-white-big.png');

import AboutModal from './AboutModal';
import CallMeMaybeModal from './CallMeMaybeModal';
import EditConferenceModal from './EditConferenceModal';
import AddContactModal from './AddContactModal';
import EditContactModal from './EditContactModal';
import GenerateKeysModal from './GenerateKeysModal';
import ExportPrivateKeyModal from './ExportPrivateKeyModal';
import DeleteHistoryModal from './DeleteHistoryModal';
import DeleteFileTransfers from './DeleteFileTransfers';
import VersionNumber from 'react-native-version-number';
import ShareConferenceLinkModal from './ShareConferenceLinkModal';
import {openSettings} from 'react-native-permissions';
import SylkAppbarContent from './SylkAppbarContent';
import UserIcon from './UserIcon';
import {Gravatar, GravatarApi} from 'react-native-gravatar';
import * as Progress from 'react-native-progress';

import styles from '../assets/styles/NavigationBar';

class NavigationBar extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.refetchMessagesForDays = 30;
        
        this.state = {
            showPublicKey: false,
            menuVisible: false,
            keyMenuVisible: false,
            showDeleteFileTransfers: false,
            showEditContactModal: false,
			showGenerateKeysModal: false,
			showExportPrivateKeyModal: false,
            privateKeyPassword: null,
			backupKey: false,
			deleteContact: false,
			showExportPrivateKeyModal: this.props.showExportPrivateKeyModal,
			showCallMeMaybeModal: this.props.showCallMeMaybeModal
        }

        this.menuRef = React.createRef();
    }
    
    get hasFiles() {
		const contact = this.props.selectedContact?.uri;
		const msgs = this.props.messages[contact] || [];
		return msgs.some(m => m.contentType === "application/sylk-file-transfer");
	}
    
    get hasMessages() {
		const contact = this.props.selectedContact?.uri;
		const msgs = this.props.messages[contact] || [];
		return msgs.some(m => m.contentType !== "application/sylk-file-transfer");
	}

	componentDidUpdate(prevProps, prevState) {
	    if (this.state.menuVisible != prevState.menuVisible && this.state.menuVisible) {
		    Keyboard.dismiss();
		}

		// let state = JSON.stringify(this.state, null, 2);
		//console.log('NB state', state);
		
		let keys = Object.keys(this.state);
		for (const key of keys) {		
			if (this.state[key] != prevState[key]) {
			    //console.log('Navigation bar', key, 'has changed:', this.state[key]);
			}
		}
	}

    handleMenu(event) {
        switch (event) {
            case 'about':
                this.toggleAboutModal();
                break;
            case 'callMeMaybe':
                this.props.toggleCallMeMaybeModal();
                break;
            case 'shareConferenceLinkModal':
                this.showConferenceLinkModal();
                break;
            case 'displayName':
                this.toggleEditContactModal();
                break;
            case 'speakerphone':
                this.props.toggleSpeakerPhone();
                break;
            case 'proximity':
                this.props.toggleProximity();
                break;
            case 'anonymous':
                this.props.toggleRejectAnonymous();
                break;
            case 'logOut':
                this.props.logout();
                break;
            case 'logs':
                this.props.showLogs();
                break;
            case 'refetchMessages':
                this.props.refetchMessages(this.refetchMessagesForDays, this.props.selectedContact?.uri);
                break;
            case 'preview':
                this.props.preview();
                break;
            case 'audio':
                this.audioCall();
                break;
            case 'video':
                this.videoCall();
                break;
            case 'resumeTransfers':
                this.resumeTransfers();
                break;
            case 'conference':
                this.conferenceCall();
                break;
            case 'toggleAutoAnswerMode':
                this.props.toggleAutoAnswerMode();
                break;
            case 'appSettings':
                openSettings();
                break;
            case 'addContact':
                this.toggleAddContactModal();
                break;
            case 'editContact':
                if (this.props.selectedContact && this.props.selectedContact.uri.indexOf('@videoconference') > -1) {
                    this.setState({showEditConferenceModal: true});
                } else {
                    this.setState({showEditContactModal: true});
                }
                break;
            case 'searchMessages':
                this.props.toggleSearchMessages();
                break;
            case 'deleteMessages':
                this.setState({showDeleteHistoryModal: true, deleteContact: false});
                break;
            case 'deleteContact':
                this.setState({showDeleteHistoryModal: true, deleteContact: true});
                break;
            case 'deleteFileTransfers':
                this.setState({showDeleteFileTransfers: true});
                break;
            case 'generatePrivateKey':
                this.setState({showGenerateKeysModal: true});
                break;
            case 'toggleFavorite':
                this.props.toggleFavorite(this.props.selectedContact);
                break;
            case 'toggleAutoAnswer':
                this.props.toggleAutoAnswer(this.props.selectedContact);
                break;
            case 'toggleBlocked':
                this.props.toggleBlocked(this.props.selectedContact);
                break;
            case 'sendPublicKey':
                this.props.sendPublicKey(this.props.selectedContact.uri);
                break;
            case 'exportPrivateKey':
                if (this.props.publicKey) {
                    this.showExportPrivateKeyModal();
                } else {
                    this.props.showImportModal(true);
                }
                break;
            case 'backupPrivateKey':
                if (this.props.publicKey) {
					this.setState({backupKey: true});
                    this.showExportPrivateKeyModal();
                }
                break;
            case 'restorePrivateKey':
				this.props.showRestoreKeyModalFunc(true);
                break;
            case 'showPublicKey':
                this.setState({showEditContactModal: !this.state.showEditContactModal, showPublicKey: true});
                break;
            case 'checkUpdate':
                if (Platform.OS === 'android') {
                    Linking.openURL('https://play.google.com/store/apps/details?id=com.agprojects.sylk');
                } else {
                    Linking.openURL('https://apps.apple.com/us/app/id1489960733');
                }
                break;
            case 'settings':
                Linking.openURL(this.props.serverSettingsUrl);
                break;
            default:
                break;
        }

        this.setState({menuVisible: false, keyMenuVisible: false});
    }

    toggleAboutModal() {
        this.setState({showAboutModal: !this.state.showAboutModal});
    }

    showConferenceLinkModal() {
        this.setState({showConferenceLinkModal: true});
    }

    hideConferenceLinkModal() {
        this.setState({showConferenceLinkModal: false});
    }

    audioCall() {
        let uri = this.props.selectedContact.uri;
        this.props.startCall(uri, {audio: true, video: false});
    }

    videoCall() {
        let uri = this.props.selectedContact.uri;
        this.props.startCall(uri, {audio: true, video: true});
    }

    resumeTransfers() {
        this.props.resumeTransfers();
    }

    get myself() {
        return this.props.selectedContact && this.props.selectedContact.uri === this.props.accountId;
    }

    conferenceCall() {
        this.props.showConferenceModalFunc();
    }

    toggleAddContactModal() {
        this.setState({showAddContactModal: !this.state.showAddContactModal});
    }

    closeDeleteHistoryModal() {
        this.setState({showDeleteHistoryModal: false, deleteContact: false});
    }

    closeDeleteFileTransfers() {
        this.setState({showDeleteFileTransfers: false});
    }

    hideGenerateKeysModal() {
        this.setState({showGenerateKeysModal: false});
    }

    hideImportKeysModal() {
        this.setState({showImportKeysModal: false});
    }

    showEditContactModal() {
        this.setState({showEditContactModal: true,
                       showPublicKey: false});
    }

    hideEditContactModal() {
        this.setState({showEditContactModal: false,
                       showPublicKey: false
                       });
    }

    handleDnd () {
    }

    saveConference(room, participants, displayName=null) {
        this.props.saveConference(room, participants, displayName);
        this.setState({showEditConferenceModal: false});
    }

    toggleEditContactModal() {
        if (this.state.showEditContactModal) {
            this.hideEditContactModal();
        } else {
            this.showEditContactModal();
        };
    }

    closeEditConferenceModal() {
        this.setState({showEditConferenceModal: false});
    }

    showExportPrivateKeyModal() {
        const password = Math.random().toString().substr(2, 6);
        this.setState({privateKeyPassword: password, showExportPrivateKeyModal: true});
        this.props.showExportPrivateKeyModalFunc()
    }

    hideExportPrivateKeyModal() {
        console.log('hideExportPrivateKeyModal');
        this.setState({backupKey: false, showExportPrivateKeyModal: false});
        this.props.hideExportPrivateKeyModalFunc()
    }

    get showBackToCallButton() {
        if (this.props.shareToContacts) {
			return false;
        }
        
        if (!this.props.isLandscape) {
			return false;
        }

        if (this.props.call) {
            //console.log('this.props.call.state', this.props.call.state);
            if (this.props.call.state !== 'incoming' && this.props.call.state !== 'terminated') {
				return true;
			}
        }

		return false;
    }

    render() {
        const bellIcon = this.props.dnd ? 'bell-off' : 'bell';

        if (this.state.menuVisible && !this.props.appStoreVersion) {
            //this.props.checkVersionFunc()
        }
        
        let subtitleStyle = this.props.isTablet ? styles.tabletSubtitle: styles.subtitle;
        let titleStyle = this.props.isTablet ? styles.tabletTitle: styles.title;

        let statusIcon = null;
        let statusColor = 'green';
        let tags = [];
        
        statusIcon = 'check-circle';
        let bellStyle = styles.whiteButton;

        if (this.props.connection && this.props.connection.state === 'ready') {
            bellStyle = styles.greenButton;
        } else if (this.props.connection && this.props.connection.state === 'connecting') {
            bellStyle = styles.whiteButton;
        } else if (this.props.connection && this.props.connection.state === 'disconnected') {
            bellStyle = styles.whiteButton;
        } else if (this.props.connection && this.props.registrationState !== 'registered') {
            bellStyle = styles.redButton;
        } else {
            bellStyle = styles.whiteButton;
        }

        if (!this.props.connection || this.props.connection.state !== 'ready') {
            statusIcon = 'alert-circle';
            statusColor = 'red';
        } else if (this.props.registrationState !== 'registered') {
            statusIcon = 'alert-circle';
            statusColor = 'orange';
        }

        let callUrl = this.props.publicUrl + "/call/" + this.props.accountId;
        let proximityTitle = this.props.proximity ? '✓ Proximity sensor' : 'Proximity sensor';
        let proximityIcon = this.props.proximity ? 'ear-hearing-off' : 'ear-hearing';
        let rejectAnonymousTitle = this.props.rejectAnonymous ? 'Allow anonymous callers' : 'Reject anonymous callers';
        let rejectIcon = this.props.rejectAnonymous ? 'door-closed-lock' : 'door-open';
        let isConference = false;

		const friendlyName = this.props.selectedContact ? this.props.selectedContact.uri.split('@')[0] : '';
		const conferenceUrl = `${this.props.publicUrl}/conference/${friendlyName}`;

        if (this.props.selectedContact) {
            tags = this.props.selectedContact.tags;
            isConference = this.props.selectedContact.conference || tags.indexOf('conference') > -1;
        }

		const isFavorite = this.props.selectedContact && tags && tags.indexOf('favorite') > -1;
				
        let favoriteTitle = isFavorite ? '✓ Favorite' : 'Favorite';
        let favoriteIcon = (this.props.selectedContact && tags && tags.indexOf('favorite') > -1) ? 'flag-minus' : 'flag';
        let autoAnswerTitle = this.props.selectedContact?.localProperties?.autoanswer ? '✓ Auto answer' : 'Auto answer';
		let autoAnswerModeTitle = this.props.autoAnswerMode ? 'Turn Off Auto-answer' : 'Auto-answer Mode';
  
        let extraMenu = false;
        let importKeyLabel = this.props.publicKey ? "Export private key...": "Import private key...";

        let showEditModal = this.state.showEditContactModal;

        let showBackButton = this.props.selectedContact || this.props.sharingAction;

        let hasUpdate = this.props.appStoreVersion && this.props.appStoreVersion.version > VersionNumber.appVersion;
        let updateTitle = hasUpdate ? 'Update Sylk...' : 'Check for updates...';

        let isAnonymous = this.props.selectedContact && (this.props.selectedContact.uri.indexOf('@guest.') > -1 || this.props.selectedContact.uri.indexOf('anonymous@') > -1);
        let isCallableUri = !isConference && !this.props.inCall && !isAnonymous && tags.indexOf('blocked') === -1;

        let blockedTitle = (this.props.selectedContact && tags && tags.indexOf('blocked') > -1) ? 'Unblock' : isAnonymous ? 'Block anonymous callers': 'Block';
        if (isAnonymous && this.props.blockedUris.indexOf('anonymous@anonymous.invalid') > -1) {
            blockedTitle = 'Allow anonymous callers';
        }
        
        let editTitle = isConference ? "Configure..." : "Edit contact...";
        let deleteTitle = isConference ? "Remove conference" : "Delete contact...";
        let searchTitle = this.props.searchMessages ? 'End search': 'Search messages...';
        
        let subtitle = this.props.accountId;

        let organization = this.props.selectedContact ? this.props.selectedContact.organization : this.props.organization;
        let displayName = this.props.selectedContact ? this.props.selectedContact.name : this.props.displayName;

        let title = displayName || 'Myself';
        let searchIcon = (this.props.searchMessages || this.props.searchContacts) ? "close" : "magnify";

		function capitalizeFirstLetter(str) {
		  if (!str) return ""; // Handle empty string
		  return str[0].toUpperCase() + str.slice(1);
		}

        if (this.props.selectedContact) {
			if (isConference) {
				title = capitalizeFirstLetter(this.props.selectedContact.uri.split('@')[0]);
				subtitle = 'Conference room';
			} else {
			    if (this.props.selectedContact.name && this.props.selectedContact.name != this.props.selectedContact.uri) {
					title = this.props.selectedContact.name;
			    } else {
					title = capitalizeFirstLetter(this.props.selectedContact.uri.split('@')[0]);
			    }
				subtitle = this.props.selectedContact.uri;
			}
			
			if (this.props.selectedContact.uri.indexOf('@guest.') > -1) {
				title = 'Anonymous caller';			
			}

		}

        let backButtonTitle = 'Back to call';

        if (this.showBackToCallButton) {
            if (this.props.call.hasOwnProperty('_participants')) {
                backButtonTitle = 'Back to conference';
            } else {
                backButtonTitle = 'Back to call';
            }
        }

		const as = 40; //avatar size		

		let { width, height } = Dimensions.get('window');

		const topInset = this.props.insets?.top || 0;
		const bottomInset = this.props.insets?.bottom || 0;
		const leftInset = this.props.insets?.left || 0;
		const rightInset = this.props.insets?.right || 0;

        let navBarContainer = { 
                              borderWidth: 0, 
                              borderColor: 'red',
                              height: 60,
                              };

		let marginLeft = this.props.isLandscape ? - rightInset - leftInset: 0;
		let navBarWidth = this.props.isLandscape ? width - rightInset - leftInset : width;

		let appBarContainer = {
		                 backgroundColor: 'black', 
                         borderWidth: 0,
                         marginLeft: marginLeft,
                         //marginRight: marginRight,
                         marginTop: -topInset,
						 height: 60,
						 width: navBarWidth,
                         borderColor: 'orange'
                 };

        if (Platform.OS === "ios") {
			appBarContainer.marginTop = 0;
			if (this.props.isLandscape) {
			    appBarContainer.marginLeft = -leftInset;
			    //appBarContainer.width = navBarWidth - 200;
			}
        } else {
			if (Platform.Version < 34) {
				appBarContainer.marginTop = 0;
			}
        }
        
        return (
        
			<View style={navBarContainer}>
            <Appbar.Header style={appBarContainer}
                 statusBarHeight={Platform.OS === "ios" ? 0 : undefined} 
               dark
                 >
  
                {showBackButton ?
                <Appbar.BackAction onPress={() => {this.props.goBackFunc()}} />
                : <Image source={blinkLogo} style={styles.logo}/>}

				{this.props.selectedContact ?
					<View style={styles.avatarContent}>
						{this.props.selectedContact.photo ||
						!this.props.selectedContact.email ? (
							<UserIcon size={as} identity={this.props.selectedContact}/>
						) : (
							<Gravatar options={{email: this.props.selectedContact.email, parameters: { "size": as, "d": "mm" }, secure: true}} style={[styles.gravatar, {width: as, height: as}]} />
						)}
					</View>
				: null}
                                  
                <SylkAppbarContent
                    title={title}
                    subtitle={subtitle}
                    titleStyle={[titleStyle, { marginLeft: 0 }]}
                    subtitleStyle={[subtitleStyle, { marginLeft: 0 }]}
                />

               { this.props.isTablet && this.props.syncPercentage != 100 ?
				<View style={{ flexDirection: 'column', flexShrink: 1, alignItems: 'center'}}>
				  <Progress.Bar
					progress={this.props.syncPercentage / 100 }
					width={150}         // smaller width for inline look
					height={6}
					borderRadius={3}
					borderWidth={0}
					color={"blue"}
					unfilledColor="white"
					style={{ marginRight: 10, marginTop: 10 }}  // small gap from label
				  />
				  <Text
					style={{
					  fontSize: 12,
					  color: 'orange',
					  marginTop: 2,
					}}
				  >
					Replay journal: {Math.round(this.props.syncPercentage)}%
				  </Text>
				</View>
				   : null }

 				{ this.showBackToCallButton ?
						<Button
							mode="contained"
						    labelStyle={{ fontSize: 14 }}
						    style={styles.backButton}
							onPress={this.props.goBackToCallFunc}
							accessibilityLabel={backButtonTitle}
							>{backButtonTitle}
						</Button>
                : null}

                { false && !this.props.rejectNonContacts && ! this.props.selectedContact?
                <IconButton
                    style={styles.whiteButton}
                    size={18}
                    disabled={false}
                    onPress={this.props.toggleRejectAnonymous}
                    icon={rejectIcon}
                />
                : null}

                {this.props.selectedContact ?
                <IconButton
                    style={[styles.whiteButton ]}
                    size={18}
                    disabled={false}
                    onPress={this.props.toggleSearchMessages}
                    icon={searchIcon}
                />
                : 
				<IconButton
                    style={styles.whiteButton}
                    size={18}
                    disabled={false}
                    onPress={this.props.toggleSearchContacts}
                    icon={searchIcon}
                />

                }

               { (!this.props.selectedContact && !this.props.searchContacts) ?
                <IconButton
                    style={styles.whiteButton}
                    size={18}
                    disabled={false}
                    onPress={this.conferenceCall}
                    icon="account-group"
                />
                : null}

               { (!this.props.selectedContact && !this.props.searchContacts) ?
                <IconButton
                    style={[bellStyle, {marginLeft: 10}]}
                    size={18}
                    disabled={false}
                    onPress={this.props.toggleDnd}
                    icon={bellIcon}
                />
                : null}

 
                {statusColor == 'greenXXX' ?
                    <Icon name={statusIcon} size={20} color={statusColor} />
                : null }
                

                { this.props.selectedContact ?
                    <Menu
                        visible={this.state.menuVisible}
                        onDismiss={() => this.setState({menuVisible: !this.state.menuVisible, keyMenuVisible: false})}
                        anchor={
                            <Appbar.Action
                                ref={this.menuRef}
                                color="white"
                                icon="menu"
                                onPress={() => this.setState({menuVisible: !this.state.menuVisible})}
                            />
                        }
                    >

                        { false ? <Menu.Item onPress={() => this.handleMenu('searchMessages')} icon="search" title={searchTitle}/> : null}

						{ !this.props.searchMessages && !isAnonymous ?
						<Menu.Item onPress={() => this.handleMenu('editContact')} icon="account" title={editTitle}/>
						: null}

						{isCallableUri?
                        <Divider />
						: null}

                        {isCallableUri ? <Menu.Item onPress={() => this.handleMenu('audio')} icon="phone" title="Audio call"/> :null}
                        {isCallableUri ? <Menu.Item onPress={() => this.handleMenu('video')} icon="video" title="Video call"/> :null}
                        {tags.indexOf('blocked') === -1 && this.props.canSend() && !this.props.inCall && isConference ? <Menu.Item onPress={() => this.handleMenu('conference')} icon="account-group" title="Join conference..."/> :null}
                        {tags.indexOf('blocked') === -1 && !this.props.inCall && isConference ? <Menu.Item onPress={() => this.handleMenu('shareConferenceLinkModal')} icon="share-variant" title="Share link..."/> :null}
                                                
                        { !this.props.searchMessages && this.hasMessages && !this.props.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('deleteMessages')} icon="delete" title="Delete messages..."/>
                        : null
                        }

                        {!this.props.searchMessages && this.hasFiles && !this.props.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('deleteFileTransfers')} icon="delete" title="Delete files..."/>
                        : null
                        }

                        { !this.props.searchMessages && this.hasFiles && !this.props.inCall && 'paused' in this.props.contentTypes ?
                        <Menu.Item onPress={() => this.handleMenu('resumeTransfers')} icon="delete" title="Resume transfers"/>
                        : null
                        }

						{!isConference && !this.props.searchMessages && this.props.publicKey ?
                        <Divider />
                        : null}

                        { this.props.devMode ? <Menu.Item onPress={() => this.handleMenu('refetchMessages')} icon="cloud-download" title="Refetch messages"/>: null}

                        {!isConference && !this.props.searchMessages && this.props.publicKey ?
                        <Menu.Item onPress={() => this.handleMenu('showPublicKey')} icon="key-variant" title="Show public key..."/>
                        : null}

                        {!isConference && !this.props.searchMessages && this.hasMessages && tags.indexOf('test') === -1 && !isConference && !this.myself && !isAnonymous?
                        <Menu.Item onPress={() => this.handleMenu('sendPublicKey')} icon="key-change" title="Send my public key..."/>
                        : null}
 
                        {!this.myself && !this.props.searchMessages && !isAnonymous && tags.indexOf('blocked') === -1 ?
                        <Menu.Item onPress={() => this.handleMenu('toggleFavorite')} icon={favoriteIcon} title={favoriteTitle}/>
                        : null}

                        {!isAnonymous && !isConference && !this.myself && !this.props.searchMessages && tags.indexOf('test') === -1 && tags.indexOf('favorite') === -1 && !this.props.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('toggleBlocked')} icon="block-helper" title={blockedTitle}/>
                        : null}

                        {!isConference && !this.props.searchMessages && tags.indexOf('test') === -1 && !this.props.inCall && !isAnonymous && tags.indexOf('favorite') > -1 ?
                        <Divider />
                        : null}

                        {!isConference && !this.props.searchMessages && tags.indexOf('test') === -1 && !this.props.inCall && !isAnonymous && tags.indexOf('favorite') > -1 ?
                        <Menu.Item onPress={() => this.handleMenu('toggleAutoAnswer')} title={autoAnswerTitle}/>
                        : null}

                        {!this.props.inCall && tags.indexOf('test') === -1 && !isFavorite?
                        <Divider />
                        : null}

                        {!this.props.inCall && !isFavorite?
                        <Menu.Item onPress={() => this.handleMenu('deleteContact')} icon="delete" title={deleteTitle}/>
                        : null}
                        
                    </Menu>
                :
                    <Menu
                        visible={this.state.menuVisible}
                        onDismiss={() => this.setState({menuVisible: !this.state.menuVisible})}
                        anchor={
                            <Appbar.Action
                                ref={this.menuRef}
                                color="white"
                                icon="menu"
                                onPress={() => this.setState({menuVisible: !this.state.menuVisible})}
                            />
                        }
                    >
                        {!this.props.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('callMeMaybe')} icon="share" title="Call me, maybe?" />
                         : null }
                        {!this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('conference')} icon="account-group" title="Join conference..."/> :null}
                        {!this.props.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('addContact')} icon="account-plus" title="Add contact..."/>
                         : null }

                        {!this.props.inCall && false ? <Menu.Item onPress={() => this.handleMenu('preview')} icon="video" title="Video preview" />:null}
                        {!this.props.inCall ?
                        <Divider />
                        : null}

                        { (this.props.devMode && this.refetchMessagesForDays) ? <Menu.Item onPress={() => this.handleMenu('refetchMessages')} icon="cloud-download" title="Refetch messages"/> : null}

                        {!this.props.inCall ?
						<Divider />
                        : null}

                        {false ? <Menu.Item onPress={() => this.handleMenu('checkUpdate')} icon="update" title={updateTitle} /> :null}
                        {extraMenu ?
                        <View>

                        <Menu.Item onPress={() => this.handleMenu('settings')} icon="wrench" title="Server settings..." />
                        </View>
                        : null}
                        <Menu.Item onPress={() => this.handleMenu('proximity')} icon={proximityIcon} title={proximityTitle} />


                        {!this.props.inCall ?
                        <Divider />
                         : null }

                       {!this.props.syncConversations && !this.props.inCall  ?
                        <Menu.Item onPress={() => this.handleMenu('displayName')} icon="rename-box" title="My account..." />
                        : null}
 
                      {(!this.props.syncConversations && !this.props.inCall && Platform.OS === "ios" && this.props.hasAutoAnswerContacts) ?
                        <Menu.Item onPress={() => this.handleMenu('toggleAutoAnswerMode')} icon="wrench" title={autoAnswerModeTitle} />
                        : null}


                     <Menu
                        visible={this.state.keyMenuVisible}
                        onDismiss={() => this.setState({keyMenuVisible: !this.state.keyMenuVisible})}
						anchor={
							<Menu.Item
								title="My private key..."
								icon="key"
								onPress={() => this.setState({keyMenuVisible: true})}
							/>
						}
                    >

                        {this.props.canSend() && !this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('exportPrivateKey')} icon="send" title={importKeyLabel} />:null}
                        {this.props.canSend() && !this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('backupPrivateKey')} icon="send" title={'Backup private key...'} />:null}
                        {!this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('restorePrivateKey')} icon="key" title="Restore private key..."/> :null}
                        {!this.props.inCall ? <Menu.Item onPress={() => this.handleMenu('generatePrivateKey')} icon="key" title="Generate private key..."/> :null}
                        {(this.props.devMode && !this.props.inCall) ? <Menu.Item onPress={() => this.handleMenu('deleteMessages')} icon="delete" title="Wipe device..."/> :null}

                        {this.props.publicKey ?
                        <Menu.Item onPress={() => this.handleMenu('showPublicKey')} icon="key-variant" title="Show public key..."/>
                        : null}

					</Menu>

                        {!this.props.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('appSettings')} icon="policy-alert" title="Permissions"/>
                         : null }

                        <Menu.Item onPress={() => this.handleMenu('logs')} icon="file" title="Logs" />

                        {!this.props.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('about')} icon="information" title="About Sylk"/> : null}
                        {!this.props.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('logOut')} icon="logout" title="Sign out" /> : null}
                    </Menu>
                    }

                <AboutModal
                    show={this.state.showAboutModal}
                    close={this.toggleAboutModal}
                    currentVersion={VersionNumber.appVersion}
                    appStoreVersion={this.props.appStoreVersion}
                    buildId={this.props.buildId}
                    toggleDevMode={this.props.toggleDevMode}
                    devMode={this.props.devMode}
                />

                <CallMeMaybeModal
                    show={this.props.showCallMeMaybeModal}
                    close={this.props.toggleCallMeMaybeModal}
                    callUrl={callUrl}
                    notificationCenter={this.props.notificationCenter}
                />

                <DeleteHistoryModal
                    show={this.state.showDeleteHistoryModal}
                    close={this.closeDeleteHistoryModal}
                    uri={this.props.selectedContact ? this.props.selectedContact.uri : null}
                    hasMessages={this.hasMessages}
                    deleteMessages={this.props.deleteMessages}
                    filteredMessageIds={this.props.filteredMessageIds}
                    selectedContact={this.props.selectedContact}
                    deleteContact={this.state.deleteContact}
                    myself={!this.props.selectedContact || (this.props.selectedContact && this.props.selectedContact.uri === this.props.accountId) ? true : false}
                />

                <DeleteFileTransfers
                    show={this.state.showDeleteFileTransfers}
                    close={this.closeDeleteFileTransfers}
                    selectedContact={this.props.selectedContact}
                    uri={this.props.selectedContact ? this.props.selectedContact.uri : null}
                    deleteFilesFunc={this.props.deleteFiles}
                    transferedFiles={this.props.transferedFiles}
                    transferedFilesSizes={this.props.transferedFilesSizes}
                    getTransferedFiles={this.props.getTransferedFiles}
                    myself={!this.props.selectedContact || (this.props.selectedContact && this.props.selectedContact.uri === this.props.accountId) ? true : false}
                />

                <AddContactModal
                    show={this.state.showAddContactModal}
                    close={this.toggleAddContactModal}
                    saveContactByUser={this.props.saveContactByUser}
                    defaultDomain={this.props.defaultDomain}
                />

                <EditContactModal
                    show={showEditModal}
                    close={this.hideEditContactModal}
                    uri={this.props.selectedContact ? this.props.selectedContact.uri : this.props.accountId}
                    displayName={this.props.selectedContact ? this.props.selectedContact.name : this.props.displayName}
                    selectedContact={this.props.selectedContact}
                    organization={this.props.organization}
                    email={this.props.selectedContact ? this.props.selectedContact.email : this.props.email}
                    myself={!this.props.selectedContact || (this.props.selectedContact && this.props.selectedContact.uri === this.props.accountId) ? true : false}
                    saveContactByUser={this.props.saveContactByUser}
                    deletePublicKey={this.props.deletePublicKey}
                    publicKey={this.state.showPublicKey ? this.props.publicKey: null}
                    myuuid={this.props.myuuid}
 				    rejectNonContacts={this.props.rejectNonContacts}
 				    toggleRejectNonContacts={this.props.toggleRejectNonContacts}
					rejectAnonymous={this.props.rejectAnonymous}
 				    toggleRejectAnonymous={this.props.toggleRejectAnonymous}
					chatSounds={this.props.chatSounds}
 				    toggleChatSounds={this.props.toggleChatSounds}
 				    storageUsage={this.props.storageUsage}
                />

                { this.state.showEditConferenceModal ?
                <EditConferenceModal
                    show={this.state.showEditConferenceModal}
                    close={this.closeEditConferenceModal}
                    room={this.props.selectedContact ? this.props.selectedContact.uri.split('@')[0]: ''}
                    displayName={this.props.selectedContact ? this.props.selectedContact.name : this.props.displayName}
                    participants={this.props.selectedContact ? this.props.selectedContact.participants : []}
                    selectedContact={this.props.selectedContact}
                    toggleFavorite={this.props.toggleFavorite}
                    saveConference={this.saveConference}
                    defaultDomain={this.props.defaultDomain}
                    accountId={this.props.accountId}
                    favoriteUris={this.props.favoriteUris}
                />
                : null}

                <ShareConferenceLinkModal
                    show={this.state.showConferenceLinkModal}
                    notificationCenter={this.props.notificationCenter}
                    close={this.hideConferenceLinkModal}
                    conferenceUrl={conferenceUrl}
                />
                
				<ExportPrivateKeyModal
					show={this.props.showExportPrivateKeyModal}
					password={this.state.privateKeyPassword}
					close={this.hideExportPrivateKeyModal}
					exportFunc={this.props.exportKey|| (() => {})}
					publicKeyHash={this.props.publicKeyHash}
					publicKey={this.props.publicKey}
					backup={this.state.backupKey}
				/>

                <GenerateKeysModal
                    show={this.state.showGenerateKeysModal}
                    close={this.hideGenerateKeysModal}
                    generateKeysFunc={this.props.generateKeysFunc}
                />

            </Appbar.Header>
		</View>
        );
    }
}

NavigationBar.propTypes = {
    notificationCenter : PropTypes.func.isRequired,
    logout             : PropTypes.func.isRequired,
    preview            : PropTypes.func.isRequired,
    toggleSpeakerPhone : PropTypes.func.isRequired,
    toggleProximity    : PropTypes.func.isRequired,
    showLogs           : PropTypes.func.isRequired,
    inCall             : PropTypes.bool,
    contactsLoaded     : PropTypes.bool,
    proximity          : PropTypes.bool,
    displayName        : PropTypes.string,
    myDisplayName      : PropTypes.string,
    myPhoneNumber      : PropTypes.string,
    email              : PropTypes.string,
    organization       : PropTypes.string,
    account            : PropTypes.object,
    accountId          : PropTypes.string,
    connection         : PropTypes.object,
    orientation        : PropTypes.string,
    isTablet           : PropTypes.bool,
    selectedContact    : PropTypes.object,
    goBackFunc         : PropTypes.func,
    goBackToCallFunc   : PropTypes.func,
    exportKey          : PropTypes.func,
    publicKeyHash      : PropTypes.string,
    publicKey          : PropTypes.string,
    deleteMessages     : PropTypes.func,
    deleteFiles        : PropTypes.func,
    toggleBlocked      : PropTypes.func,
    toggleFavorite     : PropTypes.func,
    toggleAutoAnswer   : PropTypes.func,
    saveConference     : PropTypes.func,
    defaultDomain      : PropTypes.string,
    favoriteUris       : PropTypes.array,
    startCall          : PropTypes.func,
    startConference    : PropTypes.func,
    saveContactByUser        : PropTypes.func,
    addContact         : PropTypes.func,
    deletePublicKey    : PropTypes.func,
    sendPublicKey      : PropTypes.func,
    messages           : PropTypes.object,
    showImportModal    : PropTypes.func,
    syncConversations   : PropTypes.bool,
    showCallMeMaybeModal: PropTypes.bool,
    toggleCallMeMaybeModal : PropTypes.func,
    showConferenceModalFunc : PropTypes.func,
    appStoreVersion : PropTypes.object,
    checkVersionFunc: PropTypes.func,
    refetchMessages: PropTypes.func,
    showExportPrivateKeyModal: PropTypes.bool,
    showExportPrivateKeyModalFunc: PropTypes.func,
    hideExportPrivateKeyModalFunc: PropTypes.func,
    showRestoreKeyModal: PropTypes.bool,
    showRestoreKeyModalFunc: PropTypes.func,
    blockedUris: PropTypes.array,
    myuuid: PropTypes.string,
    resumeTransfers: PropTypes.func,
    generateKeysFunc: PropTypes.func,
    filteredMessageIds: PropTypes.array,
    contentTypes: PropTypes.object,
    canSend: PropTypes.func,
    sharingAction: PropTypes.bool,
    dnd: PropTypes.bool,
    toggleDnd: PropTypes.func,
    buildId: PropTypes.string,
    getTransferedFiles: PropTypes.func,
    transferedFiles: PropTypes.object,
    transferedFilesSizes: PropTypes.object,
    rejectAnonymous: PropTypes.bool,
    toggleRejectAnonymous: PropTypes.func,
    toggleChatSounds: PropTypes.func,
    rejectNonContacts: PropTypes.bool,
    toggleRejectNonContacts: PropTypes.func,
    toggleSearchMessages: PropTypes.func,
    toggleSearchContacts: PropTypes.func,
    searchMessages: PropTypes.bool,
    searchContacts: PropTypes.bool,
    isLandscape: PropTypes.bool,
    publicUrl: PropTypes.string,
    serverSettingsUrl: PropTypes.string,
	insets: PropTypes.object,
	call: PropTypes.object,
	storageUsage: PropTypes.array,
	syncPercentage: PropTypes.number,
	toggleDevMode: PropTypes.func,
	devMode: PropTypes.bool,
	toggleAutoAnswerMode: PropTypes.func,
	autoAnswerMode: PropTypes.bool,
	hasAutoAnswerContacts: PropTypes.bool
};

export default NavigationBar;
