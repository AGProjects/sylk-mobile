import React, { Component } from 'react';
import { View } from 'react-native';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Divider, Menu, Title } from 'react-native-paper';

class ConferenceDrawerSpeakerSelection extends Component {
    constructor(props) {
        super(props);
        autoBind(this)
        this.state = {
            speakers: props.activeSpeakers.map((participant) => {return participant.id})
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
        if (event === 'none') {
            if (this.state.speakers.length > 0) {
                this.props.selected({ id: event});
                const newSpeakers = this.state.speakers.slice(1);
                this.setState({speakers: newSpeakers});
            }
        } else {
            if (this.state.speakers[0] !== this.props.participants[event].id) {
                this.props.selected(this.props.participants[event]);
                const newSpeakers = this.state.speakers.slice();
                newSpeakers[0] = this.props.participants[event].id;
                this.setState({speakers: newSpeakers});
            }
        }
    }

    handleSecondSpeakerSelected(event) {
        if (event === 'none') {
            if (this.state.speakers.length > 1) {
                this.props.selected({ id: event}, true);
                const newSpeakers = this.state.speakers.slice();
                newSpeakers.pop();
                this.setState({speakers: newSpeakers});
            }
        } else {
            const newSpeakers = this.state.speakers.slice();
            newSpeakers[1] = this.props.participants[event].id;
            this.setState({speakers: newSpeakers});
            this.props.selected(this.props.participants[event], true);
        }
    }

    render() {
        const participantsLeft = [];
        const participantsRight = [];
        let title1 = 'None';
        let title2 = 'None';

        participantsLeft.push(<Menu.Item key="divider" divider />);

        this.props.participants.forEach((p, index) => {

            let title = p.identity.displayName || p.identity.uri;

            if (this.state.speakers[0] === p.id) {
                participantsLeft.push(
                    <Menu.Item key={index} eventKey={index} active={true} title={title}/>
                );
                title1 = title;
            } else if (this.state.speakers[1] === p.id) {
                participantsRight.push(
                    <Menu.Item key={index} eventKey={index} active={true} title={title} />
                );
                title2 = title;
            } else {
                participantsRight.push(
                    <Menu.Item key={index} eventKey={index} title={title} />
                );
                participantsLeft.push(
                    <Menu.Item key={index} eventKey={index} title={title} />
                );
            }
        });

        if (participantsRight.length !== 0) {
            participantsRight.unshift(<Divider />);
        }

        return (
            <View>
                <Title>Active Speakers</Title>
                <View className="form-group">
                   {/* <label htmlFor="speaker1" className="control-label">Speaker 1:</label> */}
                   <Menu id="speaker1" title={title1} onSelect={this.handleFirstSpeakerSelected} block>
                       <Menu.Item key="none" eventKey="none" active={this.state.speakers.length === 0} title="None" />
                       {participantsLeft}
                   </Menu>
                </View>
                <View className="form-group">
                    {/* <label htmlFor="speaker1">Speaker 2:</label> */}
                    <Menu onSelect={this.handleSecondSpeakerSelected} id="speaker2" title={title2} disabled={this.props.participants.length < 2 || this.state.speakers.length === 0} block>
                        <Menu.Item key="none" eventKey="none" active={this.state.speakers.length < 2} title="None" />
                        {participantsRight}
                    </Menu>
                </View>
            </View>
        );
    }
}

ConferenceDrawerSpeakerSelection.propTypes = {
    participants: PropTypes.array.isRequired,
    selected: PropTypes.func,
    activeSpeakers: PropTypes.array
};

export default ConferenceDrawerSpeakerSelection;
