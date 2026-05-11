// PlatformToggle.js
//
// Cross-platform on/off control + label, with the spacing iOS needs
// to keep the (wider) Switch from crowding the label next to it.
//
//  - Android: Material Checkbox + label, mirroring the visual style
//    the existing modals already have.
//  - iOS: native Switch (toggle) + label with explicit marginLeft so
//    the label doesn't overlap the Switch's track. The Switch itself
//    is scaled to ~0.85 so it sits at roughly the same vertical
//    weight as a Material Checkbox; otherwise the iOS toggle dwarfs
//    the rest of the modal row and reads visually heavy.
//
// Existing modals had `<Switch/> <Text> Label</Text>` patterns where
// only a single space character separated the control from its
// label. On iOS that space wasn't enough and the Text frequently
// overlapped the right edge of the Switch's hitbox; this component
// is the drop-in fix.
//
// Usage:
//   <PlatformToggle
//       value={this.state.flag}
//       onValueChange={this.toggleFlag}
//       label="Incoming"
//   />

import React from 'react';
import PropTypes from 'prop-types';
import { View, Platform, TouchableOpacity } from 'react-native';
import { Checkbox, Text } from 'react-native-paper';

// Geometry constants for the custom iOS toggle. Keeping the pill
// height a few pt smaller than the native iOS Switch so it reads
// at roughly the same visual weight as a Material Checkbox row.
const TOGGLE_W      = 44;
const TOGGLE_H      = 24;
const TOGGLE_RADIUS = TOGGLE_H / 2;
const THUMB_SIZE    = 20;
const THUMB_PAD     = (TOGGLE_H - THUMB_SIZE) / 2;
const COLOR_OFF     = '#9e9e9e';
const COLOR_ON      = '#2ecc71';
const COLOR_THUMB   = '#ffffff';

const PlatformToggle = ({
    value,
    onValueChange,
    label,
    disabled = false,
    style,
    labelStyle,
}) => {
    const isIOS = Platform.OS === 'ios';
    return (
        <View style={[
            {
                flexDirection: 'row',
                alignItems: 'center',
            },
            style,
        ]}>
            {isIOS ? (
                // Custom oval+circle toggle. iOS's native Switch was
                // proving impossible to style consistently — OFF state
                // either invisible, or rendered narrower than ON, or
                // wider, depending on which combination of
                // trackColor/ios_backgroundColor/wrapper we used.
                // Building it from primitives gives identical width on
                // both states and predictable colors.
                <TouchableOpacity
                    activeOpacity={0.7}
                    disabled={disabled}
                    onPress={() => onValueChange && onValueChange(!value)}
                    style={{
                        width: TOGGLE_W,
                        height: TOGGLE_H,
                        borderRadius: TOGGLE_RADIUS,
                        backgroundColor: value ? COLOR_ON : COLOR_OFF,
                        justifyContent: 'center',
                        opacity: disabled ? 0.5 : 1,
                    }}
                >
                    <View style={{
                        position: 'absolute',
                        top: THUMB_PAD,
                        left: value
                            ? TOGGLE_W - THUMB_SIZE - THUMB_PAD
                            : THUMB_PAD,
                        width: THUMB_SIZE,
                        height: THUMB_SIZE,
                        borderRadius: THUMB_SIZE / 2,
                        backgroundColor: COLOR_THUMB,
                        // Subtle elevation so the thumb reads as
                        // lifted off the pill on both states.
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 1 },
                        shadowOpacity: 0.2,
                        shadowRadius: 1.5,
                    }} />
                </TouchableOpacity>
            ) : (
                <Checkbox
                    status={value ? 'checked' : 'unchecked'}
                    onPress={() => onValueChange && onValueChange(!value)}
                    disabled={disabled}
                />
            )}
            <Text style={[
                {
                    // Generous gap so the label can never overlap the
                    // Switch track on iOS, and the row reads cleanly
                    // on Android too.
                    marginLeft: isIOS ? 8 : 4,
                    flexShrink: 1,
                },
                labelStyle,
            ]}>
                {label}
            </Text>
        </View>
    );
};

PlatformToggle.propTypes = {
    value: PropTypes.bool,
    onValueChange: PropTypes.func.isRequired,
    label: PropTypes.string.isRequired,
    disabled: PropTypes.bool,
    style: PropTypes.any,
    labelStyle: PropTypes.any,
};

export default PlatformToggle;
