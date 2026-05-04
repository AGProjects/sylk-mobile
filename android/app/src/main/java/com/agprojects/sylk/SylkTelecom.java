package com.agprojects.sylk;

import android.annotation.TargetApi;
import android.content.ComponentName;
import android.content.Context;
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
    private static final String PHONE_ACCOUNT_LABEL = "Sylk";


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
        try {
            TelecomManager tm = (TelecomManager) context.getApplicationContext()
                    .getSystemService(Context.TELECOM_SERVICE);
            if (tm == null) {
                Log.w(LOG_TAG, "[SylkTelecom] No TelecomManager; cannot register PhoneAccount");
                return;
            }
            PhoneAccountHandle handle = phoneAccountHandle(context);
            PhoneAccount account = PhoneAccount.builder(handle, PHONE_ACCOUNT_LABEL)
                    .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED
                            | PhoneAccount.CAPABILITY_VIDEO_CALLING
                            | PhoneAccount.CAPABILITY_SUPPORTS_VIDEO_CALLING)
                    .setShortDescription("Sylk incoming calls")
                    .build();
            tm.registerPhoneAccount(account);
            phoneAccountRegistered = true;
            // Read it back so we can confirm Telecom actually accepted us.
            // Self-managed accounts should be enabled automatically, but a
            // few OEMs (Honor, some MIUI builds) don't. If isEnabled is
            // false here you'll need the user to flip the switch in
            // Settings → Apps → Default apps → Calling accounts.
            PhoneAccount readback = tm.getPhoneAccount(handle);
            Log.d(LOG_TAG, "[SylkTelecom] PhoneAccount registered"
                    + ", readback=" + (readback != null)
                    + ", enabled=" + (readback != null && readback.isEnabled()));
        } catch (SecurityException se) {
            Log.e(LOG_TAG, "[SylkTelecom] PhoneAccount register denied (missing MANAGE_OWN_CALLS?)", se);
        } catch (Exception e) {
            Log.e(LOG_TAG, "[SylkTelecom] PhoneAccount register failed", e);
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
                Log.w(LOG_TAG, "[SylkTelecom] No TelecomManager; cannot present call");
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
            Log.d(LOG_TAG, "[SylkTelecom] addNewIncomingCall " + callId
                    + " from=" + fromUri
                    + " address=" + address
                    + " displayName=" + cleanDisplayName);
        } catch (SecurityException se) {
            Log.e(LOG_TAG, "[SylkTelecom] addNewIncomingCall denied", se);
        } catch (Exception e) {
            Log.e(LOG_TAG, "[SylkTelecom] addNewIncomingCall failed", e);
        }
    }

    /** Flip the Connection to ACTIVE — call this when the user accepts. */
    public static void setActive(String callId) {
        if (callId == null) return;
        SylkCallConnectionService.SylkIncomingConnection c = CONNECTIONS.get(callId);
        if (c == null) return;
        try {
            c.setActive();
            Log.d(LOG_TAG, "[SylkTelecom] setActive " + callId);
        } catch (Exception e) {
            Log.w(LOG_TAG, "[SylkTelecom] setActive failed for " + callId, e);
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
            Log.d(LOG_TAG, "[SylkTelecom] endCall " + callId + " cause=" + disconnectCause);
        } catch (Exception e) {
            Log.w(LOG_TAG, "[SylkTelecom] endCall failed for " + callId, e);
        }
    }

    @TargetApi(Build.VERSION_CODES.O)
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
        if (userPart == null || userPart.isEmpty() || "unknown".equals(userPart)) {
            // No usable identity at all — keep a sip: scheme so Telecom
            // doesn't think it's a real PSTN call from "unknown".
            return Uri.fromParts("sip", "unknown", null);
        }
        // tel:<userPart>. HFP 1.6+ kits read setCallerDisplayName for the
        // CLIP NAME field and show the real name; older kits show the
        // user-part here as the "number".
        return Uri.fromParts(PhoneAccount.SCHEME_TEL, userPart, null);
    }
}
