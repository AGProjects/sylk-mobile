import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import { View, Platform, Text } from 'react-native';
import { Dialog, Portal, Button, Menu, Switch, Checkbox } from 'react-native-paper';
import KeyboardAwareDialog from './KeyBoardAwareDialog';
import UserIcon from './UserIcon';

const DialogType = Platform.OS === 'ios' ? KeyboardAwareDialog : Dialog;

import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  container: {
    padding: 10,
    margin: 0,
  },

  titleContainer: {
    flexDirection: 'column', // stack elements vertically
    alignItems: 'center',    // center horizontally
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

  button: {
    margin: 10,
  },

  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingBottom: 20,
  },

  checkBoxRow: {
    flexDirection: 'row',    // align checkbox/switch and text horizontally
    alignItems: 'center',    // vertically center items
    marginLeft: 20,          // spacing from left edge
    marginBottom: 10,        // spacing between rows
  },

  periodDropdownContainer: {
    flexDirection: 'column',
    marginVertical: 8,
    width: '100%',
  },
});

class DeleteFileTransfers extends Component {
  constructor(props) {
    super(props);
    autoBind(this);

    this.state = this.defaultState();
  }

  UNSAFE_componentWillReceiveProps(nextProps) {
    const sharedFiles = nextProps.uri in nextProps.sharedFiles ? nextProps.sharedFiles[nextProps.uri] : {};
    if (!this.state.show && nextProps.show) {
      const filter = {
        incoming: true,
        outgoing: true,
        period: this.getPeriodFilterDate(),
        periodType: 'after',
      };
      this.props.getFiles(nextProps.uri, filter);
    }

    this.setState({
      show: nextProps.show,
      displayName: nextProps.displayName,
      username: nextProps.uri ? nextProps.uri.split('@')[0] : null,
      uri: nextProps.uri,
      sharedFiles,
      confirm: nextProps.confirm,
      selectedContact: nextProps.selectedContact,
    });
  }

  defaultState() {
    const sharedFiles = this.props.uri in this.props.sharedFiles ? this.props.sharedFiles[this.props.uri] : {};
    return {
      displayName: this.props.displayName,
      sharedFiles,
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
      username: this.props.uri ? this.props.uri.split('@')[0] : null,
      remoteDelete: false,
      confirm: false,
    };
  }

  componentDidMount() {
    this.setState(this.defaultState());
  }

  deleteMessages(event) {
    event.preventDefault();
    if (this.state.confirm) {
      this.setState({ confirm: false, remoteDelete: false });

      const filter = {
        photos: this.state.deletePhotos,
        videos: this.state.deleteVideos,
        audios: this.state.deleteAudios,
        others: this.state.deleteOthers,
        incoming: this.state.incoming,
        outgoing: this.state.outgoing,
        period: this.state.periodFilterKey,
        periodType: this.state.periodType,
      };

      const sharedFiles = JSON.parse(JSON.stringify(this.state.sharedFiles));

      if (!this.state.deleteAudios) delete sharedFiles.audios;
      if (!this.state.deleteVideos) delete sharedFiles.videos;
      if (!this.state.deletePhotos) delete sharedFiles.photos;
      if (!this.state.deleteOthers) delete sharedFiles.others;

      const allIds = Array.from(new Set(Object.values(sharedFiles).flat()));

      this.props.deleteFilesFunc(this.state.uri, allIds, this.state.remoteDelete, filter);
      this.props.close();
      this.setState({
        periodFilterKey: '2',
        periodType: 'before',
        incoming: true,
        outgoing: true,
        remoteDelete: false,
      });
    } else {
      this.setState({ confirm: true });
    }
  }

  toggleIncoming() {
    const filter = {
      incoming: !this.state.incoming,
      outgoing: this.state.outgoing,
      period: this.getPeriodFilterDate(),
      periodType: this.state.periodType,
    };
    this.props.getFiles(this.props.uri, filter);
    this.setState({ incoming: !this.state.incoming });
  }

  toggleOutgoing() {
    const filter = {
      incoming: this.state.incoming,
      outgoing: !this.state.outgoing,
      period: this.getPeriodFilterDate(),
      periodType: this.state.periodType,
    };
    this.props.getFiles(this.props.uri, filter);
    this.setState({ outgoing: !this.state.outgoing });
  }

  toggleDeletePhotos() { this.setState({ deletePhotos: !this.state.deletePhotos }); }
  toggleDeleteVideos() { this.setState({ deleteVideos: !this.state.deleteVideos }); }
  toggleDeleteAudios() { this.setState({ deleteAudios: !this.state.deleteAudios }); }
  toggleDeleteOthers() { this.setState({ deleteOthers: !this.state.deleteOthers }); }
  toggleRemoteDelete() { this.setState({ remoteDelete: !this.state.remoteDelete }); }

  close() {
    this.setState(this.defaultState());
    this.props.close();
  }

