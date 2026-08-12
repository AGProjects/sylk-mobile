module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // React Compiler (v1.0) — build-time auto-memoization to cut re-renders
    // (chat scroll + navigation wins on the big app.js). MUST run first.
    // target:'18' because we're on React 18, which needs the
    // react-compiler-runtime polyfill (a runtime dependency). Pinned 1.0.0.
    ['babel-plugin-react-compiler', { target: '18' }],
  ],
  // env: {
  //   production: {
  //     plugins: ['react-native-paper/babel'],
  //   },
  // },
};
