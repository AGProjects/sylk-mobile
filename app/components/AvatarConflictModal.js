import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { View, Modal, Image, ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Text, Button, Checkbox, Divider } from 'react-native-paper';
import ThemedModalSurface from './ThemedModalSurface';
import { getModalColors } from '../paperTheme';
import containerStyles from '../assets/styles/ContainerStyles';

// Which picture to keep, per contact, when a contact has one both on the
// server and on this device (docs/CONTACT-AVATARS.md, "Pictures set on this
// device"). One row per contact, two columns -- On the server / On this
// device -- each with the picture, a Keep box and where it comes from.
// Exactly one box per row is ticked; the default is the newer picture.
// Select All ticks a whole column. Confirm is the only way out.
//
// items: [{contactId, name, detail, serverPhoto, serverDevice, serverTime,
//          localPhoto, localTime, localSource: 'editor'|'phonebook',
//          default: 'server'|'local'}]
// onConfirm({[contactId]: 'server'|'local'})

const AVATAR = 64;

function when(ms) {
    if (!ms) return '';
    try { return new Date(ms).toLocaleString(); } catch (e) { return ''; }
}

const AvatarConflictModal = ({ show, items, account, onConfirm }) => {
    const [choice, setChoice] = useState({});
    // Heights of the fixed parts (title, intro, column headers) and of the
    // footer with Confirm, measured, so the list gets exactly what is left.
    // Confirm must always be on screen: it is the only way out.
    const [headH, setHeadH] = useState(0);
    const [footH, setFootH] = useState(0);
    const { width: winW, height: winH } = useWindowDimensions();
    const cardWidth = Math.min(520, winW - 32);
    // Room for the status and navigation bars (edge-to-edge on recent
    // Android), the overlay padding and the card padding.
    const CHROME = 140;
    const listMax = Math.max(96, winH - CHROME - headH - footH);
    const colors = getModalColors();

    useEffect(() => {
        if (show && Array.isArray(items)) {
            const initial = {};
            for (const it of items) initial[it.contactId] = it.default === 'local' ? 'local' : 'server';
            setChoice(initial);
        }
    }, [show, items]);

    if (!show || !Array.isArray(items) || !items.length) return null;

    const selectAll = (side) => {
        const next = {};
        for (const it of items) next[it.contactId] = side;
        setChoice(next);
    };
    const nServer = items.filter((it) => choice[it.contactId] === 'server').length;
    const nLocal = items.length - nServer;

    const column = (it, side) => {
        const ticked = choice[it.contactId] === side;
        const photo = side === 'server' ? it.serverPhoto : it.localPhoto;
        const source = side === 'server'
            ? [it.serverDevice, when(it.serverTime)].filter(Boolean).join('\n')
            : [it.localSource === 'phonebook' ? 'Phonebook' : 'This device', when(it.localTime)].filter(Boolean).join('\n');
        return (
            <TouchableOpacity
                style={[styles.cell, ticked ? { borderColor: colors.accent || '#1565c0' } : { borderColor: 'transparent' }]}
                onPress={() => setChoice((prev) => ({ ...prev, [it.contactId]: side }))}
                accessibilityLabel={(side === 'server' ? 'Keep the server picture of ' : 'Keep the picture on this device of ') + it.name}
            >
                {photo ? <Image source={{ uri: photo }} style={styles.photo} /> : <View style={styles.photo} />}
                <View style={styles.keepRow}>
                    <Checkbox.Android status={ticked ? 'checked' : 'unchecked'}
                        onPress={() => setChoice((prev) => ({ ...prev, [it.contactId]: side }))} />
                    <Text>Keep</Text>
                </View>
                <Text style={[styles.source, { color: colors.textSecondary }]}>{source}</Text>
            </TouchableOpacity>
        );
    };

    return (
        <Modal
            visible={!!show}
            transparent
            animationType="fade"
            onRequestClose={() => {}}
            supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
        >
            <View style={containerStyles.overlay}>
                <ThemedModalSurface style={[containerStyles.modalSurface, { width: cardWidth }]}>
                    <View style={{ overflow: 'hidden', borderRadius: 10 }}>
                        <View onLayout={(e) => setHeadH(e.nativeEvent.layout.height)}>
                        <Text style={containerStyles.title}>Contact pictures</Text>
                        <Text style={[styles.intro, { color: colors.textPrimary }]}>
                            {items.length === 1 ? 'This contact has' : items.length + ' contacts have'} a picture on the
                            server and on this device. Choose which to keep; a picture kept from this device
                            replaces the server one on all your devices.
                        </Text>
                        <View style={styles.headerRow}>
                            <View style={styles.nameCol} />
                            <View style={styles.headerCell}>
                                <Text style={styles.headerText}>On the server</Text>
                                <Button compact mode="text" onPress={() => selectAll('server')}>Select All</Button>
                            </View>
                            <View style={styles.headerCell}>
                                <Text style={styles.headerText}>On this device</Text>
                                <Button compact mode="text" onPress={() => selectAll('local')}>Select All</Button>
                            </View>
                        </View>
                        <Divider />
                        </View>
                        <ScrollView style={{ maxHeight: listMax }}>
                            {items.map((it) => (
                                <View key={it.contactId}>
                                    <View style={styles.row}>
                                        <View style={styles.nameCol}>
                                            <Text numberOfLines={2} style={styles.name}>{it.name}</Text>
                                            {it.detail && it.detail !== it.name ? (
                                                <Text numberOfLines={1} style={[styles.detail, { color: colors.textSecondary }]}>{it.detail}</Text>
                                            ) : null}
                                        </View>
                                        {column(it, 'server')}
                                        {column(it, 'local')}
                                    </View>
                                    <Divider />
                                </View>
                            ))}
                        </ScrollView>
                        <View style={styles.footer} onLayout={(e) => setFootH(e.nativeEvent.layout.height)}>
                            <Text style={[styles.detail, { color: colors.textSecondary, flex: 1 }]}>
                                {nServer} from the server, {nLocal} from this device
                            </Text>
                            <Button mode="contained" onPress={() => onConfirm && onConfirm({ ...choice })}>Confirm</Button>
                        </View>
                    </View>
                </ThemedModalSurface>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    intro: { fontSize: 13, marginHorizontal: 16, marginBottom: 8 },
    headerRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 8 },
    headerCell: { flex: 1, alignItems: 'center' },
    headerText: { fontWeight: 'bold', fontSize: 13 },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6 },
    nameCol: { width: 92, paddingRight: 6 },
    name: { fontSize: 14 },
    detail: { fontSize: 11 },
    cell: { flex: 1, alignItems: 'center', borderWidth: 2, borderRadius: 8, paddingVertical: 4, marginHorizontal: 2 },
    photo: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: '#ccc' },
    keepRow: { flexDirection: 'row', alignItems: 'center' },
    source: { fontSize: 10, textAlign: 'center' },
    footer: { flexDirection: 'row', alignItems: 'center', padding: 12 },
});

AvatarConflictModal.propTypes = {
    show: PropTypes.bool,
    items: PropTypes.array,
    account: PropTypes.string,
    onConfirm: PropTypes.func,
};

export default AvatarConflictModal;
