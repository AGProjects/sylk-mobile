// NavigationBarModals.js
//
// All of NavigationBar's modal dialogs, grouped into one component so the
// NavigationBar render() stays focused on the app bar itself. These were
// previously ~500 lines of inline siblings inside <Appbar.Header>.
//
// The component receives the NavigationBar instance as `nav` and reads the
// modals' show/close/data off nav.state, nav.props, and nav's methods —
// the same `host` seam the location engine uses — so the modal JSX moved
// verbatim (this.* -> nav.*) with no behavioural change. The handful of
// values render() computes locally (callUrl, showEditModal, conferenceUrl,
// conferenceRoom) are passed as explicit props.

import React, { Fragment } from 'react';
import VersionNumber from 'react-native-version-number';

import AboutModal from './AboutModal';
import ExportDataModal from './ExportDataModal';
import PaymentInfoModal from './PaymentInfoModal';
import CallMeMaybeModal from './CallMeMaybeModal';
import DeleteHistoryModal from './DeleteHistoryModal';
import RefetchMessagesModal from './RefetchMessagesModal';
import DeleteFileTransfers from './DeleteFileTransfers';
import AddContactModal from './AddContactModal';
import EditContactModal from './EditContactModal';
import DeleteAccountModal from './DeleteAccountModal';
import SwitchAccountModal from './SwitchAccountModal';
import PreferencesModal from './PreferencesModal';
import EditConferenceModal from './EditConferenceModal';
import ShareConferenceLinkModal from './ShareConferenceLinkModal';
import ShareLocationModal from './ShareLocationModal';
import LocationPrivacyDisclosureModal from './LocationPrivacyDisclosureModal';
import ActiveLocationSharesModal from './ActiveLocationSharesModal';
import ExportPrivateKeyModal from './ExportPrivateKeyModal';
import GenerateKeysModal from './GenerateKeysModal';

