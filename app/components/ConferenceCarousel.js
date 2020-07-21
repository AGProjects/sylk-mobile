import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { View, Dimensions } from 'react-native';
import Carousel from 'react-native-snap-carousel';

import styles from '../assets/styles/blink/_ConferenceCarousel.scss';


class ConferenceCarousel extends Component {
    constructor(props) {
        super(props);
    }

    render() {
        const margin = 20;
        const width = Dimensions.get('window')['width'] - margin;
        return (
            <Carousel
                ref={(c) => { this._carousel = c; }}
                data={this.props.children}
                renderItem={({item}) => {
                    //add in some styles on the View
                    return item;
                }}
                lockScrollWhileSnapping={true}
                sliderWidth={width}
                activeSlideAlignment={this.props.align === 'right' ? 'start' : 'center'}
                itemWidth={125}
                itemHeight={90}
                inverted={true}
            />
        );
    }
}

ConferenceCarousel.propTypes = {
    children: PropTypes.node,
    align: PropTypes.string
};


export default ConferenceCarousel;
