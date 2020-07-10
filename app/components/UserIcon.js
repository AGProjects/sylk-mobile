import React, { useEffect, useState } from'react';
import PropTypes from 'prop-types';
import utils from '../utils';
import { Avatar } from 'react-native-paper';

const UserIcon = (props) => {
    const [photo, setPhoto] = useState('');

    useEffect(() => {
        // You need to restrict it at some point
        // This is just dummy code and should be replaced by actual
        if (!photo && props.identity.uri) {
            getPhoto();
        }
    }, []);

    const getPhoto = async () => {
        try {
            let contacts = await utils.findContact(props.identity.uri);
            contacts.some((contact) => {
                if (contact.hasThumbnail) {
                    setPhoto(contact.thumbnailPath);
                    return true;
                }
            });
        } catch (err) {
            console.log('error getting contacts', err);
        }
    }

    const name = props.identity.displayName || props.identity.uri;
    let initials = name.split(' ', 2).map(x => x[0]).join('');
    const color = utils.generateMaterialColor(props.identity.uri)['300'];
    const avatarSize = props.large ? 120: 60;

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
    large: PropTypes.bool,
    card: PropTypes.bool,
    active: PropTypes.bool
};


export default UserIcon;
