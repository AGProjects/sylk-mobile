import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, Platform } from 'react-native';
import { Chip, Dialog, Portal, Text, Button, Menu, Surface, TextInput, Paragraph, RadioButton, Checkbox, Switch } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;
import UserIcon from './UserIcon';
import {Gravatar, GravatarApi} from 'react-native-gravatar';

import styles from '../assets/styles/DeleteFileTransfers';


class DeleteFileTransfers extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        
        this.state = this.defaultState()
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        let sharedFiles = nextProps.uri in nextProps.sharedFiles ? nextProps.sharedFiles[nextProps.uri]: {};
		if (!this.state.show && nextProps.show) {
			const filter = {incoming: true, 
							outgoing: true, 
							period: this.getPeriodFilterDate(), 
							periodType: 'after'}

			this.props.getFiles(this.props.uri, filter);	
		}

        this.setState({show: nextProps.show,
                       displayName: nextProps.displayName,
                       username: nextProps.uri && nextProps.uri ? nextProps.uri.split('@')[0] : null,
                       uri: nextProps.uri,
                       sharedFiles: sharedFiles,
                       confirm: nextProps.confirm,
                       selectedContact: nextProps.selectedContact
                       });
    }


    defaultState() {
        let sharedFiles = this.props.uri in this.props.sharedFiles ? this.props.sharedFiles[this.props.uri]: {};

        state = {
            displayName: this.props.displayName,
            sharedFiles: sharedFiles,
            show: this.props.show,
            uri: this.props.uri,
            deletePhotos: false,
            deleteVideos: true,
            deleteAudios: true,
            deleteOthers: true,
            incoming: true,
            outgoing: true,
            periodFilterKey: '2',
            periodType: 'after',
            username: this.props.uri && this.props.uri ? this.props.uri.split('@')[0] : null,
            remoteDelete: false,
            confirm: false
        }
		return state;
    }
    
	componentDidMount() {
	    this.setState(this.defaultState());
    }

    deleteMessages(event) {
        event.preventDefault();
        if (this.state.confirm) {
            this.setState({confirm: false, remoteDelete: false});
            const filter = {'photos': this.state.deletePhotos, 
                            'videos': this.state.deleteVideos,
                            'audios': this.state.deleteAudios,
                            'others': this.state.deleteOthers,
                            'incoming': this.state.incoming,
                            'outgoing': this.state.outgoing,
                            'period': this.state.periodFilterKey,
                            'periodType': this.state.periodType
                            }

			const sharedFiles = JSON.parse(JSON.stringify(this.state.sharedFiles));

			if (!this.state.deleteAudios) {
				delete sharedFiles.audios;
			}

			if (!this.state.deleteVideos) {
				delete sharedFiles.videos;
			}

			if (!this.state.deletePhotos) {
				delete sharedFiles.photos;
			}

			if (!this.state.deleteOthers) {
				delete sharedFiles.others;
			}

			const allIds = Array.from(
			  new Set(
				Object.values(sharedFiles).flat() // merge all arrays
			  )
			);

            this.props.deleteFilesFunc(this.state.uri, allIds, this.state.remoteDelete, filter);
            this.props.close();
            this.setState({periodFilterKey: 2, periodType: 'before', incoming: true, outgoing:true, remoteDelete: false });
        } else {
            this.setState({confirm: true});
        }
    }
    
    toggleIncoming() {
        const filter = {incoming: !this.state.incoming, 
                        outgoing: this.state.outgoing, 
                        period: this.getPeriodFilterDate(), 
                        periodType: this.state.periodType}
        this.props.getFiles(this.props.uri, filter);
        this.setState({incoming: !this.state.incoming});
    }

    toggleOutgoing() {
        const filter = {incoming: this.state.incoming, 
                        outgoing: !this.state.outgoing, 
                        period: this.getPeriodFilterDate(), 
                        periodType: this.state.periodType}
    
        this.props.getFiles(this.props.uri, filter);
        this.setState({outgoing: !this.state.outgoing});
    }

    toggleDeletePhotos() {
        this.setState({deletePhotos: !this.state.deletePhotos});
    }

    toggleDeleteVideos() {
        this.setState({deleteVideos: !this.state.deleteVideos});
    }

    toggleDeleteOthers() {
        this.setState({deleteOthers: !this.state.deleteOthers});
    }


    toggleRemoteDelete() {
        this.setState({remoteDelete: !this.state.remoteDelete})
    }

	close() {
		this.setState(this.defaultState());
		this.props.close()
	}

	getPeriodFilterDate(key) {
		if (!key) key = this.state.periodFilterKey;
	
		if (key === 'all') return null;
	
		const num = Number(key);
		if (isNaN(num)) return null;
	
		const now = new Date();
	
		// Create a UTC date at 00:00 local time
		const utcDate = new Date(Date.UTC(
			now.getUTCFullYear(),
			now.getUTCMonth(),
			now.getUTCDate()
		));
	
		// Subtract days, always go back in time
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
	
		return (
			<View style={{ marginVertical: 8, marginLeft: 20, marginRight: 40 }}>
				<Menu
					visible={this.state.menuVisible}
					onDismiss={() => this.setState({ menuVisible: false })}
					anchor={
						<Button
							mode="outlined"
							onPress={() => this.setState({ menuVisible: true })}
							style={{ width: '100%', justifyContent: 'space-between' }}
							contentStyle={{ height: 50 }}
							labelStyle={{ color: 'black' }}
							icon="menu-down"
						>
							{periodOptions.find(opt => opt.key === this.state.periodFilterKey)?.label || 'Select period'}
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
	
								const filter = {
									incoming: this.state.incoming,
									outgoing: this.state.outgoing,
									period: this.getPeriodFilterDate(option.key),
									periodType
								};
	
								this.props.getFiles(this.props.uri, filter);
							}}
							title={option.label}
						/>
					))}
				</Menu>
			</View>
		);
	}

    
    render() {
		const sharedFiles = JSON.parse(JSON.stringify(this.state.sharedFiles));

		if (!this.state.deleteAudios) {
			delete sharedFiles.audios;
		}

		if (!this.state.deletePhotos) {
			delete sharedFiles.photos;
		}

		if (!this.state.deleteVideos) {
			delete sharedFiles.videos;
		}

		if (!this.state.deleteOthers) {
			delete sharedFiles.others;
		}
		
		const allIds = Array.from(
		  new Set(
			Object.values(sharedFiles).flat() // merge all arrays
		  )
		);
        
        let identity = {uri: this.state.uri, displayName: this.state.displayName};
        let canDeleteRemote = this.state.uri && this.state.uri.indexOf('@videoconference') === -1;
        let canDeleteByTime = false;

        let deleteLabel = this.state.confirm ? 'Confirm': 'Delete ' + allIds.length + ' files';
        let remote_label = (this.state.displayName && this.state.displayName !== this.state.uri) ? this.state.displayName : this.state.username;

        let audioFiles = 'audios' in this.state.sharedFiles ? this.state.sharedFiles['audios'].length: 0;
        let videoFiles = 'videos' in this.state.sharedFiles ? this.state.sharedFiles['videos'].length: 0;
        let photoFiles = 'photos' in this.state.sharedFiles ? this.state.sharedFiles['photos'].length: 0;
        let otherFiles = 'others' in this.state.sharedFiles ? this.state.sharedFiles['others'].length: 0;

		const isDisabled = allIds.length === 0;
		const as = 50;
		
        return (
            <Portal>
                <DialogType visible={this.state.show} onDismiss={this.close}>
                    <Surface style={styles.container}>
                        <View style={styles.titleContainer}>
                            <View style={styles.titleContainer}>
                            {this.state.selectedContact ? 
								<View style={styles.avatarContent}>
									{this.state.selectedContact.photo || this.state.selectedContact.email ? (
										<UserIcon size={as} identity={this.state.selectedContact}/>
									) : (
										<Gravatar options={{email: this.state.selectedContact.email, parameters: { "size": as, "d": "mm" }, secure: true}} style={[styles.gravatar, {width: as, height: as}]} />
									)}
								</View>
							: null}

                            </View>

                            <View style={styles.titleContainer}>
                               <Dialog.Title style={styles.title}> Delete files</Dialog.Title>
                           </View>

                        </View>
                        <View>
                             <Text style={styles.body}>
                                 Are you sure you want to delete files exchanged with {remote_label}?
                             </Text>
                        </View>

                        {this.renderPeriodDropdown()}
 
                            {photoFiles ?
                            <View style={styles.checkBoxRow}>
                              {Platform.OS === 'ios' ?
                               <Switch value={this.state.deletePhotos} onValueChange={(value) => this.toggleDeletePhotos()}/>
                               :
                                <Checkbox status={this.state.deletePhotos ? 'checked' : 'unchecked'} onPress={() => {this.toggleDeletePhotos()}}/>
                                }
                             <Text> Delete {photoFiles} photos</Text>
                                </View>
							: null}

                            {videoFiles ?
                            <View style={styles.checkBoxRow}>
                              {Platform.OS === 'ios' ?
                               <Switch value={this.state.deleteVideos} onValueChange={(value) => this.toggleDeleteVideos()}/>
                               :
                                <Checkbox status={this.state.deleteVideos ? 'checked' : 'unchecked'} onPress={() => {this.toggleDeleteVideos()}}/>
                                }
                             <Text> Delete {videoFiles} videos</Text>
                                </View>
							: null}
                            
                            {audioFiles ?
                            <View style={styles.checkBoxRow}>
                              {Platform.OS === 'ios' ?
                               <Switch value={this.state.deleteAudios} onValueChange={(value) => this.toggleDeleteAudios()}/>
                               :
                                <Checkbox status={this.state.deleteAudios ? 'checked' : 'unchecked'} onPress={() => {this.toggleDeleteAudios()}}/>
                                }
                             <Text> Delete {audioFiles} audio recordings</Text>
                                </View>
							: null}

                            { otherFiles?
                            <View style={styles.checkBoxRow}>
                              {Platform.OS === 'ios' ?
                               <Switch value={this.state.deleteOthers} onValueChange={(value) => this.toggleDeleteOthers()}/>
                               :
                                <Checkbox status={this.state.deleteOthers ? 'checked' : 'unchecked'} onPress={() => {this.toggleDeleteOthers()}}/>
                                }
                             <Text> Delete other type of files ({otherFiles})</Text>
                                </View>
							: null}

                            {!isDisabled ?
                            <View style={styles.checkBoxRow}>
                              {Platform.OS === 'ios' ?
                               <Switch value={this.state.incoming} onValueChange={(value) => this.toggleIncoming()}/>
                               :
                                <Checkbox status={this.state.incoming ? 'checked' : 'unchecked'} onPress={() => {this.toggleIncoming()}}/>
                                }
                             <Text> Incoming</Text>
                                </View>
                            : null }

                            {!isDisabled ?
                            <View style={styles.checkBoxRow}>
                              {Platform.OS === 'ios' ?
                               <Switch value={this.state.outgoing} onValueChange={(value) => this.toggleOutgoing()}/>
                               :
                                <Checkbox status={this.state.outgoing ? 'checked' : 'unchecked'} onPress={() => {this.toggleOutgoing()}}/>
                                }
                             <Text> Outgoing</Text>
                                </View>
                            : null }

                            {canDeleteRemote && !isDisabled ?
                            <View style={styles.checkBoxRow}>
                              {Platform.OS === 'ios' ?
                               <Switch value={this.state.remoteDelete} onValueChange={(value) => this.toggleRemoteDelete()}/>
                               :
                                <Checkbox status={this.state.remoteDelete ? 'checked' : 'unchecked'} onPress={() => {this.toggleRemoteDelete()}}/>
                                }
                             <Text> Also delete for {remote_label}</Text>
                                </View>
                            : null
                            }

                        <View style={styles.buttonRow}>

						<Button
						  mode="contained"
						  style={[
							styles.button,
							deleteLabel === 'Confirm' && { backgroundColor: 'red' } // override color if needed
						  ]}
						  onPress={this.deleteMessages}
						  icon="delete"
						  disabled={isDisabled}
						  accessibilityLabel="Delete files"
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

DeleteFileTransfers.propTypes = {
    show               : PropTypes.bool,
    selectedContact    : PropTypes.object,
    close              : PropTypes.func.isRequired,
    uri                : PropTypes.string,
    displayName        : PropTypes.string,
    deleteFilesFunc    : PropTypes.func,
    sharedFiles        : PropTypes.object,
    getFiles           : PropTypes.func
};

export default DeleteFileTransfers;
