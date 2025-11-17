package com.agprojects.sylk;

import android.app.IntentService;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.text.TextUtils;
import android.util.Log;
import android.webkit.URLUtil;

import androidx.annotation.Nullable;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.util.UUID;

public class ThumbnailService extends IntentService {

    public static final String ACTION_EXTRACT = "com.agprojects.sylk.ACTION_EXTRACT";
    public static final String ACTION_RESULT  = "com.agprojects.sylk.ACTION_RESULT";

    public static final String EXTRA_REQUEST_ID   = "requestId";
    public static final String EXTRA_URI          = "uri";
    public static final String EXTRA_TIMESTAMP_MS = "timestampMs";
    public static final String EXTRA_MAX_WIDTH   = "maxWidth";
    public static final String EXTRA_MAX_HEIGHT  = "maxHeight";
    public static final String EXTRA_FORMAT      = "format";

    public static final String EXTRA_RESULT_PATH  = "resultPath";
    public static final String EXTRA_RESULT_ERROR = "errorMessage";

    private static final String TAG = "ThumbnailService";

    public ThumbnailService() {
        super("ThumbnailService");
    }

    @Override
    protected void onHandleIntent(@Nullable Intent intent) {
        if (intent == null) return;

        String requestId = intent.getStringExtra(EXTRA_REQUEST_ID);
        String uri       = intent.getStringExtra(EXTRA_URI);
        long timestampMs = intent.getLongExtra(EXTRA_TIMESTAMP_MS, 0);
        int maxWidth     = intent.getIntExtra(EXTRA_MAX_WIDTH, 512);
        int maxHeight    = intent.getIntExtra(EXTRA_MAX_HEIGHT, 512);
        String format    = intent.getStringExtra(EXTRA_FORMAT);
        if (format == null) format = "jpeg";

        String resultPath = null;
        String errorMessage = null;

        try {
            Bitmap frame = extractFrameSafe(this, uri, timestampMs, maxWidth, maxHeight);
            if (frame == null) throw new Exception("extractFrameSafe returned null");

            File cacheDir = new File(getCacheDir(), "thumbnails");
            if (!cacheDir.exists()) cacheDir.mkdirs();

            String fileName = "thumb-" + UUID.randomUUID() + "." + (format.equalsIgnoreCase("png") ? "png" : "jpg");
            File out = new File(cacheDir, fileName);

            try (OutputStream os = new FileOutputStream(out)) {
                if ("png".equalsIgnoreCase(format)) {
                    frame.compress(Bitmap.CompressFormat.PNG, 100, os);
                } else {
                    frame.compress(Bitmap.CompressFormat.JPEG, 90, os);
                }
                os.flush();
            }

            resultPath = "file://" + out.getAbsolutePath();

        } catch (Throwable t) {
            Log.e(TAG, "Extraction failed for " + uri, t);
            errorMessage = t.getClass().getSimpleName() + ": " + t.getMessage();
        }

        // Send result back to JS
        Intent result = new Intent(ACTION_RESULT);
        result.setPackage(getPackageName());
        result.putExtra(EXTRA_REQUEST_ID, requestId);

        if (resultPath != null) {
            result.putExtra(EXTRA_RESULT_PATH, resultPath);
        } else {
            result.putExtra(EXTRA_RESULT_ERROR, errorMessage == null ? "unknown_error" : errorMessage);
        }

        sendBroadcast(result);
    }

    private Bitmap extractFrameSafe(Context context, String filePath, long timestampMs, int maxWidth, int maxHeight) throws Exception {
        MediaMetadataRetriever retriever = null;

        try {
            retriever = new MediaMetadataRetriever();

            if (TextUtils.isEmpty(filePath)) {
                throw new IllegalArgumentException("Empty uri");
            }

            if (URLUtil.isFileUrl(filePath)) {
                String decoded;
                try { decoded = URLDecoder.decode(filePath, "UTF-8"); } 
                catch (UnsupportedEncodingException e) { decoded = filePath; }
                retriever.setDataSource(decoded.replace("file://", ""));
            } else if (filePath.startsWith("content://")) {
                retriever.setDataSource(context, Uri.parse(filePath));
            } else {
                retriever.setDataSource(filePath, new java.util.HashMap<>());
            }

            long timeUs = timestampMs * 1000;
            Bitmap frame = null;

            if (Build.VERSION.SDK_INT >= 27) {
                try {
                    frame = retriever.getScaledFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, maxWidth, maxHeight);
                } catch (Throwable t) {
                    frame = retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
                    if (frame != null) frame = Bitmap.createScaledBitmap(frame, maxWidth, maxHeight, true);
                }
            } else {
                frame = retriever.getFrameAtTime(timeUs);
                if (frame != null) frame = Bitmap.createScaledBitmap(frame, maxWidth, maxHeight, true);
            }

            if (frame == null) throw new Exception("Frame extraction returned null");

            return frame;
        } finally {
            try { if (retriever != null) retriever.release(); } catch (Throwable ignored) {}
        }
    }
}
