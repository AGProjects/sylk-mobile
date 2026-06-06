// MediaEncryptorJni.cpp — Sylk ZRTP FrameEncryptor / FrameDecryptor.
//
// Phase 2 noop classes (passthrough) are kept for diagnostics + the
// Phase 3 keyed AES-128-GCM classes that are what an actual encrypted
// call uses are added below. The keyed path JNI-callbacks into the Java
// helpers SylkE2EE.aesGcmEncrypt / aesGcmDecrypt for each frame so we
// don't need to vendor a C crypto library into the native build.
//
// Frame layout (Phase 3, audio-only Opus = 0 codec passthrough bytes):
//
//   [1B header   = 4b version=1 | 4b keyId]
//   [4B counter  = monotonic per-direction, big-endian]
//   [   ciphertext     ]   (same length as plaintext)
//   [16B GCM auth tag  ]
//
// IV  = salt(8) || counter(4)            (12 bytes, all GCM IVs)
// AAD = header(1) || counter(4)          (5 bytes, authenticated only)

#include <jni.h>
#include <android/log.h>
#include <atomic>
#include <cstring>
#include <cstdint>
#include <mutex>
#include <vector>

#include "sylk_webrtc_compat.h"

// Use SYLK_APP so these lines are captured by metro-adb-logs.sh (which runs
// `logcat -s SYLK_APP:V '*:S'` — every other tag is silenced).
#define LOG_TAG "SYLK_APP"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

// The wire-format build tag now lives in sylk_e2ee_build.h (single source of
// truth, also included by sylk_e2ee.cpp where nativeGetBuild() reports it).
// Bump it THERE on any wire-format / framing / prefix change.
//
// 2026-06-04: added the NAL-aware H.264 path (per-NAL AES-GCM, start codes +
// NAL headers kept in plaintext, ciphertext emulation-prevention-escaped so
// libwebrtc's H264 packetizer can still walk the frame). Selected per-track
// by the isH264 flag the JS install passes for an H264-negotiated video
// track. VP8/VP9/AV1/audio still use the v1 whole-frame scheme below.
#include "sylk_e2ee_build.h"

// ---- JNI cache: SylkE2EE class + AES-GCM method IDs -----------------------
//
// One-time initialization on the first call into either an encryptor or
// decryptor. We hold a global ref to the class and cache the method IDs
// so the per-frame call only needs AttachCurrentThread + array marshaling.

namespace {

JavaVM*   g_jvm                 = nullptr;
jclass    g_sylkE2EEClass       = nullptr;
jmethodID g_aesGcmEncryptMid    = nullptr;
jmethodID g_aesGcmDecryptMid    = nullptr;
std::once_flag g_jniInitFlag;

void InitJniCacheLocked(JNIEnv* env) {
    env->GetJavaVM(&g_jvm);
    jclass localClass = env->FindClass("com/oney/WebRTCModule/SylkE2EE");
    if (!localClass) {
        LOGE("FindClass com/oney/WebRTCModule/SylkE2EE failed");
        return;
    }
    g_sylkE2EEClass = (jclass)env->NewGlobalRef(localClass);
    env->DeleteLocalRef(localClass);
    g_aesGcmEncryptMid = env->GetStaticMethodID(
        g_sylkE2EEClass, "aesGcmEncrypt", "([B[B[B[B)[B");
    g_aesGcmDecryptMid = env->GetStaticMethodID(
        g_sylkE2EEClass, "aesGcmDecrypt", "([B[B[B[B)[B");
    if (!g_aesGcmEncryptMid || !g_aesGcmDecryptMid) {
        LOGE("GetStaticMethodID(aesGcmEncrypt/Decrypt) failed");
    }
}

void EnsureJniCache(JNIEnv* env) {
    std::call_once(g_jniInitFlag, [env]() { InitJniCacheLocked(env); });
}

JNIEnv* AttachThread(bool* outDidAttach) {
    JNIEnv* env = nullptr;
    if (!g_jvm) return nullptr;
    int status = g_jvm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6);
    *outDidAttach = false;
    if (status == JNI_EDETACHED) {
        if (g_jvm->AttachCurrentThread(&env, nullptr) == JNI_OK) {
            *outDidAttach = true;
        } else {
            return nullptr;
        }
    }
    return env;
}

void DetachThread(bool didAttach) {
    if (didAttach && g_jvm) {
        g_jvm->DetachCurrentThread();
    }
}

// Build a 12-byte IV from salt(8) and a big-endian 32-bit counter.
inline void BuildIV(const uint8_t salt[8], uint32_t counter, uint8_t out[12]) {
    std::memcpy(out, salt, 8);
    out[8]  = (uint8_t)((counter >> 24) & 0xff);
    out[9]  = (uint8_t)((counter >> 16) & 0xff);
    out[10] = (uint8_t)((counter >>  8) & 0xff);
    out[11] = (uint8_t)( counter        & 0xff);
}

