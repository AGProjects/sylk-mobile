package com.agprojects.sylk;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Live spectral analyser for the LOCAL MIC, used by the voice-message
 * composer (ReadyBox) so you can see the spectrum in real time WHILE
 * recording, before the take is sent.
 *
 * Why a separate AudioRecord instead of the recorder's meter:
 * react-native-audio-recorder-player only surfaces a single dBFS
 * `currentMetering` scalar (that's what drives the VuMeter) — no PCM,
 * so no FFT is possible from it. This opens its OWN AudioRecord on the
 * MIC, in parallel with the MediaRecorder that writes the .m4a, and
 * runs the same analysis SylkAudioSpectrum does for the remote leg.
 *
 * Rate: 48 kHz (per product decision) so the bands reach ~24 kHz and
 * show the mic's TRUE bandwidth — even though the sent file is AAC
 * 16 kHz (capped at 8 kHz). The live view therefore reflects the
 * microphone, not the encoder.
 *
 * Android only. iOS can't open a second recorder on the shared
 * AVAudioSession (see ReadyBox.onStartRecord comment); the iOS port
 * needs an AVAudioEngine input tap and is deferred — the JS side keeps
 * the bars at floor there.
 *
 * Self-contained: its own Hann window + radix-2 FFT + log-band
 * integration, mirroring SylkAudioSpectrum so the bars look identical.
 * Kept separate (rather than shared) to avoid touching the validated
 * remote-leg analyser.
 */
public class SylkMicSpectrum {

    private static final String TAG = "SYLK_APP";

    public static final int NUM_BANDS = 16;
    private static final int FFT_SIZE = 2048;
    private static final int HOP = FFT_SIZE / 2;
    /** Fixed display scale: 16 log-spaced bands from 1 kHz to 16 kHz. */
    private static final double F_LOW_HZ  = 1000.0;
    private static final double F_HIGH_HZ = 16000.0;
    private static final long EMIT_INTERVAL_MS = 40;
    private static final double DB_FLOOR = -120.0;

    /** Capture rate — 48 kHz so bands reach the mic's full ~24 kHz. */
    private static final int SAMPLE_RATE = 48000;

    public interface BandsListener {
        void onBands(float[] dbBands, int sampleRate);
    }

    private final AtomicBoolean mRunning = new AtomicBoolean(false);
    private final BandsListener mListener;
    private Thread mThread;
    private AudioRecord mRecord;

    private final float[] mWindow = new float[FFT_SIZE];
    private int mFilled = 0;
    private final float[] mRe = new float[FFT_SIZE];
    private final float[] mIm = new float[FFT_SIZE];
    private final float[] mHann = new float[FFT_SIZE];
    private final int[] mBandLoBin = new int[NUM_BANDS];
    private final int[] mBandHiBin = new int[NUM_BANDS];
    private long mLastEmitMs = 0;

    public SylkMicSpectrum(BandsListener listener) {
        this.mListener = listener;
        for (int i = 0; i < FFT_SIZE; i++) {
            mHann[i] = (float) (0.5 - 0.5 * Math.cos(2.0 * Math.PI * i / FFT_SIZE));
        }
        computeBandBins(SAMPLE_RATE);
    }

    /**
     * Open the mic and start streaming bands. Returns false if the
     * AudioRecord can't initialise (mic busy / permission). Caller
     * (the module) then resolves 'not_implemented' so the UI no-ops.
     */
    public synchronized boolean start() {
        if (mRunning.get()) return true;

        int minBuf = AudioRecord.getMinBufferSize(
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT);
        if (minBuf <= 0) {
            SylkLogger.w("[mic] [spectrum] getMinBufferSize failed (" + minBuf + ")");
            return false;
        }
        // Generous buffer so a busy main thread can't drop capture.
        int bufBytes = Math.max(minBuf, FFT_SIZE * 2 * 4);

        AudioRecord rec;
        try {
            rec = new AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufBytes);
        } catch (Throwable t) {
            SylkLogger.w("[mic] [spectrum] AudioRecord ctor threw: " + t.getMessage());
            return false;
        }
        if (rec.getState() != AudioRecord.STATE_INITIALIZED) {
            SylkLogger.w("[mic] [spectrum] AudioRecord did not initialise — "
                    + "mic likely held exclusively; spectrum disabled");
            try { rec.release(); } catch (Throwable ignore) {}
            return false;
        }

        mRecord = rec;
        mFilled = 0;
        mLastEmitMs = 0;
        mRunning.set(true);
        try {
            mRecord.startRecording();
        } catch (Throwable t) {
            SylkLogger.w("[mic] [spectrum] startRecording threw: " + t.getMessage());
            mRunning.set(false);
            try { mRecord.release(); } catch (Throwable ignore) {}
            mRecord = null;
            return false;
        }

        mThread = new Thread(this::loop, "SylkMicSpectrum");
        mThread.setPriority(Thread.NORM_PRIORITY);
        mThread.start();
        SylkLogger.i("[mic] [spectrum] started @ " + SAMPLE_RATE + " Hz, "
                + NUM_BANDS + " bands");
        return true;
    }

    public synchronized void stop() {
        if (!mRunning.getAndSet(false)) return;
        Thread t = mThread;
        mThread = null;
        if (t != null) {
            try { t.join(300); } catch (InterruptedException ignore) {
                Thread.currentThread().interrupt();
            }
        }
        if (mRecord != null) {
            try { mRecord.stop(); } catch (Throwable ignore) {}
            try { mRecord.release(); } catch (Throwable ignore) {}
            mRecord = null;
        }
        SylkLogger.i("[mic] [spectrum] stopped");
    }

    public boolean isRunning() {
        return mRunning.get();
    }

    // -----------------------------------------------------------------
    // Capture loop — own thread.
    // -----------------------------------------------------------------
    private void loop() {
        final short[] buf = new short[1024];
        while (mRunning.get()) {
            int n;
            try {
                n = mRecord.read(buf, 0, buf.length);
            } catch (Throwable t) {
                SylkLogger.w("[mic] [spectrum] read threw: " + t.getMessage());
                break;
            }
            if (n <= 0) {
                if (n == AudioRecord.ERROR_INVALID_OPERATION
                        || n == AudioRecord.ERROR_BAD_VALUE) {
                    break;
                }
                continue;
            }
            for (int i = 0; i < n; i++) {
                mWindow[mFilled++] = buf[i] / 32768.0f;
                if (mFilled == FFT_SIZE) {
                    analyse();
                    System.arraycopy(mWindow, HOP, mWindow, 0, FFT_SIZE - HOP);
                    mFilled = FFT_SIZE - HOP;
                }
            }
        }
    }

    private void analyse() {
        long now = System.currentTimeMillis();
        if (now - mLastEmitMs < EMIT_INTERVAL_MS) return;
        mLastEmitMs = now;

        for (int i = 0; i < FFT_SIZE; i++) {
            mRe[i] = mWindow[i] * mHann[i];
            mIm[i] = 0f;
        }
        fft(mRe, mIm);

        final float[] db = new float[NUM_BANDS];
        for (int b = 0; b < NUM_BANDS; b++) {
            int lo = mBandLoBin[b];
            int hi = mBandHiBin[b];
            if (hi < lo) { db[b] = (float) DB_FLOOR; continue; }
            double acc = 0;
            int cnt = 0;
            for (int k = lo; k <= hi; k++) {
                acc += (double) mRe[k] * mRe[k] + (double) mIm[k] * mIm[k];
                cnt++;
            }
            double meanP = cnt > 0 ? acc / cnt : 0;
            double norm = meanP / ((double) FFT_SIZE * 0.5 * FFT_SIZE * 0.5);
            double d = 10.0 * Math.log10(norm + 1e-12);
            if (d < DB_FLOOR) d = DB_FLOOR;
            db[b] = (float) d;
        }

        if (mListener != null) {
            try {
                mListener.onBands(db, SAMPLE_RATE);
            } catch (Throwable t) {
                SylkLogger.w("[mic] [spectrum] listener threw: " + t.getMessage());
            }
        }
    }

    private void computeBandBins(int sampleRate) {
        // Fixed 1 kHz .. 16 kHz log scale, 16 bands. At 48 kHz capture
        // (Nyquist 24 kHz) all 16 bands are representable.
        double ratio = Math.pow(F_HIGH_HZ / F_LOW_HZ, 1.0 / NUM_BANDS);
        double binHz = (double) sampleRate / FFT_SIZE;
        int maxBin = FFT_SIZE / 2;

        double edgeLo = F_LOW_HZ;
        for (int b = 0; b < NUM_BANDS; b++) {
            double edgeHi = edgeLo * ratio;
            int lo = (int) Math.ceil(edgeLo / binHz);
            int hi = (int) Math.floor(edgeHi / binHz);
            if (lo < 1) lo = 1;
            if (hi > maxBin) hi = maxBin;
            if (lo > maxBin) { lo = 1; hi = 0; }   // band above Nyquist -> empty
            else if (hi < lo) hi = lo;
            mBandLoBin[b] = lo;
            mBandHiBin[b] = hi;
            edgeLo = edgeHi;
        }
    }

    // Iterative in-place radix-2 Cooley–Tukey FFT (len = power of 2).
    private static void fft(float[] re, float[] im) {
        int n = re.length;
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
