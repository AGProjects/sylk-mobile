import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, Platform, Text } from 'react-native';
import UserIcon from './UserIcon';
import { Dialog, Portal, Button, Surface, Switch, Checkbox } from 'react-native-paper';
import { Menu } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;
import styles from '../assets/styles/blink/_DeleteHistoryModal.scss';

class DeleteHistoryModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            displayName: this.props.displayName,
            show: this.props.show,
            uri: this.props.uri,
            username: this.props.uri ? this.props.uri.split('@')[0] : null,
            periodFilterKey: '2',
            periodType: 'after',
            remoteDelete: true,
            deleteContact: false,
            confirm: false,
            confirm_again: false,
            incoming: false,
            outgoing: true,
            myself: this.props.myself,
            hasMessages: this.props.hasMessages,
            filteredMessageIds: this.props.filteredMessageIds,
            selectedContact: this.props.selectedContact,
            simulate: false,
        };
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({
            show: nextProps.show,
            displayName: nextProps.displayName,
            username: nextProps.uri ? nextProps.uri.split('@')[0] : null,
            uri: nextProps.uri,
            deleteContact: nextProps.deleteContact,
            confirm: nextProps.confirm,
            confirm_again: nextProps.confirm_again,
            hasMessages: nextProps.hasMessages,
            myself: nextProps.myself,
            simulate: nextProps.simulate || false,
            periodType: nextProps.periodType,
            selectedContact: nextProps.selectedContact,
            filteredMessageIds: nextProps.filteredMessageIds
        });
        
        if ('show' in nextProps) {
            this.setState({ show: nextProps.show });
        }
    }

    deleteMessages(event) {
        event.preventDefault();
        if (this.state.confirm_again) {
            this.setState({ confirm: false, remoteDelete: false, deleteContact: false });

            const filter = {
                period: this.getPeriodFilterDate(),
                periodType: this.state.periodType,
                incoming: this.state.incoming,
                outgoing: this.state.outgoing,
                deleteContact: this.state.deleteContact,
                simulate: this.state.simulate,
                wipe: this.state.myself && !this.state.selectedContact
            };
    
            this.props.deleteMessages(this.state.uri, this.state.remoteDelete, filter);
            this.props.close();
        } else if (this.state.confirm) {
            this.setState({ confirm_again: true }); 
        } else {
            this.setState({ confirm: true });
        }
    }

    deleteContact(event) {
        event.preventDefault();
        if (this.state.confirm_again) {
            this.setState({ confirm: false, remoteDelete: false, deleteContact: false });

            const filter = {
                period: this.getPeriodFilterDate(),
                periodType: this.state.periodType,
                incoming: this.state.incoming,
                outgoing: this.state.outgoing,
                deleteContact: true,
                simulate: this.state.simulate
            };

            this.props.deleteMessages(this.state.uri, this.state.remoteDelete, filter);
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
			{ key: 'all', label: 'All' },
			{ key: '1', label: 'Last day' },
			{ key: '2', label: 'Last two days' },
			{ key: '7', label: 'Last week' },
			{ key: '30', label: 'Last month' },
			{ key: '60', label: 'Last 60 days' },
			{ key: '-92', label: 'Older than three months' },
			{ key: '-365', label: 'Older than one year' }
		];
	
		if (this.state.deleteContact || this.state.myself) {
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
        const identity = { uri: this.state.uri, displayName: this.state.displayName };
        const canDeleteRemote = this.state.uri && !this.state.uri.includes('@videoconference');
        let deleteLabel = 'Delete';
        const remote_label = (this.state.displayName && this.state.displayName !== this.state.uri)
            ? this.state.displayName
            : this.state.username;
        const what = this.state.filteredMessageIds.length > 0
            ? `${this.state.filteredMessageIds.length} selected messages`
            : 'messages';
        const simulate = false;

        if (this.state.confirm) deleteLabel = 'Confirm';
        if (this.state.confirm_again) deleteLabel = 'Confirm again';
        
        if (!this.state.hasMessages && this.state.uri) {
            return (
                <Portal>
                    <DialogType visible={this.state.show} onDismiss={this.props.close}>
                        <Surface style={styles.container}>
                            <View style={styles.titleContainer}>
                                {this.state.uri && <UserIcon style={styles.avatar} identity={identity} />}
                                <Dialog.Title style={styles.title}>Delete contact</Dialog.Title>
                            </View>

                            <Text style={styles.body}>
                                Are you sure you want to delete {this.state.uri}?
                            </Text>

                            <View style={styles.buttonRow}>
                                <Button
                                    mode="contained"
                                    style={[
                                        styles.button,
                                        deleteLabel.includes('Confirm') && { backgroundColor: 'red' }
                                    ]}
                                    onPress={this.deleteContact}
                                    icon="delete"
                                    accessibilityLabel="Delete"
                                >
                                    {deleteLabel}
                                </Button>
                            </View>
                        </Surface>
                    </DialogType>
                </Portal>
            );
        }

        return (
            <Portal>
                <DialogType visible={this.state.show} onDismiss={this.props.close}>
                    <Surface style={styles.container}>
                        <View style={styles.titleContainer}>
                            {this.state.uri && <UserIcon style={styles.avatar} identity={identity} />}
                            <Dialog.Title style={styles.title}>
                                {this.state.myself && !this.state.selectedContact ? 'Wipe device' : 'Delete messages'}
                            </Dialog.Title>
                        </View>

                        {this.state.uri ? (
                            <Text style={styles.body}>
                                Select what {what} with {remote_label} would you like to delete
                            </Text>
                        ) : (
                            <Text style={styles.body}>
                                Delete all messages from this device.
                                {"\n"}{"\n"}
                                Messages will remain on the server. To delete messages on the server too, you must delete individually all contacts.
                            </Text>
                        )}

                        {this.state.deleteContact && (
                            <Text style={styles.body}>This includes all file transfers.</Text>
                        )}

                        {this.renderPeriodDropdown()}

                        {!this.state.deleteContact && this.state.selectedContact && (
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

                        {!this.state.deleteContact && this.state.selectedContact && (
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
                                <Text> Also delete for {remote_label}</Text>
                            </View>
                        )}

                        {!this.state.myself && this.state.uri && this.state.filteredMessageIds.length === 0 && (
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
                    </Surface>
                </DialogType>
            </Portal>
        );
    }
}

DeleteHistoryModal.propTypes = {
    show: PropTypes.bool,
    close: PropTypes.func.isRequired,
    uri: PropTypes.string,
    displayName: PropTypes.string,
    deleteMessages: PropTypes.func,
    deleteContactFunc: PropTypes.func,
    hasMessages: PropTypes.bool,
    myself: PropTypes.bool,
    selectedContact: PropTypes.object,
    filteredMessageIds: PropTypes.array
};

export default DeleteHistoryModal;
