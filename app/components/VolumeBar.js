import React, { Component } from 'react';
import PropTypes from 'prop-types';
// const hark                  = require('hark');

import { ProgressBar, Colors } from 'react-native-paper';

// const styleSheet = {
//     colorSecondary: {
//         backgroundColor: Green[100]
//     },
//     barColorSecondary: {
//         backgroundColor: Green[500]
//     },
//     root: {
//         height: '10px',
//         opacity: '0.7'
//     },
//     bar1Determinate: {
//         transition: 'transform 0.2s linear'
//     }
// };

class VolumeBar extends Component {

  constructor(props) {
        super(props);
        this.speechEvents = null;
        this.state = {
            volume: 0
        }
    }

    componentDidMount() {
        // const options = {
        //     interval: 225,
        //     play: false
        // };
        // this.speechEvents = hark(this.props.localMedia, options);
        // this.speechEvents.on('volume_change', (vol, threshold) => {
        //     this.setState({volume: 2 * (vol + 75)});
        // });
    }

    componentDidUpdate(prevProps) {
        if (prevProps.localMedia !== this.props.localMedia) {
            // if (this.speechEvents !== null) {
            //     this.speechEvents.stop();
            //     this.speechEvents = null;
            // }
            // const options = {
            //     interval: 225,
            //     play: false
            // };
            // this.speechEvents = hark(this.props.localMedia, options);
            // this.speechEvents.on('volume_change', (vol, threshold) => {
            //     this.setState({volume: 2 * (vol + 75)});
            // });
        }
    }

    componentWillUnmount() {
        // if (this.speechEvents !== null) {
        //     this.speechEvents.stop();
        //     this.speechEvents = null;
        // }
    }

    render() {
        // let color = 'primary';
        // if (this.state.volume > 20) {
        //     color = 'secondary';
        // }

        return (
            <ProgressBar classes={this.props.classes} indeterminate={false} progress={this.state.volume} />
        );
    }
}

VolumeBar.propTypes = {
    localMedia: PropTypes.object.isRequired
};


export default VolumeBar;
