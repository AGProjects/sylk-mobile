// Quick-reaction bar — rendered INLINE via gifted-chat's
// `renderChatFooter` slot, which puts it directly above the input
// toolbar and shrinks the message list to make room. There's no
// absolute layer / backdrop any more: the bar takes its own layout
// space so the most recent bubble can't end up hidden underneath.
//
// Tapping an emoji pill fires onSelect(emoji) on the parent, which
// routes through the existing reply-to pipeline — a reaction is
// just a reply whose body is the emoji.
//
// PUBLIC API
//   <ReactionBar
//       visible={bool}
//       emojis={['❤️','👍',…]}
//       onSelect={(emoji) => …}     // tap a pill
//       onPickerOpen={() => …}      // tap the "+" overflow
//   />
//
// Dismissal:
//   • The user picks an emoji and the parent clears reactionTarget.
//   • Tapping another message retargets the bar.
//   • Android hardware back closes (wired in ContactsListBox.backPressed).
//   • The "+" path opens the full EmojiPicker.

import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
} from 'react-native';

const ReactionBar = ({ visible, emojis = [], onSelect, onPickerOpen }) => {
    if (!visible) return null;

    return (
        <View style={styles.bar}>
            <View style={styles.pill}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="always"
                    contentContainerStyle={styles.scrollContent}
                    style={styles.scroll}
                >
                    {emojis.map((emoji) => (
                        <TouchableOpacity
                            key={emoji}
                            onPress={() => onSelect && onSelect(emoji)}
                            style={styles.emojiButton}
                            accessibilityRole="button"
                            accessibilityLabel={`React with ${emoji}`}
                        >
                            <Text style={styles.emojiText}>{emoji}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
                <TouchableOpacity
                    onPress={onPickerOpen}
                    style={styles.plusButton}
                    accessibilityRole="button"
                    accessibilityLabel="Pick another emoji"
                >
                    <Text style={styles.plusText}>+</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    // Outer block: takes its own height in the chat-footer slot.
    // alignItems centres the pill horizontally. Extra bottom
    // padding leaves a visible gap between the pill and the input
    // toolbar below so the two surfaces don't feel glued together.
    bar: {
        alignItems: 'center',
        paddingTop: 6,
        paddingBottom: 16,
        paddingHorizontal: 8,
        backgroundColor: 'transparent',
    },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'white',
        paddingVertical: 6,
        paddingLeft: 10,
        paddingRight: 4,
        borderRadius: 28,
        maxWidth: '100%',
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 6,
    },
    // Scroller shrinks to fit alongside the always-visible "+"
    // button on the right.
    scroll: {
        flexShrink: 1,
    },
    scrollContent: {
        alignItems: 'center',
    },
    emojiButton: {
        paddingHorizontal: 6,
        paddingVertical: 4,
    },
    emojiText: {
        fontSize: 26,
    },
    plusButton: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        marginLeft: 4,
        borderLeftWidth: StyleSheet.hairlineWidth,
        borderLeftColor: 'rgba(0,0,0,0.15)',
    },
    plusText: {
        fontSize: 22,
        color: '#666',
        lineHeight: 26,
    },
});

export default ReactionBar;
