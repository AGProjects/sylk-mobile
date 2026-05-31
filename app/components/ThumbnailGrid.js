import React, {useState, useCallback, useMemo, useEffect} from 'react';
import { LayoutAnimation } from 'react-native';

import {
  View,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  Text,
  ActivityIndicator,
  Dimensions,
  SafeAreaView,
  Platform,
  ScrollView,
} from 'react-native';

import FastImage from 'react-native-fast-image';
import ImageViewer from 'react-native-image-zoom-viewer';
import { IconButton, Checkbox} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const {width: SCREEN_WIDTH, height: SCREEN_HEIGHT} = Dimensions.get('window');
const windowDims = Dimensions.get('window');
//console.log(windowDims);

/**
 * ThumbnailGrid
 *
 * Props:
 * - images: array of { id: string|number, uri: string, title?: string }
 * - numColumns: number (default 3)
 * - thumbnailSize: number (calculated from screen when omitted)
 * - containerStyle, imageStyle
 * - placeholderComponent
 * - useFastImage: boolean (if true it will try to use FastImage; fallback to Image)
 * - initialIndex (for opening viewer at a specific image)
 * - renderThumb (optional custom renderer function)
 *
 * Features:
 * - performant FlatList grid
 * - lazy loading thumbnails
 * - tap to open full-screen viewer (uses react-native-image-zoom-viewer if installed)
 * - long press callback
 */

