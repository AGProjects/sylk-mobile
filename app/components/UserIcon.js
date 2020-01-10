import React from'react';
import PropTypes from 'prop-types';
import utils from '../utils';
import { Avatar } from 'react-native-paper';

import classNames from 'classnames';

// const styleSheet = {
//     root: {
//         transition: 'box-shadow 0.3s'
//     },
//     drawerAvatar: {
//         fontFamily: 'Helvetica Neue ,Helvetica, Arial, sans-serif',
//         textTransform: 'uppercase'
//     },
//     card: {
//         width: '70px',
//         height: '70px',
//         fontSize: '2.5rem',
//         margin: '10px'
//     },
//     large: {
//         width: '144px',
//         height: '144px',
//         fontSize: '5rem',
//         margin: 'auto'
//     },
//     shadow: {
//         boxShadow: '0 0 10px 2px #999'
//     }
// };

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
        <Avatar.Text style={{backgroundColor: color}} label={initials} />
    );
};

UserIcon.propTypes = {
    classes: PropTypes.object.isRequired,
    identity: PropTypes.object.isRequired,
    large: PropTypes.bool,
    card: PropTypes.bool,
    active: PropTypes.bool
};


export default UserIcon;
