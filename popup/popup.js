import { formatTime, formatBytes, parseTimeStringToSeconds } from '../utils/formatters.js';
import { DirectDownloader } from '../utils/direct-downloader.js';
import { M3U8Downloader } from '../utils/m3u8-downloader.js';

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements - Views & Navigation
  const listView = document.getElementById('listView');
  const detailView = document.getElementById('detailView');
  const videoListEl = document.getElementById('videoList');
  const emptyStateEl = document.getElementById('emptyState');
  const backToListBtn = document.getElementById('backToListBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const clearBtn = document.getElementById('clearBtn');
  const openSidePanelBtn = document.getElementById('openSidePanelBtn');
  const tabIndicator = document.getElementById('tabIndicator');

  // DOM Elements - Detail View Specs & Player
  const detailTitle = document.getElementById('detailTitle');
  const detailBadge = document.getElementById('detailBadge');
  const detailPlayerWrapper = document.getElementById('detailPlayerWrapper');
  const detailPreviewPlayer = document.getElementById('detailPreviewPlayer');
  const detailDuration = document.getElementById('detailDuration');
  const detailResolution = document.getElementById('detailResolution');
  const detailSize = document.getElementById('detailSize');
  const copyUrlBtn = document.getElementById('copyUrlBtn');

  // DOM Elements - Timeline State Machine Clipper
  const timelineClipperBox = document.getElementById('timelineClipperBox');
  const timelineStateBtn = document.getElementById('timelineStateBtn');
  const stateBtnIcon = document.getElementById('stateBtnIcon');
  const stateBtnText = document.getElementById('stateBtnText');
  const currPlayerTimeLabel = document.getElementById('currPlayerTimeLabel');
  const clipToEndBtn = document.getElementById('clipToEndBtn');
  const cancelClipStateBtn = document.getElementById('cancelClipStateBtn');
  const timelineStatusInfo = document.getElementById('timelineStatusInfo');

  // DOM Elements - Saved Chips & Accordion
  const savedChipsWrapper = document.getElementById('savedChipsWrapper');
  const savedChipsCount = document.getElementById('savedChipsCount');
  const savedChipsContainer = document.getElementById('savedChipsContainer');
  const clearChipsBtn = document.getElementById('clearChipsBtn');
  const accordionToggleBtn = document.getElementById('accordionToggleBtn');
  const accordionArrow = document.getElementById('accordionArrow');
  const manualInputsContainer = document.getElementById('manualInputsContainer');
  const clipRangesList = document.getElementById('clipRangesList');
  const addRangeBtn = document.getElementById('addRangeBtn');

  // Download & Progress Bar
  const detailDownloadBtn = document.getElementById('detailDownloadBtn');
  const detailProgBox = document.getElementById('detailProgBox');
  const detailProgMsg = document.getElementById('detailProgMsg');
  const detailProgPct = document.getElementById('detailProgPct');
  const detailProgFill = document.getElementById('detailProgFill');

  let activeTabId = null;
  let activeWindowId = null;
  let selectedMedia = null;

  // Timeline Clipper State Machine
  let clipState = 'WAITING_START'; // 'WAITING_START' | 'WAITING_END'
  let pendingStartSec = null;
  let pendingStartStr = '';
  let savedClipRanges = []; // [{ id, startSec, endSec, startStr, endStr }]
  let manualClipRanges = []; // [{ id, startStr, endStr }]

  // 2. Timeline Time update listener
  detailPreviewPlayer.addEventListener('timeupdate', () => {
    const formatted = formatTime(detailPreviewPlayer.currentTime);
    if (currPlayerTimeLabel) currPlayerTimeLabel.textContent = formatted;
  });

  // 3. Reset Timeline Clipper State Machine
  function resetTimelineClipperState() {
    clipState = 'WAITING_START';
    pendingStartSec = null;
    pendingStartStr = '';

    stateBtnIcon.textContent = '🟢';
    stateBtnText.textContent = '1. Đặt Bắt đầu';
    timelineStateBtn.className = 'state-btn start-state';
    clipToEndBtn.style.display = 'none';
    cancelClipStateBtn.style.display = 'none';

    timelineStatusInfo.textContent =
      'Bấm [1. Đặt Bắt đầu] tại mốc thời gian muốn cắt.';
    timelineStatusInfo.className = 'timeline-status-info';
  }

  // 4. Timeline State Button Click Handler
  timelineStateBtn.addEventListener('click', () => {
    const currentTime = detailPreviewPlayer.currentTime || 0;
    const formattedTime = formatTime(currentTime);

    if (clipState === 'WAITING_START') {
      // 🟢 Chuyển sang chờ đặt mốc Kết thúc
      clipState = 'WAITING_END';
      pendingStartSec = currentTime;
      pendingStartStr = formattedTime;

      stateBtnIcon.textContent = '🔴';
      stateBtnText.textContent = `2. Đặt Kết thúc (đang chờ)`;
      timelineStateBtn.className = 'state-btn end-state';
      clipToEndBtn.style.display = 'inline-flex';
      cancelClipStateBtn.style.display = 'inline-flex';

      timelineStatusInfo.textContent = `▶️ Đã chọn Bắt đầu tại [${pendingStartStr}]. Tua video tới mốc cần dừng rồi bấm [2. Đặt Kết thúc].`;
      timelineStatusInfo.className = 'timeline-status-info active-start';
    } else if (clipState === 'WAITING_END') {
      // 🔴 Đặt mốc Kết thúc và lưu đoạn cắt
      const endSec = currentTime;
      const endStr = formattedTime;

      if (endSec <= pendingStartSec) {
        timelineStatusInfo.textContent = `⚠️ Mốc kết thúc (${endStr}) phải lớn hơn mốc bắt đầu (${pendingStartStr})! Hãy tua video lên tiếp.`;
        return;
      }

      // Lưu khoảng cắt hợp lệ
      savedClipRanges.push({
        id: 'chip_' + Date.now() + Math.random().toString(36).substr(2, 4),
        startSec: pendingStartSec,
        endSec: endSec,
        startStr: pendingStartStr,
        endStr: endStr
      });

      renderSavedChips();
      resetTimelineClipperState();
    }
  });

  // Nút "Đến hết video"
  clipToEndBtn.addEventListener('click', () => {
    if (clipState === 'WAITING_END' && pendingStartSec !== null) {
      savedClipRanges.push({
        id: 'chip_' + Date.now(),
        startSec: pendingStartSec,
        endSec: Infinity,
        startStr: pendingStartStr,
        endStr: 'Hết video'
      });
      renderSavedChips();
      resetTimelineClipperState();
    }
  });

  // Nút "Hủy"
  cancelClipStateBtn.addEventListener('click', () => {
    resetTimelineClipperState();
  });

  // Clear toàn bộ đoạn cắt đã lưu
  clearChipsBtn.addEventListener('click', () => {
    savedClipRanges = [];
    renderSavedChips();
  });

  // Render các Chip đoạn cắt đã lưu
  function renderSavedChips() {
    savedChipsContainer.innerHTML = '';
    savedChipsCount.textContent = savedClipRanges.length;

    if (savedClipRanges.length > 0) {
      savedChipsWrapper.style.display = 'block';
    } else {
      savedChipsWrapper.style.display = 'none';
    }

    savedClipRanges.forEach((chip, idx) => {
      const chipEl = document.createElement('div');
      chipEl.className = 'saved-chip';
      chipEl.innerHTML = `
        <span>✂️ Đoạn ${idx + 1}: ${chip.startStr} ➔ ${chip.endStr}</span>
        <button class="chip-remove-btn" title="Xóa đoạn này">&times;</button>
      `;

      chipEl.querySelector('.chip-remove-btn').addEventListener('click', () => {
        savedClipRanges.splice(idx, 1);
        renderSavedChips();
      });

      savedChipsContainer.appendChild(chipEl);
    });
  }

  // 5. Accordion Toggle cho ô nhập thủ công
  accordionToggleBtn.addEventListener('click', () => {
    const isHidden = manualInputsContainer.style.display === 'none';
    if (isHidden) {
      manualInputsContainer.style.display = 'block';
      accordionArrow.textContent = '▲';
    } else {
      manualInputsContainer.style.display = 'none';
      accordionArrow.textContent = '▼';
    }
  });

  // Render các ô nhập thủ công
  function renderManualClipRanges() {
    clipRangesList.innerHTML = '';

    manualClipRanges.forEach((range, idx) => {
      const row = document.createElement('div');
      row.className = 'clip-range-row';

      row.innerHTML = `
        <span style="font-size: 11px; color: #64748b; font-weight: 600;">#${idx + 1}:</span>
        <div class="clip-range-inputs">
          <input type="text" class="input-start" value="${range.startStr}" placeholder="Từ (00:00)">
          <button class="time-cap-btn cap-start-btn" title="Lấy vị trí hiện tại">⏱️</button>
          <span class="range-sep">-</span>
          <input type="text" class="input-end" value="${range.endStr}" placeholder="Đến (01:30)">
          <button class="time-cap-btn cap-end-btn" title="Lấy vị trí hiện tại">⏱️</button>
        </div>
        ${
          manualClipRanges.length > 0
            ? `<button class="remove-range-btn" title="Xóa">&times;</button>`
            : ''
        }
      `;

      const inputStart = row.querySelector('.input-start');
      const inputEnd = row.querySelector('.input-end');
      const capStartBtn = row.querySelector('.cap-start-btn');
      const capEndBtn = row.querySelector('.cap-end-btn');

      inputStart.addEventListener('input', (e) => (range.startStr = e.target.value));
      inputEnd.addEventListener('input', (e) => (range.endStr = e.target.value));

      capStartBtn.addEventListener('click', () => {
        const formatted = formatTime(detailPreviewPlayer.currentTime);
        range.startStr = formatted;
        inputStart.value = formatted;
      });

      capEndBtn.addEventListener('click', () => {
        const formatted = formatTime(detailPreviewPlayer.currentTime);
        range.endStr = formatted;
        inputEnd.value = formatted;
      });

      const removeBtn = row.querySelector('.remove-range-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          manualClipRanges.splice(idx, 1);
          renderManualClipRanges();
        });
      }

      clipRangesList.appendChild(row);
    });
  }

  addRangeBtn.addEventListener('click', () => {
    manualClipRanges.push({
      id: 'man_' + Math.random().toString(36).substr(2, 6),
      startStr: '',
      endStr: ''
    });
    renderManualClipRanges();
  });

  // 6. View Switcher (ListView vs DetailView)
  function showListView() {
    detailPreviewPlayer.pause();
    detailPreviewPlayer.removeAttribute('src');
    detailPreviewPlayer.load();

    detailView.style.display = 'none';
    listView.style.display = 'block';
    selectedMedia = null;
    loadMediaList();
  }

  function showDetailView(item) {
    selectedMedia = item;
    listView.style.display = 'none';
    detailView.style.display = 'block';

    detailTitle.textContent = item.title || 'Video File';
    detailBadge.textContent = item.format || 'MP4';
    detailBadge.className = `detail-badge ${
      item.format === 'M3U8' ? 'badge-m3u8' : item.format === 'WEBM' ? 'badge-webm' : 'badge-mp4'
    }`;

    detailDuration.textContent = formatTime(item.duration);
    detailResolution.textContent = item.resolution || 'N/A';
    detailSize.textContent =
      item.type === 'HLS'
        ? item.segmentCount > 0
          ? `${item.segmentCount} phân đoạn`
          : 'HLS Stream'
        : formatBytes(item.sizeBytes);

    detailPreviewPlayer.src = item.url;
    detailPreviewPlayer.play().catch(() => {});

    copyUrlBtn.onclick = () => {
      navigator.clipboard.writeText(item.url);
      copyUrlBtn.textContent = 'Đã sao chép!';
      setTimeout(() => (copyUrlBtn.textContent = 'Sao chép URL'), 2000);
    };

    if (item.type === 'HLS') {
      timelineClipperBox.style.display = 'block';
      savedClipRanges = [];
      manualClipRanges = [];
      resetTimelineClipperState();
      renderSavedChips();
      renderManualClipRanges();
    } else {
      timelineClipperBox.style.display = 'none';
    }

    detailProgBox.style.display = 'none';
    detailDownloadBtn.disabled = false;
  }

  // 7. Header Buttons (Side Panel & Floating Window)
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      activeTabId = tabs[0].id;
      activeWindowId = tabs[0].windowId;
      if (tabs[0].title) {
        tabIndicator.textContent = tabs[0].title.substring(0, 30) + '...';
      }
    }
  } catch (err) {
    console.error('Không thể lấy tabId:', err);
  }

  // Nút mở Side Panel (Ghim lề phải)
  openSidePanelBtn.addEventListener('click', async () => {
    try {
      if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
        const currentWin = await chrome.windows.getCurrent();
        if (currentWin && currentWin.id) {
          await chrome.sidePanel.open({ windowId: currentWin.id });
          window.close();
          return;
        }
      }
    } catch (err) {
      console.warn('Fallback sidepanel error:', err);
    }
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?mode=sidepanel') });
    window.close();
  });

  // 8. Tải danh sách Video của Tab
  async function loadMediaList() {
    if (!activeTabId) return;

    chrome.runtime.sendMessage(
      { action: 'GET_MEDIA_LIST', tabId: activeTabId },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError);
          return;
        }

        if (response && response.success && Array.isArray(response.data)) {
          renderVideoList(response.data);
        } else {
          renderVideoList([]);
        }
      }
    );
  }

  function renderVideoList(mediaItems) {
    videoListEl.innerHTML = '';

    if (mediaItems.length === 0) {
      videoListEl.appendChild(emptyStateEl);
      emptyStateEl.style.display = 'flex';
      return;
    }

    emptyStateEl.style.display = 'none';

    mediaItems.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'video-card';

      const formatClass =
        item.format === 'M3U8' ? 'badge-m3u8' : item.format === 'WEBM' ? 'badge-webm' : 'badge-mp4';

      const sizeOrSegments =
        item.type === 'HLS'
          ? item.segmentCount > 0
            ? `${item.segmentCount} phân đoạn`
            : 'HLS Stream'
          : formatBytes(item.sizeBytes);

      card.innerHTML = `
        <div class="card-header">
          <div class="video-title" title="${item.title}">${item.title}</div>
          <span class="badge ${formatClass}">${item.format}</span>
        </div>
        <div class="specs-row">
          <span class="spec-item">⏱️ ${formatTime(item.duration)}</span>
          <span class="spec-item">📐 ${item.resolution}</span>
          <span class="spec-item">📦 ${sizeOrSegments}</span>
        </div>
        <div class="card-footer-hint">
          <span>👉 Nhấp để mở trang chi tiết & tải xuống</span>
          <span>➔</span>
        </div>
      `;

      card.addEventListener('click', () => {
        showDetailView(item);
      });

      videoListEl.appendChild(card);
    });
  }

  // 9. Nút Tải về MP4 trong Trang Chi Tiết
  detailDownloadBtn.addEventListener('click', async () => {
    if (!selectedMedia) return;

    detailDownloadBtn.disabled = true;
    detailProgBox.style.display = 'block';
    detailProgMsg.style.color = '#cbd5e1';

    try {
      if (selectedMedia.type === 'DIRECT') {
        detailProgMsg.textContent = 'Đang tải file MP4...';
        detailProgPct.textContent = '50%';
        detailProgFill.style.width = '50%';

        await DirectDownloader.download(
          selectedMedia.url,
          selectedMedia.title,
          selectedMedia.format.toLowerCase()
        );

        detailProgMsg.textContent = 'Tải thành công!';
        detailProgPct.textContent = '100%';
        detailProgFill.style.width = '100%';
      } else if (selectedMedia.type === 'HLS') {
        const downloader = new M3U8Downloader();
        const downloadOptions = {};

        // Tổng hợp tất cả các khoảng thời gian cắt hợp lệ (từ Chip đã lưu + Ô thủ công)
        // Lưu ý: Nếu chỉ bấm Bắt đầu mà chưa bấm Kết thúc thì mốc đó tự hủy (chỉ tính savedClipRanges)
        const parsedRanges = [];

        // 1. Thêm các khoảng đã lưu từ Timeline state machine
        savedClipRanges.forEach((chip) => {
          parsedRanges.push({
            startSec: chip.startSec,
            endSec: chip.endSec
          });
        });

        // 2. Thêm các khoảng từ ô thủ công (nếu người dùng có mở và nhập)
        manualClipRanges.forEach((range) => {
          const startSec = parseTimeStringToSeconds(range.startStr);
          const endSec = parseTimeStringToSeconds(range.endStr);

          if (startSec !== null || endSec !== null) {
            parsedRanges.push({
              startSec: startSec !== null ? startSec : 0,
              endSec: endSec !== null ? endSec : Infinity
            });
          }
        });

        if (parsedRanges.length > 0) {
          downloadOptions.timeRanges = parsedRanges;
        }

        await downloader.download(
          selectedMedia.url,
          selectedMedia.title,
          (progress) => {
            detailProgMsg.textContent = progress.message || 'Đang xử lý...';
            detailProgPct.textContent = `${progress.percent || 0}%`;
            detailProgFill.style.width = `${progress.percent || 0}%`;
          },
          downloadOptions
        );
      }
    } catch (err) {
      console.error('Lỗi tải video:', err);
      detailProgMsg.textContent = `Lỗi: ${err.message}`;
      detailProgMsg.style.color = '#EF4444';
      detailDownloadBtn.disabled = false;
    }
  });

  // Navigation & Refresh Actions
  backToListBtn.addEventListener('click', showListView);
  refreshBtn.addEventListener('click', loadMediaList);
  clearBtn.addEventListener('click', () => {
    if (!activeTabId) return;
    chrome.runtime.sendMessage({ action: 'CLEAR_TAB_MEDIA', tabId: activeTabId }, () => {
      if (selectedMedia) {
        showListView();
      } else {
        loadMediaList();
      }
    });
  });

  // App init
  loadMediaList();
});