export default function ThumbnailGrid({
  images = [],
  numColumns = 3,
  thumbnailSize,
  containerStyle,
  imageStyle,
  placeholderComponent,
  initialIndex = 0,
  renderThumb,
  isLandscape,
  onLongPress,
  onSelectionChange,
  selectedIds = [],
  selectMode = true,
  onRotateImage,
  enableDelete = false,
  deleteImages,
  showTimestamp = false,
  // Show the per-thumbnail size badge. False by default so the
  // chat-embedded photo group is uncluttered; the grid media screen
  // (where size IS the point of the view) opts in by passing true.
  showSize = false,
  // Optional: when provided, REPLACES the built-in ImageViewer tap
  // behaviour. Called with (item, index) on every center-tap. Used
  // by the per-contact video filter view to route taps to the
  // app-level full-screen video Modal (openVideoModal) instead of
  // opening the still-image viewer.
  onItemPress,
  // Optional: overlay a centered play triangle on every thumbnail.
  // Signals to the user that tapping plays a video, not opens a
  // still. Off by default so the image grid stays uncluttered.
  showPlayIcon = false,
  // Optional placeholder text when `images` is empty. Defaults to
  // "No images" so existing image-grid call sites keep their
  // wording; the video grid passes "No videos".
  emptyText = 'No images',
  // When true, skip the optimistic in-grid removal on the Delete
  // action-bar button — leave the caller to drive the actual
  // delete (e.g. open a confirmation modal first). Default false
  // preserves the image-grid behaviour where tapping Delete
  // immediately drops tiles and fires deleteImages.
  confirmBeforeDelete = false,
  // Corner the selection checkbox renders in. The image grid
  // historically uses bottom-right (out of the way of the user's
  // tap-to-open zone); the video grid wants top-left so the
  // selection state reads above the play overlay in the centre.
  checkboxCorner = 'bottom-right',  // 'top-left' | 'bottom-right'
  // Selection action: native Share. Mirrors enableDelete /
  // deleteImages — the action-bar Share button only renders when
  // enableShare is true; tapping it hands the array of selected
  // ids to shareImages, which is expected to resolve them to file
  // paths and invoke react-native-share / a native share sheet.
  enableShare = false,
  shareImages,
  // When true, tapping a tile ALWAYS opens the viewer (or fires
  // onItemPress) — the "if anything is already selected, tap
  // toggles selection" shortcut is suppressed. The checkbox in
  // the corner becomes the only way to add/remove items from the
  // selection. Used by the inline chat photo-group bubble where
  // viewing the photo is the primary intent and multi-select is
  // a secondary, deliberate action. The media gallery view leaves
  // this off so the photo-picker UX (tap-to-toggle once selection
  // mode is active) is preserved.
  tapAlwaysOpens = false,
  // Optional per-tile "go to chat on this day" affordance. When
  // provided, each tile renders a small chat-bubble icon overlay
  // (bottom-right corner). Tap fires onGoToDay(item) so the
  // caller can drop out of the media grid into the chat narrowed
  // to that tile's day. No overlay rendered when prop is missing.
  onGoToDay,
  // Optional. Invoked from the viewer's missing-file placeholder
  // when the user taps "Download from server". Receives the full
  // grid item — caller is expected to use item.metadata (carrying
  // url + transfer_id + sender + receiver) to kick off a fresh
  // download via the app's existing file-transfer pipeline. When
  // omitted the button is hidden, so this prop is purely additive.
  onRequestDownload,
  }) {

    const [containerWidth, setContainerWidth] = useState(0);
	const SCREEN_WIDTH = isLandscape ? windowDims.height : windowDims.width;
	const SCREEN_HEIGHT = isLandscape ? windowDims.width : windowDims.height;

    const [internalSelected, setInternalSelected] = useState([]);
    // Controlled when the parent wired up onSelectionChange — in
    // that case selectedIds is the single source of truth, even
    // when it's empty (otherwise the parent clearing selection
    // after a confirmed delete would fall back to internalSelected
    // and the Delete action bar would never hide). Uncontrolled
    // when onSelectionChange isn't provided: each tap updates the
    // internal state and the action bar lives entirely inside the
    // grid.
    const isControlled = typeof onSelectionChange === 'function';
    const selected = isControlled ? selectedIds : internalSelected;

    const [viewerVisible, setViewerVisible] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(initialIndex || 0);
    const [visibleImages, setVisibleImages] = useState(images);

	for (const image of images) {
		//console.log('--image', image.id, image.rotation);
	}

	const [rotations, setRotations] = useState(() => {
	  const map = {};
	  images.forEach(img => {
		map[img.id] = img.rotation || 0;
	  });
	  return map;
	});

	const size = useMemo(() => {
	  if (thumbnailSize) return thumbnailSize;
	  if (!containerWidth) return 0;
	
	  const pad = 0; // same as FlatList paddingHorizontal
	  const spacing = 0;
	
	  let totalSpacing = spacing * (numColumns - 1) + pad * 2;
	  if (numColumns > 1) {
		  totalSpacing = totalSpacing - 1;
	  }

	  return Math.floor((containerWidth - totalSpacing) / numColumns);
	}, [thumbnailSize, numColumns, containerWidth]);

  const openViewer = useCallback((index, item) => {
    console.log('Open image viewer', item.id, 'rotation', item.rotation, 'size', item.size);
    setCurrentIndex(index);
    setViewerVisible(true);
  }, []);

  // Pre-resolved per-image dimensions keyed by id. react-native-image-zoom-viewer
  // (3.0.1, unmaintained) calls Image.getSize internally to determine layout;
  // on iOS 26 that call silently fails for the bare absolute paths we use as
  // local image URIs (utils.sylk2GiftedChat strips the file:// prefix on iOS),
  // and with no failImageSource configured the library renders an empty wrapper
  // — i.e. a black screen. We pre-resolve dimensions here with a screen-size
  // fallback and pass them via imageUrls below; when image.width/height is
  // populated the library short-circuits its internal getSize and renders.
  const [imageSizes, setImageSizes] = useState({});

  // Normalise iOS bare paths to file:// URIs for Image.getSize. The thumbnail
  // FastImage path tolerates either form, but RN's Image.getSize on iOS needs
  // a real URL scheme.
  const normalizeUri = useCallback((uri) => {
    if (!uri) return uri;
    if (Platform.OS === 'ios' && uri.startsWith('/')) {
      return 'file://' + uri;
    }
    return uri;
  }, []);

  useEffect(() => {
    if (!viewerVisible) return;
    // Only prefetch dimensions for the CURRENT image (plus the immediate
    // neighbours, since the user may swipe). Earlier this iterated over
    // every image in the grid and fired Image.getSize for all of them at
    // once — on iOS 26 the native ImageLoader couldn't keep up and we'd
    // see "Excessive number of pending callbacks: 501" warnings, with
    // the unfulfilled callbacks causing our 1.5s timeout to fire and
    // incorrectly mark perfectly-valid images as missing.
    const indicesToFetch = [currentIndex - 1, currentIndex, currentIndex + 1]
      .filter(i => i >= 0 && i < visibleImages.length);
    indicesToFetch.forEach((i) => {
      const it = visibleImages[i];
      if (!it || imageSizes[it.id]) return;
      let resolved = false;
      const finish = (dims) => {
        if (resolved) return;
        resolved = true;
        setImageSizes((prev) => ({...prev, [it.id]: dims}));
      };
      // Safety net: if getSize never calls back (slow native loader,
      // resource pressure, etc.), fall back to screen-size dims so the
      // viewer renders something. We deliberately do NOT mark `missing`
      // on timeout — slow != missing. The actual "file is gone" signal
      // comes from getSize's fail callback or <Image>'s onError below.
      const timer = setTimeout(
        () => finish({width: SCREEN_WIDTH, height: SCREEN_HEIGHT}),
        2000,
      );
      try {
        Image.getSize(
          normalizeUri(it.uri),
          (w, h) => {
            clearTimeout(timer);
            finish({width: w, height: h});
          },
          (err) => {
            clearTimeout(timer);
            // Build a single JSON-quoted line so Metro doesn't truncate
            // long URIs mid-string when the multi-arg list overflows
            // its per-message buffer (seen with image-share filenames
            // like share-<UUID>.jpg appended to per-account paths).
            console.log('[image-viewer] missing file (getSize failed) ' +
              JSON.stringify({
                msgId: it.id,
                transferId: it.transferId || null,
                uri: it.uri,
                uriLen: it.uri && it.uri.length,
                err: err && (err.message || String(err)),
              }));
            finish({width: SCREEN_WIDTH, height: SCREEN_HEIGHT, missing: true});
          },
        );
      } catch (e) {
        clearTimeout(timer);
        console.log('[image-viewer] missing file (getSize threw)',
          'msgId=', it.id,
          'transferId=', it.transferId || '(none)',
          'uri=', it.uri,
          'err=', e && e.message);
        finish({width: SCREEN_WIDTH, height: SCREEN_HEIGHT, missing: true});
      }
    });
  }, [viewerVisible, currentIndex, visibleImages, imageSizes, normalizeUri, SCREEN_WIDTH, SCREEN_HEIGHT]);

  // Tracks per-id load failure so the viewer can swap in a friendly
  // "file not available" placeholder instead of a black void. Keyed by
  // image id (matches imageSizes). Cleared when the viewer closes so a
  // re-open re-attempts the load (the user may have re-downloaded).
  const [missingFiles, setMissingFiles] = useState({});

  // Per-id flag set when the user taps the placeholder's "Download
  // from server" button — flips the button to a spinner so they don't
  // hammer it. The actual download runs in the parent's pipeline; when
  // it completes the message's metadata.local_url updates and the
  // grid prop change re-renders the tile, which clears the missing
  // flag implicitly on the next viewer open.
  const [downloadingIds, setDownloadingIds] = useState({});

useEffect(() => {
  // If a tile's URI changed (the most common cause being a successful
  // "Download from server" tap completing — metadata.local_url just
  // got populated and the parent rebuilt the items), drop any cached
  // missing/downloading/dimension state for that id so the viewer
  // re-attempts the load against the fresh URI instead of staying
  // stuck on the placeholder.
  const prevByUri = {};
  visibleImages.forEach(it => { prevByUri[it.id] = it.uri; });
  const refreshedIds = [];
  images.forEach(it => {
	if (prevByUri[it.id] !== undefined && prevByUri[it.id] !== it.uri) {
	  refreshedIds.push(it.id);
	}
  });
  setVisibleImages(images);
  if (refreshedIds.length > 0) {
	const drop = (prev) => {
	  const next = {...prev};
	  refreshedIds.forEach(id => { delete next[id]; });
	  return next;
	};
	setMissingFiles(drop);
	setDownloadingIds(drop);
	setImageSizes(drop);
  }
}, [images]);  // eslint-disable-line react-hooks/exhaustive-deps

const formatSize = (bytes) => {
  if (!bytes && bytes !== 0) return '';

  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;

  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }

  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[i]}`;
};

const formatTimestamp = (ts) => {
  if (!ts) return '';

  const now = new Date();

  const d =
    typeof ts === 'number'
      ? new Date(ts < 1e12 ? ts * 1000 : ts) // handles seconds vs ms
      : new Date(ts);

  // Check if same day
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  if (isToday) {
    // 👉 Show time
    return `${d.getHours().toString().padStart(2, '0')}:${d
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
  }

  // 👉 Show date (clean + compact)
  return `${d.getDate()} ${d.toLocaleString('default', { month: 'short' })}`;
};


	const closeViewer = useCallback(() => {
	  setViewerVisible(false);
	  // Reset missing-file flags so a subsequent open re-attempts the
	  // load — the file may have come back (re-download, container path
	  // remap after restart, etc.).
	  setMissingFiles({});
	  setDownloadingIds({});

	  if (!onRotateImage) return;
	
	  const changed = {};
	
	  images.forEach(img => {
		const original = img.rotation || 0;
		const current = rotations[img.id] || 0;
	
		if (original !== current) {
		  changed[img.id] = current;
		}
	  });
	
	  if (Object.keys(changed).length > 0) {
		onRotateImage(changed);
	  }
	
	}, [rotations, images, onRotateImage]);

	const rotateImage = useCallback(() => {
	  const current = images[currentIndex];
	  if (!current) return;
	
	  const newRotation = ((rotations[current.id] || 0) + 90) % 360;
	
	  // update local state
	  setRotations(prev => ({
		...prev,
		[current.id]: newRotation
	  }));
		
	}, [images, currentIndex, rotations, onRotateImage]);


