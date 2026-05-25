import React from 'react';
import PropTypes from 'prop-types';
import { StyleSheet, View } from 'react-native';
import { Searchbar, IconButton } from 'react-native-paper';
import autoBind from 'auto-bind';

class URIInput extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            selecting: false,
            shareToContacts: this.props.shareToContacts,
            inviteContacts: this.props.inviteContacts,
            searchMessages: this.props.searchMessages,
            defaultValue: this.props.defaultValue,
            contactSource: this.props.contactSource || 'sylk',
        };

        this.uriInput = React.createRef();
        this.clicked = false;
    }

    componentDidMount() {
        if (this.props.autoFocus) {
            this.uriInput.current.focus();
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({
            shareToContacts: nextProps.shareToContacts,
            inviteContacts: nextProps.inviteContacts,
            searchMessages: nextProps.searchMessages,
            defaultValue: nextProps.defaultValue,
            contactSource: nextProps.contactSource || 'sylk',
        });
    }

    componentDidUpdate(prevProps) {
        if (prevProps.defaultValue !== this.props.defaultValue && this.props.autoFocus) {
            this.uriInput.current.focus();
        }
    }

    setValue(value) {
        this.props.onChange(value);
    }

    onInputChange(value) {
        this.setValue(value);
    }

    onInputClick(event) {
        if (!this.clicked) {
            this.uriInput.current.select();
            this.clicked = true;
        }
    }

    onInputKeyDown(event) {
        switch (event.which) {
            case 13:
                if (this.state.selecting) {
                    this.setState({ selecting: false });
                } else {
                    this.props.onSelect(event.target.value);
                }
                break;
            case 27:
                this.setState({ selecting: false });
                break;
            case 38:
            case 40:
                this.setState({ selecting: true });
                break;
            default:
                break;
        }
    }

    onInputBlur(event) {
        if (this.state.selecting) {
            this.setState({ selecting: false });
        }
        this.clicked = false;
    }

    render() {
        let placeholder = 'Search contacts';
        if (this.state.shareToContacts) placeholder = 'Select contacts to share...';
        if (this.state.inviteContacts) placeholder = 'Select contacts to invite...';
        if (this.state.searchMessages) placeholder = 'Search messages';

        // The Sylk / AddressBook source toggle now lives in the Sort/Order
        // row above the search bar. The placeholder still hints at which
        // source is active so the user gets feedback without looking up.
        const showSourceHint =
            !this.state.shareToContacts &&
            !this.state.inviteContacts &&
            !this.state.searchMessages;

        if (showSourceHint) {
            placeholder =
                this.state.contactSource === 'ab'
                    ? 'Search Tel'
                    : 'Search SIP contacts';
        }

        // Theme-aware colour set. Pulled to be explicit in BOTH
        // dark and light modes so we don't rely on Paper's default
        // theme resolution — the user reported the search bar fonts
        // not flipping correctly when the app theme changed, which
        // tracked back to the previous code only overriding colours
        // in the dark branch. The light branch now pins explicit
        // dark text / muted placeholder against the search-bar
        // background so the flip is symmetrical.
        //
        // Searchbar background is intentionally a *surface* tone
        // (one step off the page background), not the page
        // background itself. Day-theme body bg is #FFFFFF and
        // Night-theme body bg is #121212; matching either of those
        // here would render the search bar invisible against the
        // surrounding screen (white-on-white in Day, black-on-black
        // in Night), which is the regression the user reported as
        // "search contacts does not appear anymore" after the brand
        // strip / theming change. #F0F2F5 (Day) and #1F1F1F (Night)
        // give just enough contrast that the pill clearly reads as
        // an interactive control.
        const darkColors = this.props.dark
            ? {
                  backgroundColor: '#1F1F1F',
                  textColor: '#ffffff',
                  // Per user request: no gray icons inside the
                  // search bar — high-contrast black-or-white only.
                  iconColor: '#ffffff',
                  placeholderColor: '#aaaaaa',
              }
            : {
                  backgroundColor: '#F0F2F5',
                  textColor: '#111B21',
                  iconColor: '#000000',
                  placeholderColor: '#667781',
              };

        // Paper's built-in × clear sits at the right edge of the
        // bar, which is where we want the dialpad toggle to live
        // instead. Suppress it by returning null for the icon and
        // disabling the clear-button render path — we draw our own
        // × further down at right:48 (immediately to the LEFT of
        // the dialpad icon).
        const _suppressedClearIcon = () => null;

        return (
            <View style={uriInputStyles.searchbarRow}>
                <Searchbar
                    ref={this.uriInput}
                    mode="flat"
                    label="Enter address"
                    value={this.state.defaultValue}
                    placeholder={placeholder}
                    onChangeText={this.onInputChange}
                    onKeyDown={this.onInputKeyDown}
                    onBlur={this.onInputBlur}
                    onPress={this.onInputClick}
                    autoCapitalize="none"
                    autoCorrect={false}
                    clearIcon={_suppressedClearIcon}
                    showClearIcon={false}
                    autoFocus={this.props.autoFocus}
                    style={[
                        uriInputStyles.searchbar,
                        darkColors.backgroundColor
                            ? { backgroundColor: darkColors.backgroundColor }
                            : null,
                    ]}
                    inputStyle={[
                        uriInputStyles.searchbarInput,
                        darkColors.textColor ? { color: darkColors.textColor } : null,
                    ]}
                    iconColor={darkColors.iconColor}
                    placeholderTextColor={darkColors.placeholderColor}
                />
                {/* Custom × clear icon, overlaid INSIDE the search
                    bar at right:48 — i.e. immediately to the LEFT of
                    the dialpad toggle (which sits flush to the right
                    edge at right:4). Replaces Paper's built-in clear
                    button (suppressed via `clearIcon={() => null}`
                    above) so the right edge is reserved for the
                    dialpad and the × can sit beside it instead of
                    fighting for the same slot. Only rendered when
                    the field is non-empty — matches Paper's
                    auto-hide-when-empty behaviour. */}
                {this.state.defaultValue && this.state.defaultValue.length > 0 ? (
                    <IconButton
                        icon="close"
                        size={22}
                        onPress={() => this.props.onChange('')}
                        accessibilityLabel="Clear search"
                        style={[
                            uriInputStyles.clearOverlay,
                            // Shift the clear-× further left when other
                            // overlays occupy the right edge. The
                            // Invite button only renders once at least
                            // one contact is selected (inviteEnabled),
                            // so the layout collapses back to its
                            // smaller forms while nothing is picked:
                            //   invite + dialpad → 2 buttons to clear → right:108
                            //   invite alone    → 1 button to clear → right:56
                            //   dialpad alone   → 1 button to clear → right:48 (default)
                            //   nothing         → right:48 (default)
                            (this.state.inviteContacts && this.props.inviteEnabled && this.props.showDialpad)
                                ? uriInputStyles.clearOverlayInviteAndDialpadMode
                                : (this.state.inviteContacts && this.props.inviteEnabled)
                                    ? uriInputStyles.clearOverlayInviteMode
                                    : null,
                        ]}
                        iconColor={darkColors.iconColor}
                    />
                ) : null}
                {/* Dialpad toggle overlaid INSIDE the search bar,
                    always pinned flush against the right edge
                    (right:4). In invite mode the green Invite
                    (account-plus) button shifts LEFT to sit beside
                    the dialpad rather than the other way around —
                    keeps the dialpad in the consistent "tap the
                    rightmost icon" spot across normal and invite
                    flows. */}
                {this.props.showDialpad ? (
                    <IconButton
                        icon="dialpad"
                        size={22}
                        onPress={this.props.onDialpadPress}
                        accessibilityLabel={
                            this.props.isDialpadActive
                                ? 'Hide dialpad'
                                : 'Show dialpad'
                        }
                        style={[
                            uriInputStyles.dialpadOverlay,
                            this.props.isDialpadActive
                                ? uriInputStyles.dialpadOverlayActive
                                : null,
                        ]}
                        iconColor={
                            this.props.isDialpadActive
                                ? '#ffffff'
                                : '#27ae60'
                        }
                    />
                ) : null}
                {/* Invite-mode action pair: Cancel + Invite, overlaid
                    INSIDE the search bar at the right edge. Visible
                    only when inviteContacts is true (when the contacts
                    list is a participant picker for an ongoing
                    conference). Dialpad never renders in invite mode,
                    so they share the same right-edge real estate
                    without colliding. The × clear overlay sits to
                    their left (auto-hidden when the field is empty),
                    so order from right→left is: Invite, Cancel, ×. */}
                {/* Invite-mode action overlay. Only the green Invite
                    (account-plus) button is rendered inside the bar —
                    the Cancel × that used to sit beside it was removed
                    per user request. The search field's own clear-×
                    (above) still serves to clear typed input. Backing
                    out of invite mode entirely is handled by the
                    navbar back affordance / route navigation, so the
                    extra in-bar Cancel was redundant. */}
                {/* Invite (account-plus) button. Rendered only when
                    the user has actually selected at least one
                    contact (inviteEnabled). Until then there's
                    nothing to invite, so showing a disabled button
                    just adds visual clutter — hiding it also frees
                    up the right edge for the dialpad / clear-×. The
                    button reappears the moment the first contact is
                    picked. */}
                {this.state.inviteContacts && this.props.inviteEnabled ? (
                    <IconButton
                        icon="account-plus"
                        size={22}
                        onPress={this.props.onInvitePress}
                        accessibilityLabel="Invite selected contacts"
                        style={[
                            uriInputStyles.inviteOverlay,
                            // When the dialpad is also rendered (in
                            // the invite-to-conference picker), the
                            // dialpad owns the rightmost slot (right:4)
                            // so the Invite button shifts left to sit
                            // beside it.
                            this.props.showDialpad
                                ? uriInputStyles.inviteOverlayWithDialpad
                                : null,
                            uriInputStyles.inviteOverlayEnabled,
                        ]}
                        iconColor="#ffffff"
                    />
                ) : null}
            </View>
        );
    }
}

