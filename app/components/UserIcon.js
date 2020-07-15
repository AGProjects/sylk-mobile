import React, { useEffect, useState } from'react';
import PropTypes from 'prop-types';
import utils from '../utils';
import { Avatar } from 'react-native-paper';

const UserIcon = (props) => {

    if (!props.identity) {
        return (null)
    }
    const name = props.identity.displayName || props.identity.uri;
    const photo = props.identity.photo;

    let initials = name.split(' ', 2).map(x => x[0]).join('');
    const color = utils.generateMaterialColor(props.identity.uri)['300'];
    const avatarSize = props.large ? 120: 50;


    if (photo) {
        return  <Avatar.Image source={{uri: photo}} size={avatarSize} />
    }

    if (props.identity.uri.search('anonymous') !== -1) {
        return (
            <Avatar.Icon style={{backgroundColor: color}} size={avatarSize} icon="user" />
        )
    }

    if (props.identity.uri.search('videoconference') !== -1) {
        return (
            <Avatar.Icon style={{backgroundColor: color}} size={avatarSize} icon="account-group" />
        )
    }

    return (
        <Avatar.Text style={{backgroundColor: color}} size={avatarSize} label={initials.toUpperCase()} />
    );
};

UserIcon.propTypes = {
    identity: PropTypes.object.isRequired,
    large: PropTypes.bool
};


export default UserIcon;
