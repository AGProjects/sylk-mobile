import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import {
    View,
    ScrollView,
    TouchableOpacity,
    Modal,
    Platform,
    StyleSheet,
    SafeAreaView,
    Linking,
} from 'react-native';
import { Text, Button } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import containerStyles from '../assets/styles/ContainerStyles';

/**
 * QoS call-report viewer. Shows the formatted per-call report (server +
 * client packet counts, reconciliation, verdicts) and lets the user submit it
 * to support via the SAME PGP-encrypted pipeline the Logs modal uses
 * (requestSupportFromLogs).
 */
class QosSummaryModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.state = { sending: false };
    }

    openTrace() {
        const url = this.props.traceUrl;
        if (!url) return;
        Linking.openURL(url).catch((e) =>
            console.log('[qos] open SIP trace failed:', e && e.message));
    }

    async sendToSupport() {
        if (this.state.sending) return;
        this.setState({ sending: true });
        try {
            let body = '[qos] [summary] call ' + (this.props.callid || '?') + '\n\n' + (this.props.report || '');
            // Include the full SIP-trace URL in the support submission (it's
            // hidden from the on-screen report, shown there only as a link).
            if (this.props.traceUrl) {
                body += '\nSIP trace: ' + this.props.traceUrl;
            }
            if (typeof this.props.requestSupportFromLogs === 'function') {
                await this.props.requestSupportFromLogs(body, this.props.account, 'Call Quality of Service report');
            } else {
                console.log('[qos] requestSupportFromLogs prop missing');
            }
        } catch (e) {
            console.log('[qos] send-to-support failed:', e && e.message);
        } finally {
            this.setState({ sending: false });
            if (typeof this.props.close === 'function') this.props.close();
        }
    }

    render() {
        return (
            <Modal
                visible={!!this.props.show}
                animationType="slide"
                onRequestClose={this.props.close}
                presentationStyle="fullScreen"
                supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
            >
                <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
                    {/* Header */}
                    <View style={{
                        flexDirection: 'row',
                        alignItems: 'flex-start',
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: '#e0e0e0',
                    }}>
                        <View style={{ flex: 1, paddingRight: 12 }}>
                            <Text
                                style={[containerStyles.title, { marginBottom: 0 }]}
                                numberOfLines={1}
                                ellipsizeMode="tail"
                            >
                                Quality of Service
                            </Text>
                            {this.props.callid ? (
                                <Text
                                    style={{ fontSize: 11, color: '#666' }}
                                    numberOfLines={1}
                                    ellipsizeMode="middle"
                                >
                                    {this.props.callid}
                                </Text>
                            ) : null}
                        </View>
                        {/* Close — a real flex child of the header row. An
                            absolutely-positioned button at top:8 sat above the
                            SafeAreaView content (under the iOS notch/status bar)
                            where touches don't register, so it couldn't be
                            tapped. As a flex child it's always in the safe,
                            tappable area. */}
                        <TouchableOpacity
                            onPress={this.props.close}
                            accessibilityLabel="Close"
                            hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                            style={{ padding: 8 }}
                        >
                            <Icon name="close" size={26} color="#444" />
                        </TouchableOpacity>
                    </View>

                    {/* Report body — monospace, selectable for copy */}
                    <ScrollView
                        style={{ flex: 1 }}
                        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}
                    >
                        <Text
                            selectable={true}
                            style={{
                                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                                fontSize: 12,
                                lineHeight: 17,
                                color: '#1b1b1b',
                            }}
                        >
                            {this.props.report || ''}
                        </Text>
                    </ScrollView>

                    {/* SIP trace link — opens the CDRTool trace page in a browser */}
                    {this.props.traceUrl ? (
                        <View style={{
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: '#e0e0e0',
                            flexDirection: 'row',
                            alignItems: 'center',
                        }}>
                            <Icon name="open-in-new" size={16} color="#2f80c8" />
                            <Text
                                onPress={this.openTrace}
                                suppressHighlighting={true}
                                style={{ marginLeft: 6, color: '#2f80c8', textDecorationLine: 'underline', fontSize: 13 }}
                            >
                                Open full SIP trace in browser
                            </Text>
                        </View>
                    ) : null}

                    {/* Action row */}
                    <View style={{
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: '#e0e0e0',
                        backgroundColor: '#fff',
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}>
                        <Button
                            mode="outlined"
                            compact
                            onPress={this.props.close}
                            accessibilityLabel="Close QoS report"
                            labelStyle={{ fontSize: 12 }}
                        >
                            Close
                        </Button>
                        <Button
                            mode="contained"
                            compact
                            buttonColor="#6A1B9A"
                            textColor="#ffffff"
                            onPress={this.sendToSupport}
                            accessibilityLabel="Send QoS report to support"
                            icon={this.state.sending ? 'progress-upload' : 'shield-key'}
                            labelStyle={{ fontSize: 12 }}
                            disabled={this.state.sending}
                            loading={this.state.sending}
                        >
                            {this.state.sending ? 'Sending…' : 'Send to support'}
                        </Button>
                    </View>
                </SafeAreaView>
            </Modal>
        );
    }
}

QosSummaryModal.propTypes = {
    show: PropTypes.bool,
    callid: PropTypes.string,
    report: PropTypes.string,
    traceUrl: PropTypes.string,
    account: PropTypes.string,
    requestSupportFromLogs: PropTypes.func,
    close: PropTypes.func,
};

export default QosSummaryModal;
