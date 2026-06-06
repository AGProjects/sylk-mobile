// sylk_e2ee.cpp — Phase 1 sanity stub + build-version probe.
//
// nativeHello() is called once when SylkE2EE.java is class-loaded
// (System.loadLibrary("sylk_e2ee")). It logs the build version we
// compiled against, so we can verify both phones are running the
// same .so. Bump SYLK_E2EE_BUILD in MediaEncryptorJni.cpp whenever
// the wire format / prefix size / framing logic changes.

#include <jni.h>
#include <android/log.h>

#include "sylk_e2ee_build.h"   // single source of truth for SYLK_E2EE_BUILD

#define LOG_TAG "SYLK_APP"   // captured by metro-adb-logs.sh (logcat -s SYLK_APP:V)
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

extern "C" JNIEXPORT jint JNICALL
Java_com_oney_WebRTCModule_SylkE2EE_nativeHello(JNIEnv* /*env*/, jclass /*clazz*/) {
    LOGI("native lib loaded; build=%s", SYLK_E2EE_BUILD);
    return 124;
}

// Returns the compiled-in SYLK_E2EE_BUILD string so Java/JS can verify
// the loaded .so matches the JS-side expected version. Mismatch means
// patch-package didn't apply or a stale .cxx cache is in play.
extern "C" JNIEXPORT jstring JNICALL
Java_com_oney_WebRTCModule_SylkE2EE_nativeGetBuild(JNIEnv* env, jclass /*clazz*/) {
    return env->NewStringUTF(SYLK_E2EE_BUILD);
}
