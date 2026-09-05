import { M3U8Parser } from '../lib/m3u8-parser.js';
import { TSToMP4Converter } from '../lib/ts-to-mp4.js';
import { sanitizeFilename } from './formatters.js';

/**
 * M3U8Downloader: Xử lý tải đa luồng các đoạn .ts, ghép lại và lưu file MP4
 */
export class M3U8Downloader {
  constructor() {
    this.isAborted = false;
    this.concurrency = 4; // Tải song song 4 luồng cùng lúc
  }

  abort() {
    this.isAborted = true;
  }

  async download(m3u8Url, title = 'video_stream', onProgress = () => {}, options = {}) {
    this.isAborted = false;

    onProgress({ status: 'parsing', percent: 0, message: 'Đang đọc playlist M3U8...' });

    // 1. Phân tích M3U8 Playlist
    const playlist = await M3U8Parser.parse(m3u8Url);
    let segments = playlist.segments;

    if (!segments || segments.length === 0) {
      throw new Error('Không tìm thấy đoạn video nào trong playlist M3U8');
    }

    // 1.1 Lọc khoảng thời gian (Time Range Clipping) nếu có
    if (options && Array.isArray(options.timeRanges) && options.timeRanges.length > 0) {
      const selectedMap = new Map();
      segments.forEach((seg) => {
        const isMatched = options.timeRanges.some((range) => {
          const start = range.startSec != null ? range.startSec : 0;
          const end = range.endSec != null ? range.endSec : Infinity;
          return seg.startTime < end && seg.endTime > start;
        });
        if (isMatched) {
          selectedMap.set(seg.index, seg);
        }
      });

      segments = Array.from(selectedMap.values()).sort((a, b) => a.index - b.index);

      if (segments.length === 0) {
        throw new Error('Không có đoạn video nào thuộc các khoảng thời gian đã chọn');
      }
    }

    const totalSegments = segments.length;
    const downloadedBuffers = new Array(totalSegments);
    let completedCount = 0;

    onProgress({
      status: 'downloading',
      percent: 0,
      loaded: 0,
      total: totalSegments,
      message: `Bắt đầu tải ${totalSegments} phân đoạn...`
    });

    // 2. Tải đa luồng song song (Pool Worker)
    let queueIndex = 0;

    const worker = async () => {
      while (queueIndex < totalSegments && !this.isAborted) {
        const currentIndex = queueIndex++;
        const segment = segments[currentIndex];

        try {
          const res = await fetch(segment.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buffer = await res.arrayBuffer();
          downloadedBuffers[currentIndex] = buffer;

          completedCount++;
          const percent = Math.floor((completedCount / totalSegments) * 90); // 0% - 90% cho tải

          onProgress({
            status: 'downloading',
            percent: percent,
            loaded: completedCount,
            total: totalSegments,
            message: `Đang tải: ${completedCount}/${totalSegments} đoạn (${percent}%)`
          });
        } catch (err) {
          console.warn(`Lỗi khi tải segment ${currentIndex}, đang thử lại...`, err);
          // Thử lại 1 lần nếu lỗi mạng tạm thời
          try {
            const resRetry = await fetch(segment.url);
            const bufferRetry = await resRetry.arrayBuffer();
            downloadedBuffers[currentIndex] = bufferRetry;
            completedCount++;
          } catch (e) {
            throw new Error(`Tải đoạn video ${currentIndex + 1}/${totalSegments} thất bại: ${e.message}`);
          }
        }
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(this.concurrency, totalSegments); i++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    if (this.isAborted) {
      throw new Error('Đã hủy quá trình tải');
    }

    // 3. Ghép file & Remux sang MP4
    onProgress({ status: 'converting', percent: 95, message: 'Đang ghép luồng và tạo file MP4...' });

    const mp4Blob = TSToMP4Converter.convert(downloadedBuffers);

    // 4. Kích hoạt tải tệp về máy
    onProgress({ status: 'saving', percent: 99, message: 'Đang lưu file về máy...' });

    const blobUrl = URL.createObjectURL(mp4Blob);
    const filename = sanitizeFilename(title, 'mp4');

    return new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url: blobUrl,
          filename: filename,
          saveAs: true
        },
        (downloadId) => {
          // Giao quyền dọn dẹp blobUrl sau khi tải xong
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            onProgress({ status: 'completed', percent: 100, message: 'Tải thành công!' });
            resolve(downloadId);
          }
        }
      );
    });
  }
}
