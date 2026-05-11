import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  userIconContainer: {
    paddingTop: 20,
    alignSelf: 'center', // React Native doesn't support margin: 0 auto
  },

  statsContainer: {
    paddingTop: 0,
    alignSelf: 'center',
    width: '50%',
  },

  tabletUserIconContainer: {
    paddingTop: 60,
    alignSelf: 'center',
  },

  appbarContainer: {
    backgroundColor: 'rgba(34, 34, 34, 0.7)',
    zIndex: 1,
  },

  portraitButtonContainer: {
    flexDirection: 'row',
    marginTop: 'auto',
    marginBottom: 50,
    paddingLeft: 20,
    paddingRight: 20,
    justifyContent: 'center',
  },

  tabletPortraitButtonContainer: {
    flexDirection: 'row',
    marginTop: 'auto',
    bottom: 60,
    marginBottom: 40,
    justifyContent: 'center',
  },

  landscapeButtonContainer: {
    flexDirection: 'row',
    marginTop: 'auto',
    bottom: 30,
    marginBottom: 0,
    justifyContent: 'center',
  },

  tabletLandscapeButtonContainer: {
    flexDirection: 'row',
    marginTop: 'auto',
    bottom: 60,
    marginBottom: 0,
    justifyContent: 'center',
  },

  activity: {
    marginTop: 30,
  },

  buttonContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1,
    borderWidth: 0,
    // Cap each slot so buttons don't drift far apart on wide screens
    // (landscape phone, tablet). Audio has fewer buttons than video, so
    // the cap is a bit wider here to keep some breathing room between
    // them on narrow screens too.
    maxWidth: 72,
  },

  confirmContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1,
    borderWidth: 0,
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

  confirm: {
    fontSize: 20,
    textAlign: 'center',
    color: 'white',
    marginVertical: 20
  },

  greenButton: {
    backgroundColor: 'rgba(109, 170, 99, 0.9)', // #6DAA63 + 0.9
  },

  disabledGreenButton: {
    backgroundColor: 'rgba(57, 89, 54, 0.9)', // #395936 + 0.9
  },

  hangupButton: {
    backgroundColor: 'rgba(169, 68, 66, 0.8)', // #a94442 + 0.8
  },

  whiteButtoniOS: {
    paddingTop: 0,
    backgroundColor: 'white',
  },

  greenButtoniOS: {
    paddingTop: 0,
    backgroundColor: 'rgba(109, 170, 99, 0.9)',
  },

  disabledGreenButtoniOS: {
    paddingTop: 0,
    backgroundColor: 'rgba(57, 89, 54, 0.9)',
  },

  hangupButtoniOS: {
    paddingTop: 0,
    backgroundColor: 'rgba(169, 68, 66, 0.8)',
  },

  displayName: {
    paddingTop: 10,
    fontSize: 30,
    textAlign: 'center',
    color: 'white',
  },

  uri: {
    padding: 0,
    fontSize: 18,
    textAlign: 'center',
    color: 'white',
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

  // --- Folded (Razr cover display) layout -------------------------------
  // When folded we have very little vertical room, so split the top half
  // into two columns: caller identity on the left, traffic stats on the
  // right. Call buttons occupy the bottom strip, full width.
  foldedTopRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    marginTop: 36,
    paddingHorizontal: 8,
    height: 140,
  },

  foldedCallerColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingRight: 4,
  },

  foldedStatsColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingLeft: 4,
  },

  foldedDisplayName: {
    // Snug under the avatar without overlapping its bottom edge:
    // strip Paper's default Dialog.Title top padding (paddingTop:0)
    // but only nudge up a couple of pixels — a heavier negative
    // marginTop ate into the avatar circle.
    paddingTop: 0,
    marginTop: -2,
    // Paper's Dialog.Title defaults to paddingBottom:16 + marginBottom,
    // which leaves a big gap before the SIP URI on the cover display.
    // Zero them out so the URI sits right under the name.
    paddingBottom: 0,
    marginBottom: 0,
    fontSize: 18,
    textAlign: 'center',
    color: 'white',
  },

  foldedUri: {
    padding: 0,
    // Tuck the URI right under the display name — same logic as
    // foldedDisplayName above.
    marginTop: -4,
    fontSize: 12,
    textAlign: 'center',
    color: 'white',
  },

  // Bottom row directly under foldedTopRow: record pill (left) and
  // ZRTP badge (right) share one top edge. alignItems:flex-start
  // pins each child to the row's top so they read as a single line,
  // even though the pill and badge have slightly different heights.
  foldedBottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginTop: 56,
  },

  // Each half of foldedBottomRow centers its child horizontally so
  // the record pill lines up under the avatar column (foldedCaller-
  // Column above also uses alignItems:center) and the ZRTP badge
  // lines up under the stats column (foldedStatsColumn above —
  // same centered alignment). Matching paddings keep the two
  // columns equal-width so the centers stay aligned with the row
  // above.
  foldedBottomLeft: {
    flex: 1,
    alignItems: 'center',
    paddingRight: 4,
  },

  foldedBottomRight: {
    flex: 1,
    alignItems: 'center',
    paddingLeft: 4,
  },

  foldedButtonContainer: {
    flexDirection: 'row',
    // Pin to the bottom of the call view so buttons sit just above the
    // screen edge on the Razr cover display instead of floating somewhere
    // in the middle if the parent flex layout doesn't stretch all the way.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 6,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },

  // Per-button slot when folded. Default buttonContainer has
  // maxWidth 72 and flex:1 which over-spaces buttons on wide screens;
  // on the cover display we want fixed-width slots with a bit of
  // breathing room between them.
  foldedSlotContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 0,
    width: 48,
    marginHorizontal: 8,
  },

});

export default styles;
