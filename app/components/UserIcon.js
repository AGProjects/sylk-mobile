import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import utils from '../utils';
import { Text, View } from 'react-native'
import { Avatar} from 'react-native-paper';

const UserIcon = (props) => {

    if (!props.identity) {
        return (null)
    }

    const name = props.identity.name || props.identity.uri;
    const photo = props.identity.photo;

    let initials = '';
    if (name) {
        initials = name.split(' ', 2).map(x => x[0]).join('');
    }

    const color = utils.generateMaterialColor(props.identity.uri)['300'];
    let avatarSize = props.large ? 130: 50;
    if (props.carousel === true) {
        avatarSize = 50;
    }

    if (props.small) {
        avatarSize = 40;
    }

    if (photo) {
         return (
           <Avatar.Image source={{uri: photo}} size={avatarSize} />
                );
    }

    if (props.identity.uri && props.identity.uri.search('anonymous') !== -1) {
         return (
            <Avatar.Icon style={{backgroundColor: color}} size={avatarSize} icon="user" />
                );
    }

    if (props.identity.uri && props.identity.uri.search('videoconference') !== -1) {
         return (
            <Avatar.Icon style={{backgroundColor: color}} size={avatarSize} icon="account-group" />
                );
    }

    return (
        <Avatar.Text style={{backgroundColor: color}} size={avatarSize} label={initials.toUpperCase()} />
            );
};

UserIcon.propTypes = {
    identity: PropTypes.object.isRequired,
    large: PropTypes.bool,
    carousel: PropTypes.bool
};


export default UserIcon;
