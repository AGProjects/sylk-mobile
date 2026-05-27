import React from 'react';
import {
  Text,
  Linking,
  Platform,
  Modal,
  View,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  ScrollView,
  Clipboard,
} from 'react-native';
import PropTypes from 'prop-types';
import { Surface, Button } from 'react-native-paper';

// Shares the same Modal + overlay + Surface shell as AboutModal,
// EditContactModal, ShareLocationModal and friends so every dialog
// in the app renders as the same rounded-corner card over a dimmed
// backdrop. Reused for two flows:
//   1. The "Donate…" menu item (informational, user-initiated).
//   2. The "Payment required" PSTN error in app.callStateChanged, so
//      a failed PSTN call surfaces the payment details inline instead
//      of only dropping a system-message link into the chat history.
//
// The payment-account table is NOT hard-coded — it is rendered from
// the `paymentAccounts` prop, which app.js populates from the
// server's sylk-config.json (`pstn.payment_accounts`). Each entry is
// a free-form object of key/value pairs; this component iterates
// both the array and each entry's keys so a deployment can change
// its payment information (add a second IBAN, switch banks, add a
// reference number column) without a mobile release.
import containerStyles from '../assets/styles/ContainerStyles';

import { StyleSheet } from 'react-native';

const MIN_AMOUNT  = '20 USD / EUR';
const BILLING_EMAIL = 'billing@ag-projects.com';

// Keys whose values should be rendered in a monospace font and tighter
// letter-spacing so digit groups (IBAN, BIC, account numbers,
// reference codes) are easy to scan and copy. Matched case-insensitively
// against the entry's key name.
const MONO_KEY_PATTERN = /^(iban|swift|bic|account|account[_\-]?number|reference)$/i;

