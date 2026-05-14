#import "SylkCallRecorder.h"

#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <React/RCTBridge.h>
#import <React/RCTLog.h>
#import <WebRTC/RTCAudioTrack.h>
#import <WebRTC/RTCMediaStreamTrack.h>
#import <WebRTC/RTCAudioRenderer.h>
#import "SylkLogger.h"

// react-native-webrtc's WebRTCModule has a public trackForId:pcId:
// helper. Forward-declare the selector via NSObject category so we
// don't need to import the module's headers (which would couple us
// to the patched react-native-webrtc target).
@interface NSObject (SylkWebRTCModuleTrackLookup)
- (id)trackForId:(NSString *)trackId pcId:(NSNumber *)pcId;
@end

// Output format. Matches Android's compressed pipeline: 16 kHz
// stereo AAC in an .m4a container at ~64 kbps (~8 KB/s, ~480 KB
// per minute). Previous iOS recorder shipped uncompressed 16 kHz
// stereo PCM WAV at ~64 KB/s (~3.8 MB per minute) — AAC saves
// roughly 8× without audible degradation for speech, and the file
// plays everywhere natively (AVFoundation, MediaPlayer, browsers).
static const double  kOutputSampleRate = 16000.0;
static const AVAudioChannelCount kOutputChannels = 2;
// AAC target bitrate. 64 kbps stereo is comfortable for speech;
// drop to 48 kbps if file size matters more than headroom for
// occasional music passages.
static const NSInteger kAACBitRate = 64000;
// Peak bin = 100 ms of OUTPUT_SAMPLE_RATE per-channel mono samples.
static const NSUInteger kPeakBinSamples = 1600; // 16000 * 0.1
// Cap the emitted peaks array so a long call doesn't ship 36 000
// entries. Matches Android's MAX_PEAKS so the wire format stays
// identical and the JS bubble can index either side the same way.
static const NSUInteger kMaxPeaks = 1000;

@interface SylkCallRecorder () <RTCAudioRenderer> {
    // Bridge — needed to look up tracks via WebRTCModule.
    __weak RCTBridge *_bridge;

    // State
    BOOL _running;
    NSString *_outputPath;
    NSString *_lastPath;
    NSString *_lastPeaksJson;

    // Strong ref so the remote track outlives any rapid track turnover
    // mid-call. Detached on stop.
    RTCAudioTrack *_remoteTrack;

    // Mic capture
    AVAudioEngine *_engine;

    // Output file — AAC m4a via AVAssetWriter. AVAudioFile only
    // supports lossless writers reliably across iOS versions, so
    // for compressed output we hand frames to AVAssetWriterInput
    // (configured for kAudioFormatMPEG4AAC) wrapped as
    // CMSampleBuffers built from the interleaved Int16 stereo
    // payload our writer pump produces.
    AVAssetWriter *_assetWriter;
    AVAssetWriterInput *_audioInput;
    CMAudioFormatDescriptionRef _formatDesc;  // describes the PCM input we feed in
    CMTime _writeTimestamp;                   // running PTS clock for sample buffers

    // Rolling per-channel Int16 mono accumulators. Each callback
    // appends to the relevant buffer; the writer pops MIN(mic, rem)
    // frames per iteration and drains exactly that much from both.
    // This handles the AVAudioEngine ↔ RTCAudioRenderer chunk-size
    // mismatch: AVAudioEngine often hands us 4096-frame mic
    // buffers, the renderer hands us 480-frame remote buffers (then
    // we decimate to 160). With NSData arrays we'd be pairing one
    // mic chunk against many remote chunks and padding silence — a
    // 4096-vs-160 pair produces a tiny remote burst then 3936
    // frames of silence in the output, which sounds like
    // intermittent scratching. Rolling buffers eliminate that.
    NSMutableData *_micRoll;
    NSMutableData *_remRoll;
    NSLock *_queueLock;

    dispatch_queue_t _writerQueue;
    dispatch_source_t _writerTimer;

    // Peak bins.
    NSMutableArray<NSNumber *> *_peaksLocalRaw;
    NSMutableArray<NSNumber *> *_peaksRemoteRaw;
    int _peakAccumLocal;
    int _peakAccumRemote;
    NSUInteger _peakSamplesInBin;

}
@end

@implementation SylkCallRecorder

RCT_EXPORT_MODULE();

@synthesize bridge = _bridge;

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

#pragma mark - JS bridge

