import React, { Component } from 'react';
import { Linking, Image, View } from 'react-native';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Appbar, Menu, Divider, Text } from 'react-native-paper';
import { Icon } from 'material-bread';

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
            mute: false,
            menuVisible: false
        }

        if (props.account) {
            this.callUrl = `${config.publicUrl}/call/${props.account.id}`;
        } else {
            this.callUrl = '';
        }

        this.menuRef = React.createRef();
    }

    handleMenu(event) {
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

        let statusIcon = null;

        statusIcon = 'check-circle';
        if (!this.props.connection || this.props.connection.state !== 'ready') {
            statusIcon = 'error-outline';
        } else if (this.props.registrationState && this.props.registrationState !== 'registered') {
            statusIcon = 'priority-high';
        }
//             <Appbar.Action icon={muteIcon} onPress={this.toggleMute} />
        return (
            <Appbar.Header style={{backgroundColor: 'black'}}>
                <Image source={blinkLogo} style={styles.logo}/>
                <Appbar.Content
                    title="Sylk"
                    subtitle={`Account: ${this.props.account.id}`}
                />
                {statusIcon ?
                    <Icon name={statusIcon} size={20} color="white" />
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
                    <Menu.Item onPress={() => this.handleMenu('callMeMaybe')} icon="share" title="Call me, maybe?" />
                    <Menu.Item onPress={() => this.handleMenu('preview')} icon="video" title="Video devices" />
                    <Menu.Item onPress={() => this.handleMenu('settings')} icon="wrench" title="Server settings" />
                    <Menu.Item onPress={() => this.handleMenu('logOut')} icon="logout" title="Sign Out" />
                </Menu>

                <AboutModal
                    show={this.state.showAboutModal}
                    close={this.toggleAboutModal}
                />
                <CallMeMaybeModal
                    show={this.state.showCallMeMaybeModal}
                    close={this.toggleCallMeMaybeModal}
                    callUrl={this.callUrl}
                    notificationCenter={this.props.notificationCenter}
                />
            </Appbar.Header>
        );
    }
}

NavigationBar.propTypes = {
    notificationCenter : PropTypes.func.isRequired,
    account            : PropTypes.object.isRequired,
    logout             : PropTypes.func.isRequired,
    preview            : PropTypes.func.isRequired,
    toggleMute         : PropTypes.func.isRequired
};

export default NavigationBar;
