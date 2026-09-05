import { sanitizeFilename } from './formatters.js';

/**
 * DirectDownloader: Tải file trực tiếp (MP4, WEBM) thông qua chrome.downloads API
 */
export class DirectDownloader {
  static download(url, title = 'video', extension = 'mp4') {
    return new Promise((resolve, reject) => {
      const filename = sanitizeFilename(title, extension);

      chrome.downloads.download(
        {
          url: url,
          filename: filename,
          saveAs: true
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(downloadId);
          }
        }
      );
    });
  }
}
