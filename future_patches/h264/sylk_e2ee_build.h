// sylk_e2ee_build.h — SINGLE SOURCE OF TRUTH for the Sylk E2EE build tag.
//
// Both MediaEncryptorJni.cpp and sylk_e2ee.cpp include this; nativeGetBuild()
// (in sylk_e2ee.cpp) reports it and app.js compares the report against its own
// SYLK_E2EE_BUILD constant. Previously the literal was duplicated in two .cpp
// files and drifted — the reported build said one thing while the crypto code
// was another. Don't reintroduce a second copy; bump it HERE only.
//
// Bump on ANY change to the wire format / framing / prefix logic, and update
// the matching constant in app/app.js so the startup build-check passes.

#ifndef SYLK_E2EE_BUILD_H_
#define SYLK_E2EE_BUILD_H_

#define SYLK_E2EE_BUILD "build-2026-06-06-h264-clear-params"

#endif  // SYLK_E2EE_BUILD_H_
