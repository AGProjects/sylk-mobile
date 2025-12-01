import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  remoteVideoContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },

  reconnectContainer: {
    marginTop: 150,
  },

  video: {
    width: '100%',
    height: '100%',
    // object-fit: cover → React Native: use resizeMode in <Video> component
  },

  buttonsContainer: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1,
    borderWidth: 0, // React Native uses borderWidth
	zIndex: 100,
  },

  portraitbuttonsContainer: {
    flexDirection: 'row',
    marginTop: 'auto',
    marginBottom: 50,
    paddingLeft: 20,
    paddingRight: 20,
    justifyContent: 'flex-end', // React Native uses justifyContent
  },

  landscapebuttonsContainer: {
    flexDirection: 'row',
    marginBottom: 0,
    justifyContent: 'center', // margin: auto not supported
  },

  tabletPortraitbuttonsContainer: {
    flexDirection: 'row',
    marginBottom: 40,
    bottom: 60,
    justifyContent: 'center',
  },

  tabletLandscapebuttonsContainer: {
    flexDirection: 'row',
    marginBottom: 0,
    bottom: 60,
    justifyContent: 'center',
  },

  roundshape: {
    height: 48,
    width: 48,
    justifyContent: 'center',
    borderRadius: 24,
  },

  whiteButton: {
    backgroundColor: 'white',
  },

  disabledWhiteButton: {
    backgroundColor: 'rgba(57, 89, 54, 0.9)', // #395936 + 0.9
  },

  greenButton: {
    backgroundColor: 'rgba(109, 170, 99, 0.9)', // #6DAA63 + 0.9
  },

  disabledGreenButton: {
    backgroundColor: 'rgba(57, 89, 54, 0.9)',
  },

  button: {
    backgroundColor: 'rgba(249, 249, 249, 0.7)', // #F9F9F9 + 0.7
    margin: 10,
    paddingTop: 5,
  },

  iosButton: {
    paddingTop: 0,
    backgroundColor: 'rgba(249, 249, 249, 0.7)',
    margin: 10,
  },

  androidButton: {
    paddingTop: 1,
    backgroundColor: 'rgba(249, 249, 249, 0.7)',
    margin: 10,
  },

  hangupButton: {
    marginLeft: 30,
    backgroundColor: 'rgba(169, 68, 66, 0.5)', // #a94442 + 0.5
  },

  audioDeviceContainer: {
    flexDirection: 'row',
    justifyContent: 'center',   // center horizontally
    alignItems: 'center',       // center vertically
    width: '100%',              // ensures proper centering
    marginTop: 10,
    marginBottom: 10,
    },
    
  audioDeviceButtonContainer: {
    margin: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    marginBottom: 60,
    borderColor: 'transparent',
    borderRadius: 10, // slightly larger than 24 so border is not clipped
    padding: 2,       // space so the border wraps around cleanly
  },

  audioDeviceSelected: {
    backgroundColor: 'rgba(109, 170, 99, 0.9)',
    borderColor: 'green',
  },

  audioDeviceWhiteButton: {
    backgroundColor: '#fff',
  },
  
});

export default styles;
