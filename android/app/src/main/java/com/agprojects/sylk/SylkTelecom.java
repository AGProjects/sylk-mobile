package com.agprojects.sylk;

import android.Manifest;
import android.annotation.TargetApi;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.telecom.DisconnectCause;
import android.telecom.PhoneAccount;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import android.telecom.VideoProfile;
import android.util.Log;

import java.util.concurrent.ConcurrentHashMap;

/**
 * Small helper around the self-managed ConnectionService used for incoming calls.
 *
 * The whole point of this class is so that the FCM-driven IncomingCallService
 * (which runs even when the JS bridge is dead) can register the call with the
 * Android Telecom framework. Telecom then announces the call to the BT
 * Hands-Free Profile (which is what makes a paired car kit display "Incoming
 * call from X") and to Android Auto, with no JS involvement.
 *
 * The PhoneAccount used here is intentionally distinct from the one
 * react-native-callkeep registers, so the two paths don't fight when the JS
 * app eventually comes up.
 */
public final class SylkTelecom {

    private static final String LOG_TAG = "SYLK_APP";
    private static final String PHONE_ACCOUNT_ID = "sylk-incoming-self-managed";
    // Shown in Settings -> Apps -> Default apps -> Calling accounts.
    // Independent of app.json `name`, which is only the AppRegistry key.
    private static final String PHONE_ACCOUNT_LABEL = "Blink";


    /** Extra: caller URI we received in the FCM payload. */
    public static final String EXTRA_FROM_URI = "com.agprojects.sylk.FROM_URI";
    /** Extra: caller display name (fallbacks to from_uri). */
    public static final String EXTRA_DISPLAY_NAME = "com.agprojects.sylk.DISPLAY_NAME";
    /** Extra: our session-id, used for cross-process correlation. */
    public static final String EXTRA_CALL_UUID = "com.agprojects.sylk.CALL_UUID";
    /** Extra: media-type ("audio" or "video"). */
    public static final String EXTRA_MEDIA_TYPE = "com.agprojects.sylk.MEDIA_TYPE";

    /**
     * Live connections keyed by Sylk session id. ConnectionService instances
     * publish here when Telecom asks them to create the connection; this helper
     * reads back to flip state when the user accepts/rejects elsewhere
     * (notification buttons, JS).
     */
    static final ConcurrentHashMap<String, SylkCallConnectionService.SylkIncomingConnection> CONNECTIONS =
            new ConcurrentHashMap<>();

    private static volatile boolean phoneAccountRegistered = false;

    private SylkTelecom() {}

