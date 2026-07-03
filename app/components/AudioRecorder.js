import React, { Component, Fragment } from 'react';
import { View, Platform, TouchableHighlight, TouchableOpacity, DeviceEventEmitter, NativeModules, Keyboard, Modal } from 'react-native';
const { AudioRouteModule: SylkAudioRouteModule } = NativeModules;
import { IconButton, Title, Button, Text, ActivityIndicator, Menu } from 'react-native-paper';
import MaterialCommunityIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { check as checkPermission, PERMISSIONS as RNP_PERMISSIONS, RESULTS as RNP_RESULTS } from 'react-native-permissions';
import autoBind from 'auto-bind';

import { red } from '../assets/styles/colors';
import utils from '../utils';
import AudioWaveform from './AudioWaveform';
import VuMeter from './VuMeter';
import MicSpectrumBars from './MicSpectrumBars';
import SpectrumPlayback from './SpectrumPlayback';
import AudioTimeScale from './AudioTimeScale';
import SpectrumRecorder from './SpectrumRecorder';
import AudioProgressSlider from './AudioProgressSlider';
import AudioRecorderPlayer, {
    AudioEncoderAndroidType,
    AudioSourceAndroidType,
    AVEncodingOption,
    AVEncoderAudioQualityIOSType,
    OutputFormatAndroidType,
} from 'react-native-audio-recorder-player';
import RNFS from 'react-native-fs';
import Sound from 'react-native-sound';

import styles from '../assets/styles/ReadyBox';

const audioRecorderPlayer = new AudioRecorderPlayer();
// Poll record-metering and playback-position callbacks at ~20 fps
// (50 ms) instead of the library default (~500 ms). The default made
// the recorded waveform peaks land at only ~2/sec and the preview
// slider step in coarse half-second jumps that visibly lagged the
// audio. 50 ms gives smooth peaks + a slider that tracks what you hear.
try { audioRecorderPlayer.setSubscriptionDuration(0.05); } catch (e) { /* older lib: ignore */ }

// AudioRecorder — the voice-message subsystem extracted out of ReadyBox.
// Owns all recording / input-selection / live-metering / preview-playback /
// send+delete state and UI. Driven by ReadyBox through a ref (recordAudio,
// sendAudioFile, startAudioPlayer, stopAudioPlayer, deleteAudio, previewAudio,
// pausePreviewAudio, reset) and reports activity back via onStateChange so
// ReadyBox can keep its layout gates (hide chat / contacts while a take is in
// progress).
class AudioRecorder extends Component {
    constructor(props) {
        super(props);
        autoBind(this);
        this.recordingStopTimer = null;
        this._micPeaks = null;
        this.state = {
            recording: false,
            recordArmed: false,
            recordStarting: false,
            recordingFile: null,
            recordingPeaks: [],
            recordingSpectrum: null,
            recordingDuration: 0,
            recordingElapsedMs: 0,
            recordingInputDevice: null,
            recordInputs: [],
            selectedRecordInput: null,
            recordInputMenuVisible: false,
            previewRecording: false,
            playRecording: false,
            previewScrubPct: null,
            level: 0,
            playTime: '',
            currentPositionSec: 0,
            currentDurationSec: 0,
            audioSendFinished: false,
            // External message playback (chat voice messages / call
            // recordings). When set, this recorder renders its player card
            // for a chat message's file instead of a freshly-recorded take.
            // Routing chat playback through here lets ReadyBox unmount the
            // GiftedChat list during playback (showContactsList gates on
            // recorder activity), so the FlatList never reconciles per tick —
            // the stop tap stays instant and levels/spectrum animate smoothly.
            msgPlayback: null,   // { tid, title, peaks, spectrum, durationSec, startPct }
            msgPlaying: false,
        };
    }

    componentDidMount() {
        // Stop voice-message recording / preview playback whenever a call is
        // about to start (incoming OR outgoing) so audio doesn't contend with
        // the ringtone or the call itself.
        this.callStartingListener = DeviceEventEmitter.addListener(
            'SylkCallStarting',
            () => {
                try {
                    if (this.state.recording) {
                        this.stopRecording();
                    }
                    if (this.state.msgPlayback) {
                        this.stopMessageAudio();
                    }
                    if (this.state.playRecording || this.state.previewRecording) {
                        try { audioRecorderPlayer.stopPlayer(); } catch (_e) {}
                        try { audioRecorderPlayer.removePlayBackListener(); } catch (_e) {}
                        this.setState({ playRecording: false, previewRecording: false });
                    }
                } catch (e) { /* swallow — never block call handling */ }
            }
        );
    }

    componentWillUnmount() {
        if (this.callStartingListener) {
            this.callStartingListener.remove();
            this.callStartingListener = null;
        }
    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        if (typeof nextProps.playRecording === 'boolean'
                && nextProps.playRecording !== this.state.playRecording) {
            this.setState({ playRecording: nextProps.playRecording });
        }
        if (typeof nextProps.recordingDuration === 'number'
                && nextProps.recordingDuration !== this.state.recordingDuration) {
            this.setState({ recordingDuration: nextProps.recordingDuration });
        }
    }

    componentDidUpdate(prevProps, prevState) {
        const keys = ['recording', 'recordArmed', 'previewRecording', 'playRecording', 'recordingFile', 'msgPlayback'];
        const changed = keys.some((k) => prevState[k] !== this.state[k]);
        if (changed && typeof this.props.onStateChange === 'function') {
            this.props.onStateChange({
                recording: this.state.recording,
                recordArmed: this.state.recordArmed,
                previewRecording: this.state.previewRecording,
                playRecording: this.state.playRecording,
                recordingFile: this.state.recordingFile,
                // Boolean so ReadyBox can gate chat visibility / the top Stop
                // button on an active chat-message playback.
                msgPlaybackActive: !!this.state.msgPlayback,
            });
        }
    }

    // Full reset of the recorder — called by ReadyBox.resetContact when the
    // selected contact changes / a take is abandoned.
    reset() {
        this.stopRecordingTimer();
        if (this.state.msgPlayback) {
            this.stopMessageAudio();
        }
        if (Platform.OS === 'android' && SylkAudioRouteModule && SylkAudioRouteModule.restoreAfterBluetoothInputRecording) {
            SylkAudioRouteModule.restoreAfterBluetoothInputRecording()
                .catch((btRestErr) => {
                    console.log('[recorder] BT input restore failed (reset):',
                        btRestErr && btRestErr.message);
                });
        }
        try { SpectrumRecorder.stop(); } catch (e) {}
        this.setState({
            recording: false,
            recordingFile: null,
            recordingDuration: 0,
            recordingPeaks: [],
            recordingSpectrum: null,
            recordingInputDevice: null,
            recordArmed: false,
            recordStarting: false,
            selectedRecordInput: null,
            recordInputMenuVisible: false,
            audioSendFinished: false,
            previewRecording: false,
            playRecording: false,
            level: 0,
            recordingElapsedMs: 0,
        });
    }

	async startAudioPlayer() {
	    //console.log('-- RB startAudioPlayer');
		try { utils.timestampedLog('[applog] [audio] [recorder.startAudioPlayer] set playRecording=true (UI gate only)'); } catch (_e) {}
		this.setState({playRecording: true});
	}

	async stopAudioPlayer() {
		// This only clears the recorder's `playRecording` UI flag (which
		// hides the top Stop button). It does NOT tear down the
		// audioRecorderPlayer instance that ChatBox uses to play a received
		// voice message — so a "Stop" that ends up here hides the button but
		// leaves message audio playing. Logged so that mismatch is visible.
		try { utils.timestampedLog('[applog] [audio] [recorder.stopAudioPlayer] set playRecording=false (UI gate only — no native stop)'); } catch (_e) {}
		this.setState({playRecording: false});
	}

	// Resample timestamped mic peaks onto a uniform grid anchored at t0,
	// spanning spanMs, at rateHz. Mirrors SpectrumRecorder._resampleToGrid so
	// the waveform and the spectrogram share one timeline: frames captured
	// before the audio anchor (metering warm-up) are dropped, the grid covers
	// the whole clip, and each slot takes the nearest captured sample. Accepts
	// either the new [{t, v}] shape or a legacy flat number[] (returned as-is).
	_resamplePeaksToGrid(frames, t0, spanMs, rateHz) {
		if (!frames || !frames.length) return [];
		// Legacy path: plain numbers (no timestamps) → nothing to align to.
		if (typeof frames[0] === 'number') return frames.slice();
		const rate = rateHz > 0 ? rateHz : 20;
		const rel = [];
		for (let i = 0; i < frames.length; i++) {
			const r = frames[i].t - t0;
			if (r >= 0) rel.push({ t: r, v: frames[i].v });
		}
		if (!rel.length) {
			const base = frames[0] ? frames[0].t : t0;
			for (let i = 0; i < frames.length; i++) rel.push({ t: Math.max(0, frames[i].t - base), v: frames[i].v });
		}
		rel.sort((a, b) => a.t - b.t);
		const lastT = rel[rel.length - 1].t;
		let span = (spanMs && spanMs > 0) ? spanMs : (lastT + 1000 / rate);
		if (span <= 0) span = 1000 / rate;
		let count = Math.round((span / 1000) * rate);
		if (count < 1) count = 1;
		const out = new Array(count);
		let j = 0;
		for (let k = 0; k < count; k++) {
			const gt = (k / rate) * 1000;   // grid time in ms
			while (j + 1 < rel.length && rel[j + 1].t <= gt) j++;
			let idx = j;
			if (j + 1 < rel.length && Math.abs(rel[j + 1].t - gt) < Math.abs(rel[idx].t - gt)) idx = j + 1;
			out[k] = rel[idx].v;
		}
		return out;
	}

