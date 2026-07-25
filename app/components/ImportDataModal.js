import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Text, Platform, Modal, View, ScrollView, Pressable, TouchableWithoutFeedback, StyleSheet, Dimensions,
} from 'react-native';
import PropTypes from 'prop-types';
import { Surface, Button, ActivityIndicator } from 'react-native-paper';

import containerStyles from '../assets/styles/ContainerStyles';
import { createImportClient, contactUris } from '../ImportClient';

const { Buffer } = require('buffer');
const ExportCrypto = require('../ExportCrypto');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KINDS = [{ id: 'contacts', label: 'Contacts' }, { id: 'messages', label: 'Messages' }, { id: 'files', label: 'Files' }];
const MSG_CATS = [{ id: 'all', label: 'All' }, { id: 'text', label: 'Text' }, { id: 'links', label: 'Links' }, { id: 'location', label: 'Location' }];
const FILE_CATS = [{ id: 'all', label: 'All' }, { id: 'image', label: 'Images' }, { id: 'audio', label: 'Audio' }, { id: 'video', label: 'Video' }, { id: 'other', label: 'Other' }];

// Contact sub-filters: PSTN numbers (+NNNN@…) and conference rooms (@…videoconference…).
const isPstnUri = (uri) => /^\+\d+@/.test(String(uri || ''));
const isConferenceUri = (uri) => /videoconference/i.test(String(uri || '').split('@')[1] || '');

const styles = StyleSheet.create({
  inner: { paddingHorizontal: 12, paddingBottom: 10 },
  meta: { fontSize: 12, color: '#8a97b0', textAlign: 'center', paddingVertical: 4 },
  rowlabel: { fontSize: 10, color: '#8a97b0', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 10, marginBottom: 2 },
  pills: { flexGrow: 0 },
  pill: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: '#28324a', backgroundColor: '#0c1220', marginRight: 8 },
  pillActive: { backgroundColor: '#4f7cff', borderColor: '#4f7cff' },
  pillKindActive: { backgroundColor: '#2bd9a4', borderColor: '#2bd9a4' },
  pillText: { color: '#e8edf6', fontSize: 13 },
  pillTextActive: { color: '#fff' },
  pillTextKindActive: { color: '#06281f' },
  count: { color: '#8a97b0', fontSize: 11 },
  headline: { marginTop: 14, fontSize: 15, fontWeight: '600', color: '#e8edf6', textAlign: 'center' },
  sub: { color: '#8a97b0', fontWeight: '400', fontSize: 12 },
  added: { color: '#2bd9a4', fontWeight: '600' },
  error: { color: '#d32f2f', textAlign: 'center', paddingVertical: 6 },
  disconnect: { color: '#ff5d6c', textAlign: 'center', fontWeight: '600', paddingVertical: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, marginBottom: 8 },
  footer: { paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#28324a' },
});

const Pill = ({ label, count, active, kindStyle, onPress }) => (
  <Pressable onPress={onPress} style={[styles.pill, active && (kindStyle ? styles.pillKindActive : styles.pillActive)]}>
    <Text style={[styles.pillText, active && (kindStyle ? styles.pillTextKindActive : styles.pillTextActive)]}>
      {label}{count != null ? <Text style={[styles.count, active && (kindStyle ? styles.pillTextKindActive : styles.pillTextActive)]}>{'  ' + count.toLocaleString()}</Text> : null}
    </Text>
  </Pressable>
);

