import AsyncStorage from '@react-native-community/async-storage';

function initialize() {}

async function set(key, value) {
    obj = JSON.stringify(value);
    //console.log('Storage set', key);
    //console.log(obj);

    return await AsyncStorage.setItem(key, obj);
}

async function get(key) {
    let res = await AsyncStorage.getItem(key);
    let obj = JSON.parse(res);
    //console.log('Storage get', key);
    //console.log(obj);

    return obj;
}

async function remove(key) {
    return await AsyncStorage.removeItem(key);
}

exports.initialize = initialize;
exports.set = set;
exports.get = get;
exports.remove = remove;