	// ---- Chat message playback (reuses the recorder's player card) --------
	// info: { path, tid, title, peaks:{l,r}, spectrum, durationSec, position }
	async playMessageAudio(info) {
		if (!info || !info.path) return;
		try { utils.timestampedLog('[applog] [audio] [recorder.playMessageAudio] tid=', info.tid, 'durSec=', info.durationSec, 'startPct=', info.position); } catch (_e) {}
		const startPct = (typeof info.position === 'number' && info.position > 0 && info.position < 100) ? info.position : 0;
		const path = info.path.startsWith('file://') ? info.path : 'file://' + info.path;
		// Keep the source (incl. path) on state so we can restart from 0 when
		// the clip finishes without needing the original event again.
		this.setState({
			msgPlayback: {
				path,
				tid: info.tid,
				title: info.title || 'Recording',
				createdAt: info.createdAt || null,
				peaks: info.peaks || { l: [], r: [] },
				spectrum: info.spectrum || null,
				durationSec: info.durationSec || 0,
			},
			previewScrubPct: null,
			currentPositionSec: 0,
			currentDurationSec: (info.durationSec || 0) * 1000,
		});
		this._beginMsgPlayback(path, startPct);
	}

	// Start (or restart) the native player for the current message at startPct.
	//
	// IMPORTANT: position is derived from the WALL CLOCK, not e.currentPosition.
	// These voice notes / call recordings are low-rate (16 kHz) AAC/OGG, and on
	// Android MediaPlayer.getCurrentPosition() advances at fileRate/outputRate
	// (~16000/44100 ≈ 0.36×) for them — so e.currentPosition crawls at ~a third
	// of real time while the audio plays at normal speed. Driving the waveform
	// and spectrum off that made them lag badly behind what you hear. e.duration
	// (getDuration) IS correct, so we advance position from Date.now() and only
	// use e.duration for the total. (Same approach the old ChatBox player used.)
	async _beginMsgPlayback(path, startPct) {
		try { audioRecorderPlayer.stopPlayer(); } catch (_e) {}
		try { audioRecorderPlayer.removePlayBackListener(); } catch (_e) {}
		this._msgSeeked = false;
		this._msgPlayerActive = true;
		this._msgBaseMs = 0;           // playback position (ms) at the last (re)start/seek/resume
		this._msgWall = Date.now();    // wall-clock anchor for that base
		this.setState({ msgPlaying: true });
		try {
			await audioRecorderPlayer.startPlayer(path);
			audioRecorderPlayer.addPlayBackListener((e) => {
				if (!e || !e.duration || e.duration <= 0) return;
				const dur = Math.floor(e.duration);
				// One-shot seek to the saved position once the player reports a
				// real duration; rebase the wall clock to that position.
				if (!this._msgSeeked) {
					this._msgSeeked = true;
					const startMs = (startPct > 0) ? Math.floor((startPct / 100) * dur) : 0;
					if (startMs > 0) {
						try { audioRecorderPlayer.seekToPlayer(startMs); } catch (_e) {}
					}
					this._msgBaseMs = startMs;
					this._msgWall = Date.now();
				}
				// Wall-clock position (independent of the crawling currentPosition).
				const current = Math.max(0, Math.min(dur, this._msgBaseMs + (Date.now() - this._msgWall)));
				// Reached the end → DON'T close the modal. Stop the native player,
				// rewind the UI to 0 and flip the button back to play so the user
				// can immediately replay.
				if (current >= dur - 60) {
					try { audioRecorderPlayer.stopPlayer(); } catch (_e) {}
					try { audioRecorderPlayer.removePlayBackListener(); } catch (_e) {}
					this._msgPlayerActive = false;
					this._msgSeeked = false;
					this.setState({ msgPlaying: false, currentPositionSec: 0, currentDurationSec: dur, previewScrubPct: null });
					return;
				}
				this.setState({
					currentPositionSec: current,
					currentDurationSec: dur,
				});
			});
		} catch (err) {
			console.log('_beginMsgPlayback error', err && err.message);
			this._msgPlayerActive = false;
			this.setState({ msgPlaying: false });
		}
	}

	async toggleMsgPlayPause() {
		const src = this.state.msgPlayback;
		if (!src) return;
		try {
			if (this.state.msgPlaying) {
				// Freeze the wall-clock position at the current spot.
				this._msgBaseMs = Math.max(0, Math.min(this.state.currentDurationSec || 0, this._msgBaseMs + (Date.now() - this._msgWall)));
				await audioRecorderPlayer.pausePlayer();
				this.setState({ msgPlaying: false, currentPositionSec: this._msgBaseMs });
			} else if (this._msgPlayerActive) {
				// Paused mid-clip → resume: re-anchor the wall clock, keep base.
				this._msgWall = Date.now();
				await audioRecorderPlayer.resumePlayer();
				this.setState({ msgPlaying: true });
			} else {
				// Finished (or never started) → (re)start from the current
				// position (0 after an end-of-clip rewind).
				const dur = this.state.currentDurationSec || (src.durationSec ? src.durationSec * 1000 : 0);
				const startPct = (dur > 0 && this.state.currentPositionSec > 0)
					? Math.max(0, Math.min(100, (this.state.currentPositionSec / dur) * 100))
					: 0;
				this._beginMsgPlayback(src.path, startPct);
			}
		} catch (e) { console.log('toggleMsgPlayPause error', e && e.message); }
	}

	stopMessageAudio() {
		try { utils.timestampedLog('[applog] [audio] [recorder.stopMessageAudio] stop + reveal chat'); } catch (_e) {}
		try { audioRecorderPlayer.stopPlayer(); } catch (_e) {}
		try { audioRecorderPlayer.removePlayBackListener(); } catch (_e) {}
		this._msgSeeked = false;
		this._msgPlayerActive = false;
		this.setState({ msgPlayback: null, msgPlaying: false, currentPositionSec: 0, previewScrubPct: null });
	}

    async previewAudio () {
		this.setState({previewRecording: true});

		const path = this.state.recordingFile.startsWith('file://')
		  ? this.state.recordingFile
		  : 'file://' + this.state.recordingFile;
  
        try {
			const msg = await audioRecorderPlayer.startPlayer(path);
			this.setState({previewRecording: true});
	
			audioRecorderPlayer.addPlayBackListener((e) => {
				if (e.duration === e.currentPosition) {
					this.setState({previewRecording: false});
				}
	
				this.setState({
				  currentPositionSec: e.currentPosition,
				  currentDurationSec: e.duration,
				  playTime: audioRecorderPlayer.mmssss(Math.floor(e.currentPosition)),
				  duration: audioRecorderPlayer.mmssss(Math.floor(e.duration)),
				});
			});
        } catch (e) {
			console.log('previewAudio error', e);
        }
    };

    pausePreviewAudio = async () => {
		this.setState({previewRecording: false});
        await audioRecorderPlayer.pausePlayer();
    };

    onStopPlay = async () => {
        if (!this.state.previewRecording) {
			return;
        }
        this.setState({previewRecording: false});
        audioRecorderPlayer.stopPlayer();
        audioRecorderPlayer.removePlayBackListener();
    };

