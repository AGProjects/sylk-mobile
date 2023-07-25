import uuidv4 from 'uuid/v4';
import SillyNames from './SillyNames';
import MaterialColors from './MaterialColors';
import { Clipboard, Dimensions } from 'react-native';
import Contacts from 'react-native-contacts';
import xss from 'xss';
import {decode as atob, encode as btoa} from 'base-64';

const RNFS = require('react-native-fs');
const logfile = RNFS.DocumentDirectoryPath + '/logs.txt';

let HUGE_FILE_SIZE = 15 * 1000 * 1000;
let ENCRYPTABLE_FILE_SIZE = 10 * 1000 * 1000;


let polycrc = require('polycrc');

function log2file(text) {
    // append to logfile
    RNFS.appendFile(logfile, text + '\r\n', 'utf8')
      .then((success) => {
        console.log(text);
      })
      .catch((err) => {
        console.log(err.message);
      });
}

function isAnonymous(uri) {
    if (uri.indexOf('@guest.') > -1 || uri.indexOf('@anonymous.') > -1) {
        return true
    }

    if (uri.indexOf('@192.168.') > -1) {
        return true;
    }

    if (uri.indexOf('@10.') > -1) {
        return true;
    }

    return false;
}


function appendLeadingZeroes(n){
    if (n <= 9) {
        return "0" + n;
     }
    return n;
}

function timestampedLog() {
    let current_datetime = new Date();
    let formatted_date = current_datetime.getFullYear() + "-" + appendLeadingZeroes(current_datetime.getMonth() + 1) + "-" + appendLeadingZeroes(current_datetime.getDate()) + " " + appendLeadingZeroes(current_datetime.getHours()) + ":" + appendLeadingZeroes(current_datetime.getMinutes()) + ":" + appendLeadingZeroes(current_datetime.getSeconds());
    let message = formatted_date;

    for (var i = 0; i < arguments.length; i++) {
        let txt = arguments[i] ? arguments[i].toString() : '';
        message = message + ' ' + txt;
    }

    log2file(message);
    //console.log(message);
}


function generateUniqueId() {
    const uniqueId = uuidv4().replace(/-/g, '').slice(0, 16);
    return uniqueId;
}

function sylk2GiftedChat(sylkMessage, decryptedBody=null, direction='incoming') {
    direction = direction || sylkMessage.direction;

    let encrypted = decryptedBody ? 2 : 0;

    let system = false;
    let image;
    let video;
    let audio;
    let text;
    let metadata = {};
    let content = decryptedBody || sylkMessage.content;
    let file_transfer;

    if (content.indexOf('Welcome!') > -1) {
        system = true;
    }

    if (sylkMessage.contentType === 'text/html') {
        text = html2text(content);
    } else if (sylkMessage.contentType === 'text/plain') {
        text = content;
    } else if (sylkMessage.contentType === 'application/sylk-file-transfer') {
        try {
            metadata = JSON.parse(content);
            let file_name = metadata.filename;
            let encrypted = file_name.endsWith('.asc');
            let decrypted_file_name = encrypted ? file_name.slice(0, -4) : file_name;
            text = beautyFileNameForBubble(metadata);

            if (metadata.local_url && metadata.error != 'decryption failed') {
                if (isImage(decrypted_file_name)) {
                    image = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                } else if (isAudio(decrypted_file_name)) {
                    audio = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                } else if (isVideo(decrypted_file_name, metadata)) {
                    video = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                }
            }

        } catch (e) {
            console.log("Error decoding json in sylk message:", e);
        }
    } else if (sylkMessage.contentType.indexOf('image/') > -1) {
        image = `data:${sylkMessage.contentType};base64,${btoa(content)}`
        text = 'Image';
    } else {
        text = 'Unknown message received ' + sylkMessage.contentType;
    }

    let g_id = sylkMessage.id;

    let msg = {
        _id: g_id,
        key: g_id,
        text: text,
        image: image,
        video: video,
        audio: audio,
        metadata: metadata,
        contentType: sylkMessage.contentType,
        pinned: false,
        createdAt: sylkMessage.timestamp,
        received: direction === 'incoming',
        direction: direction,
        system: system,
        user: direction === 'incoming' ? {_id: sylkMessage.sender.uri, name: sylkMessage.sender.toString()} : {}
        }

        return msg;
}

