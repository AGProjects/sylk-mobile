import uuidv4 from 'uuid/v4';
import SillyNames from './SillyNames';
import MaterialColors from './MaterialColors';
import { Clipboard, Dimensions } from 'react-native';
import Contacts from 'react-native-contacts';
import xss from 'xss';
import {decode as atob, encode as btoa} from 'base-64';
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import { generateColor } from './MaterialColors';
import CryptoJS from 'crypto-js';
import ReactNativeBlobUtil from 'react-native-blob-util';
import path from 'path-browserify';


const logfile = RNFS.DocumentDirectoryPath + '/logs.txt';

let HUGE_FILE_SIZE = 15 * 1000 * 1000;
let ENCRYPTABLE_FILE_SIZE = 20 * 1000 * 1000;

let polycrc = require('polycrc');

/**
 * Get the expected partial download file path for a RNBackgroundDownloader task.
 * @param {string} taskId - The id used in RNBackgroundDownloader.download()
 * @returns {string} - Path to the temporary/partial file
 */
function getPartialDownloadPath(taskId) {
    if (Platform.OS === 'android') {
        // Android: partial files are in cache directory with taskId as filename
        return `${RNFS.CachesDirectoryPath}/${taskId}.download`;
    } else if (Platform.OS === 'ios') {
        // iOS: partial files are in the temporary directory with taskId as filename
        return `${RNFS.TemporaryDirectoryPath}${taskId}.download`;
    } else {
        throw new Error('Unsupported platform');
    }
}

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
  const current_datetime = new Date();
  const formatted_date =
    current_datetime.getFullYear() +
    '-' +
    appendLeadingZeroes(current_datetime.getMonth() + 1) +
    '-' +
    appendLeadingZeroes(current_datetime.getDate()) +
    ' ' +
    appendLeadingZeroes(current_datetime.getHours()) +
    ':' +
    appendLeadingZeroes(current_datetime.getMinutes()) +
    ':' +
    appendLeadingZeroes(current_datetime.getSeconds());

  let message = formatted_date;

  for (let i = 0; i < arguments.length; i++) {
    let arg = arguments[i];
    let txt;

    if (typeof arg === 'object') {
      try {
        txt = JSON.stringify(arg, null, 2);
      } catch (e) {
        txt = '[Unserializable object]';
      }
    } else {
      txt = String(arg);
    }

    message += ' ' + txt;
  }

  log2file(message);
  // console.log(message);
}



function generateUniqueId() {
    const uniqueId = uuidv4().replace(/-/g, '').slice(0, 16);
    return uniqueId;
}

function sylk2GiftedChat(sylkMessage, decryptedBody=null, direction='incoming') {
    direction = direction || sylkMessage.direction;
    
    //console.log('sylk2GiftedChat', sylkMessage);

    let encrypted = decryptedBody ? 2 : 0;

    let system = false;
    let image = null;
    let video = null;
    let audio = null;
    let text = null;
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
                if (isImage(decrypted_file_name, metadata.filetype)) {
                    image = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                } else if (isAudio(decrypted_file_name, metadata.filetype)) {
                    audio = Platform.OS === "android" ? 'file://'+ metadata.local_url : metadata.local_url;
                } else if (isVideo(decrypted_file_name, metadata.filetype)) {
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
		failed: false,
        system: system,
        user: direction === 'incoming' ? {_id: sylkMessage.sender.uri, name: sylkMessage.sender.toString()} : {}
        }

        return msg;
}

let sql2GiftedChatErrorId = 0;

// -------------------------
// SAFE LOGGER (never throws)
// -------------------------
function nullWithLog(extra = {}) {
    return null;

    sql2GiftedChatErrorId += 1;

    const msgId    = ("msgId" in extra)    ? extra.msgId    : "";
    const filename = ("filename" in extra) ? extra.filename : "";
    const category = ("category" in extra) ? extra.category : "";
    const reason   = ("reason" in extra)   ? extra.reason   : "";

    console.log(
        `sql2GiftedChat NULL #${sql2GiftedChatErrorId}: ${msgId} ${filename} is not ${category || reason}`
    );

    return null;
}


function fixLocalUrl(localUrl) {
	const parts = localUrl.split("/");
	// Iterate and remove consecutive duplicates of user@domain segments
	for (let i = 1; i < parts.length; i++) {
		if (parts[i].includes("@") && parts[i] === parts[i - 1]) {
			parts.splice(i, 1);
			i--; // stay at the same index after removal
		}
	}
	return parts.join("/");
}

