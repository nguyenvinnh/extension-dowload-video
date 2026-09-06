/**
 * FetchProxy v2.1 - Fix 403 + DOMException handling
 */
export class FetchProxy {
  constructor() {
    this.tabId = null;
    this.tabUrl = null;
    this.referer = null;
  }

  setTabInfo(tabId, tabUrl, referer) {
    this.tabId = tabId;
    this.tabUrl = tabUrl;
    this.referer = referer;
    console.log(`[VDP-FetchProxy] 📌 Đã thiết lập thông tin tab: tabId=${tabId}, referer=${referer || tabUrl}`);
  }

  async getActiveTab() {
    try {
      let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tabs?.[0] && !tabs[0].url?.includes('popup.html')) return tabs[0];
      tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs?.[0] && !tabs[0].url?.includes('popup.html')) return tabs[0];
    } catch (_) { }
    return null;
  }

  async ensureRefererRule() {
    if (!this.tabUrl) return;
    try {
      console.log(`[VDP-FetchProxy] 🌐 Đang cập nhật Referer rule cho URL: ${this.tabUrl}`);
      await chrome.runtime.sendMessage({ action: 'SET_REFERER_RULE', tabUrl: this.tabUrl });
      await new Promise(r => setTimeout(r, 200));
    } catch (_) { }
  }

  buildHeaders(extra = {}) {
    const headers = { 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9', ...extra };
    const ref = this.referer || this.tabUrl;
    if (ref) {
      headers['Referer'] = ref;
      try { headers['Origin'] = new URL(ref).origin; } catch (_) { }
    }
    return headers;
  }

  async fetchViaContentScript(url, isText = false) {
    if (!this.tabId) throw new Error('Không có tabId');
    console.log(`[VDP-FetchProxy] 🔄 Proxy via Content Script tabId=${this.tabId}: ${url.substring(0, 100)}...`);

    try {
      const resp = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(this.tabId, { action: isText ? 'FETCH_TEXT' : 'FETCH_BINARY', url }, (r) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(r);
        });
      });
      if (resp?.success) {
        if (isText) return resp.data;
        const binStr = atob(resp.data);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
        console.log(`[VDP-FetchProxy] ✅ Content Script OK (${bytes.byteLength} bytes)`);
        return bytes.buffer;
      }
      throw new Error(resp?.error || 'content-script fail');
    } catch (err) {
      console.warn(`[VDP-FetchProxy] ⚠ Content Script fail: ${err?.message || err}, thử MAIN world`);
      const results = await chrome.scripting.executeScript({
        target: { tabId: this.tabId },
        world: 'MAIN',
        func: async (u, wantText) => {
          try {
            const res = await fetch(u, { credentials: 'include' });
            if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
            if (wantText) return { ok: true, text: await res.text() };
            const buf = await res.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = '';
            const CHUNK = 0x8000;
            for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
            return { ok: true, b64: btoa(binary), size: bytes.length };
          } catch (e) {
            return { ok: false, error: e?.message || String(e) };
          }
        },
        args: [url, isText]
      });
      const data = results?.[0]?.result;
      if (!data) throw new Error('executeScript no result');
      if (!data.ok) throw new Error(`MAIN world fail: ${data.error}`);
      if (isText) return data.text;
      const binStr = atob(data.b64);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
      console.log(`[VDP-FetchProxy] ✅ MAIN world OK (${bytes.byteLength} bytes)`);
      return bytes.buffer;
    }
  }

  async fetchRaw(url, isKey = false) {
    // 1. Direct fetch từ background (bypass CORS nhờ host_permissions)
    try {
      const headers = this.buildHeaders();
      const res = await fetch(url, { method: 'GET', credentials: 'include', headers });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 0) return buf;
      } else {
        console.warn(`[VDP-FetchProxy] ⚠ Direct HTTP ${res.status} -> ${url.substring(0, 80)}`);
        if (res.status === 403 || res.status === 401) {
          // Nhảy sang proxy ngay, không retry direct
          throw new Error(`HTTP_${res.status}`);
        }
      }
    } catch (e) {
      const msg = e?.message || String(e);
      if (!msg.includes('HTTP_403') && !msg.includes('HTTP_401')) {
        console.warn('[VDP-FetchProxy] ⚠ Direct fail:', msg);
      }
    }

    // 2. Fallback qua tab
    if (this.tabId) {
      try {
        const buf = await this.fetchViaContentScript(url, false);
        if (buf && buf.byteLength > 0) return buf;
      } catch (e) {
        console.warn('[VDP-FetchProxy] ❌ Tab fetch fail:', e?.message || e);
        throw e;
      }
    }

    throw new Error(`403 Forbidden khi tải ${url.substring(0, 80)} - Token hết hạn, hãy refresh trang video và play lại rồi thử tải ngay.`);
  }
}