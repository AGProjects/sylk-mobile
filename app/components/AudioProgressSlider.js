import React, { useState, useRef, useEffect, useMemo } from 'react';
import { View, PanResponder } from 'react-native';

/**
 * Scrubbable audio progress bar with a draggable needle.
 *
 * Props:
 *   progress       number  0..100  current playback percentage (ignored while dragging)
 *   width          number  total bar width in px
 *   height         number  bar thickness in px (default 6)
 *   knobWidth      number  needle width in px (default 4)
 *   knobHeight     number  needle height in px (default 18)
 *   color          string  filled portion color
 *   unfilledColor  string  remaining portion color
 *   knobColor      string  needle color (default = color)
 *   disabled       bool    disables touch interaction
 *   onSeek         (pct) => void   called on touch release with the picked percentage (0..100)
 *   onSeekStart    () => void      called when the user first touches the bar
 *   onSeekChange   (pct) => void   called continuously while dragging (optional preview hook)
 *   style          extra style for the outer container
 */
const AudioProgressSlider = ({
    progress = 0,
    width = 150,
    height = 6,
    knobWidth = 4,
    knobHeight = 18,
    color = 'orange',
    unfilledColor = 'white',
    knobColor,
    disabled = false,
    onSeek,
    onSeekStart,
    onSeekChange,
    style,
}) => {
    const [dragging, setDragging] = useState(false);
    const [dragPct, setDragPct] = useState(0);
    // After a release, the parent's `progress` prop takes a beat to
    // catch up while updateFileTransferMetadata's setState propagates
    // back through GiftedChat. Without `pendingPct` the slider would
    // momentarily snap to the OLD progress value (= where the user
    // started the drag), then jump again to the new one a frame later.
    // We park the released-to value here and keep showing it until
    // progress arrives close enough to take over.
    const [pendingPct, setPendingPct] = useState(null);
    // Keep the latest dragPct accessible inside PanResponder callbacks.
    const dragPctRef = useRef(0);
    // Boundary-lock: once the finger has dragged off the LEFT edge,
    // we synthesize a release at 0 immediately and ignore any further
    // pan events for the rest of the gesture. Without this lock the
    // gesture keeps tracking past the slider's bounds — and depending
    // on how the parent FlatList competes for the touch, the actual
    // onPanResponderRelease can fire with a stale dragPct, snapping
    // the slider back to a non-zero value (the "drag to 0 flips back"
    // bug). Reset on every Grant so the next gesture starts fresh.
    const lockedRef = useRef(false);

    const clamp = (n) => Math.max(0, Math.min(100, n));

    // Refs for the LATEST props/handlers so the PanResponder's
    // long-lived callbacks always see fresh values, not whatever
    // closure values existed when the responder was first created.
    // Otherwise width changes (and any future onSeekChange/onSeek
    // identity changes) would silently use stale data.
    const widthRef = useRef(width);
    const disabledRef = useRef(disabled);
    const onSeekRef = useRef(onSeek);
    const onSeekStartRef = useRef(onSeekStart);
    const onSeekChangeRef = useRef(onSeekChange);
    useEffect(() => {
        widthRef.current = width;
        disabledRef.current = disabled;
        onSeekRef.current = onSeek;
        onSeekStartRef.current = onSeekStart;
        onSeekChangeRef.current = onSeekChange;
    });

    const setPct = (pct) => {
        dragPctRef.current = pct;
        setDragPct(pct);
        const cb = onSeekChangeRef.current;
        if (cb) cb(pct);
    };

    // PanResponder created via useMemo so it's available
    // SYNCHRONOUSLY during the FIRST render. The previous
    // useEffect-based creation only attached the panHandlers AFTER
    // the first commit; if no other state change forced a
    // re-render before the user touched the slider, the View
    // rendered with empty panHandlers and the touch went nowhere
    // — exactly the "first chat open the slider doesn't react,
    // closing and re-opening fixes it" bug the user reported.
    // useMemo runs during render, so the spread on the View below
    // always receives a real responder.
    //
    // Memo deps are empty: the handlers internally read from refs,
    // so the responder never needs to be recreated. This also
    // keeps the responder identity stable, which avoids resetting
    // any in-flight gesture if width/disabled change mid-drag.
    const panResponder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponderCapture: () => !disabledRef.current,
        onMoveShouldSetPanResponderCapture: () => !disabledRef.current,
        onStartShouldSetPanResponder: () => !disabledRef.current,
        onMoveShouldSetPanResponder: () => !disabledRef.current,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (evt) => {
            const x = evt && evt.nativeEvent ? evt.nativeEvent.locationX : null;
            // New gesture — clear any boundary lock from the previous one.
            lockedRef.current = false;
            setDragging(true);
            const start = onSeekStartRef.current;
            if (start) start();
            if (typeof x === 'number') {
                const w = widthRef.current;
                setPct(clamp((x / Math.max(1, w)) * 100));
            }
        },
        onPanResponderMove: (evt) => {
            // After we've synthetic-released on the left edge, ignore
            // any further moves so a subsequent finger drift can't
            // bump dragPct off zero.
            if (lockedRef.current) return;
            const x = evt.nativeEvent.locationX;
            const w = widthRef.current;
            const rawPct = (x / Math.max(1, w)) * 100;
            // Snap-to-zero zone: anywhere within ~2% of the left edge
            // commits a seek at 0 and locks the gesture out. A bare
            // x<=0 check wasn't enough — a fingertip is wider than a
            // single pixel, so users were bottoming out at 2-3%
            // because their touch never reached locationX=0. The
            // threshold lets the slider snap cleanly to 0 the moment
            // the finger gets close, and the lock prevents a
            // post-edge drift or late termination from re-committing
            // a stale dragPct.
            if (rawPct <= 2) {
                lockedRef.current = true;
                setPct(0);
                setPendingPct(0);
                setDragging(false);
                const cb = onSeekRef.current;
                if (cb) cb(0);
                return;
            }
            setPct(clamp(rawPct));
        },
        onPanResponderRelease: () => {
            // If the move handler already committed a left-edge
            // release, the actual release-up is a no-op — we don't
            // want to overwrite our 0 with a stale dragPct.
            if (lockedRef.current) return;
            const finalPct = dragPctRef.current;
            // Park the released-to value before clearing `dragging` so
            // there's no frame where displayPct falls back to the stale
            // `progress` prop. pendingPct is cleared by the useEffect
            // below the moment progress catches up.
            setPendingPct(finalPct);
            setDragging(false);
            const cb = onSeekRef.current;
            if (cb) cb(finalPct);
        },
        onPanResponderTerminate: () => {
            if (lockedRef.current) return;
            const finalPct = dragPctRef.current;
            setPendingPct(finalPct);
            setDragging(false);
            const cb = onSeekRef.current;
            if (cb) cb(finalPct);
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), []);

    // Drop the parked release-value once the parent's progress prop has
    // settled near where we left off (within 1.5%). Symmetric on both
    // sides: a backward drag (50 → 0) and a forward drag (0 → 80) both
    // clear via the same |diff|<1.5 rule once the parent state catches
    // up. (An earlier version had a `progress > pendingPct + 2` branch
    // to detect playback resumption ahead of the seek point — but that
    // also fired the instant a user dragged backward, before the
    // parent's seekAudioMessage propagated, snapping the slider back to
    // the pre-drag value. The |diff| rule alone handles resume cleanly:
    // playback advances by ~1% per tick, so as soon as it hits the
    // seek point pendingPct gets cleared.)
    useEffect(() => {
        if (pendingPct === null) return;
        if (Math.abs(progress - pendingPct) < 1.5) {
            setPendingPct(null);
        }
    }, [progress, pendingPct]);

    // Display priority: live drag → parked release-value → progress prop.
    const displayPct = dragging
        ? dragPct
        : (pendingPct !== null ? pendingPct : clamp(progress));
    const fillWidth = (displayPct / 100) * width;
    const knobLeft = Math.max(0, Math.min(width - knobWidth, fillWidth - knobWidth / 2));

    // Vertical hit-slop: pad the touchable area to make grabbing the needle easier.
    const verticalPad = Math.max(12, knobHeight);

    return (
        <View
            style={[
                {
                    width,
                    paddingVertical: verticalPad,
                    justifyContent: 'center',
                },
                style,
            ]}
            {...panResponder.panHandlers}
        >
            {/* Track (unfilled) */}
            <View
                style={{
                    width,
                    height,
                    borderRadius: height / 2,
                    backgroundColor: unfilledColor,
                    overflow: 'hidden',
                }}
            >
                {/* Filled portion */}
                <View
                    style={{
                        width: fillWidth,
                        height,
                        backgroundColor: color,
                        borderRadius: height / 2,
                    }}
                />
            </View>

            {/* Needle (thin rectangular knob) */}
            <View
                pointerEvents="none"
                style={{
                    position: 'absolute',
                    left: knobLeft,
                    top: verticalPad - knobHeight / 2 + height / 2,
                    width: knobWidth,
                    height: knobHeight,
                    borderRadius: 1,
                    backgroundColor: knobColor || color,
                    elevation: 2,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.25,
                    shadowRadius: 1.5,
                }}
            />
        </View>
    );
};

export default AudioProgressSlider;
