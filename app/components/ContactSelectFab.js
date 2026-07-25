import React from 'react';
import PropTypes from 'prop-types';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcon from '@react-native-vector-icons/material-design-icons';

// ContactSelectFab — the floating bulk-action button cluster shown while the
// contacts list is in multi-select mode (props.contactSelectMode). Extracted
// from ReadyBox.render. Purely presentational: each action is a callback, and
// the decision logic for restore/merge (which list, what confirmation) lives in
// ReadyBox's handleBulkRestore / handleBulkMerge.
//
// Button set (top → bottom):
//   • Cancel  — always shown; exits select mode.
//   • Restore — only in the Deleted / Graveyard folders with ≥1 selected.
//   • Merge   — only while searching with ≥2 selected.
//   • Delete  — shown with ≥1 selected.
function ContactSelectFab(props) {
    const {
        visible,
        selectedCount,
        contactsFilter,
        searchContacts,
        onCancel,
        onRestore,
        onMerge,
        onDelete,
    } = props;

    if (!visible) {
        return null;
    }

    const inTrashFolder = contactsFilter === 'deleted' || contactsFilter === 'graveyard';
    const showRestore = selectedCount > 0 && inTrashFolder;
    const showMerge = searchContacts && selectedCount >= 2;
    const showDelete = selectedCount > 0;

    return (
        <View style={readyBoxTrashStyles.contactSelectFab} pointerEvents="box-none">
            <TouchableOpacity
                style={[readyBoxTrashStyles.fabBtn, readyBoxTrashStyles.fabCancel]}
                onPress={onCancel}>
                <MaterialCommunityIcon name="close" size={24} color="#fff" />
            </TouchableOpacity>

            {showRestore ? (
                <TouchableOpacity
                    style={[readyBoxTrashStyles.fabBtn, readyBoxTrashStyles.fabRestore]}
                    onPress={onRestore}>
                    <MaterialCommunityIcon name="restore" size={24} color="#fff" />
                </TouchableOpacity>
            ) : null}

            {/* Merge — only while searching, with 2+ selected. Folds every
                selected contact's addresses into one (smallest contact_id kept,
                others removed; a brand-new contact is minted if none are
                saved). */}
            {showMerge ? (
                <TouchableOpacity
                    style={[readyBoxTrashStyles.fabBtn, { backgroundColor: '#436294' }]}
                    onPress={onMerge}>
                    <MaterialCommunityIcon name="merge" size={24} color="#fff" />
                    <Text style={readyBoxTrashStyles.fabCount}>{selectedCount}</Text>
                </TouchableOpacity>
            ) : null}

            {showDelete ? (
                <TouchableOpacity
                    style={[readyBoxTrashStyles.fabBtn, readyBoxTrashStyles.fabDelete]}
                    onPress={onDelete}>
                    <MaterialCommunityIcon name="delete" size={24} color="#fff" />
                    <Text style={readyBoxTrashStyles.fabCount}>{selectedCount}</Text>
                </TouchableOpacity>
            ) : null}
        </View>
    );
}

ContactSelectFab.propTypes = {
    visible: PropTypes.bool,
    selectedCount: PropTypes.number,
    contactsFilter: PropTypes.string,
    searchContacts: PropTypes.bool,
    onCancel: PropTypes.func,
    onRestore: PropTypes.func,
    onMerge: PropTypes.func,
    onDelete: PropTypes.func,
};

const readyBoxTrashStyles = StyleSheet.create({
    contactSelectFab: {
        position: 'absolute',
        right: 16,
        bottom: 24,
        alignItems: 'center',
    },
    fabBtn: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 12,
        elevation: 6,
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
    },
    fabCancel: { backgroundColor: '#757575' },
    fabDelete: { backgroundColor: '#c62828' },
    fabRestore: { backgroundColor: '#2e7d32' },
    fabCount: {
        color: '#fff',
        fontSize: 11,
        fontWeight: 'bold',
        marginTop: -2,
    },
});

export default ContactSelectFab;
