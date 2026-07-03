#import "SylkAudioSpectrum.h"

#import <React/RCTBridge.h>
#import <React/RCTLog.h>
#import <AVFoundation/AVFoundation.h>

#import <WebRTC/RTCAudioTrack.h>
#import <WebRTC/RTCMediaStreamTrack.h>
#import <WebRTC/RTCAudioRenderer.h>

#import "SylkLogger.h"

#import <math.h>

// react-native-webrtc's WebRTCModule exposes a public trackForId:pcId:
// helper. Forward-declare it via an NSObject category so we don't have
// to import the (patched) module's headers — same approach as
// SylkCallRecorder.
@interface NSObject (SylkWebRTCModuleTrackLookup)
- (id)trackForId:(NSString *)trackId pcId:(NSNumber *)pcId;
@end

// Analysis parameters — must match the Android SylkAudioSpectrum so
// the bars look identical across platforms. kFFTSize / kNumBands are
// #defines because they size C array ivars (a `static const int` is
// not a constant expression for array bounds in C).
#define kFFTSize  2048
#define kNumBands 16
static const int    kHop      = 1024;          // 50% overlap (kFFTSize/2)
static const double kEmitInterval = 0.040;     // ~25 fps
static const double kDbFloor  = -120.0;

// In-place iterative radix-2 Cooley–Tukey FFT (len = power of two).
// Same algorithm as the Android side; kept self-contained so we don't
// need to link Accelerate.
static void sylk_fft(float *re, float *im, int n) {
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
        double ang = -2.0 * M_PI / len;
        float wlenRe = (float)cos(ang);
        float wlenIm = (float)sin(ang);
        int half = len >> 1;
        for (int i = 0; i < n; i += len) {
            float wRe = 1.0f, wIm = 0.0f;
            for (int k = 0; k < half; k++) {
                int a = i + k;
                int b = i + k + half;
                float vRe = re[b] * wRe - im[b] * wIm;
                float vIm = re[b] * wIm + im[b] * wRe;
                re[b] = re[a] - vRe; im[b] = im[a] - vIm;
                re[a] += vRe;        im[a] += vIm;
                float nwRe = wRe * wlenRe - wIm * wlenIm;
                wIm = wRe * wlenIm + wIm * wlenRe;
                wRe = nwRe;
            }
        }
    }
}

// Declare RTCAudioRenderer conformance (so addRenderer:self type-checks)
// and the private methods used before their definitions below.
@interface SylkAudioSpectrum () <RTCAudioRenderer>
- (void)analyseAtRate:(int)sampleRate;
- (void)computeBandBins:(int)sampleRate;
- (void)micTapBuffer:(AVAudioPCMBuffer *)buf;
@end

@implementation SylkAudioSpectrum {
    __weak RTCAudioTrack *_track;
    BOOL  _running;
    BOOL  _hasListeners;

    float _window[kFFTSize];
    int   _filled;
    float _re[kFFTSize];
    float _im[kFFTSize];
    float _hann[kFFTSize];

    int    _bandLo[kNumBands];
    int    _bandHi[kNumBands];
    int    _bandRateCached;     // sample rate the band map was built for
    double _fLow;
    double _fHigh;

    NSTimeInterval _lastEmit;

    // Local-mic path (voice-message composer): a parallel AVAudioEngine
    // input tap, best-effort alongside the AVAudioRecorder that writes
    // the .m4a. Mutually exclusive with the remote-call path, so it
    // reuses the same window/FFT/band state above; only the run flag
    // is separate.
    AVAudioEngine *_engine;
    BOOL _micRunning;
}

// NB: don't @synthesize bridge here — RCTEventEmitter already provides
// the `bridge` property; we read it via self.bridge below.

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup { return NO; }

- (NSArray<NSString *> *)supportedEvents { return @[@"SylkAudioBands"]; }

- (void)startObserving { _hasListeners = YES; }
- (void)stopObserving  { _hasListeners = NO; }

- (instancetype)init {
    if ((self = [super init])) {
        _fLow = 1000.0;
        _fHigh = 16000.0;
        _bandRateCached = -1;
        for (int i = 0; i < kFFTSize; i++) {
            _hann[i] = (float)(0.5 - 0.5 * cos(2.0 * M_PI * i / kFFTSize));
        }
    }
    return self;
}

#pragma mark - JS API

