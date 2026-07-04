// MessageContextMenu — the long-press contextual menu for a chat
// bubble, redesigned away from the flat gifted-chat ActionSheet into a
// WhatsApp / Telegram-style layered overlay:
//
//   ┌─────────────────────────────┐
//   │   ❤️ 👍 ⭐ 😂 😮  +          │  ← reaction strip (top)
//   │   ┌───────────────────┐     │
//   │   │  the tapped bubble │     │  ← echo of the message, "lifted"
//   │   └───────────────────┘     │     out of the dimmed thread
//   │   ↩ Reply  ⧉ Copy  ➦ More   │  ← primary action row (floating)
//   └─────────────────────────────┘
//   ┌─────────────────────────────┐
//   │  ✎ Edit                     │
//   │  📌 Pin                     │  ← secondary actions (bottom sheet)
//   │  🗑 Delete                   │     revealed by "More"
//   └─────────────────────────────┘
//
// DESIGN
// ------
// The whole point is to split the old one-big-list menu into a
// tiered surface: the handful of actions people actually reach for
// (Reply / Copy / Forward + reactions) float right next to the
// message, while the long tail (Edit, Pin, Share, Download, Info,
// Delete, and every message-type-specific action) is tucked into a
// bottom sheet that only appears when the user taps "More". The
// thumb-reachable bottom edge carries the rare stuff; the common
// stuff sits where the eye already is.
//
// REUSE, NOT REWRITE
// ------------------
// This component does NOT know what any action does. The parent
// (ContactsListBox.onLongMessagePress) builds the exact same
// `options` / `icons` arrays it always built for the ActionSheet and
// hands them here together with the original selection callback. We
// just classify each label into primary vs secondary and, on tap,
// fire onSelect(originalIndex) so the parent's existing giant
// switch runs untouched. That keeps all the per-message-type logic
// (live-location, image groups, file transfers, meeting requests …)
// in one place and means this file can stay purely presentational.
//
// PUBLIC API
// ----------
//   <MessageContextMenu
//       visible={bool}
//       message={currentMessage}
//       options={['Reply','Copy',…,'Cancel']}   // labels, parallel to icons
//       icons={[<Icon/>, <Icon/>, …]}           // gifted-chat-style icon els
//       onSelect={(originalIndex) => …}          // run the parent's action
//       onDismiss={() => …}                      // scrim tap / back
//       reactable={bool}                         // show the reaction strip?
//       reactions={['❤️','👍',…]}
//       onReact={(emoji) => …}
//       onPickerOpen={() => …}                   // "+" → full EmojiPicker
//       isDark={bool}
//   />

