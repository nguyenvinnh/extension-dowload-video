import { M3U8Parser } from '../lib/m3u8-parser.js';
import { AESDecryptor } from '../utils/aes-decryptor.js';
import { TSBuilder } from '../utils/ts-builder.js';
import { FMP4Builder } from '../utils/fmp4-builder.js';
import { BufferUtils } from '../utils/buffer-utils.js';
import { StreamInspector } from '../utils/stream-inspector.js';
import { FetchProxy } from '../utils/fetch-proxy.js';

// DOM elements
const m3u8UrlInput = document.getElementById('m3u8Url');
const parseBtn = document.getElementById('parseBtn');
const fileUpload = document.getElementById('fileUpload');
const keyInput = document.getElementById('keyInput');
const ivInput = document.getElementById('ivInput');
const segmentListDiv = document.getElementById('segmentList');
const segCountSpan = document.getElementById('segCount');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const fetchDecryptBtn = document.getElementById('fetchDecryptBtn');
const convertMp4Btn = document.getElementById('convertMp4Btn');
const downloadTsBtn = document.getElementById('downloadTsBtn');
const downloadMp4Btn = document.getElementById('downloadMp4Btn');
const clearDataBtn = document.getElementById('clearDataBtn');
const logContainer = document.getElementById('logContainer');
const clearLogBtn = document.getElementById('clearLogBtn');
const backToPopupBtn = document.getElementById('backToPopupBtn');

// State
let segments = []; // array of { url, encryption, duration, index, ... }
let selectedIndices = new Set();
let decryptedBuffers = []; // ArrayBuffer[] cho các segment đã giải mã (theo thứ tự)
let isDecrypted = false;
let mp4Blob = null;

// Helper: log
function log(msg, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  const timestamp = new Date().toLocaleTimeString();
  entry.textContent = `[${timestamp}] ${msg}`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

// Clear log
clearLogBtn.addEventListener('click', () => {
  logContainer.innerHTML = '';
});

// Back to popup
backToPopupBtn.addEventListener('click', () => {
  if (typeof chrome !== 'undefined' && chrome?.tabs) {
    chrome.tabs.getCurrent((tab) => {
      if (tab) chrome.tabs.remove(tab.id);
    });
  } else {
    window.close();
  }
});

// Parse M3U8
parseBtn.addEventListener('click', async () => {
  const url = m3u8UrlInput.value.trim();
  if (!url) {
    log('Vui lòng nhập URL M3U8', 'error');
    return;
  }
  log(`Đang phân tích M3U8: ${url}`, 'info');
  try {
    // Lấy active tab để có referer
    let tabId = null, tabUrl = null;
    if (typeof chrome !== 'undefined' && chrome?.tabs) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs.find(t => t.url && !t.url.startsWith('chrome-extension://'));
      tabId = tab?.id || null;
      tabUrl = tab?.url || null;
    }

    const playlist = await M3U8Parser.parse(url, { tabId, tabUrl });
    if (!playlist.segments || playlist.segments.length === 0) {
      throw new Error('Không tìm thấy segment nào trong playlist');
    }

    segments = playlist.segments.map((seg, idx) => ({
      ...seg,
      index: idx,
      url: seg.url,
      encryption: seg.encryption || null,
      duration: seg.duration || 0,
    }));

    selectedIndices = new Set(segments.map((_, i) => i));
    isDecrypted = false;
    decryptedBuffers = [];
    mp4Blob = null;

    renderSegments();
    updateButtons();
    log(`✅ Đã tải thành công ${segments.length} segment`, 'success');
    if (playlist.hasAES128) {
      log('🔐 Playlist có mã hóa AES-128, cần nhập key và IV (nếu có)', 'warn');
    } else {
      log('ℹ️ Playlist không mã hóa (hoặc không AES-128)', 'info');
    }
  } catch (err) {
    log(`❌ Lỗi phân tích M3U8: ${err.message}`, 'error');
    console.error(err);
  }
});

// Reset file input value khi click để hỗ trợ chọn lại cùng 1 file
fileUpload.addEventListener('click', () => {
  fileUpload.value = '';
});

