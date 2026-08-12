import React, { useEffect, useState, useCallback } from 'react';
import ThemedModalSurface from './ThemedModalSurface';
import { Platform, Modal, View, Clipboard, TouchableWithoutFeedback, KeyboardAvoidingView, ScrollView, StyleSheet, Dimensions } from 'react-native';
import PropTypes from 'prop-types';
import { Text, Surface, Button, ActivityIndicator } from 'react-native-paper';
import QRCode from 'react-native-qrcode-svg';

// Shares the rounded-card-on-dimmed-backdrop shell with the other modals.
import containerStyles from '../assets/styles/ContainerStyles';
import ExportServer from '../ExportServer';

const styles = StyleSheet.create({
  inner: { paddingHorizontal: 14, paddingBottom: 8 },
  block: {
    backgroundColor: '#0c1220', borderRadius: 10, paddingVertical: 8,
    paddingHorizontal: 14, marginVertical: 4,
  },
  label: { fontSize: 10, color: '#8a97b0', textTransform: 'uppercase', letterSpacing: 0.6 },
  url: { fontSize: 16, color: '#e8edf6', fontWeight: '600', marginTop: 2 },
  token: { fontSize: 22, color: '#2bd9a4', fontWeight: '700', letterSpacing: 5, marginTop: 2 },
  hint: { fontSize: 11, color: '#8a97b0', textAlign: 'center', marginTop: 4 },
  status: { fontSize: 12, textAlign: 'center', paddingVertical: 4, color: '#888' },
  statusActive: { color: '#2bd9a4', fontWeight: '600' },
  error: { color: '#d32f2f', textAlign: 'center', paddingVertical: 6 },
  copied: { color: '#2bd9a4', textAlign: 'center', fontSize: 11, minHeight: 14 },
  row: { flexDirection: 'row', justifyContent: 'center', marginTop: 8, marginBottom: 24 },
  qrWrap: { alignItems: 'center', marginTop: 4, marginBottom: 2 },
  qrCard: { backgroundColor: '#fff', padding: 10, borderRadius: 10 },
});


const ExportDataModal = (props) => {
  const [status, setStatus] = useState(ExportServer.getStatus());
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState('');

  const close = useCallback(() => {
    ExportServer.stop().catch(() => {});
    if (props.close) props.close();
  }, [props]);

  useEffect(() => {
    if (!props.show) return undefined;

    let cancelled = false;
    setError(null);
    setCopied('');
    // Silence calls during the transfer (restored on close only if we set it).
    if (typeof props.beginDnd === 'function') { try { props.beginDnd(); } catch (e) {} }
    ExportServer.onStatus((s) => { if (!cancelled) setStatus(s); });

    ExportServer.start({ accountId: props.accountId, userAgent: props.userAgent })
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        // Tell the user's other devices an export is available (fresh → they
        // pop an Import modal). Fire-and-forget.
        // Phones import over HTTP (their HTTP client can't accept self-signed
        // TLS); the payload is encrypted with the shared key regardless.
        if (s && s.running && typeof props.announceDataExport === 'function') {
          try { props.announceDataExport(s.httpUrl || s.url, s.token, s.enc); } catch (e) {}
        }
      })
      .catch((e) => { if (!cancelled) setError(e && e.message ? e.message : 'Could not start the export server.'); });

    return () => {
      cancelled = true;
      ExportServer.onStatus(null);
      ExportServer.stop().catch(() => {});
      if (typeof props.endDnd === 'function') { try { props.endDnd(); } catch (e) {} }
    };
  }, [props.show, props.accountId, props.userAgent]);

  const copy = (value, what) => {
    try { Clipboard.setString(String(value)); setCopied(`${what} copied`); } catch (e) {}
  };

  const running = status && status.running;
  const waiting = running && status.requests === 0;

  // Orientation-agnostic sizing: derive the scroll-body height from the current
  // window instead of a fixed 560 (which overflowed in landscape). Width is
  // capped and centred in landscape so the card doesn't stretch edge-to-edge.
  const _winH = Dimensions.get('window').height;
  const _winW = Dimensions.get('window').width;
  const _isLandscape = _winW > _winH;
  const _scrollMaxHeight = _isLandscape
    ? Math.max(160, Math.floor(_winH * 0.8))
    : Math.min(560, Math.floor(_winH * 0.8));
  // Explicit `width`, NOT maxWidth: paper v5's iOS Surface splits styles
  // across two shadow-layer views — width/alignSelf go to the outer one,
  // maxWidth to the inner one — so with maxWidth the outer white card
  // stretched full-width in landscape/tablet while the content stayed
  // capped in its left half. A single explicit width keeps both in sync.
  const _surfaceExtra = _isLandscape ? { alignSelf: 'center', width: Math.min(560, _winW * 0.85) } : null;

  return (
    <Modal
      style={containerStyles.container}
      visible={!!props.show}
      transparent
      animationType="fade"
      onRequestClose={close}
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
    >
      <TouchableWithoutFeedback onPress={close}>
        <View style={containerStyles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <ThemedModalSurface style={[containerStyles.modalSurface, _surfaceExtra]}>
                <ScrollView style={{ maxHeight: _scrollMaxHeight }} keyboardShouldPersistTaps="handled">
                  <Text style={containerStyles.title}>Data export</Text>
                  <View style={styles.inner}>
                    {error ? <Text style={styles.error}>{error}</Text> : null}

                    {!running && !error ? (
                      <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                        <ActivityIndicator />
                        <Text style={styles.hint}>Starting secure server…</Text>
                      </View>
                    ) : null}

                    {running ? (
                      <>
                        <TouchableWithoutFeedback onPress={() => copy(status.url, 'Address')}>
                          <View style={styles.block}>
                            <Text style={styles.label}>Open in your browser</Text>
                            <Text style={styles.url}>{status.url}</Text>
                            <Text style={styles.hint}>{status.tls ? 'Tap to copy · accept the certificate warning' : 'Tap to copy'}</Text>
                          </View>
                        </TouchableWithoutFeedback>

                        <TouchableWithoutFeedback onPress={() => copy(status.token, 'Auth key')}>
                          <View style={styles.block}>
                            <Text style={styles.label}>Auth key</Text>
                            <Text style={styles.token}>{status.token}</Text>
                            <Text style={styles.hint}>Tap to copy</Text>
                          </View>
                        </TouchableWithoutFeedback>

                        <Text style={styles.copied}>{copied}</Text>

                        <View style={styles.qrWrap}>
                          <View style={styles.qrCard}>
                            <QRCode value={`${status.url}/?token=${status.token}`} size={120} />
                          </View>
                          <Text style={styles.hint}>Scan with another phone's camera to open and sign in automatically</Text>
                        </View>

                        <Text style={[styles.status, !waiting && styles.statusActive]}>
                          {waiting
                            ? 'Waiting for a connection…'
                            : `Connected · ${status.requests} request(s)`}
                        </Text>
                      </>
                    ) : null}

                    <View style={styles.row}>
                      <Button mode="contained" onPress={close}>
                        {running ? 'Stop' : 'Close'}
                      </Button>
                    </View>
                  </View>
                </ScrollView>
              </ThemedModalSurface>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

ExportDataModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func,
  accountId: PropTypes.string,
  userAgent: PropTypes.string,
  announceDataExport: PropTypes.func,
  beginDnd: PropTypes.func,
  endDnd: PropTypes.func,
};

export default ExportDataModal;
