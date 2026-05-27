import React, { memo } from 'react';
import { View, TouchableOpacity, Text, Image } from 'react-native';
import { Bubble } from 'react-native-gifted-chat';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import utils from '../utils';
import DarkModeManager from '../DarkModeManager';

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
    // ID of the message the user is currently composing a reply to
    // (set when the floating ReactionBar is open, OR when the user
    // long-pressed → Reply and the composer is in reply mode). We
    // reuse the existing focusedBorder visual — an orange outline —
    // so the user always sees which bubble their next emoji/text
    // will attach to.
    replyTargetId,
    // True when the parent is in reply-targeting mode AND this
    // bubble is NOT the target. Dims the bubble (opacity 0.35)
    // so the highlighted target visually pops without us needing
    // to measure positions or render an overlay. Falsy on the
    // target itself and when no reply-target is active.
    isDimmedByReplyTarget,
    sortOrder,
	imageGroups,
	groupOfImage,
	thumbnailGridSize,
    // catch-all for any other GiftedChat bubble props
    ...restProps
  }) => {
    // Guard
    if (!currentMessage) return null;

    // Orange outline is now only for the search/jump focus (the
    // existing "scroll to this message" feature). The reaction-bar
    // reply-target uses the dim highlight instead — every other
    // bubble dims while the target stays bright — so we don't
    // double-mark it with a border. This also fixes a lingering
    // orange border when the bar was dismissed before the bubble
    // re-rendered fresh.
    const isFocused = focusedMessageId === currentMessage._id;
    const focusedBorder = isFocused ? { borderWidth: 2, borderColor: 'orange'} : {};
        
	if (currentMessage._id in groupOfImage && !(currentMessage._id in imageGroups)) {
		 return (null);
	}

    // === Styling / colors ===
    const bubbleRadius = 16;
    // gifted-chat's default bubble wrapper uses `borderRadius: 15`.
    // Our wrapperStyle (leftWrapper / rightWrapper above) overrides
    // borderTopLeftRadius / borderTopRightRadius to bubbleRadius (16),
    // but the BOTTOM corners stay at gifted-chat's default 15 because
    // the override doesn't touch them. The dim has to use BOTH values
    // to avoid 1px slivers of the bubble's actual corner peeking past
    // the dim — bottom corners using 16 (a slightly larger curve)
    // would cut MORE area than the bubble does, exposing 1px of
    // bubble-colour bleed at each bottom corner.
    const bubbleRadiusBottom = 15;
    // gifted-chat squares off the connecting corner (radius 3 instead
    // of the default 15) when adjacent messages are from the same
    // sender on the same day — that's the visual "grouping" between
    // consecutive messages on the same side. The dim overlay needs
    // to mirror that radius on the same corner so it doesn't extend
    // past the bubble's actual rounded silhouette.
    const groupedCornerRadius = 3;
    const _sameDay = (a, b) => {
        if (!a || !b || !a.createdAt || !b.createdAt) return false;
        const da = new Date(a.createdAt);
        const db = new Date(b.createdAt);
        return da.getFullYear() === db.getFullYear()
            && da.getMonth() === db.getMonth()
            && da.getDate() === db.getDate();
    };
    const _sameSide = (a, b) => {
        if (!a || !b) return false;
        // Prefer the user._id comparison (matches gifted-chat's
        // isSameUser exactly) so we behave identically in group /
        // conference chats where several incoming messages share a
        // `direction='incoming'` but come from different senders.
        // A direction-only check would treat those as a single
        // group, squaring the connecting corner in the dim while
        // gifted-chat keeps the bubble's corner rounded.
        // Direction is the fallback for messages where user is
        // either absent or has a falsy user object on both sides
        // (gifted-chat's check rejects falsy user, so falling back
        // to direction here only kicks in when neither side has a
        // user record — in which case direction is the most we have).
        if (a.user && b.user) {
            return a.user._id === b.user._id;
        }
        if (a.direction && b.direction) {
            return a.direction === b.direction;
        }
        return false;
    };
    const groupedWithPrev = !!(previousMessage
        && _sameSide(currentMessage, previousMessage)
        && _sameDay(currentMessage, previousMessage));
    const groupedWithNext = !!(nextMessage
        && _sameSide(currentMessage, nextMessage)
        && _sameDay(currentMessage, nextMessage));
    // Pull bubble colours from the active theme so flipping Day/Night
    // re-styles the chat surface. Day theme: incoming = white,
    // outgoing = light Sylk-blue (#D6EAF5). Night theme: incoming =
    // 'green', outgoing = '#fff' (legacy look preserved).
    const theme = DarkModeManager.getTheme();
    let leftColor = theme.bubbleIncoming;
    let rightColor = theme.bubbleOutgoing;
    // Text colours that ride with the bubble background. The body
    // text inside a text bubble actually flows through
    // CustomMessageText (which has its own theme-aware lookup); the
    // values here drive the FALLBACK text gifted-chat renders for
    // image / video / audio / location bubbles (captions + the
    // inline timestamp at the bottom of every bubble). Without
    // theme-awareness the left-side time stamp painted white-on-white
    // in Day mode — that was the "timestamp still white" complaint.
    const leftBodyTextColor  = theme.bubbleIncomingText;
    const rightBodyTextColor = theme.bubbleOutgoingText;
    const leftTimeTextColor  = theme.isDark ? '#FFFFFF' : '#667781';
    const rightTimeTextColor = '#667781';

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
          {/* Reply-target dim overlay for the preview. The preview
              banner sits ABOVE the gifted-chat Bubble (outside
              customView's reach), so it needs its own dim layer.
              Matches the bubble dim's alpha and top-corner radii
              (via previewWrapperStyle). The bottom is squared off
              because the preview is glued to the bubble below —
              the bubble's own dim continues the dark surface
              seamlessly from there.
              left: -3 covers the green border stripe
              (borderLeftWidth: 3 on replyPreviewContainerIncoming /
              Outgoing); RN's `position: absolute` children fill the
              padding box only, leaving the border uncovered. right
              and bottom get a small negative overflow too so any
              sub-pixel rounding or thin padding bleed doesn't show
              an undimmed sliver between the preview and the
              bubble's own dim layer. */}
          {isDimmedByReplyTarget ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 0,
                left: -3,
                right: -3,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.8)',
                borderTopLeftRadius: bubbleRadius,
                borderTopRightRadius: bubbleRadius,
                zIndex: 9999,
                elevation: 9999,
              }}
            />
          ) : null}
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

    // Encryption signal for the lock badge (file-transfer bubbles only).
    // Sources, in priority order:
    //   1. metadata.encrypted === true — set by uploadFile after a
    //      successful OpenPGP.encryptFile (sender) and by decryptInChunks
    //      after a successful decrypt (receiver). Persisted via
    //      JSON.stringify in updateFileTransferSql so it survives reload.
    //   2. metadata.url / metadata.filename ending in `.asc` — fallback
    //      for older rows and for received bubbles between arrival and
    //      decrypt completion.
    const isFileTransfer = currentMessage.contentType === 'application/sylk-file-transfer';
    const _meta = currentMessage.metadata || {};
    const wasEncrypted = !!(
      _meta.encrypted === true
      || (typeof _meta.url === 'string' && _meta.url.endsWith('.asc'))
      || (typeof _meta.filename === 'string' && _meta.filename.endsWith('.asc'))
    );
    const lockColor = wasEncrypted ? '#2ecc71' : 'rgba(0,0,0,0.35)';
    // Lock pinned to the corner SYMMETRIC with the timestamp:
    //   - Outgoing (timestamp at bottom-right) → bottom-LEFT corner
    //   - Incoming (timestamp at bottom-left)  → bottom-RIGHT corner
    // Anchored inside customView. Note: GiftedChat renders customView
    // INSIDE the message-body area (above the bottomContainer that
    // hosts the timestamp), so `bottom: 0` lands at the TOP of the
    // timestamp row, not the bottom of the bubble. Use a negative
    // bottom value to push the icon down into the timestamp row so its
    // baseline lines up with the time text. ~17px down covers
    // marginBottom 5 + ~12px for the lineHeight-ish vertical center of
    // an 11pt time text.
    const lockOnLeft = position === 'right';

    // custom view used for layout (won't block interactions). Doubles as
    // the anchor for the file-transfer encryption badge, which is
    // absolute-positioned in the corner opposite the timestamp. Also
    // hosts the reply-target dim overlay — putting it here (inside
    // the gifted-chat Bubble's wrapper, which is content-sized) means
    // the dim covers exactly the bubble's bounds, not the row-wide
    // outer wrapper. Without this, the dim would extend laterally
    // out to the screen edge on whichever side the bubble doesn't
    // reach — visible as a dark "bar" beside every non-target bubble.
    //
    // The dim is the LAST child so its native render order sits above
    // the lock icon. The Bubble is told to put customView LAST in
    // renderBubbleContent (via isCustomViewBottom={true} below) so
    // customView itself sits above the image / text content too.
    //
    // The dim's `bottom: -28` reaches DOWN past the body area into
    // the timestamp / ticks row — gifted-chat renders that row as a
    // sibling of customView's parent (it's NOT inside the body), but
    // the bubble's wrapper doesn't clip overflow, so a slight
    // negative bottom paints the dim over the timestamp too. 28 px
    // covers the typical 11pt time text's full line-height plus the
    // bubble's bottom padding.
    const customView = () => (
      <View
        pointerEvents="none"
        onLayout={e => handleBubbleLayout && handleBubbleLayout(currentMessage._id, e)}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        {isFileTransfer ? (
          <View
            pointerEvents="none"
            accessibilityLabel={wasEncrypted ? 'Encrypted file' : 'Unencrypted file'}
            style={{
              position: 'absolute',
              // Negative bottom pushes the icon down past the message-body
              // area into the timestamp row so it sits on the same
              // baseline as the time text (which has marginBottom: 5 +
              // ~12px line height of an 11pt font).
              bottom: -17,
              ...(lockOnLeft ? { left: 10 } : { right: 10 }),
            }}
          >
            <Icon
              name={wasEncrypted ? 'lock' : 'lock-off'}
              size={11}
              color={lockColor}
              style={{ opacity: 0.9 }}
            />
          </View>
        ) : null}
        {isDimmedByReplyTarget ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.8)',
              // Match the bubble's top corners exactly. This app's
              // wrapperStyle in ChatBubble unconditionally sets
              // borderTopLeftRadius / borderTopRightRadius to
              // bubbleRadius (16), which OVERRIDES gifted-chat's
              // grouped-bubble override for top corners. So the
              // bubble's top is always full radius (or 0 when a
              // reply preview sits above). We mirror that — no
              // groupedCornerRadius on the top corners — otherwise
              // grouped consecutive messages whose bubbles keep
              // rounded tops end up with a squared-top dim hook.
              // The BOTTOM corners still respect gifted-chat's
              // grouped squaring (see bottomContainerStyle below).
              borderTopLeftRadius: hasPreview ? 0 : bubbleRadius,
              borderTopRightRadius: hasPreview ? 0 : bubbleRadius,
              zIndex: 9999,
              elevation: 9999,
            }}
          />
        ) : null}
      </View>
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
      // Put customView AFTER the image/text/etc. in
      // renderBubbleContent so the dim overlay inside it sits on
      // top of the bubble's visual content (FastImage included).
      // Default is false — customView first, image renders on top
      // of it — which made the dim invisible behind image bubbles.
      isCustomViewBottom: true,
      // Tint the timestamp / ticks container the same dark colour
      // when the bubble is being dimmed for reply-targeting. The
      // body is dimmed by an overlay inside customView (above);
      // the timestamp container is a SIBLING of that body inside
      // gifted-chat's Bubble, so a single absolute overlay can't
      // reach both. Two matching tints stitched together cover
      // the full bubble. `bottomContainerStyle` is the prop
      // gifted-chat already routes onto the timestamp container.
      //
      // borderBottomLeft/RightRadius MUST match the bubble's
      // bottom corner radius (gifted-chat's default wrapper uses
      // 15) so the dark tint follows the bubble's rounded shape
      // instead of poking out as a sharp rectangle below it.
      bottomContainerStyle: isDimmedByReplyTarget ? {
        left: {
          backgroundColor: 'rgba(0,0,0,0.8)',
          // When the next message is on the same side / same day,
          // gifted-chat squares off the connecting bottom corner
          // (bottom-left on incoming / left bubbles, bottom-right
          // on outgoing / right bubbles). Mirror that so the dim
          // doesn't extrude past the bubble silhouette.
          //
          // The non-connecting bottom corner uses bubbleRadiusBottom
          // (15) — gifted-chat's default wrapper borderRadius — NOT
          // bubbleRadius (16, which our wrapperStyle uses for TOP
          // corners only). Otherwise the dim's bottom corner is one
          // pixel "more curved" than the bubble's, exposing a thin
          // sliver of the bubble's white/green corner outside the
          // dim.
          borderBottomLeftRadius: groupedWithNext ? groupedCornerRadius : bubbleRadiusBottom,
          borderBottomRightRadius: bubbleRadiusBottom,
        },
        right: {
          backgroundColor: 'rgba(0,0,0,0.8)',
          borderBottomLeftRadius: bubbleRadiusBottom,
          borderBottomRightRadius: groupedWithNext ? groupedCornerRadius : bubbleRadiusBottom,
        },
      } : undefined,
    };

    // Choose bubble variant (image / video / audio / text)
    let content = null;

    if (currentMessage.image) {
      // Preview state: the user just attached an image and is about
      // to send it. Strip every bit of margin/padding/border GiftedChat
      // adds around the bubble so the image fills the screen edge to
      // edge horizontally and sits flush against the input toolbar
      // below. Avatar gutter + radii are also dropped — there's only
      // one thing on screen and it should look like a single block.
      const isPreview = currentMessage.metadata?.preview === true;

      const previewWrapper = isPreview
        ? {
            backgroundColor: 'transparent',
            borderRadius: 0,
            borderTopLeftRadius: 0,
            borderTopRightRadius: 0,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            // Explicit longhand zeros — gifted-chat's wrapper hard-codes
            // marginLeft: 60 (right pos) / marginRight: 60 (left pos),
            // and a shorthand `margin: 0` doesn't always override a
            // pre-applied longhand margin in RN's style merging. Spell
            // out each side so the gutter actually disappears.
            marginTop: 0,
            marginRight: 0,
            marginBottom: 0,
            marginLeft: 0,
            padding: 0,
            // Force the wrapper to span the full width of the Bubble
            // container, regardless of the parent's alignItems.
            alignSelf: 'stretch',
            width: '100%'
          }
        : null;

      // GiftedChat's Bubble wraps wrapperStyle in a containerStyle View
      // that adds horizontal margin (avatar gutter). Zero it out on
      // both sides for the preview so the wrapper actually reaches the
      // screen edges.
      const previewContainer = isPreview
        ? {
            margin: 0,
            marginLeft: 0,
            marginRight: 0,
            padding: 0
          }
        : null;

      content = (
        <Bubble
          {...bubbleProps}
          wrapperStyle={{
            left: isPreview
              ? { ...leftWrapper, ...previewWrapper }
              : { ...leftWrapper, alignSelf: 'stretch', marginRight: 0 },
            right: isPreview
              ? { ...rightWrapper, ...previewWrapper }
              : { ...rightWrapper, alignSelf: 'stretch', marginLeft: 0 }
          }}
          containerStyle={isPreview ? { left: previewContainer, right: previewContainer } : undefined}
          containerToPreviousStyle={isPreview ? { left: previewContainer, right: previewContainer } : undefined}
          containerToNextStyle={isPreview ? { left: previewContainer, right: previewContainer } : undefined}
          // Only set bottomContainerStyle in preview mode — outside
          // preview, let bubbleProps.bottomContainerStyle through so
          // the reply-target timestamp dim works on image bubbles too.
          // Previously this was `isPreview ? … : undefined`, which
          // explicitly stomped bubbleProps' value with undefined.
          {...(isPreview ? { bottomContainerStyle: { left: previewContainer, right: previewContainer } } : {})}
          textProps={{ style: { color: position === 'left' ? leftBodyTextColor : rightBodyTextColor } }}
          textStyle={{ left: { color: leftTimeTextColor }, right: { color: rightTimeTextColor } }}
        />
      );
    } else if (currentMessage.video) {
      content = (
        <Bubble
          {...bubbleProps}
          wrapperStyle={{ left: { ...leftWrapper, alignSelf: 'stretch', marginRight: 0 }, right: { ...rightWrapper, alignSelf: 'stretch', marginLeft: 0 } }}
          textProps={{ style: { color: position === 'left' ? leftBodyTextColor : rightBodyTextColor } }}
          textStyle={{ left: { color: leftTimeTextColor }, right: { color: rightTimeTextColor } }}
        />
      );
    } else if (currentMessage.audio) {
      // The audio bubble's inner content (renderMessageAudio) is
      // painted in white by default: white duration label, white slider
      // track/knob, on a Sylk-blue play-button circle. A fully-
      // transparent wrapper works in Night mode because the chat
      // surface behind it is dark — white-on-dark reads fine. In Day
      // mode we want a WHITE bubble background, but white-on-white
      // would obviously hide the label + slider, so renderMessageAudio
      // is also flipped to draw those in dark when theme.isDark is
      // false (see ContactsListBox.renderMessageAudio). The border
      // becomes a light grey hairline in Day so the white pill has
      // some visible edge against the chat surface.
      const audioBubbleBg     = theme.isDark ? 'transparent' : '#FFFFFF';
      const audioBubbleBorder = theme.isDark ? 'white'       : 'rgba(0,0,0,0.12)';
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
          textProps={{ style: { color: position === 'left' ? leftBodyTextColor : rightBodyTextColor } }}
          textStyle={{ left: { color: leftTimeTextColor }, right: { color: rightTimeTextColor } }}
          wrapperStyle={{
            left: {
              ...leftWrapper,
              backgroundColor: audioBubbleBg,
              borderColor: audioBubbleBorder,
              borderWidth: 0.5,
              alignSelf: 'stretch',
              marginRight: 24,
            },
            right: {
              ...rightWrapper,
              backgroundColor: audioBubbleBg,
              borderColor: audioBubbleBorder,
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
      
          textProps={{ style: { color: position === 'left' ? leftBodyTextColor : rightBodyTextColor } }}
          textStyle={{ left: { color: leftTimeTextColor }, right: { color: rightTimeTextColor } }}
        />
      );
    } else if (currentMessage.contentType === 'application/sylk-live-location') {
      // Live-location bubbles host an interactive trail scrubber
      // (AudioProgressSlider) plus zoom / pan / current-location /
      // restore icon buttons. GiftedChat's default Bubble wrapper
      // both claims the responder for tap AND fires its own
      // onLongPress timer after ~300 ms regardless of whether an
      // inner PanResponder is actively dragging — which means a
      // slow slide pops the contextual menu mid-drag.
      // We disable BOTH:
      //   • onPress — empty no-op so a tap doesn't bubble up
      //   • onLongPress — empty no-op so the menu can't open via
      //     long-press anywhere on the bubble. The user can still
      //     open the contextual menu by tapping the menu icon in
      //     the footer (the hamburger on the left), which routes
      //     through triggerMenu in LocationBubble.js — so the
      //     menu remains reachable, just not via the bubble body.
      content = (
        <Bubble
          {...bubbleProps}
          onPress={() => {}}
          onLongPress={() => {}}
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
          textProps={{ style: { color: position === 'left' ? leftBodyTextColor : rightBodyTextColor } }}
          textStyle={{ left: { color: leftTimeTextColor }, right: { color: rightTimeTextColor } }}
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
          textProps={{ style: { color: position === 'left' ? leftBodyTextColor : rightBodyTextColor } }}
          textStyle={{ left: { color: leftTimeTextColor }, right: { color: rightTimeTextColor } }}
        />
      );
    }

    // The encryption lock badge is rendered inside the bubble's own
    // timestamp bar (see renderTime in ContactsListBox.js) so it sits
    // beside the time text and can't escape the rounded bubble corners.
    return (
      <View style={{
          flex: 1,
          alignSelf: 'stretch',
      }}>
        {replyPreview}
        {content}
        {/* (Reply-target dim overlay was moved INTO `customView`
            above, so it covers only the bubble's actual bounds
            rather than this row-wide outer wrapper. Putting it
            here would extend the dim laterally to the screen
            edge on the side the bubble doesn't reach — visible
            as a black bar.) */}
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
	  // live-location rows so we can see which branch below ens the
	  // comparator. `return true` = SKIP re-render (bubble stays stale);
	  // `return false` = re-render. Kept as a no-op helper so the call
	  // sites below don't have to be touched — the diagnostic body was
	  // removed once the location-memo behaviour was settled; reinstate
	  // the console.log inside if you need to trace a memo regression.
	  const locTrace = () => {};

	  // ==== Reply-target / dim checks ====
	  // MUST run before any of the SKIP-returning early checks below
	  // (notably imageLoadingState, which on image bubbles flips
	  // undefined→false→true as FastImage loads and previously caused
	  // the memo to skip — eating the isDimmedByReplyTarget flip on
	  // image bubbles so they never dimmed when the reaction bar
	  // opened on a different message). Putting these first
	  // guarantees the reply-target visuals update for every bubble
	  // type before any optimization-style SKIPs run.
	  if (
		prev.replyTargetId === id ||
		next.replyTargetId === id
	  ) {
		locTrace(false, 'reply target');
		return false;
	  }
	  if ((!!prev.isDimmedByReplyTarget) !== (!!next.isDimmedByReplyTarget)) {
		locTrace(false, 'isDimmed changed');
		return false;
	  }

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

	  // ==== Grouped-image selection ====
	  // The grouped-image bubble (the one whose _id is the head of an
	  // imageGroups entry) hosts the ThumbnailGrid with selectable
	  // tiles. When the user taps a tile, ContactsListBox updates
	  // state.selectedImages, which is now plumbed in as
	  // selectedImages — but this comparator otherwise ignores it,
	  // so the bubble would short-circuit re-render and the
	  // ThumbnailGrid would stay mounted with stale selectedIds /
	  // checkbox state. Re-render only for bubbles that actually
	  // render a grid (id is a key of imageGroups). Text bubbles
	  // don't care about selectedImages and stay cached.
	  if (next.imageGroups && id in next.imageGroups) {
		if (prev.selectedImages !== next.selectedImages) {
		  locTrace(false, 'selectedImages changed for grouped bubble');
		  return false;
		}
	  }

	  // ==== Lazy live-location render ====
	  // The parent (ContactsListBox.renderMessageText) returns a
	  // lightweight placeholder for live-location bubbles whose ids
	  // aren't in state.visibleMessageIds AND aren't in the sticky
	  // renderedMessageIds set. When a bubble first scrolls into
	  // view, visibleMessageIds gets updated by
	  // onViewableItemsChanged — but if THIS comparator doesn't
	  // detect a relevant change it short-circuits to `return true`
	  // and the placeholder stays mounted forever. Force a
	  // re-render whenever the bubble's id flips in/out of
	  // visibleMessageIds so the placeholder → real LocationBubble
	  // swap can land.
	  if (p.contentType === 'application/sylk-live-location') {
		const prevVisible = !!(prev.visibleMessageIds
			&& prev.visibleMessageIds.includes(id));
		const nextVisible = !!(next.visibleMessageIds
			&& next.visibleMessageIds.includes(id));
		if (prevVisible !== nextVisible) {
			locTrace(false, 'live-location visibility flipped');
			return false;
		}
	  }

	  // ==== Transfer progress ====
	  // Re-render whenever the transferProgress entry for this bubble
	  // appears, disappears, changes stage, or changes numeric progress.
	  // Previously this only watched numeric `progress` with `?? 0` defaults,
	  // which silently swallowed the first update (undefined → {progress:0})
	  // and any stage transition that happened to keep progress at 0. The
	  // user never saw the "Downloading..." label / cancel button until the
	  // first non-zero progress event arrived — and on stalled large
	  // downloads that may never happen.
	  const prevProgEntry = prev.transferProgress?.[id];
	  const nextProgEntry = next.transferProgress?.[id];
	  const prevHas = prevProgEntry !== undefined;
	  const nextHas = nextProgEntry !== undefined;

	  if (prevHas !== nextHas) {
		locTrace(false, 'transferProgress entry appeared/cleared');
		return false;
	  }

	  if (prevHas && nextHas) {
		if (prevProgEntry.stage !== nextProgEntry.stage) {
			locTrace(false, 'stage changed');
			return false;
		}
		const prevProgress = prevProgEntry.progress ?? 0;
		const nextProgress = nextProgEntry.progress ?? 0;
		if (prevProgress !== nextProgress) {
			if (prevProgress && nextProgress !== 0 && prevProgress > nextProgress) {
				locTrace(true, 'progress regressed');
				return true;
			}
			locTrace(false, 'progress changed');
			return false;
		}
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

	// (replyTargetId / isDimmedByReplyTarget checks moved to the
	// top of this comparator — they need to win over the
	// imageLoadingState SKIP that lives further up.)

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
