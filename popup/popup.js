import { formatTime, formatBytes, parseTimeStringToSeconds } from '../utils/formatters.js';
import { DirectDownloader } from '../utils/direct-downloader.js';
import { M3U8Downloader } from '../utils/m3u8-downloader.js';

document.addEventListener('DOMContentLoaded', async () => {
  const listView = document.getElementById('listView');
  const detailView = document.getElementById('detailView');
  const videoListEl = document.getElementById('videoList');
  const emptyStateEl = document.getElementById('emptyState');
  const backToListBtn = document.getElementById('backToListBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const clearBtn = document.getElementById('clearBtn');
  const openSidePanelBtn = document.getElementById('openSidePanelBtn');
  const tabIndicator = document.getElementById('tabIndicator');

  const detailTitle = document.getElementById('detailTitle');
  const detailBadge = document.getElementById('detailBadge');
  const detailPreviewPlayer = document.getElementById('detailPreviewPlayer');
  const detailDuration = document.getElementById('detailDuration');
  const detailResolution = document.getElementById('detailResolution');
  const detailSize = document.getElementById('detailSize');
  const copyUrlBtn = document.getElementById('copyUrlBtn');

  const timelineClipperBox = document.getElementById('timelineClipperBox');
  const timelineStateBtn = document.getElementById('timelineStateBtn');
  const stateBtnIcon = document.getElementById('stateBtnIcon');
  const stateBtnText = document.getElementById('stateBtnText');
  const currPlayerTimeLabel = document.getElementById('currPlayerTimeLabel');
  const clipToEndBtn = document.getElementById('clipToEndBtn');
  const cancelClipStateBtn = document.getElementById('cancelClipStateBtn');
  const timelineStatusInfo = document.getElementById('timelineStatusInfo');

  const savedChipsWrapper = document.getElementById('savedChipsWrapper');
  const savedChipsCount = document.getElementById('savedChipsCount');
  const savedChipsContainer = document.getElementById('savedChipsContainer');
  const clearChipsBtn = document.getElementById('clearChipsBtn');
  const accordionToggleBtn = document.getElementById('accordionToggleBtn');
  const accordionArrow = document.getElementById('accordionArrow');
  const manualInputsContainer = document.getElementById('manualInputsContainer');
  const clipRangesList = document.getElementById('clipRangesList');
  const addRangeBtn = document.getElementById('addRangeBtn');

  const detailDownloadBtn = document.getElementById('detailDownloadBtn');
  const detailProgBox = document.getElementById('detailProgBox');
  const detailProgMsg = document.getElementById('detailProgMsg');
  const detailProgPct = document.getElementById('detailProgPct');
  const detailProgFill = document.getElementById('detailProgFill');

  // Lấy tham chiếu đến dropdown chọn định dạng
  const formatSelect = document.getElementById('formatSelect');

  let activeTabId = null;
  let activeTabUrl = null;
  let selectedMedia = null;
  let clipState = 'WAITING_START';
  let pendingStartSec = null;
  let pendingStartStr = '';
  let savedClipRanges = [];
  let manualClipRanges = [];

  async function getCurrentVideoTab() {
    try {
      let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tabs && tabs[0] && !tabs[0].url?.includes('popup.html') && !tabs[0].url?.startsWith('chrome://')) return tabs[0];
      tabs = await chrome.tabs.query({ active: true });
      const validTab = tabs?.find(t => t.url && !t.url.includes('popup.html') && !t.url.startsWith('chrome://'));
      if (validTab) return validTab;
    } catch { }
    return null;
  }

  async function refreshActiveTab() {
    const tab = await getCurrentVideoTab();
    if (tab && tab.id) {
      const isNewTab = activeTabId !== tab.id;
      activeTabId = tab.id;
      activeTabUrl = tab.url;
      if (tab.title) tabIndicator.textContent = tab.title.substring(0, 30) + '...';
      console.log(`[VDP-Popup] 📌 Active tab: id=${activeTabId}, title="${tab.title}", url=${activeTabUrl?.substring(0, 80)}`);
      if (isNewTab || detailView.style.display === 'none') loadMediaList();
    }
  }

  if (chrome.tabs?.onActivated) {
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab && tab.url && !tab.url.includes('popup.html') && !tab.url.startsWith('chrome://')) {
          activeTabId = tab.id;
          activeTabUrl = tab.url;
          if (tab.title) tabIndicator.textContent = tab.title.substring(0, 30) + '...';
          console.log(`[VDP-Popup] 🔀 Đã chuyển sang Tab mới: id=${activeTabId}, title="${tab.title}"`);
          showListView();
        }
      } catch (_) { }
    });
  }

  if (chrome.tabs?.onUpdated) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (tabId === activeTabId) {
        if (changeInfo.title) tabIndicator.textContent = tab.title.substring(0, 30) + '...';
        if (changeInfo.status === 'complete' && detailView.style.display === 'none') loadMediaList();
      }
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'MEDIA_UPDATED' && message.tabId === activeTabId) {
      console.log(`[VDP-Popup] 🔔 MEDIA_UPDATED tabId=${message.tabId}`);
      loadMediaList();
    }
  });

  detailPreviewPlayer.addEventListener('timeupdate', () => {
    const f = formatTime(detailPreviewPlayer.currentTime);
    if (currPlayerTimeLabel) currPlayerTimeLabel.textContent = f === 'N/A' ? '00:00' : f;
  });

  function resetTimelineClipperState() {
    clipState = 'WAITING_START'; pendingStartSec = null; pendingStartStr = '';
    stateBtnIcon.textContent = '🟢'; stateBtnText.textContent = '1. Đặt Bắt đầu';
    timelineStateBtn.className = 'state-btn start-state';
    clipToEndBtn.style.display = 'none'; cancelClipStateBtn.style.display = 'none';
    timelineStatusInfo.textContent = 'Bấm [1. Đặt Bắt đầu] tại mốc thời gian muốn cắt.';
    timelineStatusInfo.className = 'timeline-status-info';
  }

  timelineStateBtn.addEventListener('click', () => {
    const currentTime = detailPreviewPlayer.currentTime || 0;
    const formattedTime = formatTime(currentTime) === 'N/A' ? '00:00' : formatTime(currentTime);
    if (clipState === 'WAITING_START') {
      clipState = 'WAITING_END'; pendingStartSec = currentTime; pendingStartStr = formattedTime;
      stateBtnIcon.textContent = '🔴'; stateBtnText.textContent = `2. Đặt Kết thúc (đang chờ)`;
      timelineStateBtn.className = 'state-btn end-state'; clipToEndBtn.style.display = 'inline-flex'; cancelClipStateBtn.style.display = 'inline-flex';
      timelineStatusInfo.textContent = `▶ Đã chọn Bắt đầu tại [${pendingStartStr}]. Tua tới mốc dừng rồi bấm [2. Đặt Kết thúc].`;
      timelineStatusInfo.className = 'timeline-status-info active-start';
    } else if (clipState === 'WAITING_END') {
      const endSec = currentTime, endStr = formattedTime;
      if (endSec <= pendingStartSec) { timelineStatusInfo.textContent = `⚠ Kết thúc (${endStr}) phải lớn hơn bắt đầu (${pendingStartStr})!`; return; }
      savedClipRanges.push({ id: 'chip_' + Date.now(), startSec: pendingStartSec, endSec, startStr: pendingStartStr, endStr: endStr });
      renderSavedChips(); resetTimelineClipperState();
    }
  });
  clipToEndBtn.addEventListener('click', () => {
    if (clipState === 'WAITING_END' && pendingStartSec !== null) {
      savedClipRanges.push({ id: 'chip_' + Date.now(), startSec: pendingStartSec, endSec: Infinity, startStr: pendingStartStr, endStr: 'Hết video' });
      renderSavedChips(); resetTimelineClipperState();
    }
  });
  cancelClipStateBtn.addEventListener('click', resetTimelineClipperState);
  clearChipsBtn.addEventListener('click', () => { savedClipRanges = []; renderSavedChips(); });

  function renderSavedChips() {
    savedChipsContainer.innerHTML = ''; savedChipsCount.textContent = savedClipRanges.length;
    savedChipsWrapper.style.display = savedClipRanges.length ? 'block' : 'none';
    savedClipRanges.forEach((chip, idx) => {
      const el = document.createElement('div'); el.className = 'saved-chip';
      el.innerHTML = `<span>✂ Đoạn ${idx + 1}: ${chip.startStr} ➔ ${chip.endStr}</span><button class="chip-remove-btn">&times;</button>`;
      el.querySelector('.chip-remove-btn').addEventListener('click', () => { savedClipRanges.splice(idx, 1); renderSavedChips(); });
      savedChipsContainer.appendChild(el);
    });
  }

  accordionToggleBtn.addEventListener('click', () => {
    const isHidden = manualInputsContainer.style.display === 'none';
    manualInputsContainer.style.display = isHidden ? 'block' : 'none';
    accordionArrow.textContent = isHidden ? '▲' : '▼';
  });

  function renderManualClipRanges() {
    clipRangesList.innerHTML = '';
    manualClipRanges.forEach((range, idx) => {
      const row = document.createElement('div'); row.className = 'clip-range-row';
      row.innerHTML = `<span style="font-size:11px;color:#64748b;font-weight:600;">#${idx + 1}:</span><div class="clip-range-inputs"><input type="text" class="input-start" value="${range.startStr}" placeholder="Từ (00:00)"><button class="time-cap-btn cap-start-btn">⏱</button><span class="range-sep">-</span><input type="text" class="input-end" value="${range.endStr}" placeholder="Đến (01:30)"><button class="time-cap-btn cap-end-btn">⏱</button></div><button class="remove-range-btn">&times;</button>`;
      const inputStart = row.querySelector('.input-start'), inputEnd = row.querySelector('.input-end');
      inputStart.addEventListener('input', (e) => range.startStr = e.target.value);
      inputEnd.addEventListener('input', (e) => range.endStr = e.target.value);
      row.querySelector('.cap-start-btn').addEventListener('click', () => { const f = formatTime(detailPreviewPlayer.currentTime); range.startStr = f === 'N/A' ? '00:00' : f; inputStart.value = range.startStr; });
      row.querySelector('.cap-end-btn').addEventListener('click', () => { const f = formatTime(detailPreviewPlayer.currentTime); range.endStr = f === 'N/A' ? '00:00' : f; inputEnd.value = range.endStr; });
      row.querySelector('.remove-range-btn').addEventListener('click', () => { manualClipRanges.splice(idx, 1); renderManualClipRanges(); });
      clipRangesList.appendChild(row);
    });
  }
  addRangeBtn.addEventListener('click', () => { manualClipRanges.push({ id: 'man_' + Math.random().toString(36).substr(2, 6), startStr: '', endStr: '' }); renderManualClipRanges(); });

  function showListView() {
    detailPreviewPlayer.pause(); detailPreviewPlayer.removeAttribute('src'); detailPreviewPlayer.load();
    detailView.style.display = 'none'; listView.style.display = 'block'; selectedMedia = null; loadMediaList();
  }
  function showDetailView(item) {
    selectedMedia = item; listView.style.display = 'none'; detailView.style.display = 'block';
    console.log(`[VDP-Popup] 🎬 Chọn video: "${item.title}" (${item.format}) - ${item.url}`);
    detailTitle.textContent = item.title || 'Video File';
    detailBadge.textContent = item.format || 'MP4';
    detailBadge.className = `detail-badge ${item.format === 'M3U8' ? 'badge-m3u8' : item.format === 'WEBM' ? 'badge-webm' : 'badge-mp4'}`;
    detailDuration.textContent = formatTime(item.duration) === 'N/A' ? '00:00' : formatTime(item.duration);
    detailResolution.textContent = item.resolution || 'N/A';
    detailSize.textContent = item.type === 'HLS' ? (item.segmentCount > 0 ? `${item.segmentCount} phân đoạn` : 'HLS Stream') : formatBytes(item.sizeBytes);
    detailPreviewPlayer.src = item.url; detailPreviewPlayer.play().catch(() => { });
    copyUrlBtn.onclick = () => { navigator.clipboard.writeText(item.url); copyUrlBtn.textContent = 'Đã sao chép!'; setTimeout(() => copyUrlBtn.textContent = 'Sao chép URL', 2000); };
    if (item.type === 'HLS') { timelineClipperBox.style.display = 'block'; savedClipRanges = []; manualClipRanges = []; resetTimelineClipperState(); renderSavedChips(); renderManualClipRanges(); }
    else timelineClipperBox.style.display = 'none';
    detailProgBox.style.display = 'none'; detailDownloadBtn.disabled = false;
  }

  await refreshActiveTab();

  openSidePanelBtn.addEventListener('click', async () => {
    try {
      if (chrome.sidePanel?.open) {
        const currentWin = await chrome.windows.getCurrent();
        if (currentWin?.id) { await chrome.sidePanel.open({ windowId: currentWin.id }); window.close(); return; }
      }
    } catch { }
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?mode=sidepanel') }); window.close();
  });

  async function loadMediaList() {
    if (!activeTabId) return;
    chrome.runtime.sendMessage({ action: 'GET_MEDIA_LIST', tabId: activeTabId }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.success && Array.isArray(response.data)) renderVideoList(response.data);
      else renderVideoList([]);
    });
  }
  function renderVideoList(mediaItems) {
    videoListEl.innerHTML = '';
    if (!mediaItems.length) { videoListEl.appendChild(emptyStateEl); emptyStateEl.style.display = 'flex'; return; }
    emptyStateEl.style.display = 'none';
    mediaItems.forEach((item, index) => {
      const card = document.createElement('div'); card.className = 'video-card';
      const formatClass = item.format === 'M3U8' ? 'badge-m3u8' : item.format === 'WEBM' ? 'badge-webm' : 'badge-mp4';
      const sizeOrSegments = item.type === 'HLS' ? (item.segmentCount > 0 ? `${item.segmentCount} phân đoạn` : 'HLS Stream') : formatBytes(item.sizeBytes);
      const isNewest = index === 0 && mediaItems.length > 1;
      const dur = formatTime(item.duration) === 'N/A' ? '00:00' : formatTime(item.duration);
      card.innerHTML = `<div class="card-header"><div class="video-title" title="${item.title}">${item.title}</div><div class="card-badges">${isNewest ? '<span class="new-badge">MỚI</span>' : ''}<span class="badge ${formatClass}">${item.format}</span></div></div><div class="specs-row"><span class="spec-item">⏱ ${dur}</span><span class="spec-item">📐 ${item.resolution}</span><span class="spec-item">📦 ${sizeOrSegments}</span></div><div class="card-footer-hint"><span>👉 Nhấp để mở chi tiết & tải</span><span>➔</span></div>`;
      card.addEventListener('click', () => showDetailView(item)); videoListEl.appendChild(card);
    });
  }

  detailDownloadBtn.addEventListener('click', async () => {
    if (!selectedMedia) return;
    // Lấy định dạng được chọn
    const outputFormat = formatSelect ? formatSelect.value : 'mp4';
    console.log(`[VDP-Popup] ⬇ Tải "${selectedMedia.title}" định dạng: ${outputFormat}`);
    detailDownloadBtn.disabled = true; detailProgBox.style.display = 'block'; detailProgMsg.style.color = '#cbd5e1';
    try {
      if (selectedMedia.type === 'DIRECT') {
        // Direct download chỉ hỗ trợ MP4/WEBM, không áp dụng TS
        detailProgMsg.textContent = 'Đang tải MP4...'; detailProgPct.textContent = '50%'; detailProgFill.style.width = '50%';
        await DirectDownloader.download(selectedMedia.url, selectedMedia.title, selectedMedia.format.toLowerCase());
        detailProgMsg.textContent = '✅ Tải thành công!'; detailProgPct.textContent = '100%'; detailProgFill.style.width = '100%';
      } else if (selectedMedia.type === 'HLS') {
        const downloader = new M3U8Downloader();
        const downloadOptions = { tabId: activeTabId, tabUrl: activeTabUrl, outputFormat };
        const parsedRanges = [];
        savedClipRanges.forEach((chip) => parsedRanges.push({ startSec: chip.startSec, endSec: chip.endSec }));
        manualClipRanges.forEach((range) => {
          const startSec = parseTimeStringToSeconds(range.startStr), endSec = parseTimeStringToSeconds(range.endStr);
          if (startSec !== null || endSec !== null) parsedRanges.push({ startSec: startSec !== null ? startSec : 0, endSec: endSec !== null ? endSec : Infinity });
        });
        if (parsedRanges.length) {
          downloadOptions.timeRanges = parsedRanges;
          detailProgMsg.textContent = `Chuẩn bị tải ${parsedRanges.length} khoảng cắt...`;
        } else {
          detailProgMsg.textContent = 'Đang phân tích playlist...';
        }
        await downloader.download(selectedMedia.url, selectedMedia.title, (progress) => {
          detailProgMsg.textContent = progress.message || 'Đang xử lý...'; detailProgPct.textContent = `${progress.percent || 0}%`; detailProgFill.style.width = `${progress.percent || 0}%`;
          if (progress.status === 'completed') detailProgMsg.style.color = '#34d399';
          if (progress.status === 'error') {
            detailProgMsg.style.color = '#EF4444';
            detailDownloadBtn.disabled = false;
          }
        }, downloadOptions);
      }
    } catch (err) {
      const msg = err?.message || (err && err.toString && err.toString()) || 'Unknown error';
      console.error('[VDP-Popup] ❌ Lỗi tải video:', msg, err);
      detailProgMsg.textContent = `Lỗi: ${msg}`;
      detailProgMsg.style.color = '#EF4444';
      detailDownloadBtn.disabled = false;
      // Ẩn progress sau 3 giây
      setTimeout(() => {
        detailProgBox.style.display = 'none';
      }, 3000);
    }
  });

  backToListBtn.addEventListener('click', showListView);
  refreshBtn.addEventListener('click', loadMediaList);
  clearBtn.addEventListener('click', () => {
    if (!activeTabId) return;
    chrome.runtime.sendMessage({ action: 'CLEAR_TAB_MEDIA', tabId: activeTabId }, () => { if (selectedMedia) showListView(); else loadMediaList(); });
  });
  loadMediaList();
});