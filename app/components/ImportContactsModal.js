import React, { useState, useEffect, useCallback } from 'react';
import ThemedModalSurface from './ThemedModalSurface';
import { Modal, View, ScrollView, TouchableWithoutFeedback, StyleSheet, Dimensions } from 'react-native';
import PropTypes from 'prop-types';
import { Text, Surface, Button, ActivityIndicator } from 'react-native-paper';

import containerStyles from '../assets/styles/ContainerStyles';

const styles = StyleSheet.create({
  inner: { paddingHorizontal: 12, paddingBottom: 10 },
  meta: { fontSize: 12, color: '#8a97b0', textAlign: 'center', paddingVertical: 14 },
  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, paddingHorizontal: 12, marginTop: 8,
    borderRadius: 10, borderWidth: 1, borderColor: '#28324a', backgroundColor: '#0c1220',
  },
  date: { color: '#e8edf6', fontSize: 14, fontWeight: '600' },
  sub: { color: '#8a97b0', fontSize: 12, marginTop: 2 },
  new: { color: '#2bd9a4', fontWeight: '700' },
  added: { color: '#2bd9a4', fontSize: 12, marginTop: 2, fontWeight: '600' },
  error: { color: '#ff5d6c', fontSize: 12, marginTop: 2 },
  footer: { paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#28324a',
    flexDirection: 'row', justifyContent: 'flex-end' },
});

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch (e) { return iso; }
}

const ImportContactsModal = (props) => {
  const [backups, setBackups] = useState([]);
  const [busyPath, setBusyPath] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  // Hydrate the list each time the modal opens (or when the parent supplies a
  // fresh diff). Backups + new-contact counts are computed by the parent.
  useEffect(() => {
    if (!props.show) return;
    setResult(null);
    setBusyPath(null);
    setBackups(Array.isArray(props.backups) ? props.backups : []);
  }, [props.show, props.backups]);

  const close = useCallback(() => { if (props.close) props.close(); }, [props]);

  const doImport = async (bk) => {
    if (busyPath) return;
    setResult(null);
    setBusyPath(bk.path);
    try {
      const r = await props.onImport(bk.path);
      setResult({ path: bk.path, added: (r && typeof r.added === 'number') ? r.added : 0, error: r && r.error });
      // Re-diff so counts drop to reflect the just-added contacts.
      if (typeof props.refresh === 'function') {
        setLoading(true);
        const fresh = await props.refresh();
        setBackups(Array.isArray(fresh) ? fresh : []);
        setLoading(false);
      }
    } catch (e) {
      setResult({ path: bk.path, error: (e && e.message) || 'Import failed' });
    } finally {
      setBusyPath(null);
    }
  };

  // Orientation-agnostic sizing: derive the scroll-body height from the current
  // window instead of a fixed 360 (which overflowed in landscape). Width is
  // capped and centred in landscape so the card doesn't stretch edge-to-edge.
  const _winH = Dimensions.get('window').height;
  const _winW = Dimensions.get('window').width;
  const _isLandscape = _winW > _winH;
  const _scrollMaxHeight = _isLandscape
    ? Math.max(140, Math.floor(_winH * 0.55))
    : Math.min(360, Math.floor(_winH * 0.55));
  // Explicit `width`, NOT maxWidth: paper v5's iOS Surface splits styles
  // across two shadow-layer views — width/alignSelf go to the outer one,
  // maxWidth to the inner one — so with maxWidth the outer white card
  // stretched full-width in landscape/tablet while the content stayed
  // capped in its left half. A single explicit width keeps both in sync.
  const _surfaceExtra = _isLandscape ? { alignSelf: 'center', width: Math.min(560, _winW * 0.85) } : null;

  return (
    <Modal style={containerStyles.container} visible={!!props.show} transparent animationType="fade"
      onRequestClose={close} supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}>
      <TouchableWithoutFeedback onPress={close}>
        <View style={containerStyles.overlay}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <ThemedModalSurface style={[containerStyles.modalSurface, _surfaceExtra]}>
              <Text style={containerStyles.title}>Restore contacts</Text>
              <ScrollView style={{ maxHeight: _scrollMaxHeight }} keyboardShouldPersistTaps="handled">
                <View style={styles.inner}>
                  {loading ? (
                    <View style={{ alignItems: 'center', paddingVertical: 10 }}>
                      <ActivityIndicator />
                    </View>
                  ) : null}

                  {backups.length === 0 ? (
                    <Text style={styles.meta}>No contact backups found on this device.</Text>
                  ) : backups.map((bk) => {
                    const res = result && result.path === bk.path ? result : null;
                    return (
                      <View key={bk.path} style={styles.card}>
                        <View style={{ flex: 1, paddingRight: 10 }}>
                          <Text style={styles.date}>{fmtDate(bk.timestamp) || bk.name}</Text>
                          <Text style={styles.sub}>
                            {bk.total} contact{bk.total === 1 ? '' : 's'} ·{' '}
                            <Text style={styles.new}>{bk.newCount} new</Text>
                          </Text>
                          {res && typeof res.added === 'number' && !res.error
                            ? <Text style={styles.added}>Restored {res.added} new contact{res.added === 1 ? '' : 's'}</Text> : null}
                          {res && res.error ? <Text style={styles.error}>{res.error}</Text> : null}
                        </View>
                        <Button mode="contained" compact
                          loading={busyPath === bk.path}
                          disabled={busyPath !== null || bk.newCount === 0}
                          onPress={() => doImport(bk)}>
                          {bk.newCount > 0 ? `Restore ${bk.newCount}` : 'None'}
                        </Button>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>

              <View style={styles.footer}>
                <Button onPress={close}>Close</Button>
              </View>
            </ThemedModalSurface>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

ImportContactsModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func,
  backups: PropTypes.array,   // [{ path, name, timestamp, total, newCount }]
  onImport: PropTypes.func,   // (path) => Promise<{ added, error }>
  refresh: PropTypes.func,    // () => Promise<backups[]>
};

export default ImportContactsModal;