const currentImage = images[currentIndex];
const rotation = currentImage ? (rotations[currentImage.id] || 0) : 0;

const toggleSelect = useCallback((item) => {
  const isSelected = selected.includes(item.id);

  let newSelected;
  if (isSelected) {
    newSelected = selected.filter(id => id !== item.id);
  } else {
    newSelected = [...selected, item.id];
  }

  // Internal state is the source of truth only when uncontrolled
  // (no onSelectionChange handler). See the matching comment on
  // isControlled above for the rationale.
  if (!isControlled) {
    setInternalSelected(newSelected);
  }

  onSelectionChange && onSelectionChange(newSelected, item);
}, [selected, isControlled, onSelectionChange]);

// Inject per-item selection + rotation into the data passed to
// FlatList. FlatList compares items by reference when deciding
// whether to re-render a cached cell — closure-only state like the
// outer `selected` array (passed via extraData) was being ignored
// in practice on this version of RN, so tiles "remembered" their
// first render and never repainted when selection changed. By
// rebuilding the data array whenever `selected` or `rotations`
// changes, the item reference itself changes for the affected
// rows, which forces a cell-level re-render via the normal item
// diff path. The result: tap-to-toggle reflects immediately, and
// rotations also propagate without relying on extraData.
const displayData = useMemo(
  () => visibleImages.map(img => ({
    ...img,
    _selected: selected.includes(img.id),
    _rotation: rotations[img.id] || 0,
  })),
  [visibleImages, selected, rotations],
);

