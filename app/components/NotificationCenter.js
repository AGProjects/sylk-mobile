import React, { Component } from 'react';
import { View } from 'react-native';
import { ProgressBar, Colors, Snackbar } from 'react-native-paper';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import moment from 'moment';
import autoBind from 'auto-bind';
import styles from '../assets/styles/blink/_StatusBox.scss';
import { Text, withTheme } from 'react-native-paper';

class NotificationCenter extends Component {

    constructor(props) {
        super(props);
        autoBind(this);
        this.state = {
            visible: false,
            message: null,
            title: null,
            autoDismiss: null,
            action: null
        }
        this.ended = false;
    }

    componentDidMount() {
        //console.log('Notification Center mounted');
        this.ended = false;
    }

    componentWillUnmount() {
        //console.log('Notification Center will unmount');
        this.ended = true;
    }

    postSystemNotification(title, options={}) {    // eslint-disable-line space-infix-ops
        if (this.ended) {
            return;
        }

        this.setState({
            visible: true,
            autoDismiss: 5,
            title: title,
            message: options.body,
            action: null
        });
    }

    postConferenceInvite(originator, room, cb) {
        if (this.ended) {
            return;
        }

        const idx = room.indexOf('@');
        if (idx === -1) {
            return;
        }
        const currentDate = moment().format('MMMM Do YYYY [at] HH:mm:ss');
        const action = {
            label: 'Join',
            onPress: () => { cb(room); }
        };
        this.setState({
            visible: true,
            message: `${(originator.displayName || originator.uri)} invited you to join conference room ${room.substring(0, idx)} on ${currentDate}`,
            title: 'Conference Invite',
            autoDismiss: 20,
            action: action,
        });
    }

    postMissedCall(originator, cb) {
        if (this.ended) {
            return;
        }
        const currentDate = moment().format('MMMM Do YYYY [at] HH:mm:ss');
        let action;
		action = {
			label: 'Call',
			onPress: () => { cb(originator.uri); }
		};
        this.setState({
            visible: true,
            message: `From ${(originator.displayName || originator.uri)} <br />On ${currentDate}`,
            title: 'Missed Call',
            autoDismiss: 0,
            action: action
        });
    }

    postFileUploadProgress(filename, cb) {
        this.setState({
            visible: true,
            message: `${filename}`,
            title: 'Uploading file',
            autoDismiss: 0,
            action: {
                label: 'OK',
                onPress: () => cb()
            },
            // children: (
            //     <View>
            //         <ProgressBar
            //             style={{marginTop: '2px'}}
            //             classes={{barColorPrimary: 'blue-bar'}}
            //             variant="determinate"
            //             progress={0}
            //         />
            //     </View>
            // )
        });
    }

    editFileUploadNotification(progress, notification) {
        if (progress === undefined) {
            progress = 100;
        }
        this.setState({
            visible: true,
            message: `${filename}`,
            title: 'Upload Successful',
            autoDismiss: 3,
            action: null
        });
    }

    removeFileUploadNotification(notification) {
        let timer = setTimeout(() => {
            this.setState({visible: false});
        }, 3000);
    }

    removeNotification(notification) {
        this.setState({visible: false});
    }

    postFileUploadFailed(filename) {
        this.setState({
            visible: true,
            message: `Uploading of ${filename} failed`,
            title: 'File sharing failed',
            autoDismiss: 10,
            action: null
        });
    }

    postFileShared(file, cb) {
        const uploader = file.uploader.displayName || file.uploader.uri || file.uploader;

        this.setState({
            visible: true,
            message: `${uploader} shared ${file.filename}`,
            title: 'File shared',
            autoDismiss: 10,
            action: {
                label: 'Show Files',
                onPress: () => cb()
            }
        });
    }

    render() {
        // Paper's Snackbar wraps content in an inner Surface that adds
        // its own ~8 dp margin + 10 dp padding regardless of what we
        // pass via the `style` prop, so the pill kept reading as ~40 dp
        // tall. Replace it with a plain absolute-positioned View pinned
        // to the screen bottom so we can match the lower category
        // navbar's 36 dp height exactly. State / action handling stays
        // the same (auto-dismiss via setTimeout below).
        if (!this.state.visible) return null;
        if (this._autoDismissTimer) clearTimeout(this._autoDismissTimer);
        this._autoDismissTimer = setTimeout(() => {
            this.setState({ visible: false, message: null, title: null });
        }, (this.state.autoDismiss || 4) * 1000);
        const theme = this.props.theme;
        const _txt = (this.state.title ? this.state.title + ' ' : '')
                   + (this.state.message || '');
        return (
            <SafeAreaInsetsContext.Consumer>
                {(insets) => {
                    // NotificationCenter is mounted INSIDE app.js's
                    // SafeAreaView (see render at ~line 30359), so
                    // absolute bottom:0 already sits ABOVE the iOS
                    // home-indicator safe area — same anchor as the
                    // category bar. Earlier we added insets.bottom
                    // here thinking the parent was unconstrained;
                    // that pushed the snackbar another ~34dp too
                    // high on iOS. Reverted to a flat 0.
                    return (
                        <View
                            pointerEvents="box-none"
                            style={{
                                position: 'absolute',
                                left: 0,
                                right: 0,
                                bottom: 0,
                                height: 36,
                                backgroundColor: '#333',
                                paddingHorizontal: 12,
                                flexDirection: 'row',
                                alignItems: 'center',
                                zIndex: 9999,
                                elevation: 20,
                            }}
                        >
                            <Text
                                numberOfLines={1}
                                ellipsizeMode="tail"
                                style={{ color: '#fff', fontSize: 13, flex: 1 }}
                            >
                                {_txt}
                            </Text>
                            {this.state.action ? (
                                <Text
                                    onPress={() => {
                                        try {
                                            if (this.state.action && typeof this.state.action.onPress === 'function') {
                                                this.state.action.onPress();
                                            }
                                        } catch (e) {}
                                        this.setState({ visible: false, message: null, title: null });
                                    }}
                                    style={{ color: '#42A5F5', fontSize: 13, fontWeight: 'bold', marginLeft: 12 }}
                                >
                                    {this.state.action.label}
                                </Text>
                            ) : null}
                        </View>
                    );
                }}
            </SafeAreaInsetsContext.Consumer>
        );
    }
}


export default withTheme(NotificationCenter);
