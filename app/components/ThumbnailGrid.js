import React, {useState, useCallback, useMemo} from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
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

const {width: SCREEN_WIDTH, height: SCREEN_HEIGHT} = Dimensions.get('window');
const windowDims = Dimensions.get('window');

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
}) {

	const SCREEN_WIDTH = isLandscape ? windowDims.height : windowDims.width;
	const SCREEN_HEIGHT = isLandscape ? windowDims.width : windowDims.height;

  const [viewerVisible, setViewerVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(initialIndex || 0);

  const size = useMemo(() => {
    if (thumbnailSize) return thumbnailSize;
    const pad = 16; // horizontal padding
    const spacing = 8; // gap between items
    const totalSpacing = spacing * (numColumns - 1) + pad * 2;
    return Math.floor((SCREEN_WIDTH - totalSpacing) / numColumns);
  }, [thumbnailSize, numColumns, SCREEN_WIDTH]);

  const openViewer = useCallback((index, item) => {
    console.log('open viewer', item);
    setCurrentIndex(index);
    setViewerVisible(true);
  }, []);

  const closeViewer = useCallback(() => {
    setViewerVisible(false);
  }, []);

const renderItem = useCallback(
  ({item, index}) => (
    <View style={[styles.thumb, {width: size, height: size}]}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => openViewer(index, item)}
        onLongPress={() => onLongPress && onLongPress(item, index)}
        style={{flex: 1}}>
        
        <FastImage
          source={{uri: item.uri}}
          style={[styles.image, {width: size, height: size}, imageStyle]}
          resizeMode={FastImage.resizeMode.cover}
        />

      </TouchableOpacity>
    </View>
  ),
  [size, imageStyle, openViewer, onLongPress],
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
  const viewerImages = images.map((it) => ({url: it.uri, props: {}}));

  return (
    <View style={[styles.container, containerStyle]}>
      <FlatList
        data={images}
        keyExtractor={(item) => String(item.id ?? item.uri)}
        renderItem={renderItem}
        numColumns={numColumns}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        initialNumToRender={12}
        windowSize={9}
        contentContainerStyle={{paddingHorizontal: 16, paddingVertical: 8}}
      />

      {/* Viewer Modal: tries to use react-native-image-zoom-viewer if available. Otherwise falls back to a simple pager. */}
      <Modal visible={viewerVisible} animationType="fade" onRequestClose={closeViewer} transparent={false}>
        {/* Fallback viewer: horizontal paging with simple zoom support on iOS via ScrollView's zoomScale props. */}
        <SafeAreaView style={styles.viewerSafeArea}>
          <View style={styles.viewerHeader}>
            <TouchableOpacity onPress={closeViewer} style={styles.closeButton}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={images}
            horizontal
            pagingEnabled
            initialScrollIndex={currentIndex}
            getItemLayout={(_, index) => ({length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index})}
            keyExtractor={(item) => String(item.id ?? item.uri)}
            renderItem={({item}) => (
              <View style={{
				  width: SCREEN_WIDTH,
				  height: SCREEN_HEIGHT,
				  justifyContent: 'center',
				  alignItems: 'center',
				  backgroundColor: 'black',
				}}
				>
    
                {/* On iOS ScrollView supports zoomScale. On Android this won't pinch-zoom without extra libraries. */}
                <ScrollView
                  contentContainerStyle={styles.viewerScrollContent}
                  maximumZoomScale={3}
                  minimumZoomScale={1}
                  showsVerticalScrollIndicator={false}
                  showsHorizontalScrollIndicator={false}
                  bounces={false}
                >
                  <Image source={{uri: item.uri}} style={isLandscape ? styles.fullImageLandscape : styles.fullImage} resizeMode="contain" />
                </ScrollView>
              </View>
            )}
            showsHorizontalScrollIndicator={false}
            windowSize={3}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  thumb: {
    margin: 4,
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

