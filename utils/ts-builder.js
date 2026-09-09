import { BufferUtils } from './buffer-utils.js';
import { StreamInspector } from './stream-inspector.js';
import { FMP4Builder } from './fmp4-builder.js';

/**
 * TSBuilder
 * Chuyển đổi (transmux) luồng MPEG-TS thành fMP4 (ISO-BMFF) bằng thư viện mux.js.
 * Sau đó truyền qua FMP4Builder để patch header duration (mvhd/tkhd/mdhd) và rebase tfdt,
 * giúp video tương thích 100% với QuickTime Player, Safari, Chrome, VLC.
 */
export class TSBuilder {
  static async build(buffers) {
    const combined = BufferUtils.concatenateBuffers(buffers);

    // Kiểm tra muxjs trong cả globalThis và window
    const muxjs = globalThis.muxjs || window.muxjs;
    if (!muxjs || !muxjs.mp4) {
      throw new Error('Thư viện mux.js chưa được nạp (window.muxjs)');
    }

    // Kiểm tra dữ liệu có phải MPEG-TS không
    const streamType = StreamInspector.detectStreamType([combined]);
    if (streamType !== 'MPEG-TS') {
      throw new Error(`Dữ liệu không phải MPEG-TS (phát hiện: ${streamType}). Vui lòng đảm bảo bạn đã giải mã đúng và chọn đúng segment.`);
    }

    console.log(`[VDP-TSBuilder] ⚙️ Bắt đầu transmux MPEG-TS sang fMP4 (ISO-BMFF) với mux.js (keepOriginalTimestamps: false)...`);
    const transmuxer = new muxjs.mp4.Transmuxer({
      keepOriginalTimestamps: false // Rebase timestamp về 00:00:00 không bị đen đầu
    });

    const initSegments = [];
    const dataSegments = [];
    let error = null;

    transmuxer.on('error', (e) => {
      error = e;
      console.error('[VDP-TSBuilder] Lỗi từ mux.js:', e);
    });

    transmuxer.on('data', (segment) => {
      if (segment.initSegment?.byteLength) {
        initSegments.push(segment.initSegment);
      }
      if (segment.data?.byteLength) {
        dataSegments.push(segment.data);
      }
    });

    try {
      transmuxer.push(combined);
      transmuxer.flush();
    } catch (e) {
      throw new Error(`Lỗi khi transmux: ${e.message || e}`);
    }

    if (error) throw new Error(`Lỗi từ mux.js: ${error.message || error}`);

    let totalLength = 0;
    for (const s of initSegments) totalLength += s.byteLength;
    for (const s of dataSegments) totalLength += s.byteLength;

    if (!totalLength) {
      throw new Error('Bộ chuyển đổi mux.js không tạo được dữ liệu fMP4');
    }

    const out = new Uint8Array(totalLength);
    let offset = 0;

    for (const s of initSegments) {
      out.set(s, offset);
      offset += s.byteLength;
    }

    for (const s of dataSegments) {
      out.set(s, offset);
      offset += s.byteLength;
    }

    console.log(
      `[VDP-TSBuilder] ⚙️ Truyền fMP4 từ mux.js sang FMP4Builder để patch header duration & rebase tfdt...`
    );

    // Chạy qua FMP4Builder để sửa duration mvhd/tkhd/mdhd và rebase tfdt
    return await FMP4Builder.build({
      buffers: [out],
      initSegmentUrl: null,
      fetchRawFn: null,
      clipRange: null
    });
  }
}
