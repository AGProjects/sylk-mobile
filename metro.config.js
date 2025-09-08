/**
 * Metro configuration for React Native
 * https://github.com/facebook/react-native
 *
 * @format
 */

// module.exports = {
//   transformer: {
//     getTransformOptions: async () => ({
//       transform: {
//         experimentalImportSupport: false,
//         inlineRequires: false,
//       },
//     }),
//   },
// };

const { getDefaultConfig } = require("metro-config");
const path = require('path');


const fs = require('fs');

const logFile = path.resolve(__dirname, 'metro-debug.log');

function log(message) {
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
}

const moduleName = '@babel/runtime';
const modulePath = path.resolve(__dirname, 'node_modules', moduleName);
log(`Checking if ${modulePath} exists: ${fs.existsSync(modulePath)}`);


module.exports = (async () => {
  const {
    resolver: {
        sourceExts,
        assetExts,
    }
  } = await getDefaultConfig();
  return {
    transformer: {
      babelTransformerPath: require.resolve("react-native-sass-transformer")
    },
    resolver: {
      sourceExts: [...sourceExts, "scss", "sass"]
    },
    watchFolders: [path.resolve('node_modules')],
  };
})();
