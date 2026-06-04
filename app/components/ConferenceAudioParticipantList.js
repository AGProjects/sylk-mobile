import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import { View, StyleSheet } from 'react-native';
import { Title } from 'react-native-paper';
import { ListItem } from 'react-native-elements'
import styles from '../assets/styles/blink/_ConferenceAudioParticipant.scss';


// Renders the pre-built ConferenceAudioParticipant tiles passed in as
// children. This used to be a FlatList, but ConferenceBox already wraps
// the audio view in a vertical ScrollView (sibling SIP / invited tile
// groups need to scroll together with the participant list). Nesting a
// FlatList inside a same-orientation ScrollView trips React Native's
// "VirtualizedLists should never be nested..." warning and disables
// windowing, so the FlatList wasn't buying us virtualization anyway —
// flexGrow:0 made it size to content and render every row inline. A
// plain View with React.Children.map gives identical visual output and
// keeps the per-tile key behavior that the old keyExtractor provided.
//
// In landscape we render the tiles as a 2-column grid (flex-row +
// flex-wrap, each child wrapped in a width:50% cell). A sideways phone
// has plenty of horizontal room but very little vertical room, so a
// single column of full-width tiles only fits ~2 rows before the chat
// gets shoved off-screen. Two columns doubles the tile count visible
// at a glance and matches the matrix-view density users already see in
// the video conference layout.
// Tile-cell border colour + width for the landscape 2-column grid.
// First version used StyleSheet.hairlineWidth + 0.12 alpha which read
// as no visible border on most screens (1 physical pixel against a
// near-uniform dark background washes out). Bumped to 1.5 dp + 0.35
// alpha so the row/column rules actually delineate the tiles.
const TILE_BORDER_COLOR = 'rgba(255,255,255,0.35)';
const TILE_BORDER_WIDTH = 1.5;

const ConferenceAudioParticipantList = props => {
    const isLandscape = !!props.isLandscape;

    const containerStyle = isLandscape
        ? {flexGrow: 0, flexDirection: 'row', flexWrap: 'wrap'}
        : {flexGrow: 0};

    // Pre-compute how many valid children we have so the last-row
    // cells can drop their bottom border (mirrors how a CSS table
    // doesn't paint a trailing horizontal rule). Only matters for
    // landscape — portrait mode renders tiles full-width, no grid.
    const validChildren = React.Children.toArray(props.children).filter(React.isValidElement);
    const totalTiles = validChildren.length;
    const rowsCount = Math.ceil(totalTiles / 2);

    return (
        <Fragment>
            <View style={containerStyle}>
                {React.Children.map(props.children, (child, index) => {
                    if (!React.isValidElement(child)) {
                        return child;
                    }
                    const key =
                        child.props?.identity?.uri?.toString() ||
                        child.key ||
                        index.toString();
                    const tile = React.cloneElement(child, { key });
                    if (!isLandscape) {
                        return tile;
                    }
                    // Wrap each tile in a half-width cell so the
                    // grid lays out as 2 columns. The cell key is
                    // what React uses for reconciliation in the
                    // wrapping View, so reuse the same per-tile key
                    // we computed above.
                    //
                    // Cell borders draw the 2-column grid as a
                    // visual table:
                    //   • right border on the LEFT column only
                    //     (even index) — the column divider
                    //   • bottom border on every row EXCEPT the
                    //     last — the row divider
                    // Using hairlineWidth (1 physical pixel on
                    // hi-DPI screens) keeps the dividers crisp but
                    // unobtrusive, matching the rest of the call
                    // UI's understated chrome.
                    const isLeftColumn = (index % 2) === 0;
                    const rowIdx = Math.floor(index / 2);
                    const isLastRow = rowIdx === (rowsCount - 1);
                    const cellStyle = {
                        width: '50%',
                        borderRightWidth: isLeftColumn ? TILE_BORDER_WIDTH : 0,
                        borderBottomWidth: isLastRow ? 0 : TILE_BORDER_WIDTH,
                        borderColor: TILE_BORDER_COLOR,
                    };
                    return (
                        <View key={key} style={cellStyle}>
                            {tile}
                        </View>
                    );
                })}
            </View>
        </Fragment>
    );
};

ConferenceAudioParticipantList.propTypes = {
    children: PropTypes.node,
    isLandscape: PropTypes.bool
};

export default ConferenceAudioParticipantList;
