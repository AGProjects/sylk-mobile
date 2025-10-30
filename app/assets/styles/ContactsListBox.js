import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  portraitContainer: {
    flex: 1,
    flexDirection: 'column',
  },
  lock: {
    marginLeft: 3,
    marginTop: 2,
  },
  contactsPortraitContainer: {
    flex: 1,
    flexDirection: 'column',
  },
  chatPortraitContainer: {
    flex: 6,
    marginTop: 15,
  },
  landscapeContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  contactsLandscapeContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  chatLandscapeContainer: {
    flex: 1,
  },
  chatBorder: {
    borderWidth: 0,
    borderColor: 'gray',
    margin: 1,
    borderRadius: 5,
  },
  backgroundVideo: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
  },
  chatSendContainer: {
    flexDirection: 'row',
  },
  photoMenuContainer: {
    flexDirection: 'row',
  },
  photoMenu: {},
  videoMenu: {
    color: 'white',
  },
  photoMenuText: {
    paddingTop: 5,
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
  chatAudioIcon: {
    marginBottom: 10,
  },
  chatLeftActionsContainer: {
    marginBottom: 5,
    width: 40,
    marginLeft: 10,
    borderWidth: 0,
  },
  chatLeftActionsContaineriOS: {
    marginBottom: 0,
    width: 40,
    marginLeft: 10,
    borderWidth: 0,
  },
  chatSendArrow: {
    marginBottom: 10,
    marginRight: 10,
    borderWidth: 0,
  },
  chatIconText: {
    color: '#b2b2b2',
    fontWeight: 'bold',
    fontSize: 15,
    backgroundColor: 'transparent',
    textAlign: 'center',
  },
  actionSheetText: {
    width: '100%',
  },
  messageText: {
    fontWeight: 'normal',
  },
  messageTextContainer: {},
  bubbleContainer: {},
  videoContainer: {
    width: '100%',
  },
  audioContainer: {
    marginTop: 10,
    width: '100%',
  },
  audioLabel: {
    color: '#FF0000',
  },
  videoPlayer: {},
  audioPlayer: {},
  roundshape: {
    height: 48,
    width: 48,
    justifyContent: 'center',
    borderRadius: 24,
  },
  playAudioButton: {
    backgroundColor: 'rgba(69, 114, 166, 1)',
  },
  chatImage: {},
});

export default styles;

