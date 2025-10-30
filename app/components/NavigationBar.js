import React, { Component } from 'react';
import { Linking, Image, Platform, View , TouchableHighlight, Dimensions} from 'react-native';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Appbar, Menu, Divider, Text, IconButton } from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';

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

import config from '../config';

import styles from '../assets/styles/NavigationBar';

class NavigationBar extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        let displayName = this.props.selectedContact ? this.props.selectedContact.name : this.props.displayName;
        let organization = this.props.selectedContact ? this.props.selectedContact.organization : this.props.organization;

        this.state = {
            syncConversations: this.props.syncConversations,
            inCall: this.props.inCall,
            showCallMeMaybeModal: this.props.showCallMeMaybeModal,
            showDeleteFileTransfers: false,
            contactsLoaded: this.props.contactsLoaded,
            appStoreVersion: this.props.appStoreVersion,
            showExportPrivateKeyModal: this.props.showExportPrivateKeyModal,
            privateKeyPassword: null,
            registrationState: this.props.registrationState,
            connection: this.props.connection,
            proximity: this.props.proximity,
            selectedContact: this.props.selectedContact,
            mute: false,
            menuVisible: false,
            accountId: this.props.accountId,
            account: this.props.account,
            displayName: displayName,
            myDisplayName: this.props.myDisplayName,
            email: this.props.email,
            organization: organization,
            publicKey: this.props.publicKey,
            showPublicKey: false,
            myPhoneNumber: this.props.myPhoneNumber,
            messages: this.props.messages,
            userClosed: false,
            blockedUris: this.props.blockedUris,
            filteredMessageIds: this.props.filteredMessageIds,
            contentTypes: this.props.contentTypes,
            sharingAction: this.props.sharingAction,
            dnd: this.props.dnd,
            myuuid: this.props.myuuid,
            sharedFiles: this.props.sharedFiles,
            rejectAnonymous: this.props.rejectAnonymous,
			rejectNonContacts: this.props.rejectNonContacts,
			searchMessages: this.props.searchMessages,
			isLandscape: this.props.isLandscape,
			backupKey: false
        }

        this.menuRef = React.createRef();
    }
    
    get hasFiles() {
        return true;
        return this.state.selectedContact && Object.keys(this.state.sharedFiles).indexOf(this.state.selectedContact.uri) > -1 && this.state.sharedFiles[this.state.selectedContact.uri].lenght > 0;
    }
    
    get hasMessages() {
        return this.state.selectedContact && Object.keys(this.state.messages).indexOf(this.state.selectedContact.uri) > -1 && this.state.messages[this.state.selectedContact.uri].length > 0;
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {

        if (nextProps.account !== null && nextProps.account.id !== this.state.accountId) {
            this.setState({accountId: nextProps.accountId});
        }

        let displayName = nextProps.selectedContact ? nextProps.selectedContact.name : nextProps.displayName;
        let organization = nextProps.selectedContact ? nextProps.selectedContact.organization : nextProps.organization;

        this.setState({registrationState: nextProps.registrationState,
                       connection: nextProps.connection,
                       syncConversations: nextProps.syncConversations,
                       contactsLoaded: nextProps.contactsLoaded,
                       displayName: displayName,
                       myDisplayName: nextProps.myDisplayName,
                       appStoreVersion: nextProps.appStoreVersion,
                       showExportPrivateKeyModal: nextProps.showExportPrivateKeyModal,
                       email: nextProps.email,
                       organization: organization,
                       proximity: nextProps.proximity,
                       account: nextProps.account,
                       userClosed: true,
                       inCall: nextProps.inCall,
                       publicKey: nextProps.publicKey,
                       showDeleteHistoryModal: nextProps.showDeleteHistoryModal,
                       showGenerateKeysModal: nextProps.showGenerateKeysModal,
                       selectedContact: nextProps.selectedContact,
                       messages: nextProps.messages,
                       showCallMeMaybeModal: nextProps.showCallMeMaybeModal,
                       blockedUris: nextProps.blockedUris,
                       filteredMessageIds: nextProps.filteredMessageIds,
                       contentTypes: nextProps.contentTypes,
                       sharingAction: nextProps.sharingAction,
                       dnd: nextProps.dnd,
                       myuuid: nextProps.myuuid,
                       myPhoneNumber: nextProps.myPhoneNumber,
 					   sharedFiles: nextProps.sharedFiles,
 					   rejectAnonymous: nextProps.rejectAnonymous,
 					   rejectNonContacts: nextProps.rejectNonContacts,
 					   searchMessages: nextProps.searchMessages,
 					   isLandscape: nextProps.isLandscape
                       });

                    if (nextProps.menuVisible) {
                        console.log('Next menu visible', nextProps.menuVisible);
                    }
                    
                    if ('backupKey' in nextProps) {
                        this.setState({backupKey: nextProps.backupKey});
                    }

    }

    handleMenu(event) {
        this.callUrl = `${config.publicUrl}/call/${this.state.accountId}`;
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
                this.props.refetchMessages(this.state.selectedContact);
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
            case 'appSettings':
                openSettings();
                break;
            case 'addContact':
                this.toggleAddContactModal();
                break;
            case 'editContact':
                if (this.state.selectedContact && this.state.selectedContact.uri.indexOf('@videoconference') > -1) {
                    this.setState({showEditConferenceModal: true});
                } else {
                    this.setState({showEditContactModal: true});
                }
                break;
            case 'searchMessages':
                this.props.toggleSearchMessages();
                break;
            case 'deleteMessages':
                this.setState({showDeleteHistoryModal: true});
                break;
            case 'deleteFileTransfers':
                this.setState({showDeleteFileTransfers: true});
                break;
            case 'generatePrivateKey':
                this.setState({showGenerateKeysModal: true});
                break;
            case 'toggleFavorite':
                this.props.toggleFavorite(this.state.selectedContact.uri);
                break;
            case 'toggleAutoanswer':
                this.props.toggleAutoanswer(this.state.selectedContact.uri);
                break;
            case 'toggleBlocked':
                this.props.toggleBlocked(this.state.selectedContact.uri);
                break;
            case 'sendPublicKey':
                this.props.sendPublicKey(this.state.selectedContact.uri);
                break;
            case 'exportPrivateKey':
                if (this.state.publicKey) {
                    this.showExportPrivateKeyModal();
                } else {
                    this.props.showImportModal(true);
                }
                break;
            case 'backupPrivateKey':
                if (this.state.publicKey) {
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
                Linking.openURL(config.serverSettingsUrl);
                break;
            default:
                break;
        }
        this.setState({menuVisible: false});
    }

    toggleMute() {
        this.setState(prevState => ({mute: !prevState.mute}));
        this.props.toggleMute();
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
        let uri = this.state.selectedContact.uri;
        this.props.startCall(uri, {audio: true, video: false});
    }

    videoCall() {
        let uri = this.state.selectedContact.uri;
        this.props.startCall(uri, {audio: true, video: true});
    }

    resumeTransfers() {
        this.props.resumeTransfers();
    }

    get myself() {
        return this.state.selectedContact && this.state.selectedContact.uri === this.state.accountId;
    }

    conferenceCall() {
        this.props.showConferenceModalFunc();
    }

    toggleAddContactModal() {
        this.setState({showAddContactModal: !this.state.showAddContactModal});
    }

    closeDeleteHistoryModal() {
        this.setState({showDeleteHistoryModal: false});
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
                       showPublicKey: false,
                       userClosed: true});
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
        this.setState({privateKeyPassword: password});
        this.props.showExportPrivateKeyModalFunc()
    }

    hideExportPrivateKeyModal() {
        this.setState({backupKey: false});
        this.props.hideExportPrivateKeyModalFunc()
    }

    render() {
         const muteIcon = this.state.mute ? 'bell-off' : 'bell';
         const bellIcon = this.state.dnd ? 'bell-off' : 'bell';

        if (this.state.menuVisible && !this.state.appStoreVersion) {
            //this.props.checkVersionFunc()
        }

        let subtitleStyle = this.props.isTablet ? styles.tabletSubtitle: styles.subtitle;
        let titleStyle = this.props.isTablet ? styles.tabletTitle: styles.title;

        let statusIcon = null;
        let statusColor = 'green';
        let tags = [];

        statusIcon = 'check-circle';
        let bellStyle = styles.whiteButton;

        if (this.state.connection && this.state.connection.state === 'ready') {
            bellStyle = styles.greenButton;
        } else if (this.state.connection && this.state.connection.state === 'connecting') {
            bellStyle = styles.whiteButton;
        } else if (this.state.connection && this.state.connection.state === 'disconnected') {
            bellStyle = styles.whiteButton;
        } else if (this.state.connection && this.state.registrationState !== 'registered') {
            bellStyle = styles.redButton;
        } else {
            bellStyle = styles.whiteButton;
        }

        if (!this.state.connection || this.state.connection.state !== 'ready') {
            statusIcon = 'alert-circle';
            statusColor = 'red';
        } else if (this.state.registrationState !== 'registered') {
            statusIcon = 'alert-circle';
            statusColor = 'orange';
        }

        let callUrl = callUrl = config.publicUrl + "/call/" + this.state.accountId;
        let proximityTitle = this.state.proximity ? 'Disable proximity sensor' : 'Enable proximity sensor';
        let proximityIcon = this.state.proximity ? 'ear-hearing-off' : 'ear-hearing';
        let rejectAnonymousTitle = this.state.rejectAnonymous ? 'Allow anonymous callers' : 'Reject anonymous callers';
        let rejectIcon = this.state.rejectAnonymous ? 'door-closed-lock' : 'door-open';
        let isConference = false;

		const friendlyName = this.state.selectedContact ? this.state.selectedContact.uri.split('@')[0] : '';
		const conferenceUrl = `${config.publicUrl}/conference/${friendlyName}`;

        if (this.state.selectedContact) {
            tags = this.state.selectedContact.tags;
            isConference = this.state.selectedContact.conference || tags.indexOf('conference') > -1;
        }

        let favoriteTitle = (this.state.selectedContact && tags && tags.indexOf('favorite') > -1) ? 'Unfavorite' : 'Favorite';
        let autoanswerTitle = (this.state.selectedContact && tags && tags.indexOf('autoanswer') > -1) ? 'No autoanswer' : 'Auto answer';
        let favoriteIcon = (this.state.selectedContact && tags && tags.indexOf('favorite') > -1) ? 'flag-minus' : 'flag';

        let extraMenu = false;
        let importKeyLabel = this.state.publicKey ? "Export private key...": "Import private key...";

        let showEditModal = this.state.showEditContactModal;

        let showBackButton = this.state.selectedContact || this.state.sharingAction;

        let hasUpdate = this.state.appStoreVersion && this.state.appStoreVersion.version > VersionNumber.appVersion;
        let updateTitle = hasUpdate ? 'Update Sylk...' : 'Check for updates...';

        let isAnonymous = this.state.selectedContact && (this.state.selectedContact.uri.indexOf('@guest.') > -1 || this.state.selectedContact.uri.indexOf('anonymous@') > -1);
        let isCallableUri = !isConference && !this.state.inCall && !isAnonymous && tags.indexOf('blocked') === -1;

        let blockedTitle = (this.state.selectedContact && tags && tags.indexOf('blocked') > -1) ? 'Unblock' : isAnonymous ? 'Block anonymous callers': 'Block';
        if (isAnonymous && this.state.blockedUris.indexOf('anonymous@anonymous.invalid') > -1) {
            blockedTitle = 'Allow anonymous callers';
        }
        
        let editTitle = isConference ? "Configure..." : "Edit contact...";
        let deleteTitle = isConference ? "Remove" : "Delete contact...";
        let searchTitle = this.state.searchMessages ? 'End search': 'Search messages...';
        
        let subtitle = this.state.accountId;
        let title = this.state.myDisplayName || 'Myself';
        let searchIcon = this.state.searchMessages ? "close" : "magnify";

		function capitalizeFirstLetter(str) {
		  if (!str) return ""; // Handle empty string
		  return str[0].toUpperCase() + str.slice(1);
		}

        if (this.state.selectedContact) {
			if (isConference) {
				title = capitalizeFirstLetter(this.state.selectedContact.uri.split('@')[0]);
				subtitle = 'Conference room';
			} else {
			    if (this.state.selectedContact.name) {
					title = this.state.selectedContact.name;
			    } else {
					title = capitalizeFirstLetter(this.state.selectedContact.uri.split('@')[0]);
			    }
				subtitle = this.state.selectedContact.uri;
			}
		}

		const { width, height } = Dimensions.get('window');
		const navBarWidth = this.state.isLandscape && Platform.OS === 'android' ? width - 48 : width;
		const marginLeft = this.state.isLandscape && Platform.OS === 'android' ? -48 : 0;
		const as = 40; //avatar size

        return (
			<View style={{ width: navBarWidth}}>
                         
            <Appbar.Header 
                 style={{backgroundColor: 'black', 
                         marginLeft: marginLeft,
                         width: navBarWidth
                 }} 
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

                {this.props.isTablet?
                <Text style={subtitleStyle}>{subtitle} </Text>
                : null}

                { false && !this.state.rejectNonContacts && ! this.state.selectedContact?
                <IconButton
                    style={styles.whiteButton}
                    size={18}
                    disabled={false}
                    onPress={this.props.toggleRejectAnonymous}
                    icon={rejectIcon}
                />
                : null}

                { !this.state.selectedContact ?
                <IconButton
                    style={bellStyle}
                    size={18}
                    disabled={false}
                    onPress={this.props.toggleDnd}
                    icon={bellIcon}
                />
                : null}

                {this.state.selectedContact ?
                <IconButton
                    style={styles.whiteButton}
                    size={18}
                    disabled={false}
                    onPress={this.props.toggleSearchMessages}
                    icon={searchIcon}
                />
                : null}

                {statusColor == 'greenXXX' ?
                    <Icon name={statusIcon} size={20} color={statusColor} />
                : null }

                { this.state.selectedContact?
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

                        { false ? <Menu.Item onPress={() => this.handleMenu('searchMessages')} icon="search" title={searchTitle}/> : null}

                        {isCallableUri ? <Menu.Item onPress={() => this.handleMenu('audio')} icon="phone" title="Audio call"/> :null}
                        {isCallableUri ? <Menu.Item onPress={() => this.handleMenu('video')} icon="video" title="Video call"/> :null}
                        {tags.indexOf('blocked') === -1 && this.props.canSend() && !this.state.inCall && isConference ? <Menu.Item onPress={() => this.handleMenu('conference')} icon="account-group" title="Join conference..."/> :null}
                        {tags.indexOf('blocked') === -1 && !this.state.inCall && isConference ? <Menu.Item onPress={() => this.handleMenu('shareConferenceLinkModal')} icon="share-variant" title="Share link..."/> :null}

                        {tags.indexOf('blocked') === -1 ?
                        <Divider />
						: null}
                                                
						{ !this.state.searchMessages ?
						<Menu.Item onPress={() => this.handleMenu('editContact')} icon="account" title={editTitle}/>
						: null}

                        { !this.state.searchMessages && this.hasMessages && !this.state.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('deleteMessages')} icon="delete" title="Delete messages..."/>
                        : null
                        }

                        {!this.state.searchMessages && this.hasFiles && !this.state.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('deleteFileTransfers')} icon="delete" title="Delete files..."/>
                        : null
                        }

                        {!this.state.searchMessages && this.myself && !this.state.selectedContact ?
                        <Menu.Item onPress={() => this.handleMenu('refetchMessages')} icon="cloud-download" title="Refetch messages"/> 
                        : null}

                        { !this.state.searchMessages && this.hasFiles && !this.state.inCall && 'paused' in this.state.contentTypes ?
                        <Menu.Item onPress={() => this.handleMenu('resumeTransfers')} icon="delete" title="Resume transfers"/>
                        : null
                        }

                        {false && !isConference && !this.state.searchMessages && this.hasMessages && tags.indexOf('test') === -1 && !isConference && !this.myself?
                        <Menu.Item onPress={() => this.handleMenu('sendPublicKey')} icon="key-change" title="Send my public key..."/>
                        : null}

                        {!isConference && !this.state.searchMessages && this.props.publicKey ?
                        <Menu.Item onPress={() => this.handleMenu('showPublicKey')} icon="key-variant" title="Show public key..."/>
                        : null}

                        {!isConference && !this.state.searchMessages && tags.indexOf('test') === -1 && !this.state.inCall && !isAnonymous && tags.indexOf('favorite') > -1 ?
                        <Menu.Item onPress={() => this.handleMenu('toggleAutoanswer')} title={autoanswerTitle}/>
                        : null}
                        <Divider />

                        {!isConference && !this.myself && !this.state.searchMessages && tags.indexOf('test') === -1 && !this.state.inCall && !isAnonymous && tags.indexOf('blocked') === -1 ?
                        <Menu.Item onPress={() => this.handleMenu('toggleFavorite')} icon={favoriteIcon} title={favoriteTitle}/>
                        : null}

                        {!isConference && !this.myself && !this.state.searchMessages && tags.indexOf('test') === -1 && tags.indexOf('favorite') === -1 && !this.state.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('toggleBlocked')} icon="block-helper" title={blockedTitle}/>
                        : null}

                        {!this.state.inCall && tags.indexOf('test') === -1 && !tags.indexOf('favorite') === -1 ?
                        <Menu.Item onPress={() => this.handleMenu('deleteMessages')} icon="delete" title={deleteTitle}/>
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
                        {!this.state.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('callMeMaybe')} icon="share" title="Call me, maybe?" />
                         : null }
                        {!this.state.syncConversations && !this.state.inCall  ?
                        <Menu.Item onPress={() => this.handleMenu('displayName')} icon="rename-box" title="My account..." />
                        : null}
                        {!this.state.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('addContact')} icon="account-plus" title="Add contact..."/>
                         : null }
                        {!this.state.inCall && false ? <Menu.Item onPress={() => this.handleMenu('conference')} icon="account-group" title="Join conference..."/> :null}
                        {!this.state.inCall && false ? <Menu.Item onPress={() => this.handleMenu('preview')} icon="video" title="Video preview" />:null}
                        {!this.state.inCall ?
                        <Divider />
                        : null}

                        {this.props.canSend() && !this.state.inCall ? <Menu.Item onPress={() => this.handleMenu('exportPrivateKey')} icon="send" title={importKeyLabel} />:null}
                        {this.props.canSend() && !this.state.inCall ? <Menu.Item onPress={() => this.handleMenu('backupPrivateKey')} icon="send" title={'Backup private key...'} />:null}
                        {!this.state.inCall ? <Menu.Item onPress={() => this.handleMenu('restorePrivateKey')} icon="key" title="Restore private key..."/> :null}
                        {!this.state.inCall ? <Menu.Item onPress={() => this.handleMenu('generatePrivateKey')} icon="key" title="Generate private key..."/> :null}
                        {false && !this.state.inCall ? <Menu.Item onPress={() => this.handleMenu('deleteMessages')} icon="delete" title="Wipe device..."/> :null}

                        {!this.state.inCall ?
						<Divider />
                        : null}

                        {false ? <Menu.Item onPress={() => this.handleMenu('checkUpdate')} icon="update" title={updateTitle} /> :null}
                        {extraMenu ?
                        <View>

                        <Menu.Item onPress={() => this.handleMenu('settings')} icon="wrench" title="Server settings..." />
                        </View>
                        : null}
                        <Menu.Item onPress={() => this.handleMenu('proximity')} icon={proximityIcon} title={proximityTitle} />

                        {false && !this.state.rejectNonContacts ?
                        <Menu.Item onPress={() => this.handleMenu('anonymous')} icon={rejectIcon} title={rejectAnonymousTitle} />
                        : null}
                        
                        {false && !this.state.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('appSettings')} icon="wrench" title="App settings"/>
                         : null }

                        {!this.state.inCall ?
                        <Divider />
                         : null }
                        {false ?
                        <Menu.Item onPress={() => this.handleMenu('logs')} icon="file" title="Logs" />
                        :null}
                        {!this.state.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('about')} icon="information" title="About Sylk"/> : null}
                        {!this.state.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('logOut')} icon="logout" title="Sign out" /> : null}
                    </Menu>
                    }

                <AboutModal
                    show={this.state.showAboutModal}
                    close={this.toggleAboutModal}
                    currentVersion={VersionNumber.appVersion}
                    appStoreVersion={this.state.appStoreVersion}
                    buildId={this.props.buildId}

                />

                <CallMeMaybeModal
                    show={this.state.showCallMeMaybeModal}
                    close={this.props.toggleCallMeMaybeModal}
                    callUrl={callUrl}
                    notificationCenter={this.props.notificationCenter}
                />

                <DeleteHistoryModal
                    show={this.state.showDeleteHistoryModal}
                    close={this.closeDeleteHistoryModal}
                    uri={this.state.selectedContact ? this.state.selectedContact.uri : null}
                    displayName={this.state.displayName}
                    hasMessages={this.hasMessages}
                    deleteContactFunc={this.props.removeContact}
                    deleteMessages={this.props.deleteMessages}
                    filteredMessageIds={this.state.filteredMessageIds}
                    selectedContact={this.state.selectedContact}
                    myself={!this.state.selectedContact || (this.state.selectedContact && this.state.selectedContact.uri === this.state.accountId) ? true : false}
                />

                <DeleteFileTransfers
                    selectedContact={this.state.selectedContact}
                    show={this.state.showDeleteFileTransfers}
                    close={this.closeDeleteFileTransfers}
                    selectedContact={this.state.selectedContact}
                    uri={this.state.selectedContact ? this.state.selectedContact.uri : null}
                    displayName={this.state.displayName}
                    deleteFilesFunc={this.props.deleteFiles}
                    sharedFiles={this.state.sharedFiles}
                    getFiles={this.props.getFiles}
                    myself={!this.state.selectedContact || (this.state.selectedContact && this.state.selectedContact.uri === this.state.accountId) ? true : false}
                />

                <AddContactModal
                    show={this.state.showAddContactModal}
                    close={this.toggleAddContactModal}
                    saveContact={this.props.saveContact}
                    defaultDomain={this.props.defaultDomain}
                />

                <EditContactModal
                    show={showEditModal}
                    close={this.hideEditContactModal}
                    uri={this.state.selectedContact ? this.state.selectedContact.uri : this.state.accountId}
                    displayName={this.state.displayName}
                    selectedContact={this.state.selectedContact}
                    organization={this.state.organization}
                    email={this.state.selectedContact ? this.state.selectedContact.email : this.state.email}
                    myself={!this.state.selectedContact || (this.state.selectedContact && this.state.selectedContact.uri === this.state.accountId) ? true : false}
                    saveContact={this.props.saveContact}
                    deletePublicKey={this.props.deletePublicKey}
                    publicKey={this.state.showPublicKey ? this.state.publicKey: null}
                    myuuid={this.state.myuuid}
 				    rejectNonContacts={this.state.rejectNonContacts}
 				    toggleRejectNonContacts={this.props.toggleRejectNonContacts}
					rejectAnonymous={this.state.rejectAnonymous}
 				    toggleRejectAnonymous={this.props.toggleRejectAnonymous}
                />

                { this.state.showEditConferenceModal ?
                <EditConferenceModal
                    show={this.state.showEditConferenceModal}
                    close={this.closeEditConferenceModal}
                    room={this.state.selectedContact ? this.state.selectedContact.uri.split('@')[0]: ''}
                    displayName={this.state.displayName}
                    participants={this.state.selectedContact ? this.state.selectedContact.participants : []}
                    selectedContact={this.state.selectedContact}
                    toggleFavorite={this.props.toggleFavorite}
                    saveConference={this.saveConference}
                    defaultDomain={this.props.defaultDomain}
                    accountId={this.state.accountId}
                    favoriteUris={this.props.favoriteUris}
                />
                : null}

                { this.state.showConferenceLinkModal ?
                <ShareConferenceLinkModal
                    notificationCenter={this.props.notificationCenter}
                    show={this.state.showConferenceLinkModal}
                    close={this.hideConferenceLinkModal}
                    conferenceUrl={conferenceUrl}
                />
                : null}
                
				{this.state.showExportPrivateKeyModal && (
				  <ExportPrivateKeyModal
					show={this.state.showExportPrivateKeyModal}
					password={this.state.privateKeyPassword}
					close={this.hideExportPrivateKeyModal}
					exportFunc={this.props.exportKey|| (() => {})}
					publicKeyHash={this.state.publicKeyHash}
					publicKey={this.state.publicKey}
					backup={this.state.backupKey}
				  />
				)}

                { this.state.showGenerateKeysModal && (
                <GenerateKeysModal
                    show={this.state.showGenerateKeysModal}
                    close={this.hideGenerateKeysModal}
                    generateKeysFunc={this.props.generateKeysFunc}
                />)
                }

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
    toggleMute         : PropTypes.func,
    orientation        : PropTypes.string,
    isTablet           : PropTypes.bool,
    selectedContact    : PropTypes.object,
    goBackFunc         : PropTypes.func,
    exportKey          : PropTypes.func,
    publicKeyHash      : PropTypes.string,
    publicKey          : PropTypes.string,
    deleteMessages     : PropTypes.func,
    deleteFiles        : PropTypes.func,
    toggleBlocked      : PropTypes.func,
    toggleFavorite     : PropTypes.func,
    toggleAutoanswer   : PropTypes.func,
    saveConference     : PropTypes.func,
    defaultDomain      : PropTypes.string,
    favoriteUris       : PropTypes.array,
    startCall          : PropTypes.func,
    startConference    : PropTypes.func,
    saveContact        : PropTypes.func,
    addContact         : PropTypes.func,
    deleteContact      : PropTypes.func,
    removeContact      : PropTypes.func,
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
    getFiles: PropTypes.func,
    sharedFiles: PropTypes.object,
    rejectAnonymous: PropTypes.bool,
    toggleRejectAnonymous: PropTypes.func,
    rejectNonContacts: PropTypes.bool,
    toggleRejectNonContacts: PropTypes.func,
    toggleSearchMessages: PropTypes.func,
    searchMessages: PropTypes.bool,
    isLandscape: PropTypes.bool
};

export default NavigationBar;
