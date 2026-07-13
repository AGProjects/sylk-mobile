#!/usr/bin/env bash
#
# rebuild-webrtc.sh — clean and rebuild react-native-webrtc from scratch
# with our patches applied. Use this whenever you suspect cached native
# artifacts (CMake/NDK output, gradle, AAR caches) are still carrying old
# code from before a `patches/react-native-webrtc+124.0.7.patch` change.
#
# Modes:
#   ./rebuild-webrtc.sh              - clean native build only (default).
#                                       Keeps node_modules; just nukes the
#                                       webrtc C++ build cache + app's
#                                       Android build, then runs gradle
#                                       again. ~3-5 min.
#
#   ./rebuild-webrtc.sh --reinstall  - wipe node_modules and re-yarn so
#                                       patch-package re-applies the
#                                       patch from scratch, THEN do the
#                                       above. ~6-10 min.
#
#   ./rebuild-webrtc.sh --nuke       - everything --reinstall does, plus
#                                       wipe ios/Pods + Podfile.lock and
#                                       run pod install. ~10-15 min.
#
#   ./rebuild-webrtc.sh --device     - after building, install on every
#                                       attached Android device (combine
#                                       with any of the modes above).
#
# Run from the project root (the folder that contains package.json).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Wipe the gradle / NDK build caches that polluted the diff
rm -rf node_modules/react-native-webrtc/android/.cxx
rm -rf node_modules/react-native-webrtc/android/.gradle
rm -rf node_modules/react-native-webrtc/android/build

# Also nuke the iOS Pods/build noise if there is any inside the package
rm -rf node_modules/react-native-webrtc/ios/build
rm -rf node_modules/react-native-webrtc/ios/Pods   # rare but some
npx patch-package react-native-webrtc

# --- arg parsing ----------------------------------------------------------
REINSTALL_NODE_MODULES=0
NUKE_PODS=0
INSTALL_DEVICE=0

for arg in "$@"; do
    case "$arg" in
        --reinstall) REINSTALL_NODE_MODULES=1 ;;
        --nuke)      REINSTALL_NODE_MODULES=1; NUKE_PODS=1 ;;
        --device)    INSTALL_DEVICE=1 ;;
        -h|--help)
            sed -n '/^# Modes:/,/^# Run/p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "Unknown arg: $arg (try --help)"
            exit 1
            ;;
    esac
done

# --- sanity checks --------------------------------------------------------
if [[ ! -f "$SCRIPT_DIR/package.json" ]]; then
    echo "ERROR: package.json not found in $SCRIPT_DIR — run from project root."
    exit 1
fi

PATCH_FILE="$SCRIPT_DIR/patches/react-native-webrtc+124.0.7.patch"
if [[ ! -f "$PATCH_FILE" ]]; then
    echo "ERROR: $PATCH_FILE not found — bail out before we do damage."
    exit 1