// ===========================================================================
// NAL-aware H.264 helpers
// ===========================================================================
//
// Why this exists: the v1 scheme above AES-GCMs the whole encoded frame after
// a fixed plaintext prefix. libwebrtc then RUNS THE H264 PACKETIZER ON THE
// ENCRYPTED OUTPUT — RtpPacketizerH264 calls H264::FindNaluIndices() which
// scans the buffer for Annex-B start codes (00 00 01) to split it into NAL
// units (STAP-A aggregates small NALs, FU-A fragments big ones). v1 encrypts
// those start codes + NAL headers, so the packetizer reads garbage and the
// receiver can't reassemble — H264 video froze.
//
// The NAL-aware scheme keeps the frame a VALID Annex-B byte stream end to end:
//   * every start code is copied through verbatim
//   * every 1-byte NAL header is copied through verbatim (packetizer reads the
//     NAL type from it to decide STAP-A vs FU-A)
//   * only each NAL's *body* (the bytes after the 1-byte header) is encrypted
//   * the per-NAL ciphertext blob is emulation-prevention-escaped so it can
//     never contain a false 00 00 01 that would fool FindNaluIndices()
//
// Per-NAL wire layout, written in place of the original NAL body:
//
//   [start code]            (verbatim, 00 00 01 / 00 00 00 01)
//   [NAL header : 1B]       (verbatim)
//   EPB( [v|keyId : 1B] [counter : 4B BE] [ptlen : 4B BE] [ciphertext] [GCM tag : 16B] )
//
// IV  = salt(8) || counter(4)                       (12 B, per-NAL unique)
// AAD = (v|keyId)(1) || counter(4) || NAL header(1) (6 B, authenticated only)
//
// The explicit ptlen (plaintext length == ciphertext length) is REQUIRED:
// WebRTC's H264 depacketizer reassembles every NAL with a 4-byte start code
// (00 00 00 01) regardless of what we emitted, so the byte before each start
// code (one extra 0x00) gets absorbed into the previous NAL's body by a
// scan-to-next-start-code delimiter. Without ptlen the decryptor would feed
// that trailing 0x00 into AES-GCM, misaligning the tag and failing every
// multi-NAL frame. With ptlen we extract exactly [ciphertext][tag] and ignore
// any trailing start-code padding.
//
// v = 3 here (v1 = whole-frame; v2 = the first, length-less NAL scheme that
// hit the bug above) so mismatched builds never cross-decode.

static constexpr uint8_t kNalVersion = 3;
static constexpr size_t  kNalHeaderLen = 1;
static constexpr size_t  kNalLenLen    = 4;   // ptlen field width (BE)
// Per-NAL blob header BEFORE the ciphertext: v|keyId(1) + counter(4) + ptlen(4).
static constexpr size_t  kNalBlobHdr   = 1 + 4 + 4;
// Per-NAL overhead BEFORE emulation-prevention expansion: blob header + tag.
static constexpr size_t  kNalOverheadRaw = kNalBlobHdr + 16 /*tag*/;

// Find the next Annex-B start code (00 00 01) at or after `from`. Returns the
// index of its leading 0x00, or `n` if none. A 4-byte start code (00 00 00 01)
// is reported at the position of its last three bytes; the extra leading 0x00
// is treated as belonging to the preceding NAL body (which round-trips fine —
// it comes back as a trailing/leading zero byte that the decoder tolerates).
inline size_t FindStartCode(const uint8_t* d, size_t n, size_t from) {
    if (n < 3) return n;
    for (size_t i = from; i + 3 <= n; ++i) {
        if (d[i] == 0x00 && d[i + 1] == 0x00 && d[i + 2] == 0x01) {
            return i;
        }
    }
    return n;
}

// H.264 Annex-B emulation prevention: insert an emulation_prevention_three_byte
// (0x03) so the output never contains 00 00 00 / 00 00 01 / 00 00 02 / 00 00 03.
// Applied to our whole per-NAL blob so the packetizer's start-code scan can't
// trip over random ciphertext bytes.
inline void EpbEscape(const uint8_t* in, size_t n, std::vector<uint8_t>& out) {
    out.clear();
    out.reserve(n + (n >> 1) + 4);
    size_t zeros = 0;
    for (size_t i = 0; i < n; ++i) {
        const uint8_t b = in[i];
        if (zeros >= 2 && b <= 0x03) {
            out.push_back(0x03);
            zeros = 0;
        }
        out.push_back(b);
        zeros = (b == 0x00) ? (zeros + 1) : 0;
    }
}

// Inverse of EpbEscape: drop each 0x03 that follows 00 00 and precedes a byte
// <= 0x03. Exactly inverts EpbEscape for any input EpbEscape produced.
inline void EpbUnescape(const uint8_t* in, size_t n, std::vector<uint8_t>& out) {
    out.clear();
    out.reserve(n);
    size_t zeros = 0;
    for (size_t i = 0; i < n; ++i) {
        const uint8_t b = in[i];
        if (zeros >= 2 && b == 0x03 && (i + 1 < n) && in[i + 1] <= 0x03) {
            zeros = 0;          // emulation_prevention_three_byte — skip it
            continue;
        }
        out.push_back(b);
        zeros = (b == 0x00) ? (zeros + 1) : 0;
    }
}

// Helper: call SylkE2EE.aesGcm(En|De)crypt(key, iv, aad, data) and return
// the resulting byte[] (ciphertext+tag for encrypt, plaintext for decrypt).
// Returns nullptr on Java-side failure (e.g. AEADBadTagException for
// decrypt). Caller is responsible for env->DeleteLocalRef on the result.
jbyteArray CallAesGcm(JNIEnv* env,
                      jmethodID mid,
                      const uint8_t* key, size_t keyLen,
                      const uint8_t* iv,  size_t ivLen,
                      const uint8_t* aad, size_t aadLen,
                      const uint8_t* data, size_t dataLen) {
    jbyteArray jKey = env->NewByteArray((jsize)keyLen);
    env->SetByteArrayRegion(jKey, 0, (jsize)keyLen, (const jbyte*)key);

    jbyteArray jIv = env->NewByteArray((jsize)ivLen);
    env->SetByteArrayRegion(jIv, 0, (jsize)ivLen, (const jbyte*)iv);

    jbyteArray jAad = env->NewByteArray((jsize)aadLen);
    env->SetByteArrayRegion(jAad, 0, (jsize)aadLen, (const jbyte*)aad);

    jbyteArray jData = env->NewByteArray((jsize)dataLen);
    if (dataLen > 0) {
        env->SetByteArrayRegion(jData, 0, (jsize)dataLen, (const jbyte*)data);
    }

    jobject result = env->CallStaticObjectMethod(
        g_sylkE2EEClass, mid, jKey, jIv, jAad, jData);

    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        result = nullptr;
    }

    env->DeleteLocalRef(jKey);
    env->DeleteLocalRef(jIv);
    env->DeleteLocalRef(jAad);
    env->DeleteLocalRef(jData);

    return reinterpret_cast<jbyteArray>(result);
}

}  // namespace

