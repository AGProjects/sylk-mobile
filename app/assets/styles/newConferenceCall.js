import { StyleSheet } from 'react-native';
import Sessions from './Sessions'; // import shared styles

const styles = StyleSheet.create({
  ...Sessions, // include shared styles

  container: {
    flex: 1,
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

  conferenceContainer: {
    flex: 1,
    flexDirection: 'column',
    alignContent: 'flex-start',
    justifyContent: 'flex-start',
  },

  conferenceContainerLandscape: {
    flexDirection: 'row',
    alignContent: 'flex-end',
  },

  audioContainerPortrait: {
    height: 240, // 3 participants
    width: '100%',
  },
    
chatContainerPortraitAudio: {
    flex: 1,          // remaining 60%
    width: '100%',
    borderWidth: 1,
    borderColor: 'gray'
  },

// audio only landscape
  audioContainerLandscape: {
    alignContent: 'flex-start',
    marginTop: 90,
    marginLeft: 0,
    marginRight: 0,
    width: '50%',
  },

  chatContainerLandscapeAudio: {
    marginTop: 90,
    marginRight: 0,
    marginLeft: 0,
    borderRadius: 2,
    width: '50%',
    borderWidth: 1,
    borderColor: 'gray',
  },

  chatContainerLandscape: {
    marginBottom: 90,
    flex: 1,
  },

  chatContainerLandscape: {
    marginBottom: 90,
    width: 400
  },

  chatContainerPortrait: {
    flex: 1,
    borderWidth: 0,
    borderRadius: 5,
  },

  videosChatContainer: {
    flex: 0.6,
    flexWrap: 'wrap'
  },

  videosContainer: {
    flex: 1,
    flexWrap: 'wrap'
  },

  carouselContainer: {
    position: 'absolute',
    justifyContent: 'center',
    bottom: 30,
    left: 5,
    right: 5,
  },

  landscapeVideosContainer: {
    flexDirection: 'row',
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

  videoContainer: {
    width: '100%',
  },

  audioContainer: {
    width: '100%',
  },

  videoPlayer: {},

  audioPlayer: {},

  hangupButtonAudioContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginRight: 15,
    borderWidth: 0,
  },

  hangupButtonVideoContainer: {
    marginLeft: 25,
  },

  hangupButtonVideoContainerLandscape: {
    marginRight: 15,
  },

    buttonsContainer: {
        position: 'absolute',
        top: 95, // distance from bottom
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
    },

    buttonsContainerLandscape: {
        bottom: 30, // optional: slightly higher in landscape
    },
    

});

export default styles;
