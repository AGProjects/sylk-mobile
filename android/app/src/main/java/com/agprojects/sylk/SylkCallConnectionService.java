package com.agprojects.sylk;

import android.annotation.TargetApi;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.telecom.CallAudioState;
import android.telecom.Connection;
import android.telecom.ConnectionRequest;
import android.telecom.ConnectionService;
import android.telecom.DisconnectCause;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import android.telecom.VideoProfile;
import android.util.Log;

/**
 * Self-managed ConnectionService for incoming Sylk calls.
 *
 * Telecom routes addNewIncomingCall() from {@link SylkTelecom} into
 * {@link #onCreateIncomingConnection(PhoneAccountHandle, ConnectionRequest)},
 * where we return a Connection that is immediately ringing. That ringing
 * state is what the BT Hands-Free Profile picks up and displays on a paired
 * car-kit (and what Android Auto picks up).
 *
 * The Connection forwards user actions (Answer / Reject / Disconnect) — which
 * may originate from the car kit, Android Auto, the lockscreen UI, or an
 * accessory device — back into the existing notification action receiver.
 * That keeps every entry point on a single code path.
 */
@TargetApi(Build.VERSION_CODES.O)
public class SylkCallConnectionService extends ConnectionService {

    private static final String LOG_TAG = "SYLK_APP";

    @Override
    public Connection onCreateIncomingConnection(PhoneAccountHandle handle,
                                                 ConnectionRequest request) {
        Bundle extras = request.getExtras();
        Bundle inner = extras != null
                ? extras.getBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS)
                : null;

        String callId      = inner != null ? inner.getString(SylkTelecom.EXTRA_CALL_UUID) : null;
        String fromUri     = inner != null ? inner.getString(SylkTelecom.EXTRA_FROM_URI) : null;
        String displayName = inner != null ? inner.getString(SylkTelecom.EXTRA_DISPLAY_NAME) : null;
        String mediaType   = inner != null ? inner.getString(SylkTelecom.EXTRA_MEDIA_TYPE) : "audio";

        SylkLogger.d("[call] [connection-service] onCreateIncomingConnection callId=" + callId
                + " from=" + fromUri + " media=" + mediaType);

        SylkIncomingConnection conn = new SylkIncomingConnection(
                getApplicationContext(), callId, fromUri, displayName, mediaType);
        conn.setConnectionProperties(Connection.PROPERTY_SELF_MANAGED);

        // Capabilities we actually support. Hold/Mute let the car kit show
        // those buttons; without HOLD some kits hide the call entirely after
        // a few seconds.
        int caps = Connection.CAPABILITY_MUTE
                 | Connection.CAPABILITY_HOLD
                 | Connection.CAPABILITY_SUPPORT_HOLD;
        if ("video".equalsIgnoreCase(mediaType)) {
            caps |= Connection.CAPABILITY_SUPPORTS_VT_LOCAL_BIDIRECTIONAL
                  | Connection.CAPABILITY_SUPPORTS_VT_REMOTE_BIDIRECTIONAL;
        }
        conn.setConnectionCapabilities(caps);

        Uri address = request.getAddress();
        if (address != null) {
            conn.setAddress(address, TelecomManager.PRESENTATION_ALLOWED);
        }
        // Display name was already cleaned in SylkTelecom.presentIncomingCall
        // (real name preferred, otherwise the URI user-part, never the full
        // URI). Pass it through verbatim so HFP 1.6+ kits show it as CLIP
        // NAME and Android Auto picks it up.
        String shownName = (displayName == null || displayName.isEmpty())
                ? SylkTelecom.userPartOf(fromUri)
                : displayName;
        conn.setCallerDisplayName(shownName, TelecomManager.PRESENTATION_ALLOWED);
        conn.setVideoState("video".equalsIgnoreCase(mediaType)
                ? VideoProfile.STATE_BIDIRECTIONAL
                : VideoProfile.STATE_AUDIO_ONLY);

        // Audio mode for self-managed VoIP. Self-managed Connections are
        // responsible for their own audio routing — BluetoothScoManager /
        // AudioRouteModule already handles SCO; we don't fight them here.
        conn.setAudioModeIsVoip(true);

        conn.setRinging();

        if (callId != null) {
            SylkTelecom.CONNECTIONS.put(callId, conn);
        }

