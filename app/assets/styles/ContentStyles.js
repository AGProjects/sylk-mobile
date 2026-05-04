import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  title: {
    padding: 14,
    fontSize: 24,
    textAlign: 'center',
  },

  subtitle: {
    padding: 4,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 10,
  },

  body: {
    padding: 5,
    fontSize: 14,
    textAlign: 'center',
  },

  small: {
    padding: 5,
    fontSize: 12,
  },

  lock: {
    marginTop: 3,
    marginRight: 3,
  },

  link: {
    padding: 5,
    fontSize: 14,
    textAlign: 'center',
    color: 'blue',
  },

  iconContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },

  button: {
    margin: 10,
	borderRadius: 12,
  },

  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    padding: 5,
  },

  checkBoxRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    // Real horizontal spacing between the control (Checkbox / Switch)
    // and its label. Previously the layout relied on a single leading
    // space inside the <Text> for a visible gap, which was fine when
    // UISwitch was narrow. iOS 26's UISwitch is noticeably wider and
    // the single-space gap isn't enough — the switch's right edge
    // overlaps the first character of the label. `columnGap` is
    // honored on RN 0.71+ (we're on 0.73) and applies to every
    // adjacent pair of flex children in the row, so existing leading
    // spaces in label strings are still tolerated, just no longer
    // load-bearing.
    columnGap: 12,
  },

// Conference Modal
  chipsContainer: {
    marginTop: 20,
    marginBottom: 20,
  },

  chipTextStyle: {
    color: 'black',
  },

  chip: {
    borderWidth: 0.25,
    backgroundColor: 'white',
  },

  pincode: {
    fontSize: 36,
    textAlign: 'center'
  },

  savebutton: {
    margin: 10,
    width: 150,
  },

  backbutton: {
    margin: 10,
    width: 150,
  },

  hangupbutton: {
    backgroundColor: 'rgba(169, 68, 66, 0.8)', // converted rgba(#a94442, .8)
  },

});

export default styles;