const renderItem = useCallback(
  ({item, index}) => {
    const isSelected = !!item._selected;
    const itemRotation = item._rotation || 0;
    const sizeLabel = formatSize(item.size);

    return (
      <View style={[styles.thumb, {width: size, height: size}]}>
			<FastImage
			  source={{ uri: item.uri }}
			  style={[
				styles.image,
				{ width: size, height: size },
				imageStyle,
				{
				  transform: [{ rotate: `${itemRotation}deg` }],
				},
			  ]}
			  resizeMode={FastImage.resizeMode.cover}
			/>

		{showTimestamp && item.timestamp && (
		  <View style={styles.timestampBadge}>
			<Text style={styles.timestampText}>
			  {formatTimestamp(item.timestamp)}
			</Text>
		  </View>
		)}

		{/* Play / download / in-flight overlay used by the video
		    filter view. Three visual states per tile:
		      • item.stage === 'download' or 'decrypt' → spinner
		        + percentage. Indicates a transfer is in flight
		        for this id; reflects updateTransferProgress
		        from app.js in real time. While in this state the
		        tap is still routed through onItemPress (callers
		        typically no-op or cancel — the bubble's existing
		        flow handles cancellation).
		      • item.downloaded === false (no in-flight transfer)
		        → cloud-download icon. Tap kicks off the
		        download via onItemPress.
		      • otherwise (downloaded or back-compat) → play
		        triangle. Tap plays in the modal.
		    White glyph on a translucent black disc — readable
		    against most thumbnails without dominating the tile.
		    pointerEvents="none" so the overlay never intercepts
		    the center-tap that follows. */}
		{(() => {
		  const inFlight = item.stage === 'download' || item.stage === 'decrypt';
		  const notDownloaded = item.downloaded === false;
		  // Three states drive the overlay:
		  //   • inFlight        → spinner + percentage
		  //   • notDownloaded   → cloud-download icon (image/video grids,
		  //                       both want this on undownloaded tiles)
		  //   • showPlayIcon    → play triangle (video grid only — image
		  //                       grid pass false so downloaded tiles
		  //                       have no overlay; the bitmap is the
		  //                       affordance)
		  // None of the three → no overlay at all.
		  const overlayKind = inFlight
		      ? 'inflight'
		      : notDownloaded
		          ? 'download'
		          : (showPlayIcon ? 'play' : null);
		  if (!overlayKind) return null;
		  const pct = (typeof item.progress === 'number')
		    ? Math.max(0, Math.min(100, Math.round(item.progress)))
		    : null;
		  return (
		    <View
		      pointerEvents="none"
		      style={{
		        position: 'absolute',
		        left: 0,
		        right: 0,
		        top: 0,
		        bottom: 0,
		        alignItems: 'center',
		        justifyContent: 'center',
		      }}
		    >
		      <View style={{
		        // The in-flight disc is a touch larger so the
		        // spinner + label fit without crowding.
		        width: overlayKind === 'inflight' ? 56 : 44,
		        height: overlayKind === 'inflight' ? 56 : 44,
		        borderRadius: overlayKind === 'inflight' ? 28 : 22,
		        backgroundColor: 'rgba(0,0,0,0.55)',
		        alignItems: 'center',
		        justifyContent: 'center',
		      }}>
		        {overlayKind === 'inflight' ? (
		          <>
		            <ActivityIndicator size="small" color="#fff" />
		            {pct !== null && (
		              <Text style={{
		                color: '#fff',
		                fontSize: 10,
		                marginTop: 2,
		                fontWeight: '600',
		              }}>
		                {pct}%
		              </Text>
		            )}
		          </>
		        ) : (
		          <Icon
		            name={overlayKind === 'download' ? 'cloud-download' : 'play'}
		            size={26}
		            color="#fff"
		          />
		        )}
		      </View>
		    </View>
		  );
		})()}

        <TouchableOpacity
          style={styles.centerTouch}
          activeOpacity={0.9}
          onPress={() => {
            // Selection mode (any tile already selected): center
            // taps toggle selection instead of opening the
            // viewer / playing the video. Photo apps work the
            // same way — once you're picking items, every tap
            // should just add/remove from the selection until
            // you Cancel or Delete. Drops the small "tap the
            // checkbox precisely" UX hurdle.
            //
            // tapAlwaysOpens opts out of this shortcut: the
            // inline chat photo-group bubble wants tap → viewer
            // every time, with the corner checkbox being the
            // only way to add/remove items from selection. The
            // media-gallery grid leaves the prop off and keeps
            // the photo-picker shortcut.
            if (!tapAlwaysOpens && selectMode && selected.length > 0) {
              toggleSelect(item);
              return;
            }
            // Default tap routing.
            //   • Not downloaded yet → route to onItemPress only
            //     when supplied. Image-grid and video-grid both
            //     pass it to kick off a downloadFile call. Without
            //     onItemPress the tap quietly no-ops on an
            //     undownloaded tile (no viewer to open anyway).
            //   • Downloaded:
            //       - video grid wants its OWN modal (the embedded
            //         react-native-video viewer), so onItemPress is
            //         honoured.
            //       - image grid wants the built-in zoom viewer
            //         regardless of whether onItemPress was
            //         supplied; the image-grid's onItemPress only
            //         handles the undownloaded case. To express
            //         that distinction, the image grid sets
            //         `showPlayIcon={false}` (it's not a video
            //         tile), which we use here as the discriminator:
            //         no play icon means "still picture, fall
            //         through to openViewer for downloaded tiles".
            const notDownloaded = item.downloaded === false;
            if (notDownloaded) {
              if (typeof onItemPress === 'function') {
                onItemPress(item, index);
              }
              return;
            }
            // Downloaded: video grid (showPlayIcon=true) routes via
            // onItemPress; image grid (showPlayIcon=false) opens
            // the built-in viewer.
            if (showPlayIcon && typeof onItemPress === 'function') {
              onItemPress(item, index);
            } else {
              openViewer(index, item);
            }
          }}
          onLongPress={() => onLongPress && onLongPress(item, index)}
        />

		{showSize && item.size != null && (
		  <View style={styles.sizeBadge}>
			<Text style={styles.sizeText}>{sizeLabel}</Text>
		  </View>
		)}
        
          { selectMode ?
          <TouchableOpacity
            style={[
              styles.checkbox,
              checkboxCorner === 'top-left' ? styles.checkboxTopLeft : null,
            ]}
          onPress={(e) => {
            e.stopPropagation(); // prevent opening viewer
            toggleSelect(item);
          }}
          >
            <View style={[
              styles.checkboxInner,
              isSelected && styles.checkboxSelected
            ]}>
              {isSelected && <Text style={styles.checkmark}>✓</Text>}
            </View>
          </TouchableOpacity>
          : null
          }

          {/* "Go to chat on this day" overlay — bottom-right
              corner. Sits on top of the size badge slot's
              opposite side so the two never collide. zIndex >
              the center touch so the tap reaches us instead of
              the viewer/download routing. stopPropagation
              prevents the underlying centerTouch from also
              firing. */}
          { typeof onGoToDay === 'function' ?
          <TouchableOpacity
            style={styles.gotoDay}
            onPress={(e) => {
              if (e && e.stopPropagation) e.stopPropagation();
              onGoToDay(item);
            }}
            hitSlop={{top: 6, left: 6, right: 6, bottom: 6}}
          >
            <View style={styles.gotoDayInner}>
              <Icon name="message-text-outline" size={14} color="#fff" />
            </View>
          </TouchableOpacity>
          : null
          }

      </View>
    );
  },
  [size, imageStyle, openViewer, onLongPress, selected, toggleSelect, selectMode, onItemPress, tapAlwaysOpens, onGoToDay],
);

  if (!images || images.length === 0) {
    return placeholderComponent ? (
      placeholderComponent
    ) : (
      <View style={[styles.emptyContainer, containerStyle]}>
        <Text style={styles.emptyText}>{emptyText}</Text>
      </View>
    );
  }

  // prepare images for optional react-native-image-zoom-viewer which expects {url: '...'} items

