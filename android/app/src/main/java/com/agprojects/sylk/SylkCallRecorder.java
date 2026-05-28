package com.agprojects.sylk;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.MediaRecorder;
import android.util.Log;

import org.webrtc.AudioTrack;
import org.webrtc.AudioTrackSink;
import org.webrtc.MediaStreamTrack;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Records a WebRTC audio call to a STEREO Opus-encoded OGG file
 * with the local mic on the left channel and the remote leg on the
 * right channel — so each side of the conversation is recoverable
 * independently.
 *
 * REMOTE leg: tapped via libwebrtc's AudioTrackSink on the remote
 * AudioTrack — fires post-decode in 10 ms chunks at the negotiated
 * sample rate (48 kHz on a typical Opus call). Sink callbacks run on
 * the libwebrtc audio thread; we copy into a fresh short[] and offer
 * onto a bounded queue.
 *
 * LOCAL leg (mic): captured via Android's system AudioRecord with the
 * VOICE_COMMUNICATION source. We can NOT use AudioTrackSink for the
 * mic because libwebrtc captures mic audio via the ADM (Audio Device
 * Module) and pushes it straight into the encoder, bypassing the
 * track's sink mechanism — addSink on a local track is a silent
 * no-op. AudioRecord runs in its own thread, reading 10 ms slices and
 * pushing them onto the same kind of bounded queue.
 *
 * A separate writer thread pops one chunk from each queue per
 * iteration and INTERLEAVES them into stereo PCM frames: [L=mic,
 * R=remote, L=mic, R=remote, ...]. No mixing is done — keeping the
 * two parties on independent channels is the whole point. The
 * interleaved PCM is fed into a MediaCodec Opus encoder configured
 * for 2 channels at 16 kHz / ~36 kbps, then muxed into an OGG
 * container via MediaMuxer (MUXER_OUTPUT_OGG, API 29+). Final size
 * is on the order of ~4–5 KB/s for stereo voice — still tiny
 * compared to a raw stereo PCM WAV (~64 KB/s) and trivially
 * downloadable, with each side cleanly separable in post.
 *
 * One recording at a time; held as a static instance so the JS bridge
 * can match start/stop without juggling handles.
 *
 * Requires the upstream Google WebRTC Android build (e.g.
 * io.github.webrtc-sdk:android) — the Jitsi org.jitsi:webrtc fork
 * does not expose AudioTrackSink in its public Java API.
 *
 * Min Android: API 29 for MediaMuxer.OutputFormat.MUXER_OUTPUT_OGG +
 * MediaCodec Opus encoder. The project's minSdk is well above that.
 */
public class SylkCallRecorder {
    // The metro-logs.sh script filters logcat strictly on tag
    // `SYLK_APP`; everything else is dropped. So the tag is uniform
    // and the per-class marker lives in the message body — keeps
    // the captured log readable while letting the script use a
    // single tag filter.
    private static final String TAG = "SYLK_APP";

    // Per-sink queue depth. 200 chunks * 10 ms = 2 s of latency budget
    // before we start dropping. The writer thread should drain much
    // faster than that under normal conditions.
    private static final int QUEUE_CAPACITY = 200;

    private static SylkCallRecorder sInstance;

    public static synchronized SylkCallRecorder getInstance() {
        if (sInstance == null) sInstance = new SylkCallRecorder();
        return sInstance;
    }

    private final AtomicBoolean mRunning = new AtomicBoolean(false);
    private AudioTrack mRemoteTrack;
    private RemoteSink mRemoteSink;

    private BlockingQueue<short[]> mMicQ;
    private BlockingQueue<short[]> mRemoteQ;
    private Thread mWriterThread;

    // Conference-mix mode (N remote tracks summed into the R channel,
    // mic on L). Sibling to the 1-to-1 mode that uses mRemoteTrack /
    // mRemoteSink / mRemoteQ. When mIsConference is true the writer
    // loop uses _pollMixedRemote() instead of mRemoteQ.poll(), which
    // polls each per-remote queue once and sums them with int16
    // clip-guard into a single mixed chunk before pairing with mic.
    //
    // Lookup is keyed by participantId (any string the JS layer hands
    // us — typically the sylkrtc Participant.id). Each entry owns one
    // RemoteSink attached to the matching AudioTrack and one bounded
    // queue identical in shape to mRemoteQ. Adding / removing
    // participants mid-recording is just a map mutation under the
    // mConferenceLock — the writer loop snapshots the values list per
    // iteration so it never deadlocks against a concurrent
    // addConferenceRemote / removeConferenceRemote call.
    private boolean mIsConference = false;
    private final Object mConferenceLock = new Object();
    private final Map<String, ConferenceRemote> mConferenceRemotes = new ConcurrentHashMap<>();

    // Output rate: 16 kHz, STEREO with mic on L and remote on R so
    // each side of the conversation lands on its own channel — useful
    // for transcription, post-processing, and debugging. Opus natively
    // supports 8/12/16/24/48 kHz; 16 kHz is plenty for voice and
    // matches what AudioRecord captures + what the remote sink
    // decimates down to. Bitrate bumped for stereo: ~36 kbps total.
    private static final int OUTPUT_SAMPLE_RATE = 16000;
    private static final int OUTPUT_CHANNELS = 2;
    private static final int MIC_FRAMES_PER_CHUNK = OUTPUT_SAMPLE_RATE / 100; // 10 ms = 160
    private static final int OPUS_BITRATE_BPS = 36000;
    private AudioRecord mMicRecord;
    private Thread mMicThread;

    private String mPath;
    // Opus encoder + OGG muxer state. The encoder takes raw 16-bit
    // PCM mono at OUTPUT_SAMPLE_RATE, the muxer wraps the encoded
    // packets into an OGG bitstream on disk.
    private MediaCodec mEncoder;
    private MediaMuxer mMuxer;
    private int mTrackIndex = -1;
    private boolean mMuxerStarted = false;
    private long mPresentationTimeUs = 0;
    // Reused per-iteration scratch — avoids per-tick allocation on
    // the writer thread.
    private final MediaCodec.BufferInfo mEncoderInfo = new MediaCodec.BufferInfo();
    // Coarse rate-limiter for "queue full" warnings so logcat
    // doesn't drown if a sink queue saturates briefly.
    private long mDropCounter = 0;

