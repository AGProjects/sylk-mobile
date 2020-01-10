import uuidv4 from 'uuid/v4';
import SillyNames from './SillyNames';
import MaterialColors from './MaterialColors';
import { Clipboard, Dimensions } from 'react-native';

function generateUniqueId() {
    const uniqueId = uuidv4().replace(/-/g, '').slice(0, 16);
    return uniqueId;
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
    username = username.replace(/[\s()-]/g, '');
    return `${username}@${domain}`;
}

function copyToClipboard(text) {
    Clipboard.setString(text);

    return true;
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

exports.copyToClipboard = copyToClipboard;
exports.normalizeUri = normalizeUri;
exports.generateSillyName = generateSillyName;
exports.generateUniqueId = generateUniqueId;
exports.generateMaterialColor = generateMaterialColor;
exports.generateVideoTrack = generateVideoTrack;
exports.getWindowHeight = getWindowHeight;