// Provide url, width, and height up front so react-native-image-zoom-viewer
// skips its internal Image.getSize call (which fails on iOS 26 for our
// local-file URIs and produces a black screen — see openViewer comment).
const viewerImages = visibleImages.map((it) => {
  const dims = imageSizes[it.id];
  return {
    url: normalizeUri(it.uri),
    width: dims ? dims.width : SCREEN_WIDTH,
    height: dims ? dims.height : SCREEN_HEIGHT,
    props: {},
  };
});

return (
  <View
    style={[styles.container, containerStyle]}
    onLayout={(e) => {
      const w = e.nativeEvent.layout.width;
      if (w !== containerWidth) {
        setContainerWidth(w);
      }
    }}
  >
    {/* Direct FlatList — earlier this was wrapped in a
        TouchableWithoutFeedback with an empty onPress + an
        unstyled inner View. The wrapper served no purpose (empty
        handler) but on iOS could intermittently swallow scroll
        gestures: the touch responder system speculatively held
        the touch for the parent's potential tap, and on tiles
        where the press start landed near the boundary the gesture
        was dropped instead of forwarded to the FlatList. Removing
        the wrapper restores predictable scroll behaviour. */}
    <FlatList
      // `displayData` is `visibleImages` rebuilt whenever the
      // selection (or rotations) changes, with `_selected` /
      // `_rotation` baked onto each item. Item references therefore
      // change exactly when the cell's visible state changes, which
      // is the signal FlatList uses for re-renders. No extraData
      // needed.
      data={displayData}
      key={`grid-${numColumns}`}
      keyExtractor={(item) => String(item.id ?? item.uri)}
      renderItem={renderItem}
      numColumns={numColumns}
      showsVerticalScrollIndicator={false}
      // removeClippedSubviews has known scroll-glitch reports on
      // Android grids with images — it unmounts off-screen views
      // and remounting them on re-entry can drop touch state.
      // Off here; the windowSize cap below already keeps memory
      // bounded.
      removeClippedSubviews={false}
      initialNumToRender={12}
      windowSize={9}
      style={{flex: 1}}
      contentContainerStyle={{
        paddingHorizontal: 0,
        paddingVertical: 0,
        paddingBottom: enableDelete && selected.length > 0 ? 70 : 0,
      }}
    />

  {/* Sticky action bar — order: Delete · Cancel · Share, per
      user spec. Cancel sits between the two action buttons so a
      thumb resting in the middle of the bar hits the safe
      "deselect" affordance rather than either of the actions on
      the edges. */}
  {(enableDelete || enableShare) && selected.length > 0 && (
	<View style={styles.actionBar}>
	  {enableDelete && (
	  <TouchableOpacity
		style={styles.deleteButton}
		onPress={() => {
		  const toDelete = selected;
		  // For callers that drive their own confirmation flow
		  // (e.g. the image / video grids pop a Delete-files
		  // modal first), skip the in-grid optimistic remove
		  // and selection-clear — let them decide when (and
		  // whether) to apply the change after the user
		  // confirms. Default behaviour (uncontrolled grids)
		  // is unchanged: drop the tiles, clear selection, and
		  // notify.
		  if (!confirmBeforeDelete) {
		    setVisibleImages(prev =>
		      prev.filter(img => !toDelete.includes(img.id))
		    );
		    if (!isControlled) {
		      setInternalSelected([]);
		    }
		  }
		  // Notify parent (async delete OR open confirmation modal).
		  deleteImages && deleteImages(toDelete);
		}}
	  >
		<Text style={styles.deleteText}>Delete ({selected.length})</Text>
	  </TouchableOpacity>
	  )}
	  <TouchableOpacity
		style={styles.cancelButton}
		onPress={() => {
		  // Exit selection mode without acting. Clear both local +
		  // parent-controlled selection so the grid's tap routing
		  // falls back to the normal "open viewer / play video"
		  // path on subsequent taps.
		  setInternalSelected([]);
		  if (typeof onSelectionChange === 'function') {
		    onSelectionChange([], null);
		  }
		}}
	  >
		<Text style={styles.cancelText}>Cancel</Text>
	  </TouchableOpacity>
	  {enableShare && (
	  <TouchableOpacity
		style={styles.shareButton}
		onPress={() => {
		  const toShare = selected;
		  // Share doesn't drop tiles or clear selection — the
		  // user typically wants to remain in selection mode
		  // after the share sheet dismisses (e.g. so they can
		  // then Delete the same set without re-selecting).
		  shareImages && shareImages(toShare);
		}}
	  >
		<Text style={styles.shareText}>Share ({selected.length})</Text>
	  </TouchableOpacity>
	  )}
	</View>
  )}
  
      {/* Viewer Modal */}
			  <Modal
				visible={viewerVisible}
				transparent={false}
				animationType="fade"
				onRequestClose={closeViewer}
			  >
				<ImageViewer
				  imageUrls={viewerImages}
				  index={currentIndex}
				  onChange={(index) => {
					if (index !== undefined) {
					  setCurrentIndex(index);
					}
				  }}
				  enableSwipeDown
				  backgroundColor="black"
				  renderIndicator={() => null}
				  saveToLocalByLongPress={false}
				  onClick={closeViewer}
				  renderImage={(props) => {
					// Identify the current image by URL match so we can
					// surface a placeholder when the underlying file is
					// missing (stale iOS container UUID, picker-temp gone,
					// etc.). Falls back to the normal Image render in the
					// common case where the file decodes fine.
					const _curImg = images[currentIndex];
					const _isMissing = _curImg
					  && (missingFiles[_curImg.id]
						|| (imageSizes[_curImg.id] && imageSizes[_curImg.id].missing));
					if (_isMissing) {
					  // Show "Download from server" only when we have a
					  // way to actually initiate a download (parent wired
					  // onRequestDownload) AND the item carries a remote
					  // URL on its metadata. Otherwise the button would
					  // tap into a dead end.
					  const _canDownload = typeof onRequestDownload === 'function'
					    && _curImg && _curImg.metadata && _curImg.metadata.url;
					  const _isDownloading = _curImg && downloadingIds[_curImg.id];
					  return (
						<View style={{
						  width: SCREEN_WIDTH,
						  height: SCREEN_HEIGHT,
						  alignItems: 'center',
						  justifyContent: 'center',
						  padding: 24,
						}}>
						  <Icon name="image-broken-variant" size={64} color="#888" />
						  <Text style={{color: '#bbb', marginTop: 12, fontSize: 16, textAlign: 'center'}}>
							File not available
						  </Text>
						  <Text style={{color: '#777', marginTop: 6, fontSize: 12, textAlign: 'center'}}>
							The image file is missing or could not be opened.
						  </Text>
						  {_canDownload && (
							<TouchableOpacity
							  disabled={_isDownloading}
							  onPress={() => {
								setDownloadingIds((prev) => ({...prev, [_curImg.id]: true}));
								try { onRequestDownload(_curImg); } catch (e) {
								  console.log('[image-viewer] onRequestDownload threw', e && e.message);
								}
								// Watchdog: even when the download succeeds,
								// some call sites don't refresh the grid's
								// `images` prop with a new URI for the
								// freshly-decrypted file (the media-gallery
								// view, for instance, holds a snapshot list
								// that isn't re-derived per render). Without
								// this, the button stays on "Downloading…"
								// forever even though the underlying transfer
								// completed. After 12s, optimistically clear
								// the missing/downloading/dim caches for this
								// id — the next dim prefetch will hit the
								// (now-present) file and the viewer re-renders.
								const _id = _curImg.id;
								setTimeout(() => {
								  setDownloadingIds((prev) => {
									if (!prev[_id]) return prev;
									const next = {...prev}; delete next[_id]; return next;
								  });
								  setMissingFiles((prev) => {
									if (!prev[_id]) return prev;
									const next = {...prev}; delete next[_id]; return next;
								  });
								  setImageSizes((prev) => {
									if (!prev[_id]) return prev;
									const next = {...prev}; delete next[_id]; return next;
								  });
								}, 12000);
							  }}
							  style={{
								marginTop: 20,
								flexDirection: 'row',
								alignItems: 'center',
								backgroundColor: _isDownloading ? '#555' : '#2196F3',
								paddingHorizontal: 18,
								paddingVertical: 10,
								borderRadius: 22,
							  }}
							>
							  {_isDownloading
								? <ActivityIndicator size="small" color="#fff" />
								: <Icon name="cloud-download" size={20} color="#fff" />}
							  <Text style={{color: '#fff', fontSize: 14, fontWeight: '600', marginLeft: 8}}>
								{_isDownloading ? 'Downloading…' : 'Download from server'}
							  </Text>
							</TouchableOpacity>
						  )}
						</View>
					  );
					}
					return (
					<View
					  style={{
						flex: 1,
						alignItems: "center",
						justifyContent: "center",
					  }}
					>
					  <Image
						{...props}
						key={rotation}
						onError={(e) => {
						  if (_curImg) {
							console.log('[image-viewer] missing file',
							  'msgId=', _curImg.id,
							  'transferId=', _curImg.transferId || '(none)',
							  'uri=', _curImg.uri,
							  'err=', e && e.nativeEvent && e.nativeEvent.error);
							setMissingFiles((prev) => ({...prev, [_curImg.id]: true}));
						  }
						}}
						style={[
						  props.style,
						  { transform: [{ rotate: `${rotation}deg`}] },
						]}
					  />
					</View>
					);
				  }}
				/>
			
				<TouchableOpacity
				  onPress={rotateImage}
				  style={{
					position: "absolute",
					bottom: 40,
					right: 30,
					backgroundColor: "rgba(0,0,0,0.6)",
					padding: 12,
					borderRadius: 50,
				  }}
				>
				  <IconButton
						type="font-awesome"
						size={40}
						icon="rotate-left"
						iconColor="white"
					  />
				</TouchableOpacity>

				{/* Close button — explicit "go back" affordance. The
				    viewer's onClick=closeViewer also exits, but a tap on
				    the photo competes with zoom gestures and isn't
				    discoverable. The X gives users an obvious way out. */}
				<TouchableOpacity
				  onPress={closeViewer}
				  hitSlop={{top: 20, left: 20, right: 20, bottom: 20}}
				  style={{
					position: "absolute",
					top: 40,
					left: 30,
					backgroundColor: "rgba(0,0,0,0.6)",
					width: 56,
					height: 56,
					borderRadius: 28,
					alignItems: "center",
					justifyContent: "center",
					zIndex: 100,
					elevation: 100,
				  }}
				>
				  <Icon name="close" size={36} color="white" />
				</TouchableOpacity>
			  </Modal>
			  
    </View>
);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  thumb: {
    margin: 0,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#eee',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },

  emptyText: {
    color: '#666',
  },

  viewerSafeArea: {
    flex: 1,
    backgroundColor: '#000',
  },

  viewerHeader: {
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },

  closeButton: {
    padding: 8,
  },

  closeText: {
    color: '#fff',
    fontSize: 16,
  },

  viewerScrollContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  fullImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.75,
  },

 fullImageLandscape: {
  width: SCREEN_HEIGHT,
  height: SCREEN_WIDTH * 0.75,
},

  loadingIndicator: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -10,
    marginTop: -10,
    zIndex: 10,
  },

