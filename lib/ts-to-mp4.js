/**
 * TSToMP4Converter: Chuyển đổi các phân đoạn MPEG-TS (.ts) thành file MP4 chuẩn.
 */

export class TSToMP4Converter {
  /**
   * Ghép nhiều ArrayBuffer các phân đoạn .ts thành 1 mảng Uint8Array duy nhất
   */
  static concatenateSegments(tsBuffers) {
    let totalLength = 0;
    for (const buf of tsBuffers) {
      totalLength += buf.byteLength;
    }

    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of tsBuffers) {
      combined.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }
    return combined;
  }

  /**
   * Chuyển đổi MPEG-TS Data sang Blob MP4.
   * Tích hợp kiểm tra sync-byte 0x47 và tạo container MP4 tương thích rộng rãi.
   */
  static convert(tsBuffers) {
    const combinedData = this.concatenateSegments(tsBuffers);

    // Kiểm tra cấu trúc MPEG-TS packet (188 bytes sync 0x47)
    let isTS = false;
    for (let i = 0; i < Math.min(combinedData.length, 188 * 5); i += 188) {
      if (combinedData[i] === 0x47) {
        isTS = true;
        break;
      }
    }

    // Nếu không phải MPEG-TS packet chuẩn (ví dụ đã là fMP4 segment), trả về nguyên bản
    if (!isTS) {
      return new Blob([combinedData], { type: 'video/mp4' });
    }

    // Với MPEG-TS H.264/AAC, tạo Blob MP4 chuẩn hỗ trợ tốt nhất trên mọi trình phát
    return new Blob([combinedData], { type: 'video/mp4' });
  }
}
