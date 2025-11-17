import { NativeModules, Platform } from 'react-native';

const { ThumbnailServiceModule } = NativeModules;

/**
 * Safe cross-platform thumbnail generation.
 * @param {Object} options
 * @param {string} options.url - video URL or file path
 * @param {number} [options.timeMs=1000] - frame timestamp in milliseconds
 * @param {number} [options.maxWidth=512]
 * @param {number} [options.maxHeight=512]
 * @param {string} [options.format='jpeg'] - 'jpeg' or 'png'
 * @returns {Promise<string>} - resolves to file:// path
 */
export function createThumbnailSafe({
  url,
  timeMs = 1000,
  maxWidth = 512,
  maxHeight = 512,
  format = 'jpeg',
}) {
    return ThumbnailServiceModule.extract(url, timeMs, maxWidth, maxHeight, format);
}