checkbox: {
  position: 'absolute',
  bottom: 6,
  right: 6,
  zIndex: 2,
},

// Override consumed via checkboxCorner='top-left' on the video
// grid. Cancels the bottom/right anchors from `checkbox` and
// re-anchors at the top-left corner. Cleaner than a single
// {...style, corner: ...} merge because RN flattens style arrays
// and the absent properties (bottom/right) get unset by setting
// them back to 'auto'.
checkboxTopLeft: {
  top: 6,
  left: 6,
  bottom: 'auto',
  right: 'auto',
},

checkboxInner: {
  width: 22,
  height: 22,
  borderRadius: 10,
  borderWidth: 0.3,
  borderColor: '#fff',
  backgroundColor: 'rgba(0,0,0,0.4)',
  justifyContent: 'center',
  alignItems: 'center',
},

checkboxSelected: {
  backgroundColor: '#007AFF',
  borderColor: '#007AFF',
},

checkmark: {
  color: '#fff',
  fontSize: 14,
  fontWeight: 'bold',
},

// "Go to chat on this day" affordance — bottom-right corner.
// Higher zIndex than the centerTouch so the tap reaches the
// TouchableOpacity instead of routing to the viewer/download
// path. Small disc with a chat-bubble icon so the affordance
// reads as "open a conversation surface" without taking real
// estate from the photo itself.
gotoDay: {
  position: 'absolute',
  bottom: 6,
  right: 6,
  zIndex: 3,
},
gotoDayInner: {
  width: 24,
  height: 24,
  borderRadius: 12,
  backgroundColor: 'rgba(0,0,0,0.55)',
  alignItems: 'center',
  justifyContent: 'center',
},

