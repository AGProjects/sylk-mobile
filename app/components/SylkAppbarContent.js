import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';

const SylkAppbarContent = (props) => {
  const defaultTitleStyle = { color: 'white' };
  const defaultSubtitleStyle = { color: 'white' };

  // Diagnostic (disabled — re-enable to debug fold remount):
  // Log mount/unmount to verify the key-based remount cycle on
  // fold/rotate transitions. NavigationBar changes this component's
  // `key` on fold + window-dim change to force native re-measurement
  // under the new display density.
  // React.useEffect(() => {
  //   console.log('[FoldUI] SylkAppbarContent mount');
  //   return () => console.log('[FoldUI] SylkAppbarContent unmount');
  // }, []);

  return (
    <View style={{ flex: 1 }}>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[defaultTitleStyle, props.titleStyle]}
      >
        {props.title}
      </Text>

      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[defaultSubtitleStyle, props.subtitleStyle]}
      >
        {props.subtitle}
      </Text>
    </View>
  );
};


export default SylkAppbarContent;
