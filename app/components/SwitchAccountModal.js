import React, { Component } from 'react';
import PropTypes from 'prop-types';
import autoBind from 'auto-bind';
import {
    View,
    Platform,
    Text,
    Modal,
    ScrollView,
    Pressable,
    StyleSheet,
} from 'react-native';
import { Button, Surface, Divider } from 'react-native-paper';

// Match the rounded-corner card + dimmed backdrop used by the other
// confirmation dialogs (DeleteAccountModal, DeleteHistoryModal, etc.)
// so the sign-out flow visually belongs to the same family.
import containerStyles from '../assets/styles/ContainerStyles';

const styles = StyleSheet.create({
    body: {
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: 6,
        fontSize: 16,
        textAlign: 'center',
    },
    currentAccount: {
        paddingHorizontal: 20,
        paddingTop: 4,
        paddingBottom: 12,
        fontSize: 16,
        textAlign: 'center',
        fontWeight: 'bold',
    },
    sectionLabel: {
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: 4,
        fontSize: 14,
        textAlign: 'center',
        color: '#555',
    },
    signOutNote: {
        // Caveat shown right above the Cancel/Sign-out row. Same
        // muted tone as sectionLabel so it reads as informational
        // rather than alarming; the destructive intent is carried
        // by the red Sign-out button below.
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 4,
        fontSize: 13,
        textAlign: 'center',
        color: '#666',
        fontStyle: 'italic',
    },
    accountList: {
        // Cap so the modal doesn't grow unbounded when many accounts
        // are stored. Anything past this height scrolls.
        maxHeight: 240,
        paddingHorizontal: 16,
        paddingTop: 6,
        paddingBottom: 6,
    },
    accountRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 8,
    },
    accountText: {
        flex: 1,
        fontSize: 15,
        marginRight: 12,
    },
    switchButton: {
        // Compact button so longer URIs still leave room for it.
        minWidth: 100,
    },
    divider: {
        marginVertical: 4,
        marginHorizontal: 16,
    },
    button: {
        margin: 10,
    },
    buttonRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        paddingBottom: 16,
        paddingTop: 4,
    },
});

/**
 * Sign-out confirmation dialog.
 *
 * Behaviour:
 *   - If more than one known account (account/password pair) is stored
 *     in the local accounts table, the dialog offers a "Switch" action
 *     for each of the OTHER accounts in addition to the Sign-out
 *     confirmation. Switching is functionally identical to signing out
 *     and signing back in via LoginForm with a different identity —
 *     the parent wires the Switch callback to do exactly that.
 *   - If no other account with a known password exists, the dialog
 *     degenerates to a simple "are you sure you want to sign out?"
 *     confirm.
 *
 * The dialog never closes itself silently — every action either fires
 * one of the parent callbacks (onLogout / onSwitch) or explicitly hits
 * Cancel.
 */
