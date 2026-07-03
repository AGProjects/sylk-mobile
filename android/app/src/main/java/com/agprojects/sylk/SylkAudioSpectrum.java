package com.agprojects.sylk;

import org.webrtc.AudioTrack;
import org.webrtc.AudioTrackSink;
import org.webrtc.MediaStreamTrack;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Live spectral analyser for the REMOTE leg of a call.
 *
 * Taps the decoded remote audio via libwebrtc's AudioTrackSink — the
 * SAME mechanism SylkCallRecorder uses for the recording's R channel —
 * but does NOT resample. The sink delivers PCM at the codec's native
 * rate (48 kHz Opus, 16 kHz G.722, 8 kHz PCMA/PCMU), so analysing the
 * frames here, before SylkCallRecorder's 16 kHz downsample, lets us
 * see the FULL bandwidth the remote actually sent. That's the whole
 * point: a 16 kHz-recorded WAV can never show whether the remote mic
 * is wideband (≤8 kHz) or fullband (≤24 kHz) — this can, because the
 * band edges scale to the live Nyquist (sampleRate / 2).
 *
 * Pipeline per sink callback:
 *   onData(int16 PCM @ nativeRate)
 *     -> downmix to mono float [-1, 1]
 *     -> append to a sliding window of FFT_SIZE samples (50% overlap)
 *     -> Hann window -> radix-2 FFT -> power spectrum
 *     -> integrate into NUM_BANDS log-spaced bands (F_LOW..Nyquist)
 *     -> 10*log10 -> dBFS-ish, throttled to ~EMIT_INTERVAL_MS
 *     -> BandsListener.onBands(db[NUM_BANDS], sampleRate)
 *
 * The FFT is a self-contained iterative Cooley–Tukey (no native libs,
 * no deps). At FFT_SIZE=2048 / ~25 Hz it's a few hundred µs per frame
 * on the WebRTC audio thread — negligible next to Opus decode.
 *
 * This class is independent of recording: you can run the analyser
 * during any call whether or not SylkCallRecorder is active. Adding a
 * second AudioTrackSink to the same remote AudioTrack is cheap and
 * supported (libwebrtc fans out to all attached sinks).
 */
public class SylkAudioSpectrum {

    private static final String TAG = "SYLK_APP";

    /** Number of log-spaced bands reported to JS. */
    public static final int NUM_BANDS = 16;

    /** FFT window length (power of two). 2048 @ 48 kHz ≈ 43 ms. */
    private static final int FFT_SIZE = 2048;

    /** Hop between successive FFTs — 50% overlap for smoother motion. */
    private static final int HOP = FFT_SIZE / 2;

    /** Display scale (Hz): 16 log-spaced bands from mFLowHz..mFHighHz.
     *  Set per session from the negotiated codec via start() so the
     *  bars "zoom" to the codec's band (Opus 2-16k, G.722 1-8k,
     *  G.711 0.5-4k). These are just the fallback defaults. */
    private double mFLowHz  = 1000.0;
    private double mFHighHz = 16000.0;

    /** Don't emit faster than this — caps bridge traffic (~25 fps). */
    private static final long EMIT_INTERVAL_MS = 40;

    /** Floor for the dB conversion so silence maps to a finite value. */
    private static final double DB_FLOOR = -120.0;

    public interface BandsListener {
        /**
         * @param dbBands    NUM_BANDS values, dBFS-ish (0 ≈ full scale,
         *                   negative = quieter; DB_FLOOR when empty).
         * @param sampleRate native codec rate of the analysed frames
         *                   (so JS can label the top band's frequency).
         */
        void onBands(float[] dbBands, int sampleRate);
    }

    private final AtomicBoolean mRunning = new AtomicBoolean(false);
    private AudioTrack mTrack;
    private Sink mSink;
    private final BandsListener mListener;

    // Sliding accumulator of mono samples awaiting a full FFT window.
    private final float[] mWindow = new float[FFT_SIZE];
    private int mFilled = 0;

    // Scratch FFT buffers + precomputed Hann window, allocated once.
    private final float[] mRe = new float[FFT_SIZE];
    private final float[] mIm = new float[FFT_SIZE];
    private final float[] mHann = new float[FFT_SIZE];

    // Band bin ranges, recomputed whenever the sample rate changes.
    private int mBandRateCached = -1;
    private final int[] mBandLoBin = new int[NUM_BANDS];
    private final int[] mBandHiBin = new int[NUM_BANDS];

