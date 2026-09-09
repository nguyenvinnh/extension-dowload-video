/**
 * AESDecryptor
 * Quản lý bộ nhớ tạm (keyCache) và giải mã AES-128 CBC cho các HLS segment.
 */
export class AESDecryptor {
  constructor(fetchRawFn) {
    this._fetchRaw = fetchRawFn;
    this._keyCache = new Map();
  }

  clearCache() {
    this._keyCache.clear();
  }

  /**
   * Giải mã một segment bị mã hoá AES-128.
   *
   * @param {ArrayBuffer|Uint8Array} encryptedBuf
   * @param {Object} encInfo - { keyUrl, iv }
   * @returns {Promise<ArrayBuffer>} Decrypted ArrayBuffer
   */
  async decrypt(encryptedBuf, encInfo) {
    const { keyUrl, iv } = encInfo;

    if (!keyUrl) {
      throw new Error('Thiếu keyUrl mã hoá AES-128');
    }

    let cryptoKey = this._keyCache.get(keyUrl);

    if (!cryptoKey) {
      console.log(`[VDP-AES] 🔑 Đang tải AES Key mới từ URL: ${keyUrl}`);
      const keyBuf = await this._fetchRaw(keyUrl, true);

      if (keyBuf.byteLength !== 16) {
        throw new Error(`AES key phải đúng 16 bytes (nhận ${keyBuf.byteLength} bytes)`);
      }

      cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBuf,
        { name: 'AES-CBC' },
        false,
        ['decrypt']
      );

      this._keyCache.set(keyUrl, cryptoKey);
      console.log(`[VDP-AES] ✅ Import AES Key thành công và lưu vào cache.`);
    } else {
      console.log(`[VDP-AES] ⚡ Sử dụng AES Key từ cache cho URL: ${keyUrl}`);
    }

    const ivHex = iv || '0'.repeat(32);
    const ivBytes = new Uint8Array(16);

    for (let i = 0; i < 16; i++) {
      ivBytes[i] = parseInt(ivHex.slice(i * 2, i * 2 + 2), 16);
    }

    const inputBuf =
      encryptedBuf instanceof ArrayBuffer
        ? encryptedBuf
        : encryptedBuf.buffer.slice(
            encryptedBuf.byteOffset,
            encryptedBuf.byteOffset + encryptedBuf.byteLength
          );

    return await crypto.subtle.decrypt(
      {
        name: 'AES-CBC',
        iv: ivBytes
      },
      cryptoKey,
      inputBuf
    );
  }
}
