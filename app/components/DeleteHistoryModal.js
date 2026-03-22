import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, Platform, Text } from 'react-native';
import UserIcon from './UserIcon';
import { Dialog, Portal, Button, Surface, Switch, Checkbox } from 'react-native-paper';
import { Menu } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

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
        this.setState({
            show: nextProps.show,
            deleteContact: nextProps.deleteContact,
            confirm: nextProps.confirm,
            confirm_again: nextProps.confirm_again,
            simulate: nextProps.simulate || false,
            periodType: nextProps.periodType,
        });
        
        if ('show' in nextProps) {
            this.setState({ show: nextProps.show });
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
	
		return (
			<View style={{ marginVertical: 8, marginLeft: 20, marginRight: 40 }}>
				<View
					style={{
						borderWidth: 1,
						borderColor: '#ccc',
						borderRadius: 8,
						overflow: 'hidden',
						justifyContent: 'center',
						height: 50
					}}
				>
					<Menu
						visible={this.state.menuVisible}
						onDismiss={() => this.setState({ menuVisible: false })}
						anchor={
							<Button
								mode="outlined"
								onPress={() => this.setState({ menuVisible: true })}
								contentStyle={{ height: 48 }}
								labelStyle={{ color: 'black' }}
								style={{ width: '100%', justifyContent: 'space-between' }}
								icon="menu-down"
							>
								{
									periodOptions.find(opt => opt.key === this.state.periodFilterKey)?.label ||
									'Select period'
								}
							</Button>
						}
					>
						{periodOptions.map(option => (
							<Menu.Item
								key={option.key}
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
								title={option.label}
							/>
						))}
					</Menu>
				</View>
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
        
        if ((!this.props.hasMessages && this.props.uri) || this.state.deleteContact) {
            return (
                <Portal>
                    <DialogType visible={this.state.show} onDismiss={this.props.close}>
                            <View style={styles.titleContainer}>
                                <Dialog.Title style={styles.title}>Delete contact</Dialog.Title>
                            </View>

                            <Text style={styles.body}>
                                Are you sure you want to delete {this.props.uri}?
                            </Text>

                            <View style={styles.buttonRow}>
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
                    </DialogType>
                </Portal>
            );
        }

        return (
            <Portal>
                <DialogType visible={this.state.show} onDismiss={this.props.close}>
                        <View style={styles.titleContainer}>
                            <Dialog.Title style={styles.title}>
                                {this.props.myself && !this.props.selectedContact ? 'Wipe device' : 'Delete messages'}
                            </Dialog.Title>
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
                            <View style={styles.checkBoxRow}>
                                {Platform.OS === 'ios' ? (
                                    <Switch value={this.state.incoming} onValueChange={this.toggleIncoming} />
                                ) : (
                                    <Checkbox
                                        status={this.state.incoming ? 'checked' : 'unchecked'}
                                        onPress={this.toggleIncoming}
                                    />
                                )}
                                <Text> Incoming</Text>
                            </View>
                        )}

                        {!this.state.deleteContact && this.props.selectedContact && (
                            <View style={styles.checkBoxRow}>
                                {Platform.OS === 'ios' ? (
                                    <Switch value={this.state.outgoing} onValueChange={this.toggleOutgoing} />
                                ) : (
                                    <Checkbox
                                        status={this.state.outgoing ? 'checked' : 'unchecked'}
                                        onPress={this.toggleOutgoing}
                                    />
                                )}
                                <Text> Outgoing</Text>
                            </View>
                        )}

						</View>
                        {this.renderPeriodDropdown()}

                        {!this.props.myself && this.props.uri && this.props.filteredMessageIds.length === 0 && false && (
                            <View style={styles.checkBoxRow}>
                                {Platform.OS === 'ios' ? (
                                    <Switch value={this.state.deleteContact} onValueChange={this.toggleDeleteContact} />
                                ) : (
                                    <Checkbox
                                        status={this.state.deleteContact ? 'checked' : 'unchecked'}
                                        onPress={this.toggleDeleteContact}
                                    />
                                )}
                                <Text> Delete contact</Text>
                            </View>
                        )}

                        {simulate && (
                            <View style={styles.checkBoxRow}>
                                {Platform.OS === 'ios' ? (
                                    <Switch value={this.state.simulate} onValueChange={this.toggleSimulate} />
                                ) : (
                                    <Checkbox
                                        status={this.state.simulate ? 'checked' : 'unchecked'}
                                        onPress={this.toggleSimulate}
                                    />
                                )}
                                <Text> Simulate</Text>
                            </View>
                        )}

                        <View style={styles.buttonRow}>
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
                            <View style={styles.checkBoxRow}>
                                {Platform.OS === 'ios' ? (
                                    <Switch value={this.state.remoteDelete} onValueChange={this.toggleRemoteDelete} />
                                ) : (
                                    <Checkbox
                                        status={this.state.remoteDelete ? 'checked' : 'unchecked'}
                                        onPress={this.toggleRemoteDelete}
                                    />
                                )}
                                <Text> Also delete remotely</Text>
                            </View>
                        )}

                </DialogType>
            </Portal>
        );
    }
}

DeleteHistoryModal.propTypes = {
    show: PropTypes.bool,
    close: PropTypes.func.isRequired,
    uri: PropTypes.string,
    deleteMessages: PropTypes.func,
    deleteContact: PropTypes.bool,
    hasMessages: PropTypes.bool,
    myself: PropTypes.bool,
    selectedContact: PropTypes.object,
    filteredMessageIds: PropTypes.array
};

export default DeleteHistoryModal;
