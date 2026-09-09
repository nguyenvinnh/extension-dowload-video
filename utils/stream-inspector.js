import { BufferUtils } from './buffer-utils.js';

/**
 * StreamInspector
 * Phân tích cấu trúc container (ISO-BMFF fMP4 và MPEG-TS) trong dữ liệu video.
 */
export class StreamInspector {
  static readUint32(u8, offset) {
    return (
      (((u8[offset] << 24) >>> 0) |
        (u8[offset + 1] << 16) |
        (u8[offset + 2] << 8) |
        u8[offset + 3]) >>>
      0
    );
  }

  static readType(u8, offset) {
    return String.fromCharCode(
      u8[offset],
      u8[offset + 1],
      u8[offset + 2],
      u8[offset + 3]
    );
  }

  /**
   * Đọc danh sách các top-level ISO-BMFF boxes trong buffer.
   */
  static inspectTopLevelBoxes(data) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    const boxes = [];
    let offset = 0;

    while (offset + 8 <= u8.length) {
      let size = this.readUint32(u8, offset);
      const type = this.readType(u8, offset + 4);
      let headerSize = 8;

      if (size === 1) {
        if (offset + 16 > u8.length) break;
        const hi = this.readUint32(u8, offset + 8);
        const lo = this.readUint32(u8, offset + 12);
        size = hi !== 0 ? hi * 0x100000000 + lo : lo;
        headerSize = 16;
      }

      if (size === 0) {
        size = u8.length - offset;
      }

      if (size < headerSize || offset + size > u8.length) {
        break;
      }

      boxes.push({ offset, size, type, headerSize });
      offset += size;
    }

    return boxes;
  }

  /**
   * Kiểm tra buffer có chứa box chỉ định không (ví dụ 'ftyp', 'moov', 'moof', 'mdat').
   */
  static containsBox(data, wantedType) {
    return this.inspectTopLevelBoxes(data).some((b) => b.type === wantedType);
  }

  /**
   * Kiểm tra buffer có cấu trúc của ISO-BMFF (fMP4) không.
   */
  static looksLikeISOBox(u8) {
    if (!u8 || u8.length < 8) return false;
    const type = this.readType(u8, 4);
    return ['ftyp', 'moov', 'moof', 'mdat', 'styp', 'free', 'skip', 'wide'].includes(type);
  }

  /**
   * Tìm vị trí MPEG-TS sync byte 0x47 với chuỗi packet 188 bytes hợp lệ.
   */
  static findTSOffset(u8) {
    const minPackets = 5;
    const packetSize = 188;

    if (u8.length < packetSize * minPackets) {
      return -1;
    }

    const searchLimit = Math.min(u8.length - packetSize * minPackets, 5_000_000);

    for (let i = 0; i <= searchLimit; i++) {
      if (u8[i] !== 0x47) continue;

      let valid = true;
      for (let p = 1; p < minPackets; p++) {
        if (u8[i + p * packetSize] !== 0x47) {
          valid = false;
          break;
        }
      }

      if (valid) {
        if (i > 0) {
          console.log(`[VDP-StreamInspector] ✂️ Đã tìm thấy MPEG-TS sync byte 0x47 tại offset ${i} (đã cắt fake header ${i} bytes)`);
        }
        return i;
      }
    }

    return -1;
  }

  /**
   * Tự động phát hiện kiểu stream trong mảng danh sách buffers ('fMP4', 'MPEG-TS', hoặc 'unknown').
   */
  static detectStreamType(buffers) {
    for (const buf of buffers) {
      if (!buf || buf.byteLength < 8) continue;
      if (this.looksLikeISOBox(buf)) {
        console.log(`[VDP-StreamInspector] 🔍 Phát hiện stream type: fMP4 (ISO-BMFF)`);
        return 'fMP4';
      }
    }

    for (const buf of buffers) {
      if (buf && this.findTSOffset(BufferUtils.toUint8Array(buf)) >= 0) {
        console.log(`[VDP-StreamInspector] 🔍 Phát hiện stream type: MPEG-TS`);
        return 'MPEG-TS';
      }
    }

    console.warn(`[VDP-StreamInspector] ⚠️ Không nhận dạng được stream type trong ${buffers.length} buffers`);
    return 'unknown';
  }

  /**
   * Xác thực tính hợp lệ của file fMP4.
   */
  static validateFMP4(data) {
    const boxes = this.inspectTopLevelBoxes(data);
    if (!boxes.length) {
      throw new Error('MP4 không có box hợp lệ');
    }

    const types = boxes.map((b) => b.type);
    if (!types.includes('ftyp')) {
      throw new Error('fMP4 thiếu ftyp');
    }
    if (!types.includes('moof') || !types.includes('mdat')) {
      throw new Error('fMP4 thiếu moof/mdat');
    }

    console.log('[VDP-fMP4] Validated boxes:', types.join(' → '));
    return true;
  }
}