// Searchbar height: 44 px (was 40, bumped ~10 % per user request).
// Lands on Apple's 44 px minimum tap-target dead-on, still well
// shorter than the original 56 px so the contacts list keeps the
// vertical space the previous compression reclaimed.
const SEARCHBAR_HEIGHT = 44;

const uriInputStyles = StyleSheet.create({
    searchbarRow: {
        // Relative-positioned wrapper so the backspace overlay can
        // sit absolutely inside the search bar without escaping the
        // contacts-header layout above it.
        position: 'relative',
    },
    searchbar: {
        height: SEARCHBAR_HEIGHT,
        minHeight: SEARCHBAR_HEIGHT,
    },
    searchbarInput: {
        minHeight: SEARCHBAR_HEIGHT,
        paddingVertical: 0,
        fontSize: 15,
    },
    // Custom × clear overlay. Sits at right:48, which puts its
    // right edge just to the LEFT of the dialpad toggle (at right:4
    // + ~40 px IconButton width = right:44 inner edge). Vertically
    // centered against the 56 px bar. No background — reads as a
    // bar control like Paper's original × did before we suppressed
    // it (so we could own the right edge for the dialpad).
    clearOverlay: {
        position: 'absolute',
        right: 48,
        top: (SEARCHBAR_HEIGHT - 36) / 2,
        margin: 0,
        zIndex: 5,
        elevation: 5,
    },
    // Dialpad toggle overlay — pinned flush to the right edge of
    // the Searchbar (right:4 leaves a tiny inset so the icon
    // doesn't kiss the rounded corner). The custom × clear overlay
    // above sits at right:48, immediately to the left. Active
    // state fills the IconButton with the AB-green so the toggle's
    // open/closed state reads at a glance.
    dialpadOverlay: {
        position: 'absolute',
        right: 4,
        top: (SEARCHBAR_HEIGHT - 36) / 2,
        margin: 0,
        zIndex: 5,
        elevation: 5,
    },
    dialpadOverlayActive: {
        backgroundColor: '#27ae60',
        borderRadius: 18,
    },
    // Invite-mode action pair overlays. Right→left order:
    //   • Invite (account-plus, green when enabled) at right:4
    //   • Cancel (×, neutral) at right:56  ← +52px from Invite,
    //     which is the IconButton width (~36px) + a 16px gap so
    //     the two buttons read as separate touch targets.
    //   • Clear-× (existing) shifts further left to right:108
    //     when in invite mode to clear the action pair.
    inviteOverlay: {
        position: 'absolute',
        right: 4,
        top: (SEARCHBAR_HEIGHT - 36) / 2,
        margin: 0,
        zIndex: 5,
        elevation: 5,
        borderRadius: 18,
    },
    inviteOverlayEnabled: {
        backgroundColor: '#27ae60',
    },
    cancelInviteOverlay: {
        position: 'absolute',
        right: 56,
        top: (SEARCHBAR_HEIGHT - 36) / 2,
        margin: 0,
        zIndex: 5,
        elevation: 5,
        backgroundColor: '#ffffff',
        borderRadius: 18,
    },
    clearOverlayInviteMode: {
        // Cancel button removed; clear-× now only has to clear the
        // single Invite overlay at right:4 (~40px wide), so right:48
        // (== the normal "shift one IconButton over" offset) is
        // enough.
        right: 56,
    },
    // invite + dialpad combo. Right→left order:
    //   • Dialpad at right:4   (flush right)
    //   • Invite  at right:52  (one IconButton stride over)
    //   • Clear-× at right:108 (one stride past invite)
    // Dialpad owns the rightmost slot in invite mode so the
    // pad-toggle stays in the same place as it would in a non-invite
    // search workflow — keeps muscle memory consistent.
    clearOverlayInviteAndDialpadMode: {
        right: 108,
    },
    // Invite button shifted left when the dialpad shares the bar.
    // ~52px stride past the dialpad (which sits at right:4) keeps a
    // visible gap between the two buttons.
    inviteOverlayWithDialpad: {
        right: 52,
    },
});

URIInput.propTypes = {
    defaultValue: PropTypes.string.isRequired,
    autoFocus: PropTypes.bool.isRequired,
    onChange: PropTypes.func.isRequired,
    onSelect: PropTypes.func.isRequired,
    shareToContacts: PropTypes.bool,
    inviteContacts: PropTypes.bool,
    searchMessages: PropTypes.bool,
    contactSource: PropTypes.oneOf(['sylk', 'ab']),
    showDialpad: PropTypes.bool,
    isDialpadActive: PropTypes.bool,
    onDialpadPress: PropTypes.func,
    // Invite-mode action pair callbacks. URIInput renders the
    // Cancel + Invite buttons as absolute overlays inside the search
    // bar when `inviteContacts` is true; these props are how the
    // hosting component (ReadyBox) wires the actions in.
    inviteEnabled: PropTypes.bool,
    onInvitePress: PropTypes.func,
    onCancelInvitePress: PropTypes.func,
    dark: PropTypes.bool, // <-- dark mode as prop
};

export default URIInput;