RCT_EXPORT_METHOD(start:(NSInteger)remotePcId
                  remoteTrackId:(NSString *)remoteTrackId
                  fLow:(double)fLow
                  fHigh:(double)fHigh
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    @synchronized (self) {
        if (_running) { resolve(@(YES)); return; }

        id webrtcModule = [self.bridge moduleForName:@"WebRTCModule"];
        if (!webrtcModule
            || ![webrtcModule respondsToSelector:@selector(trackForId:pcId:)]) {
            RCTLogWarn(@"[SylkAudioSpectrum] WebRTCModule unavailable for track lookup");
            resolve(@"not_implemented");
            return;
        }
        id remoteAny = nil;
        if (remoteTrackId.length > 0) {
            remoteAny = [webrtcModule trackForId:remoteTrackId pcId:@(remotePcId)];
        }
        if (!remoteAny || ![remoteAny isKindOfClass:[RTCAudioTrack class]]) {
            RCTLogWarn(@"[SylkAudioSpectrum] no RTCAudioTrack on receiver");
            resolve(@"not_implemented");
            return;
        }

        if (fLow > 0 && fHigh > fLow) { _fLow = fLow; _fHigh = fHigh; }
        _bandRateCached = -1;   // force band recompute with the new range
        _filled = 0;
        _lastEmit = 0;
        _track = (RTCAudioTrack *)remoteAny;
        _running = YES;
        [_track addRenderer:self];
        [SylkLogger log:@"[call] [spectrum] started — %d bands, %d-%d Hz",
                        kNumBands, (int)_fLow, (int)_fHigh];
        resolve(@(YES));
    }
}

RCT_EXPORT_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    @synchronized (self) {
        if (_running) {
            _running = NO;
            @try { [_track removeRenderer:self]; }
            @catch (__unused NSException *e) {}
            _track = nil;
            [SylkLogger log:@"[call] [spectrum] stopped"];
        }
        resolve(@(YES));
    }
}

#pragma mark - Local mic (voice-message composer)

// Best-effort live mic spectrum via a parallel AVAudioEngine input
// tap. We deliberately DO NOT touch AVAudioSession — the voice-message
// recorder (react-native-audio-recorder-player) owns it and has
// already set .playAndRecord active by the time recording starts. If
// the engine can't start (mic busy / session not record-capable) we
// resolve "not_implemented" and the JS bars sit at floor; the
// recording itself is never disturbed. Fixed 1-16 kHz scale, matching
// the Android mic analyser.
RCT_EXPORT_METHOD(startMic:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    @synchronized (self) {
        if (_micRunning) { resolve(@(YES)); return; }
        @try {
            _engine = [[AVAudioEngine alloc] init];
            AVAudioInputNode *input = _engine.inputNode;
            AVAudioFormat *fmt = [input outputFormatForBus:0];
            if (!fmt || fmt.sampleRate <= 0) {
                _engine = nil;
                resolve(@"not_implemented");
                return;
            }
            _fLow = 1000.0;
            _fHigh = 16000.0;
            _bandRateCached = -1;
            _filled = 0;
            _lastEmit = 0;
            _micRunning = YES;

            __weak SylkAudioSpectrum *weakSelf = self;
            [input installTapOnBus:0 bufferSize:1024 format:fmt
                             block:^(AVAudioPCMBuffer * _Nonnull buf,
                                     AVAudioTime * _Nonnull when) {
                [weakSelf micTapBuffer:buf];
            }];

            [_engine prepare];
            NSError *err = nil;
            if (![_engine startAndReturnError:&err]) {
                _micRunning = NO;
                @try { [input removeTapOnBus:0]; } @catch (__unused NSException *e) {}
                _engine = nil;
                [SylkLogger log:@"[mic] [spectrum] engine start failed: %@",
                                err.localizedDescription];
                resolve(@"not_implemented");
                return;
            }
            [SylkLogger log:@"[mic] [spectrum] started @ %d Hz", (int)fmt.sampleRate];
            resolve(@(YES));
        } @catch (NSException *e) {
            _micRunning = NO;
            _engine = nil;
            [SylkLogger log:@"[mic] [spectrum] start threw: %@", e.reason];
            resolve(@"not_implemented");
        }
    }
}

RCT_EXPORT_METHOD(stopMic:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    @synchronized (self) {
        if (_micRunning) {
            _micRunning = NO;
            @try { [_engine.inputNode removeTapOnBus:0]; } @catch (__unused NSException *e) {}
            @try { [_engine stop]; } @catch (__unused NSException *e) {}
            _engine = nil;
            [SylkLogger log:@"[mic] [spectrum] stopped"];
        }
        resolve(@(YES));
    }
}

// AVAudioEngine input tap — runs on a realtime audio thread. Downmix to
// mono float, feed the shared sliding window, analyse on full windows.
- (void)micTapBuffer:(AVAudioPCMBuffer *)buf {
    if (!_micRunning || !buf || buf.frameLength == 0) return;
    AVAudioFormat *fmt = buf.format;
    int rate = (int)fmt.sampleRate;
    if (rate <= 0) return;
    NSUInteger frames = buf.frameLength;
    AVAudioChannelCount ch = fmt.channelCount > 0 ? fmt.channelCount : 1;

    if (buf.floatChannelData != NULL) {
        float * const *data = buf.floatChannelData;   // non-interleaved
        for (NSUInteger f = 0; f < frames; f++) {
            float s = 0;
            for (AVAudioChannelCount c = 0; c < ch; c++) s += data[c][f];
            _window[_filled++] = s / (float)ch;
            if (_filled == kFFTSize) {
                [self analyseAtRate:rate];
                memmove(_window, _window + kHop, (kFFTSize - kHop) * sizeof(float));
                _filled = kFFTSize - kHop;
            }
        }
    } else if (buf.int16ChannelData != NULL) {
        int16_t * const *data = buf.int16ChannelData;
        for (NSUInteger f = 0; f < frames; f++) {
            int sum = 0;
            for (AVAudioChannelCount c = 0; c < ch; c++) sum += data[c][f];
            _window[_filled++] = (sum / (float)ch) / 32768.0f;
            if (_filled == kFFTSize) {
                [self analyseAtRate:rate];
                memmove(_window, _window + kHop, (kFFTSize - kHop) * sizeof(float));
                _filled = kFFTSize - kHop;
            }
        }
    }
}

