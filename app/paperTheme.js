// paperTheme.js
//
// Single source of truth for the app-wide react-native-paper theme, so
// EVERY Paper component (Surface, Text, Title, Paragraph, Divider,
// Button, TextInput, Dialog, Menu, ...) follows the app's Day/Night
// setting. The app used to mount ONE static light Paper theme, which is
// why modals rendered as white cards with dark text regardless of the
// chosen theme.
//
// getAppPaperTheme() derives a full MD3 Paper theme from the active
// DarkModeManager palette. It's passed to <PaperProvider> in app.js and
// (because Paper reads theme from context) re-themes the whole tree,
// including every modal's Paper <Text>/<Surface>, without per-component
// wiring.
//
// Surface stays pure white in Day (unchanged look) and becomes the
// palette's elevated dark surface in Night; on-surface text flips to the
// palette's textPrimary/textSecondary so nothing paints same-on-same.
//
// Memoised on DarkModeManager.getTheme()'s stable object identity so
// repeated calls (every render) are effectively free and only rebuild
// when the user actually flips the theme.
import { MD3DarkTheme, MD3LightTheme, DefaultTheme } from 'react-native-paper';
import DarkModeManager from './DarkModeManager';

const APP_PRIMARY = '#337ab7';

let _cacheKey = null;
let _cacheVal = null;

export function getAppPaperTheme() {
    const dm = DarkModeManager.getTheme();
    if (dm === _cacheKey && _cacheVal) {
        return _cacheVal;
    }
    const base = dm.isDark ? MD3DarkTheme : MD3LightTheme;
    // Day keeps the historical pure-white card surface; Night uses the
    // palette's elevated surface so cards/menus read as raised dark
    // sheets. Screens set their own backgrounds via DarkModeManager, so
    // `background` here mostly matters for stray Paper containers.
    const surface = dm.isDark ? dm.surface : '#FFFFFF';
    const elevation = {
        ...base.colors.elevation,
        level0: surface,
        level1: surface,
        level2: surface,
        level3: surface,
        level4: surface,
        level5: surface,
    };
    const theme = {
        ...base,
        dark: dm.isDark,
        roundness: 2,
        colors: {
            ...base.colors,
            primary: APP_PRIMARY,
            onPrimary: '#FFFFFF',
            surface,
            surfaceVariant: surface,
            background: dm.background || surface,
            elevation,
            onSurface: dm.textPrimary,
            onSurfaceVariant: dm.textSecondary,
            onBackground: dm.textPrimary,
            outline: dm.divider,
            outlineVariant: dm.divider,
            // Keep v2-style aliases in sync for any component still
            // reading theme.colors.text (Paper's older text APIs).
            text: dm.textPrimary,
            placeholder: dm.textSecondary,
            backdrop: 'rgba(0,0,0,0.5)',
        },
    };
    _cacheKey = dm;
    _cacheVal = theme;
    return theme;
}

// Semantic colours for imperative use inside modals during the full
// per-modal audit: mapping bespoke neutral hex literals (dark text,
// muted greys, hairline borders, white card fills) onto the active
// palette. Intentional status/brand colours are left untouched by the
// audit. Cheap (DarkModeManager.getTheme() is a stable ref); call at
// render or wrap a StyleSheet factory with it.
export function getModalColors() {
    const dm = DarkModeManager.getTheme();
    return {
        isDark: dm.isDark,
        surface: dm.isDark ? dm.surface : '#FFFFFF',
        background: dm.background,
        textPrimary: dm.textPrimary,
        textSecondary: dm.textSecondary,
        divider: dm.divider,
        accent: dm.accent,
        // Readable hyperlink blue per theme (bright/dark blue is hard to
        // read on the Night surface; use a lighter blue there).
        link: dm.isDark ? '#6FB2E8' : '#1565c0',
    };
}

export default getAppPaperTheme;
