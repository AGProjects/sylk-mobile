module.exports = {
    assets: ['react-native-vector-icons'],
    dependencies: {
        'react-native-notifications': {
            platforms: {
                android: null, // disable Android platform, other platforms will still autolink if provided
            },
        },
    },
};