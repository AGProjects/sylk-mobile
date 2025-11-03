import React from 'react';
import PropTypes from 'prop-types';
import { Searchbar } from 'react-native-paper';
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
                style={{
                    ...(darkColors.backgroundColor ? { backgroundColor: darkColors.backgroundColor } : {}),
                }}
                inputStyle={{
                    ...(darkColors.textColor ? { color: darkColors.textColor } : {}),
                }}
                iconColor={darkColors.iconColor}
                placeholderTextColor={darkColors.placeholderColor}
            />
        );
    }
}

URIInput.propTypes = {
    defaultValue: PropTypes.string.isRequired,
    autoFocus: PropTypes.bool.isRequired,
    onChange: PropTypes.func.isRequired,
    onSelect: PropTypes.func.isRequired,
    shareToContacts: PropTypes.bool,
    inviteContacts: PropTypes.bool,
    searchMessages: PropTypes.bool,
    dark: PropTypes.bool, // <-- dark mode as prop
};

export default URIInput;