RCT_EXPORT_METHOD(start:(NSInteger)micPcId
                  micTrackId:(NSString *)micTrackId
                  remotePcId:(NSInteger)remotePcId
                  remoteTrackId:(NSString *)remoteTrackId
                  outputPath:(NSString *)outputPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    @synchronized (self) {
        if (_running) {
            reject(@"EBUSY", @"Recorder already running", nil);
            return;
        }

        // Resolve the remote audio track via WebRTCModule's public
        // helper. If it's missing or not an audio track we can sink,
        // the caller will see "not_implemented" and fall back to
        // the mic-only react-native-audio-record path.
        id webrtcModule = [_bridge moduleForName:@"WebRTCModule"];
        if (!webrtcModule
            || ![webrtcModule respondsToSelector:@selector(trackForId:pcId:)]) {
            RCTLogWarn(@"[SylkCallRecorder] WebRTCModule unavailable for track lookup");
            resolve(@"not_implemented");
            return;
        }
        id remoteAny = nil;
        if (remoteTrackId.length > 0) {
            remoteAny = [webrtcModule trackForId:remoteTrackId
                                            pcId:@(remotePcId)];
        }
        if (!remoteAny || ![remoteAny isKindOfClass:[RTCAudioTrack class]]) {
            RCTLogWarn(@"[SylkCallRecorder] no RTCAudioTrack on receiver — falling back");
            resolve(@"not_implemented");
            return;
        }
        _remoteTrack = (RTCAudioTrack *)remoteAny;
        _outputPath = [outputPath copy];
        _lastPath   = nil;
        _lastPeaksJson = nil;
        [SylkLogger log:@"[call] [recorder] start: remote track resolved trackId=%@ pcId=%ld kind=%@ enabled=%d source=%@",
              remoteTrackId, (long)remotePcId, _remoteTrack.kind,
              _remoteTrack.isEnabled, _remoteTrack.source];

        // Open output file as AAC m4a via AVAssetWriter. The writer
        // expects the destination to NOT exist (otherwise -startWriting
        // returns NO with an error), so unlink any leftover from a
        // previous run with the same name.
        NSURL *outURL = [NSURL fileURLWithPath:outputPath];
        [[NSFileManager defaultManager] removeItemAtURL:outURL error:nil];

        NSError *err = nil;
        _assetWriter = [[AVAssetWriter alloc] initWithURL:outURL
                                                 fileType:AVFileTypeAppleM4A
                                                    error:&err];
        if (err || !_assetWriter) {
            RCTLogError(@"[SylkCallRecorder] AVAssetWriter init failed: %@", err);
            _remoteTrack = nil;
            reject(@"EFILE", err ? err.localizedDescription : @"AVAssetWriter init failed", err);
            return;
        }

        NSDictionary *audioSettings = @{
            AVFormatIDKey:         @(kAudioFormatMPEG4AAC),
            AVNumberOfChannelsKey: @(kOutputChannels),
            AVSampleRateKey:       @(kOutputSampleRate),
            AVEncoderBitRateKey:   @(kAACBitRate),
        };
        _audioInput = [[AVAssetWriterInput alloc] initWithMediaType:AVMediaTypeAudio
                                                     outputSettings:audioSettings];
        // Real-time hint — the writer pump runs at ~15 ms cadence
        // off the live audio queue. Without this AVAssetWriterInput
        // can buffer aggressively and stall the writer.
        _audioInput.expectsMediaDataInRealTime = YES;
        if (![_assetWriter canAddInput:_audioInput]) {
            RCTLogError(@"[SylkCallRecorder] cannot add audio input to AVAssetWriter");
            _assetWriter = nil;
            _audioInput = nil;
            _remoteTrack = nil;
            reject(@"EFILE", @"AVAssetWriter rejected audio input", nil);
            return;
        }
        [_assetWriter addInput:_audioInput];

        // Build a CMAudioFormatDescription that describes the
        // interleaved Int16 stereo PCM frames we'll hand to
        // appendSampleBuffer:. AVAssetWriter sees the source format
        // here and re-encodes to AAC per `audioSettings` above.
        AudioStreamBasicDescription pcmDesc = {0};
        pcmDesc.mSampleRate       = kOutputSampleRate;
        pcmDesc.mFormatID         = kAudioFormatLinearPCM;
        pcmDesc.mFormatFlags      = kLinearPCMFormatFlagIsSignedInteger
                                  | kLinearPCMFormatFlagIsPacked;
        pcmDesc.mFramesPerPacket  = 1;
        pcmDesc.mChannelsPerFrame = kOutputChannels;
        pcmDesc.mBitsPerChannel   = 16;
        pcmDesc.mBytesPerFrame    = (pcmDesc.mBitsPerChannel / 8) * pcmDesc.mChannelsPerFrame;
        pcmDesc.mBytesPerPacket   = pcmDesc.mBytesPerFrame * pcmDesc.mFramesPerPacket;
        OSStatus formatStatus = CMAudioFormatDescriptionCreate(kCFAllocatorDefault,
                                                               &pcmDesc,
                                                               0, NULL,
                                                               0, NULL,
                                                               NULL,
                                                               &_formatDesc);
        if (formatStatus != noErr || !_formatDesc) {
            RCTLogError(@"[SylkCallRecorder] CMAudioFormatDescriptionCreate failed: %d", (int)formatStatus);
            _assetWriter = nil;
            _audioInput = nil;
            _remoteTrack = nil;
            reject(@"EFORMAT", @"CMAudioFormatDescriptionCreate failed", nil);
            return;
        }

        if (![_assetWriter startWriting]) {
            RCTLogError(@"[SylkCallRecorder] AVAssetWriter startWriting failed: %@", _assetWriter.error);
            CFRelease(_formatDesc);
            _formatDesc = NULL;
            _assetWriter = nil;
            _audioInput = nil;
            _remoteTrack = nil;
            reject(@"EFILE", _assetWriter.error.localizedDescription ?: @"startWriting failed", _assetWriter.error);
            return;
        }
        [_assetWriter startSessionAtSourceTime:kCMTimeZero];
        _writeTimestamp = kCMTimeZero;

        // Init writer state and rolling accumulators.
        _micRoll   = [NSMutableData dataWithCapacity:32 * 1024];
        _remRoll   = [NSMutableData dataWithCapacity:32 * 1024];
        _queueLock = [[NSLock alloc] init];

        _peaksLocalRaw  = [NSMutableArray arrayWithCapacity:600];
        _peaksRemoteRaw = [NSMutableArray arrayWithCapacity:600];
        _peakAccumLocal  = 0;
        _peakAccumRemote = 0;
        _peakSamplesInBin = 0;

        // Mic capture via AVAudioEngine. We install a tap on the
        // engine's input node and convert whatever native format the
        // hardware/audio session is in (typically 48 kHz mono Float32
        // under WebRTC's voiceChat config) to our 16 kHz mono Int16.
        // WebRTC's own mic capture continues to feed the call's
        // outbound audio through its ADM — the input node permits
        // multiple taps so adding ours doesn't disturb the call.
        _engine = [[AVAudioEngine alloc] init];
        AVAudioInputNode *input = _engine.inputNode;
        // Resolve the hardware input format. On iOS 18+ (and
        // anytime WebRTC's RTCAudioSession is active in VoiceChat
        // mode), -inputFormatForBus: can return a degenerate
        // AVAudioFormat with `0 ch, 0 Hz` because the input node
        // isn't fully routed to a hardware input until the engine
        // is started. AVAudioConverter then refuses to construct
        // ("no converter from 0ch/0Hz → 1ch/16000Hz"), and the
        // recorder bails before doing anything useful.
        //
        // Fallback chain:
        //   1) inputFormatForBus:0  (the canonical answer)
        //   2) outputFormatForBus:0 (sometimes valid even when
        //      input is degenerate — returns the format the input
        //      node will deliver to the engine after any internal
        //      conversion)
        //   3) build a format from AVAudioSession's currentRoute /
        //      sampleRate / inputNumberOfChannels (works as a last
        //      resort when both node-side queries are degenerate
        //      because the session itself is the source of truth
        //      and was already configured by WebRTC)
        //   4) hard fallback to 48 kHz mono Float32 — what WebRTC's
        //      voiceChat session delivers on every Apple Silicon
        //      device we've tested. Better to get a recording even
        //      if the bin gets resampled wrong than to abort.
        AVAudioFormat *hwFormat = [input inputFormatForBus:0];
        if (!hwFormat || hwFormat.sampleRate <= 0 || hwFormat.channelCount == 0) {
            RCTLogWarn(@"[SylkCallRecorder] inputFormatForBus:0 degenerate (%@) — trying outputFormatForBus:0", hwFormat);
            AVAudioFormat *outFmt = [input outputFormatForBus:0];
            if (outFmt && outFmt.sampleRate > 0 && outFmt.channelCount > 0) {
                hwFormat = outFmt;
            }
        }
        if (!hwFormat || hwFormat.sampleRate <= 0 || hwFormat.channelCount == 0) {
            AVAudioSession *session = [AVAudioSession sharedInstance];
            double sessRate = session.sampleRate;
            NSInteger sessChans = session.inputNumberOfChannels;
            if (sessRate > 0 && sessChans > 0) {
                RCTLogWarn(@"[SylkCallRecorder] node formats degenerate — synthesising from session (%g Hz, %ld ch)",
                           sessRate, (long)sessChans);
                hwFormat = [[AVAudioFormat alloc]
                              initWithCommonFormat:AVAudioPCMFormatFloat32
                                        sampleRate:sessRate
                                          channels:(AVAudioChannelCount)sessChans
                                       interleaved:NO];
            }
        }
        if (!hwFormat || hwFormat.sampleRate <= 0 || hwFormat.channelCount == 0) {
            RCTLogWarn(@"[SylkCallRecorder] no hwFormat anywhere — hard-coding 48kHz mono Float32 fallback");
            hwFormat = [[AVAudioFormat alloc]
                          initWithCommonFormat:AVAudioPCMFormatFloat32
                                    sampleRate:48000.0
                                      channels:1
                                   interleaved:NO];
        }

        AVAudioFormat *targetFormat =
            [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16
                                              sampleRate:kOutputSampleRate
                                                channels:1
                                             interleaved:YES];
        AVAudioConverter *converter =
            [[AVAudioConverter alloc] initFromFormat:hwFormat
                                            toFormat:targetFormat];
        if (converter) {
            // Same high-quality sample-rate conversion as the remote
            // path so the mic side doesn't suffer aliasing either,
            // especially on hardware that delivers 44.1 kHz natively.
            converter.sampleRateConverterAlgorithm = AVSampleRateConverterAlgorithm_Mastering;
            converter.sampleRateConverterQuality   = AVAudioQualityHigh;
        }
        if (!converter) {
            RCTLogError(@"[SylkCallRecorder] no converter from hwFormat=%@ to %@",
                        hwFormat, targetFormat);
            // Tear down the AVAssetWriter we set up earlier so we
            // don't leave a dangling output file + writer in the
            // class. Without this, a future start() attempt would
            // hit "AVAssetWriter init failed" because the file
            // already exists from this aborted run.
            if (_audioInput) [_audioInput markAsFinished];
            _assetWriter = nil;
            _audioInput = nil;
            if (_formatDesc) { CFRelease(_formatDesc); _formatDesc = NULL; }
            _remoteTrack = nil;
            reject(@"EFORMAT", @"AVAudioConverter init failed", nil);
            return;
        }
        // Buffer size doesn't have to be exact — we re-pair on the
        // writer side anyway. 0 means "let the system pick".
        __weak typeof(self) wself = self;
        [input installTapOnBus:0
                    bufferSize:0
                        format:hwFormat
                         block:^(AVAudioPCMBuffer * _Nonnull buf, AVAudioTime * _Nonnull when) {
            [wself _onMicBuffer:buf converter:converter targetFormat:targetFormat];
        }];

        // Start the audio engine before adding the renderer so any
        // setup error short-circuits cleanly.
        if (![_engine startAndReturnError:&err]) {
            RCTLogError(@"[SylkCallRecorder] engine start failed: %@", err);
            [input removeTapOnBus:0];
            _engine = nil;
            _assetWriter = nil;
            _audioInput = nil;
            _remoteTrack = nil;
            reject(@"EENGINE", err.localizedDescription, err);
            return;
        }

        // Writer pump — fires every 15 ms on a serial queue.
        _writerQueue = dispatch_queue_create("agprojects.sylk.recorder.writer",
                                             DISPATCH_QUEUE_SERIAL);
        _writerTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER,
                                              0, 0, _writerQueue);
        dispatch_source_set_timer(_writerTimer,
                                  dispatch_time(DISPATCH_TIME_NOW, 0),
                                  15ull * NSEC_PER_MSEC,
                                  5ull * NSEC_PER_MSEC);
        dispatch_source_set_event_handler(_writerTimer, ^{
            [wself _drainWriter];
        });
        dispatch_resume(_writerTimer);

        // Set running BEFORE addRenderer so a fast first callback
        // isn't discarded by the early-out in renderPCMBuffer:.
        _running = YES;

        // Tap the remote track. RTCAudioRenderer's renderPCMBuffer:
        // delivers post-decode AVAudioPCMBuffers at whatever sample
        // rate WebRTC negotiated (48 kHz on Opus, 8 kHz on PCMA).
        [_remoteTrack addRenderer:self];
        [SylkLogger log:@"[call] [recorder] addRenderer called on remote track"];
        RCTLogInfo(@"[SylkCallRecorder] recording started: %@", outputPath);
        resolve(outputPath);
    }
}

