import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

import { View, TouchableWithoutFeedback} from 'react-native';
import { Appbar } from 'react-native-paper';
import FadeInView from './FadeInView';

import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  margin: {
    padding: 10,
    backgroundColor: '#fff',
    height: '100%',
    // position: 'relative', // uncomment if needed
    flex: 1,
  },

  negative: {
    marginLeft: -10,
    marginTop: -10,
    marginRight: -10,
    elevation: 0,
  },

  flex: {
    flex: 1,
  },

  container: {
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },

  drawerColor: {
    backgroundColor: '#fff',
  },

  backdrop: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '100%',
  },

  backdropColor: {
    backgroundColor: 'rgba(0, 0, 0, 0.54)',
  },
});


const ConferenceDrawer = props => {
    const [visible, setVisible] = useState(props.show);
    const [open, setOpen] = useState(false);

    const closed = () => {
        setVisible(false);
        setOpen(false);
    }

    const opened = () => {
        setOpen(true);
    }

    useEffect(() => {
        if (!visible && props.show === true) {
            setVisible(props.show);
        }
        if (visible && props.show === false) {
            setOpen(false);
        }
    }, [props.show])

    let returnData = null;
    let touch;
    if (open) {
        touch = (<TouchableWithoutFeedback onPress={props.close} >
            <View style={[styles.flex, styles.backdrop, props.showBackdrop !== false && styles.backdropColor]}  />
        </TouchableWithoutFeedback>);
    }
    if (visible) {
        returnData = (
            <View style={styles.container}>
                {touch}
                <FadeInView
                    style={styles.margin}
                    visible={props.show}
                    onClose={closed}
                    onOpen={opened}
                    isLandscape={props.isLandscape}
                >
                    <View style={styles.flex}>
                        <Appbar.Header dark={true} style={[styles.negative, styles.drawerColor]}>
                            <Appbar.BackAction color="#000" onPress={props.close} />
                            <Appbar.Content color="#000" title={props.title} />
                        </Appbar.Header>
                        {props.children}
                    </View>
                </FadeInView>
            </View>
        )
    }
    return (returnData)
};

ConferenceDrawer.propTypes = {
    show        : PropTypes.bool.isRequired,
    close       : PropTypes.func.isRequired,
    children    : PropTypes.node,
    isLandscape : PropTypes.bool,
    showBackdrop: PropTypes.bool,
    title       : PropTypes.string
};

export default ConferenceDrawer;
