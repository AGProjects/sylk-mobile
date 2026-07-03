import React, { useRef } from 'react';
import PropTypes from 'prop-types';
import { View, FlatList } from 'react-native';

// ContactsCategoryBar — the horizontal "recents" / category chip bar that sits
// at the BOTTOM of the contacts list (All, Business, …). Extracted from
// ReadyBox.render to keep that tree readable.
//
// This component owns the two fiddly, layout-specific concerns that cluttered
// the render site:
//   • the remount `key` — the bar must fully remount (not just re-render)
//     when the device folds/unfolds, rotates, the window is resized, or the
//     active category set changes size, because the Paper buttons inside cache
//     their measured frame at first mount. The key is derived from those
//     primitives so a change forces a fresh mount.
//   • scrollToIndexFailed recovery — retries the scroll on the next tick once
//     layout has settled.
//
// Item data (`data`) and item rendering (`renderItem`) stay in ReadyBox since
// they're bound to its state/handlers, and the underlying FlatList ref is
// forwarded back via `onListRef` so ReadyBox can still drive programmatic
// scrolling (scrollToIndex) from elsewhere.
function ContactsCategoryBar(props) {
    const {
        visible,
        isFolded,
        orientation,
        width,
        height,
        contactsFilter,
        navigationContainerStyle,
        contentContainerStyle,
        data,
        extraData,
        keyExtractor,
        renderItem,
        onListRef,
    } = props;

    const listRef = useRef(null);

    if (!visible) {
        return null;
    }

    const remountKey =
        'recents-' + (isFolded ? 'f' : 'u')
        + '-' + (orientation || '?')
        + '-' + Math.round(width) + 'x' + Math.round(height)
        // Include the active filter so the FlatList REMOUNTS when the category
        // set changes size (e.g. collapsing to All·Deleted·Graveyard in the
        // Deleted folder). Without this it keeps its stale scroll/layout from
        // the long bar and only the first pill ("All") shows.
        + '-' + (contactsFilter || 'none');

    const handleScrollToIndexFailed = (info) => {
        const wait = new Promise((resolve) => setTimeout(resolve, 10));
        wait.then(() => {
            if (listRef.current
                && data
                && info.index < data.length) {
                try {
                    listRef.current.scrollToIndex({ index: info.index, animated: false });
                } catch (e) {}
            }
        });
    };

    return (
        <View
            key={remountKey}
            // Override the shared bar height — the recents bar at the BOTTOM of
            // the contacts list hosts plain IconButtons (no caption stack
            // underneath) so it can sit much tighter than the top sort/category
            // bar. 34dp wraps the IconButton's ~32dp footprint with a hairline
            // gap top/bottom. We also zero out navigationContainer's inherited
            // `minHeight: 50` and `paddingBottom` here — those were leaving a
            // phantom bottom margin that pushed the icons up against the top
            // edge.
            style={[navigationContainerStyle, { height: 34, minHeight: 0, paddingBottom: 0 }]}
        >
            <FlatList
                contentContainerStyle={contentContainerStyle}
                horizontal={true}
                ref={(ref) => {
                    listRef.current = ref;
                    if (typeof onListRef === 'function') {
                        onListRef(ref);
                    }
                }}
                onScrollToIndexFailed={handleScrollToIndexFailed}
                data={data}
                extraData={extraData}
                keyExtractor={keyExtractor}
                renderItem={renderItem}
            />
        </View>
    );
}

ContactsCategoryBar.propTypes = {
    visible: PropTypes.bool,
    isFolded: PropTypes.bool,
    orientation: PropTypes.string,
    width: PropTypes.number,
    height: PropTypes.number,
    contactsFilter: PropTypes.string,
    navigationContainerStyle: PropTypes.any,
    contentContainerStyle: PropTypes.any,
    data: PropTypes.array,
    extraData: PropTypes.any,
    keyExtractor: PropTypes.func,
    renderItem: PropTypes.func,
    onListRef: PropTypes.func,
};

export default ContactsCategoryBar;
