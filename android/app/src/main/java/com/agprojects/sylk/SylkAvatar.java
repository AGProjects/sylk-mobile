package com.agprojects.sylk;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.net.Uri;

import androidx.core.graphics.drawable.IconCompat;

import java.io.File;

/**
 * Contact avatars for notifications, shared by the two places that show a
 * person: the message notification in MyFirebaseMessagingService and the
 * CallStyle incoming-call notification in IncomingCallService.
 *
 * It lived inside the FCM service first, which meant calls kept showing a
 * blank caller while messages showed a face. Same lookup, same fallbacks, one
 * copy.
 */
public final class SylkAvatar {

	private SylkAvatar() {}

	// Palette for monogram avatars. Deliberately mid-to-dark so white initials
	// stay legible, and varied enough that adjacent conversations in the shade
	// are visually distinct. Picked by hashing the URI, so a contact keeps the
	// same colour forever.
	private static final int[] MONOGRAM_COLORS = {
			0xFF1E88E5, 0xFF6D4C41, 0xFF00897B, 0xFF5E35B1,
			0xFFC62828, 0xFF2E7D32, 0xFFAD1457, 0xFF455A64,
	};

	/**
	 * Avatar for a conversation notification, in three tiers.
	 *
	 * The circle beside a conversation notification is a PERSON slot -- it is
	 * where the sender's face goes. It used to be filled by the shortcut's icon,
	 * which was ic_notification: the 24dp monochrome status-bar silhouette,
	 * white on transparent. Scaled up into the avatar it read as an
	 * unidentifiable white blob.
	 *
	 *   1. The contact's real photo. contacts.photo holds whatever JS wrote from
	 *      the OS address book (app.js: contact.hasThumbnail ? thumbnailPath),
	 *      which is a content:// uri on most devices and a plain path on some.
	 *   2. A monogram -- first character of the display name on a colour derived
	 *      from the URI. Covers Sylk-only contacts with no phonebook entry, and
	 *      is what most messaging apps fall back to.
	 *   3. null, letting Android draw its own person placeholder.
	 *
	 * Never throws: an avatar is decoration, and failing to find one must not
	 * cost the user the notification. Runs on the FCM service thread, so the
	 * lookup is a single indexed read and the bitmap is small.
	 */
	public static IconCompat load(Context context, String account, String uri, String displayName) {
		String photo = null;

		File dbFile = context.getDatabasePath("sylk.db");
		if (dbFile.exists()) {
			SQLiteDatabase db = null;
			Cursor cursor = null;
			try {
				db = SQLiteDatabase.openDatabase(dbFile.getPath(), null, SQLiteDatabase.OPEN_READONLY);
				// Same uri/uris matching getContact uses. Keying on `uri` alone
				// missed any contact reached through an ALIAS -- the row's
				// primary uri differs from the sender's, the alias sits in the
				// comma-joined `uris` column -- which is silently common for
				// contacts merged from the address book.
				String sql =
						"SELECT photo FROM contacts WHERE account = ? AND (" +
						"uri = ? OR uris = ? OR uris LIKE ? OR uris LIKE ? OR uris LIKE ?)";
				cursor = db.rawQuery(sql, new String[]{
						account, uri, uri, uri + ",%", "%," + uri + ",%", "%," + uri });
				if (cursor != null && cursor.moveToFirst()) {
					photo = cursor.getString(0);
					SylkLogger.d("[avatar] row found for " + uri
							+ " photo=" + (photo == null ? "(null)"
								: photo.isEmpty() ? "(empty)" : photo));
				} else {
					SylkLogger.d("[avatar] no contacts row for " + uri
							+ " account=" + account);
				}
			} catch (Exception e) {
				SylkLogger.w("[avatar] lookup failed: " + e.getMessage());
			} finally {
				if (cursor != null) { try { cursor.close(); } catch (Exception ignored) {} }
				if (db != null) { try { db.close(); } catch (Exception ignored) {} }
			}
		}

		if (photo != null && !photo.trim().isEmpty()) {
			String path = photo.trim();
			try {
				if (path.startsWith("content://")) {
					SylkLogger.d("[avatar] using content uri for " + uri);
					return IconCompat.createWithAdaptiveBitmapContentUri(Uri.parse(path));
				}
				if (path.startsWith("file://")) {
					path = path.substring("file://".length());
				}
				Bitmap bmp = BitmapFactory.decodeFile(path);
				if (bmp != null) {
					SylkLogger.d("[avatar] decoded file for " + uri
							+ " (" + bmp.getWidth() + "x" + bmp.getHeight() + ")");
					return IconCompat.createWithAdaptiveBitmap(bmp);
				}
				SylkLogger.w("[avatar] decode returned null for " + path);
			} catch (Exception e) {
				SylkLogger.w("[avatar] load failed: " + e.getMessage());
			}
		}

		try {
			SylkLogger.d("[avatar] falling back to monogram for " + uri);
			return IconCompat.createWithAdaptiveBitmap(monogramBitmap(displayName, uri));
		} catch (Exception e) {
			SylkLogger.w("[avatar] monogram failed: " + e.getMessage());
			return null;
		}
	}

	/**
	 * Square bitmap: solid colour, one big white initial. Handed to
	 * createWithAdaptiveBitmap, which masks it to whatever shape the launcher
	 * and the shade use -- a circle in the notification avatar slot. Filled edge
	 * to edge so the mask never exposes a corner.
	 */
	private static Bitmap monogramBitmap(String displayName, String seed) {
		final int size = 256;
		Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
		Canvas canvas = new Canvas(bmp);

		// (h % n + n) % n, not Math.abs: Math.abs(Integer.MIN_VALUE) is still
		// negative and would throw on the array index.
		int hash = (seed == null ? "" : seed).hashCode();
		int idx = ((hash % MONOGRAM_COLORS.length) + MONOGRAM_COLORS.length) % MONOGRAM_COLORS.length;

		Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
		bg.setColor(MONOGRAM_COLORS[idx]);
		canvas.drawRect(0, 0, size, size, bg);

		String letter = "?";
		if (displayName != null) {
			String trimmed = displayName.trim();
			if (!trimmed.isEmpty()) {
				// codePointAt, not substring(0,1): a name starting with an emoji
				// or any astral character would otherwise be cut mid surrogate
				// pair and render as a tofu box.
				letter = new String(Character.toChars(trimmed.codePointAt(0))).toUpperCase();
			}
		}

		Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
		text.setColor(Color.WHITE);
		text.setTextSize(size * 0.42f);
		text.setTextAlign(Paint.Align.CENTER);
		text.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
		Paint.FontMetrics fm = text.getFontMetrics();
		float baseline = size / 2f - (fm.ascent + fm.descent) / 2f;
		canvas.drawText(letter, size / 2f, baseline, text);

		return bmp;
	}
}