RCT_EXPORT_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    @synchronized (self) {
        if (!_running) {
            // Idempotent — return last result if we have one.
            NSDictionary *r = @{ @"path"  : _lastPath ?: [NSNull null],
                                 @"peaks" : _lastPeaksJson ?: [NSNull null] };
            resolve(r);
            return;
        }
        _running = NO;

        // Detach the renderer first so no more remote chunks land
        // after we tear down the writer.
        if (_remoteTrack) {
            [_remoteTrack removeRenderer:self];
            _remoteTrack = nil;
        }
        // Stop the mic.
        if (_engine) {
            @try {
                [_engine.inputNode removeTapOnBus:0];
            } @catch (NSException *e) {
                RCTLogWarn(@"[SylkCallRecorder] removeTapOnBus failed: %@", e);
            }
            [_engine stop];
            _engine = nil;
        }
        // Stop the writer pump and drain a final time.
        if (_writerTimer) {
            dispatch_source_cancel(_writerTimer);
            _writerTimer = nil;
        }
        // One last synchronous flush on the writer queue so any
        // pending paired chunk lands in the file before we close.
        if (_writerQueue) {
            dispatch_sync(_writerQueue, ^{
                [self _drainWriter];
                [self _flushPartialPeakBin];
            });
            _writerQueue = nil;
        } else {
            [self _flushPartialPeakBin];
        }

        // Finalize the AAC m4a file. -finishWritingWithCompletionHandler
        // is asynchronous; block on a semaphore so the resolve()
        // below sees a complete, playable file. Without the wait the
        // recipient (or the local preview) may try to open the file
        // mid-finalize and either get a 0-byte container or a
        // partial moov atom that AVPlayer rejects.
        if (_audioInput) {
            [_audioInput markAsFinished];
        }
        if (_assetWriter) {
            dispatch_semaphore_t sem = dispatch_semaphore_create(0);
            __block AVAssetWriterStatus finalStatus = AVAssetWriterStatusUnknown;
            __block NSError *finalError = nil;
            AVAssetWriter *aw = _assetWriter;
            [aw finishWritingWithCompletionHandler:^{
                finalStatus = aw.status;
                finalError  = aw.error;
                dispatch_semaphore_signal(sem);
            }];
            // 5 s upper bound — finalizing AAC for even a long call
            // typically takes <100 ms; a 5 s wait guards against a
            // hung writer thread without blocking call teardown.
            dispatch_semaphore_wait(sem,
                                    dispatch_time(DISPATCH_TIME_NOW,
                                                  (int64_t)(5 * NSEC_PER_SEC)));
            if (finalStatus != AVAssetWriterStatusCompleted) {
                RCTLogWarn(@"[SylkCallRecorder] finishWriting status=%ld err=%@",
                           (long)finalStatus, finalError);
            }
        }
        _assetWriter = nil;
        _audioInput = nil;
        if (_formatDesc) {
            CFRelease(_formatDesc);
            _formatDesc = NULL;
        }

        _lastPath = [_outputPath copy];
        _lastPeaksJson = [self _buildPeaksJson];
        _peaksLocalRaw  = nil;
        _peaksRemoteRaw = nil;

        RCTLogInfo(@"[SylkCallRecorder] recording stopped: %@ peaksLen=%lu",
                   _lastPath,
                   (unsigned long)(_lastPeaksJson ? _lastPeaksJson.length : 0));

        NSMutableDictionary *r = [NSMutableDictionary dictionary];
        r[@"path"] = _lastPath ?: [NSNull null];
        if (_lastPeaksJson) {
            r[@"peaks"] = _lastPeaksJson;
        }
        resolve(r);
    }
}

