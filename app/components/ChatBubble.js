import React, { memo } from 'react';
import { View, TouchableOpacity, Text, Image } from 'react-native';
import { Bubble } from 'react-native-gifted-chat';

// Memoized ChatBubble — replaces renderBubble()
const ChatBubble = memo(
  ({
    props,
    messages = [],
    bubbleWidths = {},
    mediaLabels = {},
    videoMetaCache = {},
    visibleMessageIds = [], 
    transferProgress = {},
    imageLoadingState = {},
    audioPlayingState = {},
    handleBubbleLayout,
    fullSize,
    scrollToMessage,
    styles,
    renderMessageImage,
    renderMessageVideo,
    renderMessageAudio,
    focusedMessageId,
    renderMessageText,
    sortOrder
  }) => {
    const { currentMessage } = props;
    if (!currentMessage) return null;

	const isFocused = focusedMessageId === currentMessage._id;
	const focusedBorder = isFocused
	  ? { borderWidth: 3, borderColor: 'orange' }
	  : {};
  
    // === Bubble styling setup ===
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

    // === Find original message if this is a reply ===
    let originalMessage = null;
    if (sortOrder != 'size' && currentMessage.replyId && Array.isArray(messages)) {
      originalMessage = messages.find(m => m._id === currentMessage.replyId);
    }

    const MIN_BUBBLE_WIDTH = 120;
    const MAX_BUBBLE_WIDTH = '80%';
    const measuredWidth = bubbleWidths[currentMessage._id] || 0;
    const bubbleWidth = Math.max(measuredWidth, MIN_BUBBLE_WIDTH);

    const previewWrapperStyle = {
      borderTopLeftRadius: bubbleRadius,
      borderTopRightRadius: bubbleRadius,
    };

    const replyPreviewContainer =
      currentMessage.direction === 'incoming'
        ? styles.replyPreviewContainerIncoming
        : styles.replyPreviewContainerOutgoing;

    const hasPreview = !!originalMessage;

    // === Reply Preview ===
    const replyPreview = originalMessage ? (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => {
          if (scrollToMessage && originalMessage._id) {
            scrollToMessage(originalMessage._id);
          }
        }}
      >
        <View
          style={[
            replyPreviewContainer,
            {
              alignSelf:
                currentMessage.direction === 'incoming' ? 'flex-start' : 'flex-end',
              minWidth: MIN_BUBBLE_WIDTH,
              maxWidth: MAX_BUBBLE_WIDTH,
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
            <Image
              source={{ uri: originalMessage.image }}
              style={{ width: '85%', height: 100 }}
              resizeMode="cover"
            />
          ) : (
            <Text
              style={styles.replyPreviewText}
              numberOfLines={3}
              ellipsizeMode="tail"
            >
              {originalMessage.text}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    ) : null;

    // === Skip ASC files ===
    if (
      currentMessage.direction === 'incoming' &&
      currentMessage.metadata &&
      currentMessage.metadata.filename &&
      currentMessage.metadata.filename.endsWith('.asc')
    ) {
      //return null;
    }

    // === Wrapper colors ===
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

    // === Shared customView ===
    const customView = (
      <View
        onLayout={e => handleBubbleLayout(currentMessage._id, e)}
        style={{ position: 'absolute', width: '100%', height: '100%' }}
      />
    );

    // === Render the main bubble ===
    let content = null;

    if (currentMessage.image) {
      content = (
        <Bubble
          {...props}
		renderMessageImage={renderMessageImage}
		renderMessageVideo={renderMessageVideo}
		renderMessageAudio={renderMessageAudio}
		renderMessageText={renderMessageText}
          wrapperStyle={{
            left: { ...leftWrapper, alignSelf: 'stretch', marginRight: 0 },
            right: { ...rightWrapper, alignSelf: 'stretch', marginLeft: 0 },
          }}
          textProps={{ style: { color: props.position === 'left' ? '#000' : '#000' } }}
          textStyle={{ left: { color: '#fff' }, right: { color: '#000' } }}
          renderCustomView={() => customView}
        />
      );
    } else if (currentMessage.video) {
      content = (
        <Bubble
          {...props}
		renderMessageImage={renderMessageImage}
		renderMessageVideo={renderMessageVideo}
		renderMessageAudio={renderMessageAudio}
		renderMessageText={renderMessageText}
          wrapperStyle={{
            left: { ...leftWrapper, alignSelf: 'stretch', marginRight: 0 },
            right: { ...rightWrapper, alignSelf: 'stretch', marginLeft: 0 },
          }}
          textProps={{ style: { color: props.position === 'left' ? '#fff' : '#fff' } }}
          textStyle={{ left: { color: '#000' }, right: { color: '#000' } }}
          renderCustomView={() => customView}
        />
      );
    } else if (currentMessage.audio) {
      content = (
        <Bubble
          {...props}
		renderMessageImage={renderMessageImage}
		renderMessageVideo={renderMessageVideo}
		renderMessageAudio={renderMessageAudio}
		renderMessageText={renderMessageText}
          wrapperStyle={{
            left: { ...leftWrapper, backgroundColor: 'transparent', borderColor: 'white', borderWidth: 0.5 },
            right: { ...rightWrapper, backgroundColor: 'transparent', borderColor: 'white', borderWidth: 0.5 },
          }}
          textProps={{ style: { color: props.position === 'left' ? '#fff' : '#fff' } }}
          textStyle={{ left: { color: '#000' }, right: { color: '#000' } }}
          renderCustomView={() => customView}
        />
      );
    } else {
      content = (
        <Bubble
          {...props}
		renderMessageImage={renderMessageImage}
		renderMessageVideo={renderMessageVideo}
		renderMessageAudio={renderMessageAudio}
		renderMessageText={renderMessageText}
          wrapperStyle={{
            left: { ...leftWrapper },
            right: { ...rightWrapper },
          }}
          textProps={{ style: { color: props.position === 'left' ? '#fff' : '#000' } }}
          textStyle={{ left: { color: '#fff' }, right: { color: '#000' } }}
          renderCustomView={() => customView}
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

	  // === Memoization: only re-render if currentMessage changes ===
	(prev, next) => {
	  const prevMsg = prev.props.currentMessage;
	  const nextMsg = next.props.currentMessage;
	  
	const prevLocalUrl = prevMsg.metadata?.local_url;
	const nextLocalUrl = nextMsg.metadata?.local_url;
	
	const localUrlChanged =
	  prevLocalUrl !== nextLocalUrl &&
	  !(prevLocalUrl === undefined && nextLocalUrl === undefined);
	
	if (localUrlChanged) {
	  console.log("local_url changed", nextMsg._id, {
		from: prevLocalUrl,
		to: nextLocalUrl
	  });
	  return false;
	}

	// Image loading state changed?
	const prevImageLoading = prev.imageLoadingState?.[prevMsg._id];
	const nextImageLoading = next.imageLoadingState?.[nextMsg._id];
	
	if (prevImageLoading !== nextImageLoading) {
	  console.log("imageLoadingState changed", nextMsg._id, {
		from: prevImageLoading,
		to: nextImageLoading,
	  });
	  return false; // re-render bubble
	}

	const prevThumb = prev.videoMetaCache?.[prevMsg._id]?.thumbnail;
	const nextThumb = next.videoMetaCache?.[nextMsg._id]?.thumbnail;
	
	if (prevThumb !== nextThumb) {
	  console.log("Thumbnail updated", nextMsg._id, {
		from: prevThumb,
		to: nextThumb,
	  });
	  return false;
	}

	  if (!prevMsg || !nextMsg) return false;
	
	  const sameId = prevMsg._id === nextMsg._id;
	
	  // Visibility and play state changes
	  const wasVisible = (prev.visibleMessageIds || []).includes(prevMsg._id);
	  const isVisible = (next.visibleMessageIds || []).includes(nextMsg._id);
	
	  if (!sameId || wasVisible !== isVisible) {
		return false;
	  }
		// Audio play state changes
		const prevAudio = prev.audioPlayingState?.[prevMsg._id];
		const nextAudio = next.audioPlayingState?.[nextMsg._id];
		
		if (prevAudio !== nextAudio) {
		  console.log("Audio playing changed", nextMsg._id);
		  return false;
		}
	
		// Delivery / state flags
		const fields = [
		  "pending",
		  "sent",
		  "received",
		  "displayed",
		  "failed",
		  "pinned",
		];
		
		const changed = fields.filter(f => prevMsg[f] !== nextMsg[f]);
		
		if (changed.length > 0) {
		  console.log(
			"statusChanged", 
			nextMsg._id, 
			"changed fields:", 
			changed.reduce((acc, f) => {
			  acc[f] = { from: prevMsg[f], to: nextMsg[f] };
			  return acc;
			}, {})
		  );
		  return false;
		}
	
		// Content changes
		const contentFields = ["text", "image", "video", "audio"];
		
		const contentDiff = contentFields.filter(f => prevMsg[f] !== nextMsg[f]);
		
		if (contentDiff.length > 0) {
		  console.log(
			"contentChanged",
			nextMsg._id,
			"changed fields:",
			contentDiff.reduce((acc, f) => {
			  acc[f] = { from: prevMsg[f], to: nextMsg[f] };
			  return acc;
			}, {})
		  );
		  return false;
		}
	
	// Progress changes
	const prevTransfer = prev.transferProgress?.[prevMsg._id]?.progress;
	const nextTransfer = next.transferProgress?.[nextMsg._id]?.progress;
	
	const hadPrev = prevTransfer !== undefined;
	const hasNext = nextTransfer !== undefined;
	
	let transferChanged = false;
	let changeInfo = {};
	
	if (hadPrev && !hasNext) {
	  // Disappeared
	  transferChanged = true;
	  changeInfo = { type: "disappeared", from: prevTransfer, to: undefined };
	} else if (!hadPrev && hasNext) {
	  // Appeared
	  transferChanged = true;
	  changeInfo = { type: "appeared", from: undefined, to: nextTransfer };
	} else if (prevTransfer !== nextTransfer) {
	  // Changed
	  transferChanged = true;
	  changeInfo = { type: "changed", from: prevTransfer, to: nextTransfer };
	}
	
	if (transferChanged) {
	  //console.log("transferChanged", nextMsg._id, changeInfo);
	  return false;
	}
	
	  // Full-size selection (affects photo checkbox)
		if (prev.fullSize !== next.fullSize) {
		  return false;
		}
	
	  return true; // Skip only if nothing at all changed
	}
);

export default ChatBubble;
