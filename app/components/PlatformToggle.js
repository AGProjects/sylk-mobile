// PlatformToggle.js
//
// One toggle widget shared by every modal in the app so the
// look-and-feel can be changed in a single place. Renders identically
// on iOS and Android — the previous version branched per platform
// (Material Checkbox on Android, custom pill on iOS), which left
// modals visually inconsistent and made design tweaks a per-platform
// chore.
//
// What you get:
//   • Custom oval+thumb pill drawn from primitives (no native Switch).
//     iOS's native Switch couldn't be styled to a stable OFF/ON
//     width / colour. Drawing it ourselves guarantees the same
//     geometry on both platforms.
//   • Optional leading icon (MaterialCommunityIcons name string).
//   • Optional second-line description, shown smaller and dimmer
//     under the main label.
//   • Whole row is tappable — flipping the switch is the same as
//     tapping anywhere on the label / description / icon.
//   • Disabled state dims everything uniformly.
//
// Single visual source of truth — tweak the constants at the top of
// this file (track / thumb size, ON / OFF colours, label sizing) and
// every modal in the app updates with it.
//
// Usage:
//   <PlatformToggle
//       value={this.state.flag}
//       onValueChange={this.toggleFlag}
//       label="Incoming"
//   />
//
// Two-line row with icon (e.g. EditConferenceModal's Mute row):
//   <PlatformToggle
//       value={muted}
//       onValueChange={setMuted}
//       iconName="bell-off-outline"
//       label="Mute notifications"
//       description="Don't notify me about activity in this room."
//   />

import React from 'react';
import PropTypes from 'prop-types';
import { View, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcon from 'react-native-vector-icons/MaterialCommunityIcons';

// ── Visual tokens ─────────────────────────────────────────────
// Change a value here → every PlatformToggle in the app picks it
// up on next render. No per-modal overrides.
const TOGGLE_W      = 44;
const TOGGLE_H      = 24;
const TOGGLE_RADIUS = TOGGLE_H / 2;
const THUMB_SIZE    = 20;
const THUMB_PAD     = (TOGGLE_H - THUMB_SIZE) / 2;
const COLOR_OFF     = '#9e9e9e';
const COLOR_ON      = '#2ecc71';
const COLOR_THUMB   = '#ffffff';
const COLOR_LABEL   = '#222222';
const COLOR_DESC    = '#888888';
const COLOR_ICON_ON = '#2ecc71';
const COLOR_ICON_OFF= '#555555';
const ROW_GAP       = 10;  // gap between toggle and label block
// Baseline vertical breathing room around the row. Earlier the
// per-platform branch (Material Checkbox on Android, custom pill on
// iOS) added its own intrinsic padding — Android Checkbox in
// particular came with ~12pt of touch-target padding baked in. Now
// that both platforms draw the custom pill, we have to add that
// spacing back here so consecutive toggle rows in modals like
// EditContactModal don't sit flush against each other. Callers can
// still pass a `style` prop with marginTop / marginBottom to
// fine-tune; this is just the default.
const ROW_PAD_V     = 6;

const PlatformToggle = ({
    value,
    onValueChange,
    label,
    description,
    iconName,
    disabled = false,
    style,
    labelStyle,
}) => {
    const flip = () => {
        if (disabled) return;
        if (typeof onValueChange === 'function') onValueChange(!value);
    };

    return (
        <TouchableOpacity
            activeOpacity={0.7}
            disabled={disabled}
            onPress={flip}
            accessibilityRole="switch"
            accessibilityState={{ checked: !!value, disabled }}
            accessibilityLabel={label}
            style={[
                {
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: ROW_PAD_V,
                    opacity: disabled ? 0.5 : 1,
                },
                style,
            ]}
        >
            {/* The pill */}
            <View
                style={{
                    width: TOGGLE_W,
                    height: TOGGLE_H,
                    borderRadius: TOGGLE_RADIUS,
                    backgroundColor: value ? COLOR_ON : COLOR_OFF,
                    justifyContent: 'center',
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
                    // Subtle elevation so the thumb reads as lifted
                    // off the pill on both states.
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.2,
                    shadowRadius: 1.5,
                }} />
            </View>

            {/* Optional leading icon between pill and label. */}
            {iconName ? (
                <MaterialCommunityIcon
                    name={iconName}
                    size={20}
                    color={value ? COLOR_ICON_ON : COLOR_ICON_OFF}
                    style={{ marginLeft: ROW_GAP, marginRight: 0 }}
                />
            ) : null}

            {/* Label block — main label + optional description.
                flexShrink so long copy wraps inside the row instead
                of overflowing past the right edge of the modal. */}
            <View style={{
                marginLeft: ROW_GAP,
                flexShrink: 1,
                flex: 1,
            }}>
                <Text style={[
                    {
                        fontSize: 14,
                        color: COLOR_LABEL,
                    },
                    labelStyle,
                ]}>
                    {label}
                </Text>
                {description ? (
                    <Text style={{
                        fontSize: 11,
                        color: COLOR_DESC,
                        marginTop: 1,
                    }}>
                        {description}
                    </Text>
                ) : null}
            </View>
        </TouchableOpacity>
    );
};

PlatformToggle.propTypes = {
    value: PropTypes.bool,
    onValueChange: PropTypes.func.isRequired,
    label: PropTypes.string.isRequired,
    description: PropTypes.string,
    iconName: PropTypes.string,
    disabled: PropTypes.bool,
    style: PropTypes.any,
    labelStyle: PropTypes.any,
};

export default PlatformToggle;