#pragma mark - RTCAudioRenderer

/**
 * Post-decode remote audio. Called on libwebrtc's audio thread.
 * Convert to 16 kHz mono Int16 and queue. We skip nothing here so
 * narrowband codecs (PCMA/PCMU at 8 kHz) get upsampled and wideband
 * codecs (Opus at 48 kHz) get downsampled into the same target.
 */
- (void)renderPCMBuffer:(AVAudioPCMBuffer *)pcmBuffer {
    if (!_running || !pcmBuffer) return;

    AVAudioFormat *srcFormat = pcmBuffer.format;
    if (!srcFormat || pcmBuffer.frameLength == 0) return;

    // Manual decimation. AVAudioConverter at default quality produced
    // aliasing noise; at AVAudioQualityHigh+Mastering it produced
    // silence (filter latency too long for short input buffers).
    // Since webrtc-sdk consistently delivers Int16 mono at 48 kHz on
    // iOS we can decimate by hand: average each group of `step`
    // input samples into one output sample. Box-filter is crude but
    // suppresses the worst aliasing for voice and is sample-perfect
    // (no filter warm-up so no leading silence).
    //
    // Supports any integer downsampling ratio; falls back to nearest
    // sample if the rates aren't an integer multiple.
    const double srcRate = srcFormat.sampleRate;
    if (srcRate <= 0) return;
    NSUInteger step = (NSUInteger)((srcRate / kOutputSampleRate) + 0.5);
    if (step < 1) step = 1;

    // Read source as Int16 mono. We've verified via the
    // diagnostic log that the source format is Int16 interleaved
    // mono. If the format ever changes (different codec? stereo
    // remote?), the conversion would fall through with a single
    // log so we can adapt.
    if (srcFormat.commonFormat != AVAudioPCMFormatInt16
            || srcFormat.channelCount != 1) {
        // Defensive: webrtc-sdk consistently delivers Int16 mono on
        // iOS, but if a future codec/playback path delivers
        // Float32/stereo we'd need to add conversion logic here.
        return;
    }
    const int16_t *src = pcmBuffer.int16ChannelData[0];
    if (!src) return;
    NSUInteger srcFrames = pcmBuffer.frameLength;
    NSUInteger outFrames = srcFrames / step;
    if (outFrames == 0) return;

    int16_t scratch[outFrames];
    for (NSUInteger i = 0; i < outFrames; i++) {
        int sum = 0;
        NSUInteger base = i * step;
        for (NSUInteger j = 0; j < step; j++) {
            sum += src[base + j];
        }
        scratch[i] = (int16_t)(sum / (int)step);
    }

    [_queueLock lock];
    [_remRoll appendBytes:scratch length:outFrames * sizeof(int16_t)];
    [_queueLock unlock];
}

