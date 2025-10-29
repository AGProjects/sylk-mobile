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
    justifyContent: 'flex-end', // replaces justify-self
  },

  tabletPortraitButtonContainer: {
    flexDirection: 'row',
    marginTop: 'auto',
    bottom: 60,
    marginBottom: 40,
    justifyContent: 'flex-end',
  },

  landscapeButtonContainer: {
    flexDirection: 'row',
    marginTop: 'auto',
    bottom: 10,
    marginBottom: 0,
    justifyContent: 'flex-end',
  },

  tabletLandscapeButtonContainer: {
    flexDirection: 'row',
    marginTop: 'auto',
    bottom: 60,
    marginBottom: 0,
    justifyContent: 'flex-end',
  },

  activity: {
    marginTop: 30,
  },

  buttonContainer: {
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
});

export default styles;
