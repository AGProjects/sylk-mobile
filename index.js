/**
 * @format
 */

import React from 'react';
import { AppRegistry, Text as RNText, NativeModules, StyleSheet } from 'react-native';
import debug from 'debug';
import App from './app/app';
import { installCrashCapture } from './app/crashCapture';
import { name as appName } from './app.json';
import bgCalling from './bgCalling';
import { Text} from 'react-native-paper';
import { firebase } from '@react-native-firebase/messaging';

// Silence the per-second rn-webrtc:pc:DEBUG getStats spam.
//
// react-native-webrtc/lib/module/index.js (line ~26) calls
//   Logger.enable(`${Logger.ROOT_PREFIX}:*`)
// at module load, which routes through debug.enable('rn-webrtc:*')
// and turns on every rn-webrtc:*:DEBUG / INFO / WARN namespace
// regardless of our own preferences. ES module semantics evaluate
// the entire import graph before running any top-level statements,
// so this block ALWAYS runs after rn-webrtc has flipped logging
// on. Disable it back here.
//
// debug.disable() in debug 3.x and 4.x both call
// `createDebug.enable('')` internally — i.e. they nuke ALL
// enabled namespaces. The argument is ignored. We follow up with
// `debug.enable('-rn-webrtc:*')` so namespaces other modules want
// to keep on can be added here later by appending `,foo:*`, and
// the rn-webrtc skip pattern stays explicit.
debug.disable();
debug.enable('-rn-webrtc:*');

console.disableYellowBox = true;

// Capture uncaught JS errors / unhandled promise rejections and persist their
// stacks, so the crash reporter can attach them to Android exit records that
// carry no OS thread dump. See app/crashCapture.js + app/appExitReporter.js.
try { installCrashCapture(); } catch (e) { console.warn('[crash-capture] install failed:', e); }

//Disable font scaling
//Text.defaultProps = Text.defaultProps || {};
//Text.defaultProps.allowFontScaling = false;

// ── Re-apply the system "Bold font" preference, the measurable way ──
// MainActivity neutralises Android's OS-level fontWeightAdjustment (+300)
// because React Native renders it but doesn't MEASURE it, which clipped the
// last word/letters of every label. To honour the user's preference without
// that bug, we read the ORIGINAL adjustment back from the native bridge and,
// if Bold font was on, mirror the OS by bumping every <Text>'s weight by that
// same amount — applied as an explicit fontWeight, which RN DOES measure, so
// text stays bold AND fully visible.
//
// We BUMP the element's own weight (rather than forcing a flat "bold") and
// apply it LAST so it wins — this both reaches text that already sets a weight
// (e.g. react-native-paper typography variants, which is why the contact list
// stayed regular before) and preserves the visual hierarchy (a 600 title
// becomes heavier than 400 body), exactly like the OS adjustment did.
try {
  let adj;
  try {
    adj = NativeModules?.SylkBridge?.getSystemFontWeightAdjustment?.();
  } catch (e) {
    adj = undefined;
  }
  console.warn('[bold] getSystemFontWeightAdjustment =', adj,
    '(type', typeof adj + ')  SylkBridge present:',
    !!NativeModules?.SylkBridge,
    ' has method:', typeof NativeModules?.SylkBridge?.getSystemFontWeightAdjustment);

  // +300 == Bold font on. Anything in a sane 1..1000 range counts.
  const validAdj = (typeof adj === 'number' && adj >= 1 && adj <= 1000);
  const bump = validAdj ? Math.min(adj, 500) : 0;

  if (validAdj && !RNText.__sylkBoldPatched) {
    RNText.__sylkBoldPatched = true;
    const baseWeight = (w) => {
      if (w === undefined || w === null || w === 'normal') return 400;
      if (w === 'bold') return 700;
      const n = parseInt(w, 10);
      return Number.isFinite(n) ? n : 400;
    };
    // Compute the style override applied (LAST, so it wins) to every <Text>.
    const boldOverride = (style) => {
      const flat = StyleSheet.flatten(style) || {};
      const target = Math.round((baseWeight(flat.fontWeight) + bump) / 100) * 100;
      const override = { fontWeight: String(Math.max(100, Math.min(900, target))) };
      // Android can't synthesise a heavier weight on a *named*, weight-locked
      // system family (e.g. react-native-paper's 'sans-serif-medium' /
      // 'sans-serif' on titleLarge/titleMedium — the contact list). Plain RN
      // text sets no fontFamily and bolds fine, so for any 'sans-serif*'
      // family we clear it back to the default typeface, where the weight
      // takes effect. Non-sans families (monospace, serif, bundled fonts) are
      // left untouched so they keep their intended face.
      if (typeof flat.fontFamily === 'string' && /^sans-serif/.test(flat.fontFamily)) {
        override.fontFamily = undefined;
      }
      return override;
    };
    const origRender = RNText.render;
    if (typeof origRender === 'function') {
      RNText.render = function (...args) {
        const el = origRender.apply(this, args);
        return React.cloneElement(el, {
          style: [el.props.style, boldOverride(el.props.style)],
        });
      };
      console.warn('[bold] Text.render patched, bump =', bump);
    } else {
      console.warn('[bold] RNText.render is not a function — patch skipped');
    }
  }
} catch (e) {
  console.warn('[app] re-applying system bold font failed:', e);
}

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerHeadlessTask('RNCallKeepBackgroundMessage', () => bgCalling);
