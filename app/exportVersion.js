/*
 * exportVersion.js
 *
 * Single build counter for the data export/import feature. BUMP THIS on every
 * change so you can confirm the new JS bundle (native modals) AND the served
 * web page actually reloaded — it's shown on the Export modal, the Import
 * modal, and the web page header.
 */
'use strict';

const EXPORT_BUILD = 6;

module.exports = { EXPORT_BUILD: EXPORT_BUILD };
