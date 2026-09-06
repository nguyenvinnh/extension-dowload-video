(function () {
  'use strict';
  console.log('[VDP-Scanner] 🎯 Content script nạp:', document.location.href.substring(0, 80));

  // Nhận m3u8 từ page-hook MAIN world
  window.addEventListener('message', (e) => {
    if (e.data && e.data.__VDP_HOOK__ && e.data.type === 'M3U8_CONTENT') {
      console.log('[VDP-Scanner] 📦 Nhận m3u8 từ page-hook', e.data.url.substring(0, 80));
      chrome.runtime.sendMessage({ action: 'M3U8_CACHED', url: e.data.url, content: e.data.content }).catch(() => { });
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) return false;
    if (message.action === 'FETCH_BINARY' || message.action === 'FETCH_TEXT') {
      const url = message.url;
      fetch(url, { credentials: 'include', headers: { 'Accept': '*/*' } })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (message.action === 'FETCH_BINARY') {
            const buf = await res.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = '';
            const CHUNK = 0x8000;
            for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
            return { isBinary: true, b64: btoa(binary) };
          } else {
            const text = await res.text();
            return { isBinary: false, text };
          }
        })
        .then((r) => {
          if (r.isBinary) sendResponse({ success: true, data: r.b64 });
          else sendResponse({ success: true, data: r.text });
        })
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
    return false;
  });

  function getResolutionLabel(w, h) {
    if (!w || !h) return 'N/A';
    const min = Math.min(w, h), max = Math.max(w, h);
    if (max >= 3840 || min >= 2160) return '4K (2160p)';
    if (max >= 2560 || min >= 1440) return '2K (1440p)';
    if (max >= 1920 || min >= 1080) return '1080p';
    if (max >= 1280 || min >= 720) return '720p';
    if (max >= 854 || min >= 480) return '480p';
    return `${w}x${h}`;
  }
  function getPageTitle() { return document.title || 'Video File'; }
  function sendMediaData(d) {
    try { chrome.runtime.sendMessage({ action: 'MEDIA_SCANNED', mediaData: d }, () => { if (chrome.runtime.lastError) return; }); } catch { }
  }
  function processVideoElement(videoEl) {
    if (!videoEl) return;
    const src = videoEl.currentSrc || videoEl.src;
    const duration = videoEl.duration && !isNaN(videoEl.duration) ? videoEl.duration : 0;
    const resolution = getResolutionLabel(videoEl.videoWidth, videoEl.videoHeight);
    if (src && !src.startsWith('blob:') && !src.startsWith('data:')) {
      const isM3U8 = src.includes('.m3u8');
      const format = isM3U8 ? 'M3U8' : src.includes('.webm') ? 'WEBM' : 'MP4';
      const type = isM3U8 ? 'HLS' : 'DIRECT';
      sendMediaData({ url: src, type, format, duration, resolution, title: getPageTitle() });
    }
    videoEl.querySelectorAll('source').forEach(s => {
      const u = s.src;
      if (u && !u.startsWith('blob:') && !u.startsWith('data:')) {
        const isM3U8 = u.includes('.m3u8');
        sendMediaData({ url: u, type: isM3U8 ? 'HLS' : 'DIRECT', format: isM3U8 ? 'M3U8' : 'MP4', duration, resolution, title: getPageTitle() });
      }
    });
  }
  const processed = new WeakSet();
  function scanMediaElements() {
    document.querySelectorAll('video').forEach(v => {
      processVideoElement(v);
      if (!processed.has(v)) {
        processed.add(v);
        v.addEventListener('loadedmetadata', () => processVideoElement(v), { once: true });
      }
    });
  }
  scanMediaElements();
  const observer = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.tagName === 'VIDEO' || n.querySelector?.('video'))) { scanMediaElements(); return; }
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
})();
