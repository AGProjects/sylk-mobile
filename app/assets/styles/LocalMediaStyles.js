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
    bottom: 60,
    width: '100%',
    zIndex: 99,
    justifyContent: 'center',
    alignItems: 'center',
  },

  buttonContainer: {
    position: 'absolute',
    bottom: 60,
    width: '100%',
    zIndex: 99,
    justifyContent: 'center',
    alignItems: 'center',
  },

  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
});

export default styles;

