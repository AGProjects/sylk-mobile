import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import utils from '../utils';
import { Text, View, Platform } from 'react-native'
import { Avatar} from 'react-native-paper';
import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  avatarLabelAndroid: {
    marginTop: -3,
    marginLeft: 0,
  },

  avatarLabeliOS: {
    marginTop: 0,
    marginLeft: 0,
  },
});


const UserIcon = (props) => {
    // Per-photo load-failure flag. When an Avatar.Image errors (404,
    // broken URI, expired data: URL, corrupted bytes), we used to be
    // stuck rendering the empty grey circle Paper draws by default —
    // no initials, no icon, no signal that anything went wrong. The
    // user reported a few contacts ending up like this. We now flip
    // this flag from the Image's onError callback and re-render the
    // initials / icon path below as a fallback.
    const [imageError, setImageError] = useState(false);

    // Reset the error flag whenever the photo URI changes — a fresh
    // photo deserves a fresh try, otherwise a previously-failed
    // contact could never recover after their photo gets updated.
    const photoUri = props.identity ? props.identity.photo : null;
    useEffect(() => {
        setImageError(false);
    }, [photoUri]);

    if (!props.identity) {
        return (null)
    }

    const name = props.identity.name || props.identity.uri;
    const photo = props.identity.photo;

    // Two-letter avatar label:
    //   • Multi-word name → first letter of the first two words
    //     ("John Smith" → "JS", "Mary Anne Doe" → "MA").
    //   • Single-word name → first two letters of that word
    //     ("Alex" → "AL", "Bo" → "BO"). Previously these collapsed
    //     to a single letter, which read as a stub next to all the
    //     two-letter avatars in the contacts list.
    //   • Single character → that one character (no padding).
    // Filter() drops empty fragments from runs of whitespace so
    // "  John   Smith" still yields "JS".
    let initials = '';

    if (name) {
        const parts = name.trim().split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            initials = parts[0][0] + parts[1][0];
        } else if (parts.length === 1) {
            initials = parts[0].substring(0, 2);
        }
    }

    const color = utils.generateMaterialColor(props.identity.uri)['300'];

    let avatarSize = props.size || 50;

    if (photo && !imageError) {
         return (
           <Avatar.Image
                source={{uri: photo}}
                size={avatarSize}
                style={styles.avatar}
                onError={() => {
                    console.log('[UserIcon] photo load failed for',
                        props.identity.uri, '— falling back to initials');
                    setImageError(true);
                }}
           />
                );
    }

    if (props.identity.uri && props.identity.uri.search('anonymous') !== -1) {
         return (
            <Avatar.Icon style={{backgroundColor: color}, styles.avatar} size={avatarSize} icon="account" />
                );
    }

    if (props.identity.uri && props.identity.uri.search('videoconference') !== -1) {
         return (
            <Avatar.Icon style={{backgroundColor: color}} size={avatarSize} icon="account-group" />
                );
    }

    let lableStyle = Platform.OS === 'android' ? styles.avatarLabelAndroid : styles.avatarLabeliOS;

    // No initials to draw (contact has no name AND no usable URI
    // local-part) — instead of an empty coloured circle, render the
    // generic person icon so the user still sees that it's a
    // contact slot. Same backgroundColor as the initials path so
    // the visual treatment stays consistent.
    if (!initials || initials.trim().length === 0) {
        return (
            <Avatar.Icon style={{backgroundColor: color}} size={avatarSize} icon="account" />
        );
    }

    return (
        <Avatar.Text labelStyle={lableStyle} style={[{backgroundColor: color}]} size={avatarSize} label={initials.toUpperCase()} />
            );
};

UserIcon.propTypes = {
    identity: PropTypes.object.isRequired,
    large: PropTypes.bool,
    size: PropTypes.number
};

export default UserIcon;
