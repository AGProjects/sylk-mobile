import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import MaterialCommunityIcon from '@react-native-vector-icons/material-design-icons';

// ContactsListBanners — the informational strip rendered at the top of the
// contacts-list region in ReadyBox. Extracted out of ReadyBox.render to keep
// the render tree readable. Three independent, mutually-non-exclusive
// banners, each self-gated:
//   • Syncing-contacts pill  — first XCAP contacts import is running.
//   • Do-Not-Disturb pill    — app DND is on; tap to turn it off.
//   • Phonebook-access banner — AB source selected but OS permission denied.
// Purely presentational: ReadyBox passes every gate flag and callback as an
// explicit prop (same pattern as SessionButtonsBar / AudioRecorder).
function ContactsListBanners(props) {
    const {
        // Shared visibility context.
        selectedContact,
        shareToContacts,
        inviteContacts,
        searchMessages,
        showQRCodeScanner,

        // Syncing pill.
        contactsSyncing,

        // One-time "storage up to date" success banner (first-sync complete).
        storageUpToDate,

        // DND pill.
        appDnd,
        onToggleDnd,

        // Phonebook-permission banner.
        contactSource,
        abPermissionDenied,
        onOpenAppSettings,
    } = props;

    // Common gate shared by the syncing + DND pills: contacts-list view only,
    // and not while the list is repurposed for share / invite / QR / search.
    const inPlainContactsList =
        !selectedContact
        && !shareToContacts
        && !inviteContacts
        && !searchMessages
        && !showQRCodeScanner;

    return (
        <Fragment>
            {/* Initial contact-import indicator. Shown only while the
                first XCAP contacts sync is running (contactsSyncing),
                in the contacts-list view. Reuses the soft-amber pill
                look so it reads as informational. */}
            {contactsSyncing && inPlainContactsList ? (
                <View style={readyBoxSyncingStyles.pill}>
                    <ActivityIndicator size="small" color="#7a5a1d" style={{ marginRight: 8 }} />
                    <Text style={readyBoxSyncingStyles.text}>Syncing contacts…</Text>
                </View>
            ) : null}

            {/* One-time "storage up to date" confirmation. Shown the instant
                the newest journal file lands during the first sync (the most
                recent messages are now on screen); auto-hides after 10s while
                older history keeps backfilling. Soft-green so it reads as a
                success/confirmation, distinct from the amber syncing pill. */}
            {storageUpToDate && inPlainContactsList ? (
                <View style={readyBoxStorageBannerStyles.pill}>
                    <MaterialCommunityIcon
                        name="check-circle-outline"
                        size={18}
                        color="#1d7a3a"
                        style={{ marginRight: 8 }}
                    />
                    <Text style={readyBoxStorageBannerStyles.text}>
                        Blink storage is now up to date!
                    </Text>
                </View>
            ) : null}

            {/* App-DND status pill. Persistent reminder that the
                in-app bell is on and incoming calls are being
                delivered silently. Tapping toggles DND off via
                the same toggleDnd action the navbar bell uses,
                so the user can clear it without scrolling up
                to the header. Scope: contacts-list view only,
                i.e. no contact currently selected — once the
                user opens a chat, the chat header / message
                column take over and the pill would otherwise
                hover above the conversation, which isn't its
                job. Also hidden in invite / share / QR /
                message-search flows where the contacts list
                is repurposed and the pill would crowd the
                modal-style UI. */}
            {appDnd && inPlainContactsList ? (
                <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => {
                        if (typeof onToggleDnd === 'function') {
                            onToggleDnd();
                        }
                    }}
                    style={readyBoxDndPillStyles.pill}
                >
                    <MaterialCommunityIcon
                        name="bell-off-outline"
                        size={18}
                        color="#7a1d1d"
                        style={readyBoxDndPillStyles.pillIcon}
                    />
                    <View style={readyBoxDndPillStyles.pillTextWrap}>
                        <Text style={readyBoxDndPillStyles.pillTitle}>
                            Do Not Disturb is on
                        </Text>
                        <Text style={readyBoxDndPillStyles.pillBody}>
                            Incoming calls arrive silently. Tap to turn off.
                        </Text>
                    </View>
                </TouchableOpacity>
            ) : null}

            {/* "Phonebook access is off" banner. Rendered above
                the contacts list whenever the user has the
                Phonebook source pill selected but the OS has
                refused to surface its permission prompt (denied
                once on iOS, or "don't ask again" on Android).
                The bar explains why the list is empty and gives
                a one-tap path to the OS Sylk preferences page —
                same react-native-permissions openSettings()
                helper the main-menu "App Settings" item uses.
                Hidden in share/invite/message-search workflows
                where the source toggle isn't visible to the
                user anyway. */}
            {contactSource === 'ab'
                && abPermissionDenied
                && !shareToContacts
                && !inviteContacts
                && !searchMessages ? (
                <View style={readyBoxPermissionBannerStyles.banner}>
                    <MaterialCommunityIcon
                        name="account-cancel-outline"
                        size={22}
                        color="#b06000"
                        style={readyBoxPermissionBannerStyles.bannerIcon}
                    />
                    <View style={readyBoxPermissionBannerStyles.bannerTextWrap}>
                        <Text style={readyBoxPermissionBannerStyles.bannerTitle}>
                            Phonebook access is off
                        </Text>
                        <Text style={readyBoxPermissionBannerStyles.bannerBody}>
                            Open Settings to let Sylk read your contacts.
                        </Text>
                    </View>
                    <Button
                        mode="contained"
                        compact={true}
                        onPress={() => {
                            if (typeof onOpenAppSettings === 'function') {
                                onOpenAppSettings();
                            }
                        }}
                        style={readyBoxPermissionBannerStyles.bannerButton}
                        labelStyle={readyBoxPermissionBannerStyles.bannerButtonLabel}
                    >
                        Open Settings
                    </Button>
                </View>
            ) : null}
        </Fragment>
    );
}

