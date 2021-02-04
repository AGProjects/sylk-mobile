// SPDX-FileCopyrightText: 2020, AG Projects
// SPDX-License-Identifier: GPL-3.0-only

import React from 'react';
import PropTypes from 'prop-types';
import { TextInput, Searchbar  } from 'react-native-paper';
import autoBind from 'auto-bind';

class URIInput extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            selecting: false
        };

        this.uriInput = React.createRef();
        this.clicked = false;
        this.autoComplete;
    }

    componentDidMount() {
        // this.autoComplete = autocomplete('#uri-input', { hint: false }, [
        //     {
        //         source: (query, cb) => {
        //             let data = this.props.data.filter((item) => {
        //                 return item.startsWith(query);
        //             });
        //             cb(data);
        //         },
        //         displayKey: String,
        //         templates: {
        //             suggestion: (suggestion) => {
        //                 return suggestion;
        //             }
        //         }
        //     }
        // ]).on('autocomplete:selected', (event, suggestion, dataset) => {
        //     this.setValue(suggestion);
        // });

        if (this.props.autoFocus) {
            this.uriInput.current.focus();
        }
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
                // ENTER
                if (this.state.selecting) {
                    this.setState({selecting: false});
                } else {
                    this.props.onSelect(event.target.value);
                }
                break;
            case 27:
                // ESC
                this.setState({selecting: false});
                break;
            case 38:
            case 40:
                // UP / DOWN ARROW
                this.setState({selecting: true});
                break;
            default:
                break;
        }
    }

    onInputBlur(event) {
        // focus was lost, reset selecting state
        if (this.state.selecting) {
            this.setState({selecting: false});
        }
        this.clicked = false;
    }

    render() {
        const placehoder = 'Enter a SIP address';

        return (
            <Searchbar
                mode="flat"
                label="Enter address"
                ref={this.uriInput}
                onChangeText={this.onInputChange}
                onKeyDown={this.onInputKeyDown}
                onBlur={this.onInputBlur}
                onPress={this.onInputClick}
                value={this.props.defaultValue}
                autoCapitalize="none"
                autoCorrect={false}
                required
                autoFocus={this.props.autoFocus}
                placeholder={placehoder}
            />
        );

    }
}

URIInput.propTypes = {
    defaultValue: PropTypes.string.isRequired,
    autoFocus: PropTypes.bool.isRequired,
    onChange: PropTypes.func.isRequired,
    onSelect: PropTypes.func.isRequired
};


export default URIInput;
