import React from 'react';
import { StyleSheet, Text, View, TouchableHighlight } from 'react-native';
import { IconButton } from 'react-native-paper';

const styles = StyleSheet.create({
    container: {
      flex: 1,
      justifyContent:"center",
      alignItems:"center"
    },
    item: {
      alignSelf: "center",
      color:"white"
    },
    roundshape:  {
      backgroundColor: 'lightgreen',
      height: 44, //any of height
      width: 44, //any of width
      justifyContent:"center",
      borderRadius: 22   // it will be height/2
    }
});

const RoundBtn = () => {
    return (
      <View style={styles.container}>
          <TouchableHighlight style={styles.roundshape}>
                <IconButton
                                    size={32}
                                    icon="chat"
                                />
            </TouchableHighlight>
      </View>
    );
}

export default RoundBtn;
