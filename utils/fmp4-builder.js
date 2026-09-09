import { BufferUtils } from './buffer-utils.js';
import { StreamInspector } from './stream-inspector.js';

/**
 * FMP4Builder v3.0
 * Chịu trách nhiệm lọc, sắp xếp (interleave), sửa header duration và khởi tạo Blob MP4 chuẩn ISO-BMFF (fMP4).
 * Giúp video xem tương thích 100% trên QuickTime Player, MacOS Finder QuickLook, Chrome, Safari, iOS, Android,
 * VLC, ffmpeg và Windows Media Player.
 *
 * Các vấn đề đã fix so với v2:
 *  1. [QUAN TRỌNG] Rebase `tfdt` (baseMediaDecodeTime) về 0 theo TỪNG TRACK (audio/video riêng biệt).
 *     Trước đây chỉ patch duration ở header (mvhd/tkhd/mdhd) mà không sửa tfdt bên trong moof,
 *     khiến header nói video dài X giây nhưng timestamp media thực tế lại theo mốc tuyệt đối gốc
 *     (ví dụ segment cắt từ giây 300 của video gốc thì tfdt vẫn ~300*timescale).
 *     Chrome/MSE không quan tâm timeline tuyệt đối nên vẫn phát được, nhưng ffmpeg/VLC/Windows Media
 *     đọc đúng chuẩn sẽ thấy timeline lệch pha nghiêm trọng → từ chối phát hoặc phát lỗi.
 *  2. [QUAN TRỌNG] Renumber `mfhd.sequence_number` tăng dần 1,2,3... theo đúng thứ tự đã sort.
 *     Trước đây giữ nguyên số gốc từ mỗi segment CDN (thường tất cả đều = 1) → demuxer chuẩn
 *     (libavformat) coi là dấu hiệu file hỏng, có thể dừng đọc giữa chừng hoặc bỏ qua fragment.
 *  3. Patch `tfhd.base_data_offset` về đúng vị trí byte tuyệt đối trong file MP4 mới ghép,
 *     thay vì giữ nguyên offset tuyệt đối trỏ vào file gốc của CDN (sai hoàn toàn sau khi ghép).
 *  4. Đọc đúng timescale của từng track từ `mdhd` (thay vì hard-code 90000) khi tính duration
 *     fallback từ tfdt/trun, tránh sai lệch với track có timescale khác (audio 44100/48000...).
 */
export class FMP4Builder {
  // ---------------------------------------------------------------------
  // Ghi byte (patch tại chỗ, không đổi kích thước box)
  // ---------------------------------------------------------------------

  static _writeUint32(u8, offset, value) {
    u8[offset] = (value >>> 24) & 0xFF;
    u8[offset + 1] = (value >>> 16) & 0xFF;
    u8[offset + 2] = (value >>> 8) & 0xFF;
    u8[offset + 3] = value & 0xFF;
  }

  static _writeUint64(u8, offset, value) {
    const big = typeof value === 'bigint' ? value : BigInt(Math.max(0, Math.floor(value)));
    const hi = Number((big >> 32n) & 0xFFFFFFFFn);
    const lo = Number(big & 0xFFFFFFFFn);
    this._writeUint32(u8, offset, hi);
    this._writeUint32(u8, offset + 4, lo);
  }

