import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import {
    View,
    Platform,
    Text,
    Modal,
    TouchableWithoutFeedback,
    KeyboardAvoidingView,
} from 'react-native';
import UserIcon from './UserIcon';
import { Button, Surface, Switch, Checkbox } from 'react-native-paper';
import PlatformToggle from './PlatformToggle';

// Share the Modal + overlay + Surface shell with EditContactModal /
// ShareLocationModal / ActiveLocationSharesModal so every dialog has
// the same rounded-corner card on a dimmed backdrop. Dropped the old
// Paper Dialog/Portal wrapper that produced a slightly different
// corner radius and elevation.
import containerStyles from '../assets/styles/ContainerStyles';

import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  container: {
    padding: 10,
    margin: 0,
  },

  title: {
    padding: 0,
    fontSize: 24,
    textAlign: 'center',
  },

  body: {
    padding: 10,
    fontSize: 16,
    textAlign: 'center',
  },

  avatar: {
    // You can add avatar-specific styling here if needed
  },

  button: {
    margin: 10,
  },

  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingBottom: 20,
  },

  checkBoxGroupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },

  checkBoxRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginLeft: 20,
    marginBottom: 10,
  },

  checkButton: {
    margin: 10,
    width: 70,
  },

	titleContainer: {
	  flexDirection: 'column', // stack elements vertically
	  alignItems: 'center',    // center horizontally
	},

  /* --- Container for the dropdown --- */
  periodDropdownContainer: {
    flexDirection: 'column',
    marginVertical: 8,
    width: '100%',
  },

  /* Label above the dropdown */
  periodDropdownLabel: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },

  /* Style for the picker itself */
  periodPicker: {
    height: 50,
    width: '100%',
    borderRadius: 8,
    backgroundColor: '#f0f0f0', // light gray
    paddingHorizontal: 8,
  },

  /* Optional: individual picker item styling */
  periodPickerItem: {
    color: '#333',
    fontSize: 14,
  },
});


class DeleteHistoryModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            show: this.props.show,
            periodFilterKey: '2',
            periodType: 'after',
            remoteDelete: true,
            deleteContact: this.props.deleteContact,
            confirm: false,
            confirm_again: false,
            incoming: false,
            outgoing: true,
            simulate: false,
        };
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        // Only sync props that ACTUALLY changed. The original code
        // unconditionally copied `confirm` and `confirm_again` from
        // nextProps on every parent re-render — but NavigationBar
        // never passes those props, so each spurious re-render
        // (presence tick, allContacts shuffle, message bump…) reset
        // them to `undefined`, wiping the user's "Confirm" tap
        // mid-3-tap sequence. The user would tap Delete → Confirm →
        // and the third tap would never advance because the second
        // tap's state had just been nuked. Net effect: the modal
        // never fires deleteContactAction's confirm_again branch, and
        // when it eventually DOES fire something it's the wrong
        // handler with filter.deleteContact = false → app.js skips
        // removeContact → contact never gets deleted. Same risk on
        // `deleteContact`: an intermediate close-handler render could
        // briefly flip state.deleteContact false, switching the
        // rendered branch (and the Delete button's handler) under the
        // user's finger.
        //
        // Keep confirm / confirm_again as purely local UI state, and
        // only mirror the prop-driven fields when the prop value
        // genuinely changes.
        const update = {};
        if (nextProps.show !== this.props.show) {
            update.show = nextProps.show;
            // Fresh modal session — reset the tap counter so the next
            // open doesn't inherit a leftover confirm state from the
            // previous close.
            if (nextProps.show && !this.props.show) {
                update.confirm = false;
                update.confirm_again = false;
            }
        }
        if (nextProps.deleteContact !== this.props.deleteContact) {
            update.deleteContact = nextProps.deleteContact;
        }
        if (nextProps.simulate !== this.props.simulate) {
            update.simulate = nextProps.simulate || false;
        }
        if (nextProps.periodType !== this.props.periodType) {
            update.periodType = nextProps.periodType;
        }
        if (Object.keys(update).length > 0) {
            this.setState(update);
        }
    }

    deleteMessages(event) {
        if (this.state.confirm_again) {
            const filter = {
                period: this.getPeriodFilterDate(),
                periodType: this.state.periodType,
                incoming: this.state.incoming,
                outgoing: this.state.outgoing,
                deleteContact: this.state.deleteContact,
                simulate: this.state.simulate,
                wipe: this.props.myself && !this.props.selectedContact,
                selectedContact: this.props.selectedContact
            };
    
            this.props.deleteMessages(this.props.uri, this.state.remoteDelete, filter);
            this.setState({ confirm: false, remoteDelete: false, deleteContact: false });
            this.props.close();
        } else if (this.state.confirm) {
            this.setState({ confirm_again: true }); 
        } else {
            this.setState({ confirm: true });
        }
    }

    deleteContactAction(event) {
        event.preventDefault();

        if (this.state.confirm_again) {
            this.setState({ confirm: false, remoteDelete: false, deleteContact: false });

            const filter = {
                deleteContact: true,
                simulate: this.state.simulate,
                selectedContact: this.props.selectedContact
            };

            this.props.deleteMessages(this.props.uri, true, filter);
            this.props.close();
        } else if (this.state.confirm) {
            this.setState({ confirm_again: true }); 
        } else {
            this.setState({ confirm: true });
        }
    }

    toggleDeleteContact() { this.setState({ deleteContact: !this.state.deleteContact }); }
    toggleRemoteDelete() { this.setState({ remoteDelete: !this.state.remoteDelete }); }
    toggleIncoming() { this.setState({ incoming: !this.state.incoming }); }
    toggleOutgoing() { this.setState({ outgoing: !this.state.outgoing }); }
    toggleSimulate() { this.setState({ simulate: !this.state.simulate }); }

    getPeriodFilterDate(key) {
        if (!key) key = this.state.periodFilterKey;

        if (key === 'all') return null;

        const num = Number(key);
        if (isNaN(num)) return null;

        const now = new Date();
        const utcDate = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate()
        ));
        utcDate.setUTCDate(utcDate.getUTCDate() - Math.abs(num));
        return utcDate;
    }

	renderPeriodDropdown() {
		const periodOptions = [
			{ key: 'all', label: 'Any time' },
			{ key: '1', label: 'Last day' },
			{ key: '2', label: 'Last two days' },
			{ key: '7', label: 'Last week' },
			{ key: '30', label: 'Last month' },
			{ key: '60', label: 'Last 60 days' },
			{ key: '-92', label: 'Older than three months' },
			{ key: '-365', label: 'Older than one year' }
		];

		if (this.state.deleteContact || this.props.myself) {
			return null;
		}

		// Inline dropdown (no Paper `Menu`). Paper's Menu renders its
		// popup through a Paper Portal, which attaches to the app-root
		// Portal host. When this component is hosted inside a RN
		// <Modal>, the app-root host sits BEHIND the modal's native
		// layer on iOS — so the dropdown disappears under the dialog.
		// We can't fix this by adding a Portal.Host inside the modal
		// either: Paper's PortalHost wraps children in a flex:1 View,
		// which breaks the modal Surface's intrinsic sizing and causes
		// the card to collapse to a set of horizontal dividers.
		//
		// So we keep the same visual (outlined "anchor" button + list
		// of options) but render the list as a plain child View right
		// below the button. No portal, no popup.
		const selected = periodOptions.find(opt => opt.key === this.state.periodFilterKey);
		return (
			<View style={{ marginVertical: 8, marginLeft: 20, marginRight: 40 }}>
				<Button
					mode="outlined"
					onPress={() => this.setState({ menuVisible: !this.state.menuVisible })}
					contentStyle={{ height: 48 }}
					labelStyle={{ color: 'black' }}
					style={{ width: '100%', justifyContent: 'space-between' }}
					icon={this.state.menuVisible ? 'menu-up' : 'menu-down'}
				>
					{selected ? selected.label : 'Select period'}
				</Button>
				{this.state.menuVisible ? (
					<View
						style={{
							marginTop: 4,
							borderWidth: 1,
							borderColor: '#ccc',
							borderRadius: 8,
							backgroundColor: '#fff',
							overflow: 'hidden',
						}}
					>
						{periodOptions.map(option => (
							<Button
								key={option.key}
								mode="text"
								compact
								uppercase={false}
								style={{
									justifyContent: 'flex-start',
									borderRadius: 0,
								}}
								contentStyle={{ justifyContent: 'flex-start', height: 40 }}
								labelStyle={{
									color: option.key === this.state.periodFilterKey ? '#1976d2' : 'black',
									textAlign: 'left',
								}}
								onPress={() => {
									let periodType = 'after';
									const num = Number(option.key);
									if (!isNaN(num) && num < 0) {
										periodType = 'before';
									}
									this.setState({
										periodFilterKey: option.key,
										periodType,
										menuVisible: false
									});
								}}
							>
								{option.label}
							</Button>
						))}
					</View>
				) : null}
			</View>
		);
	}

    render() {
        const canDeleteRemote = this.props.uri && !this.props.uri.includes('@videoconference');
        let deleteLabel = 'Delete';
        
		const remote_label = this.props.selectedContact ? (this.props.selectedContact.displayName || this.props.selectedContact.uri): this.props.uri;
        const what = this.props.filteredMessageIds.length > 0
            ? `${this.props.filteredMessageIds.length} selected messages`
            : 'messages';
        const simulate = false;

        if (this.state.confirm) deleteLabel = 'Confirm';
        if (this.state.confirm_again) deleteLabel = 'Confirm again';
        
        // Shared Modal + dimmed overlay + rounded Surface shell. Matches
        // EditContactModal / ShareLocationModal so every dialog in the
        // app reads as part of the same family.
        const shell = (inner) => (
            <Modal
                style={containerStyles.container}
                // Coerce to boolean. React Native's Modal renders as
                // visible when `visible` is `undefined` (it does NOT
                // default to false), and `showDeleteHistoryModal` isn't
                // in NavigationBar's initial state — so without `!!`
                // the modal pops up on cold start.
                visible={!!this.state.show}
                transparent
                animationType="fade"
                onRequestClose={this.props.close}
            >
                <TouchableWithoutFeedback onPress={this.props.close}>
                    <View style={containerStyles.overlay}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
                        >
                            {/* Block dismiss when taps land inside the card. */}
                            <TouchableWithoutFeedback onPress={() => {}}>
                                <Surface style={containerStyles.modalSurface}>
                                    {inner}
                                </Surface>
                            </TouchableWithoutFeedback>
                        </KeyboardAvoidingView>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        );

        if ((!this.props.hasMessages && this.props.uri) || this.state.deleteContact) {
            // Pretty-print the URI for the confirmation prompt:
            // strip @<defaultDomain> off E.164 phone-number URIs so
            // a contact stored as "+40721253846@sylk.link" shows as
            // just "+40721253846" — same logic EditContactModal uses
            // when displaying the Address field. Non-default domains
            // (e.g. "alice@otherdomain.com") are left intact so the
            // user can confirm they're deleting the right row.
            const _rawUri = this.props.uri || '';
            const _defaultDomain = this.props.defaultDomain;
            let _displayUri = _rawUri;
            if (_defaultDomain && _rawUri.startsWith('+')) {
                const suffix = '@' + _defaultDomain;
                if (_rawUri.toLowerCase().endsWith(suffix.toLowerCase())) {
                    _displayUri = _rawUri.substring(0, _rawUri.length - suffix.length);
                }
            }
            // Display name pulled from selectedContact when available.
            // Falls back to nothing if the contact has no name set —
            // in that case the URI alone is the most useful label.
            const _displayName = this.props.selectedContact
                && this.props.selectedContact.name
                && this.props.selectedContact.name.trim()
                ? this.props.selectedContact.name.trim()
                : null;

            return shell(
                <>
                    <View style={styles.titleContainer}>
                        <Text style={containerStyles.title}>Delete contact</Text>
                    </View>

                    {/* Compose the prompt as "<Name>" on one line +
                        "<uri>" on a second, smaller line below. Two
                        lines reads more clearly than a single
                        run-on sentence when both fields are
                        present, and degrades cleanly to just the
                        URI line when the contact has no name. */}
                    <Text style={styles.body}>
                        Are you sure you want to delete this contact?
                    </Text>
                    {_displayName ? (
                        <Text style={[styles.body, { fontWeight: '600', marginTop: 6 }]}>
                            {_displayName}
                        </Text>
                    ) : null}
                    <Text style={[styles.body, { color: '#666', marginTop: _displayName ? 0 : 6 }]}>
                        {_displayUri}
                    </Text>

                    <View style={styles.buttonRow}>
                        {/* Explicit Cancel — the tap-outside-to-dismiss
                            area on this card is tiny on phones, so users
                            need an obvious escape hatch that doesn't
                            risk hitting Delete by mistake. */}
                        <Button
                            mode="outlined"
                            style={styles.button}
                            onPress={this.props.close}
                            accessibilityLabel="Cancel"
                        >
                            Cancel
                        </Button>
                        <Button
                            mode="contained"
                            style={[
                                styles.button,
                                deleteLabel.includes('Confirm') && { backgroundColor: 'red' }
                            ]}
                            onPress={this.deleteContactAction}
                            icon="delete"
                            accessibilityLabel="Delete"
                        >
                            {deleteLabel}
                        </Button>
                    </View>
                </>
            );
        }

        return shell(
            <>
                <View style={styles.titleContainer}>
                    <Text style={containerStyles.title}>
                        {this.props.myself && !this.props.selectedContact ? 'Wipe device' : 'Delete messages'}
                    </Text>
                </View>

                {this.props.uri ? (
                    <Text style={styles.body}>
                        Messages exchanged with {remote_label}:
                    </Text>
                ) : (
                    <Text style={styles.body}>
                        Delete Sylk data from this device.
                        {"\n"}{"\n"}
                        Messages will remain on the server. To delete messages on the server too, you must delete individually all contacts.
                    </Text>
                )}

                {this.state.deleteContact && (
                    <Text style={styles.body}>This includes all file transfers.</Text>
                )}

                <View style={styles.checkBoxRow}>

                    {!this.state.deleteContact && this.props.selectedContact && (
                        <PlatformToggle
                            value={this.state.incoming}
                            onValueChange={this.toggleIncoming}
                            label="Incoming"
                            style={styles.checkBoxRow}
                        />
                    )}

                    {!this.state.deleteContact && this.props.selectedContact && (
                        <PlatformToggle
                            value={this.state.outgoing}
                            onValueChange={this.toggleOutgoing}
                            label="Outgoing"
                            style={styles.checkBoxRow}
                        />
                    )}

                </View>
                {this.renderPeriodDropdown()}

                {!this.props.myself && this.props.uri && this.props.filteredMessageIds.length === 0 && false && (
                    <PlatformToggle
                        value={this.state.deleteContact}
                        onValueChange={this.toggleDeleteContact}
                        label="Delete contact"
                        style={styles.checkBoxRow}
                    />
                )}

                {simulate && (
                    <PlatformToggle
                        value={this.state.simulate}
                        onValueChange={this.toggleSimulate}
                        label="Simulate"
                        style={styles.checkBoxRow}
                    />
                )}

                <View style={styles.buttonRow}>
                    {/* Explicit Cancel — see note in the delete-contact
                        branch above. */}
                    <Button
                        mode="outlined"
                        style={styles.button}
                        onPress={this.props.close}
                        accessibilityLabel="Cancel"
                    >
                        Cancel
                    </Button>
                    <Button
                        mode="contained"
                        style={[
                            styles.button,
                            deleteLabel.includes('Confirm') && { backgroundColor: 'red' }
                        ]}
                        onPress={this.deleteMessages}
                        icon="delete"
                        accessibilityLabel="Delete messages"
                    >
                        {deleteLabel}
                    </Button>
                </View>

                {canDeleteRemote && (
                    <PlatformToggle
                        value={this.state.remoteDelete}
                        onValueChange={this.toggleRemoteDelete}
                        label="Also delete remotely"
                        style={styles.checkBoxRow}
                    />
                )}
            </>
        );
    }
}

DeleteHistoryModal.propTypes = {
    show: PropTypes.bool,
    close: PropTypes.func.isRequired,
    uri: PropTypes.string,
    // Used to prettify the URI in the confirmation prompt — strips
    // "@<defaultDomain>" off E.164 phone-number URIs the same way
    // EditContactModal does, so "+40…@sylk.link" prints as "+40…".
    defaultDomain: PropTypes.string,
    deleteMessages: PropTypes.func,
    deleteContact: PropTypes.bool,
    hasMessages: PropTypes.bool,
    myself: PropTypes.bool,
    selectedContact: PropTypes.object,
    filteredMessageIds: PropTypes.array
};

export default DeleteHistoryModal;
