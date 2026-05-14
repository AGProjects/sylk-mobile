import React, { useState, useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import {
  Platform,
  View,
  Modal,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import {
  Text,
  Button,
  Surface,
  TextInput,
  Divider,
} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import containerStyles from '../assets/styles/ContainerStyles';
import styles from '../assets/styles/ContentStyles';

// ---------------------------------------------------------------------------
// Conference-invitee normalisation.
//
// Participants flow through the modal as canonical FQDN URIs (e.g.
// "alice@example.com"). The previous text-field UI used a permissive
// sanitizer that:
//   • stripped @defaultDomain so the on-screen string was bare,
//   • silently dropped phone-number rows, IDN, plus-tagged locals.
// The new pill picker only allows the user to add contacts that are
// already present in their Sylk contact list, so the data side just
// needs to:
//   • normalise to lower-case
//   • append the account's default SIP domain if the URI is bare
//   • filter out the user's own account ID (you can't invite yourself).
// ---------------------------------------------------------------------------
const normalizeUri = (raw, accountId, defaultDomain) => {
  if (!raw) return null;
  let uri = String(raw).trim().toLowerCase();
  if (!uri) return null;
  if (uri.indexOf('@') === -1 && defaultDomain) {
    uri = `${uri}@${defaultDomain}`;
  }
  if (accountId && uri === String(accountId).toLowerCase()) {
    return null;
  }
  return uri;
};

// Render-only — what label to show inside the pill for a participant
// URI. Prefer the matching contact's displayName, fall back to the
// bare local part of the URI. Whichever we end up with, we strip
// off any "@domain" suffix: a contact with no display name often
// has its raw "alice@example.com" SIP URI stored in `name`, and
// the pills are width-constrained inside the Surface — keeping
// just the username keeps the pill compact and matches the
// "no @domain in pills" rule the user wants.
const labelForUri = (uri, contactsByUri) => {
  if (!uri) return '';
  const match = contactsByUri[uri];
  let candidate;
  if (match && match.name && String(match.name).trim()) {
    candidate = String(match.name).trim();
  } else {
    candidate = uri;
  }
  const at = candidate.indexOf('@');
  if (at > 0) {
    candidate = candidate.substring(0, at);
  }
  return candidate;
};

// Decide which entries from `allContacts` are valid invite targets.
// Excludes:
//   • the user's own account row (can't invite yourself),
//   • other conference rooms (you don't invite a room into a room),
//   • guest / anonymous URIs (no inbox to reach),
//   • blocked contacts (the user already opted them out),
//   • phone-number rows ("+CC…") — Sylk conference invites are SIP
//     URIs, dialled numbers can't receive them.
//
// Then dedupes by URI. The SQL `contacts` table is keyed by
// (account, contact_id) — NOT by URI — so the same SIP address can
// legitimately appear in `allContacts` more than once (AB-imported
// row alongside the SQL chat row, or duplicate rows left over after a
// merge — the wider codebase tracks this explicitly via a
// `uniqueUris` bucket during load). The picker is a destination list:
// the same SIP target should only show up once, since selecting
// "alice@example.com" twice doesn't mean anything different to the
// conference server. Picking the same URI twice was also the source
// of the React "two children with the same key" warning when the
// ScrollView used the URI as its row key.
//
// When multiple rows share a URI we keep the one with the best
// display data — non-empty `name` wins, and ties are broken by the
// presence of a photo / email so the picker shows a friendly label.
// Sorted by display name afterwards for a stable, readable list.
const filterInvitableContacts = (allContacts, accountId, localDomain) => {
  if (!Array.isArray(allContacts)) return [];
  const accId = accountId ? String(accountId).toLowerCase() : '';
  // Local-domain gate. Cross-domain conference invites aren't
  // currently supported on the server side — only contacts whose
  // SIP domain matches the user's account domain are valid invite
  // targets. Derive the gate from `localDomain` (the defaultDomain
  // prop passed by NavigationBar) when available, otherwise fall
  // back to the domain portion of the user's account ID. Either
  // source agrees in practice; the fallback covers the brief window
  // during account-switch where defaultDomain may not have been
  // re-propagated yet.
  let domainGate = localDomain ? String(localDomain).toLowerCase() : '';
  if (!domainGate && accId.indexOf('@') > -1) {
    domainGate = accId.split('@')[1];
  }
  const filtered = allContacts.filter((c) => {
    if (!c || !c.uri) return false;
    const uri = String(c.uri).toLowerCase();
    if (uri === accId) return false;
    if (uri.indexOf('@videoconference.') > -1) return false;
    if (uri.indexOf('@guest.') > -1) return false;
    if (uri.indexOf('anonymous@') > -1) return false;
    // Phone-number rows can be tagged 'tel' (set in newContact / the
    // address book import path) OR detectable purely from the URI
    // shape (leading '+'). Belt and braces — drop both. Sylk
    // conference invites are SIP URIs and a dialled number can't
    // receive one anyway.
    if (uri.startsWith('+')) return false;
    if (Array.isArray(c.tags)) {
      if (c.tags.indexOf('blocked') > -1) return false;
      if (c.tags.indexOf('tel') > -1) return false;
      // 'test' tags are reserved for QA / developer fixture rows
      // (see EditContactModal.js where the per-contact editable-tags
      // map is zeroed out for any contact carrying the 'test' tag).
      // Those entries aren't real invite targets and clutter the
      // picker — hide them.
      if (c.tags.indexOf('test') > -1) return false;
    }
    // Skip caregivers. A "caregiver" in this app is a contact
    // configured to auto-answer the user's incoming calls (see
    // localProperties.autoanswer wiring in newContact / app.js).
    // Those rows are operator-of-the-app helpers, not people the
    // user would normally invite to a conference room, so they
    // would only clutter the picker.
    if (c.localProperties && c.localProperties.autoanswer === true) return false;
    // Same-domain only. A bare URI (no '@') is also rejected — a
    // valid Sylk contact should always be FQDN; bare entries are
    // typically AB-import artifacts that haven't been resolved
    // yet and aren't safe to invite to a SIP conference.
    if (domainGate) {
      const at = uri.indexOf('@');
      if (at < 0) return false;
      const dom = uri.substring(at + 1);
      if (dom !== domainGate) return false;
    }
    return true;
  });

  // Score a candidate row so we can pick the "best" one when two
  // rows share a URI. Higher score wins. The hierarchy mirrors what
  // a human would prefer to see in the picker: a non-empty display
  // name first, then richer metadata (photo / email).
  const scoreRow = (c) => {
    let s = 0;
    if (c.name && String(c.name).trim()) s += 4;
    if (c.photo) s += 2;
    if (c.email) s += 1;
    return s;
  };

  const byUri = {};
  filtered.forEach((c) => {
    const key = String(c.uri).toLowerCase();
    const existing = byUri[key];
    if (!existing) {
      byUri[key] = c;
      return;
    }
    if (scoreRow(c) > scoreRow(existing)) {
      byUri[key] = c;
    }
  });

  const deduped = Object.values(byUri);
  deduped.sort((a, b) => {
    const an = (a.name || a.uri || '').toLowerCase();
    const bn = (b.name || b.uri || '').toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
  return deduped;
};

const EditConferenceModal = ({
  show,
  close,
  selectedContact,
  displayName: initialDisplayName,
  invitedParties: initialInvited,
  room,
  accountId,
  defaultDomain,
  allContacts,
  saveConference,
}) => {
  // ── State ────────────────────────────────────────────────────
  // `participants` is the canonical list of FQDN URIs to invite
  // when the room is joined. Pills render from this array; the
  // picker mutates it via add/remove. No free-text input.
  const [displayName, setDisplayName] = useState(initialDisplayName || '');
  const [participants, setParticipants] = useState([]);
  // `pickerOpen` swaps the main pane for a contact-picker pane in
  // place (no nested Modal) — keeps the keyboard / overlay layout
  // simple and matches what users expect from a single-screen
  // configuration dialog.
  const [pickerOpen, setPickerOpen] = useState(false);
  // Searchbar value for filtering the contact list inside the
  // picker pane. Local string, lower-cased on use, never persisted.
  const [search, setSearch] = useState('');
  // Optional secondary tag-category filter for the contact list,
  // mirroring the chip filters ReadyBox surfaces above its own
  // contacts list (Favorites / Caregivers / Calls). null means
  // "no extra filter" — only the search text and the
  // filterInvitableContacts exclusions apply. Set by tapping one
  // of the chip controls below the inline contact list. Tapping
  // the same active chip clears it back to null.
  const [tagFilter, setTagFilter] = useState(null);

  // Hydrate participants ONLY on the false → true edge of `show` —
  // i.e. when the modal actually opens. The previous version of this
  // effect listed `selectedContact`, `initialInvited`,
  // `initialDisplayName`, `accountId`, and `defaultDomain` as deps so
  // it would re-run any time the parent re-rendered with a fresh
  // reference for any of those props (which NavigationBar /
  // app.js do on practically every render — `selectedContact` is a
  // new object literal each time). The visible symptom was a focus
  // loop on the picker's Searchbar:
  //   • user taps Searchbar → keyboard opens
  //   • parent re-renders, new `selectedContact` reference arrives
  //   • effect fires → resets `search=""`, `pickerOpen=false`
  //   • picker pane unmounts → Searchbar loses focus → keyboard
  //     transitions → another parent render → effect fires again →
  //     the user-typed character is wiped, the cursor jumps back
  // The fix is to gate hydration on the open transition only. We
  // hold the previous `show` value in a ref so we can detect the
  // false→true edge without depending on any of the props that
  // race against the keyboard. Inside the effect we still read
  // those props (so we get the latest values at open time), but we
  // don't listen for changes after that — the modal is a one-shot
  // edit session, and any prop drift while it's open would be a
  // bug at the call site, not something we should react to.
  const wasShownRef = useRef(false);
  useEffect(() => {
    if (!show) {
      wasShownRef.current = false;
      return;
    }
    if (wasShownRef.current) return; // already hydrated this open cycle
    wasShownRef.current = true;

    const source =
      (initialInvited && initialInvited.length > 0)
        ? initialInvited
        : (selectedContact && Array.isArray(selectedContact.participants)
            ? selectedContact.participants
            : []);

    const seen = new Set();
    const normalized = [];
    source.forEach((p) => {
      const u = normalizeUri(p, accountId, defaultDomain);
      if (u && !seen.has(u)) {
        seen.add(u);
        normalized.push(u);
      }
    });
    setParticipants(normalized);
    setDisplayName(initialDisplayName || '');
    setPickerOpen(false);
    setSearch('');
    setTagFilter(null);
    // Only `show` belongs in the dep array — every other value is
    // read once at the open edge via the ref guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  // ── Derived data ─────────────────────────────────────────────
  // Quick URI → contact lookup so pill labels can use the display
  // name. Memoised against allContacts so each render of a long
  // pill row doesn't re-walk the array.
  const contactsByUri = useMemo(() => {
    const idx = {};
    if (Array.isArray(allContacts)) {
      allContacts.forEach((c) => {
        if (c && c.uri) {
          idx[String(c.uri).toLowerCase()] = c;
        }
      });
    }
    return idx;
  }, [allContacts]);

  // Contacts eligible to appear in the picker — see
  // filterInvitableContacts for the exclusion rules. Pass
  // `defaultDomain` so the same-domain gate kicks in (cross-domain
  // conference invites aren't supported yet).
  const invitableContacts = useMemo(
    () => filterInvitableContacts(allContacts, accountId, defaultDomain),
    [allContacts, accountId, defaultDomain]
  );

  // Apply the searchbar filter on top of the invitable set,
  // strip out anyone already in `participants`, and apply the
  // optional tag-category filter (Favorites / Caregivers / Calls)
  // when the user has tapped one of the chips below the list.
  // The search list is an "addable contacts" list, not a toggle
  // list — already-selected people are shown as pills above and
  // can be dropped via the × on each pill, so leaving them in
  // the search results just wasted space. Search matching is
  // against display name OR URI so the user can type either
  // "alice" or "alice@example" and still get a hit.
  const visibleContacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Build a Set of already-selected URIs once per memo run;
    // O(1) membership test in the filter instead of an O(N)
    // indexOf for every row.
    const selectedSet = new Set(participants.map((u) => String(u).toLowerCase()));
    const matchesQuery = (c) => {
      if (!q) return true;
      const name = String(c.name || '').toLowerCase();
      const uri = String(c.uri || '').toLowerCase();
      return name.indexOf(q) > -1 || uri.indexOf(q) > -1;
    };
    // Predicate per tag category. Mirrors ReadyBox's contact list
    // chip filters so the behaviour matches what the user already
    // expects from the main contacts UI — see ReadyBox.js around
    // line 1631 where `contactsFilter` is wired:
    //   favorite    → c.tags includes 'favorite'
    //   autoanswer  → c.localProperties.autoanswer === true
    //   calls       → c.tags includes 'calls'
    const matchesTag = (c) => {
      if (!tagFilter) return true;
      const tags = Array.isArray(c.tags) ? c.tags : [];
      if (tagFilter === 'favorite') return tags.indexOf('favorite') > -1;
      if (tagFilter === 'calls') return tags.indexOf('calls') > -1;
      if (tagFilter === 'autoanswer') {
        return !!(c.localProperties && c.localProperties.autoanswer === true);
      }
      return true;
    };
    return invitableContacts.filter((c) => {
      const uri = String(c.uri || '').toLowerCase();
      if (selectedSet.has(uri)) return false;
      if (!matchesTag(c)) return false;
      return matchesQuery(c);
    });
  }, [invitableContacts, search, participants, tagFilter]);

  // ── Mutations ────────────────────────────────────────────────
  const toggleContact = (contact) => {
    if (!contact || !contact.uri) return;
    const uri = normalizeUri(contact.uri, accountId, defaultDomain);
    if (!uri) return;
    let didAdd = false;
    setParticipants((prev) => {
      const idx = prev.indexOf(uri);
      if (idx === -1) {
        didAdd = true;
        return [...prev, uri];
      }
      const next = prev.slice();
      next.splice(idx, 1);
      return next;
    });
    // Empty the search field as soon as a contact is ADDED.
    // Rationale: the typical pick flow is "type a few letters →
    // see the match → tap it → type the next person". Without
    // clearing, the previous query keeps the list filtered to
    // the person we just added — the user then has to manually
    // backspace before typing the next name, which is friction
    // on every additional pick. We only clear on add (not on
    // remove) because a remove happens when the user
    // deselects somebody from the same filtered list, and they
    // probably want to keep that filter active to find the
    // right entry again.
    if (didAdd) {
      setSearch('');
    }
  };

  const removeParticipant = (uri) => {
    setParticipants((prev) => prev.filter((p) => p !== uri));
  };

  const handleSave = () => {
    // Strip anything that doesn't normalise cleanly (defensive —
    // the picker should never feed us an invalid URI, but a stale
    // selectedContact.participants from a previous schema might).
    const seen = new Set();
    const finalList = [];
    participants.forEach((p) => {
      const u = normalizeUri(p, accountId, defaultDomain);
      if (u && !seen.has(u)) {
        seen.add(u);
        finalList.push(u);
      }
    });
    const name = displayName || (selectedContact && selectedContact.uri) || '';
    saveConference && saveConference(
      selectedContact && selectedContact.uri,
      finalList,
      name
    );
    close && close();
  };

  if (!show) return null;

  // Bound the modal height so the picker's ScrollView has somewhere
  // to scroll inside on phones — without a cap, the contact list
  // pushes the Save row off-screen on small viewports.
  const viewportH = Dimensions.get('window').height;
  const surfaceMaxHeight = Math.round(viewportH * 0.85);
  // Tighter cap on the inline contact list. With everything sharing
  // one Surface (Display name input + pills + search header + search
  // input + counter + contact list + buttons), 0.45 * viewport was
  // pushing the pills above out of view as soon as the picker
  // expanded — the Surface's overflow:hidden clipped the lower
  // portion, which looked like "the search box is covering the
  // pills". 0.30 leaves room for the pills' wrapped rows to stay on
  // screen above the search section.
  const pickerListMaxHeight = Math.round(viewportH * 0.30);

  // ── Pill row + add button ────────────────────────────────────
  // Rendered as a flex-wrap row of small chips. Each chip is
  //   [display-name × ]
  // — tapping the × removes the participant. The trailing + button
  // opens the contact picker pane.
  const renderPills = () => {
    if (participants.length === 0) {
      return (
        <Text style={{ fontSize: 12, color: '#888', marginRight: 6, marginBottom: 6 }}>
          No one selected
        </Text>
      );
    }
    return participants.map((uri) => {
      const label = labelForUri(uri, contactsByUri);
      return (
        <View
          key={uri}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: '#e3f2fd',
            borderRadius: 12,
            paddingLeft: 10,
            paddingRight: 4,
            paddingVertical: 3,
            marginRight: 6,
            marginBottom: 6,
          }}
        >
          <Text style={{ fontSize: 12, color: '#1565c0', maxWidth: 180 }} numberOfLines={1}>
            {label}
          </Text>
          <TouchableOpacity
            onPress={() => removeParticipant(uri)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${label}`}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={{ marginLeft: 4, padding: 2 }}
          >
            <Icon name="close-circle" size={16} color="#1565c0" />
          </TouchableOpacity>
        </View>
      );
    });
  };

  // ── Single inline pane (no swap, no nested modal) ──────────
  //
  // Earlier iterations swapped between a "main" pane and a "picker"
  // pane based on `pickerOpen`. That swap turned out to trigger a
  // modal-level remount loop on this device — tapping the search
  // TextInput caused the whole modal stack to cycle (the user saw
  // the Configure conference panel "fight" the search field). The
  // root cause is hard to nail without device-side instrumentation,
  // but the cure is structural: never swap subtrees, never nest
  // modals. Render the search field and the contact list INLINE,
  // as direct siblings of the Display name input and the pill row,
  // all inside the same Surface. Tapping `+` just expands the
  // search section; tapping the same toggle collapses it. No subtree
  // unmount, no key reconciliation tricks, no second responder
  // tree to fight the first.
  const renderBody = () => (
    // No outer ScrollView. An outer ScrollView around this body
    // — even a benign one — re-measures its content on every
    // layout shift, and on Android that re-measure was racing the
    // keyboard-open transition: TextInput focuses → keyboard
    // shows → ScrollView re-measures (because Display name +
    // Save row hide-on-pickerOpen also fire at the same time)
    // → measure callback in the middle of the keyboard event
    // → focus drops → keyboard tries to close → another
    // re-measure. The same loop the user reported. Without the
    // outer ScrollView the body lays out as a plain column and
    // there's no measurement feedback path for the keyboard
    // event to feed back into. The inner contact-list ScrollView
    // (inside the picker section) is still here and stays
    // contained to its own maxHeight — that one is fine because
    // it doesn't react to layout shifts above it.
    <View>{/* fragment-equivalent container, no flex effects */}
      {/* Conference name is hidden while the contact picker is
          open. Two reasons:
            • Vertical space — with Display name + headers + pills
              + search header + search input + counter + contact
              list + buttons all in one Surface, the pills above
              the search were being clipped on smaller phones.
              Hiding the name field while picking buys back room.
            • Focus hygiene — two TextInputs in the same Surface
              meant the keyboard could ambiguously target either,
              which contributed to the focus fight the user
              reported. With the picker open, only the search
              TextInput is in the tree, so there's no contest. */}
      {!pickerOpen && (
        <>
          <TextInput
            mode="flat"
            label="Conference name"
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
          />
          <View style={{ height: 12 }} />
        </>
      )}

      {/* Header row for the "People to invite" section. Title on
          the left, "+" add button on the top right of the pills
          view. The button used to sit at the end of the wrapped
          pill row, which meant its position drifted as the
          number of pills changed (one pill → button right next
          to it; many pills → button at the bottom-right of the
          wrap). Pinning it here at the header gives a stable,
          predictable target. The pill row itself, below, is
          left to wrap as a pure pill list with no inline
          control. Hidden while the picker is open — Done lives
          inside the search bar in that mode. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: '#333', flex: 1 }}>
          People to invite when you join the room
        </Text>
        {!pickerOpen && (
          <TouchableOpacity
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Add people to invite"
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: '#1565c0',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 8,
            }}
          >
            <Icon name="plus" size={18} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
      {!pickerOpen && (
        <Text style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
          Pick from your Sylk contacts. These addresses will be invited automatically
          when you start the conference.
        </Text>
      )}

      {/* Pill row. Pure pill list — no inline "+" control;
          that affordance moved to the header above so it stays
          at a stable top-right position regardless of how many
          pills are present. Pills just wrap to multiple lines
          via `flexWrap`. If the list grows very long the user
          can scroll the body to see them. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
        {renderPills()}
      </View>

      {pickerOpen ? (
        <>
          <Divider style={{ marginTop: 8, marginBottom: 8 }} />
          {/* Inline search bar. Done lives INSIDE the field as
              the right-adornment check icon — single line,
              magnifier on the left, search text in the middle,
              Done check on the right. The pill row's `+` button
              is hidden while the picker is open (see above), so
              this check is the sole dismiss control for the
              picker section.
              react-native-paper v5 uses `icon=` (not `name=`) on
              TextInput.Icon — using `name` here silently fails to
              render the adornment, which is why the previous
              attempt looked like there was no exit control. */}
          <TextInput
            mode="flat"
            dense
            placeholder="Search contacts"
            label=""
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
            textContentType="none"
            left={<TextInput.Icon icon="magnify" />}
            right={
              <TextInput.Icon
                icon="check"
                color="#1565c0"
                onPress={() => { setSearch(''); setTagFilter(null); setPickerOpen(false); }}
                accessibilityLabel="Done picking contacts — close the search section"
              />
            }
            style={{ marginBottom: 8 }}
          />
          {/* Fixed `height` (not `maxHeight`) on the inline contact
              list ScrollView. With `maxHeight` the ScrollView
              naturally shrank to fit its rendered children, which
              meant every keystroke filtering the list could grow or
              shrink the Surface above it — the user saw the whole
              modal pulse as they typed. Pinning a fixed height
              reserves the same vertical real estate regardless of
              match count; the list scrolls internally when there
              are more matches than fit, and shows the "No matching
              contacts." text on an otherwise blank reserved area
              when there are none. Stable layout, no pulse. */}
          <ScrollView
            style={{ height: pickerListMaxHeight }}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {visibleContacts.length === 0 ? (
              <Text style={{ fontSize: 12, color: '#888', padding: 12, textAlign: 'center' }}>
                No matching contacts.
              </Text>
            ) : (
              visibleContacts.map((c) => {
                const uri = String(c.uri).toLowerCase();
                const selected = participants.indexOf(uri) > -1;
                const name = (c.name && String(c.name).trim()) || labelForUri(uri, contactsByUri);
                return (
                  <TouchableOpacity
                    key={uri}
                    onPress={() => toggleContact(c)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      (selected ? 'Deselect ' : 'Select ') + name
                    }
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 8,
                      paddingHorizontal: 4,
                      backgroundColor: selected ? '#e3f2fd' : 'transparent',
                      borderRadius: 6,
                      marginBottom: 2,
                    }}
                  >
                    <Icon
                      name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={20}
                      color={selected ? '#1565c0' : '#888'}
                      style={{ marginRight: 8 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, color: '#222' }} numberOfLines={1}>
                        {name}
                      </Text>
                      {name !== uri ? (
                        <Text style={{ fontSize: 11, color: '#888' }} numberOfLines={1}>
                          {uri}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>

          {/* Tag-category filter chips, pinned at the bottom of
              the search list. Same vocabulary ReadyBox surfaces
              over the main contacts list (see ReadyBox.js around
              `contactsFilter`) so the affordance feels familiar:
                • Favorites   — c.tags includes 'favorite'
                • Calls       — c.tags includes 'calls'
              Caregivers (autoanswer) and Blocked are deliberately
              omitted: caregivers are filtered out of the invitable
              set entirely (see filterInvitableContacts — they're
              app helpers, not invite targets), and blocked contacts
              are also stripped at the same gate. Surfacing chips
              for either category would just produce empty lists.
              Tapping a chip narrows the list; tapping the same
              active chip clears the filter (toggle behaviour, also
              mirroring ReadyBox). Filter composes with the search
              text above — chip narrows the set, search narrows it
              further. */}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              marginTop: 8,
              paddingTop: 8,
              borderTopWidth: 1,
              borderTopColor: '#eee',
            }}
          >
            {[
              { key: 'favorite', label: 'Favorites' },
              { key: 'calls', label: 'Calls' },
            ].map((opt) => {
              const active = tagFilter === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => setTagFilter(active ? null : opt.key)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    active ? `Clear ${opt.label} filter` : `Filter by ${opt.label}`
                  }
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 12,
                    marginRight: 6,
                    marginBottom: 6,
                    backgroundColor: active ? '#1565c0' : '#e0e0e0',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: active ? '700' : '500',
                      color: active ? '#fff' : '#333',
                    }}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      ) : null}

      {/* Save / Cancel row is hidden while the contact picker is
          open. The picker's own "Done" button collapses the search
          section first — once the user is back to the main view
          they see Save / Cancel again. Two payoffs:
            • frees the vertical space the buttons would consume,
              so on smaller phones the contact list scrolls inside
              its full bounded height without the Surface clipping,
            • removes any accidental tap target that could close
              the modal mid-pick (Cancel is destructive — losing a
              selection because of a fat-finger is annoying). */}
      {!pickerOpen && (
        <>
          <Divider style={{ marginTop: 12, marginBottom: 8 }} />
          <View style={styles.buttonRow}>
            <Button
              mode="outlined"
              style={styles.button}
              onPress={close}
              accessibilityLabel="Cancel"
            >
              Cancel
            </Button>
            <Button
              mode="contained"
              style={styles.button}
              onPress={handleSave}
              icon="content-save"
            >
              Save
            </Button>
          </View>
        </>
      )}
    </View>
  );

  return (
    <Modal
      style={containerStyles.container}
      visible={show}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      {/* Layout note. Earlier iterations of this modal used:
            (a) outer TouchableWithoutFeedback onPress={close} +
                inner TouchableWithoutFeedback onPress={() => {}}
                — broke Searchbar focus through keyboard transitions
                and dropped the picker ScrollView pan on Android,
            (b) an absolute-fill Pressable backdrop SIBLING behind
                the Surface — fixed the responder issue but, with
                Paper's Searchbar inside the Surface, occasional
                touches around the Searchbar's leading-icon area
                still appeared to fall through to the backdrop and
                fired `close`, producing a tap → focus → close →
                remount loop.
          Both backdrops are now gone. Dismissal lives entirely on
          the Cancel button and on Android's hardware back key
          (Modal.onRequestClose = close). The picker also has its
          own "Done" button to return to the main pane. This is the
          simplest responder tree we can build and is immune to
          stray-touch bubbling around custom input chrome.

          Update: tap-outside-to-dismiss is back, via the
          Pressable-SIBLING-behind-the-Surface pattern (same shape
          used by EditContactModal and PreferencesModal). The
          Pressable absolute-fills the overlay BEHIND the Surface
          (rendered earlier in JSX → behind in z-order); taps that
          land on the Surface are absorbed by the Surface and its
          children, taps outside fall through to the Pressable and
          trigger `close`. Crucially this is NOT a TouchableWithout-
          Feedback PARENT — there's no responder-graph wrapper
          around the Surface, so the Searchbar / pill picker keep
          their normal focus/scroll behaviour. */}
      <View style={containerStyles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={close}
          accessibilityLabel="Close configure conference"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
          style={{ maxHeight: surfaceMaxHeight, alignSelf: 'center', width: '100%' }}
        >
          <Surface
            style={[
              containerStyles.modalSurface,
              { maxHeight: surfaceMaxHeight, overflow: 'hidden' },
            ]}
          >
            <Text style={containerStyles.title}>Configure conference</Text>
            <Text style={styles.subtitle}>Room {room}</Text>

            {/* Single inline body — no pane swap. The "+" toggle
                only flips `pickerOpen`, which conditionally renders
                the search + contact list INSIDE the same body
                between the pill row and the action buttons. No
                subtree remount, no nested Modal, nothing to
                fight the search input for focus. */}
            {renderBody()}
          </Surface>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

EditConferenceModal.propTypes = {
  room: PropTypes.string,
  displayName: PropTypes.string,
  show: PropTypes.bool,
  close: PropTypes.func.isRequired,
  saveConference: PropTypes.func,
  invitedParties: PropTypes.array,
  selectedContact: PropTypes.object,
  defaultDomain: PropTypes.string,
  accountId: PropTypes.string,
  allContacts: PropTypes.array,
};

export default EditConferenceModal;
