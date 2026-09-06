/**
 * TabManager: Quản lý và lưu trữ bộ nhớ media theo từng Tab
 * - Lưu trữ theo timestamp để sắp xếp video mới nhất lên đầu
 * - Tự động bảo tồn danh sách video đã quét cho đến khi Tab đóng hoặc chuyển trang
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
              console.log(`[VDP-TabManager] 🔄 Phục hồi ${val.length} mục từ storage cho tab=${tabId}`);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[VDP-TabManager] Lỗi khôi phục dữ liệu từ storage:', e);
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
      console.warn('[VDP-TabManager] Lỗi lưu dữ liệu storage:', e);
    }
  }

  initListeners() {
    // Xóa bộ nhớ khi Tab bị đóng
    chrome.tabs.onRemoved.addListener((tabId) => {
      console.log(`[VDP-TabManager] 🗑 Tab ${tabId} đóng → Xóa bộ nhớ`);
      this.clearTab(tabId);
    });

    // Xóa bộ nhớ khi Tab chuyển hướng URL khác (chỉ khi thực sự đổi URL trang)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'loading' && changeInfo.url) {
        console.log(`[VDP-TabManager] 🔄 Tab ${tabId} chuyển trang → Xóa bộ nhớ cũ`);
        this.clearTab(tabId);
      }
    });
  }

  /**
   * Thêm hoặc cập nhật một mục media vào Tab tương ứng
   * Trả về item nếu là mục MỚI (chưa tồn tại), null nếu chỉ update
   */
  addMedia(tabId, mediaData) {
    if (!tabId || tabId <= 0 || !mediaData || !mediaData.url) return null;

    if (!this.tabMediaStore.has(tabId)) {
      this.tabMediaStore.set(tabId, new Map());
    }

    const store = this.tabMediaStore.get(tabId);
    const existing = store.get(mediaData.url);
    let item;
    let isNew = false;

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
      // Cập nhật timestamp lên mới nhất khi có thêm thông tin
      existing.lastUpdated = Date.now();
      item = existing;
    } else {
      // Mục mới - tạo object đầy đủ
      isNew = true;
      item = {
        id: 'vid_' + Math.random().toString(36).substr(2, 9),
        url: mediaData.url,
        type: mediaData.type || 'DIRECT',
        format: mediaData.format || 'MP4',
        title: mediaData.title || this.extractFilename(mediaData.url),
        duration: mediaData.duration || 0,
        resolution: mediaData.resolution || 'N/A',
        sizeBytes: mediaData.sizeBytes || 0,
        segmentCount: mediaData.segmentCount || 0,
        mimeType: mediaData.mimeType || '',
        timestamp: Date.now(),
        lastUpdated: Date.now()
      };
      store.set(mediaData.url, item);
    }

    this.persistTab(tabId);
    return isNew ? item : null; // Chỉ trả về item mới để trigger notification
  }

  /**
   * Lấy danh sách media, sắp xếp mới nhất lên đầu (theo timestamp)
   */
  getMediaListSync(tabId) {
    if (!tabId || !this.tabMediaStore.has(tabId)) return [];
    const list = Array.from(this.tabMediaStore.get(tabId).values());
    // Sắp xếp: mới nhất (timestamp lớn nhất) lên đầu
    return list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
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
          // Sắp xếp trước khi trả về
          return list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        }
      }
    } catch (e) {
      console.warn('[VDP-TabManager] Lỗi đọc storage async:', e);
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
