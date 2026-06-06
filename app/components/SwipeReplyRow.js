// SwipeReplyRow — lightweight swipe-to-reply wrapper for a chat row.
//
// WHY NOT react-native-gesture-handler's <Swipeable>?
// Swipeable renders its left AND right action panes (each an Animated
// view with interpolations) for EVERY row on EVERY render, whether or
// not the row is being touched. Across a full chat that's a constant
// stream of Animated-node churn on the JS thread and it made the whole
// UI sluggish (seconds of input lag).
//
// This component instead uses a bare Gesture.Pan + GestureDetector:
// nothing animates until you actually drag a row, and the only extra
// views are two tiny reply icons whose opacity is driven by a single
// per-row Animated.Value (created ONCE via useRef, not per render).
//
// Behaviour: drag a row horizontally (either direction) past a small
// threshold and release to open reply mode for that message, with a
// haptic tick when the threshold is crossed. Vertical list scrolling is
// preserved (the gesture only activates on horizontal movement and
// yields to vertical pans).

import React, { useRef, useMemo } from 'react';
import { Animated } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const THRESHOLD = 56;   // px of pull needed to fire a reply
const MAX_PULL = 84;    // clamp so the row can't be dragged off-screen

const SwipeReplyRow = ({ children, onReply, onHaptic }) => {
    // Persist the drag value and trigger latch across renders.
    const translateX = useRef(new Animated.Value(0)).current;
    const triggered = useRef(false);
    // Keep the latest callbacks in a ref so the memoised gesture can call
    // them without being recreated every render.
    const cbs = useRef({ onReply, onHaptic });
    cbs.current.onReply = onReply;
    cbs.current.onHaptic = onHaptic;

    const pan = useMemo(
        () =>
            Gesture.Pan()
                // Only take over once the finger has clearly moved
                // horizontally; bail (let the list scroll) on vertical
                // movement. runOnJS so our Animated/JS callbacks run on
                // the JS thread (this app has no reanimated worklets).
                .activeOffsetX([-14, 14])
                .failOffsetY([-12, 12])
                .runOnJS(true)
                .onUpdate((e) => {
                    let tx = e.translationX;
                    if (tx > MAX_PULL) tx = MAX_PULL;
                    else if (tx < -MAX_PULL) tx = -MAX_PULL;
                    translateX.setValue(tx);
                    const passed = Math.abs(tx) >= THRESHOLD;
                    if (passed && !triggered.current) {
                        triggered.current = true;
                        if (cbs.current.onHaptic) cbs.current.onHaptic();
                    } else if (!passed && triggered.current) {
                        triggered.current = false;
                    }
                })
                .onEnd((e) => {
                    const fire = Math.abs(e.translationX) >= THRESHOLD;
                    triggered.current = false;
                    Animated.spring(translateX, {
                        toValue: 0,
                        useNativeDriver: true,
                        bounciness: 4,
                        speed: 20,
                    }).start();
                    if (fire && cbs.current.onReply) cbs.current.onReply();
                }),
        // translateX is a stable ref; callbacks are read via cbs ref.
        [translateX]
    );

    // No eagerly-rendered reply icons / interpolations: rendering an
    // Animated.View per row on every render was the same overhead that
    // made Swipeable slow. The only per-row cost here is ONE Animated.View
    // whose transform is a static value until you actually drag — cheap.
    // Feedback is the row sliding + a haptic tick at the threshold.
    return (
        <GestureDetector gesture={pan}>
            <Animated.View style={{ transform: [{ translateX }] }}>
                {children}
            </Animated.View>
        </GestureDetector>
    );
};

export default SwipeReplyRow;
