import { M3U8Parser } from '../lib/m3u8-parser.js';
import { sanitizeFilename } from './formatters.js';
import { BufferUtils } from './buffer-utils.js';
import { StreamInspector } from './stream-inspector.js';
import { AESDecryptor } from './aes-decryptor.js';
import { FetchProxy } from './fetch-proxy.js';
import { FMP4Builder } from './fmp4-builder.js';
import { TSBuilder } from './ts-builder.js';

export class M3U8Downloader {
  constructor() {
    this.isAborted = false;
    this.concurrency = 4;
    this.fetchProxy = new FetchProxy();
    this.aesDecryptor = new AESDecryptor((url, isKey) => this.fetchProxy.fetchRaw(url, isKey));
    this._originalM3U8Url = null;
  }

  abort() { this.isAborted = true; }

  async download(m3u8Url, title = 'video_stream', onProgress = () => { }, options = {}) {
    this.isAborted = false;
    this.aesDecryptor.clearCache();
    this._originalM3U8Url = m3u8Url;

    const tab = await this.fetchProxy.getActiveTab();
    const tabId = options.tabId || tab?.id || null;
    const tabUrl = options.tabUrl || options.referer || tab?.url || null;
    const referer = options.referer || options.tabUrl || tab?.url || null;

    this.fetchProxy.setTabInfo(tabId, tabUrl, referer);
    await this.fetchProxy.ensureRefererRule();

    console.log(`[VDP-M3U8] 🎬 Bắt đầu tải M3U8: ${m3u8Url}`);
    onProgress({ status: 'parsing', percent: 0, message: 'Đang đọc playlist...' });

    const playlist = await M3U8Parser.parse(m3u8Url, { tabId, tabUrl, referer, headers: options.headers });

    const allSegments = playlist.segments;
    console.log(`[VDP-M3U8] 📊 ${allSegments?.length || 0} segments, init: ${playlist.initSegmentUrl ? 'có' : 'không'}`);

    if (!allSegments?.length) throw new Error('Playlist không có segment nào');
    if (playlist.hasDRM) throw new Error('Video DRM SAMPLE-AES không hỗ trợ');

    const timeRanges = options.timeRanges?.length ? options.timeRanges : null;
    if (!timeRanges) {
      await this._downloadSegments({ segments: allSegments, title, onProgress, initSegmentUrl: playlist.initSegmentUrl });
      return;
    }

    for (let ri = 0; ri < timeRanges.length; ri++) {
      if (this.isAborted) break;
      const range = timeRanges[ri];
      const start = Number.isFinite(range.startSec) ? Math.max(0, range.startSec) : 0;
      const end = Number.isFinite(range.endSec) ? Math.max(start, range.endSec) : Infinity;
      const label = `clip${ri + 1}_${BufferUtils.formatSeconds(start)}-${BufferUtils.formatSeconds(end)}`;
      const rangeTitle = `${title}_${label}`;
      const selected = allSegments.filter((seg) => {
        const segStart = Number(seg.startTime ?? 0);
        const segEnd = Number(seg.endTime ?? segStart + Number(seg.duration || 0));
        return segStart < end && segEnd > start;
      });
      if (!selected.length) { console.warn('[VDP-M3U8] Không có segment nào trong range:', start, end); continue; }
      const wrapProgress = (p) => {
        const base = (ri / timeRanges.length) * 100;
        const step = (1 / timeRanges.length) * 100;
        onProgress({ ...p, percent: Math.floor(base + ((p.percent || 0) / 100) * step), message: `[${ri + 1}/${timeRanges.length}] ` + (p.message || '') });
      };
      await this._downloadSegments({ segments: selected, title: rangeTitle, onProgress: wrapProgress, initSegmentUrl: playlist.initSegmentUrl, clipRange: { start, end } });
    }

    if (!this.isAborted) onProgress({ status: 'completed', percent: 100, message: `✅ Đã tải xong ${timeRanges.length} file!` });
  }

