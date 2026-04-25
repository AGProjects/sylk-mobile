import React, { useState, useRef, useEffect } from 'react';
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
    const pctFromX = (x) => clamp((x / Math.max(1, width)) * 100);

    const setPct = (pct) => {
        dragPctRef.current = pct;
        setDragPct(pct);
        if (onSeekChange) {
            onSeekChange(pct);
        }
    };

    // Recreate PanResponder only when width/disabled change.
    const panResponder = useRef(null);
    useEffect(() => {
        panResponder.current = PanResponder.create({
            onStartShouldSetPanResponder: () => !disabled,
            onMoveShouldSetPanResponder: () => !disabled,
            onPanResponderTerminationRequest: () => false,
            onPanResponderGrant: (evt) => {
                setDragging(true);
                if (onSeekStart) {
                    onSeekStart();
                }
                setPct(pctFromX(evt.nativeEvent.locationX));
            },
            onPanResponderMove: (evt) => {
                setPct(pctFromX(evt.nativeEvent.locationX));
            },
            onPanResponderRelease: () => {
                const finalPct = dragPctRef.current;
                setDragging(false);
                if (onSeek) {
                    onSeek(finalPct);
                }
            },
            onPanResponderTerminate: () => {
                const finalPct = dragPctRef.current;
                setDragging(false);
                if (onSeek) {
                    onSeek(finalPct);
                }
            },
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [width, disabled]);

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
            {...(panResponder.current ? panResponder.current.panHandlers : {})}
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