namespace sylke2ee {

// ---- Phase 2: noop classes (kept for diagnostics) -------------------------

class NoopFrameEncryptor : public webrtc::FrameEncryptorInterface {
 public:
    NoopFrameEncryptor() : ref_count_(0) {
        LOGI("NoopFrameEncryptor ctor %p", this);
    }

    int Encrypt(cricket::MediaType /*media_type*/,
                uint32_t /*ssrc*/,
                rtc::ArrayView<const uint8_t> /*additional_data*/,
                rtc::ArrayView<const uint8_t> frame,
                rtc::ArrayView<uint8_t> encrypted_frame,
                size_t* bytes_written) override {
        if (encrypted_frame.size() < frame.size()) return -1;
        std::memcpy(encrypted_frame.data(), frame.data(), frame.size());
        *bytes_written = frame.size();
        return 0;
    }

    size_t GetMaxCiphertextByteSize(cricket::MediaType, size_t frame_size) override {
        return frame_size;
    }

    void AddRef() const override {
        ref_count_.fetch_add(1, std::memory_order_relaxed);
    }
    webrtc::RefCountReleaseStatus Release() const override {
        const int prev = ref_count_.fetch_sub(1, std::memory_order_acq_rel);
        if (prev == 1) { delete this; return webrtc::RefCountReleaseStatus::kDroppedLastRef; }
        return webrtc::RefCountReleaseStatus::kOtherRefsRemained;
    }

 protected:
    ~NoopFrameEncryptor() override { LOGI("NoopFrameEncryptor dtor %p", this); }

 private:
    mutable std::atomic<int> ref_count_;
};

class NoopFrameDecryptor : public webrtc::FrameDecryptorInterface {
 public:
    NoopFrameDecryptor() : ref_count_(0) {
        LOGI("NoopFrameDecryptor ctor %p", this);
    }

    Result Decrypt(cricket::MediaType,
                   const std::vector<uint32_t>&,
                   rtc::ArrayView<const uint8_t>,
                   rtc::ArrayView<const uint8_t> encrypted_frame,
                   rtc::ArrayView<uint8_t> frame) override {
        if (frame.size() < encrypted_frame.size()) return Result(Status::kFailedToDecrypt, 0);
        std::memcpy(frame.data(), encrypted_frame.data(), encrypted_frame.size());
        return Result(Status::kOk, encrypted_frame.size());
    }

    size_t GetMaxPlaintextByteSize(cricket::MediaType, size_t encrypted_frame_size) override {
        return encrypted_frame_size;
    }

    void AddRef() const override {
        ref_count_.fetch_add(1, std::memory_order_relaxed);
    }
    webrtc::RefCountReleaseStatus Release() const override {
        const int prev = ref_count_.fetch_sub(1, std::memory_order_acq_rel);
        if (prev == 1) { delete this; return webrtc::RefCountReleaseStatus::kDroppedLastRef; }
        return webrtc::RefCountReleaseStatus::kOtherRefsRemained;
    }

 protected:
    ~NoopFrameDecryptor() override { LOGI("NoopFrameDecryptor dtor %p", this); }

 private:
    mutable std::atomic<int> ref_count_;
};

// ---- Phase 3: AES-128-GCM via JNI callback into javax.crypto.Cipher ------

static constexpr size_t kKeyLen   = 16;  // AES-128
static constexpr size_t kSaltLen  = 8;
static constexpr size_t kIvLen    = 12;  // GCM
static constexpr size_t kTagLen   = 16;  // GCM 128-bit tag
static constexpr size_t kHeaderLen = 1;
static constexpr size_t kCounterLen = 4;
static constexpr size_t kFrameOverhead = kHeaderLen + kCounterLen + kTagLen;
// = 1 (version|keyId) + 4 (counter) + 16 (tag) = 21 bytes per frame.

class MediaEncryptor : public webrtc::FrameEncryptorInterface {
 public:
    MediaEncryptor(const uint8_t key[kKeyLen],
                   const uint8_t salt[kSaltLen],
                   uint8_t keyId,
                   uint8_t videoPrefix,
                   bool isH264)
        : keyId_(keyId & 0x0f), videoPrefix_(videoPrefix), isH264_(isH264),
          counter_(0), ref_count_(0) {
        std::memcpy(key_, key, kKeyLen);
        std::memcpy(salt_, salt, kSaltLen);
        LOGI("MediaEncryptor ctor %p keyId=%u videoPrefix=%u isH264=%d",
             this, (unsigned)keyId_, (unsigned)videoPrefix_, (int)isH264_);
    }

    // Number of leading plaintext bytes left UN-encrypted on video frames.
    // WebRTC's RTP codec packetizers read several bytes of the encoded
    // frame to extract codec-specific metadata. If we encrypt those bytes,
    // the packetizer reads garbage and the receiver can't reassemble.
    // The exact size depends on the negotiated codec (VP8 = 1, VP9 = 3,
    // H264 = 2-4, AV1 = 1) so JS computes the value at install time and
    // passes it via the constructor — native just stores it.
    size_t UnencryptedPrefixForMediaType(cricket::MediaType mt) const {
        return mt == cricket::MEDIA_TYPE_VIDEO ? (size_t)videoPrefix_ : 0;
    }

