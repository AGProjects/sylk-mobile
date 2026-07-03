// propsReconciler — the pure decision logic behind ReadyBox's
// UNSAFE_componentWillReceiveProps.
//
// That lifecycle reconciles ~14 prop-edge transitions into a mix of setState
// patches and side effects (resetContact, handleSearch, togglePinned,
// filterHistory, bounceNavigation, the main-nav scroll-to-start,
// loadGraveyardContacts, selectContact, and the one-shot pick flag). The logic
// was hard to read and impossible to test because the decisions were
// interleaved with `this.setState` / `this.props.*` calls.
//
// planPropsReconcile is a pure function of a flattened `ctx` snapshot
// (everything it needs read off prevProps / nextProps / state / instance up
// front). It returns an ORDERED op-list; ReadyBox's executor maps each op back
// onto setState / props / instance. Because it's pure, the full transition
// table is exercised by an equivalence harness against a faithful transcription
// of the original method — this is Phase 0 of the plan to retire the
// deprecated lifecycle, and it deliberately changes NO behavior or timing.
//
// Op shapes (executed in array order; setState patches merge last-wins per key,
// exactly as the original's sequential setState calls did):
//   { op: 'setState', patch: {...} }
//   { op: 'handleSearch', arg }
//   { op: 'resetContact' }
//   { op: 'togglePinned', uri }
//   { op: 'filterHistory', arg }
//   { op: 'scrollMainNavToStart' }
//   { op: 'loadGraveyardContacts' }
//   { op: 'bounceNavigation' }
//   { op: 'consumePickFlag' }
//   { op: 'selectContact', arg }
//
// ctx fields (all plain values, read by the caller before planning):
//   hasPrevSelectedContact, hasNextSelectedContact  bool
//   selectedContactChanged                          bool  (object identity !==)
//   prevSelectedContactUri                          string|null
//   prevInviteContacts, nextInviteContacts          bool
//   prevPinned                                      bool
//   prevHistoryFilter, nextHistoryFilter            any
//   prevGotoDeletedSignal, nextGotoDeletedSignal    any
//   prevAllContactsLength, nextAllContactsLength    number
//   nextSearchContacts                              bool
//   nextSearchString                                string
//   nextMissedCallsLen, nextBlockedUrisLen,
//   nextFavoriteUrisLen                             number
//   nextHasDeletedContacts                          bool
//   nextGraveyardCount                              number
//   nextStateFilterTagPresent                       bool  (some contact tagged === state.contactsFilter)
//   hasLoadGraveyardFn                              bool
//   stateContactsFilter, stateSearchContacts        any / bool
//   nextChatEnabled                                 bool|undefined  (!chatDisabledForUri(next uri))
//   navItemsLength                                  number
//   pickedContactWhileSearching                     bool

const NON_TAG_FILTERS = new Set(['calls', 'recent', 'missed', 'autoanswer', 'graveyard', 'all']);