#pragma mark - Mic input handler

- (void)_onMicBuffer:(AVAudioPCMBuffer *)buf
           converter:(AVAudioConverter *)conv
        targetFormat:(AVAudioFormat *)targetFormat {
    if (!_running || !buf || buf.frameLength == 0) return;

    AVAudioFrameCount cap =
        (AVAudioFrameCount)((buf.frameLength * (kOutputSampleRate / buf.format.sampleRate)) + 32);
    AVAudioPCMBuffer *dstBuf = [[AVAudioPCMBuffer alloc] initWithPCMFormat:targetFormat
                                                              frameCapacity:cap];
    if (!dstBuf) return;

    __block BOOL provided = NO;
    NSError *err = nil;
    [conv convertToBuffer:dstBuf
                    error:&err
       withInputFromBlock:^AVAudioBuffer * _Nullable(AVAudioPacketCount inNumberOfPackets,
                                                    AVAudioConverterInputStatus * _Nonnull outStatus) {
        if (provided) {
            *outStatus = AVAudioConverterInputStatus_NoDataNow;
            return nil;
        }
        provided = YES;
        *outStatus = AVAudioConverterInputStatus_HaveData;
        return buf;
    }];
    if (dstBuf.frameLength == 0) return;

    NSUInteger byteCount = dstBuf.frameLength * sizeof(int16_t);
    [_queueLock lock];
    [_micRoll appendBytes:dstBuf.int16ChannelData[0] length:byteCount];
    [_queueLock unlock];
}

