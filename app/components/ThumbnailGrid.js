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
  shareImages
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

useEffect(() => {
  setVisibleImages(images);
}, [images]);

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

const renderItem = useCallback(
  ({item, index}) => {
    const isSelected = selected.includes(item.id);
    const itemRotation = rotations[item.id] || 0;
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
		{showPlayIcon && (() => {
		  const inFlight = item.stage === 'download' || item.stage === 'decrypt';
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
		        width: inFlight ? 56 : 44,
		        height: inFlight ? 56 : 44,
		        borderRadius: inFlight ? 28 : 22,
		        backgroundColor: 'rgba(0,0,0,0.55)',
		        alignItems: 'center',
		        justifyContent: 'center',
		      }}>
		        {inFlight ? (
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
		            name={item.downloaded === false ? 'cloud-download' : 'play'}
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
            if (selectMode && selected.length > 0) {
              toggleSelect(item);
              return;
            }
            // Default tap routing — onItemPress for callers that
            // override (video grid → full-screen video Modal),
            // built-in openViewer otherwise (image grid → zoom
            // viewer).
            if (typeof onItemPress === 'function') {
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

      </View>
    );
  },
  [size, imageStyle, openViewer, onLongPress, selected, toggleSelect, selectMode, onItemPress],
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

const viewerImages = visibleImages.map((it) => ({
  url: it.uri,
  props: {},
}));

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
      data={visibleImages}
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
				  renderImage={(props) => (
					<View
					  style={{
						alignItems: "center",
						justifyContent: "center",
					  }}
					>
					  <Image
						{...props}
						key={rotation}
						style={[
						  props.style,
						  { transform: [{ rotate: `${rotation}deg`}] },
						]}
					  />
					</View>
				  )}
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

centerTouch: {
  position: 'absolute',
  top: '25%',
  left: '25%',
  width: '50%',
  height: '50%',
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

