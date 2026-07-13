import React from 'react';
import PropTypes from 'prop-types';
import { StyleSheet, View } from 'react-native';
import { Searchbar, IconButton } from 'react-native-paper';
import autoBind from 'auto-bind';

class URIInput extends React.Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            selecting: false,
            shareToContacts: this.props.shareToContacts,
            inviteContacts: this.props.inviteContacts,
            searchMessages: this.props.searchMessages,
            defaultValue: this.props.defaultValue,
            contactSource: this.props.contactSource || 'sylk',
        };

        this.uriInput = React.createRef();
        this.clicked = false;
    }

    componentDidMount() {
        if (this.props.autoFocus) {
            this.uriInput.current.focus();
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({
            shareToContacts: nextProps.shareToContacts,
            inviteContacts: nextProps.inviteContacts,
            searchMessages: nextProps.searchMessages,
            defaultValue: nextProps.defaultValue,
            contactSource: nextProps.contactSource || 'sylk',
        });
    }

    componentDidUpdate(prevProps) {
        if (prevProps.defaultValue !== this.props.defaultValue && this.props.autoFocus) {
            this.uriInput.current.focus();
        }
    }

    setValue(value) {
        this.props.onChange(value);
    }

    onInputChange(value) {
        this.setValue(value);
    }

    onInputClick(event) {
        if (!this.clicked) {
            this.uriInput.current.select();
            this.clicked = true;
        }
        // Notify the host that the user has explicitly tapped the
        // search field. Used by ReadyBox to lazily kick the
        // address-book load (and the OS contacts-permission prompt
        // if needed) the FIRST time the user actually intends to
        // search — i.e., on click rather than waiting for the first
        // keystroke. loadPhoneAddressBook on the host side is idempotent
        // and only re-prompts when permission is not yet granted.
        if (typeof this.props.onSearchFocus === 'function') {
            try {
                this.props.onSearchFocus();
            } catch (e) {
                // Swallow — focus-side prompts are best-effort.
            }
        }
    }

    onInputKeyDown(event) {
        switch (event.which) {
            case 13:
                if (this.state.selecting) {
                    this.setState({ selecting: false });
                } else {
                    this.props.onSelect(event.target.value);
                }
                break;
            case 27:
                this.setState({ selecting: false });
                break;
            case 38:
            case 40:
                this.setState({ selecting: true });
                break;
            default:
                break;
        }
    }

    onInputBlur(event) {
        if (this.state.selecting) {
            this.setState({ selecting: false });
        }
        this.clicked = false;
    }

    render() {
        let placeholder = 'Search contacts';
        if (this.state.shareToContacts) placeholder = 'Select contacts to share...';
        if (this.state.inviteContacts) placeholder = 'Select contacts to invite...';
        if (this.state.searchMessages) placeholder = 'Search messages';

        // The Sylk / AddressBook source toggle that used to sit in
        // the Sort/Order row above the search bar has been removed —
        // the main interface now unifies SIP + Phonebook results
        // into a single search, matching the invite-to-conference
        // picker behaviour. The placeholder reflects that unified
        // search rather than naming a specific corpus.
        const showSourceHint =
            !this.state.shareToContacts &&
            !this.state.inviteContacts &&
            !this.state.searchMessages;

        if (showSourceHint) {
            placeholder = 'Search contact...';
        }

        // Theme-aware colour set. Pulled to be explicit in BOTH
        // dark and light modes so we don't rely on Paper's default
        // theme resolution — the user reported the search bar fonts
        // not flipping correctly when the app theme changed, which
        // tracked back to the previous code only overriding colours
        // in the dark branch. The light branch now pins explicit
        // dark text / muted placeholder against the search-bar
        // background so the flip is symmetrical.
        //
        // Searchbar background is intentionally a *surface* tone
        // (one step off the page background), not the page
        // background itself. Day-theme body bg is #FFFFFF and
        // Night-theme body bg is #121212; matching either of those
        // here would render the search bar invisible against the
        // surrounding screen (white-on-white in Day, black-on-black
        // in Night), which is the regression the user reported as
        // "search contacts does not appear anymore" after the brand
        // strip / theming change. #F0F2F5 (Day) and #1F1F1F (Night)
        // give just enough contrast that the pill clearly reads as
        // an interactive control.
        const darkColors = this.props.dark
            ? {
                  backgroundColor: '#1F1F1F',
                  textColor: '#ffffff',
                  // Per user request: no gray icons inside the
                  // search bar — high-contrast black-or-white only.
                  iconColor: '#ffffff',
                  placeholderColor: '#aaaaaa',
              }
            : {
                  backgroundColor: '#F0F2F5',
                  textColor: '#111B21',
                  iconColor: '#000000',
                  placeholderColor: '#667781',
              };

        // Paper's built-in × clear sits at the right edge of the
        // bar, which is where we want the dialpad toggle to live
        // instead. Suppress it by returning null for the icon and
        // disabling the clear-button render path — we draw our own
        // × further down at right:48 (immediately to the LEFT of
        // the dialpad icon).
        const _suppressedClearIcon = () => null;

        // Whether the QR scan button is actually rendered. It's offered
        // when the host enables it (showQr) but hidden while the dialpad
        // view is open (isDialpadActive) — the two right-edge controls
        // don't coexist — and in close-search (folded) mode where the
        // close-X owns the right edge. Drives the dialpad's right-edge
        // shift and the clear-× offsets so they stay in sync.
        const _showQrBtn = this.props.showQr
            && !this.props.isDialpadActive
            && typeof this.props.onCloseSearch !== 'function';

        // Whether the dialpad toggle icon is rendered. Hidden while
        // the pad is OPEN (per user request) — its flush-right slot
        // is taken over by a close-× that dismisses the pad.
        const _showDialpadBtn = this.props.showDialpad
            && !this.props.isDialpadActive
            && typeof this.props.onCloseSearch !== 'function';

        // Pad-open state: the toggle icon above is replaced by an
        // ALWAYS-visible close-× at the flush-right slot (right:4)
        // that closes the dialpad view, with the backspace one
        // stride to its left. The text-clear × is suppressed while
        // the pad is open — the right edge belongs to close+backspace.
        const _padOpen = this.props.isDialpadActive
            && typeof this.props.onCloseSearch !== 'function';

        // Reserve right padding on the text input so long search text
        // ellipsizes BEFORE it slides underneath the overlay buttons
        // (user-reported bug: "too long search text gets under the
        // dialpad button").
        //
        // Sizing note: Paper's Searchbar ALWAYS renders its built-in
        // clear-icon slot in normal flow when the field has text (we
        // suppress the glyph, not the slot), so the input already
        // ends ~40px short of the bar's right edge. The extra padding
        // therefore only needs to span from that built-in slot to the
        // left edge of our custom clear-× — which arithmetically works
        // out to just the clear-×'s `right` offset (offset + ~38px
        // button width − ~40px built-in slot). Anything more piles up
        // as dead space between the text and the × (the follow-up bug).
        const _clearRight = (_showQrBtn && _showDialpadBtn)
            ? 100
            : _showQrBtn
                ? 52
                : (this.state.inviteContacts && this.props.inviteEnabled && _showDialpadBtn)
                    ? 108
                    : (this.state.inviteContacts && this.props.inviteEnabled)
                        ? 56
                        : 48;
        const _hasText =
            this.state.defaultValue && this.state.defaultValue.length > 0;

        // In-bar backspace, shown while the dialpad is open (it
        // replaced the pad's removed 4th-column backspace key). Sits
        // one IconButton stride (~44px) to the LEFT of the close-×
        // (i.e. right:48 normally, right:96 when the Invite button
        // shares the bar). Only renders while there's text to delete.
        const _showBackspace = _hasText
            && _padOpen
            && typeof this.props.onBackspace === 'function';
        const _backspaceRight =
            (this.state.inviteContacts && this.props.inviteEnabled)
                ? 96
                : 48;

        // Only needed while there's text (the built-in slot is
        // position:absolute — zero-width — when the field is empty,
        // but then there's no long text to protect either).
        const _inputPaddingRight = _hasText
            ? (_padOpen ? _backspaceRight : _clearRight)
            : 0;

        return (
            <View style={uriInputStyles.searchbarRow}>
                <Searchbar
                    ref={this.uriInput}
                    mode="flat"
                    label="Enter address"
                    value={this.state.defaultValue}
                    placeholder={placeholder}
                    onChangeText={this.onInputChange}
                    onKeyDown={this.onInputKeyDown}
                    onBlur={this.onInputBlur}
                    onPress={this.onInputClick}
                    autoCapitalize="none"
                    autoCorrect={false}
                    clearIcon={_suppressedClearIcon}
                    showClearIcon={false}
                    // Paper only treats mode="bar" as bar-mode; our
                    // "flat" falls into the view-mode branch, which
                    // draws a Divider line under the bar by default —
                    // the "clear line delimiter" the user reported.
                    showDivider={false}
                    autoFocus={this.props.autoFocus}
                    style={[
                        uriInputStyles.searchbar,
                        darkColors.backgroundColor
                            ? { backgroundColor: darkColors.backgroundColor }
                            : null,
                    ]}
                    inputStyle={[
                        uriInputStyles.searchbarInput,
                        darkColors.textColor ? { color: darkColors.textColor } : null,
                        { paddingRight: _inputPaddingRight },
                    ]}
                    iconColor={darkColors.iconColor}
                    placeholderTextColor={darkColors.placeholderColor}
                />
                {/* Hairline under the search bar. Paper's own view-mode
                    Divider (suppressed via showDivider={false} above)
                    was too pronounced; this is the same idea drawn by
                    hand, much dimmer, theme-aware. */}
                <View
                    style={[
                        uriInputStyles.bottomHairline,
                        {
                            backgroundColor: this.props.dark
                                ? 'rgba(255,255,255,0.08)'
                                : 'rgba(0,0,0,0.06)',
                        },
                    ]}
                />
                {/* Custom × clear icon, overlaid INSIDE the search
                    bar at right:48 — i.e. immediately to the LEFT of
                    the dialpad toggle (which sits flush to the right
                    edge at right:4). Replaces Paper's built-in clear
                    button (suppressed via `clearIcon={() => null}`
                    above) so the right edge is reserved for the
                    dialpad and the × can sit beside it instead of
                    fighting for the same slot. Only rendered when
                    the field is non-empty — matches Paper's
                    auto-hide-when-empty behaviour — and suppressed
                    while the dialpad is open (the right edge then
                    belongs to the close-dialpad × and backspace). */}
                {_hasText && !_padOpen ? (
                    <IconButton
                        icon="close"
                        size={22}
                        onPress={() => this.props.onChange('')}
                        accessibilityLabel="Clear search"
                        style={[
                            uriInputStyles.clearOverlay,
                            // Positioned by the same _clearRight the
                            // input padding uses, so the × always
                            // clears whatever set of overlays occupies
                            // the right edge (QR / dialpad toggle /
                            // Invite — see the _clearRight ladder
                            // above) and never drifts out of sync
                            // with the text padding.
                            { right: _clearRight },
                        ]}
                        iconColor={darkColors.iconColor}
                    />
                ) : null}
                {/* Close-dialpad × at the flush-right slot the toggle
                    icon vacated. ALWAYS visible while the pad is open
                    (regardless of text) — tapping it closes the
                    dialpad view via the same toggle handler. */}
                {_padOpen ? (
                    <IconButton
                        icon="close"
                        size={22}
                        onPress={this.props.onDialpadPress}
                        accessibilityLabel="Close dialpad"
                        style={uriInputStyles.dialpadOverlay}
                        iconColor={darkColors.iconColor}
                    />
                ) : null}
                {/* Backspace overlay, immediately to the LEFT of the
                    close-dialpad ×. Rendered only while the dialpad is
                    open and the field has text — it deletes the last
                    character via onBackspace (the dialpad grid itself
                    is a plain 3×4 pad with no backspace key). */}
                {_showBackspace ? (
                    <IconButton
                        icon="backspace-outline"
                        size={22}
                        onPress={this.props.onBackspace}
                        accessibilityLabel="Delete last character"
                        style={[
                            uriInputStyles.clearOverlay,
                            { right: _backspaceRight },
                        ]}
                        iconColor={darkColors.iconColor}
                    />
                ) : null}
                {/* Close-search overlay at the right edge. Only
                    rendered when the host supplies onCloseSearch
                    (folded search-contacts mode in ReadyBox — see
                    that file's URIInput call site). Sits at the
                    same right:4 slot the dialpad would occupy, and
                    we don't render the dialpad in that mode so there's
                    no collision. The button stays visible regardless
                    of whether the field has text, since exiting search
                    is the primary affordance in folded mode where the
                    navbar (which usually carries the close-search
                    button) has been hidden.
                    Icon is "arrow-up" (up arrow) rather than the ×
                    glyph used by the clear-text overlay at right:48,
                    so the two buttons are visually distinct: × = wipe
                    the typed search, ↑ = exit search mode (the search
                    bar collapses back upward into the previous chrome
                    where the navbar used to be — the up-arrow
                    metaphor mirrors that motion). */}
                {typeof this.props.onCloseSearch === 'function' ? (
                    <IconButton
                        icon="arrow-up"
                        size={22}
                        onPress={this.props.onCloseSearch}
                        accessibilityLabel="Close search"
                        style={uriInputStyles.dialpadOverlay}
                        iconColor={darkColors.iconColor}
                    />
                ) : null}
                {/* Dialpad toggle overlaid INSIDE the search bar,
                    always pinned flush against the right edge
                    (right:4). In invite mode the green Invite
                    (account-plus) button shifts LEFT to sit beside
                    the dialpad rather than the other way around —
                    keeps the dialpad in the consistent "tap the
                    rightmost icon" spot across normal and invite
                    flows. Suppressed when onCloseSearch is provided
                    so the close-X owns the right edge. */}
                {_showDialpadBtn ? (
                    <IconButton
                        icon="dialpad"
                        size={22}
                        onPress={this.props.onDialpadPress}
                        accessibilityLabel="Show dialpad"
                        style={[
                            uriInputStyles.dialpadOverlay,
                            // When the QR button shares the bar it owns
                            // the rightmost slot (right:4); the dialpad
                            // shifts one stride left to sit beside it.
                            _showQrBtn
                                ? uriInputStyles.dialpadOverlayWithQr
                                : null,
                        ]}
                        iconColor="#27ae60"
                    />
                ) : null}
                {/* QR scan button overlaid INSIDE the search bar,
                    immediately to the RIGHT of the dialpad toggle.
                    Takes the rightmost slot (right:4) and the dialpad
                    shifts left to right:52 (dialpadOverlayWithQr).
                    Suppressed in close-search (folded) mode where the
                    close-X owns the right edge. */}
                {_showQrBtn ? (
                    <IconButton
                        icon="qrcode-scan"
                        size={22}
                        onPress={this.props.onQrPress}
                        accessibilityLabel="Scan QR code"
                        style={uriInputStyles.qrOverlay}
                        iconColor={darkColors.iconColor}
                    />
                ) : null}
                {/* Invite-mode action pair: Cancel + Invite, overlaid
                    INSIDE the search bar at the right edge. Visible
                    only when inviteContacts is true (when the contacts
                    list is a participant picker for an ongoing
                    conference). Dialpad never renders in invite mode,
                    so they share the same right-edge real estate
                    without colliding. The × clear overlay sits to
                    their left (auto-hidden when the field is empty),
                    so order from right→left is: Invite, Cancel, ×. */}
                {/* Invite-mode action overlay. Only the green Invite
                    (account-plus) button is rendered inside the bar —
                    the Cancel × that used to sit beside it was removed
                    per user request. The search field's own clear-×
                    (above) still serves to clear typed input. Backing
                    out of invite mode entirely is handled by the
                    navbar back affordance / route navigation, so the
                    extra in-bar Cancel was redundant. */}
                {/* Invite (account-plus) button. Rendered only when
                    the user has actually selected at least one
                    contact (inviteEnabled). Until then there's
                    nothing to invite, so showing a disabled button
                    just adds visual clutter — hiding it also frees
                    up the right edge for the dialpad / clear-×. The
                    button reappears the moment the first contact is
                    picked. */}
                {this.state.inviteContacts && this.props.inviteEnabled ? (
                    <IconButton
                        icon="account-plus"
                        size={22}
                        onPress={this.props.onInvitePress}
                        accessibilityLabel="Invite selected contacts"
                        style={[
                            uriInputStyles.inviteOverlay,
                            // The rightmost slot (right:4) belongs to
                            // the dialpad toggle when closed, or the
                            // close-dialpad × when open — in both
                            // cases the Invite button shifts one
                            // stride left to sit beside it.
                            (_showDialpadBtn || _padOpen)
                                ? uriInputStyles.inviteOverlayWithDialpad
                                : null,
                            uriInputStyles.inviteOverlayEnabled,
                        ]}
                        iconColor="#ffffff"
                    />
                ) : null}
            </View>
        );
    }
}