// Title-case a key for display as a row label. Already-uppercase
// acronyms (IBAN, SWIFT, BIC) survive unchanged because uppercasing
// is a no-op for them; snake_case / camelCase get split on _ and on
// lower→upper boundaries so "account_number" → "Account Number" and
// "swiftCode" → "Swift Code".
function formatKey(key) {
  if (!key) return '';
  if (key === key.toUpperCase()) return key;
  const split = String(key)
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return split
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

const styles = StyleSheet.create({
  inner: {
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  intro: {
    paddingVertical: 10,
    fontSize: 14,
    textAlign: 'center',
  },
  // Borderless framing around each payment-account block keeps the
  // key/value pairs visually grouped. Tighter bottom margin than top
  // so when multiple accounts are stacked they sit close together
  // without bleeding into the surrounding paragraphs.
  detailsBlock: {
    backgroundColor: '#f5f7fa',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 12,
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 4,
  },
  detailLabel: {
    fontSize: 13,
    color: '#666',
    width: 110,
  },
  detailValue: {
    fontSize: 14,
    flexShrink: 1,
    fontWeight: '600',
    color: '#111',
  },
  // Monospace bias on IBAN / BIC / account numbers so the digit
  // groups are easy to read at a glance and copy without misreads
  // (1/l, 0/O).
  detailValueMono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.5,
  },
  instructions: {
    paddingVertical: 10,
    fontSize: 13,
    textAlign: 'center',
    color: '#333',
    lineHeight: 18,
  },
  link: {
    paddingVertical: 6,
    fontSize: 13,
    textAlign: 'center',
    color: 'blue',
  },
  // Inline variant used inside a paragraph (nested <Text>) so the
  // billing@ag-projects.com address can sit on the same line as the
  // surrounding instruction text without the vertical padding the
  // standalone .link uses.
  linkInline: {
    color: 'blue',
  },
  // Fallback line when the server hasn't published any payment
  // accounts yet (older deployment, mis-configured pstn block).
  // Kept neutral / informational — not an error.
  emptyAccounts: {
    paddingVertical: 16,
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    color: '#777',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 6,
  },
  button: {
    flex: 1,
    marginHorizontal: 4,
  },
});

function emailBilling(reason) {
  // Pre-fill the receipt email so the user only has to attach the
  // bank transfer receipt, type their Blink account at the end of
  // the subject, and hit send.
  //   credit — the Blink account goes in the SUBJECT (not the body)
  //            so billing can grep/route incoming receipts by
  //            account without opening the message; the Caller-ID
  //            phone number is captured separately in My Account.
  //   donate — nothing to route, plain subject + body.
  const subject = encodeURIComponent(
    reason === 'credit'
      ? 'Sylk payment receipt — Blink account: '
      : 'Sylk donation receipt'
  );
  const body = encodeURIComponent(
    'Please find attached my bank transfer receipt.\n'
  );
  Linking.openURL(`mailto:${BILLING_EMAIL}?subject=${subject}&body=${body}`);
}

// Flatten every payment account into a single clipboard-friendly
// blob so the user can paste it straight into their bank app. Each
// account is separated by a blank line; within an account the
// key/value pairs are one per line, formatted the same way they're
// displayed in the table above.
function copyAll(paymentAccounts) {
  const list = Array.isArray(paymentAccounts) ? paymentAccounts : [];
  if (list.length === 0) {
    Clipboard.setString('');
    return;
  }
  const blocks = list.map((acct) => {
    if (!acct || typeof acct !== 'object') return '';
    return Object.keys(acct)
      .map((k) => `${formatKey(k)}: ${acct[k]}`)
      .join('\n');
  });
  Clipboard.setString(blocks.filter((b) => b).join('\n\n'));
}

const PaymentInfoModal = (props) => {
  // Two entry points share this modal:
  //   reason='donate' — opened from the "Donate…" kebab item, framed
  //                     as a contribution to Blink's developers.
  //   reason='credit' — opened from the 'Payment required' PSTN flow,
  //                     framed as topping up account credit so PSTN
  //                     calls can go through.
  // Defaults to 'donate' so a missing prop renders the friendlier
  // copy rather than the error-recovery one.
  const reason = props.reason === 'credit' ? 'credit' : 'donate';
  const title  = reason === 'credit' ? 'Payment required' : 'Donate';
  const intro  = reason === 'credit'
    ? `Calling to telephone numbers is not free of charge. To add credit to your account, make a bank transfer of at least ${MIN_AMOUNT} to:`
    : 'Blink is free software. To help further development you can make a donation to its developers:';

  const accounts = Array.isArray(props.paymentAccounts) ? props.paymentAccounts : [];

  return (
    <Modal
      style={containerStyles.container}
      visible={!!props.show}
      transparent
      animationType="fade"
      onRequestClose={props.close}
    >
      <TouchableWithoutFeedback onPress={props.close}>
        <View style={containerStyles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 20}
          >
            {/* Block dismiss when taps land inside the card so the
                user can long-press to copy individual fields without
                losing the modal. */}
            <TouchableWithoutFeedback onPress={() => {}}>
              <Surface style={containerStyles.modalSurface}>
                <ScrollView
                  style={{ maxHeight: 560 }}
                  keyboardShouldPersistTaps="handled"
                >
                  <Text style={containerStyles.title}>{title}</Text>

                  {/* Extra breathing room between the modal title and
                      the first paragraph of body copy. Without this
                      the intro sentence sits flush against the title
                      and the whole panel reads as one dense block. */}
                  <View style={{ height: 12 }} />

                  <View style={styles.inner}>
                    <Text style={styles.intro}>
                      {intro}
                    </Text>

                    {/* Dynamic payment-account table. Iterates the
                        server-published pstn.payment_accounts array
                        (one detailsBlock per entry) and inside each,
                        iterates Object.keys so the modal renders
                        whatever fields a deployment chooses to
                        publish without code changes. */}
                    {accounts.length === 0 ? (
                      <Text style={styles.emptyAccounts}>
                        Payment details are not configured for this
                        server. Please contact your administrator.
                      </Text>
                    ) : (
                      accounts.map((acct, idx) => {
                        const keys = Object.keys(acct);
                        return (
                          <View key={idx} style={styles.detailsBlock}>
                            {keys.map((k) => {
                              const isMono = MONO_KEY_PATTERN.test(k);
                              const valueStr = String(acct[k] == null ? '' : acct[k]);
                              return (
                                <View key={k} style={styles.detailRow}>
                                  <Text style={styles.detailLabel}>
                                    {formatKey(k)}
                                  </Text>
                                  <Text
                                    style={[
                                      styles.detailValue,
                                      isMono ? styles.detailValueMono : null,
                                    ]}
                                    selectable
                                  >
                                    {valueStr}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        );
                      })
                    )}

                    {/* Receipt-email block: PSTN credit only.
                        Donations don't need account mapping at all.
                        The credit path used to also collect the
                        user's phone number here as Caller ID, but
                        that's now captured separately in My Account
                        (auto-filled off the SIM on first PSTN dial),
                        so the email only needs to quote the Blink
                        account in the subject. */}
                    {reason === 'credit' ? (
                      <>
                        <Text style={styles.instructions}>
                          Email the payment receipt with your Blink
                          account in the subject to:
                        </Text>

                        <Text onPress={() => emailBilling(reason)} style={styles.link}>
                          {BILLING_EMAIL}
                        </Text>

                        <View style={{ height: 16 }} />
                      </>
                    ) : null}

                    {/* Two-button row: Close (dismiss) on the left,
                        Copy details (primary action) on the right.
                        Copy hands the whole accounts array to the
                        clipboard helper, which formats every entry
                        the same way the table renders it. */}
                    <View style={styles.buttonRow}>
                      <Button
                        mode="outlined"
                        style={styles.button}
                        onPress={props.close}
                      >
                        Close
                      </Button>
                      <Button
                        mode="contained"
                        style={styles.button}
                        onPress={() => copyAll(accounts)}
                        icon="content-copy"
                        disabled={accounts.length === 0}
                      >
                        Copy details
                      </Button>
                    </View>
                  </View>
                </ScrollView>
              </Surface>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

PaymentInfoModal.propTypes = {
  show: PropTypes.bool,
  close: PropTypes.func.isRequired,
  // 'donate' (default) — opened from the kebab menu.
  // 'credit'           — opened by the PSTN Payment-required path.
  reason: PropTypes.oneOf(['donate', 'credit']),
  // Array of free-form payment-account records published by the
  // server under pstn.payment_accounts. Each entry is an object of
  // arbitrary key/value pairs; the modal renders one detailsBlock
  // per entry and one row per key. Empty / missing → renders the
  // "not configured" notice.
  paymentAccounts: PropTypes.array,
};

export default PaymentInfoModal;
