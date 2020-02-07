import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
//import utils from '../utils';
import { List, IconButton } from 'react-native-paper';


const ConferenceDrawerFiles = (props) => {
    const entries = props.sharedFiles.slice(0).reverse().map((elem, idx) => {
        const uploader = elem.uploader.displayName || elem.uploader.uri || elem.uploader;
        //const color = utils.generateMaterialColor(elem.uploader.uri || elem.uploader)['300'];

        let size = (elem.filesize / 1048576).toFixed(2);

        return (
            <List.Item
                key={idx}
                title={`Shared by ${uploader}`}
                description={`${size} MB`}
                left={props => <List.Icon {...props} icon="file" />}
                right={props => <IconButton
                    {...props}
                    icon="download"
                    onPress={() => {props.downloadFile(elem.filename)}}
                />}
            />
        );
    });

    return (
        <Fragment>
            <List.Section>
                <List.Subheader>Shared Files</List.Subheader>
                {entries}
            </List.Section>
        </Fragment>
    );
};

ConferenceDrawerFiles.propTypes = {
    sharedFiles: PropTypes.array.isRequired,
    downloadFile: PropTypes.func.isRequired
};


export default ConferenceDrawerFiles;