// Upload file .ts
fileUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  log(`Đang đọc file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)...`, 'info');
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const buf = ev.target.result;
      // Tạo segment giả
      segments = [{
        index: 0,
        url: file.name,
        encryption: null,
        duration: 0,
        data: buf, // lưu dữ liệu
        isUploaded: true,
      }];
      selectedIndices = new Set([0]);
      decryptedBuffers = [buf]; // Tự động gán dữ liệu cho buffer
      isDecrypted = true;      // Tự động đánh dấu đã sẵn sàng chuyển đổi/tải về
      mp4Blob = null;
      renderSegments();
      updateButtons();
      log(`✅ Đã nạp file .ts (${buf.byteLength} bytes) - Nút "Chuyển thành MP4" đã được kích hoạt!`, 'success');
    } catch (err) {
      log(`❌ Lỗi nạp file: ${err.message}`, 'error');
      console.error(err);
    }
  };
  reader.onerror = () => {
    log('❌ Lỗi đọc file từ đĩa', 'error');
  };
  reader.readAsArrayBuffer(file);
});

// Render segment list
function renderSegments() {
  segmentListDiv.innerHTML = '';
  if (!segments.length) {
    segmentListDiv.innerHTML = '<p class="placeholder">Chưa có segment. Hãy phân tích M3U8 hoặc tải file .ts.</p>';
    segCountSpan.textContent = '0';
    return;
  }
  segCountSpan.textContent = segments.length;
  segments.forEach((seg, idx) => {
    const div = document.createElement('div');
    div.className = 'segment-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selectedIndices.has(idx);
    cb.addEventListener('change', () => {
      if (cb.checked) selectedIndices.add(idx);
      else selectedIndices.delete(idx);
      updateButtons();
    });
    const urlSpan = document.createElement('span');
    urlSpan.className = 'seg-url';
    urlSpan.textContent = seg.isUploaded ? '[Uploaded]' : seg.url.substring(0, 80) + (seg.url.length > 80 ? '…' : '');
    const infoSpan = document.createElement('span');
    infoSpan.className = 'seg-info';
    const dur = seg.duration ? seg.duration.toFixed(2) + 's' : '';
    infoSpan.textContent = `#${idx} ${dur}`;
    const encSpan = document.createElement('span');
    encSpan.className = 'seg-enc';
    encSpan.textContent = seg.encryption ? '🔐' : '';
    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'seg-size';
    if (seg.data) sizeSpan.textContent = (seg.data.byteLength / 1024).toFixed(1) + ' KB';
    else sizeSpan.textContent = '';
    div.appendChild(cb);
    div.appendChild(urlSpan);
    div.appendChild(infoSpan);
    div.appendChild(encSpan);
    div.appendChild(sizeSpan);
    segmentListDiv.appendChild(div);
  });
}

// Update button states
function updateButtons() {
  const hasSelected = selectedIndices.size > 0;
  fetchDecryptBtn.disabled = !hasSelected || segments.length === 0;
  convertMp4Btn.disabled = !isDecrypted || decryptedBuffers.length === 0;
  downloadTsBtn.disabled = !isDecrypted || decryptedBuffers.length === 0;
  downloadMp4Btn.disabled = !mp4Blob;
}

// Select / deselect all
selectAllBtn.addEventListener('click', () => {
  selectedIndices = new Set(segments.map((_, i) => i));
  renderSegments();
  updateButtons();
});

deselectAllBtn.addEventListener('click', () => {
  selectedIndices.clear();
  renderSegments();
  updateButtons();
});

