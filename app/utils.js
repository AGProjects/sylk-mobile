import uuidv4 from 'uuid/v4';
import SillyNames from './SillyNames';
import MaterialColors from './MaterialColors';
import { Clipboard, Dimensions } from 'react-native';
import Contacts from 'react-native-contacts';
import xss from 'xss';

const RNFS = require('react-native-fs');
const logfile = RNFS.DocumentDirectoryPath + '/logs.txt';

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

function sylkToRenderMessage(sylkMessage, decryptedBody=null, direction='incoming') {
    //console.log(sylkToRenderMessage, sylkMessage);
    direction = direction || sylkMessage.direction;

    let encrypted = decryptedBody ? 2 : 0;

    /*
    export interface IMessage {
      _id: string | number
      text: string
      createdAt: Date | number
      user: User
      image?: string
      video?: string
      audio?: string
      system?: boolean
      sent?: boolean
      received?: boolean
      pending?: boolean
      quickReplies?: QuickReplies
    }
    */

    let system = false;
    let image;
    let content = decryptedBody || sylkMessage.content;

    if (content.indexOf('Welcome!') > -1) {
        system = true;
    }

    if (sylkMessage.contentType === 'text/html') {
        content = html2text(content);
    } else if (sylkMessage.contentType === 'text/plain') {
        content = content;
    } else if (sylkMessage.contentType.indexOf('image/') > -1) {
        image = `data:${sylkMessage.contentType};base64,${btoa(content)}`
    } else {
        content = 'Unknown message type received ' + sylkMessage.contentType;
    }

    let g_id = sylkMessage.id;

    return {
        _id: g_id,
        text: content,
        image: image,
        pinned: false,
        createdAt: sylkMessage.timestamp,
        received: direction === 'incoming',
        direction: direction,
        encrypted: encrypted,
        system: system,
        user: direction === 'incoming' ? {_id: sylkMessage.sender.uri, name: sylkMessage.sender.toString()} : {}
        }
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
    if (!filename) {
        return false;
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

function isVideo(filename) {
    if (!filename) {
        return false;
    }

    if (filename.toLowerCase().endsWith('.mpeg')) {
        return true;
    } else if (filename.toLowerCase().endsWith('.mp4')) {
        return true;
    }

    return false;
}

function isAudio(filename) {
    if (!filename) {
        return false;
    }

    if (filename.toLowerCase().endsWith('.mp3')) {
        return true;
    } else if (filename.toLowerCase().endsWith('.ogg')) {
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
exports.sylkToRenderMessage = sylkToRenderMessage;
exports.isAnonymous = isAnonymous;
exports.html2text = html2text;
exports.isEmailAddress = isEmailAddress;
exports.isPhoneNumber = isPhoneNumber;
exports.isImage = isImage;
exports.isAudio = isAudio;
exports.isVideo = isVideo;
exports.titleCase = titleCase;
