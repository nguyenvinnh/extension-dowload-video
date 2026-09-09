import { tabManager } from './tab-manager.js';
import { detector } from './detector.js';

console.log('[VDP] ✅ Service Worker đã khởi động.');
// Bật chế độ: Click icon sẽ mở Side Panel thay vì popup
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

// Đảm bảo side panel luôn enabled cho mọi tab
chrome.tabs.onUpdated.addListener(async (tabId) => {
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'popup/popup.html',
      enabled: true
    });
  } catch {}
});

// Cache m3u8 content bắt được từ page-hook
const m3u8Cache = new Map(); // url -> { content, ts }

function cleanupCache() {
  const now = Date.now();
  for (const [url, v] of m3u8Cache.entries()) {
    if (now - v.ts > 5 * 60 * 1000) m3u8Cache.delete(url);
  }
}
setInterval(cleanupCache, 60 * 1000);

async function setRefererRule(tabUrl) {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1001, 1002, 1003] });
    if (!tabUrl || tabUrl.startsWith('chrome') || tabUrl.startsWith('chrome-extension') || tabUrl.startsWith('about') || tabUrl.startsWith('edge') || tabUrl.startsWith('moz-extension')) return;
    let origin;
    try { origin = new URL(tabUrl).origin; } catch { return; }
    // FIX: Áp dụng cho TẤT CẢ domain, không chỉ videocdn/avking
    // Dùng regexFilter.* + resourceTypes media/other để bypass 403 do thiếu Referer
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [
        {
          id: 1001,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Referer', operation: 'set', value: tabUrl },
              { header: 'Origin', operation: 'set', value: origin }
            ]
          },
          condition: { regexFilter: '^https?://.*', resourceTypes: ['xmlhttprequest', 'media', 'other'] }
        }
      ]
    });
    console.log('[VDP] ✅ Set Referer rule ->', tabUrl, 'origin=', origin);
  } catch (e) {
    console.warn('[VDP] setRefererRule fail', e?.message || e);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;
  const tabId = message.tabId || (sender.tab ? sender.tab.id : null);

  switch (message.action) {
    case 'SET_REFERER_RULE': {
      setRefererRule(message.tabUrl).then(() => sendResponse({ success: true }));
      return true;
    }
    case 'M3U8_CACHED': {
      if (message.url && message.content) {
        m3u8Cache.set(message.url, { content: message.content, ts: Date.now() });
        console.log('[VDP] 📦 Cached m3u8 từ page-hook:', message.url.substring(0, 80), message.content.length);
        if (tabId) {
          tabManager.addMedia(tabId, {
            url: message.url,
            type: 'HLS',
            format: 'M3U8',
            title: sender.tab ? sender.tab.title : 'Video',
            duration: 0,
            resolution: 'N/A'
          });
          detector.updateBadge(tabId);
        }
      }
      sendResponse({ success: true });
      return true;
    }
    case 'GET_CACHED_M3U8': {
      const entry = m3u8Cache.get(message.url);
      if (entry && Date.now() - entry.ts < 5 * 60 * 1000) {
        sendResponse({ success: true, content: entry.content });
      } else {
        sendResponse({ success: false });
      }
      return true;
    }
    case 'GET_MEDIA_LIST': {
      if (!tabId) { sendResponse({ success: false, data: [] }); return true; }
      tabManager.getMediaListAsync(tabId).then((list) => sendResponse({ success: true, data: list }));
      return true;
    }
    case 'MEDIA_SCANNED':
    case 'MEDIA_DETECTED': {
      if (tabId && message.mediaData) {
        const item = tabManager.addMedia(tabId, message.mediaData);
        if (item) {
          detector.updateBadge(tabId);
          chrome.runtime.sendMessage({ action: 'MEDIA_UPDATED', tabId }).catch(() => { });
        }
      }
      sendResponse({ success: true });
      return true;
    }
    case 'CLEAR_TAB_MEDIA': {
      if (tabId) { tabManager.clearTab(tabId); detector.updateBadge(tabId); }
      sendResponse({ success: true });
      return true;
    }
    default:
      return false;
  }
});