class SwitchAccountModal extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
    }

    // List of accounts (other than the currently signed-in one) that
    // have a stored password we could log in with. Empty-password rows
    // are skipped: switching to them would just bounce the user to the
    // login form, which is no better than a normal logout.
    getOtherAccounts() {
        const map = this.props.accountPasswords || {};
        const currentId = this.props.accountId;
        return Object.keys(map)
            .filter(
                (id) =>
                    id &&
                    id !== currentId &&
                    typeof map[id] === 'string' &&
                    map[id].length > 0
            )
            .sort();
    }

    handleLogout() {
        this.props.close();
        // Defer the parent's logout one tick so the modal-close state
        // update flushes first. Without this the parent's resetState
        // can race with the modal unmount and re-render the now-empty
        // accountId while the dialog is still on screen.
        setTimeout(() => this.props.onLogout(), 0);
    }

    handleSwitch(accountId, password) {
        this.props.close();
        setTimeout(() => this.props.onSwitch(accountId, password), 0);
    }

    handleCancel() {
        this.props.close();
    }

    render() {
        if (!this.props.show) return null;

        const others = this.getOtherAccounts();
        const hasOthers = others.length > 0;
        const accountId = this.props.accountId || '';
        const passwords = this.props.accountPasswords || {};

        return (
            <Modal
                style={containerStyles.container}
                visible={this.props.show}
                transparent
                animationType="fade"
                onRequestClose={this.handleCancel}
            >
                <View style={containerStyles.overlay}>
                    {/* Backdrop dismiss — same pattern PreferencesModal /
                        EditContactModal use. A Pressable that absolute-
                        fills the overlay, rendered BEFORE the Surface in
                        JSX so the Surface ends up on top in z-order. Tap
                        outside the Surface → this Pressable receives the
                        touch → onPress fires → modal closes. Tap on the
                        Surface → Surface (above) absorbs the touch; the
                        Pressable underneath sees nothing.

                        The reason this is structured as a sibling-
                        backdrop rather than wrapping the Surface in a
                        TouchableWithoutFeedback / Pressable is that any
                        tap-handler wrapping the Surface ends up in a
                        responder fight with the inner ScrollView (the
                        "Switch to another account" list) on Android.
                        The wrapper would claim the responder on touch
                        start, the ScrollView would try to take it back on
                        move, and on Android that hand-off was failing —
                        the user saw the list but swipes did nothing.
                        Decoupling backdrop from card means there is no
                        wrapper to negotiate with: ScrollView is the only
                        responder candidate for vertical pans inside the
                        card, so it always wins. See the matching
                        comment in PreferencesModal.js for the longer
                        write-up. */}
                    <Pressable
                        style={StyleSheet.absoluteFillObject}
                        onPress={this.handleCancel}
                        accessibilityLabel="Close"
                    />
                    <Surface style={containerStyles.modalSurface}>
                        {/* No title here on purpose — the
                            "You are signed in as <id>" body
                            line and the destructive Sign out
                            button below carry the intent
                            without a redundant header. */}
                        <Text style={styles.body}>
                            You are signed in as
                        </Text>
                        <Text style={styles.currentAccount}>
                            {accountId}
                        </Text>

                        {hasOthers ? (
                            <View>
                                <Divider style={styles.divider} />
                                <Text style={styles.sectionLabel}>
                                    Switch to another account
                                </Text>
                                <ScrollView
                                    style={styles.accountList}
                                    contentContainerStyle={{ paddingBottom: 4 }}
                                    keyboardShouldPersistTaps="handled"
                                    nestedScrollEnabled={true}
                                    showsVerticalScrollIndicator={true}
                                    overScrollMode={Platform.OS === 'android' ? 'always' : undefined}
                                    // Same Android gesture-path
                                    // tightening as PreferencesModal:
                                    //   removeClippedSubviews={false}
                                    //     keeps rows mounted so a fast
                                    //     scroll doesn't get dropped
                                    //     mid-pan by a freshly mounted
                                    //     touchable claiming responder.
                                    //   directionalLockEnabled={true}
                                    //     once the pan is vertical,
                                    //     ignore sideways thumb wobble.
                                    //   scrollEventThrottle /
                                    //   decelerationRate
                                    //     keep the feel snappy.
                                    removeClippedSubviews={false}
                                    directionalLockEnabled={true}
                                    scrollEventThrottle={16}
                                    decelerationRate="normal"
                                >
                                    {others.map((id) => (
                                        <View key={id} style={styles.accountRow}>
                                            <Text
                                                style={styles.accountText}
                                                numberOfLines={1}
                                                ellipsizeMode="middle"
                                            >
                                                {id}
                                            </Text>
                                            <Button
                                                mode="contained"
                                                icon="account-switch"
                                                compact
                                                style={styles.switchButton}
                                                accessibilityLabel={`Switch to ${id}`}
                                                onPress={() =>
                                                    this.handleSwitch(
                                                        id,
                                                        passwords[id]
                                                    )
                                                }
                                            >
                                                Switch
                                            </Button>
                                        </View>
                                    ))}
                                </ScrollView>
                                <Divider style={styles.divider} />
                            </View>
                        ) : null}

                        {/* Reachability caveat — surfaced
                            right above the destructive
                            button so it reads in context
                            of the decision the user is
                            about to make. The two
                            consequences (no calls, no
                            push) are the ones most users
                            forget about until they miss
                            a call. */}
                        <Text style={styles.signOutNote}>
                            If you sign out you will not be reachable on this device. Push notifications will be silenced too.
                        </Text>

                        <View style={styles.buttonRow}>
                            <Button
                                mode="outlined"
                                style={styles.button}
                                onPress={this.handleCancel}
                                accessibilityLabel="Cancel"
                            >
                                Cancel
                            </Button>
                            <Button
                                mode="contained"
                                style={[
                                    styles.button,
                                    { backgroundColor: '#c62828' },
                                ]}
                                icon="logout"
                                onPress={this.handleLogout}
                                accessibilityLabel="Sign out"
                            >
                                Sign out
                            </Button>
                        </View>
                    </Surface>
                </View>
            </Modal>
        );
    }
}

SwitchAccountModal.propTypes = {
    show: PropTypes.bool.isRequired,
    close: PropTypes.func.isRequired,
    onLogout: PropTypes.func.isRequired,
    onSwitch: PropTypes.func.isRequired,
    accountId: PropTypes.string,
    accountPasswords: PropTypes.object,
};

export default SwitchAccountModal;
