import { StyleSheet } from 'react-native';

const containerStyles = StyleSheet.create({
    modal: {
        backgroundColor: 'white',
        borderRadius: 8,
        padding: 16,
    },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', 
    padding: 16 
  },

  modalSurface: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 5,
  },

  scrollContainer: {
    marginTop: 20,
    marginBottom: 10,
	  maxHeight: 200,

    zIndex: -1,
  },

  title: {
    padding: 14,
    fontSize: 24,
    textAlign: 'center',
  },

  note: {
    margin: 10,
    textAlign: 'center',
  },

  tabletButtonContainer: {
    position: 'absolute',
    bottom: 60,
    width: '100%',
    zIndex: 99,
    justifyContent: 'center',
    alignItems: 'center',
  },

  buttonContainer: {
    position: 'absolute',
    bottom: 60,
    width: '100%',
    zIndex: 99,
    justifyContent: 'center',
    alignItems: 'center',
  },

});

export default containerStyles;
