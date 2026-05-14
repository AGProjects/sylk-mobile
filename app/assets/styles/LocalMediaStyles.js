import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    height: '100%',
    width: '100%',
  },

  video: {},

  title: {
    paddingBottom: 30,
    fontSize: 34,
    textAlign: 'center',
    color: 'white',
  },

  subtitle: {
    paddingTop: 20,
    fontSize: 18,
    textAlign: 'center',
    color: 'white',
  },

  description: {
    padding: 12,
    fontSize: 16,
    textAlign: 'center',
    color: 'white',
  },

  savebutton: {
    margin: 10,
    width: 150,
  },

  backbutton: {
    margin: 10,
    width: 150,
  },

  hangupbutton: {
    backgroundColor: 'rgba(169, 68, 66, 0.8)', // converted rgba(#a94442, .8)
  },

  tabletButtonContainer: {
    position: 'absolute',
    // Was bottom: 100. LocalMedia.js adds the device's bottomInset
    // (home indicator / nav bar) on top of this value at render time
    // (see lines ~700 / ~724 in LocalMedia.js), so the effective lift
    // was ~100 + bottomInset and the user saw "like 200 px" of
    // empty space below the buttons. Match the phone-variant lift
    // (30dp) so tablet and phone read the same — the safe-area
    // inset on tablet is plenty to clear the home indicator on its
    // own without a fixed bump on top.
    bottom: 30,
    width: '90%',
    zIndex: 99,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
  },

  buttonContainer: {
    position: 'absolute',
    bottom: 30,
    width: '90%',
    zIndex: 99,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
  },

  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
});

export default styles;

