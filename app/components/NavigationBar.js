import React, { Component } from 'react';
import { Linking } from 'react-native';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Appbar, Menu, Divider } from 'react-native-paper';

import config from '../config';
import AboutModal from './AboutModal';
import CallMeMaybeModal from './CallMeMaybeModal';

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

        this.callUrl = `${config.publicUrl}/call/${props.account.id}`;

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
                Linking.openURL('https://mdns.sipthor.net/sip_settings.phtml');
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

        return (
            <Appbar.Header style={{backgroundColor: 'black'}}>
                <Appbar.Content
                    title="Sylk"
                    subtitle={`Signed in as: ${this.props.account.id}`}
                />
                <Appbar.Action icon={muteIcon} onPress={this.toggleMute} />
                <Menu
                    visible={this.state.menuVisible}
                    onDismiss={this._closeMenu}
                    anchor={<Appbar.Action ref={this.menuRef} color="white" icon="menu" onPress={() => this.setState({menuVisible: !this.state.menuVisible})} />}
                >
                    <Menu.Item icon="account" title={this.props.account.id} />
                    <Divider />
                    <Menu.Item onPress={() => this.handleMenu('about')} icon="information" title="About Sylk" />
                    <Menu.Item onPress={() => this.handleMenu('callMeMaybe')} icon="share" title="Call me, maybe?" />
                    <Menu.Item onPress={() => this.handleMenu('preview')} icon="video" title="Video preview" />
                    <Menu.Item onPress={() => this.handleMenu('settings')} icon="wrench" title="Server account settings" />
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