  /**
   * Phân tích đầy đủ một box moof trong MỘT LẦN DUYỆT DUY NHẤT, trả về:
   *  - mfhdSeqOffset: offset (tương đối, tính từ đầu moofU8) tới field sequence_number trong mfhd
   *  - trackId: track_id đọc từ tfhd
   *  - tfhdBaseDataOffsetFieldOffset: offset tới field base_data_offset (8 bytes) trong tfhd, -1 nếu không có
   *  - tfdtOffset / tfdtVersion / tfdtValue: vị trí + phiên bản + giá trị hiện tại của baseMediaDecodeTime
   *  - trunDuration: tổng sample duration trong tất cả các trun (dùng để fallback tính duration)
   *
   * @param {Uint8Array} moofU8 - dữ liệu box moof (offset 0 = đầu box)
   */
  static _parseMoofInfo(moofU8) {
    const info = {
      mfhdSeqOffset: -1,
      trackId: null,
      tfhdBaseDataOffsetFieldOffset: -1,
      tfdtOffset: -1,
      tfdtVersion: 0,
      tfdtValue: -1,
      trunDuration: 0
    };

    let offset = 8; // bỏ qua header của chính box moof
    while (offset + 8 <= moofU8.length) {
      const size = StreamInspector.readUint32(moofU8, offset);
      const type = StreamInspector.readType(moofU8, offset + 4);
      if (size < 8 || offset + size > moofU8.length) break;

      if (type === 'mfhd') {
        // mfhd: [size4][type4][version/flags4][sequence_number4]
        info.mfhdSeqOffset = offset + 12;
      }

      if (type === 'traf') {
        let tOff = offset + 8;
        const trafEnd = offset + size;
        let defaultSampleDuration = 0;

        while (tOff + 8 <= trafEnd) {
          const tSize = StreamInspector.readUint32(moofU8, tOff);
          const tType = StreamInspector.readType(moofU8, tOff + 4);
          if (tSize < 8 || tOff + tSize > trafEnd) break;

          if (tType === 'tfhd') {
            const flags = (moofU8[tOff + 9] << 16) | (moofU8[tOff + 10] << 8) | moofU8[tOff + 11];
            info.trackId = StreamInspector.readUint32(moofU8, tOff + 12);
            let p = tOff + 16; // bỏ qua size+type+version/flags+track_id
            if (flags & 0x000001) { // base-data-offset-present
              info.tfhdBaseDataOffsetFieldOffset = p;
              p += 8;
            }
            if (flags & 0x000002) p += 4; // sample-description-index-present
            if (flags & 0x000008) { // default-sample-duration-present
              defaultSampleDuration = StreamInspector.readUint32(moofU8, p);
              p += 4;
            }
          }

          if (tType === 'tfdt') {
            const version = moofU8[tOff + 8];
            info.tfdtVersion = version;
            info.tfdtOffset = tOff + 12;
            info.tfdtValue = version === 0
              ? StreamInspector.readUint32(moofU8, tOff + 12)
              : (StreamInspector.readUint32(moofU8, tOff + 12) * 0x100000000 +
                StreamInspector.readUint32(moofU8, tOff + 16));
          }

          if (tType === 'trun') {
            const flags = (moofU8[tOff + 9] << 16) | (moofU8[tOff + 10] << 8) | moofU8[tOff + 11];
            const sampleCount = StreamInspector.readUint32(moofU8, tOff + 12);
            const hasSampleDuration = (flags & 0x100) !== 0;

            let p = tOff + 16;
            if (flags & 0x001) p += 4; // data-offset-present
            if (flags & 0x004) p += 4; // first-sample-flags-present

            for (let s = 0; s < sampleCount; s++) {
              if (hasSampleDuration) {
                if (p + 4 > trafEnd) break;
                info.trunDuration += StreamInspector.readUint32(moofU8, p);
                p += 4;
                if (flags & 0x200) p += 4; // sample-size
                if (flags & 0x400) p += 4; // sample-flags
                if (flags & 0x800) p += 4; // sample-composition-time-offset
              } else {
                info.trunDuration += defaultSampleDuration;
                if (flags & 0x200) p += 4;
                if (flags & 0x400) p += 4;
                if (flags & 0x800) p += 4;
              }
            }
          }

          tOff += tSize;
        }
      }
      offset += size;
    }

    return info;
  }

  /**
   * Tìm vị trí sub-box bên trong một box container.
   */
  static _findSubboxOffset(u8, parentOff, parentSz, targetType) {
    let p = parentOff + 8;
    const end = parentOff + parentSz;
    while (p + 8 <= end) {
      let sz = StreamInspector.readUint32(u8, p);
      const tp = StreamInspector.readType(u8, p + 4);
      if (sz === 1) {
        const hi = StreamInspector.readUint32(u8, p + 8);
        const lo = StreamInspector.readUint32(u8, p + 12);
        sz = hi !== 0 ? hi * 0x100000000 + lo : lo;
      }
      if (sz < 8 || p + sz > end) break;
      if (tp === targetType) {
        return { offset: p, size: sz };
      }
      p += sz;
    }
    return null;
  }