// Searchbar height: 50 px (history: 56 originally, compressed to 40,
// then 44, now bumped again per user request). Comfortably above
// Apple's 44 px minimum tap target while still a touch shorter than
// the original 56 px bar.
const SEARCHBAR_HEIGHT = 50;

const uriInputStyles = StyleSheet.create({
    searchbarRow: {
        // Relative-positioned wrapper so the backspace overlay can
        // sit absolutely inside the search bar without escaping the
        // contacts-header layout above it.
        position: 'relative',
    },
    // Hand-drawn dim divider under the bar (see render).
    bottomHairline: {
        height: StyleSheet.hairlineWidth,
        width: '100%',
    },
    searchbar: {
        height: SEARCHBAR_HEIGHT,
        minHeight: SEARCHBAR_HEIGHT,
        // Kill Paper's default Searchbar elevation/shadow — it renders
        // as a ~3px line/shadow under the bar (user-reported). The bar
        // reads as a surface via its explicit background colour alone.
        elevation: 0,
        shadowOpacity: 0,
        shadowColor: 'transparent',
        borderBottomWidth: 0,
    },
    searchbarInput: {
        minHeight: SEARCHBAR_HEIGHT,
        paddingVertical: 0,
        fontSize: 15,
    },
    // Custom × clear overlay. Sits at right:48, which puts its
    // right edge just to the LEFT of the dialpad toggle (at right:4
    // + ~40 px IconButton width = right:44 inner edge). Vertically
    // centered against the 56 px bar. No background — reads as a
    // bar control like Paper's original × did before we suppressed
    // it (so we could own the right edge for the dialpad).
    clearOverlay: {
        position: 'absolute',
        right: 48,
        top: (SEARCHBAR_HEIGHT - 36) / 2,
        margin: 0,
        zIndex: 5,
        elevation: 5,
    },
    // Dialpad toggle overlay — pinned flush to the right edge of
    // the Searchbar (right:4 leaves a tiny inset so the icon
    // doesn't kiss the rounded corner). The custom × clear overlay
    // above sits at right:48, immediately to the left. Active
    // state fills the IconButton with the AB-green so the toggle's
    // open/closed state reads at a glance.
    dialpadOverlay: {
        position: 'absolute',
        right: 4,
        top: (SEARCHBAR_HEIGHT - 36) / 2,
        margin: 0,
        zIndex: 5,
        elevation: 5,
    },
    // QR scan button — pinned flush to the right edge (right:4),
    // taking the rightmost slot so it sits to the RIGHT of the
    // dialpad. The dialpad gets dialpadOverlayWithQr (right:52)
    // to make room.
    qrOverlay: {
        position: 'absolute',
        right: 4,
        top: (SEARCHBAR_HEIGHT - 36) / 2,
        margin: 0,
        zIndex: 5,
        elevation: 5,
    },
    // Dialpad shifted one IconButton stride (~48px) left so the QR
    // button can own the right edge.
    dialpadOverlayWithQr: {
        right: 52,
    },
    // Invite-mode action pair overlays. Right→left order:
    //   • Invite (account-plus, green when enabled) at right:4
    //   • Cancel (×, neutral) at right:56  ← +52px from Invite,
    //     which is the IconButton width (~36px) + a 16px gap so
    //     the two buttons read as separate touch targets.
    //   • Clear-× (existing) shifts further left to right:108
    //     when in invite mode to clear the action pair.
    inviteOverlay: {
        position: 'absolute',
        right: 4,
        top: (SEARCHBAR_HEIGHT - 36) / 2,
        margin: 0,
        zIndex: 5,
        elevation: 5,
        borderRadius: 18,
    },
    inviteOverlayEnabled: {
        backgroundColor: '#27ae60',
    },
    // Invite button shifted left when the dialpad shares the bar.
    // ~52px stride past the dialpad (which sits at right:4) keeps a
    // visible gap between the two buttons.
    inviteOverlayWithDialpad: {
        right: 52,
    },
});

