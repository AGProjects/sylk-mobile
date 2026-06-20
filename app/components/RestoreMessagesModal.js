import React, { useState, useEffect, useCallback } from 'react';
import {
  Text, Modal, View, ScrollView, TouchableWithoutFeedback, StyleSheet, Dimensions,
} from 'react-native';
import PropTypes from 'prop-types';
import { Surface, Button, ActivityIndicator } from 'react-native-paper';

import containerStyles from '../assets/styles/ContainerStyles';

const styles = StyleSheet.create({
  inner: { paddingHorizontal: 12, paddingBottom: 10 },
  meta: { fontSize: 12, color: '#8a97b0', textAlign: 'center', paddingVertical: 14 },
  card: {
    paddingVertical: 10, paddingHorizontal: 12, marginTop: 8,
    borderRadius: 10, borderWidth: 1, borderColor: '#28324a', backgroundColor: '#0c1220',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { color: '#e8edf6', fontSize: 14, fontWeight: '600' },
  sub: { color: '#8a97b0', fontSize: 12, marginTop: 2 },
  new: { color: '#2bd9a4', fontWeight: '700' },
  added: { color: '#2bd9a4', fontSize: 12, marginTop: 4, fontWeight: '600' },
  none: { color: '#8a97b0', fontSize: 12, marginTop: 4, fontWeight: '600' },
  error: { color: '#ff5d6c', fontSize: 12, marginTop: 4 },
  btns: { flexDirection: 'row', alignItems: 'center' },
  contactList: {
    marginTop: 8, maxHeight: 160, borderTopWidth: 1, borderTopColor: '#28324a', paddingTop: 6,
  },
  contactRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3,
  },
  contactUri: { color: '#cdd6e6', fontSize: 12, flex: 1, paddingRight: 8 },
  contactCount: { color: '#8a97b0', fontSize: 12, fontVariant: ['tabular-nums'] },
  contactNew: { color: '#2bd9a4', fontWeight: '700' },
  footer: {
    paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#28324a',
    flexDirection: 'row', justifyContent: 'flex-end',
  },
});

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch (e) { return iso; }
}