// Tile-wide tap surface. Previously a 50% × 50% center square,
// which left the corners/edges of each thumbnail uncovered — those
// taps then bubbled up through GiftedChat's Bubble to the chat's
// onPress={onMessagePress} handler and triggered the quick-reaction
// emoji bar instead of selecting/viewing the image. Cover the
// whole tile so the grid claims the touch responder for every
// in-tile press. The checkbox keeps its higher zIndex (see
// `checkbox` style), so its tap zone in the corner still wins for
// hit testing.
centerTouch: {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 1,
},
sizeBadge: {
  position: 'absolute',
  bottom: 6,
  left: 6,
  backgroundColor: 'rgba(0,0,0,0.5)',
  paddingHorizontal: 6,
  paddingVertical: 2,
  borderRadius: 6,
},

sizeText: {
  color: '#fff',
  fontSize: 11,
},

actionBar: {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  height: 60,
  backgroundColor: 'rgba(0,0,0,0.9)',
  flexDirection: 'row',
  alignItems: 'center',
  // Two buttons now: Cancel + Delete. Space them out evenly
  // across the bar with even padding.
  justifyContent: 'space-around',
  paddingHorizontal: 16,
  borderTopWidth: 0.5,
  borderColor: '#333',
},

// Outlined-style Cancel — neutral colour so the destructive
// Delete remains visually dominant on the right.
cancelButton: {
  paddingHorizontal: 20,
  paddingVertical: 10,
  borderRadius: 20,
  borderWidth: 1,
  borderColor: '#bbb',
},

