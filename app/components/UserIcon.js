import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import utils from '../utils';
import { Text, View } from 'react-native'
import { Avatar, Badge, withBadge } from 'react-native-paper';
import BadgeView from 'react-native-badge-view';

const UserIcon = (props) => {

    if (!props.identity) {
        return (null)
    }
    const name = props.identity.displayName || props.identity.uri;
    const photo = props.identity.photo;

    let initials = '';
    if (name) {
        initials = name.split(' ', 2).map(x => x[0]).join('');
    }

    const color = utils.generateMaterialColor(props.identity.uri)['300'];
    let avatarSize = props.large ? 130: 55;
    if (props.carousel === true) {
        avatarSize = 70;
    }

    if (photo) {
         return (
            <BadgeView parentView={<Avatar.Image source={{uri: photo}} size={avatarSize} />}
                       badgeText={props.unread}/>
                );
    }

    if (props.identity.uri && props.identity.uri.search('anonymous') !== -1) {
         return (
            <BadgeView parentView={ <Avatar.Icon style={{backgroundColor: color}} size={avatarSize} icon="user" />}
                       badgeText={props.unread}/>
                );
    }

    if (props.identity.uri && props.identity.uri.search('videoconference') !== -1) {
         return (
            <BadgeView parentView={<Avatar.Icon style={{backgroundColor: color}} size={avatarSize} icon="account-group" />}
                       badgeText={props.unread}/>
                );
    }

    return (
        <BadgeView parentView={<Avatar.Text style={{backgroundColor: color}} size={avatarSize} label={initials.toUpperCase()} />}
                   badgeText={props.unread}/>
            );
};

UserIcon.propTypes = {
    identity: PropTypes.object.isRequired,
    large: PropTypes.bool,
    unread: PropTypes.string,
    carousel: PropTypes.bool
};


export default UserIcon;
