import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, Platform } from 'react-native';
import UserIcon from './UserIcon';
import { Chip, Dialog, Portal, Text, Button, Surface, TextInput, Paragraph, RadioButton, Checkbox, Switch } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import styles from '../assets/styles/blink/_DeleteFileTransfers.scss';


class DeleteFileTransfers extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        
        this.state = this.defaultState()
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        let sharedFiles = nextProps.uri in nextProps.sharedFiles ? nextProps.sharedFiles[nextProps.uri]: {};

        this.setState({show: nextProps.show,
                       displayName: nextProps.displayName,
                       username: nextProps.uri && nextProps.uri ? nextProps.uri.split('@')[0] : null,
                       uri: nextProps.uri,
                       sharedFiles: sharedFiles,
                       confirm: nextProps.confirm
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
            today: true,
            username: this.props.uri && this.props.uri ? this.props.uri.split('@')[0] : null,
            remoteDelete: false,
            confirm: false
        }
		return state;
    }
    
	componentDidMount() {
	    this.setState(this.defaultState());
		this.props.getFiles(this.props.uri, true, true, true);
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
                            'today': this.state.today
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
            this.setState({today: true, incoming: true, outgoing:true, remoteDelete: false });
        } else {
            this.setState({confirm: true});
        }
    }

    toggleIncoming() {
        this.props.getFiles(this.props.uri, !this.state.incoming, this.state.outgoing, this.state.today);
        this.setState({incoming: !this.state.incoming});
    }

    toggleOutgoing() {
        this.props.getFiles(this.props.uri, this.state.incoming, !this.state.outgoing, this.state.today);
        this.setState({outgoing: !this.state.outgoing});
    }

    toggleToday() {
        this.setState({today: !this.state.today, outgoing: true, incoming:true});
        this.props.getFiles(this.props.uri, this.state.incoming, this.state.outgoing, !this.state.today);
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

        return (
            <Portal>
                <DialogType visible={this.state.show} onDismiss={this.close}>
                    <Surface style={styles.container}>
                        <View style={styles.titleContainer}>
                            <View style={styles.titleContainer}>
                            { this.state.uri ?
                                <UserIcon style={styles.avatar} identity={identity}/>
                            : null}
                            </View>

                            <View style={styles.titleContainer}>
                               <Dialog.Title style={styles.title}>Delete files</Dialog.Title>
                           </View>

                        </View>
                        <View>
                             <Text style={styles.body}>
                                 Are you sure you want to delete files exchanged with {remote_label}?
                             </Text>
                        </View>
 
                            {photoFiles ?
                            <View style={styles.checkBoxRow}>
                              {Platform.OS === 'ios' ?
                               <Switch value={this.state.deletePhotos} onValueChange={(value) => this.toggleDeletePhotos()}/>
                               :
                                <Checkbox status={this.state.deletePhotos ? 'checked' : 'unchecked'} onPress={() => {this.toggleDeletePhotos()}}/>
                                }
                             <Text>Delete {photoFiles} photos</Text>
                                </View>
							: null}

                            {videoFiles ?
                            <View style={styles.checkBoxRow}>
                              {Platform.OS === 'ios' ?
                               <Switch value={this.state.deleteVideos} onValueChange={(value) => this.toggleDeleteVideos()}/>
                               :
                                <Checkbox status={this.state.deleteVideos ? 'checked' : 'unchecked'} onPress={() => {this.toggleDeleteVideos()}}/>
                                }
                             <Text>Delete {videoFiles} videos</Text>
                                </View>
							: null}
                            
                            {audioFiles ?
                            <View style={styles.checkBoxRow}>
                              {Platform.OS === 'ios' ?
                               <Switch value={this.state.deleteAudios} onValueChange={(value) => this.toggleDeleteAudios()}/>
                               :
                                <Checkbox status={this.state.deleteAudios ? 'checked' : 'unchecked'} onPress={() => {this.toggleDeleteAudios()}}/>
                                }
                             <Text>Delete {audioFiles} audio recordings</Text>
                                </View>
							: null}

                            { otherFiles?
                            <View style={styles.checkBoxRow}>
                              {Platform.OS === 'ios' ?
                               <Switch value={this.state.deleteOthers} onValueChange={(value) => this.toggleDeleteOthers()}/>
                               :
                                <Checkbox status={this.state.deleteOthers ? 'checked' : 'unchecked'} onPress={() => {this.toggleDeleteOthers()}}/>
                                }
                             <Text>Delete other type of files ({otherFiles})</Text>
                                </View>
							: null}

                            {!isDisabled ?
                            <View style={styles.checkBoxRow}>
                              {Platform.OS === 'ios' ?
                               <Switch value={this.state.incoming} onValueChange={(value) => this.toggleIncoming()}/>
                               :
                                <Checkbox status={this.state.incoming ? 'checked' : 'unchecked'} onPress={() => {this.toggleIncoming()}}/>
                                }
                             <Text>Incoming</Text>
                                </View>
                            : null }

                            {!isDisabled ?
                            <View style={styles.checkBoxRow}>
                              {Platform.OS === 'ios' ?
                               <Switch value={this.state.outgoing} onValueChange={(value) => this.toggleOutgoing()}/>
                               :
                                <Checkbox status={this.state.outgoing ? 'checked' : 'unchecked'} onPress={() => {this.toggleOutgoing()}}/>
                                }
                             <Text>Outgoing</Text>
                                </View>
                            : null }

                            <View style={styles.checkBoxRow}>
                              {Platform.OS === 'ios' ?
                               <Switch value={this.state.today} onValueChange={(value) => this.toggleToday()}/>
                               :
                                <Checkbox status={this.state.today ? 'checked' : 'unchecked'} onPress={() => {this.toggleToday()}}/>
                                }
                             <Text>Today only</Text>
                                </View>

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
    close              : PropTypes.func.isRequired,
    uri                : PropTypes.string,
    displayName        : PropTypes.string,
    deleteFilesFunc    : PropTypes.func,
    sharedFiles        : PropTypes.object,
    getFiles           : PropTypes.func
};

export default DeleteFileTransfers;