// Fetch & decrypt selected
fetchDecryptBtn.addEventListener('click', async () => {
  const indices = Array.from(selectedIndices).sort((a, b) => a - b);
  if (indices.length === 0) {
    log('Chưa chọn segment nào', 'warn');
    return;
  }

  // Kiểm tra key nếu có mã hóa
  const hasEnc = segments.some((seg, i) => selectedIndices.has(i) && seg.encryption);
  let keyBuf = null;
  let ivHex = null;
  if (hasEnc) {
    const keyHex = keyInput.value.trim();
    const ivHexInput = ivInput.value.trim();
    if (!keyHex || keyHex.length !== 32) {
      log('Vui lòng nhập Key hex 32 ký tự (16 bytes)', 'error');
      return;
    }
    if (!ivHexInput || ivHexInput.length !== 32) {
      log('Vui lòng nhập IV hex 32 ký tự (16 bytes)', 'error');
      return;
    }
    try {
      keyBuf = new Uint8Array(keyHex.match(/.{1,2}/g).map(b => parseInt(b, 16))).buffer;
      ivHex = ivHexInput;
    } catch (e) {
      log('Key hoặc IV không đúng định dạng hex', 'error');
      return;
    }
  }

  log(`Bắt đầu tải và giải mã ${indices.length} segment...`, 'info');
  fetchDecryptBtn.disabled = true;
  fetchDecryptBtn.textContent = 'Đang tải...';

  try {
    const fetchProxy = new FetchProxy();
    // Lấy active tab để có referer
    if (typeof chrome !== 'undefined' && chrome?.tabs) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs.find(t => t.url && !t.url.startsWith('chrome-extension://'));
      if (tab) {
        fetchProxy.setTabInfo(tab.id, tab.url, tab.url);
        await fetchProxy.ensureRefererRule();
      }
    }

    const aesDecryptor = new AESDecryptor((url, isKey) => fetchProxy.fetchRaw(url, isKey));

    const results = [];
    let total = indices.length;
    let completed = 0;

    for (const idx of indices) {
      const seg = segments[idx];
      try {
        let data;
        if (seg.isUploaded && seg.data) {
          data = seg.data;
        } else {
          // Tải segment
          log(`Tải segment #${idx}: ${seg.url.substring(0, 60)}...`, 'info');
          data = await fetchProxy.fetchRaw(seg.url, false);
          if (BufferUtils.isErrorResponse(data)) {
            throw new Error(`Phản hồi lỗi (${data.byteLength} bytes)`);
          }
        }

        // Giải mã nếu có
        let decrypted = data;
        if (seg.encryption && seg.encryption.method === 'AES-128') {
          // Nếu user đã nhập key/IV, dùng nó, nếu không dùng thông tin từ seg
          let encInfo = seg.encryption;
          if (keyBuf) {
            // Ghi đè keyUrl và iv
            encInfo = { ...encInfo, keyUrl: 'manual', iv: ivHex };
            // Tạm thời thêm key vào cache của decryptor
            // Nhưng AESDecryptor dùng fetch để lấy key, ta cần truyền key trực tiếp
            // Cách đơn giản: ta tự giải mã ở đây thay vì dùng AESDecryptor?
            // Ta sẽ sử dụng AESDecryptor nhưng cần override fetchKey
            // Ta có thể tạo một AESDecryptor với fetchRaw tùy chỉnh trả về keyBuf
            const customFetch = async (url, isKey) => {
              if (isKey && url === 'manual') return keyBuf;
              return fetchProxy.fetchRaw(url, isKey);
            };
            const customDecryptor = new AESDecryptor(customFetch);
            decrypted = await customDecryptor.decrypt(data, encInfo);
          } else {
            // Dùng thông tin có sẵn, AESDecryptor sẽ tự tải key
            decrypted = await aesDecryptor.decrypt(data, encInfo);
          }
          log(`✅ Segment #${idx} đã giải mã AES-128`, 'success');
        } else if (seg.encryption) {
          log(`⚠️ Segment #${idx} có mã hóa phương thức ${seg.encryption.method} không hỗ trợ`, 'warn');
          decrypted = data; // vẫn giữ nguyên
        } else {
          log(`Segment #${idx} không mã hóa`, 'info');
        }

        results.push({ index: idx, data: decrypted });
        completed++;
        log(`Tiến độ: ${completed}/${total} segment`, 'info');
      } catch (err) {
        log(`❌ Lỗi segment #${idx}: ${err.message}`, 'error');
        // Tiếp tục
      }
    }

    // Sắp xếp lại theo index
    results.sort((a, b) => a.index - b.index);
    decryptedBuffers = results.map(r => r.data);
    isDecrypted = true;
    mp4Blob = null;
    log(`✅ Đã giải mã thành công ${decryptedBuffers.length} segment`, 'success');
    updateButtons();
  } catch (err) {
    log(`❌ Lỗi: ${err.message}`, 'error');
    console.error(err);
  } finally {
    fetchDecryptBtn.disabled = false;
    fetchDecryptBtn.textContent = 'Tải & giải mã segment đã chọn';
  }
});

