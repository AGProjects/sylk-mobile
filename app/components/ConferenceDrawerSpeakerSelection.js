import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Title } from 'react-native-paper';
import { Select } from 'material-bread';

class ConferenceDrawerSpeakerSelection extends Component {
    constructor(props) {
        super(props);
        autoBind(this)
        this.state = {
            speakers: props.activeSpeakers.map((participant) => {return participant.id}),
            selectedLeft: null,
            selectedRight: null
        };
    }

    componentWillReceiveProps(nextProps) {
        let speakers = [];
        if (nextProps.activeSpeakers.length !== 0) {
            speakers = nextProps.activeSpeakers.map((participant) => {
                return participant.id
            });
        }
        this.setState({speakers: speakers});
    }

    handleFirstSpeakerSelected(event) {
        this.setState({selectedLeft: event.name});
        if (event === 'None') {
            if (this.state.speakers.length > 0) {
                this.props.selected({ id: event.id});
                const newSpeakers = this.state.speakers.slice(1);
                this.setState({speakers: newSpeakers});
            }
        } else {
            if (this.state.speakers[0] !== this.props.participants[event.id].id) {
                this.props.selected(this.props.participants[event.id]);
                const newSpeakers = this.state.speakers.slice();
                newSpeakers[0] = this.props.participants[event.id].id;
                this.setState({speakers: newSpeakers});
            }
        }
    }

    handleSecondSpeakerSelected(event) {
        this.setState({selectedRight: event.name});
        if (event.name === 'None') {
            if (this.state.speakers.length > 1) {
                this.props.selected({ id: event.id}, true);
                const newSpeakers = this.state.speakers.slice();
                newSpeakers.pop();
                this.setState({speakers: newSpeakers});
            }
        } else {
            const newSpeakers = this.state.speakers.slice();
            newSpeakers[1] = this.props.participants[event.id].id;
            this.setState({speakers: newSpeakers});
            this.props.selected(this.props.participants[event.id], true);
        }
    }

    render() {
        const participantsLeft = [];
        const participantsRight = [];

        if (this.state.speakers.length < 2) {
            participantsRight.push({ name: 'None' });
        }

        this.props.participants.forEach((p, index) => {

            let name = p.identity.displayName || p.identity.uri;
            let id = index;

            if (this.state.speakers[0] === p.id) {
                participantsLeft.push({ id, name });
            } else if (this.state.speakers[1] === p.id) {
                participantsRight.push({ id, name });
            } else {
                participantsRight.push({ id, name });
                participantsLeft.push({ id, name });
            }
        });

        return (
            <Fragment>
                <Title>Active Speakers</Title>
                <Select
                    label='Speaker 1'
                    type='outlined'
                    menuItems={participantsLeft}
                    onSelect={this.handleFirstSpeakerSelected}
                    selectedItem={this.state.selectedLeft}
                />

                <Select
                    label='Speaker 2'
                    type='outlined'
                    menuItems={participantsRight}
                    onSelect={this.handleSecondSpeakerSelected}
                    selectedItem={this.state.selectedRight}
                    visible={this.props.participants.length < 2 || this.state.speakers.length === 0}
                />
            </Fragment>
        );
    }
}

ConferenceDrawerSpeakerSelection.propTypes = {
    participants: PropTypes.array.isRequired,
    selected: PropTypes.func,
    activeSpeakers: PropTypes.array
};

export default ConferenceDrawerSpeakerSelection;