    private long mLastEmitMs = 0;

    public SylkAudioSpectrum(BandsListener listener) {
        this.mListener = listener;
        for (int i = 0; i < FFT_SIZE; i++) {
            // Periodic Hann.
            mHann[i] = (float) (0.5 - 0.5 * Math.cos(2.0 * Math.PI * i / FFT_SIZE));
        }
    }

    /**
     * Attach to the remote track. Returns false if the track isn't an
     * org.webrtc.AudioTrack we can sink (caller can then no-op the UI).
     */
    public synchronized boolean start(MediaStreamTrack remoteTrack,
                                      double fLowHz, double fHighHz) {
        if (mRunning.get()) return true;
        AudioTrack t = (remoteTrack instanceof AudioTrack) ? (AudioTrack) remoteTrack : null;
        if (t == null) {
            SylkLogger.w("[call] [spectrum] remote track is not an AudioTrack — analyser disabled");
            return false;
        }
        if (fLowHz > 0 && fHighHz > fLowHz) {
            mFLowHz = fLowHz;
            mFHighHz = fHighHz;
        }
        mBandRateCached = -1;   // force band recompute with the new range
        mFilled = 0;
        mLastEmitMs = 0;
        mTrack = t;
        mSink = new Sink();
        mTrack.addSink(mSink);
        mRunning.set(true);
        SylkLogger.i("[call] [spectrum] started — " + NUM_BANDS + " bands, "
                + (int) mFLowHz + "-" + (int) mFHighHz + " Hz, FFT " + FFT_SIZE);
        return true;
    }

    public synchronized void stop() {
        if (!mRunning.getAndSet(false)) return;
        try {
            if (mTrack != null && mSink != null) mTrack.removeSink(mSink);
        } catch (Throwable t) {
            SylkLogger.w("[call] [spectrum] removeSink threw: " + t.getMessage());
        }
        mTrack = null;
        mSink = null;
        SylkLogger.i("[call] [spectrum] stopped");
    }

    public boolean isRunning() {
        return mRunning.get();
    }

    // -----------------------------------------------------------------
    // Sink — runs on a WebRTC audio thread.
    // -----------------------------------------------------------------
    private class Sink implements AudioTrackSink {
        @Override
        public void onData(ByteBuffer audioData,
                           int bitsPerSample,
                           int sampleRate,
                           int numberOfChannels,
                           int numberOfFrames,
                           long absoluteCaptureTimestampMs) {
            if (!mRunning.get() || bitsPerSample != 16) return;

            // Match SylkCallRecorder.pcmToMono: relative int16 reads
            // from the buffer's current position (do NOT assume it
            // starts at index 0), little-endian, downmix to mono.
            final ByteBuffer src = audioData.order(ByteOrder.LITTLE_ENDIAN);
            final int ch = numberOfChannels <= 0 ? 1 : numberOfChannels;
            for (int f = 0; f < numberOfFrames; f++) {
                int sum = 0;
                int got = 0;
                for (int c = 0; c < ch; c++) {
                    if (src.remaining() < 2) break;
                    sum += src.getShort();
                    got++;
                }
                if (got == 0) break;
                mWindow[mFilled++] = (sum / (float) got) / 32768.0f;

                if (mFilled == FFT_SIZE) {
                    analyse(sampleRate);
                    // Slide by HOP: keep the most recent (FFT_SIZE - HOP)
                    // samples so successive frames overlap by 50%.
                    System.arraycopy(mWindow, HOP, mWindow, 0, FFT_SIZE - HOP);
                    mFilled = FFT_SIZE - HOP;
                }
            }
        }
    }