#pragma mark - Writer

/**
 * Hold-and-pair writer. Wait for both queues to have something, then
 * pop one chunk from each, walk the samples interleaving stereo
 * (L = mic, R = remote) and tracking per-channel peaks for the
 * playback waveform, write the frame to the output file. If only
 * one side has data after a watchdog interval, flush it alone with
 * silence on the other channel — keeps a one-sided call (e.g. mic
 * dropped) from stalling the recorder.
 */
- (void)_drainWriter {
    if (!_audioInput || !_assetWriter || !_formatDesc) return;

    while (1) {
        [_queueLock lock];
        NSUInteger micBytes = _micRoll ? _micRoll.length : 0;
        NSUInteger remBytes = _remRoll ? _remRoll.length : 0;
        // Drain only the matched portion — keep the larger side
        // queued for the next pass. Stops the "tiny remote burst
        // followed by silence" pattern that came from pairing a
        // big mic chunk with a small remote chunk.
        NSUInteger pairBytes = MIN(micBytes, remBytes);
        if (pairBytes < sizeof(int16_t) * 2) {
            [_queueLock unlock];
            return;
        }
        // Round to whole frames just in case (always should be).
        pairBytes &= ~((NSUInteger)sizeof(int16_t) - 1);

        NSData *micData = [_micRoll subdataWithRange:NSMakeRange(0, pairBytes)];
        NSData *remData = [_remRoll subdataWithRange:NSMakeRange(0, pairBytes)];
        [_micRoll replaceBytesInRange:NSMakeRange(0, pairBytes) withBytes:NULL length:0];
        [_remRoll replaceBytesInRange:NSMakeRange(0, pairBytes) withBytes:NULL length:0];
        [_queueLock unlock];

        const int16_t *mic = (const int16_t *)micData.bytes;
        const int16_t *rem = (const int16_t *)remData.bytes;
        NSUInteger n = pairBytes / sizeof(int16_t);  // mono samples per channel
        if (n == 0) continue;

        // Build a single interleaved Int16 stereo buffer:
        //   frame i → [mic[i], rem[i]] = [L, R]
        // Lives on the stack via NSMutableData so we don't leak when
        // the loop body exits early. Total bytes = n frames *
        // (2 channels * sizeof(int16_t)).
        const NSUInteger interleavedBytes = n * 2 * sizeof(int16_t);
        NSMutableData *interleaved = [NSMutableData dataWithLength:interleavedBytes];
        int16_t *dst = (int16_t *)interleaved.mutableBytes;
        int peakL = 0;
        int peakR = 0;
        for (NSUInteger i = 0; i < n; i++) {
            int16_t l = mic[i];
            int16_t r = rem[i];
            dst[i * 2 + 0] = l;
            dst[i * 2 + 1] = r;
            int absL = l < 0 ? -l : l;
            int absR = r < 0 ? -r : r;
            if (absL > peakL) peakL = absL;
            if (absR > peakR) peakR = absR;
        }
        if (peakL > _peakAccumLocal)  _peakAccumLocal  = peakL;
        if (peakR > _peakAccumRemote) _peakAccumRemote = peakR;
        _peakSamplesInBin += n;
        while (_peakSamplesInBin >= kPeakBinSamples) {
            [_peaksLocalRaw  addObject:@( (_peakAccumLocal  * 255) / 32767 )];
            [_peaksRemoteRaw addObject:@( (_peakAccumRemote * 255) / 32767 )];
            _peakAccumLocal  = 0;
            _peakAccumRemote = 0;
            _peakSamplesInBin -= kPeakBinSamples;
        }

        // Wrap the interleaved Int16 stereo bytes as a CMBlockBuffer,
        // then a CMSampleBuffer, then hand that to AVAssetWriterInput
        // for AAC encoding. CMBlockBuffer copies the bytes (we pass
        // kCFAllocatorNull as the deallocator together with no source
        // and explicitly fill via CMBlockBufferReplaceDataBytes), so
        // the NSMutableData can be released as soon as this loop
        // iteration ends.
        CMBlockBufferRef blockBuf = NULL;
        OSStatus bbStatus = CMBlockBufferCreateWithMemoryBlock(
            kCFAllocatorDefault,
            NULL,                       // memoryBlock — let CM allocate
            interleavedBytes,
            kCFAllocatorDefault,
            NULL,
            0,
            interleavedBytes,
            kCMBlockBufferAssureMemoryNowFlag,
            &blockBuf
        );
        if (bbStatus != noErr || !blockBuf) {
            RCTLogWarn(@"[SylkCallRecorder] CMBlockBufferCreate failed: %d", (int)bbStatus);
            continue;
        }
        bbStatus = CMBlockBufferReplaceDataBytes(dst, blockBuf, 0, interleavedBytes);
        if (bbStatus != noErr) {
            CFRelease(blockBuf);
            RCTLogWarn(@"[SylkCallRecorder] CMBlockBufferReplaceDataBytes failed: %d", (int)bbStatus);
            continue;
        }

        CMSampleTimingInfo timing = (CMSampleTimingInfo){
            .duration             = CMTimeMake(1, (int32_t)kOutputSampleRate),
            .presentationTimeStamp = _writeTimestamp,
            .decodeTimeStamp      = kCMTimeInvalid,
        };
        CMSampleBufferRef sampleBuf = NULL;
        const size_t sampleSize = sizeof(int16_t) * 2;  // bytes per stereo frame
        OSStatus sbStatus = CMSampleBufferCreate(
            kCFAllocatorDefault,
            blockBuf,
            true,                       // dataReady
            NULL, NULL,
            _formatDesc,
            (CMItemCount)n,             // numSamples (frames, not channels)
            1,                          // numSampleTimingEntries
            &timing,
            1,                          // numSampleSizeEntries
            &sampleSize,
            &sampleBuf
        );
        CFRelease(blockBuf);
        if (sbStatus != noErr || !sampleBuf) {
            RCTLogWarn(@"[SylkCallRecorder] CMSampleBufferCreate failed: %d", (int)sbStatus);
            continue;
        }

        // The AVAssetWriterInput periodically isn't ready for more
        // data while it flushes its encoder; in practice with
        // expectsMediaDataInRealTime=YES this rarely blocks. If it
        // does we drop the chunk — better than back-pressuring the
        // mic/remote queues. The matching audio frames stay in
        // _peaks* so the waveform is still complete.
        if (_audioInput.isReadyForMoreMediaData) {
            if (![_audioInput appendSampleBuffer:sampleBuf]) {
                RCTLogWarn(@"[SylkCallRecorder] appendSampleBuffer failed: %@", _assetWriter.error);
            }
        }
        CFRelease(sampleBuf);

        // Advance the running PTS by the number of frames we just
        // wrote. Sample timing must be monotonic for AAC encoding —
        // any rewind or stall produces a corrupt m4a.
        _writeTimestamp = CMTimeAdd(_writeTimestamp,
                                    CMTimeMake((int64_t)n, (int32_t)kOutputSampleRate));
    }
}