cancelText: {
  color: '#fff',
  fontSize: 14,
  fontWeight: '500',
},

deleteButton: {
  backgroundColor: '#ff3b30',
  paddingHorizontal: 20,
  paddingVertical: 10,
  borderRadius: 20,
},

deleteText: {
  color: '#fff',
  fontSize: 14,
  fontWeight: '600',
},

// Same pill shape as Delete but in the platform's "system blue"
// — non-destructive, signals an outbound action (matches the
// share-sheet header tint on iOS).
shareButton: {
  backgroundColor: '#2196F3',
  paddingHorizontal: 20,
  paddingVertical: 10,
  borderRadius: 20,
},

shareText: {
  color: '#fff',
  fontSize: 14,
  fontWeight: '600',
},

timestampBadge: {
  position: 'absolute',
  top: 6,
  right: 6,
  backgroundColor: 'rgba(0,0,0,0.5)',
  paddingHorizontal: 6,
  paddingVertical: 2,
  borderRadius: 6,
},

timestampText: {
  color: '#fff',
  fontSize: 10, // 👈 slightly smaller than size badge
},

});

/**
 * <ThumbnailGrid
 *   images={[{id: '1', uri: 'https://...'}, ...]}
 *   numColumns={4}
 *   onLongPress={(item) => console.log('long', item)}
 *   renderThumb={({item, index, size}) => (
 *     <View style={{flex:1}}>
 *       <Image source={{uri:item.uri}} style={{width:size, height:size, borderRadius:6}} />
 *     </View>
 *   )}
 * />
 *
 */

