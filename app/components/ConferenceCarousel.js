// Plain horizontal FlatList replacement for the dead, locally-patched
// react-native-snap-carousel (2026-07-23). Same component API (children +
// align) so ConferenceBox is unchanged.
//
// The old usage was a simple fixed-width (125 px) horizontal snapping strip of
// participant thumbnails — no pagination, autoplay, parallax, or programmatic
// scroll (the old carousel ref was stored but never used) — so a FlatList with
// snapToInterval covers it exactly, without pulling in react-native-reanimated
// (not a dependency here) that react-native-reanimated-carousel would require.
//
// Prop mapping from the old <Carousel>:
//   data={children}, renderItem=item          → FlatList data/renderItem (each
//                                                item wrapped to itemWidth/Height)
//   itemWidth=125                              → snapToInterval + item width
//   inverted={true}                            → FlatList `inverted`
//   activeSlideAlignment 'start'|'center'      → start (align==='right') vs centered
//   sliderWidth={window - 20}                  → FlatList container width
//   lockScrollWhileSnapping                    → decelerationRate="fast" +
//                                                disableIntervalMomentum
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { View, Dimensions, FlatList } from 'react-native';

const ITEM_WIDTH = 125;
const ITEM_HEIGHT = 90;

class ConferenceCarousel extends Component {
    render() {
        const margin = 20;
        const width = Dimensions.get('window').width - margin;
        const items = React.Children.toArray(this.props.children);
        const alignStart = this.props.align === 'right';

        return (
            <FlatList
                style={{ width }}
                data={items}
                horizontal
                inverted
                keyExtractor={(item, index) =>
                    (item && item.key != null ? String(item.key) : String(index))}
                renderItem={({ item }) => (
                    <View style={{ width: ITEM_WIDTH, height: ITEM_HEIGHT }}>
                        {item}
                    </View>
                )}
                snapToInterval={ITEM_WIDTH}
                decelerationRate="fast"
                disableIntervalMomentum={true}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={
                    alignStart ? undefined : { flexGrow: 1, justifyContent: 'center' }
                }
            />
        );
    }
}

ConferenceCarousel.propTypes = {
    children: PropTypes.node,
    align: PropTypes.string,
};

export default ConferenceCarousel;
