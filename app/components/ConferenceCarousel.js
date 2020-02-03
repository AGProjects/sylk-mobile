import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { View, Dimensions } from 'react-native';
import Carousel from 'react-native-snap-carousel';

import styles from '../assets/styles/blink/_ConferenceCarousel.scss';

let {height, width} = Dimensions.get('window');

class ConferenceCarousel extends Component {
    constructor(props) {
        super(props);
    }

    render() {
        return (
            <Carousel
                ref={(c) => { this._carousel = c; }}
                data={this.props.children}
                renderItem={({item}) => {
                    //add in some styles on the View
                    return (
                        <View>
                            { item }
                        </View>
                    );
                }}
                sliderWidth={width}
                itemWidth={100}
                itemHeight={100}
            />
        );
    }
}

ConferenceCarousel.propTypes = {
    children: PropTypes.node,
    align: PropTypes.string
};


export default ConferenceCarousel;
