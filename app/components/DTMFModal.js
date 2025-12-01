import debug from 'debug';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { View } from 'react-native';
import { Portal, Dialog, Surface, Title, Button, Text} from 'react-native-paper';
import dtmf from 'react-native-dtmf';
import { StyleSheet } from 'react-native';

const DEBUG = debug('blinkrtc:DTMF');
//debug.enable('*');

const styles = StyleSheet.create({
  container: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    paddingTop: 10,
    paddingBottom: 30,
  },

  row: {
    flex: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    userSelect: 'none', // may not work on all platforms
    marginHorizontal: 'auto', // RN doesn’t support auto; see note below
    paddingTop: 5,
    height: 70,
  },

buttonContent: {
  height: 60,
  alignItems: "center",
  justifyContent: "center",
},

  button: {
    width: 60,
    height: 60,
    marginLeft: 10,
    marginRight: 10,
    marginBottom: 10,
    borderRadius: 10,
    borderWidth: 1,
    paddingTop: 0,
    paddingBottom: 0,
  },

key: {
  fontSize: 18,
  color: '#000'   // or white if using dark mode
}
});


class DTMFModal extends Component {
    sendDtmf(tone) {
        DEBUG('DTMF tone was sent: ' + tone);

        dtmf.stopTone();//don't play a tone at the same time as another
        dtmf.playTone(dtmf['DTMF_' + tone], 500);

        if (this.props.call !== null && this.props.call.state === 'established') {
            this.props.callKeepSendDtmf(tone);
        }
    }

    render() {
        return (
            <Portal>
                <Dialog visible={this.props.show} onDismiss={this.props.hide}>
                        <Dialog.Title className="text-center">DTMF dialpad</Dialog.Title>
                        <View style={styles.container}>
                            <View style={styles.row}>
                                <Button mode="outlined" contentStyle={styles.buttonContent} labelStyle={styles.key} style={styles.button} onPress={this.sendDtmf.bind(this, '1')}>1</Button>
                                <Button mode="outlined" contentStyle={styles.buttonContent} labelStyle={styles.key} style={styles.button} onPress={this.sendDtmf.bind(this, '2')}>2</Button>
                                <Button mode="outlined" contentStyle={styles.buttonContent} labelStyle={styles.key} style={styles.button} onPress={this.sendDtmf.bind(this, '3')}>3</Button>
                            </View>
                            <View style={styles.row}>
                                <Button mode="outlined" contentStyle={styles.buttonContent} labelStyle={styles.key} style={styles.button} onPress={this.sendDtmf.bind(this, '4')}>4</Button>
                                <Button mode="outlined" contentStyle={styles.buttonContent} labelStyle={styles.key} style={styles.button} onPress={this.sendDtmf.bind(this, '5')}>5</Button>
                                <Button mode="outlined" contentStyle={styles.buttonContent} labelStyle={styles.key} style={styles.button} onPress={this.sendDtmf.bind(this, '6')}>6</Button>
                            </View>
                            <View style={styles.row}>
                                <Button mode="outlined" contentStyle={styles.buttonContent} labelStyle={styles.key} style={styles.button} onPress={this.sendDtmf.bind(this, '7')}>7</Button>
                                <Button mode="outlined" contentStyle={styles.buttonContent} labelStyle={styles.key} style={styles.button} onPress={this.sendDtmf.bind(this, '8')}>8</Button>
                                <Button mode="outlined" contentStyle={styles.buttonContent} labelStyle={styles.key} style={styles.button} onPress={this.sendDtmf.bind(this, '9')}>9</Button>
                            </View>
                            <View style={styles.row}>
                                <Button mode="outlined" contentStyle={styles.buttonContent} labelStyle={styles.key} style={styles.button} onPress={this.sendDtmf.bind(this, 'STAR')}>*</Button>
                                <Button mode="outlined" contentStyle={styles.buttonContent} labelStyle={styles.key} style={styles.button} onPress={this.sendDtmf.bind(this, '0')}>0</Button>
                                <Button mode="outlined" contentStyle={styles.buttonContent} labelStyle={styles.key} style={styles.button} onPress={this.sendDtmf.bind(this, 'POUND')}>#</Button>
                            </View>
                        </View>
                </Dialog>
            </Portal>
        );
    }
}

DTMFModal.propTypes = {
    show: PropTypes.bool.isRequired,
    hide: PropTypes.func.isRequired,
    call: PropTypes.object,
    callKeepSendDtmf: PropTypes.func
};


export default DTMFModal;
