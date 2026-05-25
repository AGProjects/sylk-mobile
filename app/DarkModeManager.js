// DarkModeManager.js
//
// Tri-state theme manager. Despite the historical filename, this is now
// a small theme controller with three modes:
//
//   'system' — track the OS Appearance (default; matches the original
//              DarkModeManager behaviour). Switches automatically when
//              the user toggles dark mode at the OS level.
//   'day'    — force the Day (light, WhatsApp-styled) theme regardless
//              of the OS setting.
//   'night'  — force the Night (dark, original Sylk look) theme
//              regardless of the OS setting.
//
// Persistence lives OUTSIDE this module: the chosen mode is stored in
// the per-account settings blob (state.accountSetting.device.themeMode)
// alongside every other Preferences knob — see
// ACCOUNT_SETTINGS_DEFAULTS in app.js. app.js calls
// DarkModeManager.setMode() to push the stored value into this in-
// memory singleton at account hydration / switch, and PreferencesModal
// calls setAccountSetting('device.themeMode', mode) (which in turn
// calls setMode) when the user picks a new theme. That way the
// singleton stays a pure in-memory mirror — no AsyncStorage of its
// own, no two-source-of-truth split.
//
// Backwards-compatible API surface:
//   isDark()                — boolean, unchanged
//   addListener(fn)         — fn(isDark) callback, unchanged
//   removeListener(fn)      — unchanged
//   setDark(bool)           — kept for any legacy caller; equivalent to
//                              setMode(bool ? 'night' : 'day')
//
// New API:
//   getMode()               — 'system' | 'day' | 'night'
//   setMode(mode)           — recomputes isDark + notifies listeners
//                              (no persistence side-effect; the caller
//                              is expected to persist via accountSetting
//                              if the change is user-initiated)
//   getTheme()              — semantic palette object (see THEMES below)
//   addThemeListener(fn)    — fn(theme) callback, fires alongside the
//                              boolean listeners so consumers that want
//                              the full palette don't have to re-derive
//                              it from isDark.
import { Appearance } from 'react-native';

const VALID_MODES = ['system', 'day', 'night'];

// Semantic palette. Components should pull from these keys rather than
// reaching for raw hex literals so a single edit here re-themes the
// app. Two themes for now (day = WhatsApp-styled light, night = the
// original Sylk dark look). Add new keys carefully — every new entry
// has to exist in both palettes or consumers will crash on the missing
// branch.
// Sylk-brand blues.
// SYLK_BLUE_DEEP   — Pantone Process Uncoated DS 211-2U
//                    (#436294, RGB 67/98/148, CMYK 90/65/20/0).
//                    Picked as the canonical Sylk navbar / accent
//                    colour by the brand spec — a touch deeper than
//                    DS 211-3U we used previously, matching the
//                    updated print collateral.
// SYLK_BLUE_BRIGHT — the cyan-blue highlight near the logo's top,
//                    retained for accents (link / send button) where
//                    a brighter touch reads better than the Pantone
//                    primary at small sizes.
const SYLK_BLUE_DEEP   = '#436294';
const SYLK_BLUE_BRIGHT = '#007CB5';

const DAY_THEME = {
    name: 'day',
    isDark: false,
    // App-bar / top navigation. Stays Sylk-brand blue in BOTH themes
    // — the user wants the navbar always blueish regardless of
    // Day/Night, so this colour is fixed across the palette pair
    // rather than reflecting the theme background.
    appBarBackground: SYLK_BLUE_DEEP,
    appBarText: '#FFFFFF',
    appBarIcon: '#FFFFFF',
    // Brand strip — the slim row above the Appbar carrying the Sylk
    // logo + "Sylk Mobile" wordmark. This DOES reflect the theme
    // background (white in Day, black in Night) so the top of the
    // app blends with the surrounding screen rather than carrying a
    // second coloured band on top of the navbar.
    brandStripBackground: '#FFFFFF',
    brandStripText: SYLK_BLUE_DEEP,
    // Body / screen background behind the contacts and chat
    // surfaces. Mirrors the Night palette's "background a touch
    // darker than surface" pattern, just inverted: Night uses
    // #121212 bg + #1F1F1F surface (surface lighter than bg), so
    // Day uses the channel-flipped equivalents — #EDEDED bg +
    // #E0E0E0 surface (surface DARKER than bg). The two themes
    // then carry matching visual weight and the search-bar /
    // nav-bar surfaces still pop off the body without resorting
    // to harsh outlines.
    background: '#EDEDED',
    surface: '#E0E0E0',
    textPrimary: '#111B21',
    textSecondary: '#667781',
    divider: '#E9EDEF',
    // Chat bubbles. Outgoing tile is a light tint of the Sylk-blue
    // family (not WhatsApp green) so the chat surface stays on-brand.
    // Incoming tile stays white so it reads as "from the other side"
    // on the muted chat backdrop.
    chatBackground: '#ECE5DD',
    bubbleIncoming: '#FFFFFF',
    bubbleOutgoing: '#D6EAF5',
    bubbleIncomingText: '#111B21',
    bubbleOutgoingText: '#111B21',
    // Brand accent — link colour, send button, unread badges, etc.
    // The brighter logo-highlight blue reads as more "actionable" at
    // small sizes than the deep blue.
    accent: SYLK_BLUE_BRIGHT,
    unreadBadge: SYLK_BLUE_BRIGHT,
    unreadBadgeText: '#FFFFFF',
};

