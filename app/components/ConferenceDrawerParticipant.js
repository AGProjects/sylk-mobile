import React from 'react';
import PropTypes from 'prop-types';

import UserIcon from './UserIcon';

const ConferenceDrawerParticipant = (props) => {


    return null;

    // let tag = null
    // if (props.isLocal) {
    //     tag = <Label bsStyle="primary">Myself</Label>;
    // }

    // return (
    //     <Media className="text-left">
    //         <Media.Left>
    //             <UserIcon identity={props.participant.identity} />
    //         </Media.Left>
    //         <Media.Body className="vertical-center">
    //             <Media.Heading>{props.participant.identity.displayName || props.participant.identity.uri}</Media.Heading>
    //         </Media.Body>
    //         <Media.Right className="vertical-center">
    //             {tag}
    //         </Media.Right>
    //     </Media>
    // );

}

ConferenceDrawerParticipant.propTypes = {
    participant: PropTypes.object.isRequired,
    isLocal: PropTypes.bool
};


export default ConferenceDrawerParticipant;
