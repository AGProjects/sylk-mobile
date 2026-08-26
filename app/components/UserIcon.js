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

    // Phone numbers get the LAST two digits instead of the first two
    // characters. Running the rule above on '+31641372960' produced '+3'
    // for every Dutch number in the list — same badge, same generated
    // colour bucket neighbours, nothing to tell them apart. The tail
    // digits vary per subscriber: +31641372960 -> '60',
    // +31641371120 -> '20'.
    //
    // Only when there is no real name to use. A contact may carry no name
    // at all, or a "name" that is just the URI or the number echoed back —
    // addHistoryEntry auto-creates contacts for calls to unknown numbers,
    // and older rows stored the URI as the display name (saveContactByUser
    // now refuses to, but the existing rows are still out there).
    const _uri = props.identity.uri || '';
    const _rawName = (props.identity.name || '').trim();
    const _uriLocal = _uri.indexOf('@') > -1 ? _uri.split('@')[0] : _uri;
    const _hasRealName = !!_rawName
        && _rawName.toLowerCase() !== _uri.trim().toLowerCase()
        && _rawName.toLowerCase() !== _uriLocal.trim().toLowerCase()
        && !utils.isPhoneNumber(_rawName);

    const _phoneLabel = _hasRealName ? null : utils.phoneAvatarLabel(_uri);

    if (_phoneLabel) {
        initials = _phoneLabel;
    } else if (name) {
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

    if (utils.isAnonymous(props.identity.uri)) {
         // The collapsed "Unknown caller" contact gets a distinctive
         // masked-thief avatar so anonymous/guest callers are instantly
         // recognisable in the list and chat header, rather than sharing
         // the generic person glyph with nameless contacts.
         return (
            <Avatar.Icon style={[{backgroundColor: color}, styles.avatar]} size={avatarSize} icon="robber" />
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