  async _downloadSegments({ segments, title, onProgress, initSegmentUrl, clipRange = null }) {
    const total = segments.length;
    const buffers = new Array(total).fill(null);
    let completed = 0;
    let queueIdx = 0;

    onProgress({ status: 'downloading', percent: 0, message: `Đang tải ${total} phân đoạn...` });

    const worker = async () => {
      while (true) {
        if (this.isAborted) return;
        const idx = queueIdx++;
        if (idx >= total) return;
        const seg = segments[idx];
        try {
          buffers[idx] = await this._fetchDecryptStrip(seg, idx, total);
        } catch (e) {
          // Nếu 403, thử append token từ m3u8 gốc một lần nữa
          if ((e?.message || '').includes('403') && this._originalM3U8Url) {
            try {
              const orig = new URL(this._originalM3U8Url);
              if (orig.search) {
                const retryUrl = new URL(seg.url);
                if (!retryUrl.search) retryUrl.search = orig.search;
                console.warn(`[VDP-M3U8] Thử retry với token gốc: ${retryUrl.href.substring(0, 100)}`);
                const retrySeg = { ...seg, url: retryUrl.href };
                buffers[idx] = await this._fetchDecryptStrip(retrySeg, idx, total, true);
              } else {
                throw e;
              }
            } catch (retryErr) {
              throw e; // ném lỗi gốc
            }
          } else {
            throw e;
          }
        }
        completed++;
        const pct = Math.floor((completed / total) * 85);
        onProgress({ status: 'downloading', percent: pct, loaded: completed, total, message: `Tải: ${completed}/${total} (${pct}%)` });
      }
    };

    await Promise.all(Array.from({ length: Math.min(this.concurrency, total) }, worker));

    if (this.isAborted) throw new Error('Đã hủy tiến trình tải');

    onProgress({ status: 'converting', percent: 88, message: 'Đang phân tích stream...' });

    const validBuffers = buffers.filter(Boolean);
    if (!validBuffers.length) throw new Error('Không có segment nào tải được (toàn bộ 403). Hãy refresh trang, play lại video và tải ngay lập tức khi token còn sống.');

    const streamType = StreamInspector.detectStreamType(validBuffers);
    console.log(`[VDP-M3U8] Stream type: ${streamType}`);

    let blob;
    if (streamType === 'fMP4') {
      blob = await FMP4Builder.build({ buffers, initSegmentUrl, fetchRawFn: (url, isKey) => this.fetchProxy.fetchRaw(url, isKey), clipRange });
    } else if (streamType === 'MPEG-TS') {
      blob = await TSBuilder.build(validBuffers);
    } else {
      throw new Error('Không nhận dạng được định dạng (fMP4 / MPEG-TS)');
    }

    onProgress({ status: 'saving', percent: 98, message: 'Đang lưu file...' });
    await this._saveBlob(blob, title);
    onProgress({ status: 'completed', percent: 100, message: `✅ Đã lưu: ${title}` });
  }

  async _fetchDecryptStrip(seg, idx, total, isRetry = false) {
    const MAX_RETRY = 3;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        let rawBuf = await this.fetchProxy.fetchRaw(seg.url, false);
        if (BufferUtils.isErrorResponse(rawBuf)) throw new Error(`Phản hồi lỗi HTML/JSON (${rawBuf.byteLength} bytes) - có thể 403`);
        if (seg.encryption?.method === 'AES-128') {
          rawBuf = await this.aesDecryptor.decrypt(rawBuf, seg.encryption);
        }
        const u8 = BufferUtils.toUint8Array(rawBuf);
        const cleanData = this._normalizeSegment(u8);
        return cleanData.buffer.slice(cleanData.byteOffset, cleanData.byteOffset + cleanData.byteLength);
      } catch (err) {
        const msg = err?.message || String(err);
        console.warn(`[VDP-M3U8] Segment ${idx + 1}/${total} lần ${attempt}${isRetry ? ' (retry token)' : ''}: ${msg}`);
        if (attempt === MAX_RETRY) throw err;
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
  }

  _normalizeSegment(u8) {
    if (StreamInspector.looksLikeISOBox(u8)) return u8;
    const tsOffset = StreamInspector.findTSOffset(u8);
    if (tsOffset >= 0) return tsOffset > 0 ? u8.slice(tsOffset) : u8;
    return u8;
  }

  async _saveBlob(blob, title) {
    const blobUrl = URL.createObjectURL(blob);
    const filename = sanitizeFilename(title, 'mp4');
    return new Promise((resolve, reject) => {
      chrome.downloads.download({ url: blobUrl, filename, saveAs: true }, (id) => {
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    });
  }
}