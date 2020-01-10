import AsyncStorage from '@react-native-community/async-storage';

function initialize() {}

async function set(key, value) {
    value = JSON.stringify(value);

    return await AsyncStorage.setItem(key, value);
}

async function get(key) {
    let res = await AsyncStorage.getItem(key);

    return JSON.parse(res);
}

async function remove(key) {
    return await AsyncStorage.removeItem(key);
}

exports.initialize = initialize;
exports.set = set;
exports.get = get;
exports.remove = remove;
