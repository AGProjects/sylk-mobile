// Thin replacement for the deprecated `react-native-document-picker` (v6),
// which was renamed to `@react-native-documents/picker`. The successor
// dropped the `copyTo` / `fileCopyUri` convenience — obtaining a local copy
// of the picked file is now a separate `keepLocalCopy()` step — and replaced
// `isCancel(err)` with an `isErrorWithCode(err, errorCodes.OPERATION_CANCELED)`
// check. Migrated 2026-07-24 alongside the RN 0.76 upgrade, exactly as the
// dependency audit deferred it ("do the rename *with* the 0.76 step").
//
// Pinned to @react-native-documents/picker@10.1.7 on purpose: it is the last
// release that still supports RN 0.76 (v11+ raised the peerDependency floor
// to react-native >=0.79.0) AND runs on the OLD architecture — it ships the
// generated Paper spec under android/src/paper and gates `isTurboModule` on
// IS_NEW_ARCHITECTURE_ENABLED, so it links correctly while newArchEnabled is
// still false. Revisit the version pin at the New-Architecture flip.
//
// This shim reproduces the exact slice of the old default-export API that the
// two call sites (ChatBox._pickDocument, ConferenceBox._pickDocument) used —
// `pick()` resolving to an array whose `[0].fileCopyUri` is a local file path,
// `types`, and `isCancel(err)` — so only their import path changes; the pick
// logic in both components is untouched. It folds the new pick() + keepLocalCopy()
// into one call and maps OPERATION_CANCELED back onto the old isCancel() predicate.
import {
    pick,
    keepLocalCopy,
    types,
    errorCodes,
    isErrorWithCode,
} from '@react-native-documents/picker';

// Derive a filename (with extension) for keepLocalCopy. The picker almost
// always provides `name`; fall back to the last path segment, then a constant.
function fileNameFor(res) {
    if (res && res.name) {
        return res.name;
    }
    const uri = (res && res.uri) || '';
    let tail = '';
    try {
        tail = decodeURIComponent(uri.split('?')[0].split('/').pop() || '');
    } catch (e) {
        tail = uri.split('/').pop() || '';
    }
    return tail || 'document';
}

// Run each picked file through keepLocalCopy so callers get a stable local
// file:// path in the app's documentDirectory — the behaviour the old
// `copyTo: 'documentDirectory'` option delivered as `fileCopyUri`.
async function pickWithLocalCopy(options = {}) {
    // Strip the retired v6-only `copyTo` key; keep type / mode /
    // allowMultiSelection and anything else the successor understands.
    const { copyTo, ...pickOptions } = options;

    const results = await pick(pickOptions);

    return Promise.all(
        (results || []).map(async (res) => {
            try {
                const [copy] = await keepLocalCopy({
                    destination: 'documentDirectory',
                    files: [{ uri: res.uri, fileName: fileNameFor(res) }],
                });
                if (copy && copy.status === 'success') {
                    // Match the old response shape: fileCopyUri is the usable local path.
                    return { ...res, fileCopyUri: copy.localUri, copyError: null };
                }
                // Copy failed: mirror v6, which left fileCopyUri unset and surfaced copyError.
                return {
                    ...res,
                    fileCopyUri: null,
                    copyError: copy ? copy.copyError : 'keepLocalCopy returned no result',
                };
            } catch (e) {
                return { ...res, fileCopyUri: null, copyError: String(e) };
            }
        }),
    );
}

const DocumentPicker = {
    pick: pickWithLocalCopy,
    types,
    // v6 exposed isCancel(err); the successor replaced it with an error-code check.
    isCancel: (err) => isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED,
    // Passthroughs, in case a future call site wants the native API directly.
    keepLocalCopy,
    errorCodes,
    isErrorWithCode,
};

export default DocumentPicker;