        return conn;
    }

    @Override
    public void onCreateIncomingConnectionFailed(PhoneAccountHandle handle,
                                                 ConnectionRequest request) {
        SylkLogger.w("[call] [connection-service] onCreateIncomingConnectionFailed: " + request);
    }

    @Override
    public Connection onCreateOutgoingConnection(PhoneAccountHandle handle,
                                                 ConnectionRequest request) {
        // Outgoing calls are still placed via the existing app flow; we don't
        // route them through Telecom here. Returning a failed Connection
        // (rather than null) is the safe API contract some OEMs rely on.
        SylkLogger.w("[call] [connection-service] onCreateOutgoingConnection unsupported");
        return Connection.createFailedConnection(
                new DisconnectCause(DisconnectCause.ERROR));
    }

    @Override
    public void onCreateOutgoingConnectionFailed(PhoneAccountHandle handle,
                                                 ConnectionRequest request) {
        SylkLogger.w("[call] [connection-service] onCreateOutgoingConnectionFailed");
    }

    /**
     * Self-managed Connection. The Telecom framework calls onAnswer/onReject/
     * onDisconnect from any source it routes — car BT, Android Auto,
     * accessibility services, etc. We funnel them all into the same broadcast
     * the lockscreen notification buttons already use, so accept/reject
     * behavior is identical regardless of where the user tapped.
     */
    @TargetApi(Build.VERSION_CODES.O)
    static class SylkIncomingConnection extends Connection {

        private final Context appContext;
        private final String callId;
        private final String fromUri;
        private final String displayName;
        private final String mediaType;

        SylkIncomingConnection(Context appContext,
                               String callId,
                               String fromUri,
                               String displayName,
                               String mediaType) {
            this.appContext = appContext;
            this.callId = callId;
            this.fromUri = fromUri;
            this.displayName = displayName;
            this.mediaType = mediaType;
        }

        @Override
        public void onAnswer() {
            super.onAnswer();
            onAnswer(VideoProfile.STATE_AUDIO_ONLY);
        }

        @Override
        public void onAnswer(int videoState) {
            SylkLogger.d("[call] [connection-service] onAnswer " + callId + " videoState=" + videoState);
            String action = videoState != VideoProfile.STATE_AUDIO_ONLY
                    ? "ACTION_ACCEPT_VIDEO"
                    : "ACTION_ACCEPT_AUDIO";
            forwardToReceiver(action);
            // Telecom requires us to flip to ACTIVE for HFP to update; the
            // receiver path will also call SylkTelecom.setActive(), but doing
            // it here too is safe (setActive on an already-active connection
            // is a no-op) and avoids a few hundred ms of "ringing" on the car
            // kit display while the app launches.
            try {
                setActive();
            } catch (Exception ignored) {}
        }

        @Override
        public void onReject() {
            SylkLogger.d("[call] [connection-service] onReject " + callId);
            forwardToReceiver("ACTION_REJECT_CALL");
            try {
                setDisconnected(new DisconnectCause(DisconnectCause.REJECTED));
                destroy();
            } catch (Exception ignored) {}
            SylkTelecom.CONNECTIONS.remove(callId);
        }

        @Override
        public void onDisconnect() {
            SylkLogger.d("[call] [connection-service] onDisconnect " + callId);
            forwardToReceiver("ACTION_REJECT_CALL");
            try {
                setDisconnected(new DisconnectCause(DisconnectCause.LOCAL));
                destroy();
            } catch (Exception ignored) {}
            SylkTelecom.CONNECTIONS.remove(callId);
        }

        @Override
        public void onAbort() {
            SylkLogger.d("[call] [connection-service] onAbort " + callId);
            try {
                setDisconnected(new DisconnectCause(DisconnectCause.CANCELED));
                destroy();
            } catch (Exception ignored) {}
            SylkTelecom.CONNECTIONS.remove(callId);
        }

        @Override
        public void onCallAudioStateChanged(CallAudioState state) {
            // Fires every time Telecom changes the audio route. Useful for
            // BT diagnosis: route 0x02 = BLUETOOTH, 0x01 = EARPIECE, 0x04 = WIRED_HEADSET,
            // 0x08 = SPEAKER. supportedRouteMask shows what Telecom thinks is
            // available, which on a paired car kit should include BLUETOOTH.
            SylkLogger.d("[call] [connection-service] onCallAudioStateChanged " + callId
                    + " route=0x" + Integer.toHexString(state.getRoute())
                    + " supported=0x" + Integer.toHexString(state.getSupportedRouteMask())
                    + " btDevice=" + state.getActiveBluetoothDevice()
                    + " muted=" + state.isMuted());
        }

        @Override
        public void onShowIncomingCallUi() {
            // Self-managed Connections may receive this on Android 10+ when
            // Telecom wants the app to display its own ringing UI. Our
            // IncomingCallService already fires a CallStyle notification with
            // a full-screen intent the moment the FCM push arrives, so there
            // is nothing extra to do here. Override to suppress the default
            // log warning from the framework.
        }

        private void forwardToReceiver(String action) {
            if (callId == null) return;
            try {
                Intent i = new Intent(appContext, IncomingCallActionReceiver.class);
                i.setAction(action);
                // Constrain to our own package so the caller URI/displayName
                // don't get visible to other broadcast receivers on the
                // device.
                i.setPackage(appContext.getPackageName());
                i.putExtra("session-id", callId);
                // Carry the original call metadata so IncomingCallService can
                // launch the RN app with the right caller / media info when
                // the user answers from a paired car kit (where the original
                // FCM-sourced extras aren't on the wire).
                i.putExtra("from_uri", fromUri == null ? "" : fromUri);
                i.putExtra("to_uri", "");
                i.putExtra("displayName", displayName == null ? "" : displayName);
                i.putExtra("media-type", mediaType == null ? "audio" : mediaType);
                i.putExtra("event", "incoming_session");
                // Match the notification-id IncomingCallService uses, so the
                // receiver's cleanup-intent path (which requires it) fires
                // and the app is launched on Accept-from-car-kit.
                i.putExtra("notification-id", Math.abs(callId.hashCode()));
                i.putExtra("source", "telecom");
                appContext.sendBroadcast(i);
            } catch (Exception e) {
                SylkLogger.w("[call] [connection-service] forwardToReceiver failed", e);
            }
        }
    }
}