import React from 'react';
import {
    Modal,
    View,
    Text,
    Image,
    ScrollView,
    TouchableOpacity,
    TouchableWithoutFeedback,
    StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import RenderHTML from 'react-native-render-html';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import utils from '../utils';

// Labels that earn a spot in the floating primary row (the "most
// likely actions"). Everything else (that isn't 'Cancel') falls
// through to the fixed bottom bar. Matched leniently because some
// labels carry a dynamic suffix, e.g. "Forward selected (3)".
const isPrimaryLabel = (label) =>
    label === 'Reply' ||
    label === 'Copy' ||
    label === 'Full screen' ||
    label.indexOf('Forward') === 0;

// Labels that should read as destructive (red) wherever they appear.
const isDestructiveLabel = (label) => label.indexOf('Delete') === 0;

// Map a gifted-chat option label to a primary-row icon name. The
// parent's `icons` array already carries an <Icon> per option, but
// those are tuned for the dense ActionSheet; for the big-target
// primary row we re-pick a clean glyph so Reply/Forward get the
// natural directional arrows.
const primaryIconFor = (label) => {
    if (label === 'Reply') return 'reply';
    if (label === 'Copy') return 'content-copy';
    if (label === 'Full screen') return 'fullscreen';
    if (label === 'Resend') return 'send';
    if (label.indexOf('Download') === 0) return 'cloud-download';
    if (label.indexOf('Delete') === 0) return 'delete';
    if (label.indexOf('Forward') === 0) return 'share';
    return 'dots-horizontal';
};

// Icon for each secondary (bottom-sheet) action. Rendered natively in
// this component rather than cloning the parent's <Icon> elements —
// cloned elements created in another module rendered unreliably on
// Android (Delete showed as a stray red mark instead of a trash icon).
// Mapping by label keeps the glyphs identical to the action's intent.
const secondaryIconFor = (label) => {
    if (label.indexOf('Delete') === 0) return 'delete';
    if (label === 'Edit' || label === 'Edit caption') return 'file-document-edit';
    if (label === 'Pin') return 'pin';
    if (label === 'Unpin') return 'pin-off';
    if (label === 'Share location') return 'map-marker';
    if (label.indexOf('Share') === 0) return 'share';
    // Matches both 'Download' and 'Download again' (received-file re-fetch).
    if (label.indexOf('Download') === 0) return 'cloud-download';
    if (label === 'Email') return 'email';
    if (label === 'Resend') return 'send';
    if (label === 'Info') return 'information-outline';
    if (label === 'Open') return 'folder-open';
    if (label === 'Preview' || label === 'Full screen') return 'fullscreen';
    if (label === 'Save') return 'content-save';
    if (label === 'Decrypt') return 'table-key';
    if (label === 'Pause') return 'pause';
    if (label === 'Resume') return 'play';
    if (label === 'Meet me there...') return 'map-marker-account';
    if (label === 'Show meeting request...') return 'handshake';
    if (label.indexOf('Forward') === 0) return 'arrow-right';
    if (label === 'Copy') return 'content-copy';
    if (label === 'Reply') return 'reply';
    return 'circle-small';
};

// Short caption under each primary icon. Keep it to one or two words
// so the floating row stays compact; drop the dynamic "(3)" suffixes.
const shortLabel = (label) => {
    if (label.indexOf('Forward') === 0) return 'Forward';
    if (label === 'Full screen') return 'Full screen';
    return label.split(' ')[0];
};

const MessageContextMenu = ({
    visible,
    message,
    options = [],
    icons = [],
    onSelect,
    onDismiss,
    reactable,
    reactions = [],
    onReact,
    onPickerOpen,
    previewImage,
    failed = false,
    isDark = false,
}) => {
    // The secondary actions (bottom bar) stay collapsed until "More"
    // opens them. Reset to collapsed each time the menu opens for a
    // fresh message so it never re-opens already expanded.
    const [sheetOpen, setSheetOpen] = React.useState(false);
    React.useEffect(() => {
        if (visible) setSheetOpen(false);
    }, [visible, message && message._id]);

    // Computed at render (not module-load) so the device height is accurate —
    // a module-level Dimensions read can fire before layout and return a
    // too-small value (≈ the width), which capped the list at ~4 rows and
    // clipped everything after Pin.
    // Bottom safe-area inset (gesture/nav bar). The sheet is anchored at
    // bottom:0, which on Android sits BEHIND the system bar — without this
    // padding the Cancel row and the last list item (e.g. Download again) are
    // hidden off the bottom of the screen. Fallback to 24 in case the inset
    // doesn't propagate into the Modal's separate view tree.
    const _insets = useSafeAreaInsets();
    const sheetBottomPad = Math.max(_insets.bottom || 0, 24) + 12;

    if (!visible || !message) return null;

    const C = isDark ? DARK : LIGHT;

    // Split the options into primary / secondary while remembering
    // each one's index in the ORIGINAL array — that index is what the
    // parent's selection callback switches on. On a failed message,
    // Resend AND Delete are promoted into the primary row — re-send or
    // remove are the two actions that matter for a failed bubble, so
    // neither should be hidden under "More".
    const isPrimary = (label) =>
        isPrimaryLabel(label)
        || (failed && (label === 'Resend' || label.indexOf('Delete') === 0));
    const items = options.map((label, index) => ({ label, index }));
    const primary = items.filter(
        (it) => it.label !== 'Cancel' && isPrimary(it.label)
    );
    const secondary = items.filter(
        (it) => it.label !== 'Cancel' && !isPrimary(it.label)
    );

    // Show the bottom bar only once "More" is tapped — unless there
    // are no primary actions at all, in which case it's the whole menu
    // and there'd be nothing else to show.
    const sheetVisible = sheetOpen || primary.length === 0;

    const fire = (index) => () => onSelect && onSelect(index);

    const isOutgoing = message.direction === 'outgoing';

    // A compact echo of the tapped bubble so it visually "lifts" out
    // of the dimmed thread. Best-effort across types: image → thumb,
    // file → name chip, otherwise the text body.
    const renderEcho = () => {
        // Image bubble, or a video's cached thumbnail (previewImage).
        // For video, overlay a play glyph so the poster frame reads as
        // a video rather than a still.
        const imgSrc = message.image || previewImage;
        if (imgSrc) {
            const isVideo = !message.image && !!previewImage;
            return (
                <View>
                    <Image
                        source={{ uri: imgSrc }}
                        style={styles.echoImage}
                        resizeMode="cover"
                    />
                    {isVideo && (
                        <View style={styles.echoPlayOverlay} pointerEvents="none">
                            <Icon name="play-circle" size={48} color="rgba(255,255,255,0.9)" />
                        </View>
                    )}
                </View>
            );
        }
        const md = message.metadata || {};
        if (md.filename && !message.text) {
            return (
                <View style={[styles.echoBubble, { backgroundColor: C.echoBg }]}>
                    <Icon name="file" size={18} color={C.echoText} />
                    <Text
                        numberOfLines={1}
                        style={[styles.echoFile, { color: C.echoText }]}
                    >
                        {md.filename}
                    </Text>
                </View>
            );
        }
        // HTML-bodied messages (links, formatting, emoji spans) render
        // the same markup the real bubble does, so the preview matches
        // what's in the thread instead of dropping to plain text. Strip
        // baked-in color/background so our own bubble colors apply.
        if (message.html) {
            const html = String(message.html)
                .replace(/background-color:[^;"]+;?/gi, '')
                .replace(/color:[^;"]+;?/gi, '');
            const fg = isOutgoing ? C.echoTextOut : C.echoText;
            // Rich/structured HTML (tables, pasted page fragments full
            // of divs/sections, or just plain BIG payloads) renders
            // broken or enormous here — the echo is meant to be a
            // compact reminder of the tapped bubble, not the document.
            // Same gating as the thread bubble's preview cap
            // (isRichHtml in ChatBox.renderMessageText): show a few
            // lines of extracted text instead. Whitespace is collapsed
            // (stripped markup leaves long newline runs) and the input
            // to Text is sliced — numberOfLines already clips the
            // render, the slice just avoids shaping a 100KB string.
            if (/<table|<tr|<td|<th|<div|<section|<article|<ul|<ol|<blockquote|<pre|<img/i.test(html)
                    || html.length > 600) {
                const echoText = utils.html2text(message.html)
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 400);
                return (
                    <View style={[styles.echoBubble, { backgroundColor: isOutgoing ? C.echoBgOut : C.echoBg }]}>
                        <Text style={{ color: fg, fontSize: 15 }} numberOfLines={6} ellipsizeMode="tail">
                            {echoText}
                        </Text>
                    </View>
                );
            }
            return (
                <View
                    style={[
                        styles.echoBubble,
                        styles.echoHtml,
                        { backgroundColor: isOutgoing ? C.echoBgOut : C.echoBg },
                    ]}
                >
                    <RenderHTML
                        source={{ html }}
                        contentWidth={250}
                        baseStyle={{ color: fg, fontSize: 15 }}
                        tagsStyles={{
                            p: { color: fg, margin: 0 },
                            span: { color: fg, backgroundColor: 'transparent' },
                            a: {
                                color: isOutgoing ? '#ffffff' : '#1DA1F2',
                                textDecorationLine: 'underline',
                            },
                        }}
                        ignoredDomTags={[
                            'html', 'head', 'body', 'title', 'svg', 'meta',
                            'link', 'style', 'script', 'iframe', 'object',
                            'embed', 'noscript',
                        ]}
                        defaultTextProps={{ selectable: false }}
                    />
                </View>
            );
        }
        const body = (message.text || md.filename || '').trim();
        if (!body) return null;
        return (
            <View
                style={[
                    styles.echoBubble,
                    {
                        backgroundColor: isOutgoing ? C.echoBgOut : C.echoBg,
                    },
                ]}
            >
                <Text
                    numberOfLines={4}
                    style={[
                        styles.echoText,
                        { color: isOutgoing ? C.echoTextOut : C.echoText },
                    ]}
                >
                    {body}
                </Text>
            </View>
        );
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onDismiss}
        >
            {/* Scrim — tap anywhere outside the surfaces to dismiss. */}
            <TouchableWithoutFeedback onPress={onDismiss}>
                <View style={[styles.scrim, { backgroundColor: C.scrim }]} />
            </TouchableWithoutFeedback>

            {/* Floating cluster: reaction strip + echo + primary row.
                Anchored slightly above centre so it reads as belonging
                to the message rather than the sheet below. */}
            <View style={styles.clusterWrap} pointerEvents="box-none">
                <View style={styles.cluster} pointerEvents="box-none">
                    {reactable && reactions.length > 0 && (
                        <View style={[styles.reactionStrip, { backgroundColor: C.surface }]}>
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                keyboardShouldPersistTaps="always"
                                contentContainerStyle={styles.reactionScroll}
                            >
                                {reactions.map((emoji) => (
                                    <TouchableOpacity
                                        key={emoji}
                                        style={styles.reactionBtn}
                                        onPress={() => onReact && onReact(emoji)}
                                        accessibilityRole="button"
                                        accessibilityLabel={`React with ${emoji}`}
                                    >
                                        <Text style={styles.reactionEmoji}>{emoji}</Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                            <TouchableOpacity
                                style={[styles.reactionPlus, { borderLeftColor: C.divider }]}
                                onPress={onPickerOpen}
                                accessibilityRole="button"
                                accessibilityLabel="Pick another emoji"
                            >
                                <Icon name="plus" size={22} color={C.subtle} />
                            </TouchableOpacity>
                        </View>
                    )}

                    <View style={styles.echoRow}>{renderEcho()}</View>

                    {primary.length > 0 && (
                        <View style={[styles.primaryRow, { backgroundColor: C.surface }]}>
                            {primary.map((it) => {
                                const pColor = isDestructiveLabel(it.label) ? C.danger : C.text;
                                return (
                                <TouchableOpacity
                                    key={it.index}
                                    style={styles.primaryBtn}
                                    onPress={fire(it.index)}
                                    accessibilityRole="button"
                                    accessibilityLabel={it.label}
                                >
                                    <Icon
                                        name={primaryIconFor(it.label)}
                                        size={22}
                                        color={pColor}
                                    />
                                    <Text style={[styles.primaryLabel, { color: pColor }]}>
                                        {shortLabel(it.label)}
                                    </Text>
                                </TouchableOpacity>
                                );
                            })}
                            {secondary.length > 0 && (
                                <TouchableOpacity
                                    style={styles.primaryBtn}
                                    onPress={() => setSheetOpen((v) => !v)}
                                    accessibilityRole="button"
                                    accessibilityLabel="More actions"
                                >
                                    <Icon
                                        name={sheetOpen ? 'chevron-down' : 'dots-horizontal'}
                                        size={22}
                                        color={C.text}
                                    />
                                    <Text style={[styles.primaryLabel, { color: C.text }]}>
                                        More
                                    </Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    )}
                </View>
            </View>

            {/* Secondary actions — bottom bar revealed by "More". */}
            {sheetVisible && secondary.length > 0 && (
                <View style={[styles.sheet, { backgroundColor: C.surface, paddingBottom: sheetBottomPad }]}>
                    <View style={[styles.grabber, { backgroundColor: C.divider }]} />
                    {/* Plain View (not a ScrollView): render every row so the
                        sheet grows to fit them all with no internal scrolling.
                        The sheet's own maxHeight is the only safety clip for a
                        pathologically long action list. */}
                    <View>
                        {secondary.map((it) => {
                            const destructive = isDestructiveLabel(it.label);
                            const color = destructive ? C.danger : C.text;
                            return (
                                <TouchableOpacity
                                    key={it.index}
                                    style={styles.sheetRow}
                                    onPress={fire(it.index)}
                                    accessibilityRole="button"
                                    accessibilityLabel={it.label}
                                >
                                    <View style={{ width: 28, alignItems: 'center' }}>
                                        <Icon
                                            name={secondaryIconFor(it.label)}
                                            size={20}
                                            color={color}
                                        />
                                    </View>
                                    <Text style={[styles.sheetLabel, { color }]}>
                                        {it.label}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                    <TouchableOpacity
                        style={[styles.cancelRow, { borderTopColor: C.divider }]}
                        onPress={onDismiss}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel"
                    >
                        <Icon name="close" size={20} color={C.subtle} />
                        <Text style={[styles.sheetLabel, { color: C.subtle }]}>
                            Cancel
                        </Text>
                    </TouchableOpacity>
                </View>
            )}
        </Modal>
    );
};

const styles = StyleSheet.create({
    scrim: {
        ...StyleSheet.absoluteFillObject,
    },
    clusterWrap: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        paddingHorizontal: 16,
        // Bias upward so the cluster doesn't collide with the bottom
        // sheet when it's open.
        paddingBottom: 120,
    },
    cluster: {
        alignItems: 'center',
    },
    reactionStrip: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 28,
        paddingVertical: 6,
        paddingLeft: 10,
        paddingRight: 4,
        maxWidth: '100%',
        marginBottom: 24,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 8,
    },
    reactionScroll: {
        alignItems: 'center',
    },
    reactionBtn: {
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    reactionEmoji: {
        fontSize: 28,
    },
    reactionPlus: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        marginLeft: 4,
        borderLeftWidth: StyleSheet.hairlineWidth,
    },
    echoRow: {
        maxWidth: '100%',
        marginBottom: 24,
    },
    echoBubble: {
        flexDirection: 'row',
        alignItems: 'center',
        maxWidth: 280,
        paddingVertical: 9,
        paddingHorizontal: 13,
        borderRadius: 16,
    },
    echoText: {
        fontSize: 15,
        lineHeight: 20,
    },
    echoHtml: {
        flexDirection: 'column',
        alignItems: 'flex-start',
        maxWidth: 280,
        minWidth: 60,
    },
    echoFile: {
        fontSize: 14,
        marginLeft: 8,
        flexShrink: 1,
    },
    echoImage: {
        width: 240,
        height: 240,
        borderRadius: 14,
    },
    echoPlayOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 18,
        paddingVertical: 8,
        paddingHorizontal: 6,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 8,
    },
    primaryBtn: {
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 64,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    primaryLabel: {
        fontSize: 11,
        marginTop: 3,
    },
    sheet: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: '92%',
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        paddingTop: 8,
        paddingBottom: 24,
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -2 },
        elevation: 12,
    },
    grabber: {
        alignSelf: 'center',
        width: 38,
        height: 4,
        borderRadius: 2,
        marginBottom: 8,
    },
    sheetScroll: {
        // Robust bottom-sheet list sizing:
        //   flexGrow: 0   — don't stretch beyond content
        //   flexShrink: 1 — give up space to the pinned Cancel row
        //   minHeight: 0  — the flexbox gotcha: without this a flex item
        //                   refuses to shrink below its content size, so the
        //                   list either overflowed (clipping the last rows,
        //                   e.g. Download again) or couldn't scroll.
        // Combined with the inline maxHeight, the list grows to its content,
        // caps at maxHeight, and scrolls when it overflows.
        flexGrow: 0,
        flexShrink: 1,
        minHeight: 0,
    },
    sheetRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 13,
        paddingHorizontal: 22,
    },
    sheetLabel: {
        fontSize: 15,
        marginLeft: 16,
    },
    cancelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 22,
        marginTop: 6,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
});

const LIGHT = {
    scrim: 'rgba(0,0,0,0.66)',
    surface: '#ffffff',
    text: '#1b1b1b',
    subtle: '#666',
    divider: 'rgba(0,0,0,0.15)',
    danger: '#E53935',
    echoBg: '#ECECEC',
    echoText: '#1b1b1b',
    echoBgOut: '#4572A6',
    echoTextOut: '#ffffff',
};

const DARK = {
    scrim: 'rgba(0,0,0,0.8)',
    surface: '#1f262e',
    text: '#e8eaed',
    subtle: '#9aa0a6',
    divider: 'rgba(255,255,255,0.16)',
    danger: '#ff6b6b',
    echoBg: '#2a313a',
    echoText: '#e8eaed',
    echoBgOut: '#185FA5',
    echoTextOut: '#ffffff',
};

export default MessageContextMenu;