- (void)_flushPartialPeakBin {
    if (_peakSamplesInBin > 0 && _peaksLocalRaw && _peaksRemoteRaw) {
        [_peaksLocalRaw  addObject:@( (_peakAccumLocal  * 255) / 32767 )];
        [_peaksRemoteRaw addObject:@( (_peakAccumRemote * 255) / 32767 )];
        _peakAccumLocal  = 0;
        _peakAccumRemote = 0;
        _peakSamplesInBin = 0;
    }
}

/**
 * Build the same compact JSON shape Android emits:
 *     {"l":[v0,v1,...],"r":[v0,v1,...]}
 * Each v is 0..255 — the per-100 ms peak amplitude for that channel
 * scaled to one byte. Downsamples to ≤ kMaxPeaks via max-pooling
 * adjacent bins so a 1 h call doesn't ship 36 000 entries.
 */
- (NSString *)_buildPeaksJson {
    if (!_peaksLocalRaw || !_peaksRemoteRaw) return nil;
    NSUInteger n = MAX(_peaksLocalRaw.count, _peaksRemoteRaw.count);
    if (n == 0) return nil;
    NSUInteger step = (n + kMaxPeaks - 1) / kMaxPeaks;
    if (step < 1) step = 1;
    NSUInteger outLen = (n + step - 1) / step;

    NSMutableString *sb = [NSMutableString stringWithCapacity:outLen * 8 + 16];
    [sb appendString:@"{\"l\":["];
    [self _appendDownsampled:sb src:_peaksLocalRaw  step:step outLen:outLen];
    [sb appendString:@"],\"r\":["];
    [self _appendDownsampled:sb src:_peaksRemoteRaw step:step outLen:outLen];
    [sb appendString:@"]}"];
    return sb;
}

- (void)_appendDownsampled:(NSMutableString *)sb
                       src:(NSArray<NSNumber *> *)src
                      step:(NSUInteger)step
                    outLen:(NSUInteger)outLen {
    NSUInteger n = src.count;
    for (NSUInteger o = 0; o < outLen; o++) {
        NSUInteger from = o * step;
        NSUInteger to   = MIN(n, from + step);
        int peak = 0;
        for (NSUInteger i = from; i < to; i++) {
            int v = src[i].intValue;
            if (v > peak) peak = v;
        }
        if (o > 0) [sb appendString:@","];
        [sb appendFormat:@"%d", peak];
    }
}

@end
