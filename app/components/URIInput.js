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
                    ? 'Search Phonebook'
                    : 'Search Sylk contacts';
        }

        // Only apply dark mode colors if dark prop is true
        const darkColors = this.props.dark
            ? {
                  backgroundColor: '#121212',
                  textColor: '#ffffff',
                  iconColor: '#bbbbbb',
                  placeholderColor: '#aaaaaa',
              }
            : {};

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
                        style={uriInputStyles.clearOverlay}
                        iconColor={darkColors.iconColor}
                    />
                ) : null}
                {/* Dialpad toggle overlaid INSIDE the search bar,
                    flush against the right edge (right:4). The × clear
                    icon above sits to its LEFT at right:48. Highlighted
                    (filled green background) when the pad is open so
                    the toggle-state is obvious at a glance. */}
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
            </View>
        );
    }
}

// Searchbar height: 56 px (25% taller than the previous 45 px).
// Roomier touch target and gives the input text and embedded
// controls (clear ×, dialpad backspace) more vertical breathing room.
const SEARCHBAR_HEIGHT = 56;

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
    dark: PropTypes.bool, // <-- dark mode as prop
};

export default URIInput;