async function sql2GiftedChat(item, content, filter = {}) {
    //console.log('-- sql2GiftedChat', item);
    let msg;
    let image = null;
    let video = null;
    let audio = null;
    let metadata = {};
    let category = filter.category || null;

    let timestamp = new Date(item.unix_timestamp * 1000);
    let text = content || item.content;

    if (text && text.indexOf("-----BEGIN PGP MESSAGE-----") > -1) {
        text = "";
    }

    let failed = (item.received === 0 || item.encrypted === 3);
    let received = item.received === 1;
    let sent = item.sent === 1;
    let pending = item.pending === 1;
    let from_uri = item.sender ? item.sender : item.from_uri;

    // -------------------------
    // Parse file-transfer JSON
    //---------------------------
    if (item.content_type === "application/sylk-file-transfer") {
        if (category == 'text') {
			return null;
        }
    
        let sql_metadata = item.metadata || text;
        try {
            Object.assign(metadata, JSON.parse(sql_metadata));
        } catch (e) {
            console.log("Error decoding file transfer JSON:", e);
            return nullWithLog({
                msgId: item.msg_id,
                reason: "invalid-json"
            });
        }
    }

    let must_check_category = true;

    // -------------------------
    // If filtering for media, but no filename → drop
    // -------------------------
    if (category && category !== "text" && !metadata.filename) {
        return nullWithLog({
            msgId: item.msg_id,
            filename: "",
            category
        });
    }

    // -------------------------
    // If we have a file transfer
    // -------------------------
    if (metadata.filename) {
        let filename = metadata.filename;  // <--- ALWAYS LOWERCASE
        text = beautyFileNameForBubble(metadata);
        
        if (metadata.local_url) {        
            if (!metadata.local_url.startsWith(RNFS.DocumentDirectoryPath)) {
				metadata.local_url = null;
            } else {
				const exists = await RNFS.exists(metadata.local_url);
				if (exists) {
					try {
						const { size } = await ReactNativeBlobUtil.fs.stat(metadata.local_url);
						//console.log('File exists local', metadata.local_url);
						if (size === 0) {
							metadata.local_url = null;
						} else {
							//console.log('FT', item.msg_id, metadata.filename, beautySize(size));
						
						}
					} catch (e) {
						console.log('Error stat file:', e.message);
					}
				} else {
					console.log('File does not exist', item.msg_id, metadata.local_url);
					metadata.local_url = null;
				}
            }
        }

        metadata.playing = false;
        if (!metadata.position) {
			metadata.position = 0;
        }

        if (!metadata.consumed) {
			metadata.consumed = 0;
        }
        
        let isImg = isImage(filename, metadata.filetype);
        let isAud = isAudio(filename, metadata.filetype);
        let isVid = isVideo(filename, metadata.filetype);

        // -------------------------
        // Category check
        // -------------------------
        if (must_check_category && category) {
            if (category === "image" && !isImg) {
                return nullWithLog({
                    msgId: item.msg_id,
                    filename,
                    category
                });
            }
            if (category === "audio" && !isAud) {
                return nullWithLog({
                    msgId: item.msg_id,
                    filename,
                    category
                });
            }
            if (category === "video" && !isVid) {
                return nullWithLog({
                    msgId: item.msg_id,
                    filename,
                    category
                });
            }
            if (category === "other") {
                return nullWithLog({
                    msgId: item.msg_id,
                    filename,
                    category
                });
            }
        }

        // -------------------------
        // Selected media type
        // -------------------------
        if (metadata.local_url && !metadata.error) {
            let local_url = Platform.OS === "android" ? "file://" + metadata.local_url : metadata.local_url;

			const fixed_local_url = fixLocalUrl(local_url);
			if (fixed_local_url != local_url) {
				local_url = fixed_local_url;
				//console.log('Local URL was fixed', fixed_local_url);
			}
			
			if (local_url) {
				if (isImg) {
					image = metadata.b64
						? `data:${metadata.filetype};base64,${metadata.b64}`
						: local_url;
				} else if (isAud) {
					audio = local_url;
				} else if (isVid) {
					video = local_url;
				}
			}
        }

        if (metadata.error) {
            failed = true;
            text = text + " - " + metadata.error;
        }

    } else {
        // -------------------------
        // Non-file-transfer behavior
        // -------------------------
        if (item.image) {
            image = item.image;
            text = "Photo";
        }

        if (item.encrypted === 3) {
            text = text + " - decryption failed";
            return null;
        }
    }
    
    const thumbnail = metadata.thumbnail || null;
    const rotation = metadata.rotation || 0;
    const label = metadata.label || null;
    const consumed = metadata.consumed || 0;
    const position = metadata.position || 0;
    const playing = metadata.playing || false;

    // -------------------------
    // Construct final message
    // -------------------------
    msg = {
        _id: item.msg_id,
        key: item.msg_id,
        direction: item.direction,
        audio,
        image,
        video,
        thumbnail,
        rotation,
        label,
        consumed,
        playing,
        position,
        metadata,
        contentType: item.content_type,
        text,
        createdAt: timestamp,
        sent,
        received,
        pending,
        system: item.system === 1,
        failed,
        pinned: item.pinned === 1,
        user: item.direction === "incoming"
            ? { _id: from_uri, name: from_uri }
            : {}

    };

    return msg;
}

