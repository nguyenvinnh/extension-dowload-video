(function () {
  'use strict';

  /**
   * Content Script: Media Scanner
   * Trích xuất thông tin duration, resolution từ thẻ <video> HTML5
   */

  function getResolutionLabel(width, height) {
    if (!width || !height) return 'N/A';
    const minDim = Math.min(width, height);
    const maxDim = Math.max(width, height);
    
    if (maxDim >= 3840 || minDim >= 2160) return '4K (2160p)';
    if (maxDim >= 2560 || minDim >= 1440) return '2K (1440p)';
    if (maxDim >= 1920 || minDim >= 1080) return '1080p';
    if (maxDim >= 1280 || minDim >= 720) return '720p';
    if (maxDim >= 854 || minDim >= 480) return '480p';
    if (maxDim >= 640 || minDim >= 360) return '360p';
    return `${width}x${height}`;
  }

  function getPageTitle() {
    return document.title || 'Video File';
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

      chrome.runtime.sendMessage({
        action: 'MEDIA_SCANNED',
        mediaData: {
          url: src,
          type: type,
          format: format,
          duration: duration,
          resolution: resolution,
          title: getPageTitle()
        }
      });
    }

    // Kiểm tra thêm các thẻ <source> bên trong <video>
    const sources = videoEl.querySelectorAll('source');
    sources.forEach((sourceEl) => {
      const sourceSrc = sourceEl.src;
      if (sourceSrc && !sourceSrc.startsWith('blob:') && !sourceSrc.startsWith('data:')) {
        const isM3U8 = sourceSrc.includes('.m3u8');
        const format = isM3U8 ? 'M3U8' : sourceSrc.includes('.webm') ? 'WEBM' : 'MP4';
        const type = isM3U8 ? 'HLS' : 'DIRECT';

        chrome.runtime.sendMessage({
          action: 'MEDIA_SCANNED',
          mediaData: {
            url: sourceSrc,
            type: type,
            format: format,
            duration: duration,
            resolution: resolution,
            title: getPageTitle()
          }
        });
      }
    });
  }

  function scanMediaElements() {
    const videos = document.querySelectorAll('video');
    videos.forEach((videoEl) => {
      processVideoElement(videoEl);

      // Lắng nghe sự kiện loadedmetadata khi video sẵn sàng
      videoEl.addEventListener('loadedmetadata', () => {
        processVideoElement(videoEl);
      }, { once: true });
    });
  }

  // Quét ngay khi script được nạp
  scanMediaElements();

  // Quét lại khi DOM thay đổi (ví dụ single page app SPA)
  const observer = new MutationObserver((mutations) => {
    let hasNewVideo = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        hasNewVideo = true;
        break;
      }
    }
    if (hasNewVideo) {
      scanMediaElements();
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