fi

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓   %s\033[0m\n' "$*"; }

# --- 0. stop any running watchers / metro --------------------------------
step "Stopping Metro / adb logcat / gradle daemons (best effort)"
pkill -f "react-native start"     2>/dev/null || true
pkill -f "react-native-cli/index" 2>/dev/null || true
pkill -f "adb logcat"             2>/dev/null || true
# Stop the project's gradle daemons specifically; safe even if no daemon.
( cd "$SCRIPT_DIR/android" && ./gradlew --stop ) 2>/dev/null || true
ok "Watchers stopped (or weren't running)"

# --- 1. optional: wipe node_modules -------------------------------------
if [[ $REINSTALL_NODE_MODULES -eq 1 ]]; then
    step "Wiping node_modules so patch-package re-applies cleanly"
    rm -rf "$SCRIPT_DIR/node_modules"
    rm -f  "$SCRIPT_DIR/.yarn-integrity"
    ok "node_modules removed"

    step "Running yarn install (postinstall will run patch-package)"
    yarn install --frozen-lockfile
    ok "yarn install completed"

    # Verify the patch actually landed on disk by spot-checking a known
    # marker line. If patch-package silently failed, every native rebuild
    # below is wasted.
    if ! grep -q "SYLK_E2EE_BUILD" \
         "$SCRIPT_DIR/node_modules/react-native-webrtc/android/src/main/cpp/MediaEncryptorJni.cpp" \
         2>/dev/null; then
        warn "react-native-webrtc patch marker not found — patch-package may not have applied."
        warn "Re-running it manually:"
        npx patch-package
    fi
    ok "Patch applied (SYLK_E2EE_BUILD marker present)"
else
    # Even when not reinstalling, re-apply the patch in case anything in
    # node_modules was hand-edited and drifted from the patch file.
    step "Re-applying patches (patch-package, idempotent)"
    npx patch-package || warn "patch-package returned non-zero (may already be applied)"
fi

# --- 2. clean react-native-webrtc native build -------------------------
step "Cleaning react-native-webrtc native build artifacts"
WEBRTC_ANDROID="$SCRIPT_DIR/node_modules/react-native-webrtc/android"
rm -rf "$WEBRTC_ANDROID/.cxx"
rm -rf "$WEBRTC_ANDROID/.gradle"
rm -rf "$WEBRTC_ANDROID/build"
ok "react-native-webrtc Android build cache cleared"

# --- 3. clean app's Android build --------------------------------------
step "Cleaning app's Android build (./android)"
APP_ANDROID="$SCRIPT_DIR/android"
rm -rf "$APP_ANDROID/.gradle"
rm -rf "$APP_ANDROID/build"
rm -rf "$APP_ANDROID/app/build"
rm -rf "$APP_ANDROID/app/.cxx"
ok "App's Android build cache cleared"

# --- 4. clean Metro bundler cache --------------------------------------
step "Clearing Metro bundler cache"
rm -rf "$TMPDIR/metro-"* 2>/dev/null || true
rm -rf "$TMPDIR/haste-map-"* 2>/dev/null || true
rm -rf "$TMPDIR/react-"* 2>/dev/null || true
ok "Metro cache cleared"

# --- 5. optional: clean iOS Pods --------------------------------------
if [[ $NUKE_PODS -eq 1 ]]; then
    if [[ -d "$SCRIPT_DIR/ios" ]]; then
        step "Wiping iOS Pods + Podfile.lock"
        rm -rf "$SCRIPT_DIR/ios/Pods"
        rm -rf "$SCRIPT_DIR/ios/build"
        rm -f  "$SCRIPT_DIR/ios/Podfile.lock"
        if command -v pod >/dev/null 2>&1; then
            ( cd "$SCRIPT_DIR/ios" && pod install )
            ok "Pods reinstalled"
        else
            warn "cocoapods 'pod' not in PATH — run 'cd ios && pod install' manually."
        fi
    fi
fi

# --- 6. rebuild Android -----------------------------------------------
step "Rebuilding Android (./gradlew assembleDebug)"
( cd "$APP_ANDROID" && ./gradlew clean assembleDebug ) || {
    echo
    warn "Gradle build failed."
    warn "Common causes:"
    warn "  - patch didn't apply (check above warnings)"
    warn "  - NDK/CMake version mismatch (see ./android/build.gradle ndkVersion)"
    warn "  - leftover stale ABI: rm -rf node_modules/react-native-webrtc/android/.cxx"
    exit 1
}
ok "APK built: android/app/build/outputs/apk/debug/app-*.apk"

# --- 6b. verify the freshly-built .so reports the expected build tag ----
# Catches the exact failure mode that bit us: source updated but a stale
# .cxx/.so (or a build-string copy that drifted) compiled the OLD tag in,
# so the app silently runs old crypto and logs *** MISMATCH ***. We read
# the single source of truth (sylk_e2ee_build.h) and assert the compiled
# libsylk_e2ee.so actually contains that string.
step "Verifying compiled libsylk_e2ee.so matches sylk_e2ee_build.h"
BUILD_HDR="$WEBRTC_ANDROID/src/main/cpp/sylk_e2ee_build.h"
# Read the tag from the #define line ONLY (comments in the header also
# contain the word "build-…", so grep the macro line and pull the quoted value).
EXPECTED_BUILD=$(grep -E '^[[:space:]]*#define[[:space:]]+SYLK_E2EE_BUILD[[:space:]]+"' "$BUILD_HDR" 2>/dev/null \
                 | sed -E 's/.*"([^"]+)".*/\1/' | head -1)
if [[ -z "$EXPECTED_BUILD" ]]; then
    warn "Could not read expected build tag from $BUILD_HDR — skipping verify."
else
    BUILT_SO=$(find "$WEBRTC_ANDROID/build" -name libsylk_e2ee.so 2>/dev/null | head -1)
    if [[ -z "$BUILT_SO" ]]; then
        warn "No libsylk_e2ee.so found under build/ — native lib may not have compiled."
        exit 1
    elif grep -aq "$EXPECTED_BUILD" "$BUILT_SO"; then
        ok "Native .so reports '$EXPECTED_BUILD' (matches source)"
    else
        warn "*** STALE NATIVE BUILD ***"
        warn "  expected: $EXPECTED_BUILD"
        warn "  built .so does NOT contain it — a cached object compiled the old tag."
        warn "  Fix: rm -rf '$WEBRTC_ANDROID/.cxx' '$WEBRTC_ANDROID/build' and re-run."
        exit 1
    fi
fi

# --- 7. optional: install on connected devices ------------------------
if [[ $INSTALL_DEVICE -eq 1 ]]; then
    step "Installing on attached Android devices"
    DEVICES=$(adb devices | awk 'NR>1 && $2=="device" {print $1}')
    if [[ -z "$DEVICES" ]]; then
        warn "No devices in 'adb devices' — skipping install."
    else
        for d in $DEVICES; do
            echo "  → $d"
            ( cd "$APP_ANDROID" && ./gradlew installDebug -Pandroid.injected.testOnly=false -PreactNativeArchitectures=arm64-v8a ) || true
            # The above runs once; if you want fan-out per device, use
            # adb -s "$d" install -r path/to/apk.
        done
        ok "Install attempted on attached devices"
    fi
fi

echo
ok "Rebuild complete."
echo
echo "Next: launch Metro and the app:"
echo "  ./logs.sh"
echo "  yarn android   (or yarn ios)"
echo
echo "Verify the patch is live: in metro.log on startup, both phones must log"
echo "  '[SylkE2EE-Build] native matches JS: ${EXPECTED_BUILD:-<see sylk_e2ee_build.h>}'"
echo "Anything reading *** MISMATCH *** means a phone is on a stale APK/native lib."
