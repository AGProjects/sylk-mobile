import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
  },

  recordingContainer: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
  },

  activityTitle: {
    paddingTop: 25,
    fontSize: 25,
    color: 'white',
    textAlign: 'center',
  },

  subtitle: {
    paddingTop: 25,
    fontSize: 18,
    color: 'white',
    textAlign: 'center',
  },

  historyLandscapeContainer: {
    marginTop: 0,
    width: '100%',
    flex: 9,
  },

  historyPortraitContainer: {
    width: '100%',
    flex: 9,
  },

  landscapeTitle: {
    color: 'white',
    fontSize: 20,
    width: '90%',
    marginLeft: '5%',
  },

  portraitTitle: {
    color: 'white',
    fontSize: 20,
    width: '90%',
    marginTop: 10,
    marginLeft: '5%',
  },

  landscapeTabletTitle: {
    marginTop: 20,
    color: 'white',
    fontSize: 24,
    width: '100%',
    marginLeft: 3,
  },

  portraitTabletTitle: {
    marginTop: 20,
    color: 'white',
    fontSize: 20,
    width: '100%',
    marginLeft: 10,
  },

  portraitUriButtonGroup: {
    flexDirection: 'column',
    width: '100%',
    marginLeft: '0%',
  },

  landscapeUriButtonGroup: {
    flexDirection: 'row',
    width: '100%',
    marginLeft: 2,
    justifyContent: 'space-between',
  },

  portraitTabletUriButtonGroup: {
    flexDirection: 'column',
    marginLeft: '20%',
    marginRight: '20%',
    marginTop: 10,
    marginBottom: 10,
    justifyContent: 'space-between',
  },

  landscapeTabletUriButtonGroup: {
    flexDirection: 'row',
    width: '100%',
    marginLeft: '0%',
    justifyContent: 'space-between',
  },

  portraitUriInputBox: {
    textAlign: 'left',
    width: '100%',
  },

  landscapeUriInputBox: {
    textAlign: 'left',
    flex: 1,
    padding: 0,
    marginTop: 4,
  },

  landscapeTabletUriInputBox: {
    textAlign: 'left',
    paddingTop: 10,
    paddingBottom: 10,
    width: '66%',
    marginLeft: 1,
  },

  landscapeButtonGroup: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    padding: 15,
  },

  portraitTabletUriInputBox: {
    textAlign: 'left',
    paddingTop: 10,
    width: '100%',
  },

  uriInputBox: {
    textAlign: 'left',
    paddingTop: 10,
    width: '100%',
  },

  buttonGroup: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: 10,
    paddingBottom: 10,
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

  greenButton: {
    backgroundColor: 'rgba(109, 170, 99, 0.9)', // #6DAA63 + 0.9
  },

  disabledGreenButton: {
    backgroundColor: 'rgba(57, 89, 54, 0.5)',
  },

  blueButton: {
    backgroundColor: 'rgba(69, 114, 166, 1)',
  },

  redButton: {
    backgroundColor: 'orange',
  },

  disabledBlueButton: {
    backgroundColor: 'rgba(46, 76, 111, 0.5)',
  },

  greenButtoniOS: {
    backgroundColor: 'rgba(109, 170, 99, 0.9)',
  },

  disabledGreenButtoniOS: {
    backgroundColor: 'rgba(57, 89, 54, 0.9)',
  },

  blueButtoniOS: {
    backgroundColor: 'rgba(69, 114, 166, 1)',
  },

  redButtoniOS: {
    backgroundColor: 'red',
  },

  disabledBlueButtoniOS: {
    backgroundColor: 'rgba(46, 76, 111, 1)',
  },

  footer: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 0,
  },

  backButton: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'red',
    color: 'white',
    borderRadius: 5,
    borderWidth: 1,
  },

  navigationContainer: {},

  navigationButtonGroup: {
    justifyContent: 'center',
    borderWidth: 0,
  },

  navigationButton: {},

  navigationButtonSelected: {
    backgroundColor: 'white',
  },

  qrCodeButton: {
    paddingTop: 0,
    backgroundColor: 'white',
  },
});

export default styles;