export function planPropsReconcile(ctx) {
    const ops = [];

    // (1) A delete bumped gotoDeletedSignal: close the chat and return to All.
    if (ctx.nextGotoDeletedSignal !== ctx.prevGotoDeletedSignal) {
        ops.push({ op: 'setState', patch: { contactsFilter: null, chat: false } });
    }

    // (2) Leaving the chat (had a contact, now none).
    if (ctx.hasPrevSelectedContact && !ctx.hasNextSelectedContact) {
        ops.push({ op: 'setState', patch: { targetUri: '', chat: false } });
    }

    // (3) Entering invite mode.
    if (!ctx.prevInviteContacts && ctx.nextInviteContacts) {
        ops.push({ op: 'handleSearch', arg: '' });
        ops.push({ op: 'setState', patch: { chat: false } });
    }

    // (4) Switched to a (truthy) contact: set chat enablement + stop playback.
    if (ctx.selectedContactChanged && ctx.hasNextSelectedContact) {
        ops.push({ op: 'setState', patch: { chat: ctx.nextChatEnabled } });
        ops.push({ op: 'setState', patch: { playRecording: false } });
    }

    // (5) Any selected-contact change clears the shared-asset spinner.
    if (ctx.selectedContactChanged) {
        ops.push({ op: 'setState', patch: { gettingSharedAsset: false } });
    }

    // (6) Any selected-contact change: reset per-contact state, clear the
    //     message-category filter, snap the main nav bar to the start when
    //     coming FROM the contacts-list view, and unpin the contact we left.
    if (ctx.selectedContactChanged) {
        ops.push({ op: 'resetContact' });
        ops.push({ op: 'setState', patch: { messagesCategoryFilter: null } });
        if (!ctx.hasPrevSelectedContact && ctx.navItemsLength > 0) {
            ops.push({ op: 'scrollMainNavToStart' });
        }
        if (ctx.hasPrevSelectedContact && ctx.prevPinned) {
            ops.push({ op: 'togglePinned', uri: ctx.prevSelectedContactUri });
        }
    }

    // (7) The parent cleared historyFilter: mirror it locally.
    if (!ctx.nextHistoryFilter && ctx.prevHistoryFilter) {
        ops.push({ op: 'filterHistory', arg: null });
    }

    // (8/9/10) A list the active filter depends on went empty: drop the filter.
    if (ctx.nextMissedCallsLen === 0 && ctx.stateContactsFilter === 'missed') {
        ops.push({ op: 'setState', patch: { contactsFilter: null } });
    }
    if (ctx.nextBlockedUrisLen === 0 && ctx.stateContactsFilter === 'blocked') {
        ops.push({ op: 'setState', patch: { contactsFilter: null } });
    }
    if (ctx.nextFavoriteUrisLen === 0 && ctx.stateContactsFilter === 'favorite') {
        ops.push({ op: 'setState', patch: { contactsFilter: null } });
    }

    // (11) Tag-group / Deleted-folder emptiness reset.
    const f = ctx.stateContactsFilter;
    if (f === 'deleted') {
        // Deleted is column-based, not a tag. Only reset when the trash is
        // actually empty; if the Graveyard now has entries, slide there.
        if (!ctx.nextHasDeletedContacts) {
            if ((ctx.nextGraveyardCount || 0) > 0) {
                if (ctx.hasLoadGraveyardFn) {
                    ops.push({ op: 'loadGraveyardContacts' });
                }
                ops.push({ op: 'setState', patch: { contactsFilter: 'graveyard' } });
            } else {
                ops.push({ op: 'setState', patch: { contactsFilter: null } });
            }
        }
    } else if (f && !NON_TAG_FILTERS.has(f)) {
        // A real tag group whose last member was removed: clear it.
        if (!ctx.nextStateFilterTagPresent) {
            ops.push({ op: 'setState', patch: { contactsFilter: null } });
        }
    }

    // (12) Contacts list first populated (0 -> N): bounce the nav bar.
    if (ctx.prevAllContactsLength === 0 && ctx.nextAllContactsLength > 0) {
        ops.push({ op: 'bounceNavigation' });
    }

    // (13) Parent pushed a search string.
    if (ctx.nextSearchString) {
        ops.push({ op: 'setState', patch: { searchString: ctx.nextSearchString } });
    }

    // (14) Search-close reconciliation + the trailing prop-mirror setState.
    const exitedContactSearch = ctx.stateSearchContacts && !ctx.nextSearchContacts;
    const pickedNewContact = !!ctx.pickedContactWhileSearching
        || (ctx.hasNextSelectedContact && ctx.selectedContactChanged);
    const exitedSearchByX = exitedContactSearch && !pickedNewContact;

    // Consume the one-shot pick flag once search has actually closed (before the
    // setState, matching the original order).
    if (exitedContactSearch) {
        ops.push({ op: 'consumePickFlag' });
    }

    // searchMessages / searchContacts / isTyping / navigationItems / keys were
    // previously mirrored from props into state here; they're now read directly
    // from props, so this patch only carries the genuine search-exit resets.
    const finalPatch = {};
    // Source toggle + dialpad reset on ANY search exit.
    if (exitedContactSearch) {
        finalPatch.contactSource = 'sylk';
        finalPatch.showAbDialpad = false;
    }
    // Query wipe ONLY when closing via × — never when a contact was just picked.
    if (exitedSearchByX) {
        finalPatch.targetUri = '';
        finalPatch.searchString = '';
    }
    ops.push({ op: 'setState', patch: finalPatch });

    if (exitedSearchByX) {
        // Uncontrolled input: clearing state alone won't blank a mounted field,
        // so drop the selected contact too (returns the list to its default).
        ops.push({ op: 'selectContact', arg: null });
    }

    return ops;
}
