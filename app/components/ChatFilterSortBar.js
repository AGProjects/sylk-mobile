import React, { useRef } from 'react';
import PropTypes from 'prop-types';
import { View, FlatList } from 'react-native';

// ChatFilterSortBar — the filter-chips + sort-toggles row that renders at the
// top of the chat view (i.e. when a contact is selected and showCategoryBar is
// on). Extracted from ReadyBox.render.
//
//   • Left  (flex: 1) — message-category filter chips, in a horizontal
//     FlatList so they scroll when they outgrow the width.
//   • Right (auto)    — sort toggles, rendered inline and pinned to the right
//     edge behind a subtle tint so they never scroll out of view.
//
// Item rendering (`renderItem`) stays in ReadyBox since it's bound to its
// state/handlers; this component owns only the layout and the filter list's
// scroll-recovery. Renders null when not visible.
function ChatFilterSortBar(props) {
    const {
        visible,
        hasSelectedContact,
        navigationContainerStyle,
        contentContainerStyle,
        filterItems,
        sortItems,
        extraData,
        keyExtractor,
        renderItem,
    } = props;

    const filterListRef = useRef(null);

    if (!visible) {
        return null;
    }

    const handleScrollToIndexFailed = (info) => {
        const wait = new Promise((resolve) => setTimeout(resolve, 10));
        wait.then(() => {
            // Preserves the original guard: the recovery only runs in the
            // contacts-list view (no selected contact). In the chat view this
            // is intentionally a no-op.
            if (!hasSelectedContact
                && filterListRef.current
                && filterItems
                && info.index < filterItems.length) {
                try {
                    filterListRef.current.scrollToIndex({ index: info.index, animated: false });
                } catch (e) {}
            }
        });
    };

    return (
        <View style={[navigationContainerStyle, { flexDirection: 'row', alignItems: 'center' }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
                <FlatList
                    contentContainerStyle={contentContainerStyle}
                    horizontal={true}
                    showsHorizontalScrollIndicator={false}
                    ref={(ref) => { filterListRef.current = ref; }}
                    onScrollToIndexFailed={handleScrollToIndexFailed}
                    data={filterItems}
                    extraData={extraData}
                    keyExtractor={keyExtractor}
                    renderItem={renderItem}
                />
            </View>
            {/* Right group ("Sort"). A subtle background tint behind the
                cluster gives the row a second visual cue (icon-only on the
                left, soft-tinted on the right) so the user can tell the two
                groups apart at a glance even before reading the icons. */}
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: 'rgba(0,0,0,0.04)',
                borderRadius: 6,
                paddingHorizontal: 2,
            }}>
                {sortItems.map((item, index) => renderItem({ item, index }))}
            </View>
        </View>
    );
}

ChatFilterSortBar.propTypes = {
    visible: PropTypes.bool,
    hasSelectedContact: PropTypes.bool,
    navigationContainerStyle: PropTypes.any,
    contentContainerStyle: PropTypes.any,
    filterItems: PropTypes.array,
    sortItems: PropTypes.array,
    extraData: PropTypes.any,
    keyExtractor: PropTypes.func,
    renderItem: PropTypes.func,
};

export default ChatFilterSortBar;