  /**
   * Đọc timescale + loại handler ('vide'/'soun') của từng track trong moov (dựa vào tkhd.track_id
   * và mdia/mdhd.timescale + mdia/hdlr.handler_type). Dùng để tính duration đúng đơn vị thay vì
   * giả định cứng 90000.
   * @param {Uint8Array} initU8 - buffer chứa ftyp + moov
   * @returns {Map<number, {timescale:number, type:string|null}>} trackId -> { timescale, type }
   */
  static _getTrackTimescales(initU8) {
    const map = new Map();
    const boxes = StreamInspector.inspectTopLevelBoxes(initU8);
    const moovBox = boxes.find((b) => b.type === 'moov');
    if (!moovBox) return map;

    let p = moovBox.offset + 8;
    const end = moovBox.offset + moovBox.size;

    while (p + 8 <= end) {
      let sz = StreamInspector.readUint32(initU8, p);
      const tp = StreamInspector.readType(initU8, p + 4);
      if (sz === 1) {
        const hi = StreamInspector.readUint32(initU8, p + 8);
        const lo = StreamInspector.readUint32(initU8, p + 12);
        sz = hi !== 0 ? hi * 0x100000000 + lo : lo;
      }
      if (sz < 8 || p + sz > end) break;

      if (tp === 'trak') {
        let trackId = null;
        const tkhdInfo = this._findSubboxOffset(initU8, p, sz, 'tkhd');
        if (tkhdInfo) {
          const tv = initU8[tkhdInfo.offset + 8];
          trackId = tv === 0
            ? StreamInspector.readUint32(initU8, tkhdInfo.offset + 20)
            : StreamInspector.readUint32(initU8, tkhdInfo.offset + 28);
        }

        let timescale = null;
        let handlerType = null;
        const mdiaInfo = this._findSubboxOffset(initU8, p, sz, 'mdia');
        if (mdiaInfo) {
          const mdhdInfo = this._findSubboxOffset(initU8, mdiaInfo.offset, mdiaInfo.size, 'mdhd');
          if (mdhdInfo) {
            const mv = initU8[mdhdInfo.offset + 8];
            timescale = mv === 0
              ? StreamInspector.readUint32(initU8, mdhdInfo.offset + 20)
              : StreamInspector.readUint32(initU8, mdhdInfo.offset + 28);
          }
          const hdlrInfo = this._findSubboxOffset(initU8, mdiaInfo.offset, mdiaInfo.size, 'hdlr');
          if (hdlrInfo) {
            handlerType = StreamInspector.readType(initU8, hdlrInfo.offset + 16);
          }
        }

        if (trackId !== null) {
          map.set(trackId, { timescale: timescale || 90000, type: handlerType });
        }
      }
      p += sz;
    }

    return map;
  }

  /**
   * Tính tổng thời lượng thực tế (giây) từ danh sách các cặp moof+mdat.
   * Tính duration độc lập cho TỪNG TRACK theo timescale thực tế của track đó,
   * sau đó lấy max(durationTrack) để làm duration chung.
   * @param {Array} pairs - mảng { moofData, mdatData, time, trackId, trunDuration }
   * @param {Map<number, {timescale:number, type:string|null}>} trackTimescales - Map trackId -> {timescale, type}
   * @returns {number} duration tính bằng giây, hoặc 0 nếu không tính được
   */
  static _calcActualDuration(pairs, trackTimescales) {
    if (!pairs || !pairs.length) return 0;

    // Nhóm pairs theo trackId để tính duration độc lập cho từng track
    const trackPairsMap = new Map();
    for (const p of pairs) {
      if (p.trackId === null) continue;
      if (!trackPairsMap.has(p.trackId)) {
        trackPairsMap.set(p.trackId, []);
      }
      trackPairsMap.get(p.trackId).push(p);
    }

    let maxDurationSec = 0;

    for (const [trackId, trackPairs] of trackPairsMap) {
      const validTimes = trackPairs.filter(p => p.time >= 0);
      if (!validTimes.length) continue;

      validTimes.sort((a, b) => a.time - b.time);

      const firstTime = validTimes[0].time;
      const lastPair = validTimes[validTimes.length - 1];
      const lastTime = lastPair.time;
      const lastDur = lastPair.trunDuration || 0;

      const tInfo = trackTimescales?.get(trackId);
      const ts = tInfo?.timescale || 90000;

      const trackTotalUnits = (lastTime - firstTime) + lastDur;
      const trackDurationSec = trackTotalUnits / ts;
      console.log(`[VDP-fMP4] ⏱️ Track ${trackId} (${tInfo?.type || 'unknown'}): firstTime=${firstTime}, lastTime=${lastTime}, lastDur=${lastDur}, ts=${ts} → ${trackDurationSec.toFixed(3)}s`);

      if (trackDurationSec > maxDurationSec) {
        maxDurationSec = trackDurationSec;
      }
    }

    // Fallback nếu không nhóm được theo trackId
    if (maxDurationSec <= 0) {
      const validTimes = pairs.filter(p => p.time >= 0);
      if (validTimes.length) {
        validTimes.sort((a, b) => a.time - b.time);
        const firstTime = validTimes[0].time;
        const lastPair = validTimes[validTimes.length - 1];
        const lastTime = lastPair.time;
        const lastDur = lastPair.trunDuration || 0;
        maxDurationSec = ((lastTime - firstTime) + lastDur) / 90000;
      }
    }

    console.log(`[VDP-fMP4] ⏱️ Tổng duration tính được từ tất cả các track: ${maxDurationSec.toFixed(3)}s`);
    return maxDurationSec;
  }

