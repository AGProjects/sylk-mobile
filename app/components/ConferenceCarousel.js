import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View } from 'react-native';

import styles from '../assets/styles/blink/_ConferenceCarousel.scss';

class ConferenceCarousel extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            displayLeftArrow: false,
            displayRightArrow: false
        };

        this.carouselList = null;
    }

    componentDidMount() {
        // Get UL from children of the carousel
        // const children = this.refs.carousel.children;
        // for (let child of children) {
        //     if (child.tagName == 'UL') {
        //         this.carouselList = child;
        //     }
        // };

        if (this.canScroll()) {
            this.setState({displayRightArrow: true});   // eslint-disable-line react/no-did-mount-set-state
        }

        // window.addEventListener('resize', this.handleResize);
    }

    componentWillUnmount() {
        // window.removeEventListener('resize', this.handleResize);
    }

    componentDidUpdate(prevProps) {
        if (prevProps.children.length != this.props.children.length) {
            // We need to wait for the animation to end before calculating
            setTimeout(() => {
                this.handleScroll();
            }, 310);
        }
    }

    canScroll() {
        return false;
        //return (this.carouselList.scrollWidth > this.carouselList.clientWidth);
    }

    handleScroll(event) {
        const newState = {
            displayRightArrow : false,
            displayLeftArrow  : false
        };

        if (this.canScroll()) {
            const scrollWidth = this.carouselList.scrollWidth;
            const scrollLeft = this.carouselList.scrollLeft;
            const clientWidth = this.carouselList.clientWidth;
            newState.displayRightArrow = true;
            if (scrollLeft > 0) {
                newState.displayLeftArrow = true;
                if (scrollLeft === (scrollWidth - clientWidth)) {
                    newState.displayRightArrow = false;
                }
            } else {
                newState.displayLeftArrow = false;
            }
        }

        this.setState(newState);
    }

    scrollToRight(event) {
        this.carouselList.scrollLeft += 100;
    }

    scrollToLeft(event) {
        this.carouselList.scrollLeft -= 100;
    }

    handleResize(event) {
        if (this.canScroll()) {
            this.setState({displayRightArrow: true})
        } else {
            if (this.state.displayRightArrow) {
                this.setState({displayRightArrow: false});
            }
        }
    }

    render() {
        // const classes = classNames({
        //     'carousel-list' : true,
        //     'list-inline'   : true,
        //     'text-right'    : this.props.align === 'right'
        // });
        return (
            <View style={styles.container}>
                {this.props.children}
            </View>
        );
    }
}

ConferenceCarousel.propTypes = {
    children: PropTypes.node,
    align: PropTypes.string
};


module.exports = ConferenceCarousel;
