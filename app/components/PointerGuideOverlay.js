import React from 'react';
import { View, Animated, Easing, Dimensions } from 'react-native';
import utils from '../utils';

/**
 * In-app remote-pointer marker.
 *
 * On iOS an app cannot draw over other apps (no SYSTEM_ALERT_WINDOW equivalent),
 * so the whole-device native overlay used on Android is impossible. This renders
 * the guide marker INSIDE our own app window instead — useful when the person
 * being helped is being guided through the Sylk app itself while screen sharing.
 *
 * Position is derived from Dimensions.get('window'), NOT an onLayout measurement:
 * on iOS the Paper Portal host did not always give a child a measurable (non-zero)
 * layout, so the old math parked the marker off-screen at (0,0).
 */
export default class PointerGuideOverlay extends React.Component {
    constructor(props) {
        super(props);
        this.state = { visible: false, x: 0, y: 0, win: Dimensions.get('window') };
        this._pulse = new Animated.Value(0);
        this._opacity = new Animated.Value(0);
        this._anim = null;
        this._lastId = null;
        this._dimSub = null;
    }

    componentDidMount() {
        this._dimSub = Dimensions.addEventListener('change', ({ window }) => {
            if (window) this.setState({ win: window });
        });
        this._maybeShow();
    }

    componentDidUpdate() { this._maybeShow(); }

    componentWillUnmount() {
        if (this._anim) this._anim.stop();
        try { if (this._dimSub && this._dimSub.remove) this._dimSub.remove(); } catch (e) { /* RN < 0.65 */ }
    }

    _maybeShow() {
        const p = this.props.point;
        if (!p || p.id === this._lastId) return;
        this._lastId = p.id;
        try { utils.timestampedLog('[pointer] overlay pulse START id=', p.id, 'at', p.x, p.y); } catch (e) {}

        this.setState({ visible: true, x: p.x, y: p.y, win: Dimensions.get('window') });
        this._opacity.setValue(1);
        this._pulse.setValue(0);
        if (this._anim) this._anim.stop();

        // Exactly TWO discrete pulses via an explicit sequence — each ramps the
        // shared driver 0->1 (ring grows + fades) then snaps back to 0.
        const PULSE_MS = 380;
        const onePulse = () => Animated.sequence([
            Animated.timing(this._pulse, {
                toValue: 1, duration: PULSE_MS,
                easing: Easing.out(Easing.quad), useNativeDriver: true
            }),
            Animated.timing(this._pulse, {
                toValue: 0, duration: 0, useNativeDriver: true
            }),
        ]);
        this._anim = Animated.sequence([ onePulse(), onePulse() ]);
        this._anim.start(({ finished }) => {
            if (!finished) return;   // superseded by a newer click
            Animated.timing(this._opacity, {
                toValue: 0, duration: 200, useNativeDriver: true
            }).start(() => {
                this.setState({ visible: false });
                if (this.props.onDone) this.props.onDone();
            });
        });
    }

    render() {
        if (!this.state.visible) return null;

        const W = (this.state.win && this.state.win.width) || 0;
        const H = (this.state.win && this.state.win.height) || 0;
        const px = this.state.x * W;
        const py = this.state.y * H;
        const base = 26;
        const scale = this._pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.3] });
        const ringOpacity = this._pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] });

        return (
            <View
                pointerEvents="none"
                style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, zIndex: 9999, elevation: 9999 }}
            >
                <Animated.View
                    style={{
                        position: 'absolute',
                        left: px - base,
                        top: py - base,
                        width: base * 2,
                        height: base * 2,
                        opacity: this._opacity,
                    }}
                >
                    <Animated.View
                        style={{
                            position: 'absolute',
                            left: 0, top: 0,
                            width: base * 2, height: base * 2,
                            borderRadius: base,
                            borderWidth: 3,
                            borderColor: '#2196F3',
                            opacity: ringOpacity,
                            transform: [{ scale }],
                        }}
                    />
                    <View
                        style={{
                            position: 'absolute',
                            left: base - 9, top: base - 9,
                            width: 18, height: 18, borderRadius: 9,
                            backgroundColor: 'rgba(33,150,243,0.92)',
                        }}
                    />
                </Animated.View>
            </View>
        );
    }
}
