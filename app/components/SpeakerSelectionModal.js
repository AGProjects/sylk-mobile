'use strict';

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import {
    Modal,
    View,
    ScrollView,
    TouchableOpacity,
    TouchableWithoutFeedback,
    StyleSheet,
    Platform
} from 'react-native';
import { Surface, Text, Button } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Speaker layout modes correspond directly to how the conference
// matrix renders downstream:
//   grid     → no pinned speakers, equal tiles (configureRoom([]))
//   one      → one pinned speaker, remainder as side strip (1 publisherId)
//   two      → two pinned speakers, side-by-side (2 publisherIds)
//
// configureRoom() on the SylkRTC call takes an array of publisherIds;
// length 0 / 1 / 2 maps to the modes above, so we keep the same shape
// when we hand the selection back to ConferenceBox via onApply.
const MODES = ['grid', 'one', 'two'];

const MODE_META = {
    grid: { icon: 'view-grid',          label: 'Grid'        },
    one:  { icon: 'account',            label: '1 speaker'   },
    two:  { icon: 'account-multiple',   label: '2 speakers'  }
};

const ACCENT = '#2196f3';
const BORDER = '#d9dde3';
const SUBTLE = '#f3f4f6';

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.55)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16
    },

    card: {
        width: '100%',
        maxWidth: 560,
        backgroundColor: '#ffffff',
        borderRadius: 12,
        paddingTop: 16,
        paddingBottom: 12,
        paddingHorizontal: 12,
        // small drop shadow so the modal lifts off the conference
        // grid clearly on both platforms
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOpacity: 0.25,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 4 }
            },
            android: { elevation: 8 }
        })
    },

    title: {
        fontSize: 18,
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: 12,
        color: '#222'
    },

    modeRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'stretch',
        marginBottom: 16,
        paddingHorizontal: 4
    },

    modeTab: {
        flex: 1,
        marginHorizontal: 4,
        paddingVertical: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center'
    },

    modeTabActive: {
        borderColor: ACCENT,
        backgroundColor: 'rgba(33,150,243,0.10)'
    },

    modeLabel: {
        marginTop: 6,
        fontSize: 12,
        color: '#444'
    },

    modeLabelActive: {
        color: ACCENT,
        fontWeight: '600'
    },

    columnsRow: {
        flexDirection: 'row',
        alignItems: 'stretch',
        // Fixed height so the columns are predictable regardless
        // of mode (Grid hint, 1-column or 2-column). Without this
        // the column visibly shifted up when slot text grew /
        // shrank as the user picked rows. Sized to fit ~6 rows
        // before scrolling kicks in.
        height: 320
    },

    column: {
        flex: 1,
        marginHorizontal: 4
    },

    columnHeader: {
        fontSize: 13,
        fontWeight: '600',
        color: '#555',
        marginBottom: 6,
        paddingHorizontal: 4,
        // Fixed line height so a long " — Selected Name" suffix
        // doesn't wrap and push the list below it downward.
        height: 20,
        lineHeight: 20
    },

    columnList: {
        flex: 1,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 8,
        backgroundColor: SUBTLE,
        overflow: 'hidden'
    },

    pRow: {
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: BORDER,
        flexDirection: 'row',
        alignItems: 'center'
    },

    pRowSelected: {
        backgroundColor: 'rgba(33,150,243,0.14)'
    },

    pRowName: {
        flex: 1,
        fontSize: 14,
        color: '#222'
    },

    pRowNameSelected: {
        color: ACCENT,
        fontWeight: '600'
    },

    emptyText: {
        padding: 16,
        textAlign: 'center',
        color: '#888'
    },

    gridHint: {
        textAlign: 'center',
        color: '#666',
        padding: 16
    },

    actionBar: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 16,
        paddingHorizontal: 4
    },

    actionBtn: {
        marginLeft: 8
    }
});

class SpeakerSelectionModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        const seed = this._seedFromProps(props);
        this.state = {
            mode: seed.mode,
            slot1: seed.slot1,
            slot2: seed.slot2
        };
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        // re-seed when the modal transitions from hidden → shown so
        // a stale selection from a previous open doesn't carry over
        if (!this.props.show && nextProps.show) {
            const seed = this._seedFromProps(nextProps);
            this.setState({
                mode: seed.mode,
                slot1: seed.slot1,
                slot2: seed.slot2
            });
        }
    }

    _seedFromProps(props) {
        const active = props.activeSpeakers || [];
        let mode = 'grid';
        if (active.length === 1) mode = 'one';
        if (active.length >= 2)  mode = 'two';
        return {
            mode,
            slot1: active[0] || null,
            slot2: active[1] || null
        };
    }

    _participantId(p) {
        if (!p) return null;
        return p.id || (p.identity && p.identity.uri) || null;
    }

    _participantName(p) {
        if (!p || !p.identity) return '';
        const raw = p.identity.displayName || p.identity.uri || '';
        // strip @domain to match the matrix tile label convention
        return raw.indexOf('@') > -1 ? raw.split('@')[0] : raw;
    }

    _selectableParticipants() {
        // Drop the synthetic "no speaker" sentinel that the legacy
        // drawer flow appended — the new modal expresses "no speaker"
        // by switching to Grid mode, so it doesn't need a row.
        // Sort alphabetically by display name (falling back to URI
        // local-part) so the order is predictable when picking
        // across many participants. Case-insensitive.
        const list = (this.props.participants || []).filter(p => p && p.id !== 'none');
        return list.slice().sort((a, b) => {
            const nameA = (this._participantName(a) || '').toLowerCase();
            const nameB = (this._participantName(b) || '').toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
        });
    }

    handleModeChange(mode) {
        if (this.state.mode === mode) return;
        // Preserve slot picks when widening (grid → one → two) but
        // clear slot2 when narrowing to a smaller mode so the next
        // Apply doesn't leak a stale pin.
        let { slot1, slot2 } = this.state;
        if (mode === 'grid') {
            slot1 = null;
            slot2 = null;
        } else if (mode === 'one') {
            slot2 = null;
        }
        this.setState({ mode, slot1, slot2 });
    }

    // Each column is bound to a slot (1 or 2). Tapping a participant
    // row fills THAT column's slot directly — no "active slot" state
    // to manage, no need to tap the header first. If the picked
    // participant was already sitting in the OTHER slot we evict
    // them so the same person can't occupy both pins.
    handlePickParticipant(p, slot) {
        if (this.state.mode === 'one') {
            this.setState({ slot1: p });
            return;
        }
        if (this.state.mode !== 'two') return;

        const pid = this._participantId(p);
        let { slot1, slot2 } = this.state;

        if (slot === 1) {
            // tapping the same row again in column 1 toggles it off
            if (slot1 && this._participantId(slot1) === pid) {
                this.setState({ slot1: null });
                return;
            }
            if (slot2 && this._participantId(slot2) === pid) slot2 = null;
            this.setState({ slot1: p, slot2 });
        } else {
            if (slot2 && this._participantId(slot2) === pid) {
                this.setState({ slot2: null });
                return;
            }
            if (slot1 && this._participantId(slot1) === pid) slot1 = null;
            this.setState({ slot2: p, slot1 });
        }
    }

    handleApply() {
        const { mode, slot1, slot2 } = this.state;
        let chosen = [];
        if (mode === 'one' && slot1) {
            chosen = [slot1];
        } else if (mode === 'two') {
            chosen = [slot1, slot2].filter(Boolean);
        }
        // mode === 'grid' → empty array → configureRoom clears pins
        if (typeof this.props.onApply === 'function') {
            this.props.onApply(chosen);
        }
        if (typeof this.props.close === 'function') {
            this.props.close();
        }
    }

    handleCancel() {
        if (typeof this.props.close === 'function') {
            this.props.close();
        }
    }

    renderModeTab(mode) {
        const { icon, label } = MODE_META[mode];
        const active = this.state.mode === mode;
        return (
            <TouchableOpacity
                key={mode}
                style={[styles.modeTab, active && styles.modeTabActive]}
                onPress={() => this.handleModeChange(mode)}
                accessibilityRole="button"
                accessibilityLabel={`Layout: ${label}`}
            >
                <Icon name={icon} size={26} color={active ? ACCENT : '#555'} />
                <Text style={[styles.modeLabel, active && styles.modeLabelActive]}>{label}</Text>
            </TouchableOpacity>
        );
    }

    renderParticipantRow(p, selectedId, index, slot) {
        const id = this._participantId(p);
        const selected = id != null && id === selectedId;
        // Stable key: prefer the participant id, fall back to
        // publisherId, then to the row index. Never use Math.random
        // here — it would break selection state on every render.
        const rowKey = id || (p && p.publisherId) || `row-${index}`;
        return (
            <TouchableOpacity
                key={rowKey}
                style={[styles.pRow, selected && styles.pRowSelected]}
                onPress={() => this.handlePickParticipant(p, slot)}
            >
                <Icon
                    name={selected ? 'check-circle' : 'circle-outline'}
                    size={20}
                    color={selected ? ACCENT : '#9aa1a8'}
                    style={{ marginRight: 10 }}
                />
                <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[styles.pRowName, selected && styles.pRowNameSelected]}
                >
                    {this._participantName(p) || '(no name)'}
                </Text>
            </TouchableOpacity>
        );
    }

    renderColumn(title, slot, selected) {
        const participants = this._selectableParticipants();
        const selectedId = this._participantId(selected);

        return (
            <View style={styles.column}>
                <Text style={styles.columnHeader} numberOfLines={1} ellipsizeMode="tail">
                    {title}
                    {selected ? ` — ${this._participantName(selected)}` : ''}
                </Text>
                <View style={styles.columnList}>
                    {participants.length === 0 ? (
                        <Text style={styles.emptyText}>No participants with video</Text>
                    ) : (
                        <ScrollView keyboardShouldPersistTaps="handled">
                            {participants.map((p, i) =>
                                this.renderParticipantRow(p, selectedId, i, slot))}
                        </ScrollView>
                    )}
                </View>
            </View>
        );
    }

    renderBody() {
        const { mode, slot1, slot2 } = this.state;

        if (mode === 'grid') {
            return (
                <View style={styles.columnsRow}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.gridHint}>
                            All participants share the screen equally — no pinned speakers.
                        </Text>
                    </View>
                </View>
            );
        }

        if (mode === 'one') {
            return (
                <View style={styles.columnsRow}>
                    {this.renderColumn('Speaker', 1, slot1)}
                </View>
            );
        }

        // two
        return (
            <View style={styles.columnsRow}>
                {this.renderColumn('Speaker 1', 1, slot1)}
                {this.renderColumn('Speaker 2', 2, slot2)}
            </View>
        );
    }

    render() {
        if (!this.props.show) return null;

        return (
            <Modal
                visible={this.props.show}
                transparent
                animationType="fade"
                onRequestClose={this.handleCancel}
            >
                <TouchableWithoutFeedback onPress={this.handleCancel}>
                    <View style={styles.overlay}>
                        {/* Stop the backdrop tap from bubbling when
                            tapping anywhere inside the card. */}
                        <TouchableWithoutFeedback onPress={() => {}}>
                            <Surface style={styles.card}>
                                <Text style={styles.title}>Speaker selection</Text>

                                <View style={styles.modeRow}>
                                    {MODES.map(m => this.renderModeTab(m))}
                                </View>

                                {this.renderBody()}

                                {(() => {
                                    // Apply gating: enable only when the current
                                    // mode has all required slots filled.
                                    //   • grid → always enabled (no pins to set)
                                    //   • one  → slot1 required
                                    //   • two  → both slots required
                                    const { mode, slot1, slot2 } = this.state;
                                    let canApply = true;
                                    if (mode === 'one') canApply = !!slot1;
                                    if (mode === 'two') canApply = !!slot1 && !!slot2;
                                    return (
                                        <View style={styles.actionBar}>
                                            <Button
                                                mode="text"
                                                onPress={this.handleCancel}
                                                style={styles.actionBtn}
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                mode="contained"
                                                onPress={this.handleApply}
                                                disabled={!canApply}
                                                style={styles.actionBtn}
                                            >
                                                Apply
                                            </Button>
                                        </View>
                                    );
                                })()}
                            </Surface>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        );
    }
}

SpeakerSelectionModal.propTypes = {
    show: PropTypes.bool,
    close: PropTypes.func.isRequired,
    onApply: PropTypes.func.isRequired,
    // Array of candidate participant objects. Each one must expose
    // .id, .publisherId and .identity ({displayName, uri}). The
    // "no speaker" sentinel from the legacy flow is filtered out.
    participants: PropTypes.array,
    // Currently pinned speakers (0, 1 or 2 entries). Seeds the
    // initial mode + slot state when the modal opens.
    activeSpeakers: PropTypes.array
};

export default SpeakerSelectionModal;
