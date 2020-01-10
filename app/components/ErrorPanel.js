import React from 'react';
import PropTypes from 'prop-types';
import { Portal, Modal, Title, Text, Surface } from 'react-native-paper';

const ErrorPanel = (props) => {
    return (
        <Portal>
            <Modal visible={true}>
                <Surface>
                    <Title><Icon name="alert" /> Warning</Title>
                    <Text>
                        {props.errorMsg}
                    </Text>
                </Surface>
            </Modal>
        </Portal>
    );
}

ErrorPanel.propTypes = {
    errorMsg: PropTypes.object.isRequired
};

export default ErrorPanel;
