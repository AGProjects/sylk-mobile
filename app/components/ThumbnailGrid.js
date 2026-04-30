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
  showSize = false
  }) {

    const [containerWidth, setContainerWidth] = useState(0);
	const SCREEN_WIDTH = isLandscape ? windowDims.height : windowDims.width;
	const SCREEN_HEIGHT = isLandscape ? windowDims.width : windowDims.height;

    const [internalSelected, setInternalSelected] = useState([]);
    const selected = selectedIds.length ? selectedIds : internalSelected;

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

  if (!selectedIds.length) {
    setInternalSelected(newSelected);
  }

  onSelectionChange && onSelectionChange(newSelected, item);
}, [selected, selectedIds, onSelectionChange]);

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

        <TouchableOpacity
          style={styles.centerTouch}
          activeOpacity={0.9}
          onPress={() => openViewer(index, item)}
          onLongPress={() => onLongPress && onLongPress(item, index)}
        />

		{showSize && item.size != null && (
		  <View style={styles.sizeBadge}>
			<Text style={styles.sizeText}>{sizeLabel}</Text>
		  </View>
		)}
        
          { selectMode ?
          <TouchableOpacity
            style={styles.checkbox}
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
  [size, imageStyle, openViewer, onLongPress, selected, toggleSelect],
);

  if (!images || images.length === 0) {
    return placeholderComponent ? (
      placeholderComponent
    ) : (
      <View style={[styles.emptyContainer, containerStyle]}>
        <Text style={styles.emptyText}>No images</Text>
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
    <TouchableWithoutFeedback onPress={() => {}}>
      <View>
        <FlatList
          data={visibleImages}
          key={`grid-${numColumns}`}
          keyExtractor={(item) => String(item.id ?? item.uri)}
          renderItem={renderItem}
          numColumns={numColumns}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={true}
          initialNumToRender={12}
          windowSize={9}
          contentContainerStyle={{
            paddingHorizontal: 0,
            paddingVertical: 0,
            paddingBottom: enableDelete && selected.length > 0 ? 70 : 0,
          }}
        />
      </View>
    </TouchableWithoutFeedback>

  {/* 👇 Sticky action bar */}
  {enableDelete && selected.length > 0 && (
	<View style={styles.actionBar}>
	  <TouchableOpacity
		style={styles.deleteButton}
onPress={() => {
  const toDelete = selected;

  // ✅ Remove immediately from UI
  setVisibleImages(prev =>
    prev.filter(img => !toDelete.includes(img.id))
  );

  // ✅ Clear selection
  if (!selectedIds.length) {
    setInternalSelected([]);
  }

  // ✅ Notify parent (async delete)
  deleteImages && deleteImages(toDelete);
}}

	  >
		<Text style={styles.deleteText}>Delete ({selected.length})</Text>
	  </TouchableOpacity>
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
  justifyContent: 'center',
  borderTopWidth: 0.5,
  borderColor: '#333',
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

