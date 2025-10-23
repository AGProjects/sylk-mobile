'use strict';

const configOptions = {
    defaultDomain           : 'sylk.link',
    wsServer                : 'wss://webrtc-gateway.sipthor.net:9999/webrtcgateway',
    publicUrl               : 'https://webrtc.sipthor.net', // must be synced with in AndroidManifest.xml and Info.plist
    enrollmentUrl           : 'https://blink.sipthor.net/enrollment-sylk-mobile.phtml',
    serverCallHistoryUrl    : 'https://blink.sipthor.net/settings-webrtc.phtml',
    serverSettingsUrl       : 'https://mdns.sipthor.net/sip_settings.phtml',
    iceServers              : [{urls: 'stun:stun.sipthor.net:3478'}]
};


module.exports = configOptions;
