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
    audioPlayingState = {},
    handleBubbleLayout,
    fullSize,
    scrollToMessage,
    styles,
    renderMessageImage,
    renderMessageVideo,
    renderMessageAudio,
    focusedMessageId,
    renderMessageText
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
    if (currentMessage.replyId && Array.isArray(messages)) {
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
	  const statusChanged =
		prevMsg.pending !== nextMsg.pending ||
		prevMsg.sent !== nextMsg.sent ||
		prevMsg.received !== nextMsg.received ||
		prevMsg.displayed !== nextMsg.displayed ||
		prevMsg.failed !== nextMsg.failed ||
		prevMsg.pinned !== nextMsg.pinned;
	
	  if (statusChanged) {
		  console.log("statusChanged", nextMsg._id);
		  return false;
	  }
	
	  // Content changes
	  const contentChanged =
		prevMsg.text !== nextMsg.text ||
		prevMsg.image !== nextMsg.image ||
		prevMsg.video !== nextMsg.video ||
		prevMsg.audio !== nextMsg.audio;
	
	  if (contentChanged) {
		  //console.log("contentChanged", nextMsg._id);
		  return false;
	  }
	
	  // Progress changes
	  const prevTransfer = prev.transferProgress?.[prevMsg._id]?.progress;
	  const nextTransfer = next.transferProgress?.[nextMsg._id]?.progress;
	
	  const transferChanged =
	     prevTransfer !== nextTransfer &&
	     !(prevTransfer === undefined && nextTransfer === undefined);
	
   	  if (transferChanged) {
	    //console.log("Transfer changed", nextMsg._id, "→", nextTransfer);
	    return false;
	  }

	  if ((prevTransfer || nextTransfer) && prevTransfer !== nextTransfer) {
		console.log("Transfer changed", nextMsg._id, nextTransfer);
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