    int Encrypt(cricket::MediaType media_type,
                uint32_t /*ssrc*/,
                rtc::ArrayView<const uint8_t> /*additional_data*/,
                rtc::ArrayView<const uint8_t> frame,
                rtc::ArrayView<uint8_t> encrypted_frame,
                size_t* bytes_written) override {
        if (isH264_ && media_type == cricket::MEDIA_TYPE_VIDEO) {
            return EncryptH264(frame, encrypted_frame, bytes_written);
        }
        const size_t prefix = UnencryptedPrefixForMediaType(media_type);
        if (frame.size() < prefix) return -1;
        const size_t need = frame.size() + kFrameOverhead;
        if (encrypted_frame.size() < need) return -1;

        bool didAttach = false;
        JNIEnv* env = AttachThread(&didAttach);
        if (!env) return -1;

        const uint32_t counter = counter_.fetch_add(1, std::memory_order_relaxed);
        uint8_t iv[kIvLen];
        BuildIV(salt_, counter, iv);

        // Header: high nibble = version 1, low nibble = keyId.
        const uint8_t header = static_cast<uint8_t>((1u << 4) | (keyId_ & 0x0f));
        uint8_t aad[kHeaderLen + kCounterLen];
        aad[0] = header;
        std::memcpy(aad + 1, iv + kSaltLen, kCounterLen);

        // Encrypt only bytes AFTER the unencrypted prefix.
        const uint8_t* plainPtr = frame.data() + prefix;
        const size_t   plainLen = frame.size() - prefix;

        jbyteArray jResult = CallAesGcm(env, g_aesGcmEncryptMid,
            key_, kKeyLen, iv, kIvLen, aad, sizeof(aad),
            plainPtr, plainLen);
        if (!jResult) {
            LOGE("MediaEncryptor: Java aesGcmEncrypt returned null");
            DetachThread(didAttach);
            return -1;
        }
        const jsize resultLen = env->GetArrayLength(jResult);
        if ((size_t)resultLen != plainLen + kTagLen) {
            LOGE("MediaEncryptor: unexpected GCM output length %d (want %zu)",
                 (int)resultLen, plainLen + kTagLen);
            env->DeleteLocalRef(jResult);
            DetachThread(didAttach);
            return -1;
        }

        // Layout: [prefix bytes plaintext][header][counter][ciphertext+tag]
        if (prefix > 0) {
            std::memcpy(encrypted_frame.data(), frame.data(), prefix);
        }
        encrypted_frame.data()[prefix] = header;
        std::memcpy(encrypted_frame.data() + prefix + 1, iv + kSaltLen, kCounterLen);
        env->GetByteArrayRegion(jResult, 0, resultLen,
            reinterpret_cast<jbyte*>(
                encrypted_frame.data() + prefix + kHeaderLen + kCounterLen));
        env->DeleteLocalRef(jResult);

        *bytes_written = frame.size() + kFrameOverhead;
        DetachThread(didAttach);
        return 0;
    }

    size_t GetMaxCiphertextByteSize(cricket::MediaType media_type, size_t frame_size) override {
        if (isH264_ && media_type == cricket::MEDIA_TYPE_VIDEO) {
            // Per-NAL overhead (21 B) + worst-case emulation-prevention
            // expansion (~+50%). 2x + 1KB is comfortably above any realistic
            // H264 frame's NAL count; EncryptH264 bails safely if a
            // pathological frame ever exceeds it.
            return frame_size * 2 + 1024;
        }
        return frame_size + kFrameOverhead;
    }

    void AddRef() const override {
        ref_count_.fetch_add(1, std::memory_order_relaxed);
    }
    webrtc::RefCountReleaseStatus Release() const override {
        const int prev = ref_count_.fetch_sub(1, std::memory_order_acq_rel);
        if (prev == 1) { delete this; return webrtc::RefCountReleaseStatus::kDroppedLastRef; }
        return webrtc::RefCountReleaseStatus::kOtherRefsRemained;
    }

 protected:
    ~MediaEncryptor() override { LOGI("MediaEncryptor dtor %p", this); }

