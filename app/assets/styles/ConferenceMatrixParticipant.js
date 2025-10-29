import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },

  portraitContainer: {
    flexBasis: '50%',
    height: '50%',
  },

  landscapeContainer: {
    flexBasis: '50%',
    width: '50%',
  },

  soloContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },

  videoContainer: {
    height: '100%',
    width: '100%',
  },

  video: {
    height: '100%',
    width: '100%',
  },

  controlsTop: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    flexDirection: 'row',
    maxHeight: 50,
    minHeight: 50,
    paddingLeft: 20,
  },

  badge: {
    backgroundColor: '#5cb85c',
    marginBottom: 10,
    fontSize: 14,
    fontWeight: '500',
  },

  controls: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
    display: 'flex',
    alignItems: 'flex-end',
    flexDirection: 'row',
    maxHeight: 114,
    minHeight: 114,
    paddingLeft: 20,
  },
  lead: {
    color: '#fff',
    marginBottom: 10,
  },
  status: {
    color: '#fff',
    fontSize: 8,
    marginBottom: 16,
    marginLeft: 5,
  },
});

export default styles;