ContactsListBanners.propTypes = {
    selectedContact: PropTypes.object,
    shareToContacts: PropTypes.bool,
    inviteContacts: PropTypes.bool,
    searchMessages: PropTypes.bool,
    showQRCodeScanner: PropTypes.bool,

    contactsSyncing: PropTypes.bool,

    storageUpToDate: PropTypes.bool,

    appDnd: PropTypes.bool,
    onToggleDnd: PropTypes.func,

    contactSource: PropTypes.string,
    abPermissionDenied: PropTypes.bool,
    onOpenAppSettings: PropTypes.func,
};

// "Syncing contacts…" strip shown during the first XCAP contacts import.
// Soft amber (informational) so it's distinct from the red DND pill.
const readyBoxSyncingStyles = StyleSheet.create({
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 8,
        marginTop: 6,
        marginBottom: 4,
        paddingVertical: 8,
        paddingHorizontal: 12,
        backgroundColor: '#fcf3e0',
        borderColor: '#f0d9a8',
        borderWidth: 1,
        borderRadius: 20,
    },
    text: {
        color: '#7a5a1d',
        fontSize: 14,
        fontWeight: '600',
    },
});

// "Blink storage is now up to date!" confirmation strip, shown once when the
// first sync's newest journal lands. Soft green = success/confirmation.
const readyBoxStorageBannerStyles = StyleSheet.create({
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 8,
        marginTop: 6,
        marginBottom: 4,
        paddingVertical: 8,
        paddingHorizontal: 12,
        backgroundColor: '#e6f5ec',
        borderColor: '#b6e0c6',
        borderWidth: 1,
        borderRadius: 20,
    },
    text: {
        color: '#1d7a3a',
        fontSize: 14,
        fontWeight: '600',
    },
});

const readyBoxDndPillStyles = StyleSheet.create({
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 8,
        marginTop: 6,
        marginBottom: 4,
        paddingVertical: 8,
        paddingHorizontal: 10,
        backgroundColor: '#fde8e8',
        borderColor: '#f3b8b8',
        borderWidth: 1,
        borderRadius: 20,
    },
    pillIcon: {
        marginRight: 8,
    },
    pillTextWrap: {
        flex: 1,
        minWidth: 0,
    },
    pillTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#7a1d1d',
    },
    pillBody: {
        fontSize: 12,
        color: '#7a1d1d',
        marginTop: 1,
    },
});

const readyBoxPermissionBannerStyles = StyleSheet.create({
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 8,
        marginTop: 6,
        marginBottom: 4,
        paddingVertical: 8,
        paddingHorizontal: 10,
        backgroundColor: '#fff4e0',
        borderColor: '#f1c789',
        borderWidth: 1,
        borderRadius: 8,
    },
    bannerIcon: {
        marginRight: 8,
    },
    bannerTextWrap: {
        flex: 1,
        minWidth: 0,
    },
    bannerTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#5a3700',
    },
    bannerBody: {
        fontSize: 12,
        color: '#5a3700',
        marginTop: 1,
    },
    bannerButton: {
        marginLeft: 10,
        backgroundColor: '#b06000',
    },
    bannerButtonLabel: {
        fontSize: 12,
        color: '#ffffff',
        marginVertical: 4,
        marginHorizontal: 8,
    },
});

export default ContactsListBanners;
