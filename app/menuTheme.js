// menuTheme.js
//
// Dropdown menus across the app are react-native-paper <Menu> widgets
// (navbar kebab + contact long-press menu, the in-call overflow menus,
// the audio-device pickers, the conference header menu). Two facts about
// Paper v5's <Menu> make these ignore the app's Day/Night setting:
//
//   1. The menu's Surface background comes from the Paper theme in
//      context — and the app mounts a single static (light) Paper theme
//      — so the sheet is always white.
//   2. <Menu> renders its <Menu.Item> children WITHOUT re-providing
//      theme context (see node_modules/react-native-paper Menu.tsx —
//      children are rendered directly inside the Surface), so each item
//      reads its title/icon colour from that same light theme and paints
//      dark text. On a dark app theme that's dark-on-white; if we only
//      darkened the surface it'd become dark-on-dark.
//
// Fix: derive a full Paper theme from the active DarkModeManager palette
// and hand it to BOTH the <Menu> (colours its Surface) and every
// <Menu.Item> (colours title + leading icon) via their `theme` prop.
// Call getMenuTheme().menuTheme inline at each menu/item so scope is
// never an issue (the callsites live across several render helpers).
//
// Cheap by design: DarkModeManager.getTheme() returns a STABLE object
// reference that only changes when the user flips the theme (or the
// night bubble colour), so we memoise the derived Paper theme keyed by
// that reference. Repeated calls in one render (a menu with N items ->
// N+1 calls) all hit the cache; a theme flip rebuilds it once.
import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import DarkModeManager from './DarkModeManager';

let _cacheKey = null;
let _cacheVal = null;

export function getMenuTheme() {
    const dm = DarkModeManager.getTheme();
    if (dm === _cacheKey && _cacheVal) {
        return _cacheVal;
    }
    const base = dm.isDark ? MD3DarkTheme : MD3LightTheme;
    // Day keeps the historical pure-white menu; Night uses the palette's
    // elevated surface (#1F1F1F) so the dropdown reads as a raised dark
    // sheet on the screen behind it.
    const surface = dm.isDark ? dm.surface : '#FFFFFF';
    // Menu's Surface picks its background from theme.colors.elevation
    // (by MD3 elevation level). Flatten every level to our surface so
    // whichever level the Menu uses lands on the right colour.
    const elevation = {
        ...base.colors.elevation,
        level0: surface,
        level1: surface,
        level2: surface,
        level3: surface,
        level4: surface,
        level5: surface,
    };
    const menuTheme = {
        ...base,
        // Mirror getAppPaperTheme(): carry the palette's own isDark rather than
        // inheriting whatever MD3DarkTheme/MD3LightTheme happens to set. It
        // agrees with `base` today, but any Paper component that branches on
        // theme.dark inside a <Menu> would otherwise be trusting a coincidence.
        dark: dm.isDark,
        roundness: 2,
        colors: {
            ...base.colors,
            primary: '#337ab7',                 // match the app's global Paper primary
            surface,
            surfaceVariant: surface,
            background: surface,
            onSurface: dm.textPrimary,          // Menu.Item title
            onSurfaceVariant: dm.textSecondary, // Menu.Item leading icon
            elevation,
        },
    };
    _cacheKey = dm;
    _cacheVal = { menuTheme, menuBg: surface };
    return _cacheVal;
}

export default getMenuTheme;
