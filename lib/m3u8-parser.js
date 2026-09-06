/**
 * M3U8Parser v2.4 — Fix 403 token HS256 + giữ query string
 */
export class M3U8Parser {
  static resolveUrl(relativeUrl, baseUrl) {
    if (!relativeUrl) return relativeUrl;
    try {
      // Nếu đã là absolute URL
      if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
        try {
          const base = new URL(baseUrl);
          const abs = new URL(relativeUrl);
          // FIX: Nếu base có token mà absolute không có, giữ lại token
          if (base.search && !abs.search && abs.origin === base.origin) {
            abs.search = base.search;
            return abs.href;
          }
          // Merge các key token nếu thiếu
          if (base.search) {
            for (const [k, v] of base.searchParams.entries()) {
              if (!abs.searchParams.has(k) && /token|expires|exp|sig|sign|auth|key|st|e|hdnts|__gda__/i.test(k)) {
                abs.searchParams.set(k, v);
              }
            }
            if (abs.search !== new URL(relativeUrl).search) return abs.href;
          }
        } catch { }
        return relativeUrl;
      }
      const base = new URL(baseUrl);
      const resolved = new URL(relativeUrl, base);
      // FIX QUAN TRỌNG: Giữ lại query/token từ baseUrl nếu resolved mất query
      // base =.../playlist.m3u8?token=HS256...
      // relative = seg_0.ts -> trước đây thành.../seg_0.ts (mất token) -> 403
      if (base.search && !resolved.search) {
        resolved.search = base.search;
      } else if (base.search && resolved.search) {
        // Merge token còn thiếu
        for (const [k, v] of base.searchParams.entries()) {
          if (!resolved.searchParams.has(k) && /token|expires|exp|sig|sign|auth|key|st|e|hdnts|__gda__/i.test(k)) {
            resolved.searchParams.set(k, v);
          }
        }
      }
      return resolved.href;
    } catch { return relativeUrl; }
  }

  static _buildHeaders(tabUrl, referer, extra = {}) {
    const headers = { 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9', ...extra };
    const ref = referer || tabUrl;
    if (ref) { headers['Referer'] = ref; try { headers['Origin'] = new URL(ref).origin; } catch { } }
    return headers;
  }

  static async _getActiveTab() {
    try {
      let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tabs && tabs[0] && !tabs[0].url.includes('popup.html')) return tabs[0];
      tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs[0] && !tabs[0].url.includes('popup.html')) return tabs[0];
    } catch { }
    return null;
  }

  static async _ensureRefererRule(tabUrl) {
    if (!tabUrl) return;
    try { await chrome.runtime.sendMessage({ action: 'SET_REFERER_RULE', tabUrl }); } catch { }
  }

  static async _getCachedContent(url) {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'GET_CACHED_M3U8', url });
      if (res && res.success && res.content) {
        console.log('[M3U8Parser] ♻ Dùng cache từ page-hook');
        return res.content;
      }
    } catch { }
    return null;
  }

  static async _fetchTextViaContentScript(url, tabId) {
    try {
      const resp = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { action: 'FETCH_TEXT', url }, (r) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(r);
        });
      });
      if (resp && resp.success && typeof resp.data === 'string') return resp.data;
      throw new Error(resp?.error || 'content-script fail');
    } catch (e) {
      const results = await chrome.scripting.executeScript({
        target: { tabId }, world: 'MAIN',
        func: async (u) => {
          const r = await fetch(u, { credentials: 'include' });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return await r.text();
        },
        args: [url]
      });
      if (results && results[0] && typeof results[0].result === 'string') return results[0].result;
      throw new Error('executeScript no result: ' + e.message);
    }
  }

  static async parse(m3u8Url, options = {}) {
    const opts = options || {};
    let tab = null;
    if (!opts.tabId || !opts.tabUrl) tab = await this._getActiveTab();
    const tabId = opts.tabId || tab?.id || null;
    const tabUrl = opts.tabUrl || opts.referer || tab?.url || null;
    const referer = opts.referer || tabUrl;
    console.log('[M3U8Parser] Parse:', m3u8Url.substring(0, 120), 'tabId=', tabId);

    let content = null;
    let lastErr = null;

    // 1) Ưu tiên cache từ page-hook (token còn sống)
    content = await this._getCachedContent(m3u8Url);
    if (!content) {
      // 2) Set referer rule rồi fetch từ background (bypass CORS)
      if (tabUrl) await this._ensureRefererRule(tabUrl);
      try {
        if (opts.fetchFn) {
          const r = await opts.fetchFn(m3u8Url);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          content = await r.text();
        } else {
          const headers = this._buildHeaders(tabUrl, referer, opts.headers);
          const res = await fetch(m3u8Url, { method: 'GET', credentials: 'include', headers });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          content = await res.text();
        }
      } catch (e) {
        lastErr = e;
        console.warn('[M3U8Parser] Direct fail:', e.message);
        if (tabId) {
          try { content = await this._fetchTextViaContentScript(m3u8Url, tabId); }
          catch (e2) { lastErr = e2; }
        }
      }
    }

    if (!content) throw new Error(`${lastErr?.message || 'Fetch failed'} khi tải M3U8. Token HS256 có thể hết hạn - hãy refresh trang video và phát lại video rồi thử lại: ${m3u8Url.substring(0, 100)}`);
    console.log(`[M3U8Parser] Got ${content.length} chars`);
    return this.parseContent(content, m3u8Url, { tabId, tabUrl, referer });
  }

  static async parseContent(content, baseUrl, options = {}) {
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines[0] || !lines[0].startsWith('#EXTM3U')) throw new Error('Không phải M3U8 hợp lệ');
    const isMaster = lines.some(l => l.startsWith('#EXT-X-STREAM-INF'));
    if (isMaster) return await this.handleMasterPlaylist(lines, baseUrl, options);
    return this.handleMediaPlaylist(lines, baseUrl);
  }

  static async handleMasterPlaylist(lines, baseUrl, options = {}) {
    const streams = [];
    let bw = 0, res = '', codecs = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const m1 = line.match(/BANDWIDTH=(\d+)/); if (m1) bw = parseInt(m1[1], 10);
        const m2 = line.match(/RESOLUTION=(\d+x\d+)/); if (m2) res = m2[1];
        const m3 = line.match(/CODECS="([^"]+)"/); if (m3) codecs = m3[1];
        if (i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
          streams.push({ bandwidth: bw, resolution: res, codecs, url: this.resolveUrl(lines[i + 1], baseUrl) }); i++;
        }
      }
    }
    if (!streams.length) throw new Error('Không có stream trong Master');
    streams.sort((a, b) => b.bandwidth - a.bandwidth);
    const best = streams[0];
    const parsed = await this.parse(best.url, options);
    if (best.resolution && !parsed.resolution) parsed.resolution = best.resolution;
    return parsed;
  }

  static handleMediaPlaylist(lines, baseUrl) {
    const segments = []; let totalDuration = 0, seq = 0, currentEncryption = null, initSegmentUrl = null;
    const seqLine = lines.find(l => l.startsWith('#EXT-X-MEDIA-SEQUENCE:'));
    if (seqLine) seq = parseInt(seqLine.split(':')[1], 10) || 0;
    let nextSeq = seq;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#EXT-X-KEY:')) {
        const method = (line.match(/METHOD=([^,\s]+)/)?.[1]) || 'NONE';
        if (method === 'NONE') currentEncryption = null;
        else if (method === 'AES-128') {
          const keyUrl = line.match(/URI="([^"]+)"/) ? this.resolveUrl(line.match(/URI="([^"]+)"/)[1], baseUrl) : null;
          const ivHex = line.match(/IV=0x([0-9A-Fa-f]+)/)?.[1] || null;
          currentEncryption = { method: 'AES-128', keyUrl, ivHex };
        } else currentEncryption = { method };
        continue;
      }
      if (line.startsWith('#EXT-X-MAP:')) {
        const uriMatch = line.match(/URI="([^"]+)"/); if (uriMatch) initSegmentUrl = this.resolveUrl(uriMatch[1], baseUrl); continue;
      }
      if (line.startsWith('#EXTINF:')) {
        const dur = parseFloat(line.match(/#EXTINF:([\d.]+)/)?.[1] || '0'); totalDuration += dur;
        let segIdx = i + 1; while (segIdx < lines.length && lines[segIdx].startsWith('#')) segIdx++;
        if (segIdx < lines.length) {
          const segUrl = this.resolveUrl(lines[segIdx], baseUrl);
          const startTime = totalDuration - dur, endTime = totalDuration;
          let segIV = null; if (currentEncryption?.method === 'AES-128') segIV = currentEncryption.ivHex || nextSeq.toString(16).padStart(32, '0');
          segments.push({ index: segments.length, seq: nextSeq, duration: dur, startTime, endTime, url: segUrl, encryption: currentEncryption ? { method: currentEncryption.method, keyUrl: currentEncryption.keyUrl, iv: segIV } : null, initSegmentUrl });
          i = segIdx; nextSeq++;
        }
      }
    }
    return { type: 'MEDIA', segments, totalDuration, segmentCount: segments.length, hasAES128: segments.some(s => s.encryption?.method === 'AES-128'), hasDRM: segments.some(s => s.encryption?.method === 'SAMPLE-AES'), initSegmentUrl };
  }
}