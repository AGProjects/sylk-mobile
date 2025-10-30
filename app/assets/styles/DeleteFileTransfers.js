import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  container: {
    padding: 10,
    margin: 0,
  },

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

  title: {
    padding: 0,
    fontSize: 24,
    textAlign: 'center',
  },

  body: {
    padding: 10,
    fontSize: 16,
    textAlign: 'center',
  },


  button: {
    margin: 10,
  },

  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },

  checkBoxGroupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },

  checkBoxRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginBottom: 5,
  },

  checkButton: {
    margin: 10,
    width: 70,
  },

  titleContainer: {
    flexDirection: 'row',
  },
});

export default styles;

