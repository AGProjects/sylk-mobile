// app/accountSettingsAccess.js
//
// Singleton bridge that lets non-React modules read and write
// state.accountSetting on the App component without taking a direct
// import dependency on app.js (which would create a cycle, since
// app.js imports those modules in turn).
//
// At construction time, the App component calls registerApp(this) so
// the bridge has a live reference. Consumers can then go through
// getAccountSetting('section.key') and setAccountSetting('section.key',
// value). Both functions are dotted-path: the section name and key
// are split on the first dot.
//
// Reads are synchronous (just a state lookup). Writes return the
// promise from App.setAccountSetting so callers can await
// persistence completion if they want to.
//
// If registerApp() hasn't run yet (e.g. an unrelated module reaches
// in during boot), getAccountSetting returns undefined and
// setAccountSetting is a no-op. Callers that depend on the value
// being present should treat undefined the same way they treat
// "not yet acknowledged" — i.e. fall back to the safe / disclosure-
// shown branch.

let _appInstance = null;

export function registerApp(app) {
    _appInstance = app;
}

function _splitPath(path) {
    if (typeof path !== 'string') return [null, null];
    const dot = path.indexOf('.');
    if (dot === -1) return [null, null];
    const section = path.substring(0, dot);
    const key = path.substring(dot + 1);
    if (!section || !key) return [null, null];
    return [section, key];
}

export function getAccountSetting(path) {
    if (!_appInstance) return undefined;
    const [section, key] = _splitPath(path);
    if (!section) return undefined;
    const s = _appInstance.state && _appInstance.state.accountSetting;
    return s && s[section] ? s[section][key] : undefined;
}

export async function setAccountSetting(path, value) {
    if (!_appInstance || typeof _appInstance.setAccountSetting !== 'function') return;
    return _appInstance.setAccountSetting(path, value);
}

export default {
    registerApp,
    getAccountSetting,
    setAccountSetting,
};
