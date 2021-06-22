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
import ExportPrivateKeyModal from './ExportPrivateKeyModal';
import DeleteHistoryModal from './DeleteHistoryModal';


class NavigationBar extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            showAboutModal: false,
            inCall: this.props.inCall,
            showCallMeMaybeModal: false,
            showEditContactModal: false,
            showEditConferenceModal: false,
            showExportPrivateKeyModal: false,
            showDeleteHistoryModal: false,
            showAddContactModal: false,
            privateKeyPassword: null,
            registrationState: this.props.registrationState,
            connection: this.props.connection,
            proximity: this.props.proximity,
            selectedContact: this.props.selectedContact,
            mute: false,
            menuVisible: false,
            accountId: this.props.accountId,
            displayName: this.props.displayName,
            organization: this.props.organization,
            publicKeyHash: this.props.publicKeyHash,
            showEditContactModal: false,
            showPublicKey: false,
            myInvitedParties: this.props.myInvitedParties
        }

        this.menuRef = React.createRef();
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.account !== null && nextProps.account.id !== this.state.accountId) {
            this.setState({accountId: nextProps.accountId});
        }

        this.setState({registrationState: nextProps.registrationState,
                       connection: nextProps.connection,
                       displayName: nextProps.displayName,
                       organization: nextProps.organization,
                       proximity: nextProps.proximity,
                       inCall: nextProps.inCall,
                       publicKeyHash: nextProps.publicKeyHash,
                       selectedContact: nextProps.selectedContact,
                       myInvitedParties: nextProps.myInvitedParties
                       });
    }

    handleMenu(event) {
        this.callUrl = `${config.publicUrl}/call/${this.state.accountId}`;
        switch (event) {
            case 'about':
                this.toggleAboutModal();
                break;
            case 'callMeMaybe':
                this.toggleCallMeMaybeModal();
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
            case 'logOut':
                this.props.logout();
                break;
            case 'logs':
                this.props.showLogs();
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
            case 'addContact':
                this.toggleAddContactModal();
                break;
            case 'editContact':
                if (this.state.selectedContact && this.state.selectedContact.remoteParty.indexOf('@videoconference') > -1) {
                    this.setState({showEditConferenceModal: !this.state.showEditConferenceModal});
                } else {
                    this.setState({showEditContactModal: !this.state.showEditContactModal});
                }
                break;
            case 'deleteMessages':
                this.setState({showDeleteHistoryModal: !this.state.showDeleteHistoryModal});
                break;
            case 'toggleFavorite':
                this.props.toggleFavorite(this.state.selectedContact.remoteParty);
                break;
            case 'toggleBlocked':
                this.props.toggleBlocked(this.state.selectedContact.remoteParty);
                break;
            case 'togglePinned':
                this.props.togglePinned(this.state.selectedContact.remoteParty);
                break;
            case 'sendPublicKey':
                this.props.sendPublicKey(this.state.selectedContact.remoteParty);
                break;
            case 'exportPrivateKey':
                this.toggleExportPrivateKeyModal();
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

    saveContact(displayName, organization='') {
        if (!displayName) {
            return;
        }

        if (this.state.selectedContact) {
            this.props.saveContact(this.state.selectedContact.remoteParty, displayName, organization);
        } else {
            this.setState({displayName: displayName});
            this.props.saveContact(this.state.accountId, displayName, organization);
        }
    }

    toggleMute() {
        this.setState(prevState => ({mute: !prevState.mute}));
        this.props.toggleMute();
    }

    toggleAboutModal() {
        this.setState({showAboutModal: !this.state.showAboutModal});
    }

    audioCall() {
        let uri = this.state.selectedContact.remoteParty;
        this.props.startCall(uri, {audio: true, video: false});
    }

    videoCall() {
        let uri = this.state.selectedContact.remoteParty;
        this.props.startCall(uri, {audio: true, video: true});
    }

    toggleAddContactModal() {
        this.setState({showAddContactModal: !this.state.showAddContactModal});
    }

    toggleCallMeMaybeModal() {
        this.setState({showCallMeMaybeModal: !this.state.showCallMeMaybeModal});
    }

    toggleDeleteHistoryModal() {
        this.setState({showDeleteHistoryModal: !this.state.showDeleteHistoryModal});
    }

    toggleEditContactModal() {
        this.setState({showEditContactModal: !this.state.showEditContactModal,
                       showPublicKey: false});
    }

    toggleEditConferenceModal() {
        this.setState({showEditConferenceModal: !this.state.showEditConferenceModal});
    }

    toggleExportPrivateKeyModal() {
        const password = Math.random().toString().substr(2, 6);
        this.setState({showExportPrivateKeyModal: !this.state.showExportPrivateKeyModal,
                       privateKeyPassword: password});
    }

    render() {
         const muteIcon = this.state.mute ? 'bell-off' : 'bell';

        let subtitleStyle = this.props.isTablet ? styles.tabletSubtitle: styles.subtitle;
        let titleStyle = this.props.isTablet ? styles.tabletTitle: styles.title;

        let statusIcon = null;
        let statusColor = 'green';

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

        let displayName = this.state.selectedContact ? this.state.selectedContact.displayName : this.state.displayName;
        let organization = this.state.selectedContact ? this.state.selectedContact.organization : this.state.organization;
        let blockedTitle = (this.state.selectedContact && this.state.selectedContact.tags && this.state.selectedContact.tags.indexOf('blocked') > -1) ? 'Unblock' : 'Block';
        let favoriteTitle = (this.state.selectedContact && this.state.selectedContact.tags && this.state.selectedContact.tags.indexOf('favorite') > -1) ? 'Unfavorite' : 'Favorite';

        let invitedParties = [];
        if (this.state.selectedContact) {
            let uri = this.state.selectedContact.remoteParty.split('@')[0];
            if (this.state.myInvitedParties && this.state.myInvitedParties.hasOwnProperty(uri)) {
                invitedParties = this.state.myInvitedParties[uri];
            }
        }

        let extraMenu = false;

        return (
            <Appbar.Header style={{backgroundColor: 'black'}}>
                {this.state.selectedContact?
                <Appbar.BackAction onPress={() => {this.props.goBackFunc()}} />
                : <Image source={blinkLogo} style={styles.logo}/>}

                <Appbar.Content
                    title="Sylk"
                    titleStyle={titleStyle}
                    subtitleStyle={subtitleStyle}
                    subtitle={this.props.isTablet? null: (this.state.accountId + ' (' + this.state.displayName + ')')}
                />
                {this.props.isTablet?
                <Text style={subtitleStyle}>{subtitle}</Text>
                : null}


                {statusIcon ?
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
                        <Menu.Item onPress={() => this.handleMenu('editContact')} icon="account" title="Edit..."/>
                        <Menu.Item onPress={() => this.handleMenu('audio')} icon="phone" title="Audio call"/>
                        <Menu.Item onPress={() => this.handleMenu('video')} icon="video" title="Video call"/>
                        <Menu.Item onPress={() => this.handleMenu('deleteMessages')} icon="delete" title="Delete messages..."/>
                        <Menu.Item onPress={() => this.handleMenu('togglePinned')} icon="pin" title="Pinned messages"/>
                        <Menu.Item onPress={() => this.handleMenu('sendPublicKey')} icon="pin" title="Send my public key..."/>
                        <Menu.Item onPress={() => this.handleMenu('toggleBlocked')} icon="block-helper" title={blockedTitle}/>
                        <Menu.Item onPress={() => this.handleMenu('toggleFavorite')} icon="label" title={favoriteTitle}/>
                        {this.props.publicKeyHash ?
                        <Menu.Item onPress={() => this.handleMenu('showPublicKey')} icon="label" title="Show key..."/>
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
                        <Menu.Item onPress={() => this.handleMenu('addContact')} icon="account" title="Add contact..."/>
                        <Menu.Item onPress={() => this.handleMenu('callMeMaybe')} icon="share" title="Call me, maybe?" />
                        <Menu.Item onPress={() => this.handleMenu('preview')} icon="video" title="Video preview" />
                        <Menu.Item onPress={() => this.handleMenu('displayName')} icon="rename-box" title="My display name" />
                        <Menu.Item onPress={() => this.handleMenu('exportPrivateKey')} icon="key" title="Export private key..." />
                        <Menu.Item onPress={() => this.handleMenu('checkUpdate')} icon="update" title="Check for updates..." />
                        <Divider/>
                        {extraMenu ?
                        <View>

                        <Menu.Item onPress={() => this.handleMenu('settings')} icon="wrench" title="Server settings..." />
                        <Menu.Item onPress={() => this.handleMenu('logs')} icon="timeline-text-outline" title="Show logs" />
                        <Menu.Item onPress={() => this.handleMenu('proximity')} icon={proximityIcon} title={proximityTitle} />
                        </View>
                        : null}
                        <Menu.Item onPress={() => this.handleMenu('about')} icon="information" title="About Sylk"/>
                        <Menu.Item onPress={() => this.handleMenu('logOut')} icon="logout" title="Sign out" />
                    </Menu>
                    }

                <AboutModal
                    show={this.state.showAboutModal}
                    close={this.toggleAboutModal}
                />

                <CallMeMaybeModal
                    show={this.state.showCallMeMaybeModal}
                    close={this.toggleCallMeMaybeModal}
                    callUrl={callUrl}
                    notificationCenter={this.props.notificationCenter}
                />

                <DeleteHistoryModal
                    show={this.state.showDeleteHistoryModal}
                    close={this.toggleDeleteHistoryModal}
                    uri={this.state.selectedContact ? this.state.selectedContact.remoteParty : null}
                    displayName={displayName}
                    deleteMessages={this.props.deleteMessages}
                />

                <AddContactModal
                    show={this.state.showAddContactModal}
                    close={this.toggleAddContactModal}
                    saveContact={this.props.saveContact}
                />

                <EditContactModal
                    show={this.state.showEditContactModal || !this.state.displayName}
                    close={this.toggleEditContactModal}
                    uri={this.state.selectedContact ? this.state.selectedContact.remoteParty : this.state.accountId}
                    displayName={displayName}
                    organization={organization}
                    myself={this.state.selectedContact ? false : true}
                    saveContact={this.saveContact}
                    deleteContact={this.props.deleteContact}
                    publicKeyHash={this.state.showPublicKey ? this.state.publicKeyHash: null}
                />

                <EditConferenceModal
                    show={this.state.showEditConferenceModal}
                    close={this.toggleEditConferenceModal}
                    room={this.state.selectedContact ? this.state.selectedContact.remoteParty.split('@')[0]: ''}
                    invitedParties={invitedParties}
                    selectedContact={this.state.selectedContact}
                    toggleFavorite={this.props.toggleFavorite}
                    saveInvitedParties={this.props.saveInvitedParties}
                    defaultDomain={this.props.defaultDomain}
                    accountId={this.state.accountId}
                    favoriteUris={this.props.favoriteUris}
                />

                <ExportPrivateKeyModal
                    show={this.state.showExportPrivateKeyModal}
                    password={this.state.privateKeyPassword}
                    close={this.toggleExportPrivateKeyModal}
                    saveFunc={this.props.replicateKey}
                    publicKeyHash={this.state.publicKeyHash}
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
    proximity          : PropTypes.bool,
    displayName        : PropTypes.string,
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
    deleteMessages     : PropTypes.func,
    togglePinned       : PropTypes.func,
    toggleBlocked      : PropTypes.func,
    toggleFavorite     : PropTypes.func,
    myInvitedParties   : PropTypes.object,
    saveInvitedParties : PropTypes.func,
    defaultDomain      : PropTypes.string,
    favoriteUris       : PropTypes.array,
    startCall          : PropTypes.func,
    saveContact        : PropTypes.func,
    addContact         : PropTypes.func,
    deleteContact      : PropTypes.func,
    sendPublicKey      : PropTypes.func
};

export default NavigationBar;