// Two-step restore flow per backup file:
//   1. Load — reads + parses the plaintext .json backup and diffs it against
//      current storage, showing how many messages are new (by msg_id) plus a
//      scrollable per-contact breakdown of message counts.
//   2. Restore — inserts ONLY the missing rows (add-only; INSERT OR IGNORE).
// `busy` (per-path phase) drives the progress indicators.
const RestoreMessagesModal = (props) => {
  const [backups, setBackups] = useState([]);
  // info[path] = { total, newCount, timestamp, error }  (post-load diff)
  const [info, setInfo] = useState({});
  // result[path] = { added, error }  (post-restore)
  const [result, setResult] = useState({});
  // busy = { path, phase: 'load' | 'restore' } — only one op at a time.
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (!props.show) return;
    setInfo({});
    setResult({});
    setBusy(null);
    setBackups(Array.isArray(props.backups) ? props.backups : []);
  }, [props.show, props.backups]);

  const close = useCallback(() => { if (props.close) props.close(); }, [props]);

  const doLoad = async (bk) => {
    if (busy) return;
    setBusy({ path: bk.path, phase: 'load' });
    setResult((r) => ({ ...r, [bk.path]: undefined }));
    try {
      const d = await props.onLoad(bk.path);
      if (d && d.ok) {
        setInfo((m) => ({ ...m, [bk.path]: { total: d.total, newCount: d.newCount, timestamp: d.timestamp, account: d.account, contacts: d.contacts || [] } }));
      } else {
        setInfo((m) => ({ ...m, [bk.path]: { error: (d && d.error) || 'Load failed' } }));
      }
    } catch (e) {
      setInfo((m) => ({ ...m, [bk.path]: { error: (e && e.message) || 'Load failed' } }));
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async (bk) => {
    if (busy) return;
    setBusy({ path: bk.path, phase: 'restore' });
    try {
      const r = await props.onRestore(bk.path);
      setResult((m) => ({ ...m, [bk.path]: { added: (r && typeof r.added === 'number') ? r.added : 0, error: r && r.error } }));
      // Restored rows are no longer "new" — zero out the diff for this file.
      if (r && r.ok) {
        setInfo((m) => ({ ...m, [bk.path]: { ...(m[bk.path] || {}), newCount: 0 } }));
      }
    } catch (e) {
      setResult((m) => ({ ...m, [bk.path]: { error: (e && e.message) || 'Restore failed' } }));
    } finally {
      setBusy(null);
    }
  };

  // Orientation-agnostic sizing: derive the scroll-body height from the current
  // window instead of a fixed 380 (which overflowed in landscape). Width is
  // capped and centred in landscape so the card doesn't stretch edge-to-edge.
  const _winH = Dimensions.get('window').height;
  const _winW = Dimensions.get('window').width;
  const _isLandscape = _winW > _winH;
  const _scrollMaxHeight = _isLandscape
    ? Math.max(140, Math.floor(_winH * 0.6))
    : Math.min(380, Math.floor(_winH * 0.6));
  const _surfaceExtra = _isLandscape ? { alignSelf: 'center', maxWidth: Math.min(560, _winW * 0.85) } : null;

  return (
    <Modal style={containerStyles.container} visible={!!props.show} transparent animationType="fade"
      onRequestClose={close} supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}>
      <TouchableWithoutFeedback onPress={close}>
        <View style={containerStyles.overlay}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <Surface style={[containerStyles.modalSurface, _surfaceExtra]}>
              <Text style={containerStyles.title}>Restore messages</Text>
              <ScrollView style={{ maxHeight: _scrollMaxHeight }} keyboardShouldPersistTaps="handled">
                <View style={styles.inner}>
                  {backups.length === 0 ? (
                    <Text style={styles.meta}>No message backups found on this device.</Text>
                  ) : backups.map((bk) => {
                    const nfo = info[bk.path];
                    const res = result[bk.path];
                    const loaded = !!(nfo && !nfo.error);
                    const isBusy = busy && busy.path === bk.path;
                    const loading = isBusy && busy.phase === 'load';
                    const restoring = isBusy && busy.phase === 'restore';
                    const newCount = loaded ? (nfo.newCount || 0) : null;
                    return (
                      <View key={bk.path} style={styles.card}>
                        <View style={styles.row}>
                          <View style={{ flex: 1, paddingRight: 10 }}>
                            <Text style={styles.date}>{fmtDate(bk.timestamp) || bk.name}</Text>
                            {loaded ? (
                              <Text style={styles.sub}>
                                {nfo.total} message{nfo.total === 1 ? '' : 's'} ·{' '}
                                <Text style={styles.new}>{newCount} new</Text>
                              </Text>
                            ) : (
                              <Text style={styles.sub}>Load to compare</Text>
                            )}
                          </View>
                          <View style={styles.btns}>
                            {!loaded ? (
                              <Button mode="outlined" compact
                                loading={loading}
                                disabled={busy !== null}
                                onPress={() => doLoad(bk)}>
                                Load
                              </Button>
                            ) : (
                              <Button mode="contained" compact
                                loading={restoring}
                                disabled={busy !== null || newCount === 0}
                                onPress={() => doRestore(bk)}>
                                {newCount > 0 ? `Restore ${newCount}` : 'None'}
                              </Button>
                            )}
                          </View>
                        </View>

                        {loading ? (
                          <Text style={styles.sub}>Loading…</Text>
                        ) : null}
                        {restoring ? (
                          <Text style={styles.sub}>Restoring…</Text>
                        ) : null}
                        {nfo && nfo.error ? <Text style={styles.error}>{nfo.error}</Text> : null}
                        {res && typeof res.added === 'number' && !res.error
                          ? <Text style={styles.added}>Restored {res.added} message{res.added === 1 ? '' : 's'}</Text> : null}
                        {loaded && newCount === 0 && !(res && res.added)
                          ? <Text style={styles.none}>All messages already present</Text> : null}
                        {res && res.error ? <Text style={styles.error}>{res.error}</Text> : null}

                        {loaded && Array.isArray(nfo.contacts) && nfo.contacts.length > 0 ? (
                          <ScrollView style={styles.contactList} nestedScrollEnabled
                            keyboardShouldPersistTaps="handled">
                            {nfo.contacts.map((c) => (
                              <View key={c.uri} style={styles.contactRow}>
                                <Text style={styles.contactUri} numberOfLines={1} ellipsizeMode="middle">{c.uri}</Text>
                                <Text style={styles.contactCount}>
                                  {c.total} message{c.total === 1 ? '' : 's'}
                                  {c.newCount > 0 ? <Text style={styles.contactNew}> · {c.newCount} new</Text> : null}
                                </Text>
                              </View>
                            ))}
                          </ScrollView>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </ScrollView>

              <View style={styles.footer}>
                <Button onPress={close}>Close</Button>
              </View>
            </Surface>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

RestoreMessagesModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func,
  backups: PropTypes.array,    // [{ path, name, timestamp }]
  onLoad: PropTypes.func,      // (path) => Promise<{ ok, total, newCount, timestamp, account, contacts, error }>
  onRestore: PropTypes.func,   // (path) => Promise<{ ok, added, error }>
};

export default RestoreMessagesModal;