// Convert to MP4 using appropriate builder (TSBuilder for TS, FMP4Builder for fMP4)
convertMp4Btn.addEventListener('click', async () => {
  if (!isDecrypted || decryptedBuffers.length === 0) {
    log('Chưa có dữ liệu giải mã để chuyển đổi', 'error');
    return;
  }
  // Kiểm tra stream type trước khi chuyển, nhưng có fallback cho file upload
  let streamType;
  try {
    streamType = StreamInspector.detectStreamType(decryptedBuffers);
    log(`Phát hiện stream type: ${streamType}`, 'info');
  } catch (e) {
    log(`Lỗi kiểm tra stream: ${e.message}`, 'error');
    return;
  }
  // Nếu là file upload (1 segment, isUploaded = true) và streamType === 'unknown',
  // ta mặc định coi là MPEG-TS vì người dùng đã upload file .ts
  const isUploadedFile = segments.length === 1 && segments[0]?.isUploaded;
  let forceTS = false;
  if (isUploadedFile && streamType === 'unknown') {
    log('⚠️ Không nhận diện được stream type, nhưng đây là file .ts đã upload → thử xử lý như MPEG-TS', 'warn');
    forceTS = true;
    streamType = 'MPEG-TS';
  }

  // Nếu streamType vẫn là unknown, báo lỗi
  if (streamType === 'unknown') {
    log('❌ Không xác định được định dạng stream. Hãy đảm bảo dữ liệu là MPEG-TS hoặc fMP4 hợp lệ.', 'error');
    return;
  }

  // Nếu streamType là fMP4 nhưng không có init segment, thử tìm init trong buffers
  if (streamType === 'fMP4' && !StreamInspector.containsBox(decryptedBuffers[0], 'ftyp')) {
    log('⚠️ fMP4 nhưng buffer đầu không có ftyp, thử tìm trong các buffer khác...', 'warn');
    // FMP4Builder sẽ tự tìm init nếu initSegmentUrl = null, nên không cần làm gì thêm
  }


  log('Bắt đầu chuyển đổi sang MP4...', 'info');
  convertMp4Btn.disabled = true;
  convertMp4Btn.textContent = 'Đang chuyển...';
  try {
    let blob;
    if (streamType === 'MPEG-TS') {
      blob = await TSBuilder.build(decryptedBuffers);
    } else if (streamType === 'fMP4') {
      // FMP4Builder có thể tìm init segment trong buffers nếu initSegmentUrl = null
      blob = await FMP4Builder.build({
        buffers: decryptedBuffers,
        initSegmentUrl: null,
        fetchRawFn: null,
        clipRange: null
      });
    } else {
      throw new Error(`Stream type ${streamType} không được hỗ trợ tự động.`);
    }
    mp4Blob = blob;
    log(`✅ Chuyển đổi thành công! Kích thước MP4: ${(blob.size / 1024 / 1024).toFixed(2)} MB`, 'success');
    updateButtons();
  } catch (err) {
    log(`❌ Lỗi chuyển đổi: ${err.message}`, 'error');
    console.error(err);
  } finally {
    convertMp4Btn.disabled = false;
    convertMp4Btn.textContent = 'Chuyển thành MP4 (Auto)';
  }
});

// Download helper (fallback khi không có chrome.downloads)
function triggerDownload(blobUrl, filename) {
  if (typeof chrome !== 'undefined' && chrome?.downloads) {
    chrome.downloads.download({
      url: blobUrl,
      filename,
      saveAs: true
    }, (id) => {
      if (chrome.runtime.lastError) {
        log(`Lỗi tải xuống: ${chrome.runtime.lastError.message}`, 'error');
      } else {
        log(`✅ Đã tải xuống ${filename}`, 'success');
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    });
  } else {
    // Fallback cho trình duyệt thông thường
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    log(`✅ Đã tải xuống ${filename}`, 'success');
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }
}

// Download .ts decrypted
downloadTsBtn.addEventListener('click', () => {
  if (!isDecrypted || decryptedBuffers.length === 0) {
    log('Chưa có dữ liệu giải mã', 'error');
    return;
  }
  const combined = BufferUtils.concatenateBuffers(decryptedBuffers);
  const blob = new Blob([combined], { type: 'video/MP2T' });
  const url = URL.createObjectURL(blob);
  const filename = `decrypted_${Date.now()}.ts`;
  triggerDownload(url, filename);
});

// Download MP4
downloadMp4Btn.addEventListener('click', () => {
  if (!mp4Blob) {
    log('Chưa có file MP4 để tải', 'error');
    return;
  }
  const url = URL.createObjectURL(mp4Blob);
  const filename = `output_${Date.now()}.mp4`;
  triggerDownload(url, filename);
});

// Clear data
clearDataBtn.addEventListener('click', () => {
  segments = [];
  selectedIndices.clear();
  decryptedBuffers = [];
  isDecrypted = false;
  mp4Blob = null;
  renderSegments();
  updateButtons();
  log('Đã xóa dữ liệu', 'info');
});

// Initial state
updateButtons();
log('🧪 Trang test đã sẵn sàng. Hãy nhập URL M3U8 hoặc tải file .ts để bắt đầu.', 'info');