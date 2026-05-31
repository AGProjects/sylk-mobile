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

  // Video-conference call bar. Pinned 50dp from the screen BOTTOM
  // (was top:95 from the matrix top — broke uniformity with the
  // audio / video call bars). All three call surfaces (Audio,
  // Video, Conference) now use bottom:50 in portrait so the bar
  // sits at the same height regardless of which call type.
  buttonsContainer: {
	position: 'absolute',
	bottom: 50,
	left: 0,
	right: 0,
	flexDirection: 'row',
	justifyContent: 'center',
	alignItems: 'center',
	zIndex: 1000
  },

  // Audio-conference call bar. Was bottom:-80 (pushed BELOW the
  // screen edge by 80 px) — broke uniformity with the other call
  // bars. Aligned to the same bottom:50 so audio-conf / video-conf
  // / audio-call / video-call all sit at the same vertical height.
  audioButtonsContainer: {
	position: 'absolute',
	bottom: 50,
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

  sipParticipantsGroup: {
    marginTop: 0,
    marginHorizontal: 0,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },

  audioViewActionBar: {
    // Absolutely-positioned at bottom:50 (matching the other call
    // bars: AudioCall.portraitButtonContainer marginBottom:50,
    // VideoCall.portraitbuttonsContainer marginBottom:50,
    // ConferenceCall.buttonsContainer bottom:50,
    // audioButtonsContainer bottom:50). The previous
    // marginTop:'auto'+marginBottom:50 approach relied on the flex
    // parent extending to the screen bottom — when the parent had
    // any safe-area / status padding above us, the bar ended up
    // visibly higher than the other call bars. Pinning to absolute
    // bottom guarantees the same 50dp gap from the screen edge.
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 20,
    // zIndex + elevation so the bar stays on top of the
    // participants ScrollView and any other normal-flow sibling.
    // Without elevation on Android, the conference navbar's
    // elevation:10 (added so its tap-region wins over the chat
    // container) outranked this bar in the native view hierarchy
    // and the participants column's touch handlers wrapped around
    // the bottom buttons, making them feel dead.
    zIndex: 1000,
    elevation: 11,
  },

  audioViewActionBarAudioGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    // Tightened: the audio device picker is the leftmost child of
    // this group. User reported the gap between the chat-toggle
    // (left neighbour) and the audio device button was too big.
    // Dropping marginRight from 24 → 8 and adding marginLeft: 0
    // pulls the group toward its left neighbour.
    marginLeft: 0,
    marginRight: 8,
  },

  audioListTopActionBar: {
    // Three-button row rendered ABOVE the participant list in the
    // audio view (raise hand / mute all / add participant). Spans
    // the full width so each button gets an equal flex:1 slot via
    // audioListTopActionBarButton below — same rhythm as the bottom
    // action bar so the two rows feel like a matched pair.
    // marginBottom: 10 separates the bar from the first participant
    // tile so the buttons don't visually crowd the list header.
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 4,
    marginBottom: 10,
  },

  audioListTopActionBarButton: {
    // Equal-width slot per top-bar button. Cap raised from 72 → 110
    // so the "Mute all" text pill fits without truncation; the two
    // adjacent round icon buttons sit centered in the same 110-wide
    // slot. Equal slots mean equal gaps between the three controls.
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1,
    borderWidth: 0,
    maxWidth: 110,
  },

  audioListTopActionBarTextSlot: {
    // No override — kept as a named hook in case the text slot ever
    // needs to diverge from the icon slots. All three slots use the
    // same maxWidth via audioListTopActionBarButton so the buttons
    // are evenly spaced across the row.
  },

  audioListTopActionBarTextButton: {
    // Pill button matching the visual height of the round icon
    // buttons next to it (48 ÷ ~50 px). Background mirrors the
    // semi-transparent white the icon buttons use (whiteButton in
    // Sessions.js) so the row reads as a cohesive cluster.
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(249, 249, 249, 0.7)',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },

  audioListTopActionBarTextLabel: {
    color: '#222',
    fontSize: 14,
    fontWeight: '600',
  },

  // Small "All" badge overlaid on the bottom-right corner of the
  // Mute all icon button. Mirrors the avatarSipBadge style so the
  // "modifier" idea (this action applies to ALL, like the avatar SIP
  // chip tells you THIS tile is a SIP caller) reads consistently
  // across the UI. pointerEvents:none in the JSX so taps still
  // reach the underlying button.
  muteAllBadge: {
    position: 'absolute',
    bottom: -2,
    // Anchored to the bottom-LEFT corner so the "All" tag mirrors
    // the SIP avatar badge placement (which sits on the bottom-left
    // of the avatar circle). Visual symmetry between "this affects
    // all participants" and "this tile is a SIP participant".
    left: -4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    zIndex: 10,
  },

  muteAllBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  chatBackToAudioRow: {
    // One-button row rendered ABOVE the chat when the user has
    // switched into the audio-view chat (state.audioChatView=true).
    // The full bottom action bar is suppressed in that view so the
    // soft keyboard doesn't share space with four call controls; this
    // single round button gives the user a one-tap path back to the
    // participants screen. Centered horizontally, small vertical
    // padding so it doesn't crowd the chat input below.
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 4,
    marginTop: 4,
    marginBottom: 4,
  },

  audioViewActionBarButton: {
    // Equal-width slot per button — matches AudioCall.buttonContainer
    // so the chat/audio-picker/mute/hangup buttons share the same
    // horizontal rhythm as the regular AudioCallBox portrait button
    // row. flex:1 spreads the four slots across the bar's content
    // width, maxWidth caps each slot so they don't drift apart on
    // wide screens (landscape phone, tablet).
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1,
    borderWidth: 0,
    maxWidth: 72,
  },

  inviteFooterButton: {
    marginHorizontal: 4,
  },

  invitedParticipantsGroup: {
    marginTop: 0,
    marginHorizontal: 0,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },

  mediaContainerHidden: {
    display: 'none',
  },

  participantsScroll: {
    flexShrink: 1,
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
    borderColor: 'white',
    borderWidth: 0,
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
    backgroundColor: '#E53935',
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
    // The audio-view action bar is center-justified
    // (audioViewActionBar.justifyContent === 'center'), so the three
    // groups (chat toggle, audio group, hangup) sit clustered in the
    // middle. Adding marginLeft pushes the hangup button right of the
    // audio group; reducing marginRight lets it travel further toward
    // the right edge of the bar. Net effect requested by user: shift
    // the destructive hangup button further from the benign audio
    // controls so a stray tap is less likely to end the call.
    marginLeft: 28,
    marginRight: 4,
    borderWidth: 0,
  },

  buttonContainer: {
    // Horizontal spacing between call-button cells in the conference
    // action bar. 5 dp = 10 dp combined gap between adjacent buttons,
    // matching the landscape navbar wrapper's `marginLeft: 10` in
    // ConferenceHeader so portrait and landscape video bars have
    // the same rhythm.
    margin: 5,
  },

  // Small dark circle for the per-participant close-X kick affordance.
  // Walked down: 22 → 18 → 14 px outer box, hugging an 11 px Icon
  // (~1-2 px padding on each side now). Semi-transparent black
  // backplate so the chip reads against any tile background; thin
  // white border defines the edge against dark backgrounds.
  // justifyContent / alignItems center the Icon glyph inside the
  // circle.
  kickCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },


  hangupButtonVideoContainer: {
    marginLeft: 20,
  },

  hangupButtonVideoContainerLandscape: {
    marginRight: 20,
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
    backgroundColor: '#25D366',
    borderColor: 'green',
  },

  audioDeviceWhiteButton: {
    backgroundColor: '#fff',
  },


});

export default styles;
