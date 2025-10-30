import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  containerPortrait: {},

  containerLandscape: {},

  cardPortraitContainer: {
    marginTop: 0.6,
    borderRadius: 0,
  },

  cardLandscapeContainer: {
    flex: 1,
    marginLeft: 1,
    marginTop: 1,
    borderRadius: 0,
  },

  cardLandscapeTabletContainer: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 0,
  },

  cardPortraitTabletContainer: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 0,
  },

  rowContent: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  cardContent: {
    flex: 1,
    flexDirection: 'row',
  },

  title: {
    fontSize: 16,
    lineHeight: 18,
    flex: 1,
  },

  titlePaddingSmall: {
    paddingTop: 0,
  },

  titlePadding: {
    paddingTop: 12,
  },

  titlePaddingSelect: {
    paddingTop: 25,
  },

  titlePaddingBig: {
    paddingTop: 14,
  },

  subtitle: {
    paddingTop: 4,
    fontSize: 16,
    lineHeight: 20,
    flex: 1,
  },

  description: {
    fontSize: 12,
    flex: 1,
  },

  avatarContent: {
    marginTop: 10,
  },

  gravatar: {
    width: 50,
    height: 50,
    borderWidth: 0,
    borderColor: 'white',
    borderRadius: 50,
  },

  smallGravatar: {
    width: 25,
    height: 25,
    borderWidth: 2,
    borderColor: 'white',
    borderRadius: 25,
  },

  mainContent: {
    marginLeft: 10,
  },

  rightContent: {
    marginTop: 10,
    marginLeft: 60,
    marginRight: 10,
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    borderWidth: 0,
  },

  selectBox: {
    marginTop: 10,
    marginLeft: 60,
    marginRight: 10,
    alignItems: 'flex-end',
    borderWidth: 0,
  },

  storageText: {
    fontSize: 12,
    color: '#777',
    marginTop: 4,
  },

  timestamp: {
    fontSize: 12,
    color: '#555',
    marginTop: -5,
  },

  unreadRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    height: 16,
    marginBottom: 4,
  },

  badgeContainer: {
    marginRight: 4,
    alignItems: 'center',
    minWidth: 20,
  },

  badgeTextStyle: {
    fontSize: 10,
  },

  selectedContact: {
    marginTop: 15,
  },

  participants: {
    marginTop: 10,
  },

  participant: {
    fontSize: 14,
  },

  buttonContainer: {
    marginTop: 'auto',
    marginHorizontal: 'auto',
  },

  button: {
    borderRadius: 0,
    paddingLeft: 30,
    paddingRight: 30,
  },

  greenButtonContainer: {
    paddingRight: 15,
  },

  recordingLabel: {
    marginTop: 7,
  },

  greenButton: {
    backgroundColor: 'rgba(109,170,99,0.8)',
    marginLeft: 0,
  },

  audioButton: {
    backgroundColor: 'white',
  },

  redButton: {
    backgroundColor: 'red',
  },

  callButtons: {
    flexDirection: 'row',
    marginTop: -1,
  },
});

export default styles;