 private:
    // NAL-aware encrypt: walk the Annex-B stream, copy start codes + NAL
    // headers verbatim, AES-GCM each NAL body, EPB-escape the result. See the
    // helper-block comment above for the wire layout.
    int EncryptH264(rtc::ArrayView<const uint8_t> frame,
                    rtc::ArrayView<uint8_t> encrypted_frame,
                    size_t* bytes_written) {
        const uint8_t* in  = frame.data();
        const size_t   n   = frame.size();
        uint8_t*       out = encrypted_frame.data();
        const size_t   cap = encrypted_frame.size();
        size_t w = 0;
        int nNal = 0, nEnc = 0, nSkip = 0; uint8_t firstType = 0;  // instrumentation

        auto putRaw = [&](const uint8_t* p, size_t len) -> bool {
            if (w + len > cap) return false;
            if (len) std::memcpy(out + w, p, len);
            w += len;
            return true;
        };

        bool didAttach = false;
        JNIEnv* env = AttachThread(&didAttach);
        if (!env) return -1;

        std::vector<uint8_t> blob;     // [v|keyId][counter][ct+tag]
        std::vector<uint8_t> escaped;  // EPB(blob)

        size_t i = 0;
        int rc = 0;
        while (i < n) {
            const size_t sc = FindStartCode(in, n, i);
            if (sc == n) {                       // no more start codes
                if (!putRaw(in + i, n - i)) { rc = -1; }
                break;
            }
            const size_t headerPos = sc + 3;     // NAL header byte index
            if (headerPos >= n) {                // dangling start code at EOF
                if (!putRaw(in + i, n - i)) { rc = -1; }
                break;
            }
            // Copy verbatim from i through the NAL header byte (inclusive):
            // any leading bytes + the 3-byte start code + the 1-byte header.
            if (!putRaw(in + i, (headerPos - i) + 1)) { rc = -1; break; }

            const size_t bodyStart = headerPos + 1;
            const size_t nextSc     = FindStartCode(in, n, bodyStart);
            const size_t bodyEnd    = (nextSc == n) ? n : nextSc;
            const size_t bodyLen    = bodyEnd - bodyStart;
            const uint8_t nalHeader = in[headerPos];

            // Only encrypt VCL slice NALs (nal_unit_type 1..5). Leave
            // parameter sets / metadata (SEI=6, SPS=7, PPS=8, AUD=9, and any
            // other non-VCL type) in CLEAR. WebRTC's H264 depacketizer parses
            // the SPS for width/height BEFORE our FrameDecryptor runs; an
            // encrypted SPS makes it fail to parse and drop the keyframe, so
            // the decoder never gets a valid IDR and video freezes (audio and
            // packet flow look normal). Parameter sets carry only resolution /
            // profile config, not picture content, so leaving them clear is the
            // standard trade-off for WebRTC video E2EE.
            const uint8_t nalType = nalHeader & 0x1f;
            if (nNal == 0) firstType = nalType;
            nNal++;
            if (nalType < 1 || nalType > 5) {
                nSkip++;
                if (!putRaw(in + bodyStart, bodyLen)) { rc = -1; break; }
                i = bodyEnd; continue;
            }

            const uint32_t counter = counter_.fetch_add(1, std::memory_order_relaxed);
            uint8_t iv[kIvLen];
            BuildIV(salt_, counter, iv);
            const uint8_t vByte = static_cast<uint8_t>((kNalVersion << 4) | (keyId_ & 0x0f));
            uint8_t aad[6];
            aad[0] = vByte;
            std::memcpy(aad + 1, iv + kSaltLen, kCounterLen);  // counter BE
            aad[5] = nalHeader;

            jbyteArray jResult = CallAesGcm(env, g_aesGcmEncryptMid,
                key_, kKeyLen, iv, kIvLen, aad, sizeof(aad),
                in + bodyStart, bodyLen);
            if (!jResult) { LOGE("EncryptH264: aesGcmEncrypt null"); rc = -1; break; }
            const jsize ctLen = env->GetArrayLength(jResult);
            if ((size_t)ctLen != bodyLen + kTagLen) {
                LOGE("EncryptH264: bad GCM out len %d", (int)ctLen);
                env->DeleteLocalRef(jResult);
                rc = -1; break;
            }

            blob.resize(kNalBlobHdr + bodyLen + kTagLen);
            blob[0] = vByte;
            std::memcpy(blob.data() + 1, iv + kSaltLen, kCounterLen);  // counter BE
            // ptlen (BE) = plaintext length == ciphertext length == bodyLen.
            blob[5] = (uint8_t)((bodyLen >> 24) & 0xff);
            blob[6] = (uint8_t)((bodyLen >> 16) & 0xff);
            blob[7] = (uint8_t)((bodyLen >>  8) & 0xff);
            blob[8] = (uint8_t)( bodyLen        & 0xff);
            env->GetByteArrayRegion(jResult, 0, ctLen,
                reinterpret_cast<jbyte*>(blob.data() + kNalBlobHdr));
            env->DeleteLocalRef(jResult);

            EpbEscape(blob.data(), blob.size(), escaped);
            if (encFrames_.load() < 8 && nEnc == 0 && escaped.size() >= 4) {
                LOGI("[encH264?] vByte=0x%02x nalHdr=0x%02x bodyLen=%zu blob[0..3]=%02x%02x%02x%02x esc[0..3]=%02x%02x%02x%02x escN=%zu",
                     (unsigned)vByte, (unsigned)nalHeader, bodyLen,
                     blob[0], blob[1], blob[2], blob[3],
                     escaped[0], escaped[1], escaped[2], escaped[3], escaped.size());
            }
            if (!putRaw(escaped.data(), escaped.size())) { rc = -1; break; }
            nEnc++;

            i = bodyEnd;
        }

        const uint32_t fn = encFrames_.fetch_add(1, std::memory_order_relaxed);
        if (fn < 5 || (fn % 100) == 0) {
            LOGI("[encH264] frame#=%u in=%zu out=%zu nals=%d enc=%d skip=%d firstType=%d%s",
                 fn, n, w, nNal, nEnc, nSkip, (int)firstType, (rc != 0) ? " RC_FAIL" : "");
        }
        DetachThread(didAttach);
        if (rc != 0) return rc;
        *bytes_written = w;
        return 0;
    }

    uint8_t  key_[kKeyLen];
    uint8_t  salt_[kSaltLen];
    uint8_t  keyId_;
    uint8_t  videoPrefix_;   // bytes left plaintext at start of each video frame
    bool     isH264_;        // when true, video frames use the NAL-aware path
    mutable std::atomic<uint32_t> counter_;
    mutable std::atomic<uint32_t> encFrames_{0};   // instrumentation
    mutable std::atomic<int>      ref_count_;
};

class MediaDecryptor : public webrtc::FrameDecryptorInterface {
 public:
    MediaDecryptor(const uint8_t key[kKeyLen],
                   const uint8_t salt[kSaltLen],
                   uint8_t keyId,
                   uint8_t videoPrefix,
                   bool isH264)
        : expectedKeyId_(keyId & 0x0f), videoPrefix_(videoPrefix),
          isH264_(isH264), ref_count_(0) {
        std::memcpy(key_, key, kKeyLen);
        std::memcpy(salt_, salt, kSaltLen);
        LOGI("MediaDecryptor ctor %p keyId=%u videoPrefix=%u isH264=%d",
             this, (unsigned)expectedKeyId_, (unsigned)videoPrefix_, (int)isH264_);
    }

