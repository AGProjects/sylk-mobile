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
    flex: 1,
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

  chatLeftActionsContainer: {
    width: 40,
    height: 44, // match InputToolbar height
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 0,
    borderColor: 'green',
  },

  chatRightActionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 0,
    borderColor: 'red',
    marginRight: 10,
  },

  chatActionContainer: {
    marginRight: 30,
    borderWidth: 0,
    borderColor: 'blue',
    transform: [{ rotateY: '180deg' }]
  },

  chatAudioIcon: {
    paddingHorizontal: 8,
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

	inputToolbar: {
	  flexDirection: 'row',        // children arranged horizontally
	  alignItems: 'center',        // vertically center everything
	  paddingVertical: 2,          // adjust as needed
	  paddingHorizontal: 8,
	  backgroundColor: '#fff',
	  borderTopWidth: 1,
	  borderTopColor: '#ddd',
	},

  chatSendArrow: {
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

  bubbleContainer: {bordeWidth: 2, borderColor: 'blue'},

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
  audioLabel: {
    marginLeft: 0,
    marginTop: 10,
    alignSelf: 'center',
    fontSize: 14,
    color: 'white', // <-- change this to any color you want
  },

	closeReplyButton: {
	  padding: 8, // increases the touchable area
	  justifyContent: 'center',
	  alignItems: 'center',
	},
	
	closeButtonCircle: {
	  width: 22,
	  height: 22,
	  borderRadius: 12,          // perfect circle
	  backgroundColor: '#e0e0e0',
	  justifyContent: 'center',
	  alignItems: 'center',
	},
	
	closeButtonText: {
	  fontSize: 16,               // slightly bigger for visibility
	  fontWeight: 'bold',
	  color: '#333',
	},

  replyUser: { fontWeight: 'bold', marginRight: 6 },
  replyText: { flex: 1, color: '#555' },
  closeReplyButton: { marginLeft: 8 },
  chatImage: {},

replyPreviewContainerIncoming: {
  flexDirection: 'row',
  alignItems: 'flex-start',
  backgroundColor: 'rgba(255,255,255,0.2)',
  paddingHorizontal: 6,
  paddingVertical: 2,
  borderLeftWidth: 3,
  borderLeftColor: '#4CAF50',
  borderRadius: 4,
  marginTop: 10,
  marginBottom: 2,
  maxWidth: '80%',      // limit width
  alignSelf: 'flex-start',  // left aligned
},

replyPreviewContainerOutgoing: {
  flexDirection: 'row',
  alignItems: 'flex-start',
  backgroundColor: 'rgba(255,255,255,0.2)',
  paddingHorizontal: 6,
  paddingVertical: 2,
  paddingLeft: 2,
  borderLeftWidth: 3,
  borderLeftColor: '#4CAF50',
  borderRadius: 4,
  marginTop: 10,
  marginBottom: 2,
  maxWidth: '80%',      // limit width
  alignSelf: 'flex-end',  // right aligned
},

  replyLine: {
    width: 3,
    marginRight: 6,
    backgroundColor: '#4CAF50',
    borderRadius: 2,
  },
  replyPreviewText: {
    fontSize: 12,
    color: '#fff',
  },
  
});

export default styles;

