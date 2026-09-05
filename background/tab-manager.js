/**
 * TabManager: Quản lý và lưu trữ bộ nhớ media theo từng Tab (dùng chrome.storage.session)
 * Tự động bảo tồn danh sách video đã quét được cho đến khi người dùng đóng Tab hoặc chuyển trang.
 */

class TabManager {
  constructor() {
    // RAM cache: tabId -> Map(url -> mediaItem)
    this.tabMediaStore = new Map();
    this.initListeners();
    this.restoreFromStorage();
  }

  async restoreFromStorage() {
    try {
      const storageArea = chrome.storage.session || chrome.storage.local;
      if (storageArea) {
        const data = await storageArea.get(null);
        for (const [key, val] of Object.entries(data)) {
          if (key.startsWith('tab_media_')) {
            const tabId = parseInt(key.replace('tab_media_', ''), 10);
            if (tabId && Array.isArray(val)) {
              const map = new Map();
              val.forEach((item) => map.set(item.url, item));
              this.tabMediaStore.set(tabId, map);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[TabManager] Lỗi khôi phục dữ liệu từ storage:', e);
    }
  }

  async persistTab(tabId) {
    if (!tabId) return;
    const mediaList = this.getMediaListSync(tabId);
    try {
      const storageArea = chrome.storage.session || chrome.storage.local;
      if (storageArea) {
        await storageArea.set({ [`tab_media_${tabId}`]: mediaList });
      }
    } catch (e) {
      console.warn('[TabManager] Lỗi lưu dữ liệu storage:', e);
    }
  }

  initListeners() {
    // Xóa bộ nhớ khi Tab bị đóng
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.clearTab(tabId);
    });

    // Xóa bộ nhớ khi Tab chuyển hướng URL khác (chỉ khi thực sự đổi URL trang)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'loading' && changeInfo.url) {
        this.clearTab(tabId);
      }
    });
  }

  /**
   * Thêm hoặc cập nhật một mục media vào Tab tương ứng
   */
  addMedia(tabId, mediaData) {
    if (!tabId || tabId <= 0 || !mediaData || !mediaData.url) return null;

    if (!this.tabMediaStore.has(tabId)) {
      this.tabMediaStore.set(tabId, new Map());
    }

    const store = this.tabMediaStore.get(tabId);
    const existing = store.get(mediaData.url);
    let item;

    if (existing) {
      // Cập nhật thông tin bổ sung nếu có (duration, resolution, title...)
      if (mediaData.duration && (!existing.duration || existing.duration <= 0)) {
        existing.duration = mediaData.duration;
      }
      if (mediaData.resolution && existing.resolution === 'N/A') {
        existing.resolution = mediaData.resolution;
      }
      if (mediaData.title && existing.title === 'Video File') {
        existing.title = mediaData.title;
      }
      if (mediaData.segmentCount) {
        existing.segmentCount = mediaData.segmentCount;
      }
      item = existing;
    } else {
      item = {
        id: 'vid_' + Math.random().toString(36).substr(2, 9),
        url: mediaData.url,
        type: mediaData.type || 'DIRECT', // 'DIRECT' | 'HLS'
        format: mediaData.format || 'MP4', // 'MP4' | 'WEBM' | 'M3U8'
        title: mediaData.title || this.extractFilename(mediaData.url),
        duration: mediaData.duration || 0,
        resolution: mediaData.resolution || 'N/A',
        sizeBytes: mediaData.sizeBytes || 0,
        segmentCount: mediaData.segmentCount || 0,
        mimeType: mediaData.mimeType || '',
        timestamp: Date.now()
      };
      store.set(mediaData.url, item);
    }

    this.persistTab(tabId);
    return item;
  }

  getMediaListSync(tabId) {
    if (!tabId || !this.tabMediaStore.has(tabId)) return [];
    return Array.from(this.tabMediaStore.get(tabId).values());
  }

  async getMediaListAsync(tabId) {
    if (!tabId) return [];

    if (this.tabMediaStore.has(tabId)) {
      return this.getMediaListSync(tabId);
    }

    try {
      const storageArea = chrome.storage.session || chrome.storage.local;
      if (storageArea) {
        const data = await storageArea.get(`tab_media_${tabId}`);
        const list = data[`tab_media_${tabId}`];
        if (Array.isArray(list)) {
          const map = new Map();
          list.forEach((item) => map.set(item.url, item));
          this.tabMediaStore.set(tabId, map);
          return list;
        }
      }
    } catch (e) {
      console.warn('[TabManager] Lỗi đọc storage async:', e);
    }

    return [];
  }

  getMediaList(tabId) {
    return this.getMediaListSync(tabId);
  }

  clearTab(tabId) {
    if (this.tabMediaStore.has(tabId)) {
      this.tabMediaStore.delete(tabId);
    }
    const storageArea = chrome.storage.session || chrome.storage.local;
    if (storageArea) {
      storageArea.remove(`tab_media_${tabId}`).catch(() => {});
    }
  }

  extractFilename(urlStr) {
    try {
      const url = new URL(urlStr);
      const pathname = url.pathname;
      const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
      if (filename && filename.length > 2 && filename.includes('.')) {
        return decodeURIComponent(filename);
      }
    } catch (e) {
      // Ignore URL parse error
    }
    return 'Video File';
  }
}

export const tabManager = new TabManager();
