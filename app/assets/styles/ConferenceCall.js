import { StyleSheet } from 'react-native';
import Sessions from './Sessions'; // import shared styles

const styles = StyleSheet.create({
  ...Sessions, // include shared styles

  container: {
    flex: 1,
    flexDirection: 'column' 
  },

  myselfContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
  },

  conferenceHeader: {
    height: 90,  // adjust to your header's real height
    width: '100%',
  },

  buttonsContainer: {
	position: 'absolute',
	top: 95, // distance from bottom
	left: 0,
	right: 0,
	flexDirection: 'row',
	justifyContent: 'center',
	alignItems: 'center',
	zIndex: 1000
  },

  audioButtonsContainer: {
	position: 'absolute',
	bottom: -80, // distance from bottom
	left: 0,
	right: 0,
	flexDirection: 'row',
	justifyContent: 'center',
	alignItems: 'center',
	zIndex: 1000
  },

  conferenceContainer: {
    flex: 1,
    flexDirection: 'column',
    alignContent: 'flex-start',
    justifyContent: 'flex-start',
  },

  conferenceContainerLandscape: {
    flex: 1,
    flexDirection: 'row',
    alignContent: 'flex-end',
    height: '100%',
  },

  audioContainer: {
    height: 240, // 3 participants
    width: '100%',
  },

  audioContainerLandscape: {
    alignContent: 'flex-start',
    width: '50%',
    borderWidth: 1,
    borderColor: 'white'
  },
    
  chatContainer: {
	flex: 1,
	borderColor: 'gray',
	borderWidth: 1,
	borderRadius: 2,
	width: '100%',
  },
  
  chatContainerLandscape: {
	flex: 0,
	borderColor: 'gray',
	borderWidth: 1,
	borderRadius: 2,
	width: '50%',
  },

  chatContainerPortraitAudio: {
    flex: 1,          // remaining 60%
    width: '100%',
    borderWidth: 1,
    borderColor: 'gray'
  },

  chatContainerLandscapeAudio: {
    marginTop: 0,
    marginRight: 0,
    marginLeft: 0,
    borderRadius: 2,
    width: '50%',
    borderWidth: 1,
    borderColor: 'gray',
  },

  videoContainer: {
    flex: 1,
    flexWrap: 'wrap'
  },

  videoContainerLandscape: {
    width: '50%',
  },

  carouselContainer: {
    position: 'absolute',
    justifyContent: 'center',
    bottom: 30,
    left: 5,
    right: 5,
  },

  downloadContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },

  switch: {
    padding: 10,
  },

  uploadProgress: {
    fontSize: 14,
    color: 'orange',
  },

  button: {
    backgroundColor: 'white',
    margin: 8,
  },

  iosButton: {
    backgroundColor: 'white',
    margin: 8,
  },

  androidButton: {
    backgroundColor: 'white',
    margin: 8,
  },

  hangupButton: {
    backgroundColor: 'rgba(169, 68, 66, 0.8)',
    marginRight: 20
  },

  wholePageVideo: {
    width: '100%',
    height: '100%',
  },

  landscapeDrawer: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    flexDirection: 'row',
  },

  portraitDrawer: {
    width: 300,
  },

  chatSendContainer: {
    flexDirection: 'row',
  },

  chatRightActionsContainer: {
    marginBottom: 15,
    marginRight: 30,
    transform: [{ rotateY: '180deg' }],
    borderWidth: 0,
  },

  chatRightActionsContaineriOS: {
    marginBottom: 5,
    marginRight: 30,
    transform: [{ rotateY: '180deg' }],
    borderWidth: 0,
  },

  chatInsideRightActionsContainer: {
    marginBottom: 0,
    borderWidth: 0,
  },

  chatSendArrow: {
    marginBottom: 10,
    marginRight: 10,
    borderWidth: 0,
  },

  videoPlayer: {},

  audioPlayer: {},

  hangupButtonAudioContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginRight: 15,
    borderWidth: 0,
  },

  buttonContainer: {
    margin: 3,
  },

  hangupButtonVideoContainer: {
    marginLeft: 15,
  },

  hangupButtonVideoContainerLandscape: {
    marginRight: 15,
  },

    buttonsContainerLandscape: {
        bottom: 30, // optional: slightly higher in landscape
    },

  videoGridContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
  },

  fullScreen: {
    flexDirection: 'column',
    flexWrap: 'nowrap',
  },

  fullItem: {
    width: '100%',
    height: '100%',
  },

  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },

  twoPerRow: {
    width: '50%',
    height: '50%',
  },
      
  audioDeviceContainer: {
    flexDirection: 'row',
    justifyContent: 'center',   // center horizontally
    alignItems: 'center',       // center vertically
    width: '100%',              // ensures proper centering
    },
    
  audioDeviceButtonContainer: {
    margin: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
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