  /**
   * Sửa header duration (mvhd, tkhd VÀ mdhd) trong moov box để mọi player nhận đúng thời lượng.
   *
   * Quy tắc ISO-BMFF:
   *  - mvhd.duration dùng movie timescale (thường 90000 hoặc 600)
   *  - tkhd.duration dùng movie timescale (giống mvhd)
   *  - mdhd.duration dùng media timescale riêng của track (video: 90000, audio: 44100/48000)
   *
   * @param {Uint8Array} u8 - buffer mutable chứa initSegment (ftyp + moov)
   * @param {number} durationSec - thời lượng thực tế tính bằng giây
   */
  static _patchMoovDuration(u8, durationSec) {
    if (!durationSec || durationSec <= 0) {
      console.warn('[VDP-fMP4] ⚠️ durationSec không hợp lệ, bỏ qua patch duration');
      return;
    }

    const boxes = StreamInspector.inspectTopLevelBoxes(u8);
    const moovBox = boxes.find((b) => b.type === 'moov');
    if (!moovBox) {
      console.warn('[VDP-fMP4] ⚠️ Không tìm thấy moov box để patch duration');
      return;
    }

    const mvhdInfo = this._findSubboxOffset(u8, moovBox.offset, moovBox.size, 'mvhd');
    if (!mvhdInfo) {
      console.warn('[VDP-fMP4] ⚠️ Không tìm thấy mvhd box');
      return;
    }

    const o = mvhdInfo.offset;
    const version = u8[o + 8];
    let movieTimescale = 90000;
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

    // --- 1. Patch mvhd ---
    if (version === 0) {
      movieTimescale = StreamInspector.readUint32(u8, o + 20);
      const targetDur = Math.min(Math.floor(durationSec * movieTimescale), 0xFFFFFFFE);
      view.setUint32(o + 24, targetDur, false);
      console.log(`[VDP-fMP4] 🔧 mvhd (v0): ts=${movieTimescale}, dur=${targetDur} (${durationSec.toFixed(3)}s)`);
    } else {
      movieTimescale = StreamInspector.readUint32(u8, o + 28);
      const targetDur = BigInt(Math.floor(durationSec * movieTimescale));
      view.setBigUint64(o + 32, targetDur, false);
      console.log(`[VDP-fMP4] 🔧 mvhd (v1): ts=${movieTimescale}, dur=${targetDur} (${durationSec.toFixed(3)}s)`);
    }

    // --- 2. Patch tkhd VÀ mdhd cho từng track ---
    let pTrak = moovBox.offset + 8;
    const moovEnd = moovBox.offset + moovBox.size;

    while (pTrak + 8 <= moovEnd) {
      let sz = StreamInspector.readUint32(u8, pTrak);
      const tp = StreamInspector.readType(u8, pTrak + 4);
      if (sz === 1) {
        const hi = StreamInspector.readUint32(u8, pTrak + 8);
        const lo = StreamInspector.readUint32(u8, pTrak + 12);
        sz = hi !== 0 ? hi * 0x100000000 + lo : lo;
      }
      if (sz < 8 || pTrak + sz > moovEnd) break;

      if (tp === 'trak') {
        // Patch tkhd (dùng movie timescale = mvhd timescale)
        const tkhdInfo = this._findSubboxOffset(u8, pTrak, sz, 'tkhd');
        if (tkhdInfo) {
          const to = tkhdInfo.offset;
          const tv = u8[to + 8];
          const trakTargetDur = Math.min(Math.floor(durationSec * movieTimescale), 0xFFFFFFFE);
          if (tv === 0) {
            view.setUint32(to + 28, trakTargetDur, false);
          } else {
            view.setBigUint64(to + 36, BigInt(Math.floor(durationSec * movieTimescale)), false);
          }
          console.log(`[VDP-fMP4] 🔧 tkhd (v${tv}): dur=${trakTargetDur} (${durationSec.toFixed(3)}s)`);
        }

        // Patch mdhd (media timescale RIÊNG của track: video 90000, audio 44100/48000...)
        const mdiaInfo = this._findSubboxOffset(u8, pTrak, sz, 'mdia');
        if (mdiaInfo) {
          const mdhdInfo = this._findSubboxOffset(u8, mdiaInfo.offset, mdiaInfo.size, 'mdhd');
          if (mdhdInfo) {
            const mo = mdhdInfo.offset;
            const mv = u8[mo + 8];
            if (mv === 0) {
              const mdhdTs = StreamInspector.readUint32(u8, mo + 20);
              const mdhdTargetDur = Math.min(Math.floor(durationSec * mdhdTs), 0xFFFFFFFE);
              view.setUint32(mo + 24, mdhdTargetDur, false);
              console.log(`[VDP-fMP4] 🔧 mdhd (v0): ts=${mdhdTs}, dur=${mdhdTargetDur} (${durationSec.toFixed(3)}s)`);
            } else {
              const mdhdTs = StreamInspector.readUint32(u8, mo + 28);
              const mdhdTargetDur = BigInt(Math.floor(durationSec * mdhdTs));
              view.setBigUint64(mo + 32, mdhdTargetDur, false);
              console.log(`[VDP-fMP4] 🔧 mdhd (v1): ts=${mdhdTs}, dur=${mdhdTargetDur} (${durationSec.toFixed(3)}s)`);
            }
          }
        }
      }
      pTrak += sz;
    }
  }

