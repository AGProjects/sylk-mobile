import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import utils from '../utils';
import { Text, View } from 'react-native'
import { Avatar} from 'react-native-paper';
import styles from '../assets/styles/blink/_Avatar.scss';

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

    let avatarSize = props.size || 50;

    if (photo) {
         return (
           <Avatar.Image source={{uri: photo}} size={avatarSize} style={styles.avatar}/>
                );
    }

    if (props.identity.uri && props.identity.uri.search('anonymous') !== -1) {
         return (
            <Avatar.Icon style={{backgroundColor: color}, styles.avatar} size={avatarSize} icon="user" />
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
    size: PropTypes.bool
};

export default UserIcon;
