import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { FlatList, TouchableOpacity, View, Text } from 'react-native';
import { Button } from 'react-native-paper';
import { SwipeRow } from 'react-native-swipe-list-view';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ConferenceDrawerParticipant from './ConferenceDrawerParticipant';

import styles from '../assets/styles/blink/_ConferenceDrawerSpeakerSelection.scss';

class ConferenceDrawerSpeakerSelection extends Component {
    constructor(props) {
        super(props);
        autoBind(this)
        this.state = {
            speakers: props.activeSpeakers.map((participant) => {return participant.id}),
        };
    }

    handleFirstSpeakerSelected(event) {
        if (event === 'none') {
            if (this.state.speakers.length > 0) {
                this.props.selected({id: event});
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
        if (event === 'none') {
            if (this.state.speakers.length > 1) {
                this.props.selected({id: event}, true);
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
        const parts = [];

        let changeFunction = this.handleFirstSpeakerSelected;
        if (this.props.selectSpeaker === 2) {
            changeFunction = this.handleSecondSpeakerSelected;
        }

        this.props.participants.forEach((p, index) => {
            const id = index;

            if (this.state.speakers[this.props.selectSpeaker-1] === p.id) {
                parts.push(
                    <SwipeRow
                         disableRightSwipe={true}
                         rightOpenValue={-80}
                         style={styles.swipeHidden}
                         key={index}
                    >
                        <View style={styles.hiddenItem}>
                            <TouchableOpacity onPress={() => changeFunction('none')} style={styles.button}>
                                <Icon name="minus" size={30} color="#fff"/>
                                <Text style={styles.removeButton}>Remove</Text>
                            </TouchableOpacity>
                        </View>
                        <View style={styles.front}>
                            <ConferenceDrawerParticipant participant={p} />
                        </View>
                    </SwipeRow>
                );
            } else {
                parts.push(
                    <TouchableOpacity onPress={() => changeFunction({id: id})} key={p.id}>
                        <ConferenceDrawerParticipant participant={p} selected={true} />
                    </TouchableOpacity>
                );
            }
        });

        return (
            <Fragment>
                {/* {this.props.activeSpeakers.length === this.props.selectSpeaker && <Button style={styles.firstButton} onPress={() => changeFunction('none')}>Remove speaker {this.props.selectSpeaker}</Button>} */}
                <FlatList
                    style={styles.flatlist}
                    data={parts}
                    renderItem={({item}) => {return (item)}}
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