    // Peak-amplitude tracking for the playback VU meter.
    //
    // We capture per-channel peak in 100 ms bins (10 × 10 ms chunks)
    // while the writer loop runs, then downsample to ≤ MAX_PEAKS
    // entries at stop() so the JSON we ship in message metadata
    // stays small regardless of call length. Each entry is 0..255
    // (the short-int sample peak scaled to one byte).
    //
    // For a 60 s call we end up with 600 raw bins → ≤ 600 entries
    // shipped (~3 KB JSON). For a 1 h call we'd have 36 000 raw
    // bins, downsampled to 1000 entries (each one a max-pool of
    // 36 raw bins) → ~6 KB JSON.
    private static final int PEAK_BIN_CHUNKS = 10;          // 10 × 10 ms = 100 ms
    private static final int MAX_PEAKS       = 1000;        // cap on emitted entries
    private ArrayList<Integer> mPeaksLocal;
    private ArrayList<Integer> mPeaksRemote;
    private int mPeakAccumLocal  = 0;   // running peak within current 100 ms bin
    private int mPeakAccumRemote = 0;
    private int mPeakBinChunks   = 0;   // 10 ms chunks folded into the current bin
    // Snapshot of the peaks JSON computed at stop() so the bridge
    // can read it AFTER stop() has cleared the live arrays.
    private String mLastPeaksJson;

