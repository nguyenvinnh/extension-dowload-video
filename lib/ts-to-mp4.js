/**
 * TSToMP4Converter v2.0
 *
 * Ghép nhiều ArrayBuffer thành 1 Blob để tải về.
 * Hỗ trợ MPEG-TS (đã giải mã) và fMP4 segments.
 *
 * Lưu ý:
 * - Việc strip fake header và giải mã AES-128 đã được thực hiện
 *   trong M3U8Downloader TRƯỚC khi truyền vào đây.
 * - Hàm này chỉ ghép + wrap vào Blob đúng MIME type.
 */

export class TSToMP4Converter {

  /**
   * Ghép nhiều buffer thành 1 Uint8Array liên tục
   */
  static _concatenate(buffers) {
    let total = 0;
    for (const buf of buffers) {
      if (buf) total += buf instanceof ArrayBuffer ? buf.byteLength
        : (buf.buffer ? buf.byteLength : buf.byteLength);
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const buf of buffers) {
      if (!buf) continue;
      const view = buf instanceof Uint8Array ? buf
        : buf instanceof ArrayBuffer ? new Uint8Array(buf)
        : new Uint8Array(buf.buffer || buf);
      out.set(view, offset);
      offset += view.byteLength;
    }

    console.log(`[VDP-TS2MP4] Ghép ${buffers.filter(Boolean).length} buffers → ${(total / 1024 / 1024).toFixed(2)} MB`);
    return out;
  }

  /**
   * Phát hiện loại stream từ bytes đầu:
   * - 'fMP4'   : ISO Base Media File Format (ftyp/moof/mdat/moov ở offset 4)
   * - 'MPEG-TS': có TS sync byte 0x47 tại đầu với pattern 188-byte
   * - 'unknown': không xác định
   */
  static _detectType(data) {
    if (data.length >= 8) {
      const box = String.fromCharCode(data[4], data[5], data[6], data[7]);
      if (['ftyp', 'moov', 'moof', 'mdat', 'free', 'skip', 'wide'].includes(box)) {
        return 'fMP4';
      }
    }

    // Kiểm tra TS sync: 0x47 tại offset 0, 188, 376
    for (let i = 0; i < Math.min(data.length - 376, 512); i++) {
      if (data[i] === 0x47 &&
          i + 188 < data.length && data[i + 188] === 0x47 &&
          i + 376 < data.length && data[i + 376] === 0x47) {
        return 'MPEG-TS';
      }
    }

    return 'unknown';
  }

  /**
   * Entry point: nhận mảng buffers, trả về Blob sẵn sàng tải xuống.
   *
   * @param {Array<ArrayBuffer|Uint8Array>} buffers
   * @returns {Blob}
   */
  static convert(buffers) {
    const validBuffers = buffers.filter(Boolean);
    if (validBuffers.length === 0) {
      throw new Error('Không có segment nào hợp lệ để ghép');
    }

    const combined = this._concatenate(validBuffers);
    const streamType = this._detectType(combined);

    console.log(`[VDP-TS2MP4] Stream type: ${streamType} (${(combined.byteLength / 1024 / 1024).toFixed(2)} MB)`);

    switch (streamType) {
      case 'fMP4':
        console.log('[VDP-TS2MP4] → fMP4 segments: wrap video/mp4');
        return new Blob([combined], { type: 'video/mp4' });

      case 'MPEG-TS':
        console.log('[VDP-TS2MP4] → Phát hiện MPEG-TS. Đang transmux sang MP4 (ISO-BMFF)...');
        if (globalThis.muxjs && globalThis.muxjs.mp4) {
          try {
            const transmuxer = new globalThis.muxjs.mp4.Transmuxer({ keepOriginalTimestamps: false });
            const initSegments = [];
            const dataSegments = [];

            transmuxer.on('data', (segment) => {
              if (segment.initSegment && segment.initSegment.byteLength > 0) {
                initSegments.push(segment.initSegment);
              }
              if (segment.data && segment.data.byteLength > 0) {
                dataSegments.push(segment.data);
              }
            });

            transmuxer.push(combined);
            transmuxer.flush();

            let totalLength = 0;
            initSegments.forEach(s => totalLength += s.byteLength);
            dataSegments.forEach(s => totalLength += s.byteLength);

            if (totalLength > 0) {
              const mp4Buf = new Uint8Array(totalLength);
              let offset = 0;
              initSegments.forEach(s => { mp4Buf.set(s, offset); offset += s.byteLength; });
              dataSegments.forEach(s => { mp4Buf.set(s, offset); offset += s.byteLength; });

              console.log(`[VDP-TS2MP4] ✅ Transmux TS -> fMP4 thành công! (${(totalLength / 1024 / 1024).toFixed(2)} MB)`);
              return new Blob([mp4Buf], { type: 'video/mp4' });
            }
          } catch (err) {
            console.warn('[VDP-TS2MP4] ⚠️ Transmuxing TS->fMP4 lỗi, fallback sang raw Blob:', err);
          }
        }
        console.log('[VDP-TS2MP4] → fallback: wrap MPEG-TS trong video/mp4');
        return new Blob([combined], { type: 'video/mp4' });

      default:
        console.warn('[VDP-TS2MP4] ⚠️ Stream không xác định — có thể vẫn còn mã hóa hoặc định dạng lạ');
        return new Blob([combined], { type: 'video/octet-stream' });
    }
  }
}