function sql2GiftedChat(item, content, filter={}) {
    let msg;
    let image;
    let video;
    let audio;
    let metadata = {};
    let category;

    if ('category' in filter && filter['category']) {
        category = filter['category'];
    }

    //console.log('--- sql2GiftedChat', item, filter);

    let timestamp = new Date(item.unix_timestamp * 1000);
    let text = content || item.content

    let failed = (item.received === 0 || item.encrypted === 3) ? true: false;
    let received = item.received === 1 ? true : false;
    let sent = item.sent === 1 ? true : false;
    let pending = item.pending === 1 ? true : false;

    let from_uri = item.sender ? item.sender : item.from_uri;

    if (item.content_type === 'application/sylk-file-transfer') {
        let sql_metadata = item.metadata || text;
        try {
            let metadata_obj = JSON.parse(sql_metadata);
            Object.assign(metadata, metadata_obj);
        } catch (e) {
            console.log("Error decoding file transfer json from sql: ", e, item.content);
            return;
        }
    }

    let must_check_category = true;

    if (category && category !== 'text' && !metadata.filename) {
        return null;
    }

    if (metadata && metadata.filename) {
        if (category === 'paused') {
            if (!metadata.paused) {
                return null;
            }
            must_check_category = false;
        }

        if (category === 'failed') {
            if (!metadata.failed) {
                return null;
            }
            must_check_category = false;
        }

        if (category === 'text') {
            return null;
        }

        if (category === 'large') {
            if (metadata.filesize && metadata.filesize < HUGE_FILE_SIZE) {
                return null;
            }
            must_check_category = false;
        }

        let file_name = metadata.filename;
        text = beautyFileNameForBubble(metadata);

        if (metadata.local_url && !metadata.local_url.startsWith(RNFS.DocumentDirectoryPath)) {
            metadata.local_url = null;
        }

        if (metadata.local_url) {
            if (!metadata.error) {
                if (isImage(file_name)) {
                    if (metadata.b64) {
                        image = `data:${metadata.filetype};base64,${metadata.b64}`;
                    } else {
                        image = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                    }
                    if (must_check_category && category && category !== 'image') {
                        return null;
                    }
                } else if (isAudio(file_name)) {
                    audio = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                    if (must_check_category && category && category !== 'audio') {
                        return null;
                    }
                } else if (isVideo(file_name, metadata)) {
                    video = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                    if (must_check_category && category && category !== 'video') {
                        return null;
                    }
                } else {
                    if (must_check_category && category) {
                        return null;
                    }
                }
            }
        } else {
            if (isImage(file_name) && must_check_category && category && category !== 'image') {
                return null;
            } else if (isAudio(file_name && must_check_category && category && category !== 'audio')) {
                return null;
            } else if (isVideo(file_name, metadata) && must_check_category && category && category !== 'video') {
                return null;
            } else {
                if (must_check_category && category) {
                    return null;
                }
            }
        }

        if (metadata.error) {
            failed = true;
            text = text + ' - ' + metadata.error;
        }
    } else {
        if (item.image) {
            image = item.image;
        }

        if (item.encrypted === 3) {
            text = text + ' - decryption failed';
        }
    }

    msg = {
        _id: item.msg_id,
        key: item.msg_id,
        direction: item.direction,
        audio: audio,
        image: image,
        video: video,
        metadata: metadata,
        contentType: item.content_type,
        text: text,
        createdAt: timestamp,
        sent: sent,
        direction: item.direction,
        received: received,
        pending: pending,
        system: item.system === 1 ? true : false,
        failed: failed,
        pinned: (item.pinned === 1) ? true: false,
        user: item.direction == 'incoming' ? {_id: from_uri, name: from_uri} : {}
        }

    return msg;
}

