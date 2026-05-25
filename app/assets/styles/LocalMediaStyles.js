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

  // Hangup button colour now matches every other hang-up button in
  // the app — WhatsApp-style Material Red 600, fully opaque. See the
  // same swap in AudioCall.js / Sessions.js / ConferenceCall.js etc.
  hangupbutton: {
    backgroundColor: '#E53935',
  },

  tabletButtonContainer: {
    position: 'absolute',
    // Bumped 30 → 50 so the local-media button strip sits at the
    // same vertical position as the in-call button strip
    // (portraitButtonContainer.marginBottom = 50 in AudioCall.js).
    // The user wanted the pre-call and in-call button bars to line
    // up at the same height across screens.
    bottom: 50,
    width: '90%',
    zIndex: 99,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
  },

  buttonContainer: {
    position: 'absolute',
    bottom: 50,
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

