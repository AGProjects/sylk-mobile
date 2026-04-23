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
  ScrollView,
} from 'react-native';
import { Button, Surface, Switch, Checkbox } from 'react-native-paper';
import UserIcon from './UserIcon';
import utils from '../utils';

// Share the Modal + overlay + Surface shell with EditContactModal /
// ShareLocationModal / ActiveLocationSharesModal / DeleteHistoryModal so
// every dialog has the same rounded-corner card on a dimmed backdrop.
// Dropped the old Paper Dialog/Portal wrapper that rendered with a
// slightly different corner radius and elevation.
import containerStyles from '../assets/styles/ContainerStyles';

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
    marginLeft: 10,          // spacing from left edge
    marginBottom: 5,        // spacing between rows
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
    this.setState({
      show: nextProps.show,
      confirm: nextProps.confirm
    });
  }

	componentDidUpdate(prevProps, prevState) {
	     if (this.state.show != prevState.show) {
	         console.log('show', this.state.show);
	         if (this.state.show) {
				  const filter = {
					incoming: true,
					outgoing: true,
					period: this.getPeriodFilterDate(),
					periodType: 'after',
				  };
				  console.log('Filter', filter);
				  this.props.getTransferedFiles(this.props.uri, filter);
			  }
	     }
   }	     

  defaultState() {
    return {
      transferedFiles: {},
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
      remoteDelete: false,
      confirm: false,
    };
  }

  componentDidMount() {
    this.setState(this.defaultState());
  }

  deleteMessages(event) {
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

      const transferedFiles = JSON.parse(JSON.stringify(this.props.transferedFiles));

      if (!this.state.deleteAudios) delete transferedFiles.audios;
      if (!this.state.deleteVideos) delete transferedFiles.videos;
      if (!this.state.deletePhotos) delete transferedFiles.photos;
      if (!this.state.deleteOthers) delete transferedFiles.others;

      const allIds = Array.from(new Set(Object.values(transferedFiles).flat()));

      this.props.deleteFilesFunc(this.props.uri, allIds, this.state.remoteDelete, filter);
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
    this.props.getTransferedFiles(this.props.uri, filter);
    this.setState({ incoming: !this.state.incoming });
  }

  toggleOutgoing() {
    const filter = {
      incoming: this.state.incoming,
      outgoing: !this.state.outgoing,
      period: this.getPeriodFilterDate(),
      periodType: this.state.periodType,
    };
    this.props.getTransferedFiles(this.props.uri, filter);
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
      { key: 'all', label: 'Any time' },
      { key: '1', label: 'Last day' },
      { key: '2', label: 'Last two days' },
      { key: '7', label: 'Last week' },
      { key: '30', label: 'Last month' },
      { key: '60', label: 'Last 60 days' },
      { key: '-92', label: 'Older than three months' },
      { key: '-365', label: 'Older than one year' },
    ];

    // Inline dropdown (see matching comment in DeleteHistoryModal).
    // Paper's `Menu` popup portals to the app-root host, which on iOS
    // sits behind the RN `<Modal>` — so the picker disappears under
    // the dialog. Adding `Portal.Host` here would fix the layering but
    // Paper's PortalHost wraps children in a flex:1 View that collapses
    // the modal Surface. Rendering the options inline below the button
    // gives us the same UX without any portal acrobatics.
    const selected = periodOptions.find(opt => opt.key === this.state.periodFilterKey);
    return (
      <View style={{ marginVertical: 8, marginLeft: 20, marginRight: 40 }}>
        <Button
          mode="outlined"
          onPress={() => this.setState({ menuVisible: !this.state.menuVisible })}
          style={{ width: '100%', justifyContent: 'space-between' }}
          contentStyle={{ height: 50 }}
          labelStyle={{ color: 'black' }}
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
                style={{ justifyContent: 'flex-start', borderRadius: 0 }}
                contentStyle={{ justifyContent: 'flex-start', height: 40 }}
                labelStyle={{
                  color: option.key === this.state.periodFilterKey ? '#1976d2' : 'black',
                  textAlign: 'left',
                }}
                onPress={() => {
                  let periodType = 'after';
                  const num = Number(option.key);
                  if (!isNaN(num) && num < 0) periodType = 'before';

                  this.setState({ periodFilterKey: option.key, periodType, menuVisible: false });
                  const filter = { incoming: this.state.incoming, outgoing: this.state.outgoing, period: this.getPeriodFilterDate(option.key), periodType };
                  this.props.getTransferedFiles(this.props.uri, filter);
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
    const transferedFiles = JSON.parse(JSON.stringify(this.props.transferedFiles));
    if (!this.state.deleteAudios) delete transferedFiles.audios;
    if (!this.state.deleteVideos) delete transferedFiles.videos;
    if (!this.state.deletePhotos) delete transferedFiles.photos;
    if (!this.state.deleteOthers) delete transferedFiles.others;

    const allIds = Array.from(new Set(Object.values(transferedFiles).flat()));
    const deleteLabel = this.state.confirm ? 'Confirm' : `Delete ${allIds.length} files`;
    const remote_label = this.props.selectedContact ? (this.props.selectedContact.displayName || this.props.selectedContact.uri): this.props.uri;
    const audioFiles = 'audios' in this.props.transferedFiles ? this.props.transferedFiles.audios.length : 0;
    const videoFiles = 'videos' in this.props.transferedFiles ? this.props.transferedFiles.videos.length : 0;
    const photoFiles = 'photos' in this.props.transferedFiles ? this.props.transferedFiles.photos.length : 0;
    const otherFiles = 'others' in this.props.transferedFiles ? this.props.transferedFiles.others.length : 0;
    const canDeleteRemote = this.props.uri && !this.props.uri.includes('@videoconference') && this.state.outgoing;
    const isDisabled = allIds.length === 0;

    const photoSize = this.props.transferedFilesSizes?.photos ?? 0;
    const videoSize = this.props.transferedFilesSizes?.videos ?? 0;
    const audioSize = this.props.transferedFilesSizes?.audios ?? 0;
    const otherSize = this.props.transferedFilesSizes?.others ?? 0;

    return (
      <Modal
        style={containerStyles.container}
        // Coerce to boolean. RN's Modal treats `visible={undefined}`
        // as visible (it does NOT default to false), and the parent's
        // initial state may not include this flag — so without `!!`
        // the modal would pop up on cold start.
        visible={!!this.state.show}
        transparent
        animationType="fade"
        onRequestClose={this.close}
      >
        <TouchableWithoutFeedback onPress={this.close}>
          <View style={containerStyles.overlay}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
            >
              {/* Block dismiss when taps land inside the card. */}
              <TouchableWithoutFeedback onPress={() => {}}>
                <Surface style={containerStyles.modalSurface}>
                  <ScrollView
                    style={{ maxHeight: 520 }}
                    keyboardShouldPersistTaps="handled"
                  >
                    <View style={styles.titleContainer}>
                      <Text style={containerStyles.title}>Delete files</Text>
                    </View>

                    <Text style={styles.body}>
                      Files exchanged with {remote_label}:
                    </Text>

                    <View style={styles.checkBoxRow}>
                      <View style={styles.checkBoxRow}>
                        {Platform.OS === 'ios' ? (
                          <Switch value={this.state.outgoing} onValueChange={this.toggleOutgoing} />
                        ) : (
                          <Checkbox status={this.state.outgoing ? 'checked' : 'unchecked'} onPress={this.toggleOutgoing} />
                        )}
                        <Text style={{ marginLeft: 8 }}>Outgoing</Text>
                      </View>

                      <View style={styles.checkBoxRow}>
                        {Platform.OS === 'ios' ? (
                          <Switch value={this.state.incoming} onValueChange={this.toggleIncoming} />
                        ) : (
                          <Checkbox status={this.state.incoming ? 'checked' : 'unchecked'} onPress={this.toggleIncoming} />
                        )}
                        <Text style={{ marginLeft: 8 }}>Incoming</Text>
                      </View>
                    </View>

                    {this.renderPeriodDropdown()}

                    {photoFiles ? (
                      <View style={styles.checkBoxRow}>
                        {Platform.OS === 'ios' ? (
                          <Switch value={this.state.deletePhotos} onValueChange={this.toggleDeletePhotos} />
                        ) : (
                          <Checkbox status={this.state.deletePhotos ? 'checked' : 'unchecked'} onPress={this.toggleDeletePhotos} />
                        )}
                        <Text style={{ marginLeft: 8 }}>{photoFiles} photos ({utils.beautySize(photoSize)})</Text>
                      </View>
                    ) : null}

                    {videoFiles ? (
                      <View style={styles.checkBoxRow}>
                        {Platform.OS === 'ios' ? (
                          <Switch value={this.state.deleteVideos} onValueChange={this.toggleDeleteVideos} />
                        ) : (
                          <Checkbox status={this.state.deleteVideos ? 'checked' : 'unchecked'} onPress={this.toggleDeleteVideos} />
                        )}
                        <Text style={{ marginLeft: 8 }}>{videoFiles} videos ({utils.beautySize(videoSize)})</Text>
                      </View>
                    ) : null}

                    {audioFiles ? (
                      <View style={styles.checkBoxRow}>
                        {Platform.OS === 'ios' ? (
                          <Switch value={this.state.deleteAudios} onValueChange={this.toggleDeleteAudios} />
                        ) : (
                          <Checkbox status={this.state.deleteAudios ? 'checked' : 'unchecked'} onPress={this.toggleDeleteAudios} />
                        )}
                        <Text style={{ marginLeft: 8 }}>{audioFiles} audio recordings ({utils.beautySize(audioSize)})</Text>
                      </View>
                    ) : null}

                    {otherFiles ? (
                      <View style={styles.checkBoxRow}>
                        {Platform.OS === 'ios' ? (
                          <Switch value={this.state.deleteOthers} onValueChange={this.toggleDeleteOthers} />
                        ) : (
                          <Checkbox status={this.state.deleteOthers ? 'checked' : 'unchecked'} onPress={this.toggleDeleteOthers} />
                        )}
                        <Text style={{ marginLeft: 8 }}>{otherFiles} other type ({utils.beautySize(otherSize)})</Text>
                      </View>
                    ) : null}

                    <View style={styles.buttonRow}>
                      {/* Explicit Cancel — the tap-outside-to-dismiss
                          area on this card is tiny on phones, especially
                          with many file-type rows expanded. Give users
                          an obvious escape that's nowhere near the red
                          Delete action. */}
                      <Button
                        mode="outlined"
                        style={styles.button}
                        onPress={this.close}
                        accessibilityLabel="Cancel"
                      >
                        Cancel
                      </Button>
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
                    {canDeleteRemote && !isDisabled ? (
                      <View style={[styles.checkBoxRow, {borderTop: 0.5}]}>
                        {Platform.OS === 'ios' ? (
                          <Switch value={this.state.remoteDelete} onValueChange={this.toggleRemoteDelete} />
                        ) : (
                          <Checkbox status={this.state.remoteDelete ? 'checked' : 'unchecked'} onPress={this.toggleRemoteDelete} />
                        )}
                        <Text style={{ marginLeft: 8 }}>Also delete remotely</Text>
                      </View>
                    ) : null}
                  </ScrollView>
                </Surface>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    );
  }
}

DeleteFileTransfers.propTypes = {
  show: PropTypes.bool,
  selectedContact: PropTypes.object,
  close: PropTypes.func.isRequired,
  uri: PropTypes.string,
  deleteFilesFunc: PropTypes.func,
  transferedFiles: PropTypes.object,
  transferedFilesSizes: PropTypes.object,
  getTransferedFiles: PropTypes.func,
};

export default DeleteFileTransfers;
