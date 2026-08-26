import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal, View, Platform, ScrollView, TouchableWithoutFeedback,
  KeyboardAvoidingView, Dimensions, TouchableOpacity, NativeModules, AppState,
} from 'react-native';
import { Text, Button, Divider, SegmentedButtons } from 'react-native-paper';
import Icon from '@react-native-vector-icons/material-design-icons';
import PropTypes from 'prop-types';

import Contacts from 'react-native-contacts';

import ThemedModalSurface from './ThemedModalSurface';
import containerStyles from '../assets/styles/ContainerStyles';

// Do Not Disturb, per contact.
//
// This lived as a single checkbox inside EditContactModal, which was honest
// about neither of the two things it controls:
//
//   Blink's own Do Not Disturb — the bell in the navbar. The `bypassdnd` tag
//     IS the mechanism here, so ticking the box is the whole story. Works on
//     both platforms, needs no OS setup, and is the one we can promise.
//
//   The system's Do Not Disturb / Focus — configured entirely outside the app,
//     by rules the app cannot write and (on iOS) cannot even read. The tag has
//     no influence on it whatsoever.
//
// A checkbox that silently means "definitely this, and maybe that if you also
// did four things in Settings" is worse than no checkbox. So this screen shows
// each mechanism separately, says what is actually true of each, and — where
// the platform allows it — sends the user straight to the screen that needs
// changing instead of describing a route through Settings.
//
// Everything reported here is READ from the OS. Nothing is inferred from the
// tag, because the whole failure mode being fixed is the app claiming a
// bypass it does not have.

const STATUS = {
  ok: { icon: 'check-circle-outline', color: '#2e7d32' },
  warn: { icon: 'alert-circle-outline', color: '#b26a00' },
  info: { icon: 'information-outline', color: '#666666' },
};

function StatusRow({ level, label, value }) {
  const s = STATUS[level] || STATUS.info;
  // Definite width for the text column instead of relying on `flex: 1` alone.
  // The long single-paragraph values -- the starred-contact "Will bypass,
  // because this contact is starred..." line in particular -- were laid out
  // on one line and ran off the right edge of the card. flex:1 only shrinks a
  // child against siblings that have a measured width; the Text itself still
  // reported its full intrinsic line as its preferred size. An explicit
  // maxWidth gives the Text a hard box to wrap inside.
  //
  // Window width minus the horizontal chrome on both sides: overlay padding
  // (16) + surface padding (5) + ScrollView padding (16), then the icon
  // column (16 icon + 10 margin) off the left.
  const _textWidth = Dimensions.get('window').width - (16 + 5 + 16) * 2 - 26;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 12 }}>
      <Icon name={s.icon} size={16} color={s.color} style={{ marginTop: 2, marginRight: 10 }} />
      <View style={{ flex: 1, minWidth: 0, maxWidth: _textWidth }}>
        <Text style={{ fontSize: 13, fontWeight: '600' }}>{label}</Text>
        <Text style={{ fontSize: 12, opacity: 0.8, marginTop: 3, lineHeight: 17,
                       flexShrink: 1, flexWrap: 'wrap' }}>{value}</Text>
      </View>
    </View>
  );
}

