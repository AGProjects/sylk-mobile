// contactsFilterMachine — the pure decision logic behind ReadyBox.filterHistory.
//
// `filterHistory` is the single entry point for every "filter / sort / folder"
// action the user can take on the contacts + chat views (tapping All, Recent,
// Deleted, a category chip, the Pinned toggle, …). The original implementation
// interleaved the *decision* (which state fields change, to what) with the
// *side effects* (togglePinned, filterHistoryFunc, loadGraveyardContacts,
// clearing the search box) across a dozen branches, which made the legal
// transitions hard to see and impossible to unit-test.
//
// planFilterHistory is a pure function of (action, context): it returns an
// ORDERED list of operations describing exactly what should happen, in order.
// ReadyBox's thin executor maps each op back onto this.props.* / this.setState.
// Because it's pure, the full transition table can be exercised in a test
// harness (see the equivalence check that accompanied this refactor) without a
// running app.
//
// Op shapes (executed in array order):
//   { op: 'togglePinned' }                       → props.togglePinned(selectedContact.uri)
//   { op: 'filterHistoryFunc', arg: <filter> }   → props.filterHistoryFunc(arg)
//   { op: 'loadGraveyardContacts' }              → props.loadGraveyardContacts?.()
//   { op: 'setState', patch: {...} }             → this.setState(patch)
//   { op: 'handleSearch', arg: '' }              → this.handleSearch(arg)
//
// Context fields (all plain values the caller reads off props/state):
//   hasSelectedContact     bool   — !!props.selectedContact (chat vs list view)
//   pinned                 bool   — props.pinned
//   messagesCategoryFilter any    — state.messagesCategoryFilter
//   historyPeriodFilter    any    — state.historyPeriodFilter
//   contactsFilter         any    — state.contactsFilter
//   hasDeletedContacts     bool   — any contact has storagePurged/deletedTimestamp
//   hasGraveyardContacts   bool   — graveyardCount > 0

export function planFilterHistory(filter, ctx) {
    const ops = [];

    // --- Chat view (a contact is open): the action toggles a per-chat
    // message-category filter, with a special-case Pinned toggle. None of
    // these paths clear the search box (they early-return in the original).
    if (ctx.hasSelectedContact) {
        if (!filter && ctx.pinned) {
            ops.push({ op: 'togglePinned' });
        }
        if (filter === 'pinned') {
            ops.push({ op: 'togglePinned' });
            return ops;
        }
        const nextCategory = (filter === ctx.messagesCategoryFilter) ? null : filter;
        ops.push({ op: 'setState', patch: { messagesCategoryFilter: nextCategory } });
        return ops;
    }

    // --- Contacts-list view: "All" is a full reset, normalised to null so the
    // parent's historyFilter clears too (not just the local contactsFilter).
    let f = filter;
    if (f === 'all') {
        f = null;
    }

    // The parent is always told first, with the post-"All" filter — BEFORE any
    // Recent toggle or Deleted→Graveyard remap below (which only affect local
    // state).
    ops.push({ op: 'filterHistoryFunc', arg: f });

    if (!f) {
        ops.push({ op: 'setState', patch: { historyPeriodFilter: null, contactsFilter: null } });
    } else if (f === 'recent') {
        // Recent is a toggle: tapping it again while active clears it.
        const nextPeriod = ctx.historyPeriodFilter === f ? null : f;
        ops.push({ op: 'setState', patch: { historyPeriodFilter: nextPeriod } });
    } else {
        if (f === ctx.contactsFilter) {
            // Tapping the active folder/tag again clears it.
            ops.push({ op: 'setState', patch: { contactsFilter: null } });
        } else {
            let target = f;
            // Tapping "Deleted" when the trash is empty but the Graveyard has
            // tombstones jumps straight to the Graveyard (where the content is).
            if (target === 'deleted' && !ctx.hasDeletedContacts && ctx.hasGraveyardContacts) {
                target = 'graveyard';
            }
            // Entering the Graveyard loads the tombstones on demand.
            if (target === 'graveyard') {
                ops.push({ op: 'loadGraveyardContacts' });
            }
            ops.push({ op: 'setState', patch: { contactsFilter: target } });
        }
    }

    // Every contacts-list transition clears the search box at the end.
    ops.push({ op: 'handleSearch', arg: '' });
    return ops;
}