  getPeriodFilterDate(key) {
    if (!key) key = this.state.periodFilterKey;
    if (key === 'all') return null;
    const num = Number(key);
    if (isNaN(num)) return null;

    const now = new Date();
    const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
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
      { key: '-365', label: 'Older than one year' },
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
                if (!isNaN(num) && num < 0) periodType = 'before';

                this.setState({ periodFilterKey: option.key, periodType, menuVisible: false });
                const filter = { incoming: this.state.incoming, outgoing: this.state.outgoing, period: this.getPeriodFilterDate(option.key), periodType };
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
    if (!this.state.deleteAudios) delete sharedFiles.audios;
    if (!this.state.deleteVideos) delete sharedFiles.videos;
    if (!this.state.deletePhotos) delete sharedFiles.photos;
    if (!this.state.deleteOthers) delete sharedFiles.others;

    const allIds = Array.from(new Set(Object.values(sharedFiles).flat()));
    const deleteLabel = this.state.confirm ? 'Confirm' : `Delete ${allIds.length} files`;
    const remote_label = this.state.displayName && this.state.displayName !== this.state.uri ? this.state.displayName : this.state.username;
    const audioFiles = 'audios' in this.state.sharedFiles ? this.state.sharedFiles.audios.length : 0;
    const videoFiles = 'videos' in this.state.sharedFiles ? this.state.sharedFiles.videos.length : 0;
    const photoFiles = 'photos' in this.state.sharedFiles ? this.state.sharedFiles.photos.length : 0;
    const otherFiles = 'others' in this.state.sharedFiles ? this.state.sharedFiles.others.length : 0;
    const canDeleteRemote = this.state.uri && !this.state.uri.includes('@videoconference');
    const isDisabled = allIds.length === 0;

    return (
      <Portal>
        <DialogType visible={this.state.show} onDismiss={this.close}>
          <View style={styles.titleContainer}>
            <Dialog.Title style={styles.title}>Delete files</Dialog.Title>
          </View>

          <Text style={styles.body}>
            Select the files exchanged with {remote_label} that you want to delete: 
          </Text>

          {this.renderPeriodDropdown()}

          {photoFiles ? (
            <View style={styles.checkBoxRow}>
              {Platform.OS === 'ios' ? (
                <Switch value={this.state.deletePhotos} onValueChange={this.toggleDeletePhotos} />
              ) : (
                <Checkbox status={this.state.deletePhotos ? 'checked' : 'unchecked'} onPress={this.toggleDeletePhotos} />
              )}
              <Text style={{ marginLeft: 8 }}>Delete {photoFiles} photos</Text>
            </View>
          ) : null}

          {videoFiles ? (
            <View style={styles.checkBoxRow}>
              {Platform.OS === 'ios' ? (
                <Switch value={this.state.deleteVideos} onValueChange={this.toggleDeleteVideos} />
              ) : (
                <Checkbox status={this.state.deleteVideos ? 'checked' : 'unchecked'} onPress={this.toggleDeleteVideos} />
              )}
              <Text style={{ marginLeft: 8 }}>Delete {videoFiles} videos</Text>
            </View>
          ) : null}

          {audioFiles ? (
            <View style={styles.checkBoxRow}>
              {Platform.OS === 'ios' ? (
                <Switch value={this.state.deleteAudios} onValueChange={this.toggleDeleteAudios} />
              ) : (
                <Checkbox status={this.state.deleteAudios ? 'checked' : 'unchecked'} onPress={this.toggleDeleteAudios} />
              )}
              <Text style={{ marginLeft: 8 }}>Delete {audioFiles} audio recordings</Text>
            </View>
          ) : null}

          {otherFiles ? (
            <View style={styles.checkBoxRow}>
              {Platform.OS === 'ios' ? (
                <Switch value={this.state.deleteOthers} onValueChange={this.toggleDeleteOthers} />
              ) : (
                <Checkbox status={this.state.deleteOthers ? 'checked' : 'unchecked'} onPress={this.toggleDeleteOthers} />
              )}
              <Text style={{ marginLeft: 8 }}>Delete other type of files ({otherFiles})</Text>
            </View>
          ) : null}

            <View style={styles.checkBoxRow}>
              {Platform.OS === 'ios' ? (
                <Switch value={this.state.incoming} onValueChange={this.toggleIncoming} />
              ) : (
                <Checkbox status={this.state.incoming ? 'checked' : 'unchecked'} onPress={this.toggleIncoming} />
              )}
              <Text style={{ marginLeft: 8 }}>Incoming</Text>
            </View>

            <View style={styles.checkBoxRow}>
              {Platform.OS === 'ios' ? (
                <Switch value={this.state.outgoing} onValueChange={this.toggleOutgoing} />
              ) : (
                <Checkbox status={this.state.outgoing ? 'checked' : 'unchecked'} onPress={this.toggleOutgoing} />
              )}
              <Text style={{ marginLeft: 8 }}>Outgoing</Text>
            </View>

          {canDeleteRemote && !isDisabled ? (
            <View style={styles.checkBoxRow}>
              {Platform.OS === 'ios' ? (
                <Switch value={this.state.remoteDelete} onValueChange={this.toggleRemoteDelete} />
              ) : (
                <Checkbox status={this.state.remoteDelete ? 'checked' : 'unchecked'} onPress={this.toggleRemoteDelete} />
              )}
              <Text style={{ marginLeft: 8 }}>Also delete for {remote_label}</Text>
            </View>
          ) : null}

          <View style={styles.buttonRow}>
            <Button
              mode="contained"
              style={[styles.button, this.state.confirm && { backgroundColor: 'red' }]}
              onPress={this.deleteMessages}
              icon="delete"
              disabled={isDisabled}
              accessibilityLabel="Delete files"
            >
              {deleteLabel}
            </Button>
          </View>
        </DialogType>
      </Portal>
    );
  }
}

DeleteFileTransfers.propTypes = {
  show: PropTypes.bool,
  selectedContact: PropTypes.object,
  close: PropTypes.func.isRequired,
  uri: PropTypes.string,
  displayName: PropTypes.string,
  deleteFilesFunc: PropTypes.func,
  sharedFiles: PropTypes.object,
  getFiles: PropTypes.func,
};

export default DeleteFileTransfers;
