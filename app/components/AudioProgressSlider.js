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
    // Keep the latest dragPct accessible inside PanResponder callbacks.
    const dragPctRef = useRef(0);

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
            setDragging(true);
            const start = onSeekStartRef.current;
            if (start) start();
            if (typeof x === 'number') {
                const w = widthRef.current;
                setPct(clamp((x / Math.max(1, w)) * 100));
            }
        },
        onPanResponderMove: (evt) => {
            const x = evt.nativeEvent.locationX;
            const w = widthRef.current;
            setPct(clamp((x / Math.max(1, w)) * 100));
        },
        onPanResponderRelease: () => {
            const finalPct = dragPctRef.current;
            setDragging(false);
            const cb = onSeekRef.current;
            if (cb) cb(finalPct);
        },
        onPanResponderTerminate: () => {
            const finalPct = dragPctRef.current;
            setDragging(false);
            const cb = onSeekRef.current;
            if (cb) cb(finalPct);
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), []);

    const displayPct = dragging ? dragPct : clamp(progress);
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
