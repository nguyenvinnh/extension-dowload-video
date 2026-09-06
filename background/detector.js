import { tabManager } from './tab-manager.js';

/**
 * NetworkDetector: Bắt và lọc các yêu cầu mạng chứa video (MP4, WEBM, M3U8)
 * Đã cải thiện: thêm log chi tiết, gửi MEDIA_DETECTED message để trigger real-time push
 */
class NetworkDetector {
  constructor() {
    this.init();
  }

  init() {
    console.log('[VDP-Detector] 🎯 NetworkDetector khởi động, lắng nghe webRequest...');

    chrome.webRequest.onHeadersReceived.addListener(
      (details) => this.handleHeadersReceived(details),
      { urls: ['<all_urls>'] },
      ['responseHeaders']
    );
  }

  handleHeadersReceived(details) {
    if (!details || details.tabId < 0) return;

    const url = details.url;
    if (!url || url.startsWith('chrome-extension://') || url.startsWith('chrome://')) return;

    const responseHeaders = details.responseHeaders || [];
    let contentType = '';
    let contentLength = 0;

    for (const header of responseHeaders) {
      const name = header.name.toLowerCase();
      if (name === 'content-type') {
        contentType = (header.value || '').toLowerCase();
      } else if (name === 'content-length') {
        contentLength = parseInt(header.value || '0', 10);
      }
    }

    const cleanUrl = url.split('?')[0].toLowerCase();

    // 1. Phân loại M3U8 / HLS Stream
    if (
      cleanUrl.endsWith('.m3u8') ||
      contentType.includes('application/x-mpegurl') ||
      contentType.includes('application/vnd.apple.mpegurl')
    ) {
      console.log(`[VDP-Detector] 🎬 M3U8 phát hiện tab=${details.tabId}:`, url.substring(0, 100));

      const item = tabManager.addMedia(details.tabId, {
        url: details.url,
        type: 'HLS',
        format: 'M3U8',
        mimeType: contentType || 'application/x-mpegURL',
        sizeBytes: contentLength,
        timestamp: Date.now()
      });

      if (item) {
        this.updateBadge(details.tabId);

        // Gửi message để service-worker push tới popup (real-time)
        chrome.runtime.sendMessage({
          action: 'MEDIA_DETECTED',
          tabId: details.tabId,
          mediaData: {
            url: details.url,
            type: 'HLS',
            format: 'M3U8',
            mimeType: contentType || 'application/x-mpegURL',
            sizeBytes: contentLength
          }
        }).catch(() => {});
      }
      return;
    }

    // 2. Phân loại Direct MP4 / WEBM
    if (
      cleanUrl.endsWith('.mp4') ||
      cleanUrl.endsWith('.webm') ||
      contentType.startsWith('video/mp4') ||
      contentType.startsWith('video/webm')
    ) {
      // Bỏ qua các đoạn video quá nhỏ (dưới 50KB) - thường là icon hoặc đoạn nhúng rác
      if (contentLength > 0 && contentLength < 50 * 1024) {
        console.log(`[VDP-Detector] ⏭️ Bỏ qua file nhỏ (<50KB) tab=${details.tabId}:`, url.substring(0, 80));
        return;
      }

      const format = cleanUrl.endsWith('.webm') || contentType.includes('webm') ? 'WEBM' : 'MP4';
      console.log(`[VDP-Detector] 🎬 ${format} phát hiện tab=${details.tabId}:`, url.substring(0, 100));

      const item = tabManager.addMedia(details.tabId, {
        url: details.url,
        type: 'DIRECT',
        format: format,
        mimeType: contentType || `video/${format.toLowerCase()}`,
        sizeBytes: contentLength,
        timestamp: Date.now()
      });

      if (item) {
        this.updateBadge(details.tabId);

        chrome.runtime.sendMessage({
          action: 'MEDIA_DETECTED',
          tabId: details.tabId,
          mediaData: {
            url: details.url,
            type: 'DIRECT',
            format: format,
            mimeType: contentType || `video/${format.toLowerCase()}`,
            sizeBytes: contentLength
          }
        }).catch(() => {});
      }
      return;
    }
  }

  updateBadge(tabId) {
    const list = tabManager.getMediaList(tabId);
    const count = list.length;
    if (count > 0) {
      chrome.action.setBadgeText({ tabId: tabId, text: count.toString() });
      chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: '#10B981' });
    } else {
      chrome.action.setBadgeText({ tabId: tabId, text: '' });
    }
  }
}

export const detector = new NetworkDetector();