    /**
     * Begin recording.
     *
     * `micTrack` is accepted in the API for symmetry with the JS side
     * but we DON'T attach a WebRTC sink to it — it would never fire.
     * Instead we open a parallel Android AudioRecord on the
     * VOICE_COMMUNICATION mic source and read PCM directly. WebRTC
     * keeps its own AudioRecord on the same source; on every
     * mainstream Android the kernel mic path is multi-consumer-safe,
     * so we get our own copy of the post-AGC/AEC PCM stream.
     *
     * `remoteTrack` is sunk via libwebrtc's AudioTrackSink — that
     * fires post-decode and is the right place to grab the far end.
     *
     * Returns true on success. Returns false only if the remote track
     * isn't an AudioTrack and we'd be recording silence — caller
     * treats that as a "fall back to mic-only via AudioRecord" signal.
     */
    public synchronized boolean start(MediaStreamTrack micTrack,
                                      MediaStreamTrack remoteTrack,
                                      String outputPath) throws IOException {
        if (mRunning.get()) {
            throw new IllegalStateException("Recorder already running");
        }
        AudioTrack remote = (remoteTrack instanceof AudioTrack) ? (AudioTrack) remoteTrack : null;
        if (remote == null) {
            // Without a remote track to sink, the WebRTC half of this
            // recorder has nothing to do. Let the JS side fall back to
            // its own AudioRecord-only capture path.
            return false;
        }

        mPath = outputPath;
        mPresentationTimeUs = 0;
        mTrackIndex = -1;
        mMuxerStarted = false;
        // Reset peak tracking so a new recording starts with empty
        // arrays (a previous run's data is shipped in mLastPeaksJson
        // until the next stop overwrites it).
        mPeaksLocal      = new ArrayList<>(600);
        mPeaksRemote     = new ArrayList<>(600);
        mPeakAccumLocal  = 0;
        mPeakAccumRemote = 0;
        mPeakBinChunks   = 0;

        // Set up the Opus encoder + OGG muxer. The encoder accepts
        // any chunk size of 16-bit PCM and emits Opus frames of its
        // own pacing; the muxer doesn't get its track added until
        // we receive INFO_OUTPUT_FORMAT_CHANGED on the first drain
        // (that's when MediaCodec hands us the populated MediaFormat
        // including the Opus header / pre-skip / etc.).
        try {
            MediaFormat fmt = MediaFormat.createAudioFormat(
                MediaFormat.MIMETYPE_AUDIO_OPUS,
                OUTPUT_SAMPLE_RATE,
                OUTPUT_CHANNELS /* stereo: L=mic, R=remote */);
            fmt.setInteger(MediaFormat.KEY_BIT_RATE, OPUS_BITRATE_BPS);
            fmt.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
            mEncoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS);
            mEncoder.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            mEncoder.start();
            mMuxer = new MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_OGG);
        } catch (Throwable t) {
            SylkLogger.e("[call] [recorder] Encoder/muxer setup failed: " + t.getMessage());
            try { if (mEncoder != null) { mEncoder.release(); } } catch (Throwable ignore) {}
            try { if (mMuxer != null) { mMuxer.release(); } } catch (Throwable ignore) {}
            mEncoder = null;
            mMuxer = null;
            throw new IOException("Opus encoder setup failed: " + t.getMessage());
        }

        mMicQ = new ArrayBlockingQueue<>(QUEUE_CAPACITY);
        mRemoteQ = new ArrayBlockingQueue<>(QUEUE_CAPACITY);

        mRemoteTrack = remote;
        mRemoteSink = new RemoteSink();
        mRemoteTrack.addSink(mRemoteSink);

        // Set up the mic AudioRecord. Buffer size: at least the system
        // minimum, ideally 4 chunks worth so the read loop has slack.
        final int channelCfg = AudioFormat.CHANNEL_IN_MONO;
        final int encoding   = AudioFormat.ENCODING_PCM_16BIT;
        final int minBuf     = AudioRecord.getMinBufferSize(OUTPUT_SAMPLE_RATE, channelCfg, encoding);
        final int bufBytes   = Math.max(minBuf, MIC_FRAMES_PER_CHUNK * 2 * 4);
        try {
            mMicRecord = new AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                OUTPUT_SAMPLE_RATE, channelCfg, encoding, bufBytes);
            if (mMicRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                SylkLogger.w("[call] [recorder] AudioRecord did not initialize; mic side will be silent");
                try { mMicRecord.release(); } catch (Throwable t) {}
                mMicRecord = null;
            } else {
                mMicRecord.startRecording();
            }
        } catch (Throwable t) {
            SylkLogger.w("[call] [recorder] AudioRecord setup failed: " + t.getMessage()
                    + " — mic side will be silent");
            mMicRecord = null;
        }

        mRunning.set(true);

        if (mMicRecord != null) {
            mMicThread = new Thread(this::micLoop, "SylkCallRecorder-Mic");
            mMicThread.setPriority(Thread.NORM_PRIORITY + 1);
            mMicThread.start();
        }

        mWriterThread = new Thread(this::writerLoop, "SylkCallRecorder-Writer");
        mWriterThread.setPriority(Thread.NORM_PRIORITY + 1);
        mWriterThread.start();

        SylkLogger.i("[call] [recorder] Recording started: " + outputPath
                + " mic=" + (mMicRecord != null)
                + " remote=true");
        return true;
    }

    /**
     * Conference-mix variant of start(). Takes a list of remote audio
     * tracks instead of one — each one gets its own RemoteSink + queue,
     * and the writer loop sums them into the R channel before pairing
     * with mic on L. Output file is the same stereo Opus-OGG container
     * the 1-to-1 path produces, so the chat bubble plays it without
     * any changes.
     *
     * Late joiners come in via addConferenceRemote(); leavers via
     * removeConferenceRemote(). Both are idempotent and safe to call
     * any time after this returns true.
     *
     * Returns true on success. Returns false only if mic + all remotes
     * resolved to nothing useful — callers should fall back to
     * mic-only AAC capture in that case (same convention as start()).
     */
    public synchronized boolean startConference(MediaStreamTrack micTrack,
                                                List<RemoteEntry> remotes,
                                                String outputPath) throws IOException {
        if (mRunning.get()) {
            throw new IllegalStateException("Recorder already running");
        }
        // Filter the remote list to AudioTracks we can actually sink.
        // A null or empty list is allowed — recording can still proceed
        // with the mic alone, and the JS layer can attach remotes
        // afterwards via addConferenceRemote() as ontrack events fire.
        List<RemoteEntry> usable = new ArrayList<>();
        if (remotes != null) {
            for (RemoteEntry e : remotes) {
                if (e != null && e.track instanceof AudioTrack) usable.add(e);
            }
        }

        mPath = outputPath;
        mPresentationTimeUs = 0;
        mTrackIndex = -1;
        mMuxerStarted = false;
        mPeaksLocal      = new ArrayList<>(600);
        mPeaksRemote     = new ArrayList<>(600);
        mPeakAccumLocal  = 0;
        mPeakAccumRemote = 0;
        mPeakBinChunks   = 0;
        mIsConference    = true;
        mConferenceRemotes.clear();

        // Same encoder + muxer setup as start() — split into a helper
        // so both modes share exactly one copy. Throws IOException on
        // failure; we leave mIsConference set so the caller's catch
        // block can call stop() / cleanup uniformly.
        _setupEncoderAndMuxer(outputPath);

        mMicQ = new ArrayBlockingQueue<>(QUEUE_CAPACITY);
        // mRemoteQ stays null in conference mode — the writer loop's
        // _pollMixedRemote() reads directly from each ConferenceRemote
        // queue, no shared mixed queue in between.
        mRemoteQ = null;
        mRemoteTrack = null;
        mRemoteSink = null;

        for (RemoteEntry e : usable) {
            _addConferenceRemoteLocked(e);
        }

        // Mic AudioRecord setup is identical to start(); reuse the
        // helper so the VOICE_COMMUNICATION source + buffer sizing
        // logic only lives in one place.
        _setupMic();

        mRunning.set(true);
        if (mMicRecord != null) {
            mMicThread = new Thread(this::micLoop, "SylkCallRecorder-Mic");
            mMicThread.setPriority(Thread.NORM_PRIORITY + 1);
            mMicThread.start();
        }
        mWriterThread = new Thread(this::writerLoop, "SylkCallRecorder-Writer");
        mWriterThread.setPriority(Thread.NORM_PRIORITY + 1);
        mWriterThread.start();

        SylkLogger.i("[call] [recorder] Conference recording started: " + outputPath
                + " mic=" + (mMicRecord != null)
                + " initialRemotes=" + usable.size());
        return true;
    }

    /** Attach a remote audio track mid-recording. Returns true if a
     *  new ConferenceRemote was created, false if the participantId
     *  is already tracked or the track isn't an AudioTrack. */
    public boolean addConferenceRemote(RemoteEntry entry) {
        if (!mRunning.get() || !mIsConference) return false;
        if (entry == null || entry.participantId == null) return false;
        if (!(entry.track instanceof AudioTrack)) return false;
        synchronized (mConferenceLock) {
            if (mConferenceRemotes.containsKey(entry.participantId)) return false;
            _addConferenceRemoteLocked(entry);
        }
        return true;
    }

    /** Detach a remote participant by id. Their sink is removed and
     *  their queue drains naturally — no further chunks land for that
     *  participant after this returns. Idempotent. */
    public boolean removeConferenceRemote(String participantId) {
        if (!mRunning.get() || !mIsConference) return false;
        if (participantId == null) return false;
        synchronized (mConferenceLock) {
            ConferenceRemote r = mConferenceRemotes.remove(participantId);
            if (r == null) return false;
            try {
                if (r.track != null && r.sink != null) {
                    r.track.removeSink(r.sink);
                }
            } catch (Throwable ignore) {}
            r.sink = null;
            r.track = null;
            SylkLogger.i("[call] [recorder] removeConferenceRemote: pid=" + participantId);
        }
        return true;
    }

    /** Shared encoder/muxer setup — called from both start() and
     *  startConference(). Same MediaCodec Opus encoder, same OGG
     *  MediaMuxer, same OUTPUT_SAMPLE_RATE / OUTPUT_CHANNELS. */
    private void _setupEncoderAndMuxer(String outputPath) throws IOException {
        try {
            MediaFormat fmt = MediaFormat.createAudioFormat(
                MediaFormat.MIMETYPE_AUDIO_OPUS,
                OUTPUT_SAMPLE_RATE,
                OUTPUT_CHANNELS);
            fmt.setInteger(MediaFormat.KEY_BIT_RATE, OPUS_BITRATE_BPS);
            fmt.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
            mEncoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS);
            mEncoder.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            mEncoder.start();
            mMuxer = new MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_OGG);
        } catch (Throwable t) {
            SylkLogger.e("[call] [recorder] Encoder/muxer setup failed: " + t.getMessage());
            try { if (mEncoder != null) { mEncoder.release(); } } catch (Throwable ignore) {}
            try { if (mMuxer != null) { mMuxer.release(); } } catch (Throwable ignore) {}
            mEncoder = null;
            mMuxer = null;
            throw new IOException("Opus encoder setup failed: " + t.getMessage());
        }
    }

    /** Shared mic setup — pulls AudioRecord parameters into one place
     *  so both start() and startConference() get the same VOICE_COMMUNICATION
     *  source and buffer sizing. */
    private void _setupMic() {
        final int channelCfg = AudioFormat.CHANNEL_IN_MONO;
        final int encoding   = AudioFormat.ENCODING_PCM_16BIT;
        final int minBuf     = AudioRecord.getMinBufferSize(OUTPUT_SAMPLE_RATE, channelCfg, encoding);
        final int bufBytes   = Math.max(minBuf, MIC_FRAMES_PER_CHUNK * 2 * 4);
        try {
            mMicRecord = new AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                OUTPUT_SAMPLE_RATE, channelCfg, encoding, bufBytes);
            if (mMicRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                SylkLogger.w("[call] [recorder] AudioRecord did not initialize; mic side will be silent");
                try { mMicRecord.release(); } catch (Throwable t) {}
                mMicRecord = null;
            } else {
                mMicRecord.startRecording();
            }
        } catch (Throwable t) {
            SylkLogger.w("[call] [recorder] AudioRecord setup failed: " + t.getMessage()
                    + " — mic side will be silent");
            mMicRecord = null;
        }
    }

    private void _addConferenceRemoteLocked(RemoteEntry e) {
        ConferenceRemote cr = new ConferenceRemote(
            e.participantId,
            (AudioTrack) e.track,
            new ArrayBlockingQueue<short[]>(QUEUE_CAPACITY)
        );
        cr.sink = new ConferenceRemoteSink(cr);
        cr.track.addSink(cr.sink);
        mConferenceRemotes.put(e.participantId, cr);
        SylkLogger.i("[call] [recorder] addConferenceRemote: pid=" + e.participantId);
    }

    /**
     * Mic capture loop. Reads 10 ms PCM slices from AudioRecord and
     * pushes a freshly-allocated short[] onto mMicQ. Drops chunks if
     * the queue is full (writer can't keep up — should be rare).
     */
    private void micLoop() {
        short[] buf = new short[MIC_FRAMES_PER_CHUNK];
        while (mRunning.get()) {
            AudioRecord rec = mMicRecord;
            if (rec == null) break;
            int got;
            try {
                got = rec.read(buf, 0, buf.length);
            } catch (Throwable t) {
                SylkLogger.w("[call] [recorder] AudioRecord.read threw: " + t.getMessage());
                break;
            }
            if (got <= 0) {
                // -1 = error, 0 = empty (before recording state) — back
                // off briefly and try again rather than spinning.
                try { Thread.sleep(5); } catch (InterruptedException ie) { break; }
                continue;
            }
            short[] chunk = new short[got];
            System.arraycopy(buf, 0, chunk, 0, got);
            if (!mMicQ.offer(chunk)) {
                if ((mDropCounter++ & 0x3F) == 0) {
                    SylkLogger.w("[call] [recorder] MicQ full, dropping chunk");
                }
            }
        }
    }

    /**
     * Stop the recorder, detach sinks, stop the mic AudioRecord,
     * drain queues, finalise the OGG container (flush remaining
     * encoder output + close the muxer). Idempotent — calling stop
     * on an already-stopped recorder is a no-op that returns the
     * most recently written path.
     */
    public synchronized String stop() {
        if (!mRunning.compareAndSet(true, false)) {
            SylkLogger.w("[call] [recorder] stop(): not running, returning last path " + mPath);
            return mPath;
        }

        try {
            if (mRemoteTrack != null && mRemoteSink != null) {
                try { mRemoteTrack.removeSink(mRemoteSink); } catch (Throwable t) {
                    SylkLogger.w("[call] [recorder] removeSink remote failed: " + t.getMessage());
                }
            }
        } finally {
            mRemoteSink = null;
            mRemoteTrack = null;
        }

        // Conference-mode cleanup. Each ConferenceRemote owns one
        // RemoteSink attached to its AudioTrack — detach them all here
        // before the writer thread is joined so no more chunks land on
        // queues we're about to drain. Errors are demoted to warnings
        // because tracks can race teardown when the user hangs up at
        // exactly the wrong moment.
        if (mIsConference) {
            synchronized (mConferenceLock) {
                for (ConferenceRemote r : mConferenceRemotes.values()) {
                    try {
                        if (r.track != null && r.sink != null) {
                            r.track.removeSink(r.sink);
                        }
                    } catch (Throwable t) {
                        SylkLogger.w("[call] [recorder] conference removeSink failed: " + t.getMessage());
                    }
                    r.sink = null;
                    r.track = null;
                }
                mConferenceRemotes.clear();
            }
            mIsConference = false;
        }

        // Mic AudioRecord teardown. Stop first (so the read loop bails
        // out), then release. The mic thread's loop already checks
        // mRunning and will exit on the next iteration.
        if (mMicRecord != null) {
            try { mMicRecord.stop(); } catch (Throwable t) {
                SylkLogger.w("[call] [recorder] AudioRecord.stop failed: " + t.getMessage());
            }
            try { mMicRecord.release(); } catch (Throwable t) {
                SylkLogger.w("[call] [recorder] AudioRecord.release failed: " + t.getMessage());
            }
            mMicRecord = null;
        }
        try {
            if (mMicThread != null) {
                mMicThread.interrupt();
                mMicThread.join(1000);
            }
        } catch (InterruptedException ignore) {
            Thread.currentThread().interrupt();
        }
        mMicThread = null;

        try {
            if (mWriterThread != null) {
                mWriterThread.interrupt();
                mWriterThread.join(2000);
            }
        } catch (InterruptedException ignore) {
            Thread.currentThread().interrupt();
        }
        mWriterThread = null;

        // Flush remaining encoder output and finalize the OGG file.
        try { drainEncoder(true); } catch (Throwable t) {
            SylkLogger.w("[call] [recorder] Encoder final drain failed: " + t.getMessage());
        }
        if (mEncoder != null) {
            try { mEncoder.stop(); } catch (Throwable t) { /* ignore */ }
            try { mEncoder.release(); } catch (Throwable t) { /* ignore */ }
            mEncoder = null;
        }
        if (mMuxer != null) {
            try {
                if (mMuxerStarted) {
                    mMuxer.stop();
                }
            } catch (Throwable t) {
                SylkLogger.w("[call] [recorder] Muxer stop failed: " + t.getMessage());
            }
            try { mMuxer.release(); } catch (Throwable t) { /* ignore */ }
            mMuxer = null;
        }
        mMuxerStarted = false;
        mTrackIndex = -1;
        mMicQ = null;
        mRemoteQ = null;

        // Flush any partial 100 ms bin so the last fraction of a
        // second isn't dropped, then build + cache the peaks JSON
        // for the bridge to read AFTER the live arrays are released.
        if (mPeakBinChunks > 0) {
            if (mPeaksLocal != null)  mPeaksLocal.add(mPeakAccumLocal  * 255 / 32767);
            if (mPeaksRemote != null) mPeaksRemote.add(mPeakAccumRemote * 255 / 32767);
            mPeakAccumLocal  = 0;
            mPeakAccumRemote = 0;
            mPeakBinChunks   = 0;
        }
        final int finalLocal  = mPeaksLocal  != null ? mPeaksLocal.size()  : -1;
        final int finalRemote = mPeaksRemote != null ? mPeaksRemote.size() : -1;
        mLastPeaksJson = buildPeaksJson(mPeaksLocal, mPeaksRemote);
        mLastPeaksLocalCount  = Math.max(0, finalLocal);
        mLastPeaksRemoteCount = Math.max(0, finalRemote);
        mPeaksLocal  = null;
        mPeaksRemote = null;

        SylkLogger.i("[call] [recorder] Recording stopped: " + mPath);
        return mPath;
    }

    /**
     * Returns the peaks captured during the most recent recording as
     * a compact JSON string of the form
     *     {"l":[v0,v1,...],"r":[v0,v1,...]}
     * where each v is 0..255 representing the per-100 ms peak amplitude
     * on that channel (l = mic / local, r = remote). Bin count is
     * downsampled to ≤ MAX_PEAKS so the wire envelope stays small.
     *
     * Returns null if no recording has been completed yet, or if the
     * recording produced zero bins (call < 100 ms — never emits).
     */
    public synchronized String getLastPeaksJson() {
        return mLastPeaksJson;
    }

    // Capture peak counts at stop time so the bridge can ferry them
    // back to JS for logging — the JS side's metro-logs script
    // doesn't see logcat, only console output.
    private int mLastPeaksLocalCount  = 0;
    private int mLastPeaksRemoteCount = 0;

    public synchronized int getLastPeaksLocalCount()  { return mLastPeaksLocalCount; }
    public synchronized int getLastPeaksRemoteCount() { return mLastPeaksRemoteCount; }

    /**
     * Build the JSON ourselves with StringBuilder rather than pulling
     * in org.json. Same shape as `getLastPeaksJson()` documents. Also
     * downsamples to MAX_PEAKS by max-pooling adjacent bins so a 1 h
     * call doesn't ship 36 000 entries.
     */
    private static String buildPeaksJson(ArrayList<Integer> local, ArrayList<Integer> remote) {
        if (local == null || remote == null) return null;
        if (local.isEmpty() && remote.isEmpty()) return null;
        int srcLen = Math.max(local.size(), remote.size());
        // Step = how many raw bins fold into one output entry. For
        // calls under MAX_PEAKS bins this stays at 1 (loss-free).
        int step = (srcLen + MAX_PEAKS - 1) / MAX_PEAKS;
        if (step < 1) step = 1;
        int outLen = (srcLen + step - 1) / step;

        StringBuilder sb = new StringBuilder(outLen * 8 + 16);
        sb.append("{\"l\":[");
        appendDownsampled(sb, local, step, outLen);
        sb.append("],\"r\":[");
        appendDownsampled(sb, remote, step, outLen);
        sb.append("]}");
        return sb.toString();
    }

    private static void appendDownsampled(StringBuilder sb, ArrayList<Integer> src,
                                          int step, int outLen) {
        if (src == null) return;
        final int n = src.size();
        for (int o = 0; o < outLen; o++) {
            int from = o * step;
            int to   = Math.min(n, from + step);
            int peak = 0;
            for (int i = from; i < to; i++) {
                int v = src.get(i);
                if (v > peak) peak = v;
            }
            if (o > 0) sb.append(',');
            sb.append(peak);
        }
    }

    /**
     * Writer loop: pair up chunks from the two queues 1:1 and mix.
     *
     * Why this matters: mic and remote producers fire on independent
     * threads at ~100 Hz (10 ms each). They arrive *near* simultaneously
     * but never exactly so — one always wins by a few ms. If we just
     * polled both queues non-blocking and wrote whatever was there, we'd
     * end up with alternating "mic + silence" and "silence + remote"
     * 10 ms slices instead of properly mixed slices. That sounds like
     * crackling / interruption because every other slice has only one
     * party's audio. The fix is to hold the chunk that arrived first
     * until its partner shows up, then mix them together.
     *
     * Hold-and-pair: pendingMic / pendingRem persist across iterations.
     * Each iteration we poll only the side(s) that are still empty,
     * with a short timeout so we tick at roughly 100 Hz. When both
     * pending slots are filled, we mix and feed a single aligned
     * chunk into the Opus encoder, then drain whatever's ready.
     *
     * Watchdog: if one side has been MIA for FLUSH_THRESHOLD_MS, we
     * flush whatever we have alone — this handles the case where the
     * remote has dropped or the mic has glitched mid-call without
     * stalling the recorder.
     */
    private void writerLoop() {
        final int POLL_MS = 15;
        final long FLUSH_THRESHOLD_MS = 200;
        ByteBuffer scratch = ByteBuffer.allocate(16384).order(ByteOrder.LITTLE_ENDIAN);

        short[] pendingMic = null;
        short[] pendingRem = null;
        long lastFlushMs = System.currentTimeMillis();

        while (mRunning.get() || pendingMic != null || pendingRem != null
                || !queuesEmpty()) {

            // Top up empty pending slots from each queue. Only poll the
            // side(s) we haven't already grabbed.
            //
            // In conference mode, instead of polling a single shared
            // remote queue we poll each per-participant queue once and
            // sum the results into one mixed remote chunk. From the
            // writer's perspective the rest of the loop is identical
            // — pendingRem is just "this iteration's R-channel PCM",
            // wherever it came from.
            try {
                if (pendingMic == null && mMicQ != null) {
                    pendingMic = mMicQ.poll(POLL_MS, TimeUnit.MILLISECONDS);
                }
                if (pendingRem == null) {
                    if (mIsConference) {
                        pendingRem = _pollMixedRemote(POLL_MS);
                    } else if (mRemoteQ != null) {
                        pendingRem = mRemoteQ.poll(POLL_MS, TimeUnit.MILLISECONDS);
                    }
                }
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                if (!mRunning.get()) break;
                continue;
            } catch (Throwable t) {
                break;
            }

            long now = System.currentTimeMillis();
            boolean haveBoth = (pendingMic != null && pendingRem != null);
            boolean haveOne  = (pendingMic != null || pendingRem != null);
            boolean watchdog = haveOne && (now - lastFlushMs > FLUSH_THRESHOLD_MS);

            // Wait for the partner unless we've waited long enough or
            // we've been told to stop and the other queue is dry too.
            if (!haveBoth && !watchdog
                    && mRunning.get()
                    && !queuesEmpty()) {
                continue;
            }
            if (!haveOne) {
                // Even with no PCM to feed, drain any pending encoder
                // output so the muxer keeps flowing — Opus encoder
                // emits frames asynchronously.
                drainEncoder(false);
                continue;
            }

            int n = 0;
            if (pendingMic != null) n = pendingMic.length;
            if (pendingRem != null && pendingRem.length > n) n = pendingRem.length;

            scratch.clear();
            int peakL = 0;
            int peakR = 0;
            // Stereo interleave: each output frame is [L, R] where
            // L = mic, R = remote. Missing side is silence (0). No
            // averaging across sides — keeping them on separate
            // channels is the whole point. While we're walking the
            // sample buffer anyway we track the peak (max abs) on
            // each channel — feeds the playback VU meter via
            // getPeaksJson() with no extra loop.
            for (int i = 0; i < n; i++) {
                int a = (pendingMic != null && i < pendingMic.length) ? pendingMic[i] : 0;
                int b = (pendingRem != null && i < pendingRem.length) ? pendingRem[i] : 0;
                if (a > 32767) a = 32767; if (a < -32768) a = -32768;
                if (b > 32767) b = 32767; if (b < -32768) b = -32768;
                int absA = a < 0 ? -a : a;
                int absB = b < 0 ? -b : b;
                if (absA > peakL) peakL = absA;
                if (absB > peakR) peakR = absB;
                scratch.putShort((short) a); // Left  = mic
                scratch.putShort((short) b); // Right = remote
            }
            // Fold this chunk's peak into the running 100 ms bin; flush
            // when we've accumulated PEAK_BIN_CHUNKS chunks worth.
            if (peakL > mPeakAccumLocal)  mPeakAccumLocal  = peakL;
            if (peakR > mPeakAccumRemote) mPeakAccumRemote = peakR;
            mPeakBinChunks++;
            if (mPeakBinChunks >= PEAK_BIN_CHUNKS) {
                // Scale 0..32767 → 0..255 so each entry fits in one
                // byte once we ship the JSON across.
                if (mPeaksLocal != null)  mPeaksLocal.add(mPeakAccumLocal  * 255 / 32767);
                if (mPeaksRemote != null) mPeaksRemote.add(mPeakAccumRemote * 255 / 32767);
                mPeakAccumLocal  = 0;
                mPeakAccumRemote = 0;
                mPeakBinChunks   = 0;
                // Log every 50 bins (~5 s) so we can confirm peaks are
                // accumulating without flooding logcat.
            }

            try {
                // 4 bytes per stereo frame: 2 channels × 2 bytes (16-bit)
                feedEncoder(scratch.array(), n * 2 * OUTPUT_CHANNELS);
                drainEncoder(false);
            } catch (Throwable t) {
                SylkLogger.e("[call] [recorder] Encode failed: " + t.getMessage());
                mRunning.set(false);
                break;
            }

            pendingMic = null;
            pendingRem = null;
            lastFlushMs = now;
        }
    }

    /**
     * Push raw 16-bit PCM bytes into the encoder. We keep dequeuing
     * input buffers until all bytes are queued — MediaCodec input
     * buffer capacity is implementation-defined, so a single chunk
     * may need multiple calls.
     */
    private void feedEncoder(byte[] pcmBytes, int len) {
        if (mEncoder == null || len <= 0) return;
        int offset = 0;
        while (offset < len) {
            int idx = mEncoder.dequeueInputBuffer(10_000);
            if (idx < 0) {
                // No buffer available right now; drain output so the
                // encoder can free input slots, then retry.
                drainEncoder(false);
                continue;
            }
            ByteBuffer in = mEncoder.getInputBuffer(idx);
            in.clear();
            int chunk = Math.min(in.remaining(), len - offset);
            in.put(pcmBytes, offset, chunk);
            // Presentation timestamp in microseconds, monotonically
            // increasing per input chunk based on how many sample
            // *frames* we've fed. A "frame" is one PCM sample across
            // all channels — so 2 bytes per channel × OUTPUT_CHANNELS
            // bytes per frame for 16-bit PCM.
            mEncoder.queueInputBuffer(idx, 0, chunk, mPresentationTimeUs, 0);
            long frames = chunk / (2L * OUTPUT_CHANNELS);
            mPresentationTimeUs += (frames * 1_000_000L) / OUTPUT_SAMPLE_RATE;
            offset += chunk;
        }
    }

    /**
     * Pull encoded packets from the encoder and write them to the
     * muxer. On the first INFO_OUTPUT_FORMAT_CHANGED we add the
     * audio track and start the muxer (the format includes the Opus
     * header / preskip / etc. — must come from the encoder's
     * post-config output format, not the input format we passed in).
     */
    private void drainEncoder(boolean endOfStream) {
        if (mEncoder == null) return;
        if (endOfStream) {
            try {
                int idx = mEncoder.dequeueInputBuffer(10_000);
                if (idx >= 0) {
                    mEncoder.queueInputBuffer(idx, 0, 0, mPresentationTimeUs,
                        MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                }
            } catch (Throwable t) {
                SylkLogger.w("[call] [recorder] EOS queue failed: " + t.getMessage());
            }
        }
        while (true) {
            int idx;
            try {
                idx = mEncoder.dequeueOutputBuffer(mEncoderInfo, 10_000);
            } catch (Throwable t) {
                SylkLogger.w("[call] [recorder] dequeueOutputBuffer threw: " + t.getMessage());
                break;
            }
            if (idx == MediaCodec.INFO_TRY_AGAIN_LATER) {
                if (!endOfStream) break;
                continue;
            }
            if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                if (mMuxerStarted) {
                    SylkLogger.w("[call] [recorder] Format changed twice — ignoring later one");
                    continue;
                }
                MediaFormat newFmt = mEncoder.getOutputFormat();
                try {
                    mTrackIndex = mMuxer.addTrack(newFmt);
                    mMuxer.start();
                    mMuxerStarted = true;
                } catch (Throwable t) {
                    SylkLogger.e("[call] [recorder] Muxer start failed: " + t.getMessage());
                    mRunning.set(false);
                    break;
                }
                continue;
            }
            if (idx < 0) continue;
            ByteBuffer out = mEncoder.getOutputBuffer(idx);
            if ((mEncoderInfo.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                // Opus codec-config bytes — already absorbed via the
                // INFO_OUTPUT_FORMAT_CHANGED handler. Skip writing
                // them as a sample.
                mEncoderInfo.size = 0;
            }
            if (mEncoderInfo.size > 0 && mMuxerStarted) {
                out.position(mEncoderInfo.offset);
                out.limit(mEncoderInfo.offset + mEncoderInfo.size);
                try {
                    mMuxer.writeSampleData(mTrackIndex, out, mEncoderInfo);
                } catch (Throwable t) {
                    SylkLogger.w("[call] [recorder] writeSampleData failed: " + t.getMessage());
                }
            }
            try { mEncoder.releaseOutputBuffer(idx, false); } catch (Throwable ignore) {}
            if ((mEncoderInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                break;
            }
        }
    }

    private boolean queuesEmpty() {
        boolean micEmpty = (mMicQ == null || mMicQ.isEmpty());
        if (!micEmpty) return false;
        if (mIsConference) {
            for (ConferenceRemote r : mConferenceRemotes.values()) {
                if (r.queue != null && !r.queue.isEmpty()) return false;
            }
            return true;
        }
        return (mRemoteQ == null || mRemoteQ.isEmpty());
    }

    /**
     * Conference-mode mixed-remote poll. Polls each per-participant
     * queue once (non-blocking after the first to keep the writer's
     * cadence near 100 Hz), sums the results into a single short[]
     * with int16 clip-guard, and returns it. Returns null if no
     * participant had anything within POLL_MS — caller treats that the
     * same way it treats a quiet single-remote queue.
     *
     * Sum length is the max chunk length across the participants —
     * shorter chunks are zero-padded so a participant whose codec
     * delivers fewer frames doesn't truncate the mix.
     */
    private short[] _pollMixedRemote(int firstPollMs) throws InterruptedException {
        // Snapshot the values list so a concurrent addConferenceRemote/
        // removeConferenceRemote (which mutates mConferenceRemotes
        // under mConferenceLock) doesn't trip a ConcurrentModification
        // here. ConcurrentHashMap.values() is weakly consistent so the
        // snapshot is cheap.
        ArrayList<ConferenceRemote> snapshot = new ArrayList<>(mConferenceRemotes.values());
        if (snapshot.isEmpty()) return null;

        // First poll waits up to firstPollMs so we don't spin when the
        // whole room is silent; subsequent polls are non-blocking so
        // the mix doesn't lag the slowest sender.
        short[][] chunks = new short[snapshot.size()][];
        int got = 0;
        int maxLen = 0;
        for (int i = 0; i < snapshot.size(); i++) {
            ConferenceRemote r = snapshot.get(i);
            if (r.queue == null) continue;
            short[] c = (i == 0)
                ? r.queue.poll(firstPollMs, TimeUnit.MILLISECONDS)
                : r.queue.poll();
            if (c != null) {
                chunks[i] = c;
                if (c.length > maxLen) maxLen = c.length;
                got++;
            }
        }
        if (got == 0 || maxLen == 0) return null;

        short[] mix = new short[maxLen];
        for (int i = 0; i < chunks.length; i++) {
            short[] c = chunks[i];
            if (c == null) continue;
            for (int j = 0; j < c.length; j++) {
                int sum = mix[j] + c[j];
                if (sum > 32767) sum = 32767;
                else if (sum < -32768) sum = -32768;
                mix[j] = (short) sum;
            }
        }
        return mix;
    }


    /**
     * Remote sink. Runs on the libwebrtc audio thread. Copy out into
     * a short[] (so the ByteBuffer the SDK reuses doesn't get
     * overwritten) and offer to the queue. offer() returns false if
     * full — drop the chunk and log occasionally so the writer can
     * catch up without flooding logcat.
     *
     * Note on signature: upstream Google WebRTC's AudioTrackSink.onData
     * has gone through two signatures over the years — a 5-arg version
     * (no timestamp) and a 6-arg version (with absoluteCaptureTimestampMs).
     * The webrtc-sdk M137 build uses the 6-arg signature. If your build
     * complains "method does not override", drop the last parameter.
     */
    private class RemoteSink implements AudioTrackSink {
        @Override
        public void onData(ByteBuffer audioData,
                           int bitsPerSample,
                           int sampleRate,
                           int numberOfChannels,
                           int numberOfFrames,
                           long absoluteCaptureTimestampMs) {
            if (!mRunning.get()) return;
            // Encoder is configured at OUTPUT_SAMPLE_RATE (16 kHz). The
            // remote sink delivers at whatever rate WebRTC negotiated
            // (48 kHz on Opus, 16 kHz on G.722, 8 kHz on PCMA/PCMU).
            // resampleTo() handles both directions — decimate for
            // higher-rate codecs, linear-interp upsample for the
            // 8 kHz narrowband ones — so the writer always sees
            // 16 kHz chunks on both sides ready to interleave into
            // stereo. Without the upsample branch, PCMA recordings
            // played back at 2× speed and sounded garbled.
            short[] mono = pcmToMono(audioData, bitsPerSample, numberOfChannels, numberOfFrames);
            if (mono == null) return;
            short[] chunk = resampleTo(mono, sampleRate, OUTPUT_SAMPLE_RATE);
            if (chunk == null || chunk.length == 0) return;
            if (!mRemoteQ.offer(chunk)) {
                if ((mDropCounter++ & 0x3F) == 0) {
                    SylkLogger.w("[call] [recorder] RemoteQ full, dropping chunk");
                }
            }
        }
    }

    /**
     * Resampler that handles both directions so the encoder always
     * sees OUTPUT_SAMPLE_RATE regardless of what the remote codec
     * negotiated.
     *
     * Downsampling (e.g. 48 kHz Opus → 16 kHz): integer-ratio decimate
     * with a 1-pole box filter (averages `ratio` consecutive input
     * samples). Crude but suppresses high-freq aliasing well enough
     * for voice.
     *
     * Upsampling (e.g. 8 kHz PCMA → 16 kHz): integer-ratio expand
     * with linear interpolation between adjacent input samples. For
     * voice, the spectrum above the source Nyquist is mostly silence
     * already (G.711 is band-limited), so a linear interp gives
     * acceptable quality without pulling in a polyphase FIR. Without
     * this branch the pre-existing `downsampleTo` returned the input
     * untouched and the encoder treated 8 kHz samples as 16 kHz —
     * audible as 2× speed garbled remote audio on PCMA / PCMU calls.
     *
     * Equal rates: pass-through (no copy).
     *
     * Non-integer ratios fall back to nearest-integer behaviour. In
     * practice WebRTC almost always delivers at 48 / 32 / 16 / 8 kHz,
     * which are all integer multiples (or divisors) of 16 kHz.
     */
    private static short[] resampleTo(short[] in, int inRate, int outRate) {
        if (in == null || in.length == 0) return in;
        if (inRate == outRate) return in;

        if (inRate > outRate) {
            // Downsample by integer ratio with simple averaging.
            int ratio = inRate / outRate;
            if (ratio < 1) ratio = 1;
            int outLen = in.length / ratio;
            if (outLen <= 0) return null;
            short[] out = new short[outLen];
            for (int i = 0; i < outLen; i++) {
                int sum = 0;
                int base = i * ratio;
                for (int j = 0; j < ratio; j++) {
                    sum += in[base + j];
                }
                out[i] = (short) (sum / ratio);
            }
            return out;
        }

        // Upsample by integer ratio with linear interpolation.
        int ratio = outRate / inRate;
        if (ratio < 2) return in;   // weird non-integer ratio — bail
        int outLen = in.length * ratio;
        short[] out = new short[outLen];
        for (int i = 0; i < in.length; i++) {
            int a = in[i];
            int b = (i + 1 < in.length) ? in[i + 1] : a;
            for (int j = 0; j < ratio; j++) {
                // Linear interp: out[i*ratio+j] = a + (b-a) * j/ratio
                int v = a + (b - a) * j / ratio;
                out[i * ratio + j] = (short) v;
            }
        }
        return out;
    }

    /**
     * Convert a sink's int16 PCM ByteBuffer into a freshly-allocated
     * mono short[]. If the input is stereo we average L+R; if mono we
     * just copy. We don't currently handle non-16-bit (libwebrtc has
     * been 16-bit since forever — log and skip if it ever changes).
     */
    // -----------------------------------------------------------------
    // Conference-mode helpers and data classes.
    // -----------------------------------------------------------------

    /** Input bundle for startConference() / addConferenceRemote(). */
    public static class RemoteEntry {
        public final MediaStreamTrack track;
        public final String participantId;
        public RemoteEntry(MediaStreamTrack track, String participantId) {
            this.track = track;
            this.participantId = participantId == null ? "" : participantId;
        }
    }

    /** One per remote audio track in conference mode. Owns the sink
     *  attached to the WebRTC AudioTrack and the per-track queue the
     *  sink offers PCM chunks into. The mixed-remote poll in
     *  _pollMixedRemote() pulls from queue, sums across all entries,
     *  and emits a single short[] for the writer loop. */
    private static class ConferenceRemote {
        final String participantId;
        AudioTrack track;
        ConferenceRemoteSink sink;
        final BlockingQueue<short[]> queue;
        ConferenceRemote(String pid, AudioTrack t, BlockingQueue<short[]> q) {
            this.participantId = pid;
            this.track = t;
            this.queue = q;
        }
    }

    /** Per-track sink for conference mode. Mirrors RemoteSink (the
     *  1-to-1 sink) but pushes into its owner's per-track queue
     *  instead of the shared mRemoteQ. Same resampling +
     *  pcmToMono pipeline so the writer's downstream code sees the
     *  same 16 kHz mono Int16 shape regardless of the negotiated
     *  source codec / rate. */
    private class ConferenceRemoteSink implements AudioTrackSink {
        final ConferenceRemote owner;
        ConferenceRemoteSink(ConferenceRemote o) { owner = o; }

        @Override
        public void onData(ByteBuffer audioData,
                           int bitsPerSample,
                           int sampleRate,
                           int numberOfChannels,
                           int numberOfFrames,
                           long absoluteCaptureTimestampMs) {
            if (!mRunning.get()) return;
            short[] mono = pcmToMono(audioData, bitsPerSample, numberOfChannels, numberOfFrames);
            if (mono == null) return;
            short[] chunk = resampleTo(mono, sampleRate, OUTPUT_SAMPLE_RATE);
            if (chunk == null || chunk.length == 0) return;
            if (owner.queue != null && !owner.queue.offer(chunk)) {
                if ((mDropCounter++ & 0x3F) == 0) {
                    SylkLogger.w("[call] [recorder] conf RemoteQ full pid="
                            + owner.participantId + ", dropping chunk");
                }
            }
        }
    }

    private static short[] pcmToMono(ByteBuffer data,
                                     int bitsPerSample,
                                     int channels,
                                     int frames) {
        if (bitsPerSample != 16) {
            SylkLogger.w("[call] [recorder] Unsupported bitsPerSample=" + bitsPerSample);
            return null;
        }
        if (channels < 1) return null;

        ByteBuffer src = data.order(ByteOrder.LITTLE_ENDIAN);
        short[] out = new short[frames];

        if (channels == 1) {
            for (int i = 0; i < frames; i++) {
                out[i] = src.getShort();
            }
        } else {
            for (int i = 0; i < frames; i++) {
                int sum = 0;
                for (int c = 0; c < channels; c++) sum += src.getShort();
                out[i] = (short) (sum / channels);
            }
        }
        return out;
    }
}
