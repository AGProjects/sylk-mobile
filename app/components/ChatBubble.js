import React, { memo } from 'react';
import { View, TouchableOpacity, Text, Image } from 'react-native';
import { Bubble } from 'react-native-gifted-chat';

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
	consumedMessages = {},
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
    // catch-all for any other GiftedChat bubble props
    ...restProps
  }) => {
    // Guard
    if (!currentMessage) return null;

    const isFocused = focusedMessageId === currentMessage._id;
    const focusedBorder = isFocused ? { borderWidth: 3, borderColor: 'orange' } : {};

    // === Styling / colors ===
    const bubbleRadius = 16;
    let leftColor = 'green';
    let rightColor = '#fff';

    if (currentMessage.failed) {
      rightColor = 'red';
      leftColor = 'red';
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
              {originalMessage.text}
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
          wrapperStyle={{
            left: { ...leftWrapper, backgroundColor: 'transparent', borderColor: 'white', borderWidth: 0.5 },
            right: { ...rightWrapper, backgroundColor: 'transparent', borderColor: 'white', borderWidth: 0.5 },
          }}
          textProps={{ style: { color: position === 'left' ? '#fff' : '#fff' } }}
          textStyle={{ left: { color: '#000' }, right: { color: '#000' } }}
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

  /**
   * memo comparator:
   * return true  -> SKIP re-render
   * return false -> re-render
   */
(prev, next) => {
  const p = prev.currentMessage;
  const n = next.currentMessage;

  if (!p || !n) {
    console.log(`[Bubble ${p?._id || '??'}] RERENDER → missing message`);
    return false;
  }

  const id = p._id;

	// ==== Reply messages ====
	const currentId = p._id;

	const prevLabel = prev.mediaLabels?.[currentId];
	const nextLabel = next.mediaLabels?.[currentId];
	
	if (prevLabel !== nextLabel) {
	  console.log(`[Bubble ${currentId}] RERENDER → mediaLabels changed ${prevLabel} -> ${nextLabel}`);
	  return false;
	}
	
	// ==== Media rotation ====
	const prevRotation = prev.mediaRotations?.[currentId];
	const nextRotation = next.mediaRotations?.[currentId];
	
	if (prevRotation !== nextRotation) {
	  console.log(`[Bubble ${currentId}] RERENDER → mediaRotation changed ${prevRotation} -> ${nextRotation}`);
	  return false; // re-render
	}

	const prevReply = prev.replyMessages?.[currentId] ?? false; // undefined → false
	const nextReply = next.replyMessages?.[currentId] ?? false;
	
	if (prevReply !== nextReply) {
	  console.log(`[Bubble ${currentId}] RERENDER → replyMessages changed from ${prevReply} to ${nextReply}`);
	  return false; // trigger re-render
	}

  if (prev.fullSize != next.fullSize) {
    console.log(`[Bubble ${id}] RERENDER → fullSize changed`);
    return false;
  }

  // ==== Transfer progress ====
  const prevProgress = prev.transferProgress?.[id]?.progress;
  const nextProgress = next.transferProgress?.[id]?.progress;
  if (prevProgress !== nextProgress) {
    //console.log(`[Bubble ${id}] RERENDER → progress changed (${prevProgress} → ${nextProgress})`);
    return false;
  }
	
	/*
  // ==== Image loading state ====
  const prevImgState = prev.imageLoadingState?.[id];
  const nextImgState = next.imageLoadingState?.[id];
  if (prevImgState !== nextImgState) {
    console.log(`[Bubble ${id}] RERENDER → image state changed ${prevImgState} -> ${nextImgState}`);
    return false;
  }
*/

// ==== Consumed ====
const prevConsumed = prev.consumedMessages?.[currentId];
const nextConsumed = next.consumedMessages?.[currentId];

// Skip re-render if prev is 100 and next is null/undefined
if (!(prevConsumed === 100 && (nextConsumed === undefined || nextConsumed === null))) {
  if (prevConsumed !== nextConsumed) {
    console.log(
      `[Bubble ${currentId}] RERENDER → consumedMessages changed ${prevConsumed} -> ${nextConsumed}`
    );
    return false; // re-render
  }
}

// ==== Thumbnail / video meta ====
const prevThumb = prev.videoMetaCache?.[id]?.thumbnail;
const nextThumb = next.videoMetaCache?.[id]?.thumbnail;

// Treat undefined and null as the same
if ((prevThumb ?? null) !== (nextThumb ?? null)) {
  console.log(`[Bubble ${id}] RERENDER → video thumbnail changed ${prevThumb} -> ${nextThumb}`);
  return false;
}

  // ==== Content changed ====
	const contentFields = ['text', 'image', 'video', 'audio'];
	for (let f of contentFields) {
	  const oldVal = p[f] ?? null;  // convert undefined to null
	  const newVal = n[f] ?? null;  // convert undefined to null
	  if (oldVal !== newVal) {
		console.log(`[Bubble ${id}] RERENDER → content field '${f}' changed`, p[f], n[f]);
		return false;
	  }
	}

	// ==== Status flags ====
	const flags = ['pending', 'sent', 'received', 'displayed', 'failed', 'pinned', 'playing', 'consumed', 'rotation', 'label'];
	
	for (let f of flags) {
		// Treat undefined as null
		const oldValue = p[f] !== undefined ? p[f] : null;
		const newValue = n[f] !== undefined ? n[f] : null;
	
		// Only trigger if they actually differ
		if (oldValue !== newValue) {
			console.log(`[Bubble ${id}] RERENDER → status '${f}' changed: ${oldValue} -> ${newValue}`);
			return false;
		}
	}
  
  // NOTHING changed → skip render
  // console.log(`[Bubble ${id}] SKIP`);  // enable to see skips too
  return true;
}

);

export default ChatBubble;
