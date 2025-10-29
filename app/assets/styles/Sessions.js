// Sessions.js
import { StyleSheet } from 'react-native';
const Sessions = StyleSheet.create({
  roundshape: {
    height: 48,
    width: 48,
    justifyContent: 'center',
    borderRadius: 24,
  },

  button: {
    backgroundColor: 'rgba(249, 249, 249, 0.7)',
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
    backgroundColor: 'rgba(169, 68, 66, 0.5)',
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
});

export default Sessions;