    // Permissive decrypt:
    //   1. If the frame doesn't start with our v1|keyId header, OR is too
    //      short to be encrypted, OR the AES-GCM tag fails to verify, we
    //      pass the input bytes through to the output unchanged. This lets
    //      libwebrtc render plaintext frames that the peer is still sending
    //      while the two-phase install is in progress (peer hasn't yet
    //      installed sender_enc).
    //   2. On a successful decrypt, return the plaintext.
    // Drops to the floor only happen when the output buffer can't fit
    // the plaintext / passthrough — never in the normal codepath.
    // Per-instance prefix mirroring MediaEncryptor's. Both ends must agree
    // on the size or the decryptor reads the wrong byte as our header.
    size_t UnencryptedPrefixForMediaType(cricket::MediaType mt) const {
        return mt == cricket::MEDIA_TYPE_VIDEO ? (size_t)videoPrefix_ : 0;
    }

    Result Decrypt(cricket::MediaType media_type,
                   const std::vector<uint32_t>& /*csrcs*/,
                   rtc::ArrayView<const uint8_t> /*additional_data*/,
                   rtc::ArrayView<const uint8_t> encrypted_frame,
                   rtc::ArrayView<uint8_t> frame) override {
        if (isH264_ && media_type == cricket::MEDIA_TYPE_VIDEO) {
            return DecryptH264(encrypted_frame, frame);
        }
        const size_t prefix = UnencryptedPrefixForMediaType(media_type);

        // Passthrough helper.
        auto passthrough = [&]() -> Result {
            if (frame.size() < encrypted_frame.size()) {
                return Result(Status::kFailedToDecrypt, 0);
            }
            std::memcpy(frame.data(), encrypted_frame.data(), encrypted_frame.size());
            return Result(Status::kOk, encrypted_frame.size());
        };

        if (encrypted_frame.size() < prefix + kFrameOverhead) {
            return passthrough();
        }
        const uint8_t header = encrypted_frame.data()[prefix];
        const uint8_t version = (header >> 4) & 0x0f;
        const uint8_t keyId   = header & 0x0f;
        if (version != 1 || keyId != expectedKeyId_) {
            return passthrough();
        }

        const uint8_t* ctrPtr = encrypted_frame.data() + prefix + 1;
        const uint32_t counter = ((uint32_t)ctrPtr[0] << 24)
                               | ((uint32_t)ctrPtr[1] << 16)
                               | ((uint32_t)ctrPtr[2] <<  8)
                               | ((uint32_t)ctrPtr[3]);

        uint8_t iv[kIvLen];
        BuildIV(salt_, counter, iv);

        uint8_t aad[kHeaderLen + kCounterLen];
        aad[0] = header;
        std::memcpy(aad + 1, ctrPtr, kCounterLen);

        const size_t cipherTagLen = encrypted_frame.size() - prefix - kHeaderLen - kCounterLen;
        const size_t plainLen     = cipherTagLen - kTagLen;
        const size_t outLen       = prefix + plainLen;

        if (frame.size() < outLen) {
            return passthrough();
        }

        bool didAttach = false;
        JNIEnv* env = AttachThread(&didAttach);
        if (!env) return passthrough();

        jbyteArray jResult = CallAesGcm(env, g_aesGcmDecryptMid,
            key_, kKeyLen, iv, kIvLen, aad, sizeof(aad),
            encrypted_frame.data() + prefix + kHeaderLen + kCounterLen, cipherTagLen);
        if (!jResult) {
            // Tag mismatch — likely a real plaintext frame whose bytes
            // happened to look like our header. Pass through.
            DetachThread(didAttach);
            return passthrough();
        }
        const jsize resultLen = env->GetArrayLength(jResult);
        if ((size_t)resultLen != plainLen) {
            env->DeleteLocalRef(jResult);
            DetachThread(didAttach);
            return passthrough();
        }
        // Copy back the plaintext prefix bytes, then the decrypted payload.
        if (prefix > 0) {
            std::memcpy(frame.data(), encrypted_frame.data(), prefix);
        }
        env->GetByteArrayRegion(jResult, 0, resultLen,
            reinterpret_cast<jbyte*>(frame.data() + prefix));
        env->DeleteLocalRef(jResult);
        DetachThread(didAttach);

        return Result(Status::kOk, outLen);
    }

    // Output buffer must hold either plaintext (encrypted_size - kFrameOverhead)
    // OR a passthrough copy (= encrypted_size). Return the larger of the two
    // so libwebrtc allocates enough space for either path.
    size_t GetMaxPlaintextByteSize(cricket::MediaType, size_t encrypted_frame_size) override {
        return encrypted_frame_size;
    }

    void AddRef() const override {
        ref_count_.fetch_add(1, std::memory_order_relaxed);
    }
    webrtc::RefCountReleaseStatus Release() const override {
        const int prev = ref_count_.fetch_sub(1, std::memory_order_acq_rel);
        if (prev == 1) { delete this; return webrtc::RefCountReleaseStatus::kDroppedLastRef; }
        return webrtc::RefCountReleaseStatus::kOtherRefsRemained;
    }

 protected:
    ~MediaDecryptor() override { LOGI("MediaDecryptor dtor %p", this); }