URIInput.propTypes = {
    defaultValue: PropTypes.string.isRequired,
    autoFocus: PropTypes.bool.isRequired,
    onChange: PropTypes.func.isRequired,
    onSelect: PropTypes.func.isRequired,
    shareToContacts: PropTypes.bool,
    inviteContacts: PropTypes.bool,
    searchMessages: PropTypes.bool,
    contactSource: PropTypes.oneOf(['sylk', 'ab']),
    showDialpad: PropTypes.bool,
    isDialpadActive: PropTypes.bool,
    onDialpadPress: PropTypes.func,
    // In-bar backspace overlay. Rendered to the left of the clear-×
    // while the dialpad is open (isDialpadActive) and the field has
    // text; deletes the last character of the bound input.
    onBackspace: PropTypes.func,
    // QR scan button overlay. When showQr is true a QR icon renders
    // at the right edge of the Searchbar (to the right of the
    // dialpad) and calls onQrPress.
    showQr: PropTypes.bool,
    onQrPress: PropTypes.func,
    // Invite-mode action pair callbacks. URIInput renders the
    // Cancel + Invite buttons as absolute overlays inside the search
    // bar when `inviteContacts` is true; these props are how the
    // hosting component (ReadyBox) wires the actions in.
    inviteEnabled: PropTypes.bool,
    onInvitePress: PropTypes.func,
    onCancelInvitePress: PropTypes.func,
    // Close-search X overlay. When provided, an X icon renders at the
    // right edge of the Searchbar (replacing the dialpad slot) and
    // calls this handler. Used by ReadyBox in folded search-contacts
    // mode where the NavigationBar is hidden — the in-bar X becomes
    // the only way to exit search.
    onCloseSearch: PropTypes.func,
    // Fired the first time the user taps the search field within a
    // given component lifecycle. ReadyBox uses this to kick the
    // address-book load + OS contacts-permission prompt on explicit
    // user search intent (the in-bar source picker that used to
    // gate the prompt has been removed in favour of a unified
    // Sylk + Phonebook search).
    onSearchFocus: PropTypes.func,
    dark: PropTypes.bool, // <-- dark mode as prop
};

export default URIInput;