  /**
   * Ghép các buffer fMP4 thành Blob video/mp4 hoàn chỉnh tương thích với mọi player chuẩn
   * (QuickTime, Chrome, Safari, iOS, Android, VLC, ffmpeg, Windows Media Player...).
   *
   * @param {Object} params
   * @param {Array<ArrayBuffer|null>} params.buffers - Mảng buffer segment (có thể có null)
   * @param {string|null} params.initSegmentUrl - URL để tải init segment riêng (nếu có)
   * @param {Function|null} params.fetchRawFn - Hàm fetch(url, isKey) → ArrayBuffer
   * @param {{start: number, end: number}|null} params.clipRange - Khoảng thời gian cắt (giây)
   * @returns {Promise<Blob>} Blob video/mp4
   */
  static async build({ buffers, initSegmentUrl, fetchRawFn, clipRange = null }) {
    let initBuffer = null;

    // 1. Tải init segment theo URL nếu có và fetchRawFn được cung cấp
    if (initSegmentUrl && fetchRawFn && typeof fetchRawFn === 'function') {
      try {
        initBuffer = await fetchRawFn(initSegmentUrl, true);
        console.log(`[VDP-fMP4] ✅ Tải init segment từ URL: ${initSegmentUrl}`);
      } catch (err) {
        console.warn('[VDP-fMP4] ⚠️ Không tải được init segment từ URL:', err.message);
      }
    }

    // 2. Nếu chưa có, tìm init segment chứa 'ftyp' trong mảng buffers
    if (!initBuffer) {
      const initIndex = buffers.findIndex(
        (b) => b && StreamInspector.containsBox(b, 'ftyp')
      );
      if (initIndex >= 0) {
        const u8 = BufferUtils.toUint8Array(buffers[initIndex]);
        const boxes = StreamInspector.inspectTopLevelBoxes(u8);
        const headerBoxes = boxes.filter((b) => ['ftyp', 'moov', 'free', 'skip'].includes(b.type));
        let headerEnd = 0;
        for (const hb of headerBoxes) {
          if (hb.offset + hb.size > headerEnd) headerEnd = hb.offset + hb.size;
        }
        initBuffer = headerEnd > 0 ? u8.subarray(0, headerEnd) : u8;
        console.log(`[VDP-fMP4] ✅ Tìm thấy init segment tại buffers[${initIndex}], header size=${initBuffer.byteLength}`);
      }
    }

    if (!initBuffer) {
      throw new Error('fMP4 không có init segment (thiếu box ftyp/moov)');
    }
    if (!StreamInspector.containsBox(initBuffer, 'ftyp')) {
      throw new Error('Init segment không chứa box ftyp hợp lệ');
    }

    // 3. Phân tách và gom các cặp (moof, mdat) từ toàn bộ buffers, kèm thông tin patch cần thiết
    const pairs = [];
    for (let i = 0; i < buffers.length; i++) {
      const buf = buffers[i];
      if (!buf) continue;

      const u8 = BufferUtils.toUint8Array(buf);
      const boxes = StreamInspector.inspectTopLevelBoxes(u8);

      for (let j = 0; j < boxes.length; j++) {
        if (boxes[j].type === 'moof') {
          const moofBox = boxes[j];
          const mdatBox =
            j + 1 < boxes.length && boxes[j + 1].type === 'mdat'
              ? boxes[j + 1]
              : null;

          const moofData = u8.subarray(moofBox.offset, moofBox.offset + moofBox.size);
          const mdatData = mdatBox
            ? u8.subarray(mdatBox.offset, mdatBox.offset + mdatBox.size)
            : null;

          const info = this._parseMoofInfo(moofData);
          pairs.push({
            moofData,
            mdatData,
            time: info.tfdtValue,
            trackId: info.trackId,
            tfdtOffset: info.tfdtOffset,
            tfdtVersion: info.tfdtVersion,
            mfhdSeqOffset: info.mfhdSeqOffset,
            tfhdBaseDataOffsetFieldOffset: info.tfhdBaseDataOffsetFieldOffset,
            trunDuration: info.trunDuration
          });

          if (mdatBox) j++;
        }
      }
    }

    if (!pairs.length) {
      throw new Error('Không tìm thấy media fragment (moof+mdat) nào hợp lệ');
    }

    console.log(`[VDP-fMP4] 📊 Tổng số fragment: ${pairs.length}, có tfdt: ${pairs.filter(p => p.time >= 0).length}`);

    // 4. Sắp xếp fragment theo thời gian tfdt (fragment không có tfdt đưa về cuối)
    pairs.sort((a, b) => {
      if (a.time < 0 && b.time < 0) return 0;
      if (a.time < 0) return 1;
      if (b.time < 0) return -1;
      return a.time - b.time;
    });
    console.log(`[VDP-fMP4] 🔀 Đã sắp xếp ${pairs.length} fragment theo tfdt`);

    // --- FIX #1: Rebase tfdt về 0 theo TỪNG TRACK ---
    // Giúp timeline media thực tế khớp với duration khai trong header, tương thích ffmpeg/VLC/Windows Media.
    const minTimeByTrack = new Map();
    for (const p of pairs) {
      if (p.time >= 0 && p.trackId !== null) {
        const cur = minTimeByTrack.has(p.trackId) ? minTimeByTrack.get(p.trackId) : Infinity;
        if (p.time < cur) minTimeByTrack.set(p.trackId, p.time);
      }
    }
    let rebasedCount = 0;
    for (const p of pairs) {
      if (p.time >= 0 && p.trackId !== null && p.tfdtOffset >= 0) {
        const minTime = minTimeByTrack.get(p.trackId) || 0;
        const newTime = Math.max(0, p.time - minTime);
        if (p.tfdtVersion === 0) {
          this._writeUint32(p.moofData, p.tfdtOffset, newTime);
        } else {
          this._writeUint64(p.moofData, p.tfdtOffset, newTime);
        }
        p.time = newTime;
        rebasedCount++;
      }
    }
    console.log(`[VDP-fMP4] 🔧 Đã rebase tfdt về 0 cho ${rebasedCount}/${pairs.length} fragment (theo ${minTimeByTrack.size} track)`);

    // --- FIX #2: Renumber mfhd.sequence_number tuần tự 1,2,3... theo đúng thứ tự đã sort ---
    // Tránh trường hợp nhiều segment CDN gốc đều mang cùng sequence_number → demuxer chuẩn coi là hỏng.
    let renumberedCount = 0;
    pairs.forEach((p, idx) => {
      if (p.mfhdSeqOffset >= 0) {
        this._writeUint32(p.moofData, p.mfhdSeqOffset, idx + 1);
        renumberedCount++;
      }
    });
    console.log(`[VDP-fMP4] 🔧 Đã renumber mfhd.sequence_number cho ${renumberedCount}/${pairs.length} fragment`);

    // --- FIX #4: Đọc timescale thực tế của từng track thay vì hard-code 90000 ---
    const initU8 = BufferUtils.toUint8Array(initBuffer);
    const trackTimescales = this._getTrackTimescales(initU8);
    let videoTimescale = 90000;
    let foundVideoTrack = false;
    for (const [, tInfo] of trackTimescales) {
      if (tInfo.type === 'vide') {
        videoTimescale = tInfo.timescale;
        foundVideoTrack = true;
        break;
      }
    }
    if (!foundVideoTrack && trackTimescales.size) {
      const first = trackTimescales.values().next().value;
      if (first) videoTimescale = first.timescale;
    }
    if (trackTimescales.size) {
      console.log(`[VDP-fMP4] 📐 Timescale track dùng để tính duration: ${videoTimescale} (video track ${foundVideoTrack ? 'tìm thấy' : 'KHÔNG tìm thấy, dùng track đầu tiên'})`);
    }

    // 5. Tính duration thực tế độc lập cho từng track
    let durationSec = 0;
    if (clipRange && Number.isFinite(clipRange.end - clipRange.start) && clipRange.end > clipRange.start) {
      durationSec = clipRange.end - clipRange.start;
      console.log(`[VDP-fMP4] ⏱️ Duration từ clipRange: ${durationSec.toFixed(3)}s`);
    } else {
      durationSec = this._calcActualDuration(pairs, trackTimescales);
      if (!durationSec || durationSec <= 0) {
        const totalUnits = pairs.reduce((sum, p) => sum + (p.trunDuration || 0), 0);
        durationSec = totalUnits > 0 ? totalUnits / videoTimescale : 0;
        console.warn(`[VDP-fMP4] ⚠️ Fallback duration từ trunDuration: ${totalUnits} units (ts=${videoTimescale}) → ${durationSec.toFixed(3)}s`);
      }
    }

    if (!durationSec || durationSec <= 0) {
      console.warn('[VDP-fMP4] ⚠️ Không tính được duration, file có thể không có thời lượng đúng trên một số player');
    }

    // 6. Patch initBuffer với duration đã tính
    const initCopy = new Uint8Array(initU8.byteLength);
    initCopy.set(initU8);

    if (durationSec > 0) {
      this._patchMoovDuration(initCopy, durationSec);
    }

    // --- FIX #3: Patch tfhd.base_data_offset về đúng vị trí byte tuyệt đối trong file mới ---
    // Nếu segment gốc dùng base-data-offset-present với offset tuyệt đối trỏ vào file CDN gốc,
    // giá trị đó sẽ sai hoàn toàn sau khi ghép thành file mới → phải tính lại theo vị trí thực tế.
    {
      let runningOffset = initCopy.byteLength;
      let patchedCount = 0;
      for (const p of pairs) {
        if (p.tfhdBaseDataOffsetFieldOffset >= 0) {
          this._writeUint64(p.moofData, p.tfhdBaseDataOffsetFieldOffset, runningOffset);
          patchedCount++;
        }
        runningOffset += p.moofData.byteLength + (p.mdatData ? p.mdatData.byteLength : 0);
      }
      if (patchedCount) {
        console.log(`[VDP-fMP4] 🔧 Đã patch tfhd.base_data_offset cho ${patchedCount}/${pairs.length} fragment`);
      }
    }

    // 7. Kết hợp tất cả dữ liệu
    const parts = [initCopy];
    for (const p of pairs) {
      parts.push(p.moofData);
      if (p.mdatData) parts.push(p.mdatData);
    }

    const combined = BufferUtils.concatenateBuffers(parts);
    StreamInspector.validateFMP4(combined);

    console.log(
      `[VDP-fMP4] ✅ Ghép thành công fMP4 (${pairs.length} fragments, dur=${durationSec.toFixed(2)}s) → ${(combined.byteLength / 1024 / 1024).toFixed(2)} MB`
    );

    return new Blob([combined], { type: 'video/mp4' });
  }
}