 private:
    // NAL-aware decrypt: walk the reassembled Annex-B stream, copy start codes
    // + NAL headers verbatim, EPB-unescape each NAL body, AES-GCM-decrypt it.
    // Permissive per NAL: a body that doesn't carry our (v=2, keyId) header, or
    // whose tag fails, is emitted verbatim — so a peer still sending plaintext
    // H264 during the two-phase install renders unchanged.
    Result DecryptH264(rtc::ArrayView<const uint8_t> encrypted_frame,
                       rtc::ArrayView<uint8_t> frame) {
        const uint8_t* in  = encrypted_frame.data();
        const size_t   n   = encrypted_frame.size();
        uint8_t*       out = frame.data();
        const size_t   cap = frame.size();
        size_t w = 0;
        int nNal = 0, nDec = 0; uint8_t firstType = 0;  // instrumentation

        auto putRaw = [&](const uint8_t* p, size_t len) -> bool {
            if (w + len > cap) return false;
            if (len) std::memcpy(out + w, p, len);
            w += len;
            return true;
        };

        bool didAttach = false;
        JNIEnv* env = AttachThread(&didAttach);

        std::vector<uint8_t> unesc;   // EPB-unescaped body
        size_t i = 0;
        bool fail = false;            // output buffer overflow → kFailedToDecrypt

        while (i < n && !fail) {
            const size_t sc = FindStartCode(in, n, i);
            if (sc == n) { if (!putRaw(in + i, n - i)) fail = true; break; }
            const size_t headerPos = sc + 3;
            if (headerPos >= n) { if (!putRaw(in + i, n - i)) fail = true; break; }

            // Verbatim: leading bytes + start code + NAL header.
            if (!putRaw(in + i, (headerPos - i) + 1)) { fail = true; break; }

            const size_t bodyStart = headerPos + 1;
            const size_t nextSc    = FindStartCode(in, n, bodyStart);
            const size_t bodyEnd   = (nextSc == n) ? n : nextSc;
            const size_t bodyLen   = bodyEnd - bodyStart;
            const uint8_t nalHeader = in[headerPos];
            if (nNal == 0) firstType = nalHeader & 0x1f;
            nNal++;

            // Re-emit this NAL body verbatim (used for every non-decryptable case).
            auto passNal = [&]() -> bool { return putRaw(in + bodyStart, bodyLen); };

            EpbUnescape(in + bodyStart, bodyLen, unesc);
            // Need at least the blob header + a tag.
            if (unesc.size() < kNalBlobHdr + kTagLen) {
                if (!passNal()) fail = true;
                i = bodyEnd; continue;
            }
            const uint8_t vByte   = unesc[0];
            const uint8_t version = (vByte >> 4) & 0x0f;
            const uint8_t keyId   = vByte & 0x0f;
            if (version != kNalVersion || keyId != expectedKeyId_ || !env) {
                if (decFrames_.load() < 8 && nNal == 1) {
                    const uint8_t* rb = in + bodyStart;  // raw received body (pre-unescape)
                    LOGI("[decH264?] PASS ver/keyId: nalHdr=0x%02x bodyLen=%zu unescN=%zu vByte=0x%02x expKeyId=%u raw[0..3]=%02x%02x%02x%02x u[0..3]=%02x%02x%02x%02x",
                         (unsigned)nalHeader, bodyLen, unesc.size(), (unsigned)vByte, (unsigned)expectedKeyId_,
                         bodyLen>0?rb[0]:0, bodyLen>1?rb[1]:0, bodyLen>2?rb[2]:0, bodyLen>3?rb[3]:0,
                         unesc.size()>0?unesc[0]:0, unesc.size()>1?unesc[1]:0,
                         unesc.size()>2?unesc[2]:0, unesc.size()>3?unesc[3]:0);
                }
                if (!passNal()) fail = true;
                i = bodyEnd; continue;
            }
            const uint8_t* ctr = unesc.data() + 1;
            const uint32_t counter = ((uint32_t)ctr[0] << 24) | ((uint32_t)ctr[1] << 16)
                                   | ((uint32_t)ctr[2] <<  8) |  (uint32_t)ctr[3];
            // ptlen tells us exactly how many ciphertext bytes precede the tag,
            // so trailing start-code padding the depacketizer added is ignored.
            const uint8_t* pl = unesc.data() + 1 + kCounterLen;
            const size_t   ptLen = ((size_t)pl[0] << 24) | ((size_t)pl[1] << 16)
                                 | ((size_t)pl[2] <<  8) |  (size_t)pl[3];
            const size_t   ctLen = ptLen + kTagLen;            // ciphertext + tag
            if (kNalBlobHdr + ctLen > unesc.size()) {          // truncated / wrong
                if (!passNal()) fail = true;
                i = bodyEnd; continue;
            }
            uint8_t iv[kIvLen];
            BuildIV(salt_, counter, iv);
            uint8_t aad[6];
            aad[0] = vByte;
            std::memcpy(aad + 1, ctr, kCounterLen);
            aad[5] = nalHeader;

            const uint8_t* ctPtr = unesc.data() + kNalBlobHdr;

            jbyteArray jResult = CallAesGcm(env, g_aesGcmDecryptMid,
                key_, kKeyLen, iv, kIvLen, aad, sizeof(aad), ctPtr, ctLen);
            if (!jResult) {                 // tag mismatch → treat as plaintext NAL
                if (decFrames_.load() < 8 && nNal == 1) {
                    LOGI("[decH264?] TAG fail: nalHdr=0x%02x vByte=0x%02x counter=%u ptLen=%zu unescN=%zu bodyLen=%zu",
                         (unsigned)nalHeader, (unsigned)vByte, counter, ptLen, unesc.size(), bodyLen);
                }
                if (!passNal()) fail = true;
                i = bodyEnd; continue;
            }
            const jsize plainLen = env->GetArrayLength(jResult);
            if ((size_t)plainLen != ptLen) {
                env->DeleteLocalRef(jResult);
                if (!passNal()) fail = true;
                i = bodyEnd; continue;
            }
            if (w + (size_t)plainLen > cap) {
                env->DeleteLocalRef(jResult);
                fail = true; break;
            }
            env->GetByteArrayRegion(jResult, 0, plainLen,
                reinterpret_cast<jbyte*>(out + w));
            w += plainLen;
            nDec++;
            env->DeleteLocalRef(jResult);
            i = bodyEnd;
        }

        const uint32_t fn = decFrames_.fetch_add(1, std::memory_order_relaxed);
        if (fn < 5 || (fn % 100) == 0) {
            LOGI("[decH264] frame#=%u in=%zu out=%zu nals=%d dec=%d pass=%d firstType=%d%s",
                 fn, n, w, nNal, nDec, nNal - nDec, (int)firstType, fail ? " FAIL" : "");
        }
        DetachThread(didAttach);
        if (fail) return Result(Status::kFailedToDecrypt, 0);
        return Result(Status::kOk, w);
    }

