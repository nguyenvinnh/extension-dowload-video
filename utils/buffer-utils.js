/**
 * BufferUtils
 * Các tiện ích làm việc với ArrayBuffer, Uint8Array và chuỗi thời gian.
 */

export class BufferUtils {
  /**
   * Chuẩn hóa mọi kiểu buffer/view về Uint8Array không bị lệch offset.
   */
  static toUint8Array(buffer) {
    if (buffer instanceof Uint8Array) {
      if (
        buffer.byteOffset !== 0 ||
        buffer.byteLength !== buffer.buffer.byteLength
      ) {
        return new Uint8Array(
          buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
          )
        );
      }
      return buffer;
    }

    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }

    if (ArrayBuffer.isView(buffer)) {
      return new Uint8Array(
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        )
      );
    }

    throw new Error('Unsupported buffer format');
  }

  /**
   * Ghép mảng các buffer/Uint8Array thành 1 Uint8Array duy nhất.
   */
  static concatenateBuffers(buffers) {
    const valid = buffers.filter(Boolean);
    let total = 0;

    for (const buf of valid) {
      total += buf.byteLength ?? buf.buffer?.byteLength ?? 0;
    }

    const out = new Uint8Array(total);
    let offset = 0;

    for (const buf of valid) {
      const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      out.set(u8, offset);
      offset += u8.byteLength;
    }

    return out;
  }

  /**
   * Kiểm tra buffer có phải là phản hồi lỗi dạng HTML / XML / JSON không.
   */
  static isErrorResponse(buffer) {
    if (!buffer || buffer.byteLength === 0) {
      return true;
    }

    if (buffer.byteLength === 16) {
      return false; // AES key 16 bytes
    }

    const view = new Uint8Array(
      buffer instanceof ArrayBuffer ? buffer : buffer.buffer
    );

    // Kiểm tra ký tự '<' (HTML/XML error page)
    if (view[0] === 0x3c) {
      const head = String.fromCharCode(
        ...view.slice(0, Math.min(64, view.length))
      ).toLowerCase();

      if (
        head.includes('<html') ||
        head.includes('<!do') ||
        head.includes('<?xml')
      ) {
        return true;
      }
    }

    // Kiểm tra ký tự '{' (JSON error payload)
    if (view[0] === 0x7b) {
      return true;
    }

    return false;
  }

  /**
   * Format số giây thành chuỗi 1h02m05s hoặc 02m05s.
   */
  static formatSeconds(sec) {
    if (!Number.isFinite(sec)) {
      return 'end';
    }

    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);

    if (h > 0) {
      return (
        `${h}h` +
        `${String(m).padStart(2, '0')}m` +
        `${String(s).padStart(2, '0')}s`
      );
    }

    return `${m}m` + `${String(s).padStart(2, '0')}s`;
  }
}
