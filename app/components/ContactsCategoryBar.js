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

    // The bar collapses to just All·Deleted·Graveyard ONLY while the user is
    // inside the Deleted / Graveyard view; every other filter shows the full
    // category set. So the ONLY filter transition that changes the bar's
    // composition (and needs a remount to re-measure) is entering/leaving that
    // collapsed mode. Keying on this boolean instead of the raw filter means
    // ordinary category selections (Recent → Messages → Calls → …) DON'T
    // remount the FlatList, so its horizontal scroll position is preserved —
    // the bar only moves when the user swipes it. (Keying on contactsFilter
    // directly made every tap remount the list and snap the scroll back to
    // the first pill.)
    const collapsedMode = (contactsFilter === 'deleted' || contactsFilter === 'graveyard')
        ? 'del' : 'full';
    const remountKey =
        'recents-' + (isFolded ? 'f' : 'u')
        + '-' + (orientation || '?')
        + '-' + Math.round(width) + 'x' + Math.round(height)
        + '-' + collapsedMode;

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
            // Bar height — the recents bar at the BOTTOM of the contacts list
            // now hosts Telegram-style category tabs: a stacked icon (24dp on
            // a 30dp rounded highlight) with a 11dp label underneath. That
            // stack needs ~50dp, so the bar is sized to 58dp to wrap it with a
            // small gap top/bottom. (It used to be 34dp back when the row held
            // bare IconButtons with no caption stack.) We also zero out
            // navigationContainer's inherited `minHeight: 50` and
            // `paddingBottom` so nothing adds phantom margin under the tabs.
            //
            // `paddingTop` adds a few px of air ABOVE the icons (gap from the
            // contacts list). The bar itself stays flush against the bottom
            // edge (Android navigation bar) — no marginBottom — so it doesn't
            // float above the system nav bar.
            style={[navigationContainerStyle, { height: 58, minHeight: 0, paddingTop: 6, paddingBottom: 0 }]}
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
