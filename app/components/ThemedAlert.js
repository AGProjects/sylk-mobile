// ThemedAlert.js
//
// A themed, in-app replacement for React Native's imperative
// Alert.alert(title, message, buttons). RN's Alert renders an
// OS-styled system panel that ignores our Day/Night theme. This module
// keeps the SAME imperative call signature but renders a themed modal
// (ThemedModalSurface) so converted alerts match the rest of the app.
//
// Usage:
//   import { showThemedAlert } from './ThemedAlert';
//   showThemedAlert('Title', 'Message', [
//     { text: 'Cancel', style: 'cancel' },
//     { text: 'Remove', style: 'destructive', onPress: () => doIt() },
//   ]);
//
// Mount <ThemedAlertHost/> exactly once near the app root (inside
// PaperProvider) — it's the single surface every showThemedAlert()
// drives. Button objects use the same shape as Alert.alert:
// { text, onPress?, style?: 'default'|'cancel'|'destructive' }.
import React from 'react';
import { Modal, View } from 'react-native';
import { Text, Button } from 'react-native-paper';
import ThemedModalSurface from './ThemedModalSurface';
import containerStyles from '../assets/styles/ContainerStyles';

let _host = null;

export function showThemedAlert(title, message, buttons) {
  if (_host) {
    _host.show(title, message, buttons);
  }
}

export class ThemedAlertHost extends React.Component {
  constructor(props) {
    super(props);
    this.state = { visible: false, title: '', message: '', buttons: null };
  }
  componentDidMount() { _host = this; }
  componentWillUnmount() { if (_host === this) _host = null; }

  show(title, message, buttons) {
    this.setState({
      visible: true,
      title: title == null ? '' : String(title),
      message: message == null ? '' : String(message),
      buttons: (Array.isArray(buttons) && buttons.length) ? buttons : [{ text: 'OK' }],
    });
  }

  _press(btn) {
    this.setState({ visible: false });
    if (btn && typeof btn.onPress === 'function') {
      try { btn.onPress(); } catch (e) { /* swallow */ }
    }
  }

  render() {
    const { visible, title, message, buttons } = this.state;
    const btns = (buttons && buttons.length) ? buttons : [{ text: 'OK' }];
    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => this.setState({ visible: false })}
        supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      >
        <View style={containerStyles.overlay}>
          <ThemedModalSurface style={[containerStyles.modalSurface, { alignSelf: 'center', width: '90%', maxWidth: 480 }]}>
            {title ? <Text style={containerStyles.title}>{title}</Text> : null}
            {message ? (
              <Text style={{ fontSize: 15, textAlign: 'center', paddingHorizontal: 16, paddingBottom: 8 }}>
                {message}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', padding: 12 }}>
              {btns.map((b, i) => (
                <Button
                  key={i}
                  mode={b.style === 'cancel' ? 'text' : 'contained'}
                  compact
                  onPress={() => this._press(b)}
                  style={{ marginLeft: 8, marginTop: 4 }}
                  textColor={b.style === 'destructive' ? '#e53935' : undefined}
                  accessibilityLabel={b.text || 'OK'}
                >
                  {b.text || 'OK'}
                </Button>
              ))}
            </View>
          </ThemedModalSurface>
        </View>
      </Modal>
    );
  }
}

export default showThemedAlert;
