import React, { memo } from 'react';
import { View, TouchableOpacity, Text, Image } from 'react-native';
import { Bubble } from 'react-native-gifted-chat';
import utils from '../utils';

const ChatBubble = memo(
  ({
    // GiftedChat bubble fields (flattened)
    currentMessage,
    previousMessage,
    nextMessage,
    position,

    // App-level inputs
    messages = [],
    bubbleWidths = {},
    mediaLabels = {},
	replyMessages = {},
    videoMetaCache = {},
    visibleMessageIds = [],
    transferProgress = {},
    imageLoadingState = {},
    handleBubbleLayout,
    fullSize,
    scrollToMessage,
    styles = {},
    renderMessageImage,
    renderMessageVideo,
    renderMessageAudio,
    renderMessageText,
    focusedMessageId,
    sortOrder,
	imageGroups,
	groupOfImage,
	thumbnailGridSize,
    // catch-all for any other GiftedChat bubble props
    ...restProps
  }) => {
    // Guard
    if (!currentMessage) return null;

    const isFocused = focusedMessageId === currentMessage._id;
    const focusedBorder = isFocused ? { borderWidth: 2, borderColor: 'orange'} : {};
        
	if (currentMessage._id in groupOfImage && !(currentMessage._id in imageGroups)) {
		 return (null);
	}

    // === Styling / colors ===
    const bubbleRadius = 16;
    let leftColor = 'green';
    let rightColor = '#fff';

    if (currentMessage.failed) {
      rightColor = 'red';
      //leftColor = 'red';
    } else if (currentMessage.pinned) {
      rightColor = '#2ecc71';
      leftColor = '#2ecc71';
    }

    // === Reply preview lookup ===
    let originalMessage = null;
	if (sortOrder !== 'size' && replyMessages && Array.isArray(messages)) {
	  const replyTarget = replyMessages[currentMessage._id];
	  if (replyTarget) {
		originalMessage = messages.find(m => m._id === replyTarget);
	  }
	}

//    const MIN_BUBBLE_WIDTH = currentMessage.contentType === "application/sylk-file-transfer" ? 220: 120;
    const MIN_BUBBLE_WIDTH = 220;
    
    const measuredWidth = bubbleWidths[currentMessage._id] || 0;
    const bubbleWidth = Math.max(measuredWidth, MIN_BUBBLE_WIDTH);
    
    const previewWrapperStyle = { borderTopLeftRadius: bubbleRadius, borderTopRightRadius: bubbleRadius };
    const replyPreviewContainer =
      currentMessage.direction === 'incoming'
        ? styles.replyPreviewContainerIncoming
        : styles.replyPreviewContainerOutgoing;
    const hasPreview = !!originalMessage;
    
    let originalText = originalMessage?.text;
    
    if (originalMessage && originalMessage.contentType == 'text/html') {
		originalText = utils.html2text(originalMessage.text);
    }

    const replyPreview = originalMessage ? (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => {
          if (scrollToMessage && originalMessage._id) scrollToMessage(originalMessage._id);
        }}
      >
        <View
          style={[
            replyPreviewContainer,
            {
              alignSelf: currentMessage.direction === 'incoming' ? 'flex-start' : 'flex-end',
              minWidth: MIN_BUBBLE_WIDTH,
              maxWidth: '80%',
              width: bubbleWidth,
              ...previewWrapperStyle,
            },
          ]}
        >
          <View style={styles.replyLine} />
          {originalMessage.video && videoMetaCache?.[originalMessage._id] ? (
            <Image
              source={{ uri: videoMetaCache[originalMessage._id].thumbnail }}
              style={{ width: '85%', height: 100 }}
              resizeMode="cover"
            />
          ) : originalMessage.image ? (
            <Image source={{ uri: originalMessage.image }} style={{ width: '85%', height: 100 }} resizeMode="cover" />
          ) : (
            <Text style={styles.replyPreviewText} numberOfLines={3} ellipsizeMode="tail">
              {originalText}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    ) : null;

    // === Wrapper styles ===
    const leftWrapper = {
      backgroundColor: leftColor,
      borderTopLeftRadius: hasPreview ? 0 : bubbleRadius,
      borderTopRightRadius: hasPreview ? 0 : bubbleRadius,
      ...focusedBorder,
    };
    const rightWrapper = {
      backgroundColor: rightColor,
      borderTopLeftRadius: hasPreview ? 0 : bubbleRadius,
      borderTopRightRadius: hasPreview ? 0 : bubbleRadius,
      ...focusedBorder,
    };

    // custom view used for layout (won't block interactions)
    const customView = () => (
      <View
        pointerEvents="none"
        onLayout={e => handleBubbleLayout && handleBubbleLayout(currentMessage._id, e)}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
    );

	const gcProps = {
	  currentMessage,
	  previousMessage,
	  nextMessage,
	  position,
	  imageLoadingState,
	  transferProgress,
	  scrollToMessage,
	};

      // Common bubble props to pass
    const bubbleProps = {
      ...restProps,
      currentMessage,
      previousMessage,
      nextMessage,
      position,
      renderMessageImage,
      renderMessageVideo,
      renderMessageAudio,
      renderMessageText,
      renderCustomView: customView,
    };

    // Choose bubble variant (image / video / audio / text)
    let content = null;

    if (currentMessage.image) {
      content = (
        <Bubble 
          {...bubbleProps}
          wrapperStyle={{ left: { ...leftWrapper, alignSelf: 'stretch', marginRight: 0 }, right: { ...rightWrapper, alignSelf: 'stretch', marginLeft: 0 } }}
          textProps={{ style: { color: position === 'left' ? '#000' : '#000' } }}
          textStyle={{ left: { color: '#fff' }, right: { color: '#000' } }}
        />
      );
    } else if (currentMessage.video) {
      content = (
        <Bubble
          {...bubbleProps}
          wrapperStyle={{ left: { ...leftWrapper, alignSelf: 'stretch', marginRight: 0 }, right: { ...rightWrapper, alignSelf: 'stretch', marginLeft: 0 } }}
          textProps={{ style: { color: position === 'left' ? '#fff' : '#fff' } }}
          textStyle={{ left: { color: '#000' }, right: { color: '#000' } }}
        />
      );
    } else if (currentMessage.audio) {
      content = (
        <Bubble
          {...bubbleProps}
          // Suppress single-tap on the audio bubble: GiftedChat's Bubble
          // wrapper fires onPress regardless of whether inner controls
          // claimed the touch, so any tap inside (slider, play button,
          // padding) would otherwise pop the contextual menu. Long-press
          // is left intact — that's the reliable way to open the menu
          // from an audio bubble.
          onPress={() => {}}
          textProps={{ style: { color: position === 'left' ? '#fff' : '#fff' } }}
          textStyle={{ left: { color: '#000' }, right: { color: '#000' } }}
          wrapperStyle={{
            left: {
              ...leftWrapper,
              backgroundColor: 'transparent',
              borderColor: 'white',
              borderWidth: 0.5,
              alignSelf: 'stretch',
              marginRight: 24,
            },
            right: {
              ...rightWrapper,
              backgroundColor: 'transparent',
              borderColor: 'white',
              borderWidth: 0.5,
              alignSelf: 'stretch',
              marginLeft: 24,
            },
          }}
        />
      );
    } else if (originalMessage) {
      content = (
        <Bubble
          {...bubbleProps}
			wrapperStyle={{
			  left: {
				...leftWrapper,
				minWidth: bubbleWidth,
				maxWidth: bubbleWidth,
				alignSelf: 'flex-start', // match reply preview alignment
			  },
			  right: {
				...rightWrapper,
				minWidth: bubbleWidth,
				maxWidth: bubbleWidth,
				alignSelf: 'flex-end', // match reply preview alignment
			  },
			  }}
      
          textProps={{ style: { color: position === 'left' ? '#fff' : '#000' } }}
          textStyle={{ left: { color: '#fff' }, right: { color: '#000' } }}
        />
      );
    } else {
      content = (
        <Bubble
          {...bubbleProps}
                    wrapperStyle={{
            left: { ...leftWrapper },
            right: { ...rightWrapper },
          }}

	  containerStyle={{
		left: isFocused
		  ? { borderWidth: 0, borderColor: 'orange', borderRadius: 0 }
		  : {},
		right: isFocused
		  ? { borderWidth: 0, borderColor: 'orange', borderRadius: 0}
		  : {},
	  }}
          textProps={{ style: { color: position === 'left' ? '#fff' : '#000' } }}
          textStyle={{ left: { color: '#fff' }, right: { color: '#000' } }}
        />
      );
    }

    return (
      <View style={{ flex: 1, alignSelf: 'stretch' }}>
        {replyPreview}
        {content}
      </View>
    );
  },

  /*
   * memo comparator:
   * return true  -> SKIP re-render
   * return false -> re-render
   */

	(prev, next) => {
	  const p = prev.currentMessage;
	  const n = next.currentMessage;

	  if (!p || !n) {
		//console.log(`[Bubble ${p?._id || '??'}] RERENDER → missing message`);
		return false;
	  }

	  const id = p._id;

	  // Location-bubble-only trace. Fires on every memo-compare call for
	  // live-location rows so we can see which branch below ends the
	  // comparator. `return true` = SKIP re-render (bubble stays stale);
	  // `return false` = re-render. Kept as a no-op helper so the call
	  // sites below don't have to be touched — the diagnostic body was
	  // removed once the location-memo behaviour was settled; reinstate
	  // the console.log inside if you need to trace a memo regression.
	  const locTrace = () => {};

		// ==== Reply messages ====
		const currentId = p._id;
		
		const prevLabel = prev.mediaLabels?.[currentId];
		const nextLabel = next.mediaLabels?.[currentId];
		
		if (prevLabel !== nextLabel) {
		  if ( nextLabel === undefined) {
			  locTrace(true, 'mediaLabels: next undefined');
			  return true;
		  }

		  //console.log(`[Bubble ${currentId}] RERENDER → mediaLabels changed ${prevLabel} -> ${nextLabel}`);
		  locTrace(false, 'mediaLabels changed');
		  return false;
		}

		// ==== Media rotation ====
		const prevRotation = prev.mediaRotations?.[currentId];
		const nextRotation = next.mediaRotations?.[currentId];

		if (prevRotation !== nextRotation) {
		  console.log(`[Bubble ${currentId}] RERENDER → mediaRotation changed ${prevRotation} -> ${nextRotation}`);
		  locTrace(false, 'mediaRotation changed');
		  return false; // re-render
		}

		const prevReply = prev.replyMessages?.[currentId] ?? false;
		const nextReply = next.replyMessages?.[currentId] ?? false;

		if (prevReply !== nextReply) {
		  //console.log(`[Bubble ${currentId}] RERENDER → replyMessages changed from ${prevReply} to ${nextReply}`);
		  locTrace(false, 'replyMessages changed');
		  return false; // trigger re-render
		}

	  if (prev.fullSize != next.fullSize) {
		//console.log(`[Bubble ${id}] RERENDER → fullSize changed`);
		locTrace(false, 'fullSize changed');
		return false;
	  }

	  // ==== Transfer progress ====
	  const prevProgress = prev.transferProgress?.[id]?.progress ?? 0;
	  const nextProgress = next.transferProgress?.[id]?.progress ?? 0;
	  if (prevProgress !== nextProgress) {
	    if (prevProgress && nextProgress !== 0 && prevProgress > nextProgress) {
			console.log(`[Bubble ${id}] RERENDER → progress skip negative changed (${prevProgress} → ${nextProgress})`);
			locTrace(true, 'progress regressed');
			return true;
	    }
		//console.log(`[Bubble ${id}] RERENDER → progress changed (${prevProgress} → ${nextProgress})`);
		locTrace(false, 'progress changed');
		return false;
	  }

	  // ==== Image loading state ====
	  const prevImgState = prev.imageLoadingState?.[id] ?? null;
	  const nextImgState = next.imageLoadingState?.[id] ?? null;
	  if (prevImgState !== nextImgState) {
		//console.log(`[Bubble ${id}] RERENDER → image state changed ${prevImgState} -> ${nextImgState}`);
		locTrace(true, 'imgState changed (skip)');
		return true;
	  }

    if (prev.thumbnailGridSize !== next.thumbnailGridSize) {
	  //console.log(`[Bubble ${id}] RERENDER → thumbnailGridSize changed`);
	  locTrace(false, 'thumbnailGridSize changed');
	  return false;
    }

	// ==== Thumbnail / video meta ====
	const prevThumb = prev.videoMetaCache?.[id]?.thumbnail;
	const nextThumb = next.videoMetaCache?.[id]?.thumbnail;

	// Treat undefined and null as the same
	if ((prevThumb ?? null) !== (nextThumb ?? null)) {
	  //console.log(`[Bubble ${id}] RERENDER → video thumbnail changed ${prevThumb} -> ${nextThumb}`);
	  locTrace(false, 'video thumb changed');
	  return false;
	}

	if (
	  prev.focusedMessageId === id ||
	  next.focusedMessageId === id
	) {
	  locTrace(false, 'focused');
	  return false; // only re-render affected bubble
	}

	  // ==== Content changed ====
		const contentFields = ['text', 'image', 'video', 'audio'];
		for (let f of contentFields) {
		  const oldVal = p[f] ?? null;  // convert undefined to null
		  const newVal = n[f] ?? null;  // convert undefined to null
		  if (oldVal !== newVal) {
		    if (oldVal && !newVal) {
		        // don't empty existing content
				locTrace(true, `content '${f}' emptied (skip)`);
				return true;
		    }
			//console.log(`[Bubble ${id}] RERENDER → content field '${f}' changed`, p[f], '->', n[f]);
			locTrace(false, `content '${f}' changed ${oldVal} -> ${newVal}`);
			return false;
		  }
		}

		// ==== Status flags ====
		const flags = ['pending', 'sent', 'received', 'displayed', 'failed', 'pinned', 'playing', 'position', 'consumed', 'rotation', 'label'];
		let defaultFalse = ['pending', 'sent', 'received', 'displayed', 'failed', 'pinned', 'playing'];

		for (let f of flags) {

		    const defValue = defaultFalse.indexOf(f) > -1 ? false: null;
			const oldValue = p[f] !== undefined ? p[f] : defValue;
			const newValue = n[f] !== undefined ? n[f] : defValue;

			// Only trigger if they actually differ

			if ( f == 'consumed' && oldValue && newValue && newValue < oldValue) {
				locTrace(true, 'consumed regressed (skip)');
				return true;
			}

			if ( f == 'rotation' || f == 'position') {
				if (oldValue == null && newValue == 0) {
					locTrace(true, `${f} null->0 (skip)`);
					return true;
				}

				if (newValue == null) {
					locTrace(true, `${f} new null (skip)`);
					return true;
				}
			}

			if (oldValue != null && newValue == null) {
				// ignore transient disappearance
				locTrace(true, `${f} transient disappearance (skip)`);
				return true;
			}

			//console.log(`[Bubble ${id}] RERENDER → status '${f}' : ${oldValue} -> ${newValue}`);

			if (oldValue !== newValue) {
				//console.log(`[Bubble ${id}] RERENDER → status '${f}' changed: ${oldValue} -> ${newValue}`);
				locTrace(false, `status '${f}' changed`);
				return false;
			}
		}

	  // nothing relevant has changed
	  locTrace(true, 'nothing changed');
	  return true;
	}

);

export default ChatBubble;
