import { tabManager } from './tab-manager.js';
import { detector } from './detector.js';

console.log('[Video Downloader Pro] Service Worker initialized.');

// Lắng nghe Message từ Popup UI và Content Scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  const tabId = message.tabId || (sender.tab ? sender.tab.id : null);

  switch (message.action) {
    // 1. Popup yêu cầu lấy danh sách video của Tab hiện tại
    case 'GET_MEDIA_LIST': {
      if (!tabId) {
        sendResponse({ success: false, data: [] });
        return true;
      }
      tabManager.getMediaListAsync(tabId).then((mediaList) => {
        sendResponse({ success: true, data: mediaList });
      });
      return true;
    }

    // 2. Content Script quét được thông tin DOM (duration, resolution, src...)
    case 'MEDIA_SCANNED': {
      if (tabId && message.mediaData) {
        tabManager.addMedia(tabId, message.mediaData);
        detector.updateBadge(tabId);
      }
      sendResponse({ success: true });
      return true;
    }

    // 3. Yêu cầu làm mới/xóa bộ nhớ tab
    case 'CLEAR_TAB_MEDIA': {
      if (tabId) {
        tabManager.clearTab(tabId);
        detector.updateBadge(tabId);
      }
      sendResponse({ success: true });
      return true;
    }

    default:
      return false;
  }
});