export default function NavigationBarModals({ nav, callUrl, showEditModal, conferenceUrl, conferenceRoom }) {
    return (
        <Fragment>
                <AboutModal
                    show={nav.state.showAboutModal}
                    close={nav.toggleAboutModal}
                    currentVersion={VersionNumber.appVersion}
                    buildId={nav.props.buildId}
                    toggleDevMode={nav.props.toggleDevMode}
                    devMode={nav.props.devMode}
                    onDonate={nav.handleDonateFromAbout}
                />

                <ExportDataModal
                    show={nav.state.showExportDataModal}
                    close={() => nav.setState({ showExportDataModal: false })}
                    accountId={nav.props.accountId}
                    userAgent={nav.props.userAgent}
                    announceDataExport={nav.props.announceDataExport}
                    beginDnd={nav.props.beginDnd}
                    endDnd={nav.props.endDnd}
                />

                {/* Payment information modal — shared between the
                    "Donate…" menu item and the 'Payment required'
                    PSTN branch in app.callStateChanged. show/close
                    come straight from App so both entry points
                    drive a single instance. The `reason` prop
                    selects the template:
                      'donate'           — kebab menu path
                      'credit'           — PSTN error path */}
                <PaymentInfoModal
                    show={nav.props.showPaymentInfoModal}
                    reason={nav.props.paymentInfoReason}
                    paymentAccounts={nav.props.paymentAccounts}
                    close={nav.props.togglePaymentInfoModal}
                />

                <CallMeMaybeModal
                    show={nav.props.showCallMeMaybeModal}
                    close={nav.props.toggleCallMeMaybeModal}
                    callUrl={callUrl}
                    notificationCenter={nav.props.notificationCenter}
                />

                <DeleteHistoryModal
                    show={nav.state.showDeleteHistoryModal}
                    close={nav.closeDeleteHistoryModal}
                    uri={nav.props.selectedContact ? nav.props.selectedContact.uri : null}
                    defaultDomain={nav.props.defaultDomain}
                    hasMessages={nav.hasMessages}
                    deleteMessages={nav.props.deleteMessages}
                    filteredMessageIds={nav.props.filteredMessageIds}
                    selectedContact={nav.props.selectedContact}
                    deleteContact={nav.state.deleteContact}
                    myself={!nav.props.selectedContact || (nav.props.selectedContact && String(nav.props.selectedContact.uri || '').trim().toLowerCase() === String(nav.props.accountId || '').trim().toLowerCase()) ? true : false}
                />

                <RefetchMessagesModal
                    show={nav.state.showRefetchMessagesModal}
                    close={() => nav.setState({ showRefetchMessagesModal: false })}
                    refetchMessages={nav.props.refetchMessages}
                    selectedContact={nav.props.selectedContact}
                />

                <DeleteFileTransfers
                    show={nav.state.showDeleteFileTransfers}
                    close={nav.closeDeleteFileTransfers}
                    selectedContact={nav.props.selectedContact}
                    uri={nav.props.selectedContact ? nav.props.selectedContact.uri : null}
                    deleteFilesFunc={nav.props.deleteFiles}
                    transferedFiles={nav.props.transferedFiles}
                    transferedFilesSizes={nav.props.transferedFilesSizes}
                    getTransferedFiles={nav.props.getTransferedFiles}
                    myself={!nav.props.selectedContact || (nav.props.selectedContact && String(nav.props.selectedContact.uri || '').trim().toLowerCase() === String(nav.props.accountId || '').trim().toLowerCase()) ? true : false}
                />

                <AddContactModal
                    show={nav.state.showAddContactModal}
                    close={nav.toggleAddContactModal}
                    saveContactByUser={nav.props.saveContactByUser}
                    defaultDomain={nav.props.defaultDomain}
                />

                <EditContactModal
                    show={showEditModal}
                    close={nav.hideEditContactModal}
                    accountId={nav.props.accountId}
                    uri={nav.props.selectedContact ? nav.props.selectedContact.uri : nav.props.accountId}
                    defaultDomain={nav.props.defaultDomain}
                    displayName={nav.props.selectedContact ? nav.props.selectedContact.name : nav.props.displayName}
                    selectedContact={nav.props.selectedContact}
                    organization={nav.props.selectedContact ? nav.props.selectedContact.organization : nav.props.organization}
                    email={nav.props.selectedContact ? nav.props.selectedContact.email : nav.props.email}
                    myself={!nav.props.selectedContact || (nav.props.selectedContact && String(nav.props.selectedContact.uri || '').trim().toLowerCase() === String(nav.props.accountId || '').trim().toLowerCase()) ? true : false}
                    saveContactByUser={nav.props.saveContactByUser}
                    contactHasStoredMessages={nav.props.contactHasStoredMessages}
                    /* Union of every group (tag) already used across the
                       address book, so EditContactModal can offer them as
                       tappable suggestions instead of forcing the user to
                       retype "Family" / "Business" by hand each time. */
                    existingGroups={(() => {
                        const set = new Set();
                        (nav.props.allContacts || []).forEach(c => {
                            (c && Array.isArray(c.tags) ? c.tags : []).forEach(t => {
                                const v = (t || '').trim();
                                if (v) set.add(v);
                            });
                        });
                        return Array.from(set);
                    })()}
                    deletePublicKey={nav.props.deletePublicKey}
                    publicKey={nav.state.showPublicKey ? nav.props.publicKey: null}
                    myuuid={nav.props.myuuid}
 				    rejectNonContacts={nav.props.rejectNonContacts}
 				    toggleRejectNonContacts={nav.props.toggleRejectNonContacts}
					rejectAnonymous={nav.props.rejectAnonymous}
 				    toggleRejectAnonymous={nav.props.toggleRejectAnonymous}
					/* chatSounds / toggleChatSounds moved to PreferencesModal. */
					readReceipts={nav.props.readReceipts}
 				    toggleReadReceipts={nav.props.toggleReadReceipts}
 				    storageUsage={nav.props.storageUsage}
 				    deleteAccountUrl={nav.props.deleteAccountUrl}
 				    openDeleteAccount={nav.openDeleteAccountModal}
 				    preferredVideoCodec={nav.props.preferredVideoCodec}
 				    setPreferredVideoCodec={nav.props.setPreferredVideoCodec}
 				    preferredAudioCodec={nav.props.preferredAudioCodec}
 				    enableAudioRecording={nav.props.enableAudioRecording}
 				    encryptionMode={nav.props.encryptionMode}
 				    /* Editable Mobile number on the myself view of
 				       the modal. Read from per-account settings on
 				       open; written back through setAccountSetting
 				       on save. See App.ensurePstnCallerIdCaptured
 				       for the auto-capture path that seeds nav. */
 				    myPhoneNumber={nav.props.myAccountPhoneNumber}
 				    setMyPhoneNumber={nav.props.setMyAccountPhoneNumber}
 				    /* Focus-time SIM lookup. EditContactModal calls
 				       this when the user taps the empty Mobile
 				       field; returns the SIM number after prompting
 				       READ_PHONE_NUMBERS, or '' on iOS / denial /
 				       no MSISDN. Pre-fills the input; Save still
 				       commits via setMyPhoneNumber. */
 				    readDevicePhoneNumber={nav.props.readDevicePhoneNumber}
 				    /* "Add credit" button next to the PSTN credit
 				       row. EditContactModal closes itself first,
 				       then invokes this — we open the PaymentInfo-
 				       Modal in the 'credit' template after the My
 				       Account fade-out so the two Modals never
 				       overlap (RN can't reliably stack them). */
 				    openPaymentInfoModal={nav.props.openPaymentInfoModalCredit}
 				    /* Server-side mobile number, balance and currency
 				       fetched via HTTP Digest from account_info.phtml.
 				       Displayed read-only under the Email field on the
 				       myself view. The modal calls refreshAccountInfo()
 				       on open so the values are current. */
 				    accountInfo={nav.props.accountInfo}
 				    accountInfoError={nav.props.accountInfoError}
 				    refreshAccountInfo={nav.props.refreshAccountInfo}
 				    setServerCallerId={nav.props.setServerCallerId}
 				    accountInfoAvailable={nav.props.accountInfoAvailable}
 				    openSetCallerIdModal={nav.props.openSetCallerIdModal}
 				    /* SIP password change. Empty input on the modal
 				       leaves the password untouched; a non-empty value
 				       triggers the round-trip + local password cache
 				       update on Save. See App.changeSipPassword. */
 				    changeSipPassword={nav.props.changeSipPassword}
 				    currentPassword={nav.props.currentPassword}
 				    /* Mirror the modal's Email field back to the SIP
 				       account record on Save. */
 				    setServerEmail={nav.props.setServerEmail}
                />

                <DeleteAccountModal
                    show={nav.state.showDeleteAccountModal}
                    close={nav.closeDeleteAccountModal}
                    onConfirm={nav.confirmDeleteAccount}
                    accountId={nav.props.accountId}
                    /* Server-side delete URL. Rendered inside the
                       modal as a "Delete account on server…" link
                       (moved from the My Account modal so the local
                       + server delete actions sit together). */
                    deleteAccountUrl={nav.props.deleteAccountUrl}
                    /* In-app primitive that triggers the server's
                       "request deletion" flow (emails a confirm
                       link). When wired AND allowDelete is true,
                       the modal offers the request as a button
                       instead of (or alongside) the external URL. */
                    requestServerDeleteAccount={nav.props.requestServerDeleteAccount}
                    /* Cancel a pending delete request. Modal exposes
                       an Abort button + remaining-time countdown
                       when accountInfo.delete_request != null. */
                    abortServerDeleteAccount={nav.props.abortServerDeleteAccount}
                    /* Latest server-side pending-delete record (or
                       null). Drives the "Pending — confirm by X" UI
                       and feeds expire_date to the countdown. */
                    pendingDeleteRequest={
                        nav.props.accountInfo && nav.props.accountInfo.delete_request
                            ? nav.props.accountInfo.delete_request : null
                    }
                    /* The modal's pickServer handler fires this to
                       refresh the snapshot BEFORE branching between
                       Continue (Request deletion) and Abort. Catches
                       the case where another device or the web
                       Identity tab issued a delete the local
                       snapshot doesn't know about yet. */
                    refreshAccountInfo={nav.props.refreshAccountInfo}
                    /* From the server's allow_delete flag in the
                       snapshot — true when the in-app flow is
                       permitted (email set, balance clean, not in
                       deny-account-delete group). When false the
                       modal falls back to deleteAccountUrl. */
                    allowDelete={nav.props.allowServerDelete}
                    /* Customer-profile email — the address the
                       deletion confirmation link will be sent to
                       (NOT the SIP account's email; see the
                       sylk_settings.phtml request_delete_account
                       handler for the rationale). Surfaced in the
                       Server-confirm screen so the user can see
                       where to look for the link before they
                       commit. */
                    ownerEmail={
                        nav.props.accountInfo
                        && nav.props.accountInfo.owner
                        && nav.props.accountInfo.owner.email
                            ? String(nav.props.accountInfo.owner.email)
                            : ''
                    }
                />

                {/* Sign-out confirmation. When more than one local
                    account/password pair is stored, the modal also
                    surfaces a per-account "Switch" action which is
                    functionally equivalent to signing out and signing
                    back in via LoginForm with the other identity —
                    props.switchAccount on app.js wires that exact
                    behaviour. */}
                <SwitchAccountModal
                    show={nav.state.showSwitchAccountModal}
                    close={() => nav.setState({ showSwitchAccountModal: false })}
                    onLogout={nav.props.logout}
                    onSwitch={nav.props.switchAccount}
                    accountId={nav.props.accountId}
                    accountPasswords={nav.props.accountPasswords}
                />

                <PreferencesModal
                    show={nav.state.showPreferencesModal}
                    close={() => nav.setState({ showPreferencesModal: false })}
                    accountId={nav.props.accountId}
                    preferredVideoCodec={nav.props.preferredVideoCodec}
                    setPreferredVideoCodec={nav.props.setPreferredVideoCodec}
                    videoProfile={nav.props.videoProfile}
                    setVideoProfile={nav.props.setVideoProfile}
                    preferredAudioCodec={nav.props.preferredAudioCodec}
                    setPreferredAudioCodec={nav.props.setPreferredAudioCodec}
                    enableAudioRecording={nav.props.enableAudioRecording}
                    setEnableAudioRecording={nav.props.setEnableAudioRecording}
                    chatSounds={nav.props.chatSounds}
                    toggleChatSounds={nav.props.toggleChatSounds}
                    encryptionMode={nav.props.encryptionMode}
                    setEncryptionMode={nav.props.setEncryptionMode}
                    dtmfMode={nav.props.dtmfMode}
                    setDtmfMode={nav.props.setDtmfMode}
                    telReplaceLeadingZero={nav.props.telReplaceLeadingZero}
                    setTelReplaceLeadingZero={nav.props.setTelReplaceLeadingZero}
                    proximity={nav.props.proximity}
                    toggleProximity={nav.props.toggleProximity}
                    locationTickIntervalSec={nav.props.locationTickIntervalSec}
                    setLocationTickIntervalSec={nav.props.setLocationTickIntervalSec}
                    locationProximityMeters={nav.props.locationProximityMeters}
                    setLocationProximityMeters={nav.props.setLocationProximityMeters}
                    locationPrivacyRadiusMeters={nav.props.locationPrivacyRadiusMeters}
                    setLocationPrivacyRadiusMeters={nav.props.setLocationPrivacyRadiusMeters}
                    themeMode={nav.props.themeMode}
                    setThemeMode={nav.props.setThemeMode}
                    autoDownloadOnWifi={nav.props.autoDownloadOnWifi}
                    setAutoDownloadOnWifi={nav.props.setAutoDownloadOnWifi}
                    autoDownloadOnMobile={nav.props.autoDownloadOnMobile}
                    setAutoDownloadOnMobile={nav.props.setAutoDownloadOnMobile}
                    maxEncryptFileSize={nav.props.maxEncryptFileSize}
                    setMaxEncryptFileSize={nav.props.setMaxEncryptFileSize}
                />

                { nav.state.showEditConferenceModal ?
                <EditConferenceModal
                    show={nav.state.showEditConferenceModal}
                    close={nav.closeEditConferenceModal}
                    room={nav.props.selectedContact ? nav.props.selectedContact.uri.split('@')[0]: ''}
                    displayName={nav.props.selectedContact ? nav.props.selectedContact.name : nav.props.displayName}
                    // Modal reads this as `invitedParties` (its prop
                    // name) — rename here so the existing list of
                    // saved invitees pre-populates the chip row when
                    // re-opening Configure conference on an existing
                    // room. Without this rename the modal only got
                    // `selectedContact.participants` as a fallback,
                    // which works for already-saved rooms but not for
                    // freshly created ones where the caller wants to
                    // hand over an in-memory list.
                    invitedParties={nav.props.selectedContact ? nav.props.selectedContact.participants : []}
                    selectedContact={nav.props.selectedContact}
                    // allContacts feeds the new pill-picker inside the
                    // modal — the user now selects Blink contacts from
                    // a multi-select list rather than typing addresses
                    // free-form, so the modal needs the full contact
                    // roster to filter and display.
                    allContacts={nav.props.allContacts}
                    toggleFavorite={nav.props.toggleFavorite}
                    saveConference={nav.saveConference}
                    defaultDomain={nav.props.defaultDomain}
                    accountId={nav.props.accountId}
                    favoriteUris={nav.props.favoriteUris}
                />
                : null}

                <ShareConferenceLinkModal
                    show={nav.state.showConferenceLinkModal}
                    notificationCenter={nav.props.notificationCenter}
                    close={nav.hideConferenceLinkModal}
                    conferenceUrl={conferenceUrl}
                    conferenceRoom={conferenceRoom}
                    sylkDomain={nav.props.sylkDomain}
                    conferenceSettings={nav.props.conferenceSettings}
                />

                <ShareLocationModal
                    show={nav.state.showShareLocationModal}
                    close={nav.hideShareLocationModal}
                    onConfirm={nav.onShareLocationConfirmed}
                    uri={nav.props.selectedContact ? nav.props.selectedContact.uri : null}
                    displayName={nav.props.selectedContact ? nav.props.selectedContact.name : null}
                    /* Disclaimer suppression. The flag is hydrated on
                       registration (see _hydrateDisclaimerSuppression)
                       and persisted by _suppressShareLocationDisclaimer
                       when the user confirms with the checkbox ticked.
                       It's cleared by the privacy-policy opt-out path
                       so the legal text re-appears the moment the user
                       revokes their disclosure consent. */
                    disclaimerSuppressed={nav.state.shareDisclaimerSuppressed}
                    onSuppressDisclaimer={nav._suppressShareLocationDisclaimer}
                    /* When the share-flow was opened from a chat-bubble's
                       "Meet me there..." kebab on a Google-Maps-link
                       text, pre-select the meet-up option so the user
                       can confirm in one tap. The destination itself
                       lives on nav.state.pendingShareDestination and
                       is consumed by onShareLocationConfirmed.
                       meetMode is true whenever EITHER the destination
                       is staged OR a short URL is mid-resolve — the
                       banner shows "Resolving destination…" until
                       coords arrive. */
                    presetKind={
                        (nav.state.pendingShareDestination
                            || nav.state.pendingShareDestinationUrl)
                        ? 'meetingRequest' : null
                    }
                    meetMode={!!(nav.state.pendingShareDestination
                        || nav.state.pendingShareDestinationUrl)}
                    meetDestination={nav.state.pendingShareDestination}
                    meetDestinationStatus={nav.state.pendingShareDestinationStatus}
                    /* Live user location for the preview map. Fetched
                       in showShareLocationModal as a fire-and-forget
                       getCurrentCoordinates() and updated on the
                       state when it lands. The modal forwards it to
                       StaticMap so the user can see where they are
                       relative to the destination, and (when the
                       privacy slider is non-zero) the circle showing
                       how far they need to move before their position
                       starts shipping over the wire. */
                    userLocation={nav.state.previewUserLocation}
                    /* Local user's display name — drives the
                       initials on the red avatar pin so it shows
                       the user's first letter rather than '?'. */
                    myDisplayName={nav.props.myDisplayName}
                    /* Last-used privacy radius — seeds the slider's
                       initial value when the modal opens, and the
                       modal's onConfirm path calls
                       onPersistPrivacyRadius with whatever the user
                       finally picks so the same value shows up the
                       next time the modal opens. */
                    defaultPrivacyRadiusMeters={
                        Number(nav.props.locationPrivacyRadiusMeters) || 0
                    }
                    onPersistPrivacyRadius={nav.props.setLocationPrivacyRadiusMeters}
                    /* Caregiver flag drives modal defaults: caregivers
                       open with "Until I return" pre-selected and have
                       "Until we meet" hidden (caregivers don't meet
                       up, they keep watch over a trip). The "Until I
                       return" OPTION itself is no longer caregiver-
                       gated — every contact sees it, but caregivers
                       still get it as the default. We check both the
                       localProperties mirror and the tags list so a
                       contact with only one of them set (e.g. legacy
                       tag-only data, or a half-applied multi-device
                       sync) still gets the default — same defensive
                       read pattern toggleAutoAnswer relies on. */
                    isCaregiver={!!(nav.props.selectedContact
                        && ((nav.props.selectedContact.localProperties
                                && nav.props.selectedContact.localProperties.caregiver)
                            || (Array.isArray(nav.props.selectedContact.tags)
                                && nav.props.selectedContact.tags.indexOf('caregiver') > -1)))}
                />

                {/* Google Play Prominent Disclosure. Shown the first time
                    the user starts ANY location share (one-shot, timed,
                    or "Meet me"); subsequent shares skip it via the
                    AsyncStorage flag the modal sets on Continue. The
                    {locationDisclosurePending} state object holds the
                    Promise resolvers that
                    _ensureLocationDisclosureAcknowledged is awaiting,
                    so tapping Continue / Cancel here unblocks the
                    pending share/permission flow. */}
                <LocationPrivacyDisclosureModal
                    show={!!nav.state.locationDisclosurePending}
                    showOptOut={!!(nav.state.locationDisclosurePending
                        && nav.state.locationDisclosurePending.showOptOut)}
                    onContinue={() => {
                        const pending = nav.state.locationDisclosurePending;
                        if (pending && typeof pending.onContinue === 'function') {
                            pending.onContinue();
                        }
                    }}
                    onCancel={() => {
                        const pending = nav.state.locationDisclosurePending;
                        if (pending && typeof pending.onCancel === 'function') {
                            pending.onCancel();
                        }
                    }}
                    onOptOut={() => {
                        const pending = nav.state.locationDisclosurePending;
                        if (pending && typeof pending.onOptOut === 'function') {
                            pending.onOptOut();
                        }
                    }}
                />

                {/* Global "manage active location shares" sheet — opened
                    from the pulsing map-marker indicator in the NavBar.
                    stopShare/stopAll route through stopLocationSharing
                    so the timers, foreground service, state mirror and
                    system-note insertion all stay in sync with every
                    other stop path. */}
                <ActiveLocationSharesModal
                    show={nav.state.showActiveSharesModal}
                    close={() => nav.setState({showActiveSharesModal: false, activeSharesFilterUri: null})}
                    activeShares={nav.state.activeLocationShares}
                    allContacts={nav.props.allContacts}
                    // When set, the modal renders only the current
                    // chat's share (ReadyBox pin entry point). null from
                    // the NavBar indicator so it lists every share.
                    filterUri={nav.state.activeSharesFilterUri}
                    stopShare={(uri) => {
                        nav.stopLocationSharing(uri);
                        // If that was the only share, the effect from
                        // componentDidUpdate (currCount → 0) will close
                        // the modal automatically. Otherwise we leave it
                        // open so the user can stop the next one.
                    }}
                    stopAll={() => {
                        Object.keys(nav.state.activeLocationShares || {})
                            .forEach((uri) => nav.stopLocationSharing(uri));
                    }}
                    /* Pause / Resume bridges. The modal calls these
                       per-row (multi-share) or as the second primary
                       button (single-share). Each routes through the
                       same pauseLocationSharing / resumeLocationSharing
                       methods the bubble kebab and chat-header menu
                       use, so all three entry points stay in sync.
                       getShareState returns 'active' | 'paused' |
                       'stopped' off nav.locationTimers[uri].paused so
                       the modal can label the toggle without mirroring
                       state. We pass originMetadataId from the entry
                       so the multi-share guard inside pause/resume
                       (which protects against pausing the wrong
                       session if a stale row id is used) doesn't trip
                       — the entry knows its own origin. */
                    pauseShare={(uri) => {
                        const _entry = nav.locationTimers && nav.locationTimers[uri];
                        if (_entry) nav.pauseLocationSharing(uri, _entry.originMetadataId);
                    }}
                    resumeShare={(uri) => {
                        const _entry = nav.locationTimers && nav.locationTimers[uri];
                        if (_entry) nav.resumeLocationSharing(uri, _entry.originMetadataId);
                    }}
                    getShareState={(uri) => {
                        const _entry = nav.locationTimers && nav.locationTimers[uri];
                        return nav.getLocationShareState(uri, _entry && _entry.originMetadataId);
                    }}
                />
                
				<ExportPrivateKeyModal
					show={nav.props.showExportPrivateKeyModal}
					password={nav.state.privateKeyPassword}
					close={nav.hideExportPrivateKeyModal}
					exportFunc={nav.props.exportKey|| (() => {})}
					publicKeyHash={nav.props.publicKeyHash}
					publicKey={nav.props.publicKey}
					backup={nav.state.backupKey}
				/>

                <GenerateKeysModal
                    show={nav.state.showGenerateKeysModal}
                    close={nav.hideGenerateKeysModal}
                    generateKeysFunc={nav.props.generateKeysFunc}
                />
        </Fragment>
    );
}
