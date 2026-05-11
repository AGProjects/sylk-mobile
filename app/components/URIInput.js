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
                    ? 'Search address book'
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
                    clearIcon="close"
                    showClearIcon={true}
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
                {/* Backspace control overlaid INSIDE the search bar,
                    immediately to the left of the × clear icon. Only
                    shown when the consumer wires it up (today: the
                    AddressBook dialpad). Absolute-positioned so it
                    sits over the Searchbar's existing layout without
                    needing to switch the mode (mode="bar" would
                    repaint the bar's background and lose the flat
                    look). */}
                {this.props.showBackspace ? (
                    <IconButton
                        icon="backspace-outline"
                        size={22}
                        disabled={!this.state.defaultValue || !this.state.defaultValue.length}
                        onPress={this.props.onBackspace}
                        accessibilityLabel="Delete last digit"
                        style={uriInputStyles.backspaceOverlay}
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
    backspaceOverlay: {
        // Absolute-positioned just inside the right edge of the
        // Searchbar, sitting LEFT of the × clear icon. The clear
        // icon's IconButton renders at ~44 px wide flush to the
        // right edge, so right: 40 puts our backspace neatly next
        // to it. Vertically centered against the 56 px bar. No
        // background — the icon renders cleanly against the
        // Searchbar surface so it reads as part of the bar's
        // controls (like the × clear), not as a stamped-on pill.
        position: 'absolute',
        right: 40,
        top: (SEARCHBAR_HEIGHT - 36) / 2,
        margin: 0,
        zIndex: 5,
        elevation: 5,
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
    showBackspace: PropTypes.bool,
    onBackspace: PropTypes.func,
    dark: PropTypes.bool, // <-- dark mode as prop
};

export default URIInput;
