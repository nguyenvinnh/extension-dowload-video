// Chạy ở MAIN world - bắt m3u8 ngay khi player của trang fetch
(function () {
  console.log('[VDP-HOOK] Injected page-hook MAIN world', location.href.substring(0, 80));
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const reqUrl = args[0] instanceof Request? args[0].url : args[0];
    const isM3U8 = typeof reqUrl === 'string' && reqUrl.includes('.m3u8');
    try {
      const res = await origFetch.apply(this, args);
      if (isM3U8) {
        try {
          const clone = res.clone();
          const text = await clone.text();
          if (text.includes('#EXTM3U')) {
            window.postMessage({ __VDP_HOOK__: true, type: 'M3U8_CONTENT', url: reqUrl, content: text }, '*');
          }
        } catch {}
      }
      return res;
    } catch (e) { throw e; }
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url,...rest) {
    this._vdp_url = url;
    return origOpen.call(this, method, url,...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const xhr = this;
    const url = xhr._vdp_url;
    const isM3U8 = typeof url === 'string' && url.includes('.m3u8');
    if (isM3U8) {
      xhr.addEventListener('load', function () {
        try {
          const text = xhr.responseText;
          if (text && text.includes('#EXTM3U')) {
            window.postMessage({ __VDP_HOOK__: true, type: 'M3U8_CONTENT', url, content: text }, '*');
          }
        } catch {}
      });
    }
    return origSend.apply(this, args);
  };
})();