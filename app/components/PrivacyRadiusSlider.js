import React from 'react';
import PropTypes from 'prop-types';
import { View, TouchableOpacity } from 'react-native';
import { Text } from 'react-native-paper';

// Five-stop "slider" used by ShareLocationModal (sender) and
// MeetingRequestModal (receiver) to let either party pick how big a
// privacy radius around their starting GPS fix should be hidden from
// the peer. Off / 500 m / 2 km / 4 km / 8 km — discrete stops chosen
// by tap. The wider stops accommodate longer-distance meetups (cross-
// town drives, intercity trains) where 2 km of starting-area
// obfuscation isn't enough to feel meaningfully private.
//
// The widget is a flat horizontal track with circles connected by a
// line. Selected marker grows from 14 → 18 px and fills with the
// brand blue; the corresponding label below bolds and fully opaques.
// No external dependency: pure View + TouchableOpacity.
//
// Props:
//   value     — currently selected radius in metres
//               (0 / 500 / 2000 / 4000 / 8000)
//   onChange  — (meters: number) => void, called when a marker is tapped
//   title     — caption rendered above the track. Optional.
const PRIVACY_RADIUS_STOPS = [
    {value: 0,    label: 'Off'},
    {value: 500,  label: '500 m'},
    {value: 2000, label: '2 km'},
    {value: 4000, label: '4 km'},
    {value: 8000, label: '8 km'},
];

// textColor / markerFillColor (optional): let a themed caller
// (PreferencesModal on a dark surface) flip the caption + label text
// colour and the unselected-marker fill so nothing paints dark-on-dark.
// Omitted by the white ShareLocation / MeetingRequest modals, which keep
// the original Paper-default dark text and white marker fill.
const PrivacyRadiusSlider = ({value, onChange, title, textColor, markerFillColor = '#fff'}) => {
    return (
        <View style={{
            marginTop: 8,
            marginBottom: 2,
            // Cap the width and centre it so the five stops sit close
            // together instead of spreading edge-to-edge across the full
            // modal (space-between stretches the gaps to whatever width is
            // available). The track + label rows inherit this width, so
            // markers and their labels stay aligned.
            alignSelf: 'center',
            width: '100%',
            maxWidth: 280,
        }}>
            {title ? (
                // Centered, single-line caption. numberOfLines={1} +
                // adjustsFontSizeToFit keep it on one line — the font
                // shrinks slightly on narrow viewports rather than
                // wrapping to a second line and pushing the track down.
                <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    style={{
                        fontSize: 12,
                        opacity: 0.75,
                        marginBottom: 4,
                        paddingHorizontal: 4,
                        textAlign: 'center',
                        color: textColor,
                    }}
                >
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
                {PRIVACY_RADIUS_STOPS.map((stop) => {
                    const selected = value === stop.value;
                    return (
                        <TouchableOpacity
                            key={stop.value}
                            onPress={() => onChange && onChange(stop.value)}
                            // Generous hit area so the small circles
                            // aren't fiddly to tap.
                            style={{
                                width: 32,
                                height: 32,
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                            accessibilityRole="radio"
                            accessibilityState={{selected}}
                            accessibilityLabel={`Privacy radius ${stop.label}`}
                        >
                            <View style={{
                                width: selected ? 18 : 14,
                                height: selected ? 18 : 14,
                                borderRadius: 9,
                                borderWidth: 2,
                                borderColor: selected ? '#1976D2' : '#888',
                                backgroundColor: selected ? '#1976D2' : markerFillColor,
                            }}/>
                        </TouchableOpacity>
                    );
                })}
            </View>
            {/* Label row. Each label sits in a fixed-width centered
                cell so it lines up directly under its marker. */}
            <View style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingHorizontal: 8,
            }}>
                {PRIVACY_RADIUS_STOPS.map((stop) => {
                    const selected = value === stop.value;
                    return (
                        <Text
                            key={stop.value}
                            style={{
                                width: 32,
                                textAlign: 'center',
                                fontSize: 11,
                                opacity: selected ? 1 : 0.65,
                                fontWeight: selected ? '600' : 'normal',
                                color: textColor,
                            }}
                        >
                            {stop.label}
                        </Text>
                    );
                })}
            </View>
        </View>
    );
};

PrivacyRadiusSlider.propTypes = {
    value:    PropTypes.number,
    onChange: PropTypes.func,
    title:    PropTypes.string,
    textColor: PropTypes.string,
    markerFillColor: PropTypes.string,
};

PrivacyRadiusSlider.STOPS = PRIVACY_RADIUS_STOPS;

export default PrivacyRadiusSlider;
