import React from 'react';
import PropTypes from 'prop-types';
import { Drawer, SheetSide } from 'material-bread';

// const styleSheet = {
//     paper: {
//         width: 350,
//         backgroundColor: Grey[100],
//         borderLeft: '1px solid rgba(0, 0, 0, 0.12)',
//         borderRight: 0
//     },
//     title: {
//         flex: '0 1 auto'
//     },
//     grow: {
//         flex: '1 1 auto'
//     },
//     toolbar: {
//         minHeight: '50px',
//         height: 50
//     }
// };

const ConferenceDrawer = (props) => {
    return (
        <SheetSide
            visible={props.show}
            onBackdropPress={props.close}
        >
            {props.children}
        </SheetSide>
    );
}

ConferenceDrawer.propTypes = {
    show        : PropTypes.bool.isRequired,
    close       : PropTypes.func.isRequired,
    children    : PropTypes.node
};

export default ConferenceDrawer;
