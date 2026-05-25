import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import { View } from 'react-native';
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
const ConferenceAudioParticipantList = props => {
    const isLandscape = !!props.isLandscape;

    const containerStyle = isLandscape
        ? {flexGrow: 0, flexDirection: 'row', flexWrap: 'wrap'}
        : {flexGrow: 0};

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
                    return (
                        <View key={key} style={{width: '50%'}}>
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
