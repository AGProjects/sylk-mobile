import debug from 'debug';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { View } from 'react-native';
import { Portal, Modal, Surface, Title, Button, Text} from 'react-native-paper';
import dtmf from 'react-native-dtmf';

import styles from '../assets/styles/blink/_DTMFModal.scss';

const DEBUG = debug('blinkrtc:DTMF');
debug.enable('*');

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
                <Modal visible={this.props.show} onDismiss={this.props.hide}>
                    <Surface>
                        <Title className="text-center">DTMF</Title>
                        <View style={styles.container}>
                            <View style={styles.row}>
                                <Button style={styles.button} key="dtmfButton1" onPress={this.sendDtmf.bind(this, '1')}>1</Button>
                                <Button style={styles.button} key="dtmfButton2" onPress={this.sendDtmf.bind(this, '2')}>2</Button>
                                <Button style={styles.button} key="dtmfButton3" onPress={this.sendDtmf.bind(this, '3')}>3</Button>
                            </View>
                            <View style={styles.row}>
                                <Button style={styles.button} key="dtmfButton4" onPress={this.sendDtmf.bind(this, '4')}>4</Button>
                                <Button style={styles.button} key="dtmfButton5" onPress={this.sendDtmf.bind(this, '5')}>5</Button>
                                <Button style={styles.button} key="dtmfButton6" onPress={this.sendDtmf.bind(this, '6')}>6</Button>
                            </View>
                            <View style={styles.row}>
                                <Button style={styles.button} key="dtmfButton7" onPress={this.sendDtmf.bind(this, '7')}>7</Button>
                                <Button style={styles.button} key="dtmfButton8" onPress={this.sendDtmf.bind(this, '8')}>8</Button>
                                <Button style={styles.button} key="dtmfButton9" onPress={this.sendDtmf.bind(this, '9')}>9</Button>
                            </View>
                            <View style={styles.row}>
                                <Button style={styles.button} key="dtmfButtonStar" onPress={this.sendDtmf.bind(this, 'STAR')}>*</Button>
                                <Button style={styles.button} key="dtmfButton0" onPress={this.sendDtmf.bind(this, '0')}>0</Button>
                                <Button style={styles.button} key="dtmfButtonHash" onPress={this.sendDtmf.bind(this, 'POUND')}>#</Button>
                            </View>
                        </View>
                    </Surface>
                </Modal>
            </Portal>
        );
    }
}

DTMFModal.propTypes = {
    show: PropTypes.bool.isRequired,
    hide: PropTypes.func.isRequired,
    call: PropTypes.object,
    callKeepSendDtmf: PropTypes.func.isRequired
};


export default DTMFModal;