const NIGHT_THEME = {
    name: 'night',
    isDark: true,
    // App-bar — same Sylk-blue as the Day palette (the user wants
    // the navbar always blueish regardless of theme). Note this
    // diverges from the original hard-coded 'black' navbar look;
    // if you want strict pixel-for-pixel parity with the pre-theme
    // build, change this back to '#000000'.
    appBarBackground: SYLK_BLUE_DEEP,
    appBarText: '#FFFFFF',
    appBarIcon: '#FFFFFF',
    // Brand strip — reflects the Night theme background (black-ish)
    // so it blends into the surrounding dark surface above the
    // Sylk-blue navbar. Logo / wordmark glyphs invert to white.
    brandStripBackground: '#121212',
    brandStripText: '#FFFFFF',
    background: '#121212',
    surface: '#1F1F1F',
    textPrimary: '#FFFFFF',
    textSecondary: '#B0B0B0',
    divider: '#2A2A2A',
    chatBackground: '#0B141A',
    // Original ChatBubble.js literals: leftColor='green', rightColor='#fff'.
    // Kept verbatim so Night mode reproduces today's look exactly.
    bubbleIncoming: 'green',
    bubbleOutgoing: '#FFFFFF',
    bubbleIncomingText: '#FFFFFF',
    bubbleOutgoingText: '#111B21',
    accent: '#25D366',
    unreadBadge: '#25D366',
    unreadBadgeText: '#FFFFFF',
};

class DarkModeManager {
  constructor() {
    // Start in 'system' mode so behaviour matches the historical
    // implementation until hydration finishes.
    this.mode = 'system';
    this.systemIsDark = Appearance.getColorScheme() === 'dark';
    this.dark = this.systemIsDark;
    this.listeners = [];
    this.themeListeners = [];

    // Listen to OS theme changes. Only the 'system' mode propagates
    // these — explicit day/night overrides ignore the OS toggle.
    this.subscription = Appearance.addChangeListener(({ colorScheme }) => {
      this.systemIsDark = colorScheme === 'dark';
      if (this.mode === 'system') {
        this.dark = this.systemIsDark;
        this.notifyListeners();
      }
    });
  }

  _resolveDark(mode) {
    if (mode === 'day') return false;
    if (mode === 'night') return true;
    return this.systemIsDark;
  }

  _applyMode(mode, { notify = true } = {}) {
    if (VALID_MODES.indexOf(mode) === -1) return;
    const nextDark = this._resolveDark(mode);
    if (this.mode === mode && this.dark === nextDark) return;
    this.mode = mode;
    this.dark = nextDark;
    if (notify) this.notifyListeners();
  }

  // ─── Public API ──────────────────────────────────────────────────

  getMode() {
    return this.mode;
  }

  setMode(mode) {
    this._applyMode(mode, { notify: true });
  }

  // Legacy setter kept for backwards compatibility. Maps the bool to
  // the explicit day/night override (i.e. no longer 'system') — the
  // historical semantic of "the user actively flipped this" matches
  // a manual override better than re-entering system-follow mode.
  setDark(isDark) {
    this._applyMode(isDark ? 'night' : 'day', { notify: true });
  }

  isDark() {
    return this.dark;
  }

  getTheme() {
    return this.dark ? NIGHT_THEME : DAY_THEME;
  }

  // For classes to subscribe to changes
  addListener(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
    }
  }

  removeListener(callback) {
    this.listeners = this.listeners.filter(cb => cb !== callback);
  }

  // Theme-shaped listener variant. Receives the full palette object so
  // consumers that want more than the boolean don't have to call
  // getTheme() themselves in the callback.
  addThemeListener(callback) {
    if (typeof callback === 'function') {
      this.themeListeners.push(callback);
    }
  }

  removeThemeListener(callback) {
    this.themeListeners = this.themeListeners.filter(cb => cb !== callback);
  }

  notifyListeners() {
    const theme = this.getTheme();
    this.listeners.forEach(cb => {
      try { cb(this.dark); } catch (e) { /* swallow listener errors */ }
    });
    this.themeListeners.forEach(cb => {
      try { cb(theme); } catch (e) { /* swallow listener errors */ }
    });
  }

  // Cleanup when needed
  cleanup() {
    this.subscription?.remove();
    this.listeners = [];
    this.themeListeners = [];
  }
}

// Export a singleton instance
export default new DarkModeManager();