function beautyFileNameForBubble(metadata, lastMessage=false) {
    let text = metadata.filename;
    let file_name = metadata.filename;
    //console.log('beautyFileNameForBubble', metadata);

    let prefix = (metadata.direction && metadata.direction === 'outgoing') ? '' : 'Press to download';
    if ('progress' in metadata && metadata.progress !== null && metadata.progress !== 100) {
        prefix = metadata.direction  === 'outgoing' ? 'Uploading' : 'Downloading';
    }

    let encrypted = metadata.filename.endsWith('.asc');
    let decrypted_file_name = encrypted ? file_name.slice(0, -4) : file_name;

    if (metadata.preview) {
        return metadata.duration? 'Movie preview' : 'Photo preview';
    }

    if (isImage(decrypted_file_name)) {
        if (metadata.local_url || lastMessage) {
            text = 'Photo';
        } else {
            text = prefix + ' photo';
        }
    } else if (isAudio(decrypted_file_name)) {
        if (metadata.local_url || lastMessage) {
            text = 'Audio message';
        } else {
            text = prefix + ' audio message';
            if (metadata.filesize > 10000000) {
                text = text + 'of ' + beautySize(metadata.filesize);
            }
        }
    } else if (isVideo(decrypted_file_name, metadata)) {
        if (metadata.local_url || lastMessage) {
            text = 'Video';
        } else {
            text = prefix + ' video of ' + beautySize(metadata.filesize);
        }
    } else {
        if (lastMessage) {
            text = decrypted_file_name;
        } else {
            if (metadata.local_url) {
                if (encrypted) {
                    if (metadata.local_url && !metadata.local_url.endsWith('.asc')) {
                        text = decrypted_file_name;
                    } else {
                        text = 'Decrypt ' + decrypted_file_name;
                    }
                } else {
                    if (metadata.failed && metadata.direction === "outgoing") {
                        text = 'Upload ' + file_name;
                    } else {
                        text = file_name;
                    }
                }
            } else {
                text = prefix + ' ' + file_name + ' of ' + beautySize(metadata.filesize);
            }
        }
    }

    //console.log(text);
    return text;

    // + '\n' + RNFS.DocumentDirectoryPath + '\n' + metadata.local_url;
}

function html2text(content) {
    content = xss(content, {
              whiteList: [], // empty, means filter out all tags
              stripIgnoreTag: true, // filter out all HTML not in the whitelist
              stripIgnoreTagBody: ["script", "style"] // the script tag is a special case, we need
              // to filter out its content
            });

    return content.replace(/&nbsp;/g, ' ');
}

