import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  avatarContent: {
    marginRight: 10,
  },

  gravatar: {
    width: 50,
    height: 50,
    borderWidth: 0,
    borderColor: 'white',
    borderRadius: 50,
  },
  
  titleContainer: {},

  title: {
    fontSize: 16,
  },

  subtitle: {
    color: 'white',
    fontSize: 12,
    marginRight: 10,
  },

  tabletSubtitle: {
    color: 'white',
    fontSize: 16,
    marginRight: 10,
  },

  menuItem: {
    fontSize: 12,
  },

  tabletTitle: {
    fontSize: 24,
  },

  logo: {
    marginLeft: 15,
    marginRight: 15,
    height: 35,
    width: 35,
  },

  menuContentStyle: {
    fontSize: 10,
  },

  roundshape: {
    height: 24,
    width: 24,
    justifyContent: 'center',
    borderRadius: 12,
  },

  backButton: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'red',
    color: 'white',
    marginRight: 20,
    borderRadius: 5,
    borderWidth: 1,
  },

  redButton: {
    backgroundColor: 'red',
  },

  greenButton: {
    backgroundColor: 'rgba(33, 171, 99, 0.9)', // #21AB63 + 0.9
  },

  whiteButton: {
    backgroundColor: 'white',
  },

  orangeButton: {
    backgroundColor: 'orange',
  },

  blueButton: {
    backgroundColor: 'blue',
  },
});

export default styles;
