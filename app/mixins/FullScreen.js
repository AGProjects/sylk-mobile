// SPDX-FileCopyrightText: 2020, AG Projects
// SPDX-License-Identifier: GPL-3.0-only

'use strict';

const screenfull = require('screenfull');


const FullscreenMixin = {
    isFullScreen: function() {
        return screenfull.isFullscreen;
    },

    isFullscreenSupported: function() {
        return screenfull.enabled;
    },

    requestFullscreen: function(elem) {
        if (screenfull.enabled) {
            screenfull.request(elem);
        }
    },

    exitFullscreen: function() {
        if (screenfull.enabled) {
            screenfull.exit();
        }
    },

    toggleFullscreen: function(elem) {
        if (screenfull.enabled) {
            screenfull.toggle(elem);
        }
    }
};

module.exports = FullscreenMixin;