function normalizeUri(uri, defaultDomain) {
    let targetUri = uri;
    let idx = targetUri.indexOf('@');
    let username;
    let domain;
    if (idx !== -1) {
        username = targetUri.substring(0, idx);
        domain = targetUri.substring(idx + 1);
    } else {
        username = targetUri;
        domain = defaultDomain;
    }
    username = username.replace(/[<>\s()\[\]\'\"\~\!\%\&\*\{\}\|\\]/g, '');
    return `${username}@${domain}`;
}

function copyToClipboard(text) {
    Clipboard.setString(text);
    return true;
}

function findContact(uri) {
    return new Promise((resolve, reject) => {
        //console.log('findContact')
        Contacts.checkPermission((err, permission) => {
            if (err) {
                //log the error
                console.log(err);
                return reject(err);
            }

            if (permission === 'authorized') {
                //console.log('HELLO', uri);
                Contacts.getContactsByEmailAddress(uri, (err, contacts) => {
                    if (err) {
                        console.log('error getting contacts by email')
                        return reject(err);
                    }

                    if (contacts) {
                        return resolve(contacts)
                    }

                    Contacts.getContactsMatchingString(uri, (err2, contacts2) => {
                        if (err2) {
                            console.log('error matching string')
                            return reject(err2);
                        }
                        console.log(contacts);
                        resolve(contacts2)
                    });

                })

            } else {
                console.log('not authortised')
                reject(new Error('Not Authorised'))
            }
        })
    })
}

function generateSillyName() {
    const adjective = SillyNames.randomAdjective();
    const number = Math.floor(Math.random() * 10);
    const noun1 =  SillyNames.randomNoun();
    const noun2 = SillyNames.randomNoun();
    return adjective + noun1 + noun2 + number;
}

function generateMaterialColor(text) {
    return MaterialColors.generateColor(text);
}

function generateVideoTrack(stream, width = 640, height = 480) {
    // const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // const analyser = audioCtx.createAnalyser();
    // const source = audioCtx.createMediaStreamSource(stream);
    // source.connect(analyser);

    // analyser.fftSize = 256;
    // const bufferLength = analyser.frequencyBinCount;
    // const dataArray = new Uint8Array(bufferLength);

    // const canvas = Object.assign(document.createElement('canvas'), {width, height});
    // const ctx = canvas.getContext('2d');

    // const img = new Image();
    // const blinkLogo = new Image();
    // img.addEventListener('load', () => {
    //     draw();
    // });

    // const draw = () => {
    //     if (stream.active) {
    //         const drawVisual = requestAnimationFrame(draw);
    //     }
    //     analyser.getByteFrequencyData(dataArray);

    //     ctx.fillStyle = 'rgb(35, 35, 35)';
    //     ctx.fillRect(0, 0, width, height);
    //     ctx.filter = 'grayscale(100%) brightness(90%)';
    //     ctx.drawImage(blinkLogo, (width / 2) - 150, (height / 2) - 150, 300, 300);
    //     ctx.filter = 'none';
    //     ctx.drawImage(img, (width / 2) - 45 , height / 3, 90, 90);
    //     const barWidth = (width / bufferLength) * 2.5;
    //     let barHeight;
    //     let x = 0;
    //     for(var i = 0; i < bufferLength; i++) {
    //         barHeight = dataArray[i] / 2;

    //         ctx.fillStyle = 'rgb(' + (barHeight + 100) + ', 50, 50)';
    //         ctx.fillRect(x, 2 * height / 3 - barHeight / 2, barWidth, barHeight);

    //         x += barWidth + 1;
    //     }
    // };
    // img.src = 'assets/images/video-camera-slash.png';
    // blinkLogo.src = 'assets/images/blink-white-big.png';

    // const canvasStream = canvas.captureStream();


    return Object.assign(stream.getVideoTracks()[0], {enabled: true});
}

function getWindowHeight() {
    return Dimensions.get('window').height;
}

function escapeHtml(text) {
  var map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };

  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

function isPhoneNumber(uri) {
    let username = uri;
    if (uri.indexOf('@') > -1) {
        username = uri.split('@')[0].trim();
    }
    return username.match(/^(\+|0)([\d|\-\(\)]+)$/);
}

function isEmailAddress(uri) {
    uri = uri.trim().toLowerCase();
    let email_reg = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/;
    return email_reg.test(uri);
}

function isImage(filename) {
    if (!filename || typeof filename !== 'string') {
        return false;
    }

    filename = filename.endsWith('.asc') ? filename.slice(0, -4) : filename;

    if (filename.toLowerCase().endsWith('.png')) {
        return true
    } else if (filename.toLowerCase().endsWith('.jpg')) {
        return true
    } else if (filename.toLowerCase().endsWith('.jpeg')) {
        return true
    } else if (filename.toLowerCase().endsWith('.gif')) {
        return true
    } else if (filename.toLowerCase().endsWith('.tiff')) {
        return true
    } else if (filename.toLowerCase().endsWith('.tif')) {
        return true
    }

    return false;
}

function isAudio(filename) {
    if (!filename || typeof filename !== 'string') {
        return false;
    }

    filename = filename.endsWith('.asc') ? filename.slice(0, -4) : filename;

    if (filename.toLowerCase().endsWith('.mp3')) {
        return true;
    }

    if (filename.toLowerCase().endsWith('.opus')) {
        return true
    }

    if (filename.toLowerCase().endsWith('.wav')) {
        return true
    }

    if (filename.toLowerCase().startsWith('sylk-audio-recording')) {
        return true
    }

    return false;
}

function isVideo(filename, metadata=null) {
    if (!filename || typeof filename !== 'string') {
        return false;
    }

    if (metadata) {
        if (metadata.filetype && metadata.filetype.startsWith('video/')) {
            return true;
        }

        if (metadata.duration) {
            return true;
        }
    }

    if (filename.toLowerCase().startsWith('sylk-audio-recording')) {
        return false
    }

    if (filename.toLowerCase().endsWith('.mpeg')) {
        return true;
    } else if (filename.toLowerCase().endsWith('.mp4')) {
        return true;
    } else if (filename.toLowerCase().endsWith('.webm')) {
        return true;
    } else if (filename.toLowerCase().endsWith('.ogg')) {
        return true;
    } else if (filename.toLowerCase().endsWith('.mpg')) {
        return true;
    } else if (filename.toLowerCase().endsWith('.mov')) {
        return true;
    }

    return false;
}

function titleCase(str) {
    return str.replace(
        /\w\S*/g,
        function(txt) {
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
    );
}

function beautySize(fsize) {
    let size = fsize + + " B";
    if (fsize > 1024 * 1024) {
        size = Math.ceil(fsize/1024/1024) + " MB";
    } else if (fsize < 1024 * 1024) {
        size = Math.ceil(fsize/1024) + " KB";
    }
    return size;
}


/* OpenPGP radix-64/base64 string encoding/decoding
 * Copyright 2005 Herbert Hanewinkel, www.haneWIN.de
 * version 1.0, check www.haneWIN.de for the latest version
 *
 * This software is provided as-is, without express or implied warranty.
 * Permission to use, copy, modify, distribute or sell this software, with or
 * without fee, for any purpose and by any individual or organization, is hereby
 * granted, provided that the above copyright notice and this paragraph appear
 * in all copies. Distribution as a part of an application or binary must
 * include the above copyright notice in the documentation and/or other materials
 * provided with the application or distribution.
 */

var b64s = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function radix64(t) {
	var a, c, n;
	var r = '', l = 0, s = 0;
	var tl = t.length;

	for (n = 0; n < tl; n++) {
		c = t.charCodeAt(n);
		if (s == 0) {
			r += b64s.charAt((c >> 2) & 63);
			a = (c & 3) << 4;
		} else if (s == 1) {
			r += b64s.charAt((a | (c >> 4) & 15));
			a = (c & 15) << 2;
		} else if (s == 2) {
			r += b64s.charAt(a | ((c >> 6) & 3));
			l += 1;
			if ((l % 60) == 0)
				r += "\n";
			r += b64s.charAt(c & 63);
		}
		l += 1;
		if ((l % 60) == 0)
			r += "\n";

		s += 1;
		if (s == 3)
			s = 0;
	}
	if (s > 0) {
		r += b64s.charAt(a);
		l += 1;
		if ((l % 60) == 0)
			r += "\n";
		r += '=';
		l += 1;
	}
	if (s == 1) {
		if ((l % 60) == 0)
			r += "\n";
		r += '=';
	}

	return r;
}

function isFileEncryptable(file_transfer) {

    if (file_transfer.filesize > ENCRYPTABLE_FILE_SIZE) {
        return false;
    }

    if (isVideo(file_transfer)) {
        return false;
    }

    return true;
}


function base64ToArrayBuffer(base64) {
    var binaryString = atob(base64);
    var bytes = new Uint8Array(binaryString.length);
    for (var i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Calculates a checksum over the given data and returns it base64 encoded
 * @param data [String] data to create a CRC-24 checksum for
 * @return [String] base64 encoded checksum
 * http://www.faqs.org/rfcs/rfc4880.html
 */

function getPGPCheckSum(base64_content) {
        let buffer = base64ToArrayBuffer(base64_content);
        let crc24 = polycrc.crc24;
        let checksum = crc24(buffer);

        var str = "" + String.fromCharCode(checksum >> 16)+
                                   String.fromCharCode((checksum >> 8) & 0xFF)+
                                   String.fromCharCode(checksum & 0xFF);
        return radix64(str);
}

exports.copyToClipboard = copyToClipboard;
exports.normalizeUri = normalizeUri;
exports.generateSillyName = generateSillyName;
exports.timestampedLog = timestampedLog;
exports.appendLeadingZeroes = appendLeadingZeroes;
exports.generateUniqueId = generateUniqueId;
exports.generateMaterialColor = generateMaterialColor;
exports.generateVideoTrack = generateVideoTrack;
exports.getWindowHeight = getWindowHeight;
exports.findContact = findContact;
exports.sylk2GiftedChat = sylk2GiftedChat;
exports.sql2GiftedChat = sql2GiftedChat;
exports.isAnonymous = isAnonymous;
exports.html2text = html2text;
exports.isEmailAddress = isEmailAddress;
exports.isPhoneNumber = isPhoneNumber;
exports.isImage = isImage;
exports.isAudio = isAudio;
exports.isVideo = isVideo;
exports.titleCase = titleCase;
exports.beautyFileNameForBubble = beautyFileNameForBubble;
exports.beautySize = beautySize;
exports.HUGE_FILE_SIZE = HUGE_FILE_SIZE;
exports.getPGPCheckSum = getPGPCheckSum;
exports.isFileEncryptable = isFileEncryptable;