function beautyFileNameForBubble(metadata, lastMessage=false) {
    let text = metadata.filename;
    let file_name = metadata.filename;
    //console.log('beautyFileNameForBubble', metadata);

    let prefix = '';
 
    let encrypted = metadata.filename.endsWith('.asc');
    let decrypted_file_name = encrypted ? file_name.slice(0, -4) : file_name;

    if (metadata.preview) {
        return metadata.duration? 'Movie' : 'Photo';
    }

    if (isImage(decrypted_file_name, metadata.filetype)) {
        text = 'Photo';
    } else if (isAudio(decrypted_file_name, metadata.filetype)) {
        text = 'Audio';
    } else if (isVideo(decrypted_file_name, metadata.filetype)) {
        text = 'Video';
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
                text = prefix + ' ' + decrypted_file_name;
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
    return generateColor(text);
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

function isImage(filename, filetype=null) {
     //console.log('isImage', filename, filetype);

    if (!filename || typeof filename !== 'string') {
        return false;
    }

	if (filename.endsWith('.asc')) {
		filename = filename.slice(0, -4); // remove last 4 characters
	}

    if (filetype && filetype.startsWith('image/')) {
        return true
    }

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

function isAudio(filename, filetype=null) {
    //console.log('isAudio', filename, filetype);
    if (!filename || typeof filename !== 'string') {
        return false;
    }

	if (filename.endsWith('.asc')) {
		filename = filename.slice(0, -4); // remove last 4 characters
	}

    if (filetype && filetype.startsWith('audio/')) {
        return true
    }

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

function isVideo(filename, filetype=null) {
    //console.log('isVideo', filename, filetype);
    if (!filename || typeof filename !== 'string') {
        return false;
    }

	if (filename.endsWith('.asc')) {
		filename = filename.slice(0, -4); // remove last 4 characters
	}

    if (filetype && filetype.startsWith('video/')) {
        return true
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
    try {
		if (file_transfer.filesize > ENCRYPTABLE_FILE_SIZE) {
			return false;
		}
	
		if (isVideo(file_transfer.filename, file_transfer.filetype)) {
			return false;
		}
    } catch (e) {
		console.log('isFileEncryptable e', e)
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


async function listAllFilesRecursive(path, level = 0) {
  let totalSize = 0;

  try {
    const items = await RNFS.readDir(path);

    for (const item of items) {
      if (item.isFile()) {
        //console.log(`${'  '.repeat(level)}File: ${item.name} - ${item.size} bytes`);
        totalSize += item.size;
      } else if (item.isDirectory()) {
        //console.log(`${'  '.repeat(level)}Directory: ${item.name}`);
        const dirSize = await listAllFilesRecursive(item.path, level + 1);
        console.log(`${'     '.repeat(level + 1)}[Directory ${item.path} total size: ${dirSize} bytes]`);
        totalSize += dirSize;
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${path}:`, err);
  }

  return totalSize;
}

/**
 * Returns a list of { remote_party, size, prettySize } sorted by folder size (desc),
 * including a synthetic 'all' entry with the total size of all remote_party folders.
 * @param {string} accountId
 * @returns {Promise<Array<{ remote_party: string, size: number, prettySize: string }>>}
 */
 

async function getRemotePartySizes(accountId) {
  const accountPath = `${RNFS.DocumentDirectoryPath}/${accountId}`;
  try {
    const remoteParties = await RNFS.readDir(accountPath);
    const results = [];
    let totalSize = 0;

    for (const item of remoteParties) {
      if (item.isDirectory()) {
        const remoteParty = item.name;
        const remotePartyPath = item.path;
        const size = await getFolderSize(remotePartyPath);
        //console.log('calculate size:', item.path);
        //listAllFilesRecursive(item.path);        
        totalSize += size;
        results.push({
          remote_party: remoteParty,
          size,
           prettySize: formatBytes(size),
        });
      }
    }

    // Sort descending by size
    results.sort((a, b) => b.size - a.size);

    // Add synthetic 'all' entry at the top
    results.unshift({
      remote_party: 'all',
      size: totalSize,
      prettySize: formatBytes(totalSize),
    });

    return results;
  } catch (error) {
    //console.log('No remote parties:', error);
    return [];
  }
}

/**
 * Recursively calculates the total size of a folder in bytes.
 */
async function getFolderSize(folderPath) {
  let totalSize = 0;
  try {
    const items = await RNFS.readDir(folderPath);
    for (const item of items) {
      if (item.isFile()) {
        totalSize += Number(item.size);
      } else if (item.isDirectory()) {
        totalSize += await getFolderSize(item.path);
      }
    }
  } catch (error) {
    console.error(`Error calculating size for ${folderPath}:`, error);
  }
  return totalSize;
}

/**
 * Converts bytes to a human-readable string (B, KB, MB, GB, TB).
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = Math.ceil(bytes / Math.pow(k, i));
  return `${value} ${sizes[i]}`;
}

function getErrorMessage(error) {
  if (typeof error === 'string') {
    // error is a plain string
    return error;
  } else if (error && typeof error === 'object') {
    // error is an object
    const message = error.error || 'Unknown error';
    if (error.errorCode == 404) {
       return 'File not found';
    } else if (error.errorCode !== undefined) {
      return `${message} (${error.errorCode})`;
    }

    return message;
  } else {
    // fallback if error is null or some other type
    return 'Unknown error';
  }
}


function formatPGPMessage(pgpMessage, lineLength = 64) {
	// Split the message into lines if it already has them
	const lines = pgpMessage.split(/\r?\n/).filter(line => line.trim() !== '');

	// Keep the header and footer intact
	const beginMarker = '-----BEGIN PGP MESSAGE-----';
	const endMarker = '-----END PGP MESSAGE-----';
	const header = lines[0] === beginMarker ? lines.shift() : '';
	const footer = lines[lines.length - 1] === endMarker ? lines.pop() : '';

	// Join the remaining content into a single string
	const body = lines.join('').replace(/\r?\n/g, '');

	// Break the body into chunks of lineLength
	const formattedBody = body.match(new RegExp(`.{1,${lineLength}}`, 'g')).join('\n');

	// Reconstruct the message
	return [header, formattedBody, footer].filter(Boolean).join('\n');
}

async function fileChecksum(filePath) {
  try {
    // Read file as base64 string
    const fileBase64 = await RNFS.readFile(filePath, 'base64');
    
    // Convert base64 to WordArray for CryptoJS
    const wordArray = CryptoJS.enc.Base64.parse(fileBase64);
    
    // Compute hash (choose MD5, SHA1, SHA256, etc.)
    const checksum = CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);
    
    console.log('SHA256 Checksum:', checksum);
    return checksum;
  } catch (err) {
    console.error('Error calculating checksum:', err);
    return null;
  }
}

function deepEqual(a, b) {
  if (a === b) return true;

  if (typeof a !== "object" || typeof b !== "object" || a == null || b == null) {
    return false;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (let key of keysA) {
    if (!keysB.includes(key) || !deepEqual(a[key], b[key])) {
      return false;
    }
  }

  return true;
}

const availableAudioDevicesIconsMap = {
	BUILTIN_EARPIECE: 'phone',
	WIRED_HEADSET: 'headphones',
	USB_HEADSET: 'usb',
	BLUETOOTH_SCO: 'bluetooth-audio',
	BUILTIN_SPEAKER: 'volume-high',
};

const availableAudioDeviceNames = {
	BUILTIN_EARPIECE: 'Earpiece',
	WIRED_HEADSET: 'Wired headset',
	USB_HEADSET: 'USB headset',
	BLUETOOTH_SCO: 'Bluetooth',
	BUILTIN_SPEAKER: 'Speaker',
};
                    
exports.formatPGPMessage = formatPGPMessage;
exports.getErrorMessage = getErrorMessage;
exports.formatBytes = formatBytes;
exports.getRemotePartySizes = getRemotePartySizes;
exports.getPartialDownloadPath = getPartialDownloadPath;
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
exports.fileChecksum = fileChecksum;
exports.deepEqual = deepEqual;
exports.availableAudioDevicesIconsMap = availableAudioDevicesIconsMap;
exports.availableAudioDeviceNames = availableAudioDeviceNames;
