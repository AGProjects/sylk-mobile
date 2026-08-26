package com.agprojects.sylk;

import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.app.NotificationManager;
import android.content.Context;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.WritableArray;

import java.util.ArrayList;

import android.app.NotificationChannel;
import android.Manifest;
import android.content.ContentResolver;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.content.ContentValues;
import android.provider.ContactsContract;

import androidx.core.content.ContextCompat;

public class AndroidSettingsModule extends ReactContextBaseJavaModule {

    private final ReactApplicationContext reactContext;

    AndroidSettingsModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
    }

    @Override
    public String getName() {
        return "AndroidSettings";
    }

    /**
     * The shortcut / conversation id we publish for a chat. Must match
     * MyFirebaseMessagingService exactly -- the conversation channel Android
     * auto-creates when the user marks a thread Priority is keyed on
     * (parentChannelId, conversationId), so a mismatch here would look up a
     * channel that does not exist and silently report "not priority".
     */
    private static String shortcutIdForUri(String uri) {
        return "chat_" + (uri == null ? "" : uri).replaceAll("[^a-zA-Z0-9_]", "_");
    }

    /**
     * Whether this contact is actually set up to break through system Do Not
     * Disturb, and if not, which half is missing.
     *
     * Two independent things have to line up, and setting only one does
     * nothing -- which is the usual reason "Bypass Do Not Disturb" appears to
     * be on yet the phone stays silent:
     *
     *   priorityConversation  the user marked THIS thread Priority (long-press
     *                         the notification, or Settings > Notifications >
     *                         Conversations). Read from the conversation
     *                         channel Android creates on that action.
     *   conversationSenders   Do Not Disturb is set to let priority
     *                         conversations through at all (Modes > Do Not
     *                         Disturb > People > Conversations).
     *
     * conversationSenders needs notification-policy access; without it we
     * report "unknown" rather than guessing, because a wrong "no" here would
     * send the user hunting for a setting that is already correct.
     */
    @ReactMethod
    public void getDndBypassStatus(String uri, Promise promise) {
        WritableMap out = Arguments.createMap();
        out.putString("conversationSenders", "unknown");
        out.putBoolean("priorityConversation", false);
        out.putBoolean("channelBypassDnd", false);
        out.putBoolean("conversationChannelExists", false);
        out.putBoolean("policyAccess", false);
        out.putBoolean("dndOn", false);
        out.putBoolean("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.R);
        // Calls half. contactCard null means "no card carries this address, or
        // we cannot read contacts" -- reported as unknown rather than "not
        // starred", which would be a different and wrong instruction.
        out.putString("callSenders", "unknown");
        out.putBoolean("contactFound", false);
        out.putBoolean("contactStarred", false);
        // Distinct from contactFound. Without READ_CONTACTS the lookup returns
        // nothing, which is NOT the same as "no card exists" -- reporting the
        // latter told the user to add a contact they already had.
        out.putBoolean("contactsPermission",
                ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_CONTACTS)
                        == PackageManager.PERMISSION_GRANTED);

        try {
            NotificationManager nm = (NotificationManager)
                    reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                promise.resolve(out);
                return;
            }

            int filter = nm.getCurrentInterruptionFilter();
            out.putBoolean("dndOn", filter != NotificationManager.INTERRUPTION_FILTER_ALL
                    && filter != NotificationManager.INTERRUPTION_FILTER_UNKNOWN);

            NotificationChannel ch = nm.getNotificationChannel(
                    MyFirebaseMessagingService.MESSAGES_CHANNEL_ID, shortcutIdForUri(uri));
            if (ch != null) {
                out.putBoolean("conversationChannelExists", true);
                out.putBoolean("priorityConversation", ch.isImportantConversation());
                // Distinct from Priority: the user marks a conversation
                // Priority, we can only set bypassDnd. Either one lets the
                // notification through, so the panel has to read both.
                out.putBoolean("channelBypassDnd", ch.canBypassDnd());
            }

            WritableMap card = findContactCard(uri);
            if (card != null) {
                out.putBoolean("contactFound", true);
                out.putBoolean("contactStarred", card.getBoolean("starred"));
            }

            boolean access = nm.isNotificationPolicyAccessGranted();
            out.putBoolean("policyAccess", access);
            if (access) {
                try {
                    int senders = nm.getNotificationPolicy().priorityConversationSenders;
                    if (senders == NotificationManager.Policy.CONVERSATION_SENDERS_ANYONE) {
                        out.putString("conversationSenders", "anyone");
                    } else if (senders == NotificationManager.Policy.CONVERSATION_SENDERS_IMPORTANT) {
                        out.putString("conversationSenders", "important");
                    } else {
                        out.putString("conversationSenders", "none");
                    }
                    int callers = nm.getNotificationPolicy().priorityCallSenders;
                    if (callers == NotificationManager.Policy.PRIORITY_SENDERS_ANY) {
                        out.putString("callSenders", "anyone");
                    } else if (callers == NotificationManager.Policy.PRIORITY_SENDERS_CONTACTS) {
                        out.putString("callSenders", "contacts");
                    } else {
                        out.putString("callSenders", "starred");
                    }
                } catch (Exception policyEx) {
                    SylkLogger.w("[dnd] policy read failed: " + policyEx.getMessage());
                }
            }
        } catch (Exception e) {
            SylkLogger.w("[dnd] getDndBypassStatus failed: " + e.getMessage());
        }

        promise.resolve(out);
    }

    /**
     * The contact card that carries this address as an email, if any.
     *
     * Returns {starred, lookupUri} or null when no card matches / we lack
     * permission. Calls are governed by "Do Not Disturb > People > Calls",
     * which matches the CALLER against contact cards -- so unlike
     * conversations there is no per-contact system entry to inspect. The star
     * on the card IS the entry.
     */
    /**
     * EVERY system contact card carrying this address as an email.
     *
     * Deliberately a list. One SIP address routinely appears on more than one
     * card -- a personal entry and a work one, a duplicate the OS never merged,
     * or two accounts (local + Google) the user sees as one. Returning only the
     * first made the editor claim a link to a single card while Do Not Disturb
     * was matching against a different one, which is unhelpfully wrong rather
     * than merely incomplete.
     */
    private java.util.List<WritableMap> listContactCards(String uri) {
        java.util.List<WritableMap> out = new ArrayList<>();
        if (uri == null || uri.isEmpty()) { return out; }
        if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_CONTACTS)
                != PackageManager.PERMISSION_GRANTED) {
            SylkLogger.d("[dnd] [card] no READ_CONTACTS permission");
            return out;
        }

        Cursor c = null;
        try {
            c = reactContext.getContentResolver().query(
                    ContactsContract.CommonDataKinds.Email.CONTENT_URI,
                    new String[]{
                            ContactsContract.Data.CONTACT_ID,
                            ContactsContract.Data.LOOKUP_KEY,
                            ContactsContract.Contacts.DISPLAY_NAME,
                            ContactsContract.Contacts.STARRED },
                    // LIKE with no wildcards: exact, but case-insensitive for
                    // ASCII. Cards are routinely saved as "AG@sylk.link" while
                    // the SIP uri arrives lowercased, and "=" matched nothing.
                    ContactsContract.CommonDataKinds.Email.ADDRESS + " LIKE ?",
                    new String[]{ uri },
                    null);
            java.util.Set<Long> seen = new java.util.HashSet<>();
            while (c != null && c.moveToNext()) {
                long contactId = c.getLong(0);
                // One card can hold the same address twice (two Email rows), so
                // dedupe by contact id or the list shows phantom duplicates.
                if (!seen.add(contactId)) { continue; }
                WritableMap m = Arguments.createMap();
                m.putString("id", String.valueOf(contactId));
                m.putString("name", c.getString(2));
                m.putBoolean("starred", c.getInt(3) != 0);
                String lookupKey = c.getString(1);
                Uri lookup = (lookupKey != null)
                        ? ContactsContract.Contacts.getLookupUri(contactId, lookupKey) : null;
                m.putString("lookupUri", lookup != null ? lookup.toString() : null);
                out.add(m);
            }
            SylkLogger.d("[dnd] [card] email lookup '" + uri + "' matched " + out.size() + " card(s)");
        } catch (Exception e) {
            SylkLogger.w("[dnd] [card] email lookup failed: " + e.getMessage());
        } finally {
            if (c != null) { try { c.close(); } catch (Exception ignored) {} }
        }
        return out;
    }

    /**
     * The card the Do Not Disturb status should report on. A STARRED match wins
     * when there is more than one: if any card carrying this address is starred
     * then Do Not Disturb will let the calls through, so reporting the unstarred
     * duplicate would tell the user to fix something that is already working.
     */
    private WritableMap findContactCard(String uri) {
        java.util.List<WritableMap> cards = listContactCards(uri);
        if (cards.isEmpty()) {
            logNearMisses(uri);
            return null;
        }
        for (WritableMap m : cards) {
            if (m.hasKey("starred") && m.getBoolean("starred")) { return m; }
        }
        return cards.get(0);
    }

    /**
     * All matching cards, for the contact editor's link row.
     */
    @ReactMethod
    public void getSystemContacts(String uri, Promise promise) {
        try {
            WritableArray arr = Arguments.createArray();
            for (WritableMap m : listContactCards(uri)) {
                arr.pushMap(m);
            }
            promise.resolve(arr);
        } catch (Exception e) {
            SylkLogger.w("[dnd] getSystemContacts failed: " + e.getMessage());
            promise.resolve(Arguments.createArray());
        }
    }

    /**
     * Open one specific card. Takes the lookup uri rather than the address, so
     * that with several matches the row the user tapped is the card that opens.
     */
    @ReactMethod
    public void openContactCardByUri(String lookupUri, Promise promise) {
        try {
            if (lookupUri == null || lookupUri.isEmpty()) {
                promise.reject("no_uri", "No lookup uri");
                return;
            }
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(lookupUri));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(i);
            promise.resolve("contact");
        } catch (Exception e) {
            SylkLogger.w("[dnd] openContactCardByUri failed: " + e.getMessage());
            promise.reject("open_failed", e.getMessage());
        }
    }

    /**
     * Collapsed, case-folded form of a display name, so "Jane  Doe" and
     * "jane doe" are the same person. Used ONLY to compare two names that
     * both came out of a name field -- never to match a name against an address.
     */
    private static String normName(String v) {
        if (v == null) { return ""; }
        return v.trim().replaceAll("\\s+", " ").toLowerCase(java.util.Locale.ROOT);
    }

    /**
     * Cards whose display name is EXACTLY this name (whitespace-collapsed,
     * case-insensitive).
     *
     * This is the "same person, address missing" case: the card is right there
     * under the same full name, it just does not carry the Blink address, so
     * the email-keyed lookup in listContactCards() cannot see it and Do Not
     * Disturb cannot recognise the caller.
     *
     * CONTENT_FILTER_URI does the indexed, deliberately fuzzy search (prefixes,
     * name parts, phonetics); the exact test is applied here on the way out.
     * Fuzzy in, exact out -- so a card stored with a double space still matches
     * while "Jane D" and "Joan Doe" do not. Proposing the WRONG person is
     * much worse than proposing nobody: the user is one tap from writing an
     * address onto a stranger's card.
     */
    private java.util.List<WritableMap> listContactCardsByName(String name) {
        java.util.List<WritableMap> out = new ArrayList<>();
        String want = normName(name);
        if (want.isEmpty()) { return out; }
        if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.READ_CONTACTS)
                != PackageManager.PERMISSION_GRANTED) {
            SylkLogger.d("[dnd] [card] no READ_CONTACTS permission");
            return out;
        }

        Cursor c = null;
        try {
            Uri filter = Uri.withAppendedPath(
                    ContactsContract.Contacts.CONTENT_FILTER_URI, Uri.encode(name.trim()));
            c = reactContext.getContentResolver().query(
                    filter,
                    new String[]{
                            ContactsContract.Contacts._ID,
                            ContactsContract.Contacts.LOOKUP_KEY,
                            ContactsContract.Contacts.DISPLAY_NAME,
                            ContactsContract.Contacts.STARRED },
                    null, null, null);
            java.util.Set<Long> seen = new java.util.HashSet<>();
            while (c != null && c.moveToNext()) {
                if (!normName(c.getString(2)).equals(want)) { continue; }
                long contactId = c.getLong(0);
                if (!seen.add(contactId)) { continue; }
                WritableMap m = Arguments.createMap();
                m.putString("id", String.valueOf(contactId));
                m.putString("name", c.getString(2));
                m.putBoolean("starred", c.getInt(3) != 0);
                String lookupKey = c.getString(1);
                Uri lookup = (lookupKey != null)
                        ? ContactsContract.Contacts.getLookupUri(contactId, lookupKey) : null;
                m.putString("lookupUri", lookup != null ? lookup.toString() : null);
                out.add(m);
            }
            SylkLogger.d("[dnd] [card] name lookup '" + name + "' matched " + out.size() + " card(s)");
        } catch (Exception e) {
            SylkLogger.w("[dnd] [card] name lookup failed: " + e.getMessage());
        } finally {
            if (c != null) { try { c.close(); } catch (Exception ignored) {} }
        }
        return out;
    }

    @ReactMethod
    public void getSystemContactsByName(String name, Promise promise) {
        try {
            WritableArray arr = Arguments.createArray();
            for (WritableMap m : listContactCardsByName(name)) {
                arr.pushMap(m);
            }
            promise.resolve(arr);
        } catch (Exception e) {
            SylkLogger.w("[dnd] getSystemContactsByName failed: " + e.getMessage());
            promise.resolve(Arguments.createArray());
        }
    }

    /**
     * Hand the OS address book a pre-filled editor so the USER can put this
     * address on a card. Blink still writes nothing -- there is no
     * WRITE_CONTACTS permission and there is not going to be one (see the
     * manifest). What changes is that the user no longer has to remember the
     * address, find the field and type it correctly; they press Save.
     *
     * Two shapes:
     *   lookupUri present -> ACTION_EDIT straight into that person's card, with
     *                        the address already in an email field.
     *   lookupUri absent  -> ACTION_INSERT_OR_EDIT, which is the system picker
     *                        ("create new / add to existing"). This is also the
     *                        fallback when ACTION_EDIT will not start, and the
     *                        honest answer when we are not sure WHICH card.
     *
     * The Insert extras are a request, not a contract: an OEM editor that
     * ignores them just opens unfilled. That degrades to today's behaviour, so
     * it is not worth guarding against -- but it is why the promise resolves
     * with which route was taken rather than claiming the field was filled.
     */
    @ReactMethod
    public void addEmailToContactCard(String lookupUri, String email, String nameHint, Promise promise) {
        String address = (email == null) ? "" : email.trim();
        if (address.isEmpty()) {
            promise.reject("no_email", "No address to add");
            return;
        }

        if (lookupUri != null && !lookupUri.isEmpty()) {
            try {
                Intent edit = new Intent(Intent.ACTION_EDIT);
                edit.setDataAndType(Uri.parse(lookupUri), ContactsContract.Contacts.CONTENT_ITEM_TYPE);
                edit.putExtra(ContactsContract.Intents.Insert.EMAIL, address);
                edit.putExtra(ContactsContract.Intents.Insert.EMAIL_TYPE,
                        ContactsContract.CommonDataKinds.Email.TYPE_OTHER);
                edit.putExtra("finishActivityOnSaveCompleted", true);
                if (tryStart(edit, "addEmailToContactCard/edit")) {
                    promise.resolve("edit");
                    return;
                }
            } catch (Exception e) {
                SylkLogger.w("[dnd] addEmailToContactCard/edit failed: " + e.getMessage());
            }
        }

        try {
            Intent pick = new Intent(Intent.ACTION_INSERT_OR_EDIT);
            pick.setType(ContactsContract.Contacts.CONTENT_ITEM_TYPE);
            pick.putExtra(ContactsContract.Intents.Insert.EMAIL, address);
            pick.putExtra(ContactsContract.Intents.Insert.EMAIL_TYPE,
                    ContactsContract.CommonDataKinds.Email.TYPE_OTHER);
            // Only seeds the "create new contact" branch; picking an existing
            // card ignores it. Left off when it is not a real name, so a card
            // never gets created called "alice@sylk.link".
            if (nameHint != null && !nameHint.trim().isEmpty()
                    && !nameHint.trim().equalsIgnoreCase(address)) {
                pick.putExtra(ContactsContract.Intents.Insert.NAME, nameHint.trim());
            }
            pick.putExtra("finishActivityOnSaveCompleted", true);
            if (tryStart(pick, "addEmailToContactCard/picker")) {
                promise.resolve("picker");
                return;
            }
        } catch (Exception e) {
            SylkLogger.w("[dnd] addEmailToContactCard/picker failed: " + e.getMessage());
        }

        promise.reject("open_failed", "No contacts editor could be opened");
    }

    /**
     * When an exact email match misses, dump what the address book DOES hold
     * for that local part.
     *
     * "No contact card" is the least useful possible diagnosis: the card is
     * usually right there, and the mismatch is in how the address is stored --
     * a "sip:" prefix, trailing whitespace, the address on a different field
     * type (IM / custom rather than Email), or a different domain. Printing the
     * near misses turns a guess into a reading.
     *
     * Capped at 10 rows: this runs on a diagnostic path, not a hot one, but a
     * large address book should not flood the log.
     */
    private void logNearMisses(String uri) {
        String local = uri;
        int at = uri.indexOf('@');
        if (at > 0) { local = uri.substring(0, at); }

        Cursor c = null;
        try {
            c = reactContext.getContentResolver().query(
                    ContactsContract.CommonDataKinds.Email.CONTENT_URI,
                    new String[]{
                            ContactsContract.Data.CONTACT_ID,
                            ContactsContract.CommonDataKinds.Email.ADDRESS,
                            ContactsContract.Contacts.DISPLAY_NAME },
                    // Two targeted patterns, not "%local%". A short local part
                    // like "al" appears inside half an address book -- alvarez@,
                    // catalina@, palmer@ -- and the resulting wall of unrelated
                    // names buried the one line that mattered.
                    //   '%' + uri     : same address with something in front,
                    //                   e.g. "sip:alice@sylk.link"
                    //   local + '@%'  : same local part, different domain
                    ContactsContract.CommonDataKinds.Email.ADDRESS + " LIKE ? OR "
                            + ContactsContract.CommonDataKinds.Email.ADDRESS + " LIKE ?",
                    new String[]{ "%" + uri, local + "@%" },
                    null);
            if (c == null || c.getCount() == 0) {
                SylkLogger.d("[dnd] [card] no near miss for '" + uri
                        + "': no card holds this address with a prefix, nor this local"
                        + " part on another domain. If the card exists, the address is"
                        + " probably on an IM or custom field rather than Email.");
                return;
            }
            int n = 0;
            while (c.moveToNext() && n < 10) {
                n++;
                SylkLogger.d("[dnd] [card] near miss: contactId=" + c.getLong(0)
                        + " address='" + c.getString(1) + "'"
                        + " name='" + c.getString(2) + "'"
                        + " (wanted exactly '" + uri + "')");
            }
        } catch (Exception e) {
            SylkLogger.w("[dnd] [card] near-miss scan failed: " + e.getMessage());
        } finally {
            if (c != null) { try { c.close(); } catch (Exception ignored) {} }
        }
    }

    /**
     * The system address-book id for this uri, or null when nothing matches.
     *
     * Surfaced in the contact editor purely as a diagnostic: whether Blink's
     * contact is joined to an OS contact card is invisible otherwise, and it
     * is the single fact the whole Do Not Disturb story on both platforms
     * hangs on -- the OS matches callers and senders by contact, not by app.
     */
    @ReactMethod
    public void getSystemContactId(String uri, Promise promise) {
        try {
            WritableMap card = findContactCard(uri);
            if (card == null) { promise.resolve(null); return; }
            WritableMap out = Arguments.createMap();
            out.putString("id", card.hasKey("id") ? card.getString("id") : null);
            promise.resolve(out);
        } catch (Exception e) {
            SylkLogger.w("[dnd] getSystemContactId failed: " + e.getMessage());
            promise.resolve(null);
        }
    }

    /**
     * Open the contact card, where the star lives. Calls have no
     * per-conversation settings page to send the user to -- starring the
     * contact in Contacts is the actual action, so that is where we go.
     */
    @ReactMethod
    public void openContactCard(String uri, Promise promise) {
        try {
            WritableMap card = findContactCard(uri);
            String lookupUri = (card != null && card.hasKey("lookupUri"))
                    ? card.getString("lookupUri") : null;
            if (lookupUri == null) {
                promise.reject("no_contact", "No contact card carries " + uri);
                return;
            }
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(lookupUri));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(i);
            promise.resolve("contact");
        } catch (Exception e) {
            SylkLogger.w("[dnd] openContactCard failed: " + e.getMessage());
            promise.reject("open_failed", e.getMessage());
        }
    }

    /**
     * Open the settings page for THIS conversation, where Priority is a single
     * visible toggle, instead of asking the user to walk Settings > Apps >
     * Blink > Notifications > Conversations > <person>.
     *
     * Falls back to the app's notification settings when the per-conversation
     * screen is not resolvable -- the conversation channel only exists once
     * Android has seen a notification for that thread, and OEM builds move
     * these screens around.
     */
    @ReactMethod
    public void openConversationSettings(String uri, Promise promise) {
        try {
            Context ctx = reactContext;
            // Only deep-link to the conversation page when that channel
            // actually exists. Passing EXTRA_CONVERSATION_ID for a thread the
            // user has never marked Priority still RESOLVES -- Android just
            // silently shows the parent channel instead ("Sylk Messages"),
            // which has no Priority toggle on it and leaves the user stuck.
            // The app notification page does have a Conversations section, so
            // that is the useful destination in that case.
            NotificationManager nm = (NotificationManager)
                    ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            boolean haveConversation = false;
            if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                haveConversation = nm.getNotificationChannel(
                        MyFirebaseMessagingService.MESSAGES_CHANNEL_ID,
                        shortcutIdForUri(uri)) != null;
            }

            if (haveConversation && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Intent i = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName())
                        .putExtra(Settings.EXTRA_CHANNEL_ID,
                                MyFirebaseMessagingService.MESSAGES_CHANNEL_ID)
                        .putExtra(Settings.EXTRA_CONVERSATION_ID, shortcutIdForUri(uri));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                if (i.resolveActivity(ctx.getPackageManager()) != null) {
                    ctx.startActivity(i);
                    promise.resolve("conversation");
                    return;
                }
            }
            Intent fallback = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, reactContext.getPackageName());
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(fallback);
            promise.resolve("app");
        } catch (Exception e) {
            SylkLogger.w("[dnd] openConversationSettings failed: " + e.getMessage());
            promise.reject("open_failed", e.getMessage());
        }
    }

    /**
     * The Do Not Disturb "People" screen -- where Messages (Starred contacts /
     * Contacts / Priority conversations) and Calls exceptions actually live.
     *
     * ACTION_ZEN_MODE_PRIORITY_SETTINGS is public since API 26 and lands there
     * directly. It is still guarded by resolveActivity: Android 16 reworked Do
     * Not Disturb into Modes, and OEM builds relocate these screens, so an
     * unresolvable intent must degrade to the sound settings (which always
     * contain Do Not Disturb somewhere) rather than throw
     * ActivityNotFoundException in the user's face.
     */
    /**
     * Make THIS contact's messages bypass Do Not Disturb, without sending the
     * user anywhere.
     *
     * setBypassDnd is the sanctioned route: "Apps with Do Not Disturb policy
     * access can set up their own channels this way, but only if the channel
     * hasn't been updated by the user since its creation." That last clause is
     * the important one -- once the user touches the channel we lose the
     * ability to change it, which is correct: they outrank us. We report the
     * value back by reading it off the channel afterwards rather than assuming
     * the write took.
     *
     * setImportantConversation, the thing the Settings UI toggles, is
     * deliberately NOT available to apps -- no app gets to promote itself into
     * the user's Priority list. bypassDnd is the supported equivalent and it
     * costs a one-time, revocable, user-granted permission.
     *
     * Creating the channel here also fixes the chicken-and-egg the panel used
     * to hit: a conversation only existed after Android had shown a
     * notification for it, so a contact you had not heard from yet could not
     * be set up at all.
     */
    @ReactMethod
    public void applyContactDndBypass(String uri, String displayName, boolean enabled, Promise promise) {
        WritableMap out = Arguments.createMap();
        out.putBoolean("applied", false);
        out.putBoolean("policyAccess", false);
        out.putBoolean("bypassDnd", false);
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                out.putString("error", "needs_android_11");
                promise.resolve(out);
                return;
            }
            NotificationManager nm = (NotificationManager)
                    reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) { promise.resolve(out); return; }

            boolean access = nm.isNotificationPolicyAccessGranted();
            out.putBoolean("policyAccess", access);
            if (!access) {
                // Without the grant the write is silently ignored, so say so
                // rather than reporting a success the system did not honour.
                out.putString("error", "no_policy_access");
                promise.resolve(out);
                return;
            }

            String conversationId = shortcutIdForUri(uri);
            String channelId = MyFirebaseMessagingService.MESSAGES_CHANNEL_ID + ":" + conversationId;
            String name = (displayName != null && !displayName.trim().isEmpty())
                    ? displayName.trim() : uri;

            NotificationChannel ch = new NotificationChannel(
                    channelId, name, NotificationManager.IMPORTANCE_HIGH);
            ch.setConversationId(MyFirebaseMessagingService.MESSAGES_CHANNEL_ID, conversationId);
            ch.setBypassDnd(enabled);
            nm.createNotificationChannel(ch);

            // Read it back. createNotificationChannel is a no-op for fields the
            // user has already customised, so the only honest answer comes from
            // the channel the system actually holds.
            NotificationChannel after = nm.getNotificationChannel(
                    MyFirebaseMessagingService.MESSAGES_CHANNEL_ID, conversationId);
            boolean effective = after != null && after.canBypassDnd();
            out.putBoolean("applied", true);
            out.putBoolean("bypassDnd", effective);
            if (enabled && !effective) {
                out.putString("error", "user_customised_channel");
            }
            SylkLogger.d("[dnd] applyContactDndBypass " + uri + " enabled=" + enabled
                    + " -> bypassDnd=" + effective);
        } catch (Exception e) {
            SylkLogger.w("[dnd] applyContactDndBypass failed: " + e.getMessage());
            out.putString("error", e.getMessage());
        }
        promise.resolve(out);
    }

    /**
     * Try to start an intent, reporting whether it went. Deliberately does NOT
     * consult resolveActivity first.
     *
     * Since Android 11, resolveActivity returns null for any package this app
     * has not declared in <queries>, whether or not that package is installed.
     * Guarding on it therefore produces confident false negatives -- "no
     * contacts app could be opened" on a phone with a perfectly ordinary
     * address book. ActivityNotFoundException is the only trustworthy answer to
     * "can this be opened", and it costs nothing to ask directly.
     */
    private boolean tryStart(Intent intent, String tag) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            reactContext.startActivity(intent);
            SylkLogger.d("[dnd] " + tag + ": started");
            return true;
        } catch (android.content.ActivityNotFoundException nf) {
            SylkLogger.d("[dnd] " + tag + ": no activity");
        } catch (Exception e) {
            SylkLogger.w("[dnd] " + tag + ": " + e.getClass().getSimpleName()
                    + ": " + e.getMessage());
        }
        return false;
    }

    /**
     * Open the OS address book, so the user can add or edit a card themselves.
     * Plain navigation: Blink writes nothing and pre-fills nothing.
     */
    @ReactMethod
    public void openContacts(Promise promise) {
        Intent app = new Intent(Intent.ACTION_MAIN);
        app.addCategory(Intent.CATEGORY_APP_CONTACTS);
        if (tryStart(app, "openContacts/app")) { promise.resolve("contacts"); return; }

        Intent view = new Intent(Intent.ACTION_VIEW, ContactsContract.Contacts.CONTENT_URI);
        if (tryStart(view, "openContacts/view")) { promise.resolve("view"); return; }

        // Last resort: the contacts picker. Not the screen we want, but it is
        // the address book, and it resolves on builds where the other two do
        // not.
        Intent pick = new Intent(Intent.ACTION_PICK, ContactsContract.Contacts.CONTENT_URI);
        if (tryStart(pick, "openContacts/pick")) { promise.resolve("pick"); return; }

        SylkLogger.w("[dnd] openContacts: no address book could be opened");
        promise.reject("open_failed", "No contacts app could be opened");
    }

    @ReactMethod
    public void openDndPeopleSettings(Promise promise) {
        SylkLogger.d("[dnd] openDndPeopleSettings: entered");
        // Ordered most-specific first. Every one is guarded by resolveActivity
        // and the outcome of EACH attempt is logged, because "nothing happened"
        // has at least three different causes here -- the action not existing
        // on this build, the activity resolving but finishing immediately
        // (Android 16 reworked Do Not Disturb into Modes and some of these
        // screens now expect a mode id), or startActivity throwing. Logging
        // only the failures made those indistinguishable.
        //
        // ZEN_MODE_SETTINGS has no public constant; it is passed as a literal
        // and simply will not resolve where it does not exist.
        final String[][] candidates = new String[][] {
                { Settings.ACTION_ZEN_MODE_PRIORITY_SETTINGS, "zen_priority" },
                { "android.settings.ZEN_MODE_SETTINGS",       "zen" },
                { Settings.ACTION_SOUND_SETTINGS,             "sound" },
                { Settings.ACTION_SETTINGS,                   "settings" },
        };

        for (String[] candidate : candidates) {
            String action = candidate[0];
            String tag = candidate[1];
            // Same reasoning as openContacts: ask by starting, not by asking
            // resolveActivity, which lies under package-visibility filtering.
            if (tryStart(new Intent(action), "openDndPeopleSettings/" + tag)) {
                promise.resolve(tag);
                return;
            }
        }

        SylkLogger.w("[dnd] openDndPeopleSettings: nothing resolved");
        promise.reject("open_failed", "No Do Not Disturb settings screen could be opened");
    }

    @ReactMethod
    public void openDndAccessSettings() {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        reactContext.startActivity(intent);
    }

    // Resolves true when the OS has granted notification-policy (DND /
    // "Modes" / Priority modes) access. Implemented as a Promise rather
    // than a plain value-returning @ReactMethod: the RN bridge ignores
    // return values from a normal @ReactMethod, so the previous boolean
    // signature always resolved to `undefined` on the JS side — making
    // the app believe access was never granted. Mirrors isOsDndOn below.
    @ReactMethod
    public void hasDndAccess(Promise promise) {
        try {
            NotificationManager nm =
                (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
            promise.resolve(nm != null && nm.isNotificationPolicyAccessGranted());
        } catch (Throwable t) {
            promise.resolve(false);
        }
    }

    // True when the system Do Not Disturb interruption filter is anything
    // other than INTERRUPTION_FILTER_ALL. Used by the JS incoming-call
    // handler (incomingCallFromWebSocket) to drop a WSS-delivered call
    // before SDP / ICE warmup so the NavBar never shows "Collecting ICE
    // candidates…" while the device is in DND. Mirrors
    // MyFirebaseMessagingService.isDndEnabled(), which gates FCM-delivered
    // pushes the same way. Fails open (resolves false) if the OS hasn't
    // granted notification-policy access — same safe fallback the native
    // path uses.
    @ReactMethod
    public void isOsDndOn(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                promise.resolve(false);
                return;
            }
            NotificationManager nm =
                (NotificationManager) reactContext.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null || !nm.isNotificationPolicyAccessGranted()) {
                promise.resolve(false);
                return;
            }
            int filter = nm.getCurrentInterruptionFilter();
            promise.resolve(filter != NotificationManager.INTERRUPTION_FILTER_ALL
                    && filter != NotificationManager.INTERRUPTION_FILTER_UNKNOWN);
        } catch (Throwable t) {
            promise.resolve(false);
        }
    }

    /**
     * Whether the OS has allowlisted this app from Doze / App Standby.
     *
     * This is the exemption that actually keeps sockets alive with the screen
     * off, and it is NOT what the location foreground service buys us --
     * FOREGROUND_SERVICE_LOCATION keeps location callbacks flowing and grants
     * no network exemption at all. florig's 2026-08-22 trace has
     * "[fgs] startForeground OK" followed by 65 sub-second connect refusals
     * across 32 minutes, recovering the instant the app came to the
     * foreground; whether this returns true is the fact that tells apart
     * "not allowlisted" from "allowlisted and something else is blocking us"
     * (on Samsung, Device Care's separate "deep sleeping apps" list, which no
     * API exposes).
     *
     * Reading this needs NO permission -- only the one-tap
     * ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS dialog does, and we
     * deliberately do not use it (see openBatteryOptimizationSettings).
     *
     * Fails CLOSED. Resolving true when we cannot tell would hide exactly the
     * condition this exists to surface.
     */
    @ReactMethod
    public void isIgnoringBatteryOptimizations(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                // Pre-Doze: nothing suspends the app's network, so the
                // allowlist is vacuously satisfied.
                promise.resolve(true);
                return;
            }
            android.os.PowerManager pm = (android.os.PowerManager)
                    reactContext.getSystemService(Context.POWER_SERVICE);
            boolean exempt = pm != null
                    && pm.isIgnoringBatteryOptimizations(reactContext.getPackageName());
            SylkLogger.d("[battopt] isIgnoringBatteryOptimizations=" + exempt);
            promise.resolve(exempt);
        } catch (Throwable t) {
            SylkLogger.w("[battopt] read failed: " + t.getMessage());
            promise.resolve(false);
        }
    }

    /**
     * Open the battery-optimization list so the user can allowlist Blink.
     *
     * Deliberately the LIST (ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS) and
     * not the one-tap dialog (ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).
     * The dialog requires REQUEST_IGNORE_BATTERY_OPTIMIZATIONS in the
     * manifest, which is a Play-restricted permission needing a declaration
     * that can bounce a release. The list costs the user two extra taps and
     * costs us nothing. It is also the only route that still works after the
     * user has answered the dialog once, since Android will not re-show it.
     *
     * Resolves with which screen opened so the caller can word the follow-up
     * instruction ("find Blink in the list") correctly.
     */
    @ReactMethod
    public void openBatteryOptimizationSettings(Promise promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            promise.resolve("unsupported");
            return;
        }
        if (tryStart(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
                     "battopt/settings")) {
            promise.resolve("list");
            return;
        }
        // OEM builds relocate this screen. The app's own details page always
        // exists and carries a Battery entry on every build we have seen.
        Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + reactContext.getPackageName()));
        if (tryStart(details, "battopt/appdetails")) {
            promise.resolve("app");
            return;
        }
        SylkLogger.w("[battopt] no battery optimization screen could be opened");
        promise.reject("open_failed", "No battery optimization screen could be opened");
    }
}