    /**
     * Idempotent. Registers our self-managed PhoneAccount the first time it's
     * called (per process). On Android &lt; O this is a no-op since
     * CAPABILITY_SELF_MANAGED is API 26+.
     */
    public static synchronized void register(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        if (phoneAccountRegistered) {
            return;
        }
        unregisterStalePhoneAccounts(context);
        try {
            TelecomManager tm = (TelecomManager) context.getApplicationContext()
                    .getSystemService(Context.TELECOM_SERVICE);
            if (tm == null) {
                SylkLogger.w("[call] [telecom] No TelecomManager; cannot register PhoneAccount");
                return;
            }
            PhoneAccountHandle handle = phoneAccountHandle(context);
            PhoneAccount.Builder accountBuilder = PhoneAccount.builder(handle, PHONE_ACCOUNT_LABEL)
                    .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED
                            | PhoneAccount.CAPABILITY_VIDEO_CALLING
                            | PhoneAccount.CAPABILITY_SUPPORTS_VIDEO_CALLING)
                    .setShortDescription("Blink incoming calls")
                    // Which URI schemes this account handles. Left unset, a
                    // PhoneAccount reports an EMPTY supported-scheme list --
                    // malformed for anything asking "can this account handle
                    // this address?". addressFor() below hands Telecom tel: for
                    // phone numbers and sip: for everything else, so declare
                    // both.
                    .setSupportedUriSchemes(java.util.Arrays.asList(
                            PhoneAccount.SCHEME_TEL, PhoneAccount.SCHEME_SIP));

            // NOT opted into the SYSTEM call log, deliberately.
            //
            // Setting PhoneAccount.EXTRA_LOG_SELF_MANAGED_CALLS here makes
            // Telecom write our calls into content://call_log/calls -- the
            // Android counterpart of iOS CallKit's includesCallsInRecents.
            // We shipped that for a while and then removed it, because the
            // resulting entries are unusable:
            //
            //   - The address is mangled. The call log has ONE address column
            //     (CallLog.Calls.NUMBER) and no scheme column;
            //     CallLogManager.getLogNumber() stores
            //     handle.getSchemeSpecificPart(), so "sip:" is stripped and a
            //     SIP address lands as a bare user@domain. Dialers then render
            //     only the user-part, so a call from enry01@sip2sip.info shows
            //     up as "enry01" -- indistinguishable from a mis-parsed number.
            //
            //   - The display name never arrives. CACHED_NAME is filled from
            //     Telecom's own contacts lookup (call.getCallerInfo()), NOT
            //     from Connection.setCallerDisplayName(), so every caller who
            //     is not already in the address book logs as name=NULL. We
            //     cannot write it ourselves: that needs WRITE_CALL_LOG, which
            //     is Play-restricted to the default Phone/SMS/Assistant
            //     handlers.
            //
            //   - Nothing is redialable, and the failure is not silent.
            //     Telecom excludes SELF_MANAGED accounts when it picks a call
            //     provider, so tapping a Recents row falls through to the SIM:
            //     a SIP address like 4444@sylk.link does nothing at all, and a
            //     phone number is placed as a REAL carrier call -- bypassing
            //     our gateway and billing the user's carrier. Verified on a
            //     motorola razr 60 ultra / Android 16 by reading
            //     content://call_log/calls, which showed the fallback
            //     attributed to TelephonyConnectionService.
            //
            // Filtering per call is not a way out. The opt-in is per
            // PhoneAccount, and the one per-call escape hatch --
            // TelecomManager.EXTRA_DO_NOT_LOG_CALL, checked in
            // CallLogManager.shouldLogDisconnectedCall -- is @hide and gated
            // behind the telecomSkipLogBasedOnExtra aconfig flag, so it
            // no-ops on most builds. Splitting into two PhoneAccounts (one
            // logging, one not) would work but puts a second entry under
            // Settings -> Calling accounts, which unregisterStalePhoneAccounts
            // below exists to avoid.
            //
            // Sylk's in-app history is the record instead. The matching
            // removal for the OUTGOING side lives in
            // patches/react-native-callkeep+4.3.16.patch; both have to stay
            // off or one direction leaks back into Recents.
            //
            // iOS is unaffected: CallKit Recents entries DO route redial back
            // into the app, so ios.includesCallsInRecents stays true in
            // app/CallManager.js.
            //
            // The only Android architecture that routes redial back into the
            // app is a MANAGED account (CAPABILITY_CALL_PROVIDER, what Zoom
            // registers), and that hands the in-call UI to Telecom and
            // requires the user to enable the account by hand. Deliberately
            // not taken.

            PhoneAccount account = accountBuilder.build();
            tm.registerPhoneAccount(account);
            phoneAccountRegistered = true;
            // Read it back so we can confirm Telecom actually accepted us.
            // Self-managed accounts should be enabled automatically, but a
            // few OEMs (Honor, some MIUI builds) don't. If isEnabled is
            // false here you'll need the user to flip the switch in
            // Settings → Apps → Default apps → Calling accounts.
            //
            // IMPORTANT: getPhoneAccount() is permission-gated — Telecom
            // enforces READ_PHONE_NUMBERS (API 30+) / READ_PHONE_STATE
            // (API < 30) and throws SecurityException if the caller hasn't
            // been granted it. Registration above has already succeeded, so
            // this readback is purely diagnostic; never let a missing
            // permission take down the process (it runs at boot from
            // MainApplication.onCreate). Skip it when we don't hold the
            // permission rather than rely on the catch below.
            if (canReadPhoneAccounts(context)) {
                PhoneAccount readback = tm.getPhoneAccount(handle);
                SylkLogger.d("[call] [telecom] PhoneAccount registered"
                        + ", readback=" + (readback != null)
                        + ", enabled=" + (readback != null && readback.isEnabled()));
            } else {
                SylkLogger.d("[call] [telecom] PhoneAccount registered"
                        + "; skipping readback (READ_PHONE_NUMBERS not granted)");
            }
        } catch (SecurityException se) {
            // Defensive net only — the permission check above should keep us
            // out of here. The relevant permission is READ_PHONE_NUMBERS
            // (API 30+) / READ_PHONE_STATE, NOT MANAGE_OWN_CALLS.
            SylkLogger.e("[call] [telecom] PhoneAccount register denied "
                    + "(missing READ_PHONE_NUMBERS / READ_PHONE_STATE?)", se);
        } catch (Exception e) {
            SylkLogger.e("[call] [telecom] PhoneAccount register failed", e);
        }
    }

    /**
     * Hand the call off to the Telecom framework. Telecom will start
     * SylkCallConnectionService, which will create a self-managed Connection
     * and call setRinging(). That's the trigger for the BT car-kit display.
     */
    public static void presentIncomingCall(Context context,
                                           String callId,
                                           String fromUri,
                                           String displayName,
                                           String mediaType) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        if (callId == null) {
            return;
        }
        if (CONNECTIONS.containsKey(callId)) {
            // Already announced this one; don't double-register.
            return;
        }
        try {
            register(context);
            TelecomManager tm = (TelecomManager) context.getApplicationContext()
                    .getSystemService(Context.TELECOM_SERVICE);
            if (tm == null) {
                SylkLogger.w("[call] [telecom] No TelecomManager; cannot present call");
                return;
            }

            PhoneAccountHandle handle = phoneAccountHandle(context);

            // Sylk has no phone numbers — only SIP URIs and display names.
            // The BT-HFP layer expects a tel: URI for CLIP, so we synthesise
            // one from the local-part of the SIP URI; Android Telecom is
            // happy to carry alphanumeric content there. Most car kits will
            // then show "costin" instead of an "unknown number" placeholder
            // (10000000 / 00000000) when they don't know how to render sip:.
            String userPart = userPartOf(fromUri);
            String cleanDisplayName = cleanDisplayName(displayName, fromUri, userPart);

            Bundle extras = new Bundle();
            Uri address = addressFor(userPart, fromUri);
            extras.putParcelable(TelecomManager.EXTRA_INCOMING_CALL_ADDRESS, address);

            Bundle inner = new Bundle();
            inner.putString(EXTRA_FROM_URI, fromUri == null ? "" : fromUri);
            inner.putString(EXTRA_DISPLAY_NAME, cleanDisplayName);
            inner.putString(EXTRA_CALL_UUID, callId);
            inner.putString(EXTRA_MEDIA_TYPE, mediaType == null ? "audio" : mediaType);
            extras.putBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS, inner);

            // Also flag it as a video call to Telecom when applicable; some
            // car kits / Auto use this to choose the right ringer/UI.
            int videoState = "video".equalsIgnoreCase(mediaType)
                    ? VideoProfile.STATE_BIDIRECTIONAL
                    : VideoProfile.STATE_AUDIO_ONLY;
            extras.putInt(TelecomManager.EXTRA_INCOMING_VIDEO_STATE, videoState);

            tm.addNewIncomingCall(handle, extras);
            SylkLogger.d("[call] [telecom] addNewIncomingCall " + callId
                    + " from=" + fromUri
                    + " address=" + address
                    + " displayName=" + cleanDisplayName);
        } catch (SecurityException se) {
            SylkLogger.e("[call] [telecom] addNewIncomingCall denied", se);
        } catch (Exception e) {
            SylkLogger.e("[call] [telecom] addNewIncomingCall failed", e);
        }
    }

    /** Flip the Connection to ACTIVE — call this when the user accepts. */
    public static void setActive(String callId) {
        if (callId == null) return;
        SylkCallConnectionService.SylkIncomingConnection c = CONNECTIONS.get(callId);
        if (c == null) return;
        try {
            c.setActive();
            SylkLogger.d("[call] [telecom] setActive " + callId);
        } catch (Exception e) {
            SylkLogger.w("[call] [telecom] setActive failed for " + callId, e);
        }
    }

    /**
     * End the Connection. Causes:
     *   LOCAL    — user rejected / hung up on this device
     *   REMOTE   — caller cancelled (FCM "cancel"), or remote ended the call
     *   MISSED   — auto-cancel after timeout, no answer
     */
    public static void endCall(String callId, int disconnectCause) {
        if (callId == null) return;
        SylkCallConnectionService.SylkIncomingConnection c = CONNECTIONS.remove(callId);
        if (c == null) return;
        try {
            c.setDisconnected(new DisconnectCause(disconnectCause));
            c.destroy();
            SylkLogger.d("[call] [telecom] endCall " + callId + " cause=" + disconnectCause);
        } catch (Exception e) {
            SylkLogger.w("[call] [telecom] endCall failed for " + callId, e);
        }
    }

    /**
     * Whether we may call permission-gated Telecom read APIs such as
     * {@link TelecomManager#getPhoneAccount}. Telecom enforces
     * READ_PHONE_NUMBERS from API 30 (Android 11) on, and READ_PHONE_STATE
     * on older releases. Both are runtime ("dangerous") permissions, so a
     * declaration in the manifest is not enough — the user must have granted
     * them. Returns false when the grant is missing so callers can skip the
     * read instead of catching a SecurityException.
     */
    private static boolean canReadPhoneAccounts(Context context) {
        String permission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? Manifest.permission.READ_PHONE_NUMBERS
                : Manifest.permission.READ_PHONE_STATE;
        return context.checkSelfPermission(permission)
                == PackageManager.PERMISSION_GRANTED;
    }

    @TargetApi(Build.VERSION_CODES.O)
    /**
     * Drop PhoneAccounts left behind by earlier builds.
     *
     * react-native-callkeep does NOT use a fixed id for its account: it calls
     * getApplicationName() and passes the result as the PhoneAccountHandle id
     * (RNCallKeepModule#initializeTelecomManager). That resolves to
     * res/values/strings.xml app_name -- so renaming the app renames the
     * account's identity, and Telecom keeps the old registration alive
     * forever: the user sees TWO Blink entries under Settings -> Apps ->
     * Default apps -> Calling accounts, one of them dead.
     *
     * Unregistering an account we own needs no permission. Unknown handles are
     * ignored by Telecom, so this stays a cheap no-op once users have rolled
     * past the rename.
     */
    private static void unregisterStalePhoneAccounts(Context context) {
        final String[] retiredIds = { "Blink WebRTC", "Sylk" };
        try {
            TelecomManager tm = (TelecomManager) context.getApplicationContext()
                    .getSystemService(Context.TELECOM_SERVICE);
            if (tm == null) {
                return;
            }
            ComponentName callkeep = new ComponentName(
                    context.getApplicationContext().getPackageName(),
                    "io.wazo.callkeep.VoiceConnectionService");
            String current = context.getApplicationContext().getString(R.string.app_name);
            for (String id : retiredIds) {
                if (id.equals(current)) {
                    continue;
                }
                try {
                    tm.unregisterPhoneAccount(new PhoneAccountHandle(callkeep, id));
                    SylkLogger.i("[call] [telecom] retired stale PhoneAccount id=" + id);
                } catch (Exception ignored) {
                    // Never registered on this device, or already gone.
                }
            }
        } catch (Exception e) {
            SylkLogger.w("[call] [telecom] stale PhoneAccount cleanup failed: " + e);
        }
    }

    static PhoneAccountHandle phoneAccountHandle(Context context) {
        ComponentName cn = new ComponentName(context.getApplicationContext(),
                SylkCallConnectionService.class);
        return new PhoneAccountHandle(cn, PHONE_ACCOUNT_ID);
    }

    /**
     * Local-part of a SIP-style URI ("user" out of "user@host"). Strips
     * a leading sip:/sips: scheme if present so we don't end up with
     * "sip:costin" as the displayed name. For URIs without an @,
     * returns the (scheme-stripped) input. Empty/null → "unknown".
     */
    static String userPartOf(String fromUri) {
        if (fromUri == null || fromUri.isEmpty()) {
            return "unknown";
        }
        String s = fromUri;
        // Drop sip: / sips: prefix, case-insensitive.
        if (s.regionMatches(true, 0, "sips:", 0, 5)) {
            s = s.substring(5);
        } else if (s.regionMatches(true, 0, "sip:", 0, 4)) {
            s = s.substring(4);
        }
        int at = s.indexOf('@');
        if (at > 0) {
            return s.substring(0, at);
        }
        return s;
    }

    /**
     * Pick the best string to hand to Connection.setCallerDisplayName.
     *
     * Preference order: a real human name from FCM, then the bare URI
     * user-part, then "Unknown caller". Never the full URI — kits that
     * support CLIP NAME would otherwise show "costin@sylk.link" with
     * the @ interfering with display.
     */
    static String cleanDisplayName(String displayName, String fromUri, String userPart) {
        if (displayName != null && !displayName.isEmpty()) {
            // Reject the URI itself (with or without sip: prefix) and the
            // bare user-part — we want a real human name, otherwise we
            // fall back to userPart below.
            String stripped = userPartOf(displayName);
            if (!displayName.equals(fromUri)
                    && !displayName.equals(userPart)
                    && !stripped.equals(userPart)) {
                return displayName;
            }
        }
        if (fromUri != null
                && (fromUri.toLowerCase().contains("anonymous")
                    || fromUri.toLowerCase().contains("@guest."))) {
            // Anonymous / guest caller with no real presented name — never
            // surface the random "<uuid>" user-part; show a friendly label.
            return "Unknown contact";
        }
        if (userPart != null && !userPart.isEmpty() && !"unknown".equals(userPart)) {
            return userPart;
        }
        return "Unknown caller";
    }

    /**
     * Synthesise the address Telecom hands to BT-HFP. Sylk has no phone
     * numbers, so the goal is a tel:-shaped URI whose body the kit can
     * render — alphanumeric is fine; Android Telecom doesn't validate.
     * Falls back to sip:user@host only when we have nothing usable.
     */
    private static Uri addressFor(String userPart, String fromUri) {
        boolean isAnonymous = fromUri != null
                && (fromUri.toLowerCase().contains("anonymous")
                    || fromUri.toLowerCase().contains("@guest."));
        if (isAnonymous || userPart == null || userPart.isEmpty() || "unknown".equals(userPart)) {
            // No usable identity at all — keep a sip: scheme so Telecom
            // doesn't think it's a real PSTN call from "unknown".
            return Uri.parse("sip:unknown");
        }

        // A phone number keeps tel: — the one form the platform call log and
        // the dialer can actually act on.
        if (isPhoneNumberLike(userPart)) {
            return Uri.parse(PhoneAccount.SCHEME_TEL + ":" + userPart);
        }

        // Everything else is a SIP user and MUST go out as sip:user@domain.
        //
        // This used to be tel:<userPart>, picked so that older BT-HFP kits had
        // something to render in their "number" field. It was wrong: anything
        // that treats a tel: URI as dialable strips every non-dialable
        // character, so "enry01" degrades to "01" (same failure mode as
        // Uri.fromParts percent-encoding '+' into "%2B" and it reducing to a
        // stray "2"). That bit us hardest while the system call log was
        // enabled; the log opt-in is gone now (see register() above), but the
        // address is still what Telecom hands to BT-HFP and Android Auto, so
        // it has to be the truthful one. HFP 1.6+ kits read the CLIP NAME from
        // setCallerDisplayName, which we always set, so nothing readable is
        // lost by keeping the sip: form.
        //
        // Uri.parse, NOT Uri.fromParts: fromParts would encode the '@' to
        // '%40' and the log would show "enry01%40example.com".
        String sip = fromUri == null ? "" : fromUri.trim();
        String lower = sip.toLowerCase();
        if (lower.startsWith("sips:")) {
            sip = sip.substring(5);
        } else if (lower.startsWith("sip:")) {
            sip = sip.substring(4);
        }
        if (sip.isEmpty() || sip.indexOf('@') < 0) {
            // No domain to work with — a bare user is still better under sip:
            // than under tel:, where the log would eat the letters.
            sip = userPart;
        }
        return Uri.parse(PhoneAccount.SCHEME_SIP + ":" + sip);
    }

    /**
     * '+' or '0' followed by digits — the same shape utils.isPhoneNumber
     * accepts on the JS side, kept deliberately narrow so a SIP user whose
     * name merely contains digits ("enry01") is never mistaken for a number.
     */
    private static boolean isPhoneNumberLike(String value) {
        return value != null && value.matches("^[+0][0-9]+$");
    }
}
