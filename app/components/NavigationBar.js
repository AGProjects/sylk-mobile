import React, { Component } from 'react';
import { Linking, Image, View } from 'react-native';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Appbar, Menu, Divider, Text } from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';

import config from '../config';
import AboutModal from './AboutModal';
import CallMeMaybeModal from './CallMeMaybeModal';
import styles from '../assets/styles/blink/_NavigationBar.scss';
const blinkLogo = require('../assets/images/blink-white-big.png');

class NavigationBar extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            showAboutModal: false,
            showCallMeMaybeModal: false,
            registrationState: this.props.registrationState,
            connection: this.props.connection,
            mute: false,
            menuVisible: false,
            accountId: this.props.account ? this.props.account.id : null
        }

        this.menuRef = React.createRef();
    }

    //getDerivedStateFromProps(nextProps, state) {
    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.account !== null && nextProps.account.id !== this.state.accountId) {
            this.setState({accountId: nextProps.account.id});
        }

        this.setState({registrationState: nextProps.registrationState,
                       connection: nextProps.connection});
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
            case 'logOut':
                this.props.logout();
                break;
            case 'preview':
                this.props.preview();
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

    toggleCallMeMaybeModal() {
        this.setState({showCallMeMaybeModal: !this.state.showCallMeMaybeModal});
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

        return (
            <Appbar.Header style={{backgroundColor: 'black'}}>
                <Image source={blinkLogo} style={styles.logo}/>
                <Appbar.Content
                    title="Sylk"
                    titleStyle={titleStyle}
                    subtitleStyle={subtitleStyle}
                    subtitle={this.props.isTablet? null: this.state.accountId}
                />
                {this.props.isTablet?
                <Text style={subtitleStyle}>{subtitle}</Text>
                : null}


                {statusIcon ?
                    <Icon name={statusIcon} size={20} color={statusColor} />
                : null }
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
                    <Divider />
                    <Menu.Item onPress={() => this.handleMenu('about')} icon="information" title="About Sylk" />
                    <Menu.Item onPress={() => this.handleMenu('preview')} icon="video" title="Video preview" />
                    <Menu.Item onPress={() => this.handleMenu('callMeMaybe')} icon="share" title="Call me, maybe?" />
                    <Menu.Item onPress={() => this.handleMenu('settings')} icon="wrench" title="Server settings" />
                    <Menu.Item onPress={() => this.handleMenu('logOut')} icon="logout" title="Sign out" />
                </Menu>

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
            </Appbar.Header>
        );
    }
}

NavigationBar.propTypes = {
    notificationCenter : PropTypes.func.isRequired,
    logout             : PropTypes.func.isRequired,
    preview            : PropTypes.func.isRequired,
    account            : PropTypes.object,
    connection         : PropTypes.object,
    toggleMute         : PropTypes.func,
    orientation        : PropTypes.string,
    isTablet           : PropTypes.bool
};

export default NavigationBar;
