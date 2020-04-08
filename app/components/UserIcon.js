import React from'react';
import PropTypes from 'prop-types';
import utils from '../utils';
import { Avatar } from 'react-native-paper';

const UserIcon = (props) => {
    const name = props.identity.displayName || props.identity.uri;
    let initials = name.split(' ', 2).map(x => x[0]).join('');
    const color = utils.generateMaterialColor(props.identity.uri)['300'];

    if (props.identity.uri === 'anonymous@anonymous.invalid') {
        return (
            <Avatar.Icon style={{backgroundColor: color}} icon="user" />
        )
    }

    return (
        <Avatar.Text style={{backgroundColor: color}} label={initials.toUpperCase()} />
    );
};

UserIcon.propTypes = {
    identity: PropTypes.object.isRequired,
    large: PropTypes.bool,
    card: PropTypes.bool,
    active: PropTypes.bool
};


export default UserIcon;