// indent: the row-scoped links line up under their status text (26 matches the
// icon column). The standalone Modes link belongs to the section, not to a row,
// so it sits flush left and a little further down -- indenting it under nothing
// made it look like a stray action of whichever row happened to be last.
function ActionLink({ label, onPress, indent = true }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        alignSelf: 'flex-start',
        marginTop: indent ? 8 : 20,
        marginLeft: indent ? 26 : 0,
        paddingVertical: 6,
        paddingRight: 10,
      }}
    >
      <Text style={{ fontSize: indent ? 13 : 14, textDecorationLine: 'underline' }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const DoNotDisturbModal = (props) => {
  const { show, close, uri, displayName, selectedContact, saveContactByUser,
          refreshAddressBook } = props;

  const tags = (selectedContact && Array.isArray(selectedContact.tags))
    ? selectedContact.tags.map((t) => String(t).trim().toLowerCase())
    : [];
  const bypassing = tags.indexOf('bypassdnd') > -1;
  const muted = tags.indexOf('muted') > -1;

  const [check, setCheck] = useState(null);
  const [loading, setLoading] = useState(false);
  // iOS only: Settings > Notifications > Blink. Read separately from the
  // contact-card check because it is about the APP, not this person -- but it
  // gates the same outcome, so it belongs in the same panel.
  const [notif, setNotif] = useState(null);

  // Re-read on every open, and again after we send the user to a native
  // screen: they have almost certainly just changed the thing we are
  // reporting on, and a stale "not set up" would read as the change having
  // failed.
  const refresh = useCallback(() => {
    if (!uri || !show) { return; }
    setLoading(true);
    const done = (r) => { setCheck(r || null); setLoading(false); };
    const fail = (e) => {
      console.log('[dnd] status read failed:', e && e.message);
      setCheck(null);
      setLoading(false);
    };
    try {
      if (Platform.OS === 'android') {
        const m = NativeModules.AndroidSettings;
        if (m && m.getDndBypassStatus) { m.getDndBypassStatus(uri).then(done).catch(fail); return; }
      } else if (Platform.OS === 'ios') {
        const m = NativeModules.APNSTokenModule;
        if (m && m.getNotificationSettings) {
          m.getNotificationSettings()
            .then((n) => setNotif(n || null))
            .catch((e) => {
              console.log('[dnd] notification settings read failed:', e && e.message);
              setNotif(null);
            });
        }
        if (m && m.hasSystemContactForUri) { m.hasSystemContactForUri(uri).then(done).catch(fail); return; }
      }
    } catch (e) {
      fail(e);
      return;
    }
    done(null);
  }, [uri, show]);

  useEffect(() => { refresh(); }, [refresh]);

  // Every link in this panel sends the user to a Settings screen and expects
  // them back. The 1.5s timer in openAndRefresh fires while they are still
  // over there, so on return the panel showed the state from BEFORE the change
  // -- which reads as the change having failed. Re-read on foreground instead,
  // which is the moment the answer can actually have changed.
  useEffect(() => {
    if (!show) { return undefined; }
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') { refresh(); }
    });
    return () => { sub && sub.remove && sub.remove(); };
  }, [show, refresh]);

  // ONE setting with three positions, not two switches.
  //
  // bypassdnd and muted are the two ends of a single decision -- always ring,
  // normal, never ring -- and were always mutually exclusive in the data
  // (editableTags.removeTags cleared one when the other went on). As a pair of
  // switches that rule was invisible: ticking one silently unticked the other,
  // and the illegal both-on state looked reachable right up until it wasn't.
  // A segmented control makes the exclusivity structural instead of enforced.
  const mode = bypassing ? 'bypass' : (muted ? 'mute' : 'default');

  const setMode = (next) => {
    if (next === mode) { return; }
    if (!selectedContact || typeof saveContactByUser !== 'function') { return; }
    const cleaned = tags.filter((t) => t !== 'bypassdnd' && t !== 'muted');
    if (next === 'bypass') { cleaned.push('bypassdnd'); }
    if (next === 'mute') { cleaned.push('muted'); }
    try {
      // saveContactByUser reads the EDITOR shape (displayName/organization/email),
      // not the contact shape. Spell the display name out so this submit can never
      // be read as "the user cleared the name" and blank it on every device.
      saveContactByUser({
        ...selectedContact,
        displayName: selectedContact.name || '',
        organization: selectedContact.organization || '',
        email: selectedContact.email || '',
        tags: cleaned,
      }, selectedContact);
    } catch (e) {
      console.log('[dnd] setMode failed:', e && e.message);
    }

    // Push the same decision down to the OS for messages. With Do Not Disturb
    // access granted, Blink can set bypassDnd on this contact's own
    // conversation channel -- which means the toggle above does the thing it
    // claims without the user visiting Settings or waiting for a message to
    // arrive first. Without the grant this resolves with policyAccess:false and
    // the panel goes on to offer the grant.
    if (Platform.OS === 'android' && NativeModules.AndroidSettings
        && NativeModules.AndroidSettings.applyContactDndBypass) {
      NativeModules.AndroidSettings
        .applyContactDndBypass(uri, displayName || uri, next === 'bypass')
        .then((r) => {
          console.log('[dnd] applyContactDndBypass ->', JSON.stringify(r));
          refresh();
        })
        .catch((e) => console.log('[dnd] applyContactDndBypass failed:', e && e.message));
    }
  };

  const openAndRefresh = (fn) => {
    try {
      const p = fn();
      if (p && typeof p.then === 'function') {
        // Some of these are in-app sheets (the Contacts add-card form), not a
        // trip out to Settings: they resolve when the sheet closes, which is
        // the exact moment the answer changed. The timer below still runs for
        // the ones that leave the app.
        p.then(() => { refresh(); })
         .catch((e) => console.log('[dnd] open failed:', e && e.message));
      }
    } catch (e) {
      console.log('[dnd] open threw:', e && e.message);
    }
    // The user leaves the app here; re-read shortly after so the panel is
    // current when they come back.
    setTimeout(refresh, 1500);
  };

  // No status line for the plain on/off states: the toggles already say it.
  // The muted case gets one because it is NOT obvious -- muting outranks the
  // bell entirely, so these notifications stay silent even when Do Not Disturb
  // is off.
  const modeNote = bypassing
    ? 'Rings even with the bell off.'
    : (muted
        ? 'Stays silent at all times, not just while Do Not Disturb is on.'
        : 'Follows the bell: silenced while Do Not Disturb is on.');

  // ---- system side ----
  // Each row carries its OWN action. Collecting them into one list and
  // rendering them after every row left "Open conversation settings" sitting
  // under the Calls entry, reading as though it were the fix for calls. The
  // link has to belong visibly to the sentence it answers.
  //
  // Messages first, then calls -- that is the order the two rules are usually
  // discovered in, and it matches the order of the sections in the OS.
  const sysRows = [];

  if (Platform.OS === 'android' && check) {
    const convAction = {
      label: 'Open conversation settings',
      run: () => NativeModules.AndroidSettings.openConversationSettings(uri),
    };
    const cardAction = {
      label: 'Open contact card',
      run: () => NativeModules.AndroidSettings.openContactCard(uri),
    };
    // Creates the contact's conversation channel and sets bypassDnd on it in
    // one go. Offered explicitly rather than only as a side effect of the mode
    // switch, because the two states below are dead ends otherwise: with no
    // conversation channel there is nothing in Settings to mark Priority, and
    // "long-press a notification" is useless for someone who has not messaged
    // yet. This is the only route that works before the first message arrives.
    // Only offered when Blink is set to Bypass for this contact. On Default
    // the user has said they do NOT want this person breaking through, so a
    // button that grants them an OS-level exemption contradicts the switch
    // right above it -- and would leave the two disagreeing, with the OS
    // letting through someone Blink is silencing.
    const allowAction = bypassing ? {
      label: 'Allow through Do Not Disturb',
      run: () => NativeModules.AndroidSettings
        .applyContactDndBypass(uri, displayName || uri, true),
    } : null;
    // Wording follows the button: with nothing to tap, "allow them through
    // here" points at empty space.
    const allowHint = bypassing ? 'Allow them through here, or ' : '';

    // The Modes screen is a MODE SELECTOR -- Starred contacts / Contacts /
    // Priority conversations -- not a list anyone can be added to. Sending the
    // user there per contact was pointless: the per-contact act is marking the
    // conversation Priority or starring the card, both of which happen
    // elsewhere. It is now one item at the end, described as the one-time
    // global setting it is.
    //
    // That choice also DECIDES what each contact needs, so reporting the
    // per-contact requirement unconditionally was simply wrong: with Calls set
    // to "Contacts" a matched card is enough and the star is irrelevant, yet
    // this panel would still have said "not starred".
    //
    // Rows that already pass carry no advice at all -- once it will bypass,
    // there is nothing for the user to do and a trailing instruction only
    // invites them to change something that works.

    // ---- messages ----
    //
    // channelBypassDnd is checked FIRST and deliberately so. A channel with
    // canBypassDnd() is exempt from the priority filter outright, so it wins
    // even when People > Messages is set to allow nobody. Testing the senders
    // mode ahead of it reported "blocking all conversations" for a contact
    // that would in fact have rung.
    //
    // conversationSenders, once the channel exemption is out of the way:
    //   'anyone'   : every conversation passes, Priority not required
    //   'important': only Priority conversations pass -- the flag matters
    //   'none'     : nothing passes, whatever we mark
    //   'unknown'  : no policy access; report the flag, claim nothing about the mode
    //
    // Passing states say "Will bypass." and nothing else. Naming the mechanism
    // that carried it is trivia when there is nothing to do about it; the
    // reasons belong on the states the user still has to act on.
    if (!check.supported) {
      sysRows.push({ level: 'info', label: 'Messages',
        value: 'Per-conversation priority needs Android 11 or newer.' });
    } else if (check.channelBypassDnd) {
      sysRows.push({ level: 'ok', label: 'Messages', value: 'Will bypass.' });
    } else if (check.conversationSenders === 'none') {
      sysRows.push({ level: 'warn', label: 'Messages',
        value: 'Modes › Do Not Disturb › People › Messages is set to allow no conversations, so nothing gets through.',
        actions: [allowAction].filter(Boolean) });
    } else if (check.conversationSenders === 'anyone') {
      sysRows.push({ level: 'ok', label: 'Messages', value: 'Will bypass.' });
    } else if (!check.conversationChannelExists) {
      sysRows.push({ level: 'warn', label: 'Messages',
        value: 'Not set up yet. ' + allowHint
          + (allowHint ? 'exchange' : 'Exchange')
          + ' a message first and mark them Priority.',
        actions: [allowAction].filter(Boolean) });
    } else if (!check.priorityConversation) {
      sysRows.push({ level: 'warn', label: 'Messages',
        value: 'Not marked Priority. ' + allowHint
          + (allowHint ? 'long-press' : 'Long-press')
          + ' one of the notifications and choose Priority.',
        actions: [allowAction, convAction].filter(Boolean) });
    } else {
      sysRows.push({ level: 'ok', label: 'Messages', value: 'Will bypass.' });
    }

    // ---- calls ----
    // 'anyone'  : every caller passes
    // 'contacts': any matched card passes, starring irrelevant
    // 'starred' : only starred cards pass -- the star matters
    // 'none'    : nothing passes
    if (check.callSenders === 'none') {
      sysRows.push({ level: 'warn', label: 'Calls',
        value: 'Modes › Do Not Disturb › People › Calls is set to allow no calls, so nothing gets through.' });
    } else if (check.callSenders === 'anyone') {
      sysRows.push({ level: 'ok', label: 'Calls', value: 'Will bypass.' });
    } else if (!check.contactsPermission) {
      sysRows.push({ level: 'info', label: 'Calls',
        value: 'Contacts access is needed to check whether this person is starred.' });
    } else if (!check.contactFound) {
      sysRows.push({ level: 'warn', label: 'Calls',
        value: 'No contact card lists ' + uri + ' as an email, so Do Not Disturb cannot recognise the calls.',
        actions: [{ label: 'Open Contacts',
                    run: () => NativeModules.AndroidSettings.openContacts() }] });
    } else if (check.callSenders === 'contacts') {
      sysRows.push({ level: 'ok', label: 'Calls', value: 'Will bypass.' });
    } else if (!check.contactStarred) {
      sysRows.push({ level: 'warn', label: 'Calls',
        value: 'Open the contact card and star it. Do Not Disturb only lets starred contacts call through.',
        actions: [cardAction] });
    } else {
      // The one passing state that names its cause, because this one is
      // undoable and the user has to know WHAT to undo. The star lives on a
      // shared contact card, so someone who no longer wants these calls
      // breaking through needs to be told where it is, not just that it works.
      sysRows.push({ level: 'ok', label: 'Calls',
        value: 'Will bypass, because this contact is starred. Open the card to unstar.' });
    }

    // The card link belongs on the Calls row whatever it says. Dropping the
    // actions from the passing states took it away exactly when the user is
    // most likely to want it -- to check WHICH of two cards is starred, to
    // unstar, or just to look. A link out is not advice, so it does not
    // disappear when there is nothing left to fix.
    if (check.contactFound && check.contactsPermission) {
      const callsRow = sysRows[sysRows.length - 1];
      if (callsRow && callsRow.label === 'Calls') {
        callsRow.actions = [...(callsRow.actions || [])];
        if (!callsRow.actions.some((a) => a.label === cardAction.label)) {
          callsRow.actions.push(cardAction);
        }
      }
    }

    if (!check.policyAccess) {
      // Two very different consequences depending on the contact's mode, and
      // the old wording only described the milder one. Without the grant we
      // cannot READ the system side -- but more importantly we cannot WRITE
      // the per-contact bypass either, so for a contact set to Bypass the
      // toggle above is currently doing nothing at the OS level. Say that.
      sysRows.push(bypassing
        ? { level: 'warn', label: 'Bypass not applied',
            value: 'Blink needs Do Not Disturb access to let this contact through. Until then the switch above only affects Blink’s own bell.',
            actions: [{ label: 'Grant Do Not Disturb access',
                        run: () => { NativeModules.AndroidSettings.openDndAccessSettings(); } }] }
        : { level: 'info', label: 'Some settings not readable',
            value: 'Grant Blink Do Not Disturb access to confirm the system side as well as the per-contact side.',
            actions: [{ label: 'Grant Do Not Disturb access',
                        run: () => { NativeModules.AndroidSettings.openDndAccessSettings(); } }] });
    }

  } else if (Platform.OS === 'ios' && check) {
    // iOS exposes no read of a Focus's People list and no deep link into it,
    // so the only thing we can verify is the precondition — and it is also
    // the part that usually fails. Everything past that is instructions.
    // Nothing when a card exists. Same rule as Time Sensitive: the panel only
    // reports what needs doing, and "iOS can recognise this person" is the
    // expected state -- saying so out loud just pushes the two instructions
    // that DO need reading further down. Silence here means fine.
    if (check.status === 'found') {
      /* no row */
    } else if (check.status === 'missing') {
      // Prefilled NEW-card sheet, not a silent write. openContactForm presents
      // the system CNContactViewController with the SIP address already in an
      // email field; the user still has to hit Done, and can merge it into an
      // existing person from there. Blink never touches the address book
      // itself -- the same rule as not auto-starring on Android.
      //
      // The email is what matters. iOS matches the CallKit handle and the
      // donated INSendMessageIntent against email fields, so the label is
      // irrelevant and the name is only there so the card is not blank.
      sysRows.push({ level: 'warn', label: 'Contact card',
        value: 'No card in Contacts lists ' + uri + ' as an email. Add it, or Focus can never match this person.',
        actions: [{
          label: 'Add to Contacts',
          run: () => {
            // Only pass a name when it is genuinely a name. Contacts created
            // from a call or a chat carry name === uri, and seeding the card
            // with "alice@sylk.link" as the first name is worse than blank.
            const _n = (displayName || '').trim();
            const _u = (uri || '').trim();
            const _real = _n && _n.toLowerCase() !== _u.toLowerCase() ? _n : '';
            const _parts = _real ? _real.split(/\s+/) : [];
            return Contacts.openContactForm({
              givenName: _parts.length ? _parts[0] : '',
              familyName: _parts.length > 1 ? _parts.slice(1).join(' ') : '',
              emailAddresses: [{ label: 'other', email: _u }],
            }).then((r) => {
              // The address-book snapshot Blink resolves avatars from is taken
              // once per launch, so a card created here is invisible to it --
              // including the photo the user may have just attached. Re-read.
              if (typeof refreshAddressBook === 'function') {
                try {
                  const pr = refreshAddressBook();
                  if (pr && typeof pr.catch === 'function') {
                    pr.catch((e) => console.log('[dnd] address book refresh failed:', e && e.message));
                  }
                } catch (e) {
                  console.log('[dnd] address book refresh threw:', e && e.message);
                }
              }
              return r;
            });
          },
        }] });
    } else {
      sysRows.push({ level: 'info', label: 'Contact card',
        value: 'Contacts access is needed to check this.' });
    }
    // Time Sensitive, per app. This is a real gate and an invisible one: the
    // notification service marks bypassdnd senders time-sensitive, and iOS
    // silently downgrades that to a normal notification when this switch is
    // off. Every other row can be green and messages still will not break
    // through. Reported before the Focus instructions because there is no
    // point following them while this is off.
    //
    // Shown ONLY when it is off. Allowed is the default and the expected
    // state, so a row saying so is one more line to read on a panel that is
    // already long, and it pushes the instructions that DO need reading
    // further down. Silence here means fine.
    const _notifAction = {
      label: 'Open Blink notification settings',
      run: () => NativeModules.APNSTokenModule.openNotificationSettings(),
    };
    if (notif && notif.timeSensitive === 'disabled') {
      sysRows.push({ level: 'warn', label: 'Time Sensitive notifications',
        value: 'Turned off for Blink. Messages from this contact are marked Time Sensitive, '
             + 'and iOS downgrades them to ordinary notifications while this is off — so Focus '
             + 'holds them back whatever the People list says.',
        actions: [_notifAction] });
    } else if (notif && notif.authorization === 'denied') {
      sysRows.push({ level: 'warn', label: 'Notifications',
        value: 'Turned off for Blink entirely. Nothing gets through, Focus or no Focus.',
        actions: [_notifAction] });
    }

    sysRows.push({ level: 'info', label: 'Messages',
      value: 'Settings › Focus › Do Not Disturb › People › Allow Notifications From — add this contact.' });
    // Full path, not "same screen". The two rows are read one at a time -- and
    // often days apart -- so the second one has to stand on its own.
    sysRows.push({ level: 'info', label: 'Calls',
      value: 'Settings › Focus › Do Not Disturb › People › Allow Calls From '
           + '— set it to Favorites (or another group this contact belongs to).' });
  } else if (loading) {
    sysRows.push({ level: 'info', label: 'Checking…', value: 'Reading the current system settings.' });
  } else {
    sysRows.push({ level: 'info', label: 'Not available',
      value: 'The system Do Not Disturb settings could not be read on this device.' });
  }

  // The global mode choice both rows depend on, as a plain link rather than a
  // status row: it reports nothing about this contact, so an icon and a label
  // gave it the weight of a finding when it is only a way out to Settings.
  const showModesLink = Platform.OS === 'android' && !!check;

  const _win = Dimensions.get('window');
  // Two caps, not one. The old code bounded only the ScrollView, which left
  // the KeyboardAvoidingView free to fill the overlay and stretch the Surface
  // with it -- on a small iPhone the card grew past the viewport and the
  // ScrollView, no longer clipped by anything, painted its content outside the
  // card instead of scrolling it. surfaceMaxHeight bounds the card; the
  // ScrollView is then sized to what is left inside it. Same structure as
  // EditContactModal, which had this fixed already.
  const _surfaceMaxHeight = Math.round(_win.height * 0.85);
  const _scrollMaxHeight = _surfaceMaxHeight - 24;

  return (
    <Modal
      style={containerStyles.container}
      visible={!!show}
      transparent
      animationType="fade"
      onRequestClose={close}
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
    >
      <TouchableWithoutFeedback onPress={close}>
        <View style={containerStyles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
            // Without an explicit cap KAV defaults to filling the overlay and
            // dragging the Surface's height along with it.
            style={{ maxHeight: _surfaceMaxHeight, alignSelf: 'center', width: '100%' }}
          >
            <TouchableWithoutFeedback onPress={() => {}}>
              <ThemedModalSurface
                style={[containerStyles.modalSurface, { maxHeight: _surfaceMaxHeight }]}
              >
                {/* Paper warns if overflow:hidden goes on Surface itself (it
                    clips the shadow), so the clip lives on a wrapper View.
                    Do NOT add flex: 1 -- the Surface has maxHeight and no
                    height, so a flexing child collapses to zero and the modal
                    renders as a thin line. */}
                <View style={{ overflow: 'hidden', borderRadius: 10 }}>
                <ScrollView
                  style={{ maxHeight: _scrollMaxHeight }}
                  contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 }}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                >
                  <Text style={containerStyles.title}>Do Not Disturb</Text>
                  {/* Subtitle: the person, under the modal title. Prefer the
                      display name and fall back to the URI -- but only when the
                      name is genuinely a name. Contacts created from a chat or
                      a call get name === uri, so a bare `displayName || uri`
                      still rendered a raw SIP address while claiming to show a
                      name. */}
                  <Text style={{ fontSize: 15, textAlign: 'center', marginBottom: 6 }}>
                    {(() => {
                      const _n = (displayName || '').trim();
                      const _u = (uri || '').trim();
                      return (_n && _n.toLowerCase() !== _u.toLowerCase()) ? _n : _u;
                    })()}
                  </Text>

                  <Divider style={{ marginTop: 10, marginBottom: 8 }} />

                  {/* No "Blink" heading. The three-way switch is the first
                      thing under the contact's name and needs no label -- the
                      OS section below still carries its own, which is what the
                      split was for. */}
                  <SegmentedButtons
                    value={mode}
                    onValueChange={setMode}
                    density="small"
                    buttons={[
                      { value: 'bypass', label: 'Bypass DND', icon: 'bell-ring-outline',
                        labelStyle: { fontSize: 11 } },
                      { value: 'default', label: 'Default', icon: 'bell-outline',
                        labelStyle: { fontSize: 11 } },
                      { value: 'mute', label: 'Mute', icon: 'bell-off-outline',
                        labelStyle: { fontSize: 11 } },
                    ]}
                  />
                  <Text style={{ fontSize: 12, opacity: 0.75, marginTop: 8, lineHeight: 17 }}>
                    {modeNote}
                  </Text>

                  <Divider style={{ marginTop: 16, marginBottom: 8 }} />

                  {/* Sized as a real section header. At 13pt it was the same
                      weight as the status labels underneath it, so the whole
                      panel read as one flat list and the crucial split -- what
                      Blink guarantees vs what the OS controls -- disappeared. */}
                  <Text style={{ fontSize: 17, fontWeight: '700', marginBottom: 4 }}>
                    {Platform.OS === 'ios' ? 'iOS Focus' : 'Phone Do Not Disturb Mode'}
                  </Text>
                  <Text style={{ fontSize: 12, opacity: 0.7, marginBottom: 2 }}>
                    {Platform.OS === 'ios' ? 'iOS' : 'Android'} bypass DND rules are governed by:
                  </Text>

                  {sysRows.map((r, i) => (
                    <React.Fragment key={r.label + i}>
                      <StatusRow level={r.level} label={r.label} value={r.value} />
                      {(r.actions || []).map((act) => (
                        <ActionLink key={act.label} label={act.label}
                                    onPress={() => openAndRefresh(act.run)} />
                      ))}
                    </React.Fragment>
                  ))}

                  {showModesLink ? (
                    <ActionLink
                      label="Open Android Modes"
                      indent={false}
                      onPress={() => openAndRefresh(
                        () => NativeModules.AndroidSettings.openDndPeopleSettings())}
                    />
                  ) : null}

                  {/* Close only. Re-check was redundant: the status is read on
                      every open, and again shortly after any link that leaves
                      for a native screen -- which covers every way the user can
                      change what is being reported. */}
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 26 }}>
                    <Button mode="contained" onPress={close}>
                      Close
                    </Button>
                  </View>
                </ScrollView>
                </View>
              </ThemedModalSurface>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

DoNotDisturbModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func.isRequired,
  uri: PropTypes.string,
  displayName: PropTypes.string,
  selectedContact: PropTypes.object,
  saveContactByUser: PropTypes.func,
  refreshAddressBook: PropTypes.func,
};

export default DoNotDisturbModal;