const ImportDataModal = (props) => {
  const [summary, setSummary] = useState(null);
  const [index, setIndex] = useState({});
  const [kind, setKind] = useState('messages');
  const [cat, setCat] = useState('all');
  const [contact, setContact] = useState(null);
  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(null);
  const [day, setDay] = useState(null);
  // Server (id, day, contact) for kind+category across ALL contacts, minus what
  // is already local → "remaining to import". Drives the contact train AND the
  // calendar drill-down gating (fully-imported contacts/periods drop out).
  const [newItems, setNewItems] = useState([]);
  // For kind=contacts: the new contact URIs (not already local) and the user's
  // tick selection (all selected by default).
  const [newContacts, setNewContacts] = useState([]);
  const [selectedContacts, setSelectedContacts] = useState(new Set());
  const [skipPstn, setSkipPstn] = useState(true);        // filter out +NNNN@…
  const [skipConference, setSkipConference] = useState(true); // filter out @…videoconference…
  const [preview, setPreview] = useState(null); // { serverCount, newCount }
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [disconnected, setDisconnected] = useState(false);
  const previewSeq = useRef(0);
  const cancelRef = useRef(false);
  const scrollRef = useRef(null);

  const server = props.server || '';
  const token = props.authKey || '';
  const encKey = props.encKey || '';

  // Read a fetch Response body as a Buffer.
  async function bodyBytes(r) {
    const buf = await r.arrayBuffer();
    return Buffer.from(new Uint8Array(buf));
  }

  const client = useMemo(() => {
    const ENC_HEADERS = encKey ? { 'X-Sylk-Enc': '1' } : undefined;
    return createImportClient({
      server, token,
      fetchJson: async (u) => {
        console.log('[import-net] GET', u);
        try {
          const r = await fetch(u, { headers: ENC_HEADERS });
          console.log('[import-net] ←', r.status, u, r.headers.get('X-Sylk-Enc') ? '(enc)' : '');
          if (!r.ok) throw new Error('HTTP ' + r.status);
          if (encKey && r.headers.get('X-Sylk-Enc')) {
            const plain = ExportCrypto.decrypt(encKey, await bodyBytes(r));
            return JSON.parse(plain.toString('utf8'));
          }
          return r.json();
        } catch (e) {
          console.log('[import-net] FAILED', u, '·', (e && e.message) || e);
          throw e;
        }
      },
      fetchBytes: async (u) => {
        console.log('[import-net] GET(blob)', u);
        const r = await fetch(u, { headers: ENC_HEADERS });
        if (encKey && r.headers.get('X-Sylk-Enc')) {
          const plain = ExportCrypto.decrypt(encKey, await bodyBytes(r));
          return plain.toString('base64');
        }
        const blob = await r.blob();
        return await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result).split(',').pop());
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
      },
    });
  }, [server, token, encKey]);

  // Load summary from the other phone when the modal opens; DND on.
  useEffect(() => {
    if (!props.show) return undefined;
    let cancelled = false;
    setError(null); setResult(null); setPreview(null); setLoading(true); setDisconnected(false);
    setKind('messages'); setCat('all'); setContact(null); setYear(null); setMonth(null); setDay(null);
    if (typeof props.beginDnd === 'function') { try { props.beginDnd(); } catch (e) {} }
    console.log('[import-net] connecting · server=' + server + ' · token=' + token);
    client.getSummary()
      .then((s) => { if (!cancelled) setSummary(s); })
      .catch((e) => {
        const msg = (e && e.message) || String(e);
        console.log('[import-net] connect FAILED · server=' + server + ' · ' + msg);
        if (!cancelled) setError('Could not reach ' + server + '\n' + msg);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (typeof props.endDnd === 'function') { try { props.endDnd(); } catch (e) {} }
    };
  }, [props.show, server, token]);

  // Heartbeat: poll the exporter's liveness endpoint. A network error means the
  // other phone stopped sharing → mark disconnected and stop polling.
  useEffect(() => {
    if (!props.show || !summary || disconnected) return undefined;
    let stopped = false;
    const ping = async () => {
      try { await fetch(server + '/api/ping'); } // any reply = still up
      catch (e) {
        if (!stopped) { console.log('[import-net] heartbeat failed — server gone'); setDisconnected(true); }
      }
    };
    const id = setInterval(ping, 4000);
    return () => { stopped = true; clearInterval(id); };
  }, [props.show, summary, disconnected, server]);

  // Calendar index — refetched when the contact changes so the Year/Month/Day
  // counts reflect the SELECTED contact (not the all-contacts total).
  useEffect(() => {
    if (!props.show) return undefined;
    let cancelled = false;
    client.getCalendar({ contact })
      .then((c) => { if (!cancelled) setIndex((c && c.index) || {}); })
      .catch(() => { if (!cancelled) setIndex({}); });
    return () => { cancelled = true; };
  }, [props.show, contact]);

  // "Remaining to import" = server (id, day, contact) for kind+category across
  // ALL contacts, minus what's already local. Drives the contact train + the
  // year/month/day drill-down, so fully-imported contacts/periods drop out.
  useEffect(() => {
    if (!props.show || !summary || kind === 'contacts') { setNewItems([]); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const [items, localIds] = await Promise.all([
          client.getIdIndex({ kind, category: cat }), // all contacts
          props.getLocalIds(kind),
        ]);
        if (cancelled) return;
        const set = localIds instanceof Set ? localIds : new Set(localIds || []);
        setNewItems(items.filter((it) => it.id && !set.has(it.id)));
      } catch (e) { if (!cancelled) setNewItems([]); }
    })();
    return () => { cancelled = true; };
  }, [props.show, summary, kind, cat, result]);

  // For kind=contacts: the URIs the other phone has that aren't in our contacts
  // table (add-only by `uri`). Recomputed after each import; all ticked initially.
  useEffect(() => {
    if (!props.show || !summary || kind !== 'contacts') { setNewContacts([]); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        // Multi-URI matching: a server contact is "new" only if NONE of its URIs
        // (primary + secondary `uris`) already exists among our local contacts.
        const getUris = typeof props.getLocalContactUris === 'function'
          ? props.getLocalContactUris() : props.getLocalIds('contacts');
        const [serverContacts, localUris] = await Promise.all([client.fetchContacts(), getUris]);
        if (cancelled) return;
        const set = localUris instanceof Set ? localUris : new Set(localUris || []);
        const nw = (serverContacts || [])
          .filter((c) => c && c.uri && !contactUris(c).some((u) => set.has(u)))
          .map((c) => c.uri);
        setNewContacts(nw); // selection is synced by the effect below
      } catch (e) { if (!cancelled) { setNewContacts([]); setSelectedContacts(new Set()); } }
    })();
    return () => { cancelled = true; };
  }, [props.show, summary, kind, result]);

  // Apply the PSTN/conference sub-filters and (re)select all that pass. Runs
  // when the new-contact list or a filter toggles.
  const visibleContacts = newContacts.filter((u) =>
    !(skipPstn && isPstnUri(u)) && !(skipConference && isConferenceUri(u)));
  useEffect(() => {
    setSelectedContacts(new Set(visibleContacts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newContacts, skipPstn, skipConference]);

  const toggleContact = (u) => setSelectedContacts((s) => {
    const n = new Set(s); if (n.has(u)) n.delete(u); else n.add(u); return n;
  });
  const selectAllContacts = () => setSelectedContacts(new Set(newContacts.filter((u) =>
    !(skipPstn && isPstnUri(u)) && !(skipConference && isConferenceUri(u)))));
  const deselectAllContacts = () => setSelectedContacts(new Set());

  // When the Month/Day rows appear (a year or month was picked), scroll the
  // selector area down so the newly-revealed pills come into view.
  useEffect(() => {
    if (!year && !month) return undefined;
    const t = setTimeout(() => { try { scrollRef.current && scrollRef.current.scrollToEnd({ animated: true }); } catch (e) {} }, 60);
    return () => clearTimeout(t);
  }, [year, month]);

  const period = () => day || month || year || 'all';

  // Derived from the "remaining to import" set:
  //  • contact train  = contacts that still have un-imported items, desc;
  //  • newDays         = days (for the selected contact) that still have items;
  // both empty ⇒ nothing left to import ⇒ no drill-down.
  const newForContact = (c) => newItems.filter((it) => !c || it.contact === c);
  const contacts = (() => {
    const m = {};
    newItems.forEach((it) => { if (it.contact) m[it.contact] = (m[it.contact] || 0) + 1; });
    return Object.keys(m).map((c) => ({ contact: c, count: m[c] })).sort((a, b) => b.count - a.count);
  })();
  const newDays = newForContact(contact).map((it) => it.day);

  // Recompute the add-only preview whenever the selection changes. (Contacts use
  // the tickable newContacts list instead.)
  useEffect(() => {
    if (!props.show || !summary || kind === 'contacts') return;
    const seq = ++previewSeq.current;
    setResult(null); setPreview(null);
    (async () => {
      try {
        const localIds = await props.getLocalIds(kind);
        const p = await client.previewSelection({ kind, category: cat, period: period(), contact }, localIds);
        if (seq === previewSeq.current) setPreview(p);
      } catch (e) { if (seq === previewSeq.current) setError('Diff failed: ' + (e.message || e)); }
    })();
  }, [kind, cat, contact, year, month, day, summary]);

  const catsForKind = () => (kind === 'files' ? FILE_CATS : MSG_CATS);

  const activeList = () => {
    const merge = (keys) => {
      const m = {};
      keys.forEach((k) => (index[k] || []).forEach((e) => { m[e.day] = (m[e.day] || 0) + e.count; }));
      return Object.keys(m).sort((a, b) => (a < b ? 1 : -1)).map((d) => ({ day: d, count: m[d] }));
    };
    if (kind === 'messages') return cat === 'all' ? merge(['text', 'location']) : (index[cat] || []);
    if (kind === 'files') return cat === 'all' ? merge(['image', 'audio', 'video', 'other']) : (index[cat] || []);
    return [];
  };

  const agg = (list, keyFn, filt) => {
    const m = {};
    list.forEach((e) => { if (filt && !filt(e.day)) return; const k = keyFn(e.day); m[k] = (m[k] || 0) + e.count; });
    return m;
  };

  const selectKind = (k) => { setKind(k); setCat('all'); setContact(null); setYear(null); setMonth(null); setDay(null); };

  const cancelImport = useCallback(() => { cancelRef.current = true; }, []);

  const doImport = useCallback(async () => {
    cancelRef.current = false;
    const total = kind === 'contacts' ? selectedContacts.size : (preview ? preview.newCount : 0);
    setError(null); setBusy(true); setProgress({ done: 0, total });
    try {
      const localIds = await props.getLocalIds(kind);
      const remoteUA = await client.fetchRemoteUserAgent();
      const r = await client.importSelection({ kind, category: cat, period: period(), contact }, localIds, {
        shouldCancel: () => cancelRef.current,
        // Contacts: import only the ticked URIs.
        onlyIds: kind === 'contacts' ? selectedContacts : undefined,
        onProgress: (done, t) => setProgress({ done, total: t }),
        onRow: async (rowOrContact) => {
          if (kind === 'contacts') await props.importContact(rowOrContact);
          else await props.importMessageRow(rowOrContact, remoteUA);
        },
        onFile: async (row, bytes) => { await props.saveImportedFile(row, bytes, remoteUA); },
      });
      setResult(r);
      // Log how many local messages now carry this import origin.
      if (typeof props.logImportedOrigin === 'function') { try { await props.logImportedOrigin(remoteUA); } catch (e) {} }
      // Keep the filters as-is. Re-run the diff so the counter reflects the
      // now-imported state (new → 0), which disables Import until the next
      // selection change. (Contacts refresh via their own effect on `result`.)
      if (kind !== 'contacts') {
        try {
          const fresh = await props.getLocalIds(kind);
          const p2 = await client.previewSelection({ kind, category: cat, period: period(), contact }, fresh);
          setPreview(p2);
        } catch (e) { /* leave previous preview */ }
      }
    } catch (e) { setError('Import failed: ' + (e.message || e)); }
    finally { setBusy(false); }
  }, [client, kind, cat, contact, year, month, day, preview, selectedContacts, props]);

  const close = useCallback(() => { if (props.close) props.close(); }, [props]);

  // Orientation-agnostic sizing: landscape phones have little vertical space,
  // so derive the scroll-body height from the current window instead of a fixed
  // 320 (which overflowed and clipped the footer in landscape). Width is capped
  // and centred in landscape so the card doesn't stretch edge-to-edge.
  const _winH = Dimensions.get('window').height;
  const _winW = Dimensions.get('window').width;
  const _isLandscape = _winW > _winH;
  const _scrollMaxHeight = _isLandscape
    ? Math.max(140, Math.floor(_winH * 0.45))
    : Math.min(320, Math.floor(_winH * 0.55));
  // Explicit `width`, NOT maxWidth: paper v5's iOS Surface splits styles
  // across two shadow-layer views — width/alignSelf go to the outer one,
  // maxWidth to the inner one — so with maxWidth the outer white card
  // stretched full-width in landscape/tablet while the content stayed
  // capped in its left half. A single explicit width keeps both in sync.
  const _surfaceExtra = _isLandscape ? { alignSelf: 'center', width: Math.min(560, _winW * 0.85) } : null;

  const list = activeList();
  const yearAgg = agg(list, (d) => d.substring(0, 4));
  const years = Object.keys(yearAgg).sort((a, b) => b - a);
  const monthAgg = year ? agg(list, (d) => d.substring(0, 7), (d) => d.substring(0, 4) === year) : {};
  const dayAgg = month ? agg(list, (d) => d, (d) => d.substring(0, 7) === month) : {};

  // Stop drilling into fully-imported periods: a year shows months only if it
  // still has un-imported items, a month shows days only if it does.
  const yearHasNew = !!year && newDays.some((d) => d.substring(0, 4) === year);
  const monthHasNew = !!month && newDays.some((d) => d.substring(0, 7) === month);

  const periodLabel = () => {
    if (day) { const p = day.split('-'); return parseInt(p[2], 10) + ' ' + MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0]; }
    if (month) { const q = month.split('-'); return MONTHS[parseInt(q[1], 10) - 1] + ' ' + q[0]; }
    if (year) return year;
    return 'All time';
  };

  const dev = summary && summary.device ? (summary.device.useragent || summary.device.name || '') : '';

  // Debug: mirror the on-screen pills / counters / import button to the console.
  useEffect(() => {
    if (!props.show || !summary) return;
    const L = (...a) => console.log('[import-ui]', ...a);
    L('kind:', KINDS.map((k) => (k.id === kind ? '[' + k.label + ']' : k.label)).join(' '));
    if (kind !== 'contacts') {
      L('category:', catsForKind().map((c) => (c.id === cat ? '[' + c.label + ']' : c.label)).join(' '));
      L('contact train:', (contact === null ? '[All]' : 'All'),
        contacts.map((c) => c.contact + ':' + c.count + (contact === c.contact ? '*' : '')).join('  ') || '(none)');
      L('year:', years.map((y) => y + ':' + yearAgg[y] + (year === y ? '*' : '')).join('  ') || '(none)');
      if (year) L('month:', Object.keys(monthAgg).sort().reverse().map((m) => m + ':' + monthAgg[m] + (month === m ? '*' : '')).join('  '));
      if (month) L('day:', Object.keys(dayAgg).sort().reverse().map((d) => d + ':' + dayAgg[d] + (day === d ? '*' : '')).join('  '));
    }
    L('selection:', kind, '·', cat, '·', contact || '(all)', '·', period());
    L('counter:', preview ? (preview.newCount + ' new of ' + preview.serverCount)
      : (result ? ('imported ' + result.imported) : 'computing…'));
    const btnDisabled = busy || !preview || preview.newCount === 0;
    L('import button:', (preview && preview.newCount > 0 ? 'Import ' + preview.newCount : 'Nothing new'),
      btnDisabled ? '(disabled)' : '(ENABLED)');
  }, [kind, cat, contact, year, month, day, newItems, preview, result, busy, summary]);

  return (
    <Modal style={containerStyles.container} visible={!!props.show} transparent animationType="fade"
      onRequestClose={close} supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}>
      <TouchableWithoutFeedback onPress={close}>
        <View style={containerStyles.overlay}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <Surface style={[containerStyles.modalSurface, _surfaceExtra]}>
              <Text style={containerStyles.title}>Data import</Text>
              <ScrollView ref={scrollRef} style={{ maxHeight: _scrollMaxHeight }} keyboardShouldPersistTaps="handled">
                <View style={styles.inner}>
                  {dev ? <Text style={styles.meta}>From {dev}</Text> : null}
                  {disconnected ? <Text style={styles.disconnect}>The other phone stopped sharing — connection lost.</Text> : null}
                  {error ? <Text style={styles.error}>{error}</Text> : null}

                  {loading ? (
                    <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                      <ActivityIndicator />
                      <Text style={styles.meta}>Reading the other phone…</Text>
                    </View>
                  ) : summary && !disconnected ? (
                    <>
                      <Text style={styles.rowlabel}>Import</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pills}>
                        {KINDS.map((k) => (
                          <Pill key={k.id} label={k.label} kindStyle active={kind === k.id} onPress={() => selectKind(k.id)} />
                        ))}
                      </ScrollView>

                      {kind !== 'contacts' ? (
                        <>
                          <Text style={styles.rowlabel}>Category</Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pills}>
                            {catsForKind().map((c) => (
                              <Pill key={c.id} label={c.label} kindStyle active={cat === c.id}
                                onPress={() => { setCat(c.id); setContact(null); setYear(null); setMonth(null); setDay(null); }} />
                            ))}
                          </ScrollView>

                          {contacts.length > 0 ? (
                            <>
                              <Text style={styles.rowlabel}>Contact</Text>
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pills}>
                                <Pill label="All" active={contact === null} onPress={() => setContact(null)} />
                                {contacts.map((c) => (
                                  <Pill key={c.contact} label={c.contact} count={c.count} active={contact === c.contact}
                                    onPress={() => setContact(contact === c.contact ? null : c.contact)} />
                                ))}
                              </ScrollView>
                            </>
                          ) : null}

                          <Text style={styles.rowlabel}>Year</Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pills}>
                            {years.map((y) => (
                              <Pill key={y} label={y} count={yearAgg[y]} active={year === y}
                                onPress={() => { setYear(year === y ? null : y); setMonth(null); setDay(null); }} />
                            ))}
                            {years.length === 0 ? <Text style={styles.meta}>No dated items</Text> : null}
                          </ScrollView>

                          {year && yearHasNew ? (
                            <>
                              <Text style={styles.rowlabel}>Month</Text>
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pills}>
                                {Object.keys(monthAgg).sort((a, b) => (a < b ? 1 : -1)).map((m) => (
                                  <Pill key={m} label={MONTHS[parseInt(m.substring(5, 7), 10) - 1] + ' ' + year} count={monthAgg[m]}
                                    active={month === m} onPress={() => { setMonth(month === m ? null : m); setDay(null); }} />
                                ))}
                              </ScrollView>
                            </>
                          ) : null}

                          {month && monthHasNew ? (
                            <>
                              <Text style={styles.rowlabel}>Day</Text>
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pills}>
                                {Object.keys(dayAgg).sort((a, b) => (a < b ? 1 : -1)).map((d) => (
                                  <Pill key={d} label={parseInt(d.substring(8, 10), 10) + ' ' + MONTHS[parseInt(d.substring(5, 7), 10) - 1]}
                                    count={dayAgg[d]} active={day === d} onPress={() => setDay(day === d ? null : d)} />
                                ))}
                              </ScrollView>
                            </>
                          ) : null}
                        </>
                      ) : null}

                      {kind === 'contacts' ? (
                        <>
                          <Text style={styles.rowlabel}>Filter</Text>
                          <View style={{ flexDirection: 'row' }}>
                            <Pill label="Skip PSTN" kindStyle active={skipPstn} onPress={() => setSkipPstn(!skipPstn)} />
                            <View style={{ width: 8 }} />
                            <Pill label="Skip conference" kindStyle active={skipConference} onPress={() => setSkipConference(!skipConference)} />
                          </View>

                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                            <Text style={styles.rowlabel}>New contacts ({selectedContacts.size}/{visibleContacts.length})</Text>
                            {visibleContacts.length > 0 ? (
                              <View style={{ flexDirection: 'row' }}>
                                <Button compact onPress={selectAllContacts}>All</Button>
                                <Button compact onPress={deselectAllContacts}>None</Button>
                              </View>
                            ) : null}
                          </View>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                            {visibleContacts.map((u) => (
                              <View key={u} style={{ marginRight: 8, marginBottom: 8 }}>
                                <Pill label={u} active={selectedContacts.has(u)} onPress={() => toggleContact(u)} />
                              </View>
                            ))}
                            {newContacts.length === 0 ? <Text style={styles.meta}>No new contacts — all are already in your address book.</Text>
                              : visibleContacts.length === 0 ? <Text style={styles.meta}>All new contacts filtered out (PSTN / conference).</Text> : null}
                          </View>
                        </>
                      ) : null}

                    </>
                  ) : null}
                </View>
              </ScrollView>

              <View style={styles.footer}>
                {disconnected ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 8 }}>
                    <Button mode="contained" onPress={close}>Close</Button>
                  </View>
                ) : summary ? (
                  <>
                    <Text style={styles.headline}>
                      {kind === 'contacts' ? 'Contacts' : (catsForKind().filter((c) => c.id === cat)[0].label + ' · ' + periodLabel() + (contact ? ' · ' + contact : ''))}
                      {'\n'}
                      {result ? (
                        <Text style={styles.added}>{result.cancelled ? 'Cancelled · added ' : 'Added '}{result.imported} new · {result.serverCount - result.newCount} already here</Text>
                      ) : kind === 'contacts' ? (
                        <Text style={styles.sub}>
                          {visibleContacts.length > 0
                            ? selectedContacts.size + ' of ' + visibleContacts.length + ' new contacts selected'
                            : 'no new contacts'}
                        </Text>
                      ) : preview ? (
                        <Text style={styles.sub}>
                          {preview.newCount > 0
                            ? preview.newCount + ' new of ' + preview.serverCount + ' will be added'
                            : (preview.serverCount > 0 ? 'all ' + preview.serverCount + ' already imported' : 'nothing here')}
                        </Text>
                      ) : <Text style={styles.sub}>…</Text>}
                    </Text>
                    {busy && progress ? <Text style={styles.meta}>{progress.done} / {progress.total}</Text> : null}
                    <View style={styles.row}>
                      <Button onPress={busy ? cancelImport : close}>{busy ? 'Cancel' : 'Close'}</Button>
                      {kind === 'contacts' ? (
                        <Button mode="contained" onPress={doImport}
                          loading={busy} disabled={busy || selectedContacts.size === 0}>
                          {selectedContacts.size > 0 ? `Import ${selectedContacts.size}` : 'None selected'}
                        </Button>
                      ) : (
                        <Button mode="contained" onPress={doImport}
                          loading={busy} disabled={busy || !preview || preview.newCount === 0}>
                          {preview && preview.newCount > 0 ? `Import ${preview.newCount}`
                            : (preview && preview.serverCount > 0 ? 'All imported' : 'Nothing new')}
                        </Button>
                      )}
                    </View>
                  </>
                ) : (
                  // No summary yet (loading or error) — always offer a way out.
                  <View style={styles.row}>
                    <Button mode="contained" onPress={close}>Dismiss</Button>
                  </View>
                )}
              </View>
            </Surface>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

ImportDataModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func,
  server: PropTypes.string,
  authKey: PropTypes.string,
  encKey: PropTypes.string,
  beginDnd: PropTypes.func,
  endDnd: PropTypes.func,
  getLocalIds: PropTypes.func,
  getLocalContactUris: PropTypes.func,
  importMessageRow: PropTypes.func,
  saveImportedFile: PropTypes.func,
  importContact: PropTypes.func,
};

export default ImportDataModal;