#pragma mark - RTCAudioRenderer

- (void)renderPCMBuffer:(AVAudioPCMBuffer *)pcmBuffer {
    if (!_running || !pcmBuffer) return;
    AVAudioFormat *fmt = pcmBuffer.format;
    if (!fmt || pcmBuffer.frameLength == 0) return;

    const double srcRate = fmt.sampleRate;
    if (srcRate <= 0) return;

    // webrtc-sdk delivers Int16 mono at 48 kHz on iOS (verified by the
    // recorder's diagnostics). If a future path delivers Float32 /
    // stereo we'd add conversion here; for now bail defensively.
    if (fmt.commonFormat != AVAudioPCMFormatInt16 || fmt.channelCount != 1) {
        return;
    }
    const int16_t *src = pcmBuffer.int16ChannelData[0];
    if (!src) return;

    NSUInteger frames = pcmBuffer.frameLength;
    for (NSUInteger f = 0; f < frames; f++) {
        _window[_filled++] = src[f] / 32768.0f;
        if (_filled == kFFTSize) {
            [self analyseAtRate:(int)srcRate];
            memmove(_window, _window + kHop, (kFFTSize - kHop) * sizeof(float));
            _filled = kFFTSize - kHop;
        }
    }
}

#pragma mark - Analysis

- (void)analyseAtRate:(int)sampleRate {
    NSTimeInterval now = CACurrentMediaTime();
    if (now - _lastEmit < kEmitInterval) return;   // throttle
    _lastEmit = now;

    if (sampleRate != _bandRateCached) {
        [self computeBandBins:sampleRate];
        _bandRateCached = sampleRate;
    }

    for (int i = 0; i < kFFTSize; i++) {
        _re[i] = _window[i] * _hann[i];
        _im[i] = 0.0f;
    }
    sylk_fft(_re, _im, kFFTSize);

    NSMutableArray<NSNumber *> *bands = [NSMutableArray arrayWithCapacity:kNumBands];
    for (int b = 0; b < kNumBands; b++) {
        int lo = _bandLo[b], hi = _bandHi[b];
        if (hi < lo) { [bands addObject:@(kDbFloor)]; continue; }
        double acc = 0; int cnt = 0;
        for (int k = lo; k <= hi; k++) {
            acc += (double)_re[k] * _re[k] + (double)_im[k] * _im[k];
            cnt++;
        }
        double meanP = cnt > 0 ? acc / cnt : 0;
        double norm = meanP / ((double)kFFTSize * 0.5 * kFFTSize * 0.5);
        double d = 10.0 * log10(norm + 1e-12);
        if (d < kDbFloor) d = kDbFloor;
        [bands addObject:@(d)];
    }

    if (_hasListeners) {
        [self sendEventWithName:@"SylkAudioBands"
                           body:@{ @"bands": bands,
                                   @"sampleRate": @(sampleRate),
                                   @"nyquist": @(sampleRate / 2) }];
    }
}

// Fixed [_fLow, _fHigh] log scale, 16 bands. Bands whose lower edge is
// above this rate's Nyquist are marked empty (rendered at floor).
- (void)computeBandBins:(int)sampleRate {
    double ratio = pow(_fHigh / _fLow, 1.0 / kNumBands);
    double binHz = (double)sampleRate / kFFTSize;
    int maxBin = kFFTSize / 2;

    double edgeLo = _fLow;
    for (int b = 0; b < kNumBands; b++) {
        double edgeHi = edgeLo * ratio;
        int lo = (int)ceil(edgeLo / binHz);
        int hi = (int)floor(edgeHi / binHz);
        if (lo < 1) lo = 1;
        if (hi > maxBin) hi = maxBin;
        if (lo > maxBin) { lo = 1; hi = 0; }      // above Nyquist -> empty
        else if (hi < lo) hi = lo;
        _bandLo[b] = lo;
        _bandHi[b] = hi;
        edgeLo = edgeHi;
    }
}

- (void)invalidate {
    @synchronized (self) {
        if (_running) {
            _running = NO;
            @try { [_track removeRenderer:self]; }
            @catch (__unused NSException *e) {}
            _track = nil;
        }
        if (_micRunning) {
            _micRunning = NO;
            @try { [_engine.inputNode removeTapOnBus:0]; } @catch (__unused NSException *e) {}
            @try { [_engine stop]; } @catch (__unused NSException *e) {}
            _engine = nil;
        }
    }
}

@end
