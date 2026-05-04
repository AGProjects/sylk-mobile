import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { Modal, View, TouchableWithoutFeedback, KeyboardAvoidingView, Platform, Share } from 'react-native';
import { Text, Button, Surface, RadioButton } from 'react-native-paper';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/blink/_DeleteMessageModal.scss';

// "Share location information" picker. Opened from the long-press
// kebab on a live-location bubble that has a multi-point trail; the
// user picks one of three points along the trail and confirms — we
// then hand the chosen {coords, timestamp} back through onConfirm,
// the host (ContactsListBox) opens the system Share sheet with a
// formatted "📍 Position on … <maps link>" payload.
//
// Three options:
//   start    — trail[0] (oldest tick)
//   end      — trail[trail.length-1] (latest / current position)
//   selected — trail[scrubIndex] when the user has paused the slider
//              somewhere in the middle. Hidden / disabled when the
//              user hasn't scrubbed (selected would equal end).
//
// Default selection: 'selected' if the user has paused the slider,
// otherwise 'end' — that's the most "send me a thumb-down on where
// you are right now" default for a live share.
class ShareLocationInfoModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            show: props.show,
            // 'start' | 'end' | 'selected'. Resolved at open via
            // _defaultChoice so caregivers / pause-mode users see the
            // most likely default pre-selected.
            choice: ShareLocationInfoModal._defaultChoice(props),
        };
    }

    static _defaultChoice(props) {
        const hasSelected = typeof props.selectedIndex === 'number'
            && Array.isArray(props.trail)
            && props.selectedIndex >= 0
            && props.selectedIndex < props.trail.length - 1;
        return hasSelected ? 'selected' : 'end';
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        if (nextProps.show && !this.state.show) {
            this.setState({
                show: true,
                choice: ShareLocationInfoModal._defaultChoice(nextProps),
            });
        } else {
            this.setState({show: nextProps.show});
        }
    }

    onCancel() {
        this.props.close();
    }

    onConfirm() {
        const trail = Array.isArray(this.props.trail) ? this.props.trail : [];
        if (trail.length === 0) {
            this.props.close();
            return;
        }
        let point;
        if (this.state.choice === 'start') {
            point = trail[0];
        } else if (this.state.choice === 'selected'
                && typeof this.props.selectedIndex === 'number'
                && this.props.selectedIndex >= 0
                && this.props.selectedIndex < trail.length) {
            point = trail[this.props.selectedIndex];
        } else {
            point = trail[trail.length - 1];
        }
        if (!point) {
            this.props.close();
            return;
        }
        // Format. toLocaleString for the human-readable timestamp
        // because the recipient may live in a different locale than
        // the sender; en-GB or any fixed format would be
        // presumptuous. Maps URL is the universal Google form so
        // both iOS and Android open it correctly.
        const lat = point.latitude;
        const lng = point.longitude;
        let when = '';
        if (Number.isFinite(point.timestamp) && point.timestamp > 0) {
            try {
                when = new Date(point.timestamp).toLocaleString();
            } catch (e) {
                when = new Date(point.timestamp).toISOString();
            }
        }
        const url = `https://maps.google.com/?q=${lat},${lng}`;
        const message = when
            ? `📍 Position on ${when}\n${url}`
            : `📍 Position\n${url}`;
        Share.share({ message }).catch((err) => {
            console.log('[location] share-info failed',
                err && err.message ? err.message : err);
        });
        this.props.close();
    }

    setChoice(choice) {
        this.setState({ choice });
    }

    render() {
        const trail = Array.isArray(this.props.trail) ? this.props.trail : [];
        const hasTrail = trail.length >= 2;
        const selectedIdx = this.props.selectedIndex;
        // Whether the user actually has a "selected" point distinct
        // from the start / end — controls the third radio's enabled
        // state. With no scrub, selected === end which makes the
        // option redundant.
        const hasSelected = typeof selectedIdx === 'number'
            && selectedIdx >= 0
            && selectedIdx < trail.length - 1;

        const _formatTime = (ms) => {
            if (!Number.isFinite(ms) || ms <= 0) return '';
            const d = new Date(ms);
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return `${hh}:${mm}`;
        };
        const startLabel = hasTrail
            ? `Share start location (${_formatTime(trail[0].timestamp)})`
            : 'Share start location';
        const endLabel = hasTrail
            ? `Share end location (${_formatTime(trail[trail.length - 1].timestamp)})`
            : 'Share end location';
        const selectedLabel = hasSelected
            ? `Share selected location (${_formatTime(trail[selectedIdx].timestamp)})`
            : 'Share selected location';

        return (
            <Modal
                style={containerStyles.container}
                visible={this.state.show}
                transparent
                animationType="fade"
                onRequestClose={this.onCancel}
            >
                <TouchableWithoutFeedback onPress={this.onCancel}>
                    <View style={containerStyles.overlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                        >
                            <TouchableWithoutFeedback onPress={() => {}}>
                                <Surface style={containerStyles.modalSurface}>
                                    <Text style={containerStyles.title}>Share location information</Text>

                                    <Text style={[styles.body, { paddingTop: 4, paddingBottom: 8 }]}>
                                        Pick which point along the path to share.
                                    </Text>

                                    <RadioButton.Group
                                        onValueChange={this.setChoice}
                                        value={this.state.choice}
                                    >
                                        <View style={[styles.checkBoxRow, { marginBottom: 0 }]}>
                                            <RadioButton.Android value="start" uncheckedColor="#666" />
                                            <Text>{startLabel}</Text>
                                        </View>
                                        <View style={[styles.checkBoxRow, { marginBottom: 0 }]}>
                                            <RadioButton.Android value="end" uncheckedColor="#666" />
                                            <Text>{endLabel}</Text>
                                        </View>
                                        {/* "Selected" is the slider position.
                                            Disabled (greyed via opacity) when
                                            the user hasn't moved the slider —
                                            it would otherwise refer to the
                                            same point as "end". */}
                                        <View style={[
                                            styles.checkBoxRow,
                                            { marginBottom: 0, opacity: hasSelected ? 1 : 0.4 },
                                        ]}>
                                            <RadioButton.Android
                                                value="selected"
                                                uncheckedColor="#666"
                                                disabled={!hasSelected}
                                            />
                                            <Text>{selectedLabel}</Text>
                                        </View>
                                    </RadioButton.Group>

                                    <View style={[styles.buttonRow, { marginBottom: 16, marginTop: 8 }]}>
                                        <Button
                                            mode="outlined"
                                            style={styles.button}
                                            onPress={this.onCancel}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            mode="contained"
                                            style={styles.button}
                                            onPress={this.onConfirm}
                                            icon="share-variant"
                                        >
                                            Confirm
                                        </Button>
                                    </View>
                                </Surface>
                            </TouchableWithoutFeedback>
                        </KeyboardAvoidingView>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        );
    }
}

ShareLocationInfoModal.propTypes = {
    show          : PropTypes.bool,
    close         : PropTypes.func.isRequired,
    // Array of {latitude, longitude, timestamp} entries — the same
    // sanitised trail the LocationBubble's slider operates over.
    trail         : PropTypes.array,
    // Index into `trail` matching the slider's current position.
    // null/undefined when the user hasn't paused the scrubber.
    selectedIndex : PropTypes.number,
};

export default ShareLocationInfoModal;
