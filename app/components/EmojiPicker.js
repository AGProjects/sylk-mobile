// In-app emoji picker. Pure JS — no native modules, no new dependencies,
// no patches. Lives behind a smiley button in the chat composer so the
// user never has to switch the system IME to its emoji panel.
//
// LAYOUT MODEL
// ------------
// This component renders as an INLINE View, not a Modal. It's intended
// to be mounted as a sibling of GiftedChat inside the same flex
// container, with a fixed height. When `visible` flips on, the parent
// chat container's flex math shrinks GiftedChat's slot; GiftedChat's
// input toolbar (the bottom row of GiftedChat) moves up by the
// picker's height; the picker fills the freed space at the bottom.
// Net result is the same shape as opening the system keyboard:
//
//     [chat messages]
//     [input bar]            <-- floats above picker
//     [emoji picker]         <-- this component
//
// When `visible` is false the component renders null and the chat
// container expands back. The parent should ALSO ensure the system
// keyboard is dismissed before opening the picker (and vice-versa) so
// the keyboard and picker don't fight for the same vertical real estate.
//
// PUBLIC API
// ----------
//   <EmojiPicker visible={bool} height={number?} onSelect={(emoji) => …} />
//
// `onSelect` fires with a single emoji string; the parent decides
// whether to append, replace, send, etc. The picker stays mounted
// while `visible` is true so the user can pick several in a row.
// `height` is optional (default 280) — pass a different value if the
// chat layout needs more or less room (e.g. tablet / foldable inner
// display).

import React from 'react';
import {
    View,
    Text,
    FlatList,
    TouchableOpacity,
    Dimensions,
} from 'react-native';

// Curated emoji set — kept inline so this file has zero data
// dependencies. Six categories cover the common ground; the goal isn't
// to ship a full Unicode emoji table (~3500 codepoints), it's to give
// users the same hit-rate they'd get from the system emoji keyboard for
// chat reactions and casual messaging.
const CATEGORIES = [
    {
        key: 'smileys',
        label: '😀',
        emojis: [
            '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃',
            '😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙',
            '😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔',
            '🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥',
            '😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮',
            '🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐',
            '😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦',
            '😧','😨','😰','😥','😢','😭','😱','😖','😣','😞',
            '😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿',
            '💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖',
        ],
    },
    {
        key: 'gestures',
        label: '👍',
        emojis: [
            '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞',
            '🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍',
            '👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝',
            '🙏','✍️','💅','🤳','💪','🦾','🦵','🦿','🦶','👂',
            '🦻','👃','🧠','🦷','🦴','👀','👁️','👅','👄','💋',
        ],
    },
    {
        key: 'hearts',
        label: '❤️',
        emojis: [
            '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
            '❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️',
            '💯','💢','💥','💫','💦','💨','🕳️','💣','💬','👁️‍🗨️',
            '🗨️','🗯️','💭','💤','✨','🌟','⭐','🌠','☀️','🌈',
        ],
    },
    {
        key: 'animals',
        label: '🐶',
        emojis: [
            '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯',
            '🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒',
            '🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇',
            '🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜',
            '🪰','🪱','🦗','🕷️','🦂','🐢','🐍','🦎','🦖','🦕',
            '🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳',
            '🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛',
            '🦏','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖',
        ],
    },
    {
        key: 'food',
        label: '🍔',
        emojis: [
            '🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐',
            '🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑',
            '🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅',
            '🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳',
            '🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔',
            '🍟','🍕','🥪','🥙','🧆','🌮','🌯','🥗','🥘','🫕',
            '🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤',
            '🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦',
            '🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩',
            '🍪','☕','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂',
        ],
    },
    {
        key: 'symbols',
        label: '✅',
        emojis: [
            '✅','❌','❎','⭕','🚫','⛔','📛','🔞','♻️','✳️',
            '❇️','✴️','❄️','❣️','♨️','🆎','🆑','🆒','🆓','🆔',
            '🆕','🆖','🆗','🆘','🆙','🆚','🅰️','🅱️','🅾️','🅿️',
            '🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺',
            '🔻','🔸','🔹','🔶','🔷','🔳','🔲','▪️','▫️','◾',
            '◽','◼️','◻️','⬛','⬜','🟥','🟧','🟨','🟩','🟦',
            '🟪','🟫','♠️','♥️','♦️','♣️','🃏','🎴','🀄','🎭',
        ],
    },
];

// Width of each emoji cell. The grid auto-fills the container width:
// numColumns is computed at render time from the available width
// divided by CELL_WIDTH, so a tablet / foldable inner display gets more
// columns and a phone fewer.
const CELL_WIDTH = 44;
const CELL_HEIGHT = 44;

class EmojiPicker extends React.Component {
    state = {
        activeCategory: CATEGORIES[0].key,
    };

    setCategory = (key) => () => this.setState({ activeCategory: key });

    handleEmojiPress = (emoji) => () => {
        if (this.props.onSelect) {
            this.props.onSelect(emoji);
        }
    };

    render() {
        const { visible, height = 280 } = this.props;

        // Render NOTHING when collapsed. Returning a 0-height View
        // would still consume layout time and pump the FlatList; null
        // skips the subtree entirely so GiftedChat reclaims its full
        // size with no leftover artifacts.
        if (!visible) return null;

        const { activeCategory } = this.state;
        const category =
            CATEGORIES.find((c) => c.key === activeCategory) || CATEGORIES[0];

        // Recompute grid columns each render against current window
        // width — handles fold/unfold and orientation changes without
        // any extra plumbing.
        const winW = Dimensions.get('window').width;
        const numColumns = Math.max(6, Math.floor((winW - 16) / CELL_WIDTH));

        return (
            <View
                style={{
                    height,
                    backgroundColor: '#fff',
                    borderTopWidth: 1,
                    borderTopColor: '#e0e0e0',
                }}>
                {/* Category tab bar */}
                <View
                    style={{
                        flexDirection: 'row',
                        justifyContent: 'space-around',
                        paddingVertical: 6,
                        borderBottomWidth: 1,
                        borderBottomColor: '#eee',
                    }}>
                    {CATEGORIES.map((cat) => {
                        const isActive = cat.key === activeCategory;
                        return (
                            <TouchableOpacity
                                key={cat.key}
                                onPress={this.setCategory(cat.key)}
                                style={{
                                    paddingVertical: 6,
                                    paddingHorizontal: 10,
                                    borderBottomWidth: 2,
                                    borderBottomColor: isActive ? '#2196F3' : 'transparent',
                                }}>
                                <Text style={{ fontSize: 22 }}>{cat.label}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>

                {/* Emoji grid. Keyed on category + numColumns so
                    switching categories or rotating fully resets the
                    list (otherwise FlatList tries to reuse rows across
                    incompatible datasets / column counts). */}
                <FlatList
                    key={category.key + '-' + numColumns}
                    data={category.emojis}
                    numColumns={numColumns}
                    keyExtractor={(item, idx) => item + idx}
                    contentContainerStyle={{
                        paddingHorizontal: 8,
                        paddingTop: 4,
                        paddingBottom: 8,
                    }}
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            onPress={this.handleEmojiPress(item)}
                            style={{
                                width: CELL_WIDTH,
                                height: CELL_HEIGHT,
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}>
                            <Text style={{ fontSize: 28 }}>{item}</Text>
                        </TouchableOpacity>
                    )}
                />
            </View>
        );
    }
}

export default EmojiPicker;
