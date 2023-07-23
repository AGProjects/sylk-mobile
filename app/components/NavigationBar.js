import React, { Component } from 'react';
import { Linking, Image, Platform, View } from 'react-native';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Appbar, Menu, Divider, Text } from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';

import config from '../config';

import styles from '../assets/styles/blink/_NavigationBar.scss';
const blinkLogo = require('../assets/images/blink-white-big.png');

import AboutModal from './AboutModal';
import CallMeMaybeModal from './CallMeMaybeModal';
import EditConferenceModal from './EditConferenceModal';
import AddContactModal from './AddContactModal';
import EditContactModal from './EditContactModal';
import GenerateKeysModal from './GenerateKeysModal';
import ExportPrivateKeyModal from './ExportPrivateKeyModal';
import DeleteHistoryModal from './DeleteHistoryModal';
import VersionNumber from 'react-native-version-number';
import ShareConferenceLinkModal from './ShareConferenceLinkModal';


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
            messages: this.props.messages,
            userClosed: false,
            blockedUris: this.props.blockedUris,
            ssiRequired: this.props.ssiRequired,
            filteredMessageIds: this.props.filteredMessageIds,
            contentTypes: this.props.contentTypes
        }

        this.menuRef = React.createRef();
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
                       ssiRequired: nextProps.ssiRequired,
                       filteredMessageIds: nextProps.filteredMessageIds,
                       contentTypes: nextProps.contentTypes
                       });

                    if (nextProps.menuVisible) {
                        this.setState({menuVisible: nextProps.menuVisible});
                        console.log('Next menu visible', nextProps.menuVisible);
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
            case 'ssi':
                this.props.toggleSSIFunc();
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
            case 'deleteSsiCredential':
                this.props.deleteSsiCredential(this.state.selectedContact);
                break;
            case 'deleteSsiConnection':
                this.props.deleteSsiConnection(this.state.selectedContact);
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
            case 'deleteMessages':
                this.setState({showDeleteHistoryModal: true});
                break;
            case 'generatePrivateKey':
                this.setState({showGenerateKeysModal: true});
                break;
            case 'toggleFavorite':
                this.props.toggleFavorite(this.state.selectedContact.uri);
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

    saveContact(displayName, organization='', email='') {
        if (!displayName) {
            return;
        }

        if (this.state.selectedContact && this.state.selectedContact.uri !== this.state.accountId) {
            this.props.saveContact(this.state.selectedContact.uri, displayName, organization);
        } else {
            this.setState({displayName: displayName});
            this.props.saveContact(this.state.accountId, displayName, organization, email);
        }
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

    conferenceCall() {
        this.props.showConferenceModalFunc();
    }

    toggleAddContactModal() {
        this.setState({showAddContactModal: !this.state.showAddContactModal});
    }

    closeDeleteHistoryModal() {
        this.setState({showDeleteHistoryModal: false});
    }

    hideGenerateKeysModal() {
        this.setState({showGenerateKeysModal: false});
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

    render() {
         const muteIcon = this.state.mute ? 'bell-off' : 'bell';

        if (this.state.menuVisible && !this.state.appStoreVersion) {
            this.props.checkVersionFunc()
        }

        let subtitleStyle = this.props.isTablet ? styles.tabletSubtitle: styles.subtitle;
        let titleStyle = this.props.isTablet ? styles.tabletTitle: styles.title;

        let statusIcon = null;
        let statusColor = 'green';
        let tags = [];

        statusIcon = 'check-circle';
        if (!this.state.connection || this.state.connection.state !== 'ready') {
            statusIcon = 'alert-circle';
            statusColor = 'red';
        } else if (this.state.registrationState !== 'registered') {
            statusIcon = 'alert-circle';
            statusColor = 'orange';
        }

        let callUrl = callUrl = config.publicUrl + "/call/" + this.state.accountId;
        let subtitle = 'Signed in as ' +  this.state.accountId;
        let proximityTitle = this.state.proximity ? 'No proximity sensor' : 'Proximity sensor';
        let proximityIcon = this.state.proximity ? 'ear-hearing-off' : 'ear-hearing';
        let isConference = false;

        let hasMessages = true; // allow user to select this after local messages were removed, to delete them remotely
        if (this.state.selectedContact) {
            if (Object.keys(this.state.messages).indexOf(this.state.selectedContact.uri) > -1 && this.state.messages[this.state.selectedContact.uri].length > 0) {
                hasMessages = true;
            }
            tags = this.state.selectedContact.tags;
            isConference = this.state.selectedContact.conference || tags.indexOf('conference') > -1;
        }

        let favoriteTitle = (this.state.selectedContact && tags && tags.indexOf('favorite') > -1) ? 'Unfavorite' : 'Favorite';
        let favoriteIcon = (this.state.selectedContact && tags && tags.indexOf('favorite') > -1) ? 'flag-minus' : 'flag';

        let extraMenu = false;
        let importKeyLabel = this.state.publicKey ? "Export private key...": "Import private key...";

        let showEditModal = false;
        if (this.state.selectedContact) {
            showEditModal = this.state.showEditContactModal && !this.state.syncConversations;
        } else {
            showEditModal = !this.state.syncConversations && this.state.contactsLoaded &&
                                 (this.state.showEditContactModal || (!this.state.displayName && this.state.publicKey !== null && !this.state.userClosed))
                                 || false;
        }

        let hasUpdate = this.state.appStoreVersion && this.state.appStoreVersion.version > VersionNumber.appVersion;
        let updateTitle = hasUpdate ? 'Update Sylk...' : 'Check for updates...';

        let isAnonymous = this.state.selectedContact && (this.state.selectedContact.uri.indexOf('@guest.') > -1 || this.state.selectedContact.uri.indexOf('anonymous@') > -1);
        let isCallableUri = !isConference && !this.state.inCall && !isAnonymous && tags.indexOf('ssi') === -1;

        let blockedTitle = (this.state.selectedContact && tags && tags.indexOf('blocked') > -1) ? 'Unblock' : isAnonymous ? 'Block anonymous callers': 'Block';
        if (isAnonymous && this.state.blockedUris.indexOf('anonymous@anonymous.invalid') > -1) {
            blockedTitle = 'Allow anonymous callers';
        }

        let ssiTitle = this.state.ssiRequired ? 'Disable SSI' : 'Enable SSI';
        let enableSsi = false;

        return (
            <Appbar.Header style={{backgroundColor: 'black'}}>
                {this.state.selectedContact?
                <Appbar.BackAction onPress={() => {this.props.goBackFunc()}} />
                : <Image source={blinkLogo} style={styles.logo}/>}

                <Appbar.Content
                    title="Sylk"
                    titleStyle={titleStyle}
                    subtitleStyle={subtitleStyle}
                    subtitle={this.props.isTablet? null: ((this.state.accountId || 'Loading...') + (this.state.myDisplayName ? ' (' + this.state.myDisplayName + ')' : ''))}
                />
                {this.props.isTablet?
                <Text style={subtitleStyle}>{subtitle}</Text>
                : null}

                {statusColor == 'green' ?
                    <Icon name={statusIcon} size={20} color={statusColor} />
                : null }

                { this.state.selectedContact ?
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

                        {tags.indexOf('ssi') === -1 ? <Menu.Item onPress={() => this.handleMenu('editContact')} icon="account" title="Edit contact..."/> : null}

                        {isCallableUri ? <Menu.Item onPress={() => this.handleMenu('audio')} icon="phone" title="Audio call"/> :null}
                        {isCallableUri ? <Menu.Item onPress={() => this.handleMenu('video')} icon="video" title="Video call"/> :null}
                        {this.props.canSend() && !this.state.inCall && isConference ? <Menu.Item onPress={() => this.handleMenu('conference')} icon="account-group" title="Join conference..."/> :null}
                        {!this.state.inCall && isConference ? <Menu.Item onPress={() => this.handleMenu('shareConferenceLinkModal')} icon="share-variant" title="Share web link..."/> :null}

                        { hasMessages && !this.state.inCall && tags.indexOf('ssi') === -1 ?
                        <Menu.Item onPress={() => this.handleMenu('deleteMessages')} icon="delete" title="Delete messages..."/>
                        : null
                        }
                        {<Menu.Item onPress={() => this.handleMenu('refetchMessages')} icon="delete" title="Refetch messages"/> }

                        { hasMessages && !this.state.inCall && tags.indexOf('ssi') === -1 && 'paused' in this.state.contentTypes ?
                        <Menu.Item onPress={() => this.handleMenu('resumeTransfers')} icon="delete" title="Resume transfers"/>
                        : null
                        }

                        { hasMessages && tags.indexOf('test') === -1 && !isConference && false?
                        <Menu.Item onPress={() => this.handleMenu('sendPublicKey')} icon="key-change" title="Send my public key..."/>
                        : null}

                        {this.props.publicKey && false?
                        <Menu.Item onPress={() => this.handleMenu('showPublicKey')} icon="key-variant" title="Show public key..."/>
                        : null}
                        {tags.indexOf('test') === -1 && !this.state.inCall && !isAnonymous && tags.indexOf('ssi') === -1 ?
                        <Menu.Item onPress={() => this.handleMenu('toggleFavorite')} icon={favoriteIcon} title={favoriteTitle}/>
                        : null}
                        <Divider />
                        {tags.indexOf('test') === -1 && tags.indexOf('favorite') === -1  && !this.state.inCall && tags.indexOf('ssi') === -1 ?
                        <Menu.Item onPress={() => this.handleMenu('toggleBlocked')} icon="block-helper" title={blockedTitle}/>
                        : null}

                        {!this.state.inCall && !hasMessages && tags.indexOf('test') === -1 && tags.indexOf('ssi') === -1?
                        <Menu.Item onPress={() => this.handleMenu('deleteMessages')} icon="delete" title="Delete contact..."/>
                        : null}

                        {this.state.selectedContact && tags.indexOf('ssi-credential') > -1?
                        <Menu.Item onPress={() => this.handleMenu('deleteSsiCredential')} icon="delete" title="Delete SSI credential..."/>
                        : null}

                        {this.state.selectedContact && tags.indexOf('ssi-connection') > -1 && tags.indexOf('readonly') === -1 ?
                        <Menu.Item onPress={() => this.handleMenu('deleteSsiConnection')} icon="delete" title="Delete SSI connection..."/>
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
                        <Menu.Item onPress={() => this.handleMenu('callMeMaybe')} icon="share" title="Call me, maybe?" />
                        {!this.state.syncConversations && !this.state.inCall  ?
                        <Menu.Item onPress={() => this.handleMenu('displayName')} icon="rename-box" title="My account..." />
                        : null}
                        <Menu.Item onPress={() => this.handleMenu('addContact')} icon="account-plus" title="Add contact..."/>
                        {!this.state.inCall && false ? <Menu.Item onPress={() => this.handleMenu('conference')} icon="account-group" title="Join conference..."/> :null}
                        {!this.state.inCall && false ? <Menu.Item onPress={() => this.handleMenu('preview')} icon="video" title="Video preview" />:null}

                        {this.props.canSend() && !this.state.inCall ? <Menu.Item onPress={() => this.handleMenu('exportPrivateKey')} icon="send" title={importKeyLabel} />:null}
                        {!this.state.inCall ? <Menu.Item onPress={() => this.handleMenu('generatePrivateKey')} icon="key" title="Change private key..."/> :null}
                        {false ? <Menu.Item onPress={() => this.handleMenu('checkUpdate')} icon="update" title={updateTitle} /> :null}
                        {!this.state.inCall ? <Menu.Item onPress={() => this.handleMenu('deleteMessages')} icon="delete" title="Wipe device..."/> :null}
                        <Divider/>
                        {extraMenu ?
                        <View>

                        <Menu.Item onPress={() => this.handleMenu('settings')} icon="wrench" title="Server settings..." />
                        <Menu.Item onPress={() => this.handleMenu('proximity')} icon={proximityIcon} title={proximityTitle} />
                        </View>
                        : null}
                        {enableSsi?
                        <Menu.Item onPress={() => this.handleMenu('ssi')} icon="key" title={ssiTitle}/>
                        : null}
                        <Menu.Item onPress={() => this.handleMenu('logs')} icon="timeline-text-outline" title="Logs" />

                        {!this.state.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('about')} icon="information" title="About Sylk"/> : null}
                        <Divider />
                        {!this.state.inCall ?
                        <Menu.Item onPress={() => this.handleMenu('logOut')} icon="logout" title="Sign out" /> : null}
                    </Menu>
                    }

                <AboutModal
                    show={this.state.showAboutModal}
                    close={this.toggleAboutModal}
                    currentVersion={VersionNumber.appVersion}
                    appStoreVersion={this.state.appStoreVersion}
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
                    hasMessages={hasMessages}
                    deleteContactFunc={this.props.removeContact}
                    deleteMessages={this.props.deleteMessages}
                    filteredMessageIds={this.state.filteredMessageIds}
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
                    edit={this.state.email}
                    organization={this.state.organization}
                    email={this.state.email}
                    myself={!this.state.selectedContact || (this.state.selectedContact && this.state.selectedContact.uri === this.state.accountId) ? true : false}
                    saveContact={this.saveContact}
                    deleteContact={this.props.deleteContact}
                    deletePublicKey={this.props.deletePublicKey}
                    publicKey={this.state.showPublicKey ? this.state.publicKey: null}
                    myuuid={this.props.myuuid}
                />

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

                <ShareConferenceLinkModal
                    notificationCenter={this.props.notificationCenter}
                    show={this.state.showConferenceLinkModal}
                    close={this.hideConferenceLinkModal}
                    room={this.state.selectedContact ? this.state.selectedContact.uri: ''}
                />

                <ExportPrivateKeyModal
                    show={this.state.showExportPrivateKeyModal}
                    password={this.state.privateKeyPassword}
                    close={this.props.hideExportPrivateKeyModalFunc}
                    saveFunc={this.props.replicateKey}
                    publicKeyHash={this.state.publicKeyHash}
                    publicKey={this.state.publicKey}
                />

                <GenerateKeysModal
                    show={this.state.showGenerateKeysModal}
                    close={this.hideGenerateKeysModal}
                    generateKeysFunc={this.props.generateKeysFunc}
                />
            </Appbar.Header>
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
    replicateKey       : PropTypes.func,
    publicKeyHash      : PropTypes.string,
    publicKey          : PropTypes.string,
    deleteMessages     : PropTypes.func,
    toggleBlocked      : PropTypes.func,
    toggleFavorite     : PropTypes.func,
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
    toggleSSIFunc: PropTypes.func,
    ssiRequired: PropTypes.bool,
    refetchMessages: PropTypes.func,
    showExportPrivateKeyModal: PropTypes.bool,
    showExportPrivateKeyModalFunc: PropTypes.func,
    hideExportPrivateKeyModalFunc: PropTypes.func,
    blockedUris: PropTypes.array,
    myuuid: PropTypes.string,
    deleteSsiCredential: PropTypes.func,
    resumeTransfers: PropTypes.func,
    generateKeysFunc: PropTypes.func,
    deleteSsiConnection: PropTypes.func,
    filteredMessageIds: PropTypes.array,
    contentTypes: PropTypes.object,
    canSend: PropTypes.func
};

export default NavigationBar;