    async sendAudioFile() {
        if (this.state.recordingFile) {
            this.setState({audioSendFinished: true});
            setTimeout(() => {
                this.setState({audioSendFinished: false});
            }, 10);
            let msg = await this.props.file2GiftedChat(this.state.recordingFile);
            // Attach the per-100ms mic peaks captured during
            // recording so the recipient's bubble draws the same
            // waveform we previewed locally. Single-channel — the
            // mic is the only signal — so peaks.r stays empty;
            // AudioWaveform handles the empty side gracefully.
            const peaks = this.state.recordingPeaks;
            if (msg && msg.metadata
                    && peaks && Array.isArray(peaks) && peaks.length > 0) {
                msg.metadata.peaks = { l: peaks, r: [] };
            }
            // Attach the captured spectrogram so the recipient's bubble
            // can animate the spectrum on playback, just like the
            // waveform peaks. Sent as a side-channel in transferFile()
            // since SylkServer strips custom file_transfer fields.
            const spectrum = this.state.recordingSpectrum;
            if (msg && msg.metadata && spectrum) {
                msg.metadata.spectrum = spectrum;
            }
            // Persist the clip duration (seconds) in the metadata so the
            // bubble has it on the FIRST render — without it the length is
            // probed async via react-native-sound and the duration label /
            // seconds scale only appear a beat later (the "missing initial
            // duration" flash). Safe to set here: file2GiftedChat already
            // routed this to msg.audio (the isVideo||duration branch is
            // only reached for non-audio files), so a duration field can't
            // re-route it to the video branch.
            if (msg && msg.metadata && this.state.recordingDuration) {
                msg.metadata.duration = this.state.recordingDuration;
            }
            this.transferFile(msg);
            this.setState({recordingFile: null, recordingDuration: 0,
                           recordingPeaks: [], recordingSpectrum: null});
        }
    }

    async transferFile(msg) {
        msg.metadata.preview = false;
        this.props.sendMessage(msg.metadata.receiver.uri, msg, 'application/sylk-file-transfer');
        // Ship peaks as a sylk-message-metadata follow-up so the
        // recipient's bubble can draw the waveform. SylkServer's
        // file-transfer broadcast strips custom fields like `peaks`,
        // so without this side-channel the recipient's waveform
        // renders as a flat baseline. See app.js: sendPeaksMessage.
        if (msg.metadata && msg.metadata.peaks
                && typeof this.props.sendPeaksMessage === 'function') {
            // The recorded spectrogram rides along inside the peaks
            // payload (the receiver lifts it back out to
            // metadata.spectrum). Reusing the peaks side-channel means
            // it inherits the same ordering / pending-buffer handling
            // for messages that arrive before the file-transfer row.
            const payload = msg.metadata.spectrum
                ? { ...msg.metadata.peaks, spectrum: msg.metadata.spectrum }
                : msg.metadata.peaks;
            this.props.sendPeaksMessage(
                msg.metadata.receiver.uri,
                msg.metadata.transfer_id,
                payload
            );
        }
    }

    deleteAudioAction(event) {
        //console.log('deleteAudioAction');
        event.preventDefault();
        this.onStopPlay();
        this.deleteAudio();
    }

    async recordAudio() {
        //console.log('Start recording by user...');

        const micAllowed = await this.props.requestMicPermission('recordAudio');

        // Re-probe the cached permission flag now that the user has
        // either granted or denied at the OS prompt. Without this the
        // mic button would stay visible until the next foreground
        // transition for a user who just tapped Deny — they'd see a
        // tappable button that silently does nothing.
        this.props.refreshMicPermission && this.props.refreshMicPermission();

        if (!micAllowed) {
            return;
        }

        if (!this.state.recording) {
            if (this.state.recordingFile) {
                this.deleteAudio();
            } else if (this.state.recordArmed) {
                // Already on the armed screen — the mic tap acts as Start.
                this.startArmedRecording();
            } else {
                // Show the armed screen (input device selector + Start
                // button) and let the user pick a device and begin
                // recording explicitly.
                this.armRecording();
            }
        } else {
            this.onStopRecord();
        }
    }

    // Enter the pre-record "armed" state: load the selectable input devices,
    // default to a connected headset (else the built-in mic), and show the
    // selector + Start button. Recording does not begin until the user taps
    // Start (startArmedRecording).
    async armRecording() {
        let devices = [{ type: 'BUILTIN_MIC', name: 'Built-in microphone', id: 'builtin' }];
        if (Platform.OS === 'android'
                && SylkAudioRouteModule
                && SylkAudioRouteModule.getRecordingInputDevices) {
            try {
                const list = await SylkAudioRouteModule.getRecordingInputDevices();
                if (Array.isArray(list) && list.length) {
                    devices = list;
                }
                console.log('[recorder] selectable input devices:', JSON.stringify(devices));
            } catch (e) {
                console.log('[recorder] getRecordingInputDevices failed:', e && e.message);
            }
        }
        const withIcons = devices.map((d) => ({
            type: d.type,
            name: d.name,
            id: d.id,
            icon: utils.inputDeviceIconsMap[d.type] || 'microphone',
        }));
        // Default selection: prefer a connected headset over the built-in mic.
        const def = utils.pickActiveInputFromList(withIcons);
        const selected = withIcons.find((d) => d.type === def.type) || withIcons[0];
        this.setState({
            recordArmed: true,
            recordInputs: withIcons,
            selectedRecordInput: selected,
            recordInputMenuVisible: false,
        });
    }

    // Begin capturing on the selected device (called from the Start button or
    // a second mic tap while armed). We keep recordArmed=true and flip
    // recordStarting=true so the armed screen stays mounted (chat stays
    // hidden) and shows a spinner until onStartRecord flips recording=true —
    // otherwise there's a window where neither recordArmed nor recording is
    // set and the chat view flashes back during the (async) route engage.
    startArmedRecording() {
        if (this.state.recordStarting) {
            return;
        }
        this.setState({ recordStarting: true, recordInputMenuVisible: false });
        this.onStartRecord();
    }

    // Leave the armed screen without recording.
    cancelArming() {
        this.setState({
            recordArmed: false,
            recordStarting: false,
            recordInputMenuVisible: false,
            selectedRecordInput: null,
        });
    }

    // Pick a different input device on the armed screen.
    selectRecordInput(device) {
        this.setState({ selectedRecordInput: device, recordInputMenuVisible: false });
    }

