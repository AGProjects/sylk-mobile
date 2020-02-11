'use strict';

const defaultDomain = 'sip2sip.info';

const configOptions = {
    defaultDomain           : defaultDomain,
    enrollmentDomain        : defaultDomain,
    defaultConferenceDomain : `videoconference.${defaultDomain}`,
    defaultGuestDomain      : `guest.${defaultDomain}`,
    wsServer                : 'wss://webrtc-gateway.sipthor.net:9999/webrtcgateway/ws',
    publicUrl               : 'https://webrtc.sipthor.net',
    enrollmentUrl           : 'https://blink.sipthor.net/enrollment-webrtc.phtml',
    serverCallHistoryUrl    : 'https://blink.sipthor.net/settings-webrtc.phtml',
    serverSettingsUrl       : 'https://mdns.sipthor.net/sip_settings.phtml',
    fileSharingUrl          : 'https://webrtc-gateway.sipthor.net:9999/webrtcgateway/filesharing',
    iceServers              : [{urls: 'stun:stun.sipthor.net:3478'}],
    useServerCallHistory    : true,
    intercomDtmfTone        : true
};


module.exports = configOptions;
