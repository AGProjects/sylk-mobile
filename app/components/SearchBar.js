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
        onSearchFocus,
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
                onSearchFocus={onSearchFocus}
                showDialpad={showDialpad}
                isDialpadActive={isDialpadActive}
                onDialpadPress={onDialpadPress}
                onBackspace={onDialpadBackspace}
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
                        real phone keypad — a standard 3×4 grid. Backspace
                        lives in the search bar itself (URIInput renders it
                        to the left of the clear-× while the pad is open).
                        `dark` keeps the text-only keys visible on dark
                        theme backgrounds. */}
                    <DTMFPad
                        onDigit={onDialpadDigit}
                        dark={dark}
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
};

const searchBarStyles = StyleSheet.create({
    dialpadWrap: {
        // Glued flush to the search bar — the 6px marginTop that used
        // to sit here left a visible gap (and let the bar's shadow
        // show through) between the search bar and the pad. The faint
        // gray wash + rounded corners this wrapper used to paint are
        // gone too: with text-only keys the pad sits directly on the
        // screen background, one flat view. Zero padding as well — the
        // sliver of wrapper peeking out above the grid ("the green one
        // is like 2px higher") was this wrapper's own top padding; the
        // grid rows carry their own vertical margins already.
        marginTop: 0,
        paddingVertical: 0,
    },
});

export default SearchBar;