    uint8_t  key_[kKeyLen];
    uint8_t  salt_[kSaltLen];
    uint8_t  expectedKeyId_;
    uint8_t  videoPrefix_;   // bytes left plaintext at start of each video frame
    bool     isH264_;        // when true, video frames use the NAL-aware path
    mutable std::atomic<uint32_t> decFrames_{0};   // instrumentation
    mutable std::atomic<int> ref_count_;
};

}  // namespace sylke2ee

// ---- JNI entry points ------------------------------------------------------

extern "C" JNIEXPORT jlong JNICALL
Java_com_oney_WebRTCModule_SylkE2EE_nativeCreateNoopEncryptor(JNIEnv* env, jclass) {
    EnsureJniCache(env);
    auto* enc = new sylke2ee::NoopFrameEncryptor();
    enc->AddRef();
    return reinterpret_cast<jlong>(static_cast<webrtc::FrameEncryptorInterface*>(enc));
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_oney_WebRTCModule_SylkE2EE_nativeCreateNoopDecryptor(JNIEnv* env, jclass) {
    EnsureJniCache(env);
    auto* dec = new sylke2ee::NoopFrameDecryptor();
    dec->AddRef();
    return reinterpret_cast<jlong>(static_cast<webrtc::FrameDecryptorInterface*>(dec));
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_oney_WebRTCModule_SylkE2EE_nativeCreateMediaEncryptor(
        JNIEnv* env, jclass, jbyteArray jKey, jbyteArray jSalt, jint keyId, jint videoPrefix,
        jboolean isH264) {
    EnsureJniCache(env);
    if (env->GetArrayLength(jKey)  < (jsize)sylke2ee::kKeyLen)  return 0;
    if (env->GetArrayLength(jSalt) < (jsize)sylke2ee::kSaltLen) return 0;
    uint8_t key[sylke2ee::kKeyLen];
    uint8_t salt[sylke2ee::kSaltLen];
    env->GetByteArrayRegion(jKey,  0, sylke2ee::kKeyLen,  reinterpret_cast<jbyte*>(key));
    env->GetByteArrayRegion(jSalt, 0, sylke2ee::kSaltLen, reinterpret_cast<jbyte*>(salt));
    auto* enc = new sylke2ee::MediaEncryptor(key, salt, (uint8_t)keyId, (uint8_t)videoPrefix,
                                             isH264 == JNI_TRUE);
    enc->AddRef();
    return reinterpret_cast<jlong>(static_cast<webrtc::FrameEncryptorInterface*>(enc));
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_oney_WebRTCModule_SylkE2EE_nativeCreateMediaDecryptor(
        JNIEnv* env, jclass, jbyteArray jKey, jbyteArray jSalt, jint keyId, jint videoPrefix,
        jboolean isH264) {
    EnsureJniCache(env);
    if (env->GetArrayLength(jKey)  < (jsize)sylke2ee::kKeyLen)  return 0;
    if (env->GetArrayLength(jSalt) < (jsize)sylke2ee::kSaltLen) return 0;
    uint8_t key[sylke2ee::kKeyLen];
    uint8_t salt[sylke2ee::kSaltLen];
    env->GetByteArrayRegion(jKey,  0, sylke2ee::kKeyLen,  reinterpret_cast<jbyte*>(key));
    env->GetByteArrayRegion(jSalt, 0, sylke2ee::kSaltLen, reinterpret_cast<jbyte*>(salt));
    auto* dec = new sylke2ee::MediaDecryptor(key, salt, (uint8_t)keyId, (uint8_t)videoPrefix,
                                             isH264 == JNI_TRUE);
    dec->AddRef();
    return reinterpret_cast<jlong>(static_cast<webrtc::FrameDecryptorInterface*>(dec));
}

extern "C" JNIEXPORT void JNICALL
Java_com_oney_WebRTCModule_SylkE2EE_nativeReleaseEncryptor(JNIEnv*, jclass, jlong ptr) {
    if (ptr == 0) return;
    auto* enc = reinterpret_cast<webrtc::FrameEncryptorInterface*>(ptr);
    enc->Release();
}

extern "C" JNIEXPORT void JNICALL
Java_com_oney_WebRTCModule_SylkE2EE_nativeReleaseDecryptor(JNIEnv*, jclass, jlong ptr) {
    if (ptr == 0) return;
    auto* dec = reinterpret_cast<webrtc::FrameDecryptorInterface*>(ptr);
    dec->Release();
}
