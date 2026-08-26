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
        if (this._autoDismissTimer) {
            clearTimeout(this._autoDismissTimer);
            this._autoDismissTimer = null;
        }
    }

    componentDidUpdate(prevProps, prevState) {
        // Auto-dismiss timer. This used to be (re)armed inside render(),
        // which only works while the bottom bar is actually rendered.
        // Now that actionless system messages are surfaced on the
        // NavigationBar subtitle line (render() returns null for them),
        // the timer must live here so those messages still time out.
        if (this.state.visible
                && (prevState.visible !== this.state.visible
                    || prevState.message !== this.state.message
                    || prevState.title !== this.state.title)) {
            if (this._autoDismissTimer) clearTimeout(this._autoDismissTimer);
            this._autoDismissTimer = setTimeout(() => {
                if (this.ended) return;
                this.setState({ visible: false, message: null, title: null, action: null });
            }, (this.state.autoDismiss || 4) * 1000);
        }

        // Mirror the current actionless system message up to app.js so
        // NavigationBar can render it on its 2nd (subtitle) line instead
        // of the bottom snackbar. Notifications WITH an action button
        // (missed call, conference invite, uploads) keep using the
        // bottom bar — a tappable action can't live in the navbar
        // subtitle. null clears the navbar line on dismiss.
        if (typeof this.props.onSystemMessageChanged === 'function') {
            const _navbarText = (this.state.visible && !this.state.action)
                ? ((this.state.title ? this.state.title + ' ' : '')
                    + (this.state.message || '')).trim()
                : null;
            if (_navbarText !== this._lastNavbarText) {
                this._lastNavbarText = _navbarText;
                this.props.onSystemMessageChanged(_navbarText);
            }
        }
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
            title: 'Conference invite',
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
            title: 'Missed call',
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
            title: 'Upload successful',
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
                label: 'Show files',
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
        // Actionless system messages are rendered on the NavigationBar's
        // subtitle line while the main navbar is mounted (useNavbar prop,
        // driven by app.js route state). Skip the bottom bar for those;
        // componentDidUpdate has already pushed the text upward. Anything
        // with an action button still renders the bottom bar below.
        if (this.props.useNavbar && !this.state.action) return null;
        const theme = this.props.theme;
        const _txt = (this.state.title ? this.state.title + ' ' : '')
                   + (this.state.message || '');
        return (
            <SafeAreaInsetsContext.Consumer>
                {(insets) => {
                    // Position: the snackbar sits ABOVE the bottom
                    // category bar (which itself sits above the
                    // Android navigation gesture area). The category
                    // bar's pinned height is 36 dp (see ReadyBox's
                    // navigationContainer / showCategoryBar render at
                    // ~line 3166) — match it so the snackbar lands
                    // exactly on top of it.
                    //
                    // On routes that don't render the category bar
                    // (anywhere outside /ready), the snackbar floats
                    // 36 dp above the bottom edge of the SafeAreaView
                    // — slightly inside the safe area but never
                    // colliding with the home indicator (iOS) or the
                    // gesture pill (Android), because the safe area
                    // already pads the SafeAreaView from those.
                    const _categoryBarHeight = 36;
                    // In chat view (a contact conversation is open) the
                    // bottom element is NOT the 36 dp category bar but the
                    // taller message InputToolbar (single-line baseline
                    // ~44–46 dp on Android/iOS — see ContactsListBox's
                    // `customInputToolbar` / styles.inputToolbar, whose
                    // action slots are 44 dp tall). Lift the snackbar to
                    // clear it so the pill always sits ON TOP of whichever
                    // bar is currently pinned to the bottom, never over it.
                    const _chatInputBarHeight = 48;
                    const _bottomOffset = this.props.inChatView
                        ? _chatInputBarHeight
                        : _categoryBarHeight;
                    return (
                        <View
                            pointerEvents="box-none"
                            style={{
                                position: 'absolute',
                                left: 0,
                                right: 0,
                                bottom: _bottomOffset,
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
