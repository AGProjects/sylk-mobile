import React from 'react';
import PropTypes from 'prop-types';
import { View, StyleSheet } from 'react-native';

import URIInput from './URIInput';
import { DTMFPad } from './DTMFModal';

// SearchBar — the URI/search input row plus its optional expanded dialpad.
// ReadyBox renders this in two positions that were previously copy-pasted:
//   • normal contact/message search (above the call-button bar), and
//   • the relocated invite/share picker (glued to the top of the contacts
//     list, with Cancel/Invite overlays).
// The structure (a URIContainer View wrapping <URIInput> and, when expanded, a
// <DTMFPad>) is identical; only the prop set differs. Both call sites now pass
// their computed props into this one component. Visibility + position stay in
// ReadyBox (the two placements are mutually exclusive).
function SearchBar(props) {
    const {
        containerStyle,
        // URIInput passthrough
        defaultValue,
        onChange,
        onSelect,
        shareToContacts,
        inviteContacts,
        searchMessages,
        contactSource,
        showDialpad,
        isDialpadActive,
        onDialpadPress,
        dark,
        autoFocus,
        // normal-mode only
        onCloseSearch,
        showQr,
        onQrPress,
        // invite-mode only
        inviteEnabled,
        onInvitePress,
        onCancelInvitePress,
        // expanded dialpad
        showDialpadExpansion,
        onDialpadDigit,
        onDialpadBackspace,
        onDialpadClear,
    } = props;

    return (
        <View style={containerStyle}>
            <URIInput
                defaultValue={defaultValue}
                onChange={onChange}
                onSelect={onSelect}
                shareToContacts={shareToContacts}
                inviteContacts={inviteContacts}
                searchMessages={searchMessages}
                contactSource={contactSource}
                onCloseSearch={onCloseSearch}
                showDialpad={showDialpad}
                isDialpadActive={isDialpadActive}
                onDialpadPress={onDialpadPress}
                showQr={showQr}
                onQrPress={onQrPress}
                autoFocus={autoFocus}
                dark={dark}
                inviteEnabled={inviteEnabled}
                onInvitePress={onInvitePress}
                onCancelInvitePress={onCancelInvitePress}
            />
            {showDialpadExpansion ? (
                <View style={searchBarStyles.dialpadWrap}>
                    {/* Full-size keys (no `compact`) so the pad reads like a
                        real phone keypad. `extraColumn` adds a 4th column
                        (backspace, -, _) tailored to SIP user-part entry. */}
                    <DTMFPad
                        onDigit={onDialpadDigit}
                        extraColumn={true}
                        onBackspace={onDialpadBackspace}
                        onClear={onDialpadClear}
                    />
                </View>
            ) : null}
        </View>
    );
}

SearchBar.propTypes = {
    containerStyle: PropTypes.any,
    defaultValue: PropTypes.string,
    onChange: PropTypes.func,
    onSelect: PropTypes.func,
    shareToContacts: PropTypes.bool,
    inviteContacts: PropTypes.bool,
    searchMessages: PropTypes.bool,
    contactSource: PropTypes.string,
    showDialpad: PropTypes.bool,
    isDialpadActive: PropTypes.bool,
    onDialpadPress: PropTypes.func,
    dark: PropTypes.bool,
    autoFocus: PropTypes.bool,
    onCloseSearch: PropTypes.func,
    showQr: PropTypes.bool,
    onQrPress: PropTypes.func,
    inviteEnabled: PropTypes.bool,
    onInvitePress: PropTypes.func,
    onCancelInvitePress: PropTypes.func,
    showDialpadExpansion: PropTypes.bool,
    onDialpadDigit: PropTypes.func,
    onDialpadBackspace: PropTypes.func,
    onDialpadClear: PropTypes.func,
};

const searchBarStyles = StyleSheet.create({
    dialpadWrap: {
        marginTop: 6,
        paddingVertical: 4,
        // A faint divider/background separates the dialpad from the contact
        // list immediately below it, so the keypad doesn't feel like it's
        // floating over rows.
        backgroundColor: 'rgba(0,0,0,0.03)',
        borderRadius: 12,
    },
});

export default SearchBar;