    private void analyse(int sampleRate) {
        long now = System.currentTimeMillis();
        if (now - mLastEmitMs < EMIT_INTERVAL_MS) return; // throttle
        mLastEmitMs = now;

        if (sampleRate != mBandRateCached) {
            computeBandBins(sampleRate);
            mBandRateCached = sampleRate;
        }

        // Window + load into FFT buffers.
        for (int i = 0; i < FFT_SIZE; i++) {
            mRe[i] = mWindow[i] * mHann[i];
            mIm[i] = 0f;
        }
        fft(mRe, mIm);

        // Power per bin (only 0..N/2 are unique for real input).
        final float[] db = new float[NUM_BANDS];
        for (int b = 0; b < NUM_BANDS; b++) {
            int lo = mBandLoBin[b];
            int hi = mBandHiBin[b];
            if (hi < lo) { db[b] = (float) DB_FLOOR; continue; }
            double acc = 0;
            int n = 0;
            for (int k = lo; k <= hi; k++) {
                double p = (double) mRe[k] * mRe[k] + (double) mIm[k] * mIm[k];
                acc += p;
                n++;
            }
            // Mean power, normalised by window energy so values are
            // codec/level comparable, then to dB.
            double meanP = n > 0 ? acc / n : 0;
            // FFT of an N-point Hann-windowed unit sine has coherent
            // gain N*0.5; divide by (FFT_SIZE*0.5)^2 to land ~0 dBFS at
            // full-scale tone. eps keeps log finite on silence.
            double norm = meanP / ((double) FFT_SIZE * 0.5 * FFT_SIZE * 0.5);
            double d = 10.0 * Math.log10(norm + 1e-12);
            if (d < DB_FLOOR) d = DB_FLOOR;
            db[b] = (float) d;
        }

        if (mListener != null) {
            try {
                mListener.onBands(db, sampleRate);
            } catch (Throwable t) {
                SylkLogger.w("[call] [spectrum] listener threw: " + t.getMessage());
            }
        }
    }

    /**
     * Precompute the FFT-bin range covered by each of the NUM_BANDS
     * log-spaced bands on a FIXED 1 kHz .. 16 kHz scale.
     * Band edges: f(i) = F_LOW * (F_HIGH / F_LOW) ^ (i / NUM_BANDS).
     *
     * Bands whose lower edge sits above this source's Nyquist are
     * unrepresentable at its sample rate and get marked empty (they
     * render at the floor) — e.g. an 8 kHz PCMU leg can't show the
     * 8-16 kHz bands; a 16 kHz leg tops out at 8 kHz; only a 48 kHz
     * Opus leg (or the 48 kHz mic) fills all the way to 16 kHz.
     */
    private void computeBandBins(int sampleRate) {
        double ratio = Math.pow(mFHighHz / mFLowHz, 1.0 / NUM_BANDS);
        double binHz = (double) sampleRate / FFT_SIZE;
        int maxBin = FFT_SIZE / 2;

        double edgeLo = mFLowHz;
        for (int b = 0; b < NUM_BANDS; b++) {
            double edgeHi = edgeLo * ratio;
            int lo = (int) Math.ceil(edgeLo / binHz);
            int hi = (int) Math.floor(edgeHi / binHz);
            if (lo < 1) lo = 1;
            if (hi > maxBin) hi = maxBin;
            if (lo > maxBin) { lo = 1; hi = 0; }   // band above Nyquist -> empty
            else if (hi < lo) hi = lo;             // ensure ≥1 bin in range
            mBandLoBin[b] = lo;
            mBandHiBin[b] = hi;
            edgeLo = edgeHi;
        }
        SylkLogger.i("[call] [spectrum] band map " + sampleRate
                + " Hz: " + (int) mFLowHz + "-" + (int) mFHighHz + " Hz, "
                + NUM_BANDS + " bands");
    }

    // -----------------------------------------------------------------
    // Iterative in-place radix-2 Cooley–Tukey FFT. len is a power of 2.
    // -----------------------------------------------------------------
    private static void fft(float[] re, float[] im) {
        int n = re.length;
        // Bit-reversal permutation.
        for (int i = 1, j = 0; i < n; i++) {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                float tr = re[i]; re[i] = re[j]; re[j] = tr;
                float ti = im[i]; im[i] = im[j]; im[j] = ti;
            }
        }
        for (int len = 2; len <= n; len <<= 1) {
            double ang = -2.0 * Math.PI / len;
            float wlenRe = (float) Math.cos(ang);
            float wlenIm = (float) Math.sin(ang);
            int half = len >> 1;
            for (int i = 0; i < n; i += len) {
                float wRe = 1f, wIm = 0f;
                for (int k = 0; k < half; k++) {
                    int a = i + k;
                    int bb = i + k + half;
                    float vRe = re[bb] * wRe - im[bb] * wIm;
                    float vIm = re[bb] * wIm + im[bb] * wRe;
                    re[bb] = re[a] - vRe; im[bb] = im[a] - vIm;
                    re[a] += vRe;         im[a] += vIm;
                    float nwRe = wRe * wlenRe - wIm * wlenIm;
                    wIm = wRe * wlenIm + wIm * wlenRe;
                    wRe = nwRe;
                }
            }
        }
    }
}
