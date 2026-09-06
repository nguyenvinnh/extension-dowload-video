import { BufferUtils } from './buffer-utils.js';

/**
 * TSBuilder
 * Chuyển đổi (transmux) luồng MPEG-TS thành fMP4 (ISO-BMFF) bằng thư viện mux.js.
 * Đảm bảo rebase timestamp (keepOriginalTimestamps: false) để video phát ngay từ 00:00:00.
 */
export class TSBuilder {
  static async build(buffers) {
    const combined = BufferUtils.concatenateBuffers(buffers);

    if (!globalThis.muxjs?.mp4) {
      throw new Error('Thư viện mux.js chưa được nạp (window.muxjs)');
    }

    console.log(`[VDP-TSBuilder] ⚙️ Bắt đầu transmux MPEG-TS sang fMP4 (ISO-BMFF) với mux.js (keepOriginalTimestamps: false)...`);
    const transmuxer = new globalThis.muxjs.mp4.Transmuxer({
      keepOriginalTimestamps: false // Rebase timestamp về 00:00:00 không bị đen đầu
    });

    const initSegments = [];
    const dataSegments = [];

    transmuxer.on('data', (segment) => {
      if (segment.initSegment?.byteLength) {
        initSegments.push(segment.initSegment);
      }
      if (segment.data?.byteLength) {
        dataSegments.push(segment.data);
      }
    });

    transmuxer.push(combined);
    transmuxer.flush();

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
      `[VDP-TSBuilder] ✅ Đã transmux MPEG-TS -> fMP4 thành công → ${(totalLength / 1024 / 1024).toFixed(2)} MB`
    );

    return new Blob([out], { type: 'video/mp4' });
  }
}