    // The input-device picker shown on the armed screen. With a single input
    // it's a plain icon + label (nothing to choose); with more, it's a tappable
    // dropdown (react-native-paper Menu), mirroring the in-call audio picker.
    renderRecordInputSelector() {
        const devices = this.state.recordInputs || [];
        const sel = this.state.selectedRecordInput;
        const selIcon = (sel && sel.icon) || 'microphone';
        const selName = (sel && sel.name) || 'Built-in microphone';

        if (devices.length <= 1) {
            return (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <MaterialCommunityIcon name={selIcon} size={18} color="#ccc" />
                    <Text style={{ marginLeft: 6, color: '#ccc' }}>{selName}</Text>
                </View>
            );
        }

        return (
            <Menu
                visible={this.state.recordInputMenuVisible}
                onDismiss={() => this.setState({ recordInputMenuVisible: false })}
                anchor={
                    <TouchableOpacity
                        onPress={() => this.setState({ recordInputMenuVisible: true })}
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            paddingVertical: 8,
                            paddingHorizontal: 14,
                            borderWidth: 1,
                            borderColor: '#888',
                            borderRadius: 8,
                        }}
                    >
                        <MaterialCommunityIcon name={selIcon} size={18} color="#fff" />
                        <Text style={{ marginLeft: 8, marginRight: 6, color: '#fff' }}>{selName}</Text>
                        <MaterialCommunityIcon name="chevron-down" size={18} color="#fff" />
                    </TouchableOpacity>
                }
            >
                {devices.map((d) => {
                    const isSel = sel && d.type === sel.type;
                    return (
                        <Menu.Item
                            key={d.id || d.type}
                            icon={d.icon}
                            title={isSel ? `✓ ${d.name}` : d.name}
                            onPress={() => this.selectRecordInput(d)}
                        />
                    );
                })}
            </Menu>
        );
    }

    deleteAudio() {
        this.setState({recordingFile: null,
					   recordingDuration: 0,
                       recording: false,
                       previewRecording: false,
                       recordingPeaks: [],
                       recordingSpectrum: null});
        // Drop any in-flight spectrum capture if the user deletes a
        // take mid/after recording without sending.
        try { SpectrumRecorder.stop(); } catch (e) {}

        if (this.props.selectedContact) {
			this.props.getMessages(this.props.selectedContact.uri);
		}
    }

	stopRecordingTimer() {
		//console.log('Ready box: stopRecordingTimer');
		if (this.recordingStopTimer !== null) {
		    clearTimeout(this.recordingStopTimer);
			this.recordingStopTimer = null;
		}
	}
        
    async onStartRecord () {
        // NB: we used to call SoundLevel.start() here to drive the
        // VuMeter, but on iOS react-native-sound-level and
        // react-native-audio-recorder-player both create AVAudioRecorder
        // instances on the shared AVAudioSession, and iOS refuses to
        // start a second one — startRecorder() below then fails with
        // "Error occured during initiating recorder" while Android (which
        // uses separate AudioRecord vs MediaRecorder backends) happily
        // runs both. The recorder already emits the same dBFS level via
        // addRecordBackListener's currentMetering, so we drive the
        // VuMeter from that single source instead and keep the mic
        // exclusive to the recorder.

        try {
            // Compressed AAC (M4A) recording — voice memos used to
            // ship as 16 kHz mono 16-bit PCM WAV (~32 KB/s = ~1.9 MB
            // per minute). Compressed AAC at ~32 kbps is ~4 KB/s
            // (~240 KB per minute) — an 8× reduction with no audible
            // quality loss for speech, and the file is playable
            // everywhere natively (AVFoundation on iOS, MediaPlayer
            // on Android, every browser, every desktop player).
            //
            // The recorder is shared with the playback path
            // (audioRecorderPlayer is the same module-level instance)
            // — that's fine because record and play never overlap in
            // time: we record, stop, then optionally play back from
            // the saved file.
            //
            // Path: cache dir + sylk-audio-recording.m4a. We pass an
            // explicit path so the file always ends in .m4a — Android's
            // default ends in .mp4 which file2GiftedChat would route
            // through the isVideo branch (msg.video = filepath) instead
            // of msg.audio = filepath, breaking bubble rendering and
            // playback. iOS already defaults to .m4a but we set it
            // explicitly there too for symmetry.
            // IMPORTANT: prefix with file:// on iOS. react-native-audio-
            // recorder-player's setAudioFileURL() only treats a string as
            // a literal file path when it starts with file://, http://, or
            // https:// — anything else is fed through
            // cachesDirectory.appendingPathComponent(), which percent-
            // encodes the slashes in an already-absolute path and yields
            // a non-existent URL like
            // file:///.../Caches/%2Fvar%2Fmobile%2F.../sylk-audio-
            // recording.m4a. AVAudioRecorder.prepareToRecord() then
            // returns false (the smoking gun in the metro log was
            // "prepareToRecord returned false"). Android's
            // implementation is path-agnostic so we add the prefix on
            // iOS only to keep the existing Android-side behavior
            // untouched.
            const rawRecordingPath = `${RNFS.CachesDirectoryPath}/sylk-audio-recording.m4a`;
            const recordingPath = Platform.OS === 'ios'
                ? `file://${rawRecordingPath}`
                : rawRecordingPath;
            const audioSet = {
                // iOS — AAC in an .m4a container at 16 kHz mono.
                AVFormatIDKeyIOS: AVEncodingOption.aac,
                AVSampleRateKeyIOS: 16000,
                AVNumberOfChannelsKeyIOS: 1,
                AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.medium,
                AVEncoderBitRateKeyIOS: 32000,
                // Android — AAC in an MP4 container at 16 kHz mono.
                AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
                AudioSourceAndroid: AudioSourceAndroidType.MIC,
                OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
                AudioSamplingRateAndroid: 16000,
                AudioChannelsAndroid: 1,
                AudioEncodingBitRateAndroid: 32000,
            };

            // Reset per-recording peak accumulator. Same shape /
            // granularity Android's SylkCallRecorder uses (per-100ms
            // 0..255 peak per channel) so the receiver's bubble
            // renders the waveform with no special handling for
            // "regular voice memo" vs "call recording". Driven by
            // currentMetering (dBFS) from addRecordBackListener —
            // metering ticks roughly every 100 ms with the loudest
            // sample seen since the previous tick, mapped to 0..255
            // so it slots straight into the existing peaks pipeline.
            this._micPeaks = [];

            // ---- pre-flight diagnostics ----
            // The native iOS module throws a static "Error occured
            // during initiating recorder" string for *any* failure
            // inside [recorder prepareToRecord] or AVAudioSession
            // setup, which makes the JS-side message useless on its
            // own. Log the things that most often go wrong on iOS so
            // the metro log tells us which one it is:
            //   - mic permission (DENIED/BLOCKED/UNAVAILABLE all
            //     present at native layer as a prepareToRecord
            //     failure, not a permission error)
            //   - cache path exists & is writable (a stale directory
            //     or a path the sandbox can't open also surfaces as a
            //     prepareToRecord failure)
            //   - whether any previous recording is still on disk at
            //     the same path (some iOS versions refuse to
            //     overwrite a locked file).
            try {
                if (Platform.OS === 'ios') {
                    const micPerm = await checkPermission(RNP_PERMISSIONS.IOS.MICROPHONE);
                    console.log('[recorder] iOS mic permission =', micPerm,
                        '(granted=', micPerm === RNP_RESULTS.GRANTED, ')');
                } else if (Platform.OS === 'android') {
                    const micPerm = await checkPermission(RNP_PERMISSIONS.ANDROID.RECORD_AUDIO);
                    console.log('[recorder] android mic permission =', micPerm);
                }
            } catch (permErr) {
                console.log('[recorder] permission check threw', permErr && permErr.message);
            }
            try {
                const cacheDir = RNFS.CachesDirectoryPath;
                const dirExists = await RNFS.exists(cacheDir);
                // RNFS uses native filesystem paths (no scheme), so the
                // pre-flight checks run against rawRecordingPath, not
                // the file://-prefixed `recordingPath` we hand to the
                // recorder.
                const fileExists = await RNFS.exists(rawRecordingPath);
                let fileStat = null;
                if (fileExists) {
                    try { fileStat = await RNFS.stat(rawRecordingPath); } catch (_e) {}
                }
                console.log('[recorder] cacheDir =', cacheDir,
                    'exists=', dirExists,
                    'targetExists=', fileExists,
                    'targetSize=', fileStat && fileStat.size,
                    'targetMTime=', fileStat && fileStat.mtime);
                // If a leftover file is sitting at the target path,
                // remove it before we try to start — that's a known
                // trigger on iOS where AVAudioRecorder.prepareToRecord
                // returns NO if the file is locked by something else
                // (e.g. an unreleased AVAudioPlayer from a prior
                // playback) and the native module surfaces that as
                // "Error occured during initiating recorder".
                if (fileExists) {
                    try {
                        await RNFS.unlink(rawRecordingPath);
                        console.log('[recorder] removed stale recording at target path');
                    } catch (unlinkErr) {
                        console.log('[recorder] failed to remove stale recording:',
                            unlinkErr && unlinkErr.message);
                    }
                }
            } catch (fsErr) {
                console.log('[recorder] fs pre-flight threw', fsErr && fsErr.message);
            }

            // iOS only: ask SylkAudioRouteModule to release the
            // shared AVAudioSession before the recorder lib tries to
            // claim it. See ios/sylk/AudioRouteModule.m
            // prepareForRecording for the full rationale — the short
            // version is that the session is held in PlayAndRecord +
            // VoiceChat at app init for VOIP, which engages voice-
            // processing IO and causes AVAudioRecorder.record() to
            // return NO (the exact failure we were hitting). This
            // helper deactivates the session with
            // NotifyOthersOnDeactivation so the recorder lib's own
            // setCategory(mode:.default) + setActive(true) actually
            // takes the input route. We restore in onStopRecord.
            if (Platform.OS === 'ios' && SylkAudioRouteModule && SylkAudioRouteModule.prepareForRecording) {
                try {
                    await SylkAudioRouteModule.prepareForRecording();
                    console.log('[recorder] prepareForRecording ok');
                } catch (prepErr) {
                    // Non-fatal — if the native helper is missing or
                    // fails, we still try to start the recorder. The
                    // worst case is the same failure we had before.
                    console.log('[recorder] prepareForRecording failed (continuing):',
                        prepErr && prepErr.message);
                }
            }

            // Android: engage the input device the user selected on the armed
            // screen BEFORE the recorder opens the mic, so the take is captured
            // from that device. For a headset (BT/wired/USB) the native helper
            // routes capture via setCommunicationDevice (API 31+) and waits
            // until the route is active; for the built-in mic it releases any
            // communication device. Returns {engaged, type, name}. Best-effort
            // — any failure falls back to the built-in mic.
            // Android: engage the input device the user selected on the armed
            // screen BEFORE the recorder opens the mic, so the take is captured
            // from that device. Best-effort — any failure (or a route that
            // never reports active) falls back to the built-in mic.
            //
            // The native call is wrapped in a timeout race: if
            // setRecordingInputDevice never settles, Start would otherwise
            // hang forever on the "Starting…" spinner (recording=true is
            // never reached). The race guarantees we proceed to startRecorder
            // within ROUTE_ENGAGE_TIMEOUT_MS regardless, using the built-in
            // mic when the selected route didn't confirm in time.
            let engagedInput = null;
            if (Platform.OS === 'android'
                    && SylkAudioRouteModule
                    && SylkAudioRouteModule.setRecordingInputDevice) {
                const sel = this.state.selectedRecordInput || { type: 'BUILTIN_MIC' };
                const ROUTE_ENGAGE_TIMEOUT_MS = 4000;
                try {
                    const res = await Promise.race([
                        SylkAudioRouteModule.setRecordingInputDevice({
                            type: sel.type,
                            id: sel.id || '',
                        }),
                        new Promise((resolve) => setTimeout(() => resolve(null), ROUTE_ENGAGE_TIMEOUT_MS)),
                    ]);
                    if (res === null) {
                        console.log('[recorder] setRecordingInputDevice timed out — using built-in mic');
                    } else {
                        console.log('[recorder] setRecordingInputDevice:', JSON.stringify(res));
                        if (res && res.type && res.engaged) {
                            engagedInput = {
                                type: res.type,
                                name: res.name,
                                icon: utils.inputDeviceIconsMap[res.type] || 'microphone',
                            };
                        }
                    }
                } catch (inErr) {
                    console.log('[recorder] setRecordingInputDevice failed (using built-in):',
                        inErr && inErr.message);
                }
            }

            // Start the spectrogram analyser BEFORE the recorder so it
            // is already warmed up by the time audio capture begins.
            // Previously this was started after startRecorder() resolved,
            // so the analyser's warm-up window (its first few frames sit
            // at the noise floor) overlapped the start of the audio —
            // which rendered as "no levels at the beginning" on playback.
            // Best-effort — no-op if the analyser isn't available (e.g.
            // iOS mic tap disabled). The mic analyser runs at the fixed
            // 1-16 kHz scale. markStart() below anchors the capture to
            // the exact audio start so the warm-up frames are dropped.
            try {
                await SpectrumRecorder.startMic({
                    fLow: 1000, fHigh: 16000, ticks: [1, 2, 4, 8, 12, 16],
                });
            } catch (specErr) {
                console.log('[recorder] spectrum capture start failed:',
                    specErr && specErr.message);
            }

            console.log('[recorder] startRecorder ->', recordingPath, 'platform=', Platform.OS);
            const startResult = await audioRecorderPlayer.startRecorder(recordingPath, audioSet, true);
            console.log('[recorder] startRecorder ok, native path =', startResult);
            // Audio is now flowing — anchor the spectrum timeline here so
            // frame 0 lines up with audio t=0 and the analyser warm-up
            // frames captured above are discarded on stop().
            try { SpectrumRecorder.markStart(); } catch (_e) {}
            // Anchor the peaks timeline to the SAME instant as the spectrum
            // (markStart above). onStopRecord resamples _micPeaks onto a
            // uniform grid measured from here — dropping pre-anchor warm-up
            // and spanning the full clip — exactly like SpectrumRecorder does
            // for the spectrogram. Sharing the anchor + span is what makes the
            // waveform and the spectrum line up frame-for-frame on playback.
            this._peaksT0 = Date.now();
            audioRecorderPlayer.addRecordBackListener((e) => {
                // currentMetering is in dBFS (typically -160..0) on
                // iOS / Android. Treat -50 dB as the noise floor so
                // ambient room tone doesn't clip the bottom of the
                // waveform; anything quieter folds to 0. Loudest
                // possible (0 dB) maps to 255.
                const db = (typeof e.currentMetering === 'number')
                    ? e.currentMetering
                    : -160;
                const NOISE_FLOOR_DB = -50;
                const norm = Math.max(0, Math.min(1, (db - NOISE_FLOOR_DB) / -NOISE_FLOOR_DB));
                // Timestamp each peak so onStopRecord can resample onto the
                // same uniform grid as the spectrum (see _peaksT0 anchor).
                this._micPeaks.push({ t: Date.now(), v: Math.round(norm * 255) });
                // Drive the live VuMeter from the same metering tick.
                // Previously this came from SoundLevel.onNewFrame, but
                // that conflicted with the recorder on iOS (see note in
                // onStartRecord above). `norm` is already 0..1 with the
                // same -50 dB noise floor, so it slots straight in.
                // Also surface the elapsed duration the recorder reports
                // (currentPosition is ms since record() returned true on
                // iOS / since prepareRecorder on Android, ticking ~every
                // 100 ms) so the live counter under the VuMeter stays in
                // lockstep with what's actually being written to disk.
                const elapsed = (typeof e.currentPosition === 'number')
                    ? Math.max(0, Math.floor(e.currentPosition))
                    : 0;
                this.setState({ level: norm, recordingElapsedMs: elapsed });
            });

			// Flip recording=true AND drop the armed/starting flags in the same
			// setState so there's a single atomic transition from the armed
			// screen to the recording screen — no intermediate render where the
			// chat view (gated on recording || recordArmed) reappears.
			this.setState({
				recording: true,
				recordArmed: false,
				recordStarting: false,
				recordingElapsedMs: 0,
				// The mic actually capturing this take — the device we engaged
				// above (the user's selection, or built-in on fallback). Shown
				// under the live spectrum.
				recordingInputDevice: engagedInput
					|| this.state.selectedRecordInput
					|| { type: 'BUILTIN_MIC', name: 'Built-in microphone', icon: 'microphone' },
			});

			// 30s auto-stop timer removed per user request — the user
			// stays in the recording screen as long as they want and
			// stops the recording explicitly via the stop button.
			// Previously this fired onStopRecord() after 30 seconds
			// which capped voice messages and surprised users
			// composing longer notes.

			this.props.vibrate();

        } catch (e) {
            // Start failed — drop the "Starting…" spinner so the user isn't
            // stuck on it. Keep recordArmed true so the armed screen (with the
            // Start/Cancel buttons) is restored and they can retry.
            this.setState({ recordStarting: false });
            // The native iOS module throws a hard-coded
            // "Error occured during initiating recorder" string for
            // *every* AVAudioSession / AVAudioRecorder failure, so
            // e.message alone tells us nothing. Dump everything React
            // Native's NSError->JS bridge gives us — code, domain,
            // userInfo, nativeStackIOS, and the JS-side stack — so
            // the metro log actually tells us which underlying
            // failure (busy session, missing entitlement, locked
            // file, sandbox path, hardware route change) we're
            // looking at.
            try {
                console.log('[recorder] startRecorder FAILED');
                console.log('[recorder]   message =', e && e.message);
                console.log('[recorder]   code    =', e && e.code);
                console.log('[recorder]   domain  =', e && e.domain);
                console.log('[recorder]   name    =', e && e.name);
                if (e && e.userInfo) {
                    try { console.log('[recorder]   userInfo =', JSON.stringify(e.userInfo)); }
                    catch (_je) { console.log('[recorder]   userInfo (raw) =', e.userInfo); }
                }
                if (e && e.nativeStackIOS) {
                    console.log('[recorder]   nativeStackIOS =', e.nativeStackIOS);
                }
                if (e && e.nativeStackAndroid) {
                    console.log('[recorder]   nativeStackAndroid =', e.nativeStackAndroid);
                }
                if (e && e.stack) {
                    console.log('[recorder]   js stack =', e.stack);
                }
                // Last resort — enumerate own props in case the
                // module is returning something exotic.
                try {
                    const keys = e ? Object.getOwnPropertyNames(e) : [];
                    if (keys.length) {
                        const dump = {};
                        keys.forEach((k) => { try { dump[k] = e[k]; } catch (_ke) {} });
                        console.log('[recorder]   full =', JSON.stringify(dump));
                    }
                } catch (_de) {}
            } catch (logErr) {
                console.log('[recorder] (failure logging itself threw)', logErr && logErr.message);
            }
            // Failure path: we already called prepareForRecording (which
            // deactivated the VoIP session) but startRecorder threw, so
            // onStopRecord will never run and the session would stay
            // deactivated. Restore it here so a subsequent call comes up
            // in VoIP mode normally.
            if (Platform.OS === 'ios' && SylkAudioRouteModule && SylkAudioRouteModule.restoreAfterRecording) {
                try {
                    await SylkAudioRouteModule.restoreAfterRecording();
                    console.log('[recorder] restoreAfterRecording ok (after failure)');
                } catch (restErr) {
                    console.log('[recorder] restoreAfterRecording failed (after failure):',
                        restErr && restErr.message);
                }
            }
            // Android: tear down the Bluetooth SCO link if we engaged it for
            // this recording (no-op otherwise). Restores the prior audio mode.
            if (Platform.OS === 'android' && SylkAudioRouteModule && SylkAudioRouteModule.restoreAfterBluetoothInputRecording) {
                try {
                    await SylkAudioRouteModule.restoreAfterBluetoothInputRecording();
                    console.log('[recorder] BT input restore ok (after failure)');
                } catch (btRestErr) {
                    console.log('[recorder] BT input restore failed (after failure):',
                        btRestErr && btRestErr.message);
                }
            }
        }
    };

    stopRecording() {
        //console.log('Stop recording by user...');
        this.onStopRecord();
    }

    async onStopRecord () {
        // Stop the recording-duration ticker immediately so the
        // header doesn't keep counting while stopRecorder() resolves.
        // We deliberately do NOT setState({recording:false}) here —
        // that would cause an intermediate render where neither
        // `recording` nor `recordingFile` is set, which the chat
        // (ContactsListBox: chatMessages = [] when either is set) would
        // misread as "no recording in progress" and momentarily flash
        // the previous chat history into view before the next setState
        // hides it again. Instead we do one combined setState below
        // that flips recording=false AND recordingFile=result in the
        // same render pass — no flash.
        this.stopRecordingTimer();
        let result = null;
        try {
            result = await audioRecorderPlayer.stopRecorder();
            // stopRecorder returns audioFileURL.absoluteString on iOS,
            // which is file://-prefixed. Strip the scheme so the value
            // stored in state.recordingFile matches Android (bare path)
            // and the rest of the app's downstream consumers
            // (file2GiftedChat, audio bubble playback, the
            // file://-prefix check at line ~1381) don't have to second-
            // guess the format. We always know the path is a local
            // file because we constructed it from RNFS.CachesDirectoryPath
            // in onStartRecord.
            if (typeof result === 'string' && result.startsWith('file://')) {
                result = result.substring('file://'.length);
            }
        } catch (e) {
            console.log('stopRecorder error', e && e.message);
        }
        try { audioRecorderPlayer.removeRecordBackListener(); } catch (_e) {}
        const rawPeaks = (this._micPeaks || []).slice();
        this._micPeaks = null;
        // Duration used for BOTH the peaks grid and the spectrum grid so the
        // two share an identical timeline (anchor _peaksT0 == spectrum t0,
        // same span, uniform grid) → waveform and spectrum stay aligned.
        const durMs = this.state.recordingElapsedMs || 0;
        // Resample the timestamped peaks onto a uniform 20 Hz grid anchored at
        // _peaksT0, dropping pre-anchor warm-up and spanning the full clip —
        // the scalar analogue of SpectrumRecorder's resample. Falls back to
        // raw values if timestamps are absent (older capture path).
        const finalPeaks = this._resamplePeaksToGrid(rawPeaks, this._peaksT0 || 0, durMs, 20);
        this._peaksT0 = 0;
        // Finalise the spectrogram capture started in onStartRecord and
        // keep it next to the peaks so the preview + the sent message
        // can animate the spectrum on playback. Null if nothing was
        // captured (analyser unavailable / very short take).
        let finalSpectrum = null;
        try {
            // Hand the recorder's last reported elapsed time to stop() as
            // the clip duration so the spectrum is resampled to cover the
            // whole recording (no frozen tail) rather than only up to the
            // last captured frame. Read before the reset setState below.
            finalSpectrum = await SpectrumRecorder.stop(durMs);
        } catch (specErr) {
            console.log('[recorder] spectrum capture stop failed:',
                specErr && specErr.message);
        }
        // Single combined setState — flips recording=false AND
        // installs the recordingFile + peaks in the same render so
        // ContactsListBox's "hide chat while recordingFile is set"
        // gate stays true the whole way through. See the no-flash
        // note at the top of this method. `level: 0` is folded into
        // the same setState (instead of being a separate call after
        // audioRecorded) so the VuMeter resets without forcing the
        // extra render the no-flash comment warns about. SoundLevel.stop()
        // is no longer needed — see the note in onStartRecord for why
        // SoundLevel was dropped entirely.
        this.setState({
            recording: false,
            recordingFile: result,
            recordingPeaks: finalPeaks,
            recordingSpectrum: finalSpectrum,
            recordingInputDevice: null,
            recordArmed: false,
            recordStarting: false,
            selectedRecordInput: null,
            recordInputMenuVisible: false,
            level: 0,
            // Clear the live counter so the meter+counter pair start
            // clean on the next recording. recordingDuration (set by
            // audioRecorded after Sound() reads the finished file) is
            // a separate value used by the preview UI, so we don't
            // touch it here.
            recordingElapsedMs: 0,
        });
        this.audioRecorded(result);
        // Paired with prepareForRecording in onStartRecord — restore
        // PlayAndRecord + VoiceChat so the next call comes up cleanly.
        // No-op on Android, and safe to call even if prepareForRecording
        // failed (the native side no-ops without a saved snapshot).
        if (Platform.OS === 'ios' && SylkAudioRouteModule && SylkAudioRouteModule.restoreAfterRecording) {
            try {
                await SylkAudioRouteModule.restoreAfterRecording();
                console.log('[recorder] restoreAfterRecording ok');
            } catch (restErr) {
                console.log('[recorder] restoreAfterRecording failed:',
                    restErr && restErr.message);
            }
        }
        // Android: tear down the Bluetooth SCO link if we engaged it for
        // this recording (no-op otherwise). Restores the prior audio mode.
        if (Platform.OS === 'android' && SylkAudioRouteModule && SylkAudioRouteModule.restoreAfterBluetoothInputRecording) {
            try {
                await SylkAudioRouteModule.restoreAfterBluetoothInputRecording();
                console.log('[recorder] BT input restore ok');
            } catch (btRestErr) {
                console.log('[recorder] BT input restore failed:',
                    btRestErr && btRestErr.message);
            }
        }
    };

    async audioRecorded(file) {
        if (file) {
            console.log('Audio recording ready to send', file);
            try {
				const sound = new Sound(file, '', (error) => {
				  if (error) {
					console.log('Failed to load the audio', error);
					return;
				  }
				  // Keep the precise length (the label floors it for
				  // display; AudioTimeScale needs the exact value so its
				  // markers line up with the slider/waveform).
				  const duration = sound.getDuration();
				  this.setState({recordingDuration: duration});
			    });
			} catch (e) {
				console.log('error', e);
			}
			// Note: recording=false / recordingFile=file are already
			// set in the combined setState at the end of onStopRecord
			// — no duplicate setState here, since that would force an
			// extra render and we want the transition to be a single
			// atomic render to avoid flashing the chat history.
        }
    }

    render() {
        const activityTitle = this.state.recording ? "Recording audio" : "Audio recording ready";
        return (
            <Fragment>
                    { this.state.recordArmed && !this.state.recording ?
                        <View style={styles.recordingContainer}>
                            <View style={{borderBottom: 30}}>
                                <Title style={styles.activityTitle}>Audio recording</Title>
                            </View>
                            <View style={{ marginTop: 16, alignSelf: 'center', alignItems: 'center' }}>
                                {this.state.recordStarting ? (
                                    // Transition: Start pressed, route engaging,
                                    // capture about to begin. Keeps the chat
                                    // hidden and avoids a flash back to it.
                                    <View style={{ alignItems: 'center', marginTop: 8 }}>
                                        <ActivityIndicator size="large" />
                                        <Text style={{ color: '#ccc', marginTop: 12 }}>Starting…</Text>
                                    </View>
                                ) : (
                                    <React.Fragment>
                                        <Text style={{ color: '#ccc', marginBottom: 8 }}>Input device</Text>
                                        {this.renderRecordInputSelector()}
                                        <Button
                                            mode="contained"
                                            icon="microphone"
                                            style={{ marginTop: 24 }}
                                            onPress={() => this.startArmedRecording()}
                                        >
                                            Start recording
                                        </Button>
                                        <Button
                                            mode="text"
                                            style={{ marginTop: 8 }}
                                            onPress={() => this.cancelArming()}
                                        >
                                            Cancel
                                        </Button>
                                    </React.Fragment>
                                )}
                            </View>
                        </View>
                    : null}

                    { this.state.recording  ?
                        <View style={styles.recordingContainer}>
                            <View style={{borderBottom: 30}}>
                                <Title style={styles.activityTitle}>{activityTitle}</Title>
                            </View>
                            {/* Live VU meter — same widget the in-call
                                AudioCallBox uses for the live mic
                                level. Replaces the old vertical green
                                bar. Fixed 280 px width so it centres
                                cleanly via alignSelf — percentage
                                widths inside flex column parents
                                were rendering off-centre. */}
                            <View style={{ marginTop: 16, alignSelf: 'center' }}>
                                <VuMeter
                                    level={this.state.level || 0}
                                    label="Recording"
                                    width={280}
                                />
                                {/* Live local-mic spectrum (16 log bands).
                                    Mounted only while recording, so the
                                    native 48 kHz AudioRecord tap runs only
                                    during a take. Bands reach ~24 kHz —
                                    the mic's TRUE bandwidth — even though
                                    the sent .m4a is 16 kHz (≤8 kHz). Android
                                    only; iOS keeps it at floor. */}
                                <View style={{ marginTop: 10 }}>
                                    <MicSpectrumBars
                                        active={this.state.recording}
                                        width={280}
                                        height={64}
                                        label="Mic spectrum"
                                    />
                                    {/* Active recording device — which mic this
                                        take is actually capturing from. Resolved
                                        in onStartRecord via getAudioInputs(); shown
                                        only while recording. */}
                                    {this.state.recording && this.state.recordingInputDevice ? (
                                        <View style={{
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            marginTop: 6,
                                            opacity: 0.6,
                                        }}>
                                            <MaterialCommunityIcon
                                                name={this.state.recordingInputDevice.icon}
                                                size={13}
                                                color="#ccc"
                                            />
                                            <Text style={{ fontSize: 11, marginLeft: 5, color: '#ccc' }}>
                                                {this.state.recordingInputDevice.name}
                                            </Text>
                                        </View>
                                    ) : null}
                                </View>
                                {/* Live elapsed-time counter, driven by
                                    audioRecorderPlayer's currentPosition
                                    (see addRecordBackListener in
                                    onStartRecord). monospace + tabular
                                    numerals so the digits don't jitter
                                    horizontally as they tick. Same 280 px
                                    width as the VuMeter so the two read
                                    as a single unit. */}
                                <Text style={{
                                    marginTop: 8,
                                    width: 280,
                                    textAlign: 'center',
                                    fontVariant: ['tabular-nums'],
                                    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                                    fontSize: 18,
                                    color: red[500],
                                }}>
                                    {(() => {
                                        const ms = this.state.recordingElapsedMs || 0;
                                        const totalSec = Math.floor(ms / 1000);
                                        const m = Math.floor(totalSec / 60);
                                        const s = totalSec % 60;
                                        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                                    })()}
                                </Text>
                            </View>
                        </View>
                    : null
                    }

                    { this.state.recordingFile  ?
                        <View style={styles.recordingContainer}>
                            <Title style={styles.activityTitle}>{activityTitle}</Title>
                            {(() => {
                                // Mirror the chat bubble's outgoing audio
                                // bubble layout exactly: a white rounded
                                // pill with the duration label on top,
                                // the single-channel waveform, and the
                                // slider stacked underneath, with the
                                // play button anchored on the right.
                                // What the user sees here is the same
                                // thing the recipient sees once the
                                // file lands in the chat.
                                //
                                // We render this whenever recordingFile
                                // is set — regardless of whether peaks
                                // have landed yet — so there's no flash
                                // while peaks finish snapshotting.
                                // AudioWaveform handles an empty peaks
                                // array by rendering a flat dim baseline
                                // so the layout doesn't flinch.
                                // Duration in ms — prefer the player's value once
                                // playback has reported it, else fall back to the
                                // recorded length so the slider/scale/seek all work
                                // before the first play.
                                const dur = this.state.currentDurationSec
                                    || (this.state.recordingDuration ? this.state.recordingDuration * 1000 : 0);
                                const pos = this.state.currentPositionSec || 0;
                                // Position-based fill — NOT gated on previewRecording,
                                // so a seeked/paused position holds instead of the
                                // levels snapping back to 0 on release.
                                const progress = dur > 0
                                    ? Math.max(0, Math.min(100, (pos / dur) * 100))
                                    : 0;
                                const isPlaying = this.state.previewRecording;
                                const sliderWidth = 240;
                                // While the user drags the slider, track the drag
                                // percentage live so the waveform + spectrum
                                // highlight follow the finger instead of only the
                                // playback position. Cleared on release.
                                const scrubbing = (this.state.previewScrubPct != null);
                                const wfProgress = scrubbing ? this.state.previewScrubPct : progress;
                                // Spectrum position in seconds — follow the drag
                                // when scrubbing, else the live playback position.
                                const durSec = (this.state.recordingDuration
                                    || (dur > 0 ? dur / 1000 : 0)) || 0;
                                const specPosSec = scrubbing
                                    ? (this.state.previewScrubPct / 100) * durSec
                                    : (this.state.currentPositionSec || 0) / 1000;
                                // Bubble palette mirrors the outgoing
                                // GiftedChat audio bubble exactly: no
                                // fill (transparent), 0.5px white border,
                                // 16px radius, white text/slider/waveform.
                                // See ChatBubble.js's audio branch
                                // (currentMessage.audio) — same wrapper
                                // styling, just transposed onto a plain
                                // View since this preview lives outside
                                // the GiftedChat row.
                                return (
                                    <View style={{
                                        alignSelf: 'center',
                                        marginTop: 4,
                                        backgroundColor: 'transparent',
                                        borderRadius: 16,
                                        borderWidth: 0.5,
                                        borderColor: 'white',
                                        paddingVertical: 8,
                                        paddingHorizontal: 12,
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                    }}>
                                        <View style={{
                                            flexDirection: 'column',
                                            alignItems: 'flex-end',
                                            justifyContent: 'center',
                                            paddingRight: 8,
                                        }}>
                                            {/* "Recording of X" title removed —
                                                the clip length now lives in the
                                                seconds scale caption below. */}
                                            {/* Spectrum ABOVE the level meter so
                                                the spectral view sits on top of
                                                the amplitude bars (matches the
                                                chat bubble layout). */}
                                            {this.state.recordingSpectrum ? (
                                                <SpectrumPlayback
                                                    spectrum={this.state.recordingSpectrum}
                                                    positionSec={specPosSec}
                                                    width={sliderWidth}
                                                    height={40}
                                                    label="Spectrum"
                                                />
                                            ) : null}
                                            <AudioWaveform
                                                peaks={{ l: this.state.recordingPeaks || [], r: [] }}
                                                progress={wfProgress}
                                                width={sliderWidth}
                                                height={28}
                                                barCount={60}
                                                channel="l"
                                                playedColor="orange"
                                                unplayedColor="rgba(255,255,255,0.35)"
                                            />
                                            {/* "Levels" caption — matches the
                                                spectrum caption font so the two
                                                strips read consistently. */}
                                            <View style={{ flexDirection: 'row', justifyContent: 'flex-start', width: sliderWidth }}>
                                                <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)' }}>Levels</Text>
                                            </View>
                                            <AudioProgressSlider
                                                progress={wfProgress}
                                                width={sliderWidth}
                                                height={4}
                                                knobWidth={6}
                                                knobHeight={20}
                                                color={"#ffffff"}
                                                unfilledColor="rgba(255,255,255,0.3)"
                                                knobColor={"#ffffff"}
                                                onSeekStart={() => {
                                                    if (this.state.previewRecording) {
                                                        try { audioRecorderPlayer.pausePlayer(); } catch (_e) {}
                                                    }
                                                }}
                                                onSeekChange={(pct) => {
                                                    // Live drag — drive the waveform/spectrum highlight.
                                                    this.setState({ previewScrubPct: pct });
                                                }}
                                                onSeek={(pct) => {
                                                    if (dur > 0) {
                                                        const ms = (pct / 100) * dur;
                                                        try {
                                                            audioRecorderPlayer.seekToPlayer(ms);
                                                            if (this.state.previewRecording) {
                                                                audioRecorderPlayer.resumePlayer();
                                                            }
                                                        } catch (_e) {}
                                                        // Reflect the seeked position so the
                                                        // waveform/spectrum/slider hold there
                                                        // instead of snapping back to 0 when the
                                                        // scrub override is cleared.
                                                        this.setState({ currentPositionSec: ms, previewScrubPct: null });
                                                    } else {
                                                        this.setState({ previewScrubPct: null });
                                                    }
                                                }}
                                            />
                                            {/* Seconds scale under the slider
                                                (5 markers; hidden under 3s),
                                                with the duration caption — same
                                                as the chat bubble so preview and
                                                bubble match. */}
                                            <AudioTimeScale
                                                width={sliderWidth}
                                                durationSec={this.state.recordingDuration || 0}
                                            />
                                        </View>
                                        {/* Play/pause button — same shape
                                            and palette as the bubble's
                                            playButton in
                                            ContactsListBox.renderMessageAudio
                                            (TouchableHighlight wrapper at
                                            48×48 with 24 radius hosting
                                            an IconButton with the blue
                                            `playAudioButton` style). */}
                                        <TouchableHighlight
                                            onPress={isPlaying ? this.pausePreviewAudio : this.previewAudio}
                                            underlayColor="transparent"
                                            style={[
                                                {
                                                    height: 48,
                                                    width: 48,
                                                    justifyContent: 'center',
                                                    borderRadius: 24,
                                                    alignSelf: 'flex-end',
                                                    marginLeft: 0,
                                                },
                                            ]}>
                                            <IconButton
                                                size={28}
                                                onPress={isPlaying ? this.pausePreviewAudio : this.previewAudio}
                                                style={{
                                                    backgroundColor: 'rgba(69, 114, 166, 1)',
                                                    marginLeft: 0,
                                                    marginRight: 0,
                                                }}
                                                iconColor="white"
                                                icon={isPlaying ? 'pause' : 'play'}
                                            />
                                        </TouchableHighlight>
                                    </View>
                                );
                            })()}
                        </View>

                    : null
                    }

                    {/* Chat message playback — reuses the same player card
                        (spectrum + waveform + slider + play/pause) as the
                        recording preview, but sourced from a chat message's
                        file. Rendered here (outside GiftedChat) so the chat
                        list is unmounted during playback and can't churn. */}
                    { this.state.msgPlayback ?
                        <Modal
                            transparent
                            visible
                            animationType="fade"
                            onRequestClose={this.stopMessageAudio}
                        >
                            {/* Dim backdrop over the still-mounted chat. Tapping
                                it dismisses (same as Back) so the chat returns
                                exactly where it was. */}
                            <TouchableOpacity
                                activeOpacity={1}
                                onPress={this.stopMessageAudio}
                                style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' }}
                            >
                                {/* Card — stop propagation so taps on the player
                                    don't dismiss the modal. */}
                                <TouchableOpacity activeOpacity={1} onPress={() => {}}>
                            <Title style={styles.activityTitle}>{this.state.msgPlayback.title}</Title>
                            {this.state.msgPlayback.createdAt ? (
                                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', marginTop: -6, marginBottom: 16 }}>
                                    {(() => {
                                        try {
                                            const d = new Date(this.state.msgPlayback.createdAt);
                                            if (isNaN(d.getTime())) return '';
                                            return d.toLocaleDateString() + '  ' +
                                                d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                        } catch (_e) { return ''; }
                                    })()}
                                </Text>
                            ) : null}
                            {(() => {
                                const src = this.state.msgPlayback;
                                const dur = this.state.currentDurationSec
                                    || (src.durationSec ? src.durationSec * 1000 : 0);
                                const pos = this.state.currentPositionSec || 0;
                                const progress = dur > 0
                                    ? Math.max(0, Math.min(100, (pos / dur) * 100))
                                    : 0;
                                const isPlaying = this.state.msgPlaying;
                                const sliderWidth = 240;
                                const scrubbing = (this.state.previewScrubPct != null);
                                const wfProgress = scrubbing ? this.state.previewScrubPct : progress;
                                const durSec = (src.durationSec || (dur > 0 ? dur / 1000 : 0)) || 0;
                                const specPosSec = scrubbing
                                    ? (this.state.previewScrubPct / 100) * durSec
                                    : pos / 1000;
                                return (
                                    <View style={{
                                        alignSelf: 'center',
                                        marginTop: 4,
                                        backgroundColor: 'transparent',
                                        borderRadius: 16,
                                        borderWidth: 0.5,
                                        borderColor: 'white',
                                        paddingVertical: 8,
                                        paddingHorizontal: 12,
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                    }}>
                                        <View style={{
                                            flexDirection: 'column',
                                            alignItems: 'flex-end',
                                            justifyContent: 'center',
                                            paddingRight: 8,
                                        }}>
                                            {src.spectrum ? (
                                                <SpectrumPlayback
                                                    spectrum={src.spectrum}
                                                    /* Drive the spectrum off the SAME 0..1 fraction the
                                                       waveform uses (wfProgress is 0..100). With no
                                                       durationSec, frameAtProgress maps the fraction
                                                       across ALL spectrum frames — identical to how
                                                       AudioWaveform maps progress across its peaks — so
                                                       the two stay locked. positionSec was time-based
                                                       (sec×10fps) and drifted when the frame count didn't
                                                       match the player-reported duration. */
                                                    progress={wfProgress / 100}
                                                    width={sliderWidth}
                                                    height={80}
                                                    label="Spectrum"
                                                />
                                            ) : null}
                                            {(() => {
                                                // Two amplitude waveforms for a stereo (call) recording —
                                                // Remote on top, Local underneath — matching the old chat
                                                // bubble. A single-channel voice memo (peaks.r empty) shows
                                                // one strip with a "Levels" caption.
                                                const pk = src.peaks || { l: [], r: [] };
                                                const hasL = Array.isArray(pk.l) && pk.l.length > 0;
                                                const hasR = Array.isArray(pk.r) && pk.r.length > 0;
                                                const stereo = hasL && hasR;
                                                if (!hasL && !hasR) {
                                                    // No peaks at all — draw one flat baseline so the layout
                                                    // doesn't flinch.
                                                    return (
                                                        <React.Fragment>
                                                            <AudioWaveform peaks={pk} progress={wfProgress} width={sliderWidth} height={28} barCount={60} channel="l" playedColor="orange" unplayedColor="rgba(255,255,255,0.35)" />
                                                            <View style={{ flexDirection: 'row', justifyContent: 'flex-start', width: sliderWidth }}>
                                                                <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)' }}>Levels</Text>
                                                            </View>
                                                        </React.Fragment>
                                                    );
                                                }
                                                return (
                                                    <React.Fragment>
                                                        {hasR ? (
                                                            <AudioWaveform
                                                                peaks={pk}
                                                                progress={wfProgress}
                                                                width={sliderWidth}
                                                                height={28}
                                                                barCount={60}
                                                                channel="r"
                                                                label={stereo ? 'Remote' : null}
                                                                labelColor="rgba(255,255,255,0.55)"
                                                                playedColor="#3498db"
                                                                unplayedColor="rgba(52, 152, 219, 0.25)"
                                                            />
                                                        ) : null}
                                                        {hasL ? (
                                                            <AudioWaveform
                                                                peaks={pk}
                                                                progress={wfProgress}
                                                                width={sliderWidth}
                                                                height={28}
                                                                barCount={60}
                                                                channel="l"
                                                                label={stereo ? 'Local' : null}
                                                                labelColor="rgba(255,255,255,0.55)"
                                                                playedColor="#2ecc71"
                                                                unplayedColor="rgba(46, 204, 113, 0.25)"
                                                            />
                                                        ) : null}
                                                        {!stereo ? (
                                                            <View style={{ flexDirection: 'row', justifyContent: 'flex-start', width: sliderWidth }}>
                                                                <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)' }}>Levels</Text>
                                                            </View>
                                                        ) : null}
                                                    </React.Fragment>
                                                );
                                            })()}
                                            <AudioProgressSlider
                                                progress={wfProgress}
                                                width={sliderWidth}
                                                height={4}
                                                knobWidth={6}
                                                knobHeight={20}
                                                color={"#ffffff"}
                                                unfilledColor="rgba(255,255,255,0.3)"
                                                knobColor={"#ffffff"}
                                                onSeekStart={() => {
                                                    if (this.state.msgPlaying) {
                                                        try { audioRecorderPlayer.pausePlayer(); } catch (_e) {}
                                                    }
                                                }}
                                                onSeekChange={(pct) => {
                                                    this.setState({ previewScrubPct: pct });
                                                }}
                                                onSeek={(pct) => {
                                                    if (dur > 0) {
                                                        const ms = (pct / 100) * dur;
                                                        try {
                                                            audioRecorderPlayer.seekToPlayer(ms);
                                                            if (this.state.msgPlaying) {
                                                                audioRecorderPlayer.resumePlayer();
                                                            }
                                                        } catch (_e) {}
                                                        // Rebase the wall clock so playback position continues
                                                        // from the seeked spot (position is wall-clock driven,
                                                        // not from the crawling currentPosition).
                                                        this._msgBaseMs = ms;
                                                        this._msgWall = Date.now();
                                                        this.setState({ currentPositionSec: ms, previewScrubPct: null });
                                                    } else {
                                                        this.setState({ previewScrubPct: null });
                                                    }
                                                }}
                                            />
                                            <AudioTimeScale
                                                width={sliderWidth}
                                                durationSec={durSec}
                                            />
                                        </View>
                                        {/* Play/pause */}
                                        <TouchableHighlight
                                            onPress={this.toggleMsgPlayPause}
                                            underlayColor="transparent"
                                            style={[{
                                                height: 48, width: 48, justifyContent: 'center',
                                                borderRadius: 24, alignSelf: 'flex-end', marginLeft: 0,
                                            }]}>
                                            <IconButton
                                                size={28}
                                                onPress={this.toggleMsgPlayPause}
                                                style={{ backgroundColor: 'rgba(69, 114, 166, 1)', marginLeft: 0, marginRight: 0 }}
                                                iconColor="white"
                                                icon={isPlaying ? 'pause' : 'play'}
                                            />
                                        </TouchableHighlight>
                                    </View>
                                );
                            })()}
                            {/* Back → stop playback and return to the chat
                                (dismissing the modal leaves the chat exactly
                                where it was — it was only dimmed, not unmounted). */}
                            <Button
                                mode="contained"
                                icon="keyboard-backspace"
                                buttonColor="rgba(69, 114, 166, 1)"
                                textColor="white"
                                style={{ marginTop: 20, alignSelf: 'center' }}
                                onPress={this.stopMessageAudio}
                            >
                                Back
                            </Button>
                                </TouchableOpacity>
                            </TouchableOpacity>
                        </Modal>
                    : null
                    }
            </Fragment>
        );
    }
}

export default AudioRecorder;
