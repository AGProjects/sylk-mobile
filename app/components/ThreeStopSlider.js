import React from 'react';
import PropTypes from 'prop-types';
import { View, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';

// Reusable 3-stop "slider" widget. Visual + interaction mirror
// PrivacyRadiusSlider exactly (same dot styling, same selected-state
// growth, same connecting track) but the stops are passed in by the
// caller, so this component can be used wherever a small fixed-choice
// preference needs surfacing — currently the Location section in
// PreferencesModal exposes the heartbeat cadence and the meet-up
// proximity threshold this way.
//
// Each entry in `stops` is `{value, label}`:
//   value  — the underlying value the preference stores (number, in
//            our current uses; could be string)
//   label  — the user-facing caption that sits below the marker
//
// Props:
//   stops    — array of exactly 3 entries (the visual layout assumes
//              left / centre / right stops; passing more or fewer would
//              still render but the spacing wouldn't read cleanly).
//   value    — currently selected stop's `value`. Falls through to the
//              "no selection" visual if it doesn't match any stop.
//   onChange — (value) => void called when a marker is tapped.
//   title    — caption rendered above the track. Optional.
const ThreeStopSlider = ({stops, value, onChange, title}) => {
    return (
        <View style={{marginTop: 8, marginBottom: 2}}>
            {title ? (
                <Text style={{fontSize: 12, opacity: 0.75, marginBottom: 4, paddingHorizontal: 4}}>
                    {title}
                </Text>
            ) : null}
            {/* Track + markers row. The connecting line is rendered
                first as an absolutely-positioned bar behind the
                markers; left/right insets match the marker hit-area
                width (32 px / 2 = 16 px) plus the row's 8 px padding,
                so the track stops cleanly under the outer markers. */}
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 8,
                position: 'relative',
                height: 32,
            }}>
                <View style={{
                    position: 'absolute',
                    left: 24,
                    right: 24,
                    top: 15,
                    height: 2,
                    backgroundColor: '#bbb',
                }}/>
                {stops.map((stop) => {
                    const selected = value === stop.value;
                    return (
                        <TouchableOpacity
                            key={String(stop.value)}
                            onPress={() => onChange && onChange(stop.value)}
                            style={{
                                width: 32,
                                height: 32,
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                            accessibilityRole="radio"
                            accessibilityState={{selected}}
                            accessibilityLabel={String(stop.label)}
                        >
                            <View style={{
                                width: selected ? 18 : 14,
                                height: selected ? 18 : 14,
                                borderRadius: 9,
                                borderWidth: 2,
                                borderColor: selected ? '#1976D2' : '#888',
                                backgroundColor: selected ? '#1976D2' : '#fff',
                            }}/>
                        </TouchableOpacity>
                    );
                })}
            </View>
            {/* Label row. Each label sits in a fixed-width centered
                cell so it lines up directly under its marker. Width 60
                instead of PrivacyRadiusSlider's 32 because Location
                preference labels ("30 sec", "1 min", "2 min") are
                wider than the original "Off" / "500 m" / "2 km" stops
                and would otherwise wrap mid-glyph. */}
            <View style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingHorizontal: 8,
            }}>
                {stops.map((stop) => {
                    const selected = value === stop.value;
                    return (
                        <Text
                            key={String(stop.value)}
                            style={{
                                width: 60,
                                marginLeft: -14,
                                marginRight: -14,
                                textAlign: 'center',
                                fontSize: 11,
                                opacity: selected ? 1 : 0.65,
                                fontWeight: selected ? '600' : 'normal',
                            }}
                            numberOfLines={1}
                        >
                            {stop.label}
                        </Text>
                    );
                })}
            </View>
        </View>
    );
};

ThreeStopSlider.propTypes = {
    stops: PropTypes.arrayOf(PropTypes.shape({
        value: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
        label: PropTypes.string.isRequired,
    })).isRequired,
    value:    PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    onChange: PropTypes.func,
    title:    PropTypes.string,
};

export default ThreeStopSlider;
