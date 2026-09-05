/**
 * M3U8Parser: Phân tích cú pháp file playlist HLS .m3u8
 */
export class M3U8Parser {
  /**
   * Resolve URL tương đối dựa trên baseURL
   */
  static resolveUrl(relativeUrl, baseUrl) {
    try {
      return new URL(relativeUrl, baseUrl).href;
    } catch (e) {
      return relativeUrl;
    }
  }

  /**
   * Phân tích playlist M3U8 (tự động phát hiện Master Playlist hay Media Playlist)
   */
  static async parse(m3u8Url) {
    const response = await fetch(m3u8Url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const content = await response.text();
    return this.parseContent(content, m3u8Url);
  }

  static async parseContent(content, baseUrl) {
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    if (!lines[0] || !lines[0].startsWith('#EXTM3U')) {
      throw new Error('File không đúng định dạng M3U8 hợp lệ');
    }

    const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'));

    if (isMaster) {
      return await this.handleMasterPlaylist(lines, baseUrl);
    } else {
      return this.handleMediaPlaylist(lines, baseUrl);
    }
  }

  /**
   * Nếu là Master Playlist chứa nhiều luồng chất lượng khác nhau (1080p, 720p...)
   */
  static async handleMasterPlaylist(lines, baseUrl) {
    const streams = [];
    let currentBandwidth = 0;
    let currentResolution = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        if (bandwidthMatch) currentBandwidth = parseInt(bandwidthMatch[1], 10);

        const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
        if (resolutionMatch) currentResolution = resolutionMatch[1];

        // Dòng tiếp theo là URL của sub-playlist
        if (i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
          const streamUrl = this.resolveUrl(lines[i + 1], baseUrl);
          streams.push({
            bandwidth: currentBandwidth,
            resolution: currentResolution,
            url: streamUrl
          });
          i++;
        }
      }
    }

    if (streams.length === 0) {
      throw new Error('Không tìm thấy luồng video trong Master Playlist');
    }

    // Chọn luồng có chất lượng / bandwidth cao nhất
    streams.sort((a, b) => b.bandwidth - a.bandwidth);
    const bestStream = streams[0];

    // Tải và parse playlist của luồng cao nhất
    const parsedSub = await this.parse(bestStream.url);
    if (bestStream.resolution) {
      parsedSub.resolution = bestStream.resolution;
    }
    return parsedSub;
  }

  /**
   * Phân tích Media Playlist chứa danh sách các tệp phân đoạn (.ts)
   */
  static handleMediaPlaylist(lines, baseUrl) {
    const segments = [];
    let totalDuration = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#EXTINF:')) {
        const durMatch = line.match(/#EXTINF:([\d.]+)/);
        const dur = durMatch ? parseFloat(durMatch[1]) : 0;
        totalDuration += dur;

        // Dòng tiếp theo là URL phân đoạn
        if (i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
          const segUrl = this.resolveUrl(lines[i + 1], baseUrl);
          const startTime = totalDuration - dur;
          const endTime = totalDuration;

          segments.push({
            index: segments.length,
            duration: dur,
            startTime: startTime,
            endTime: endTime,
            url: segUrl
          });
          i++;
        }
      }
    }

    return {
      type: 'MEDIA',
      segments: segments,
      totalDuration: totalDuration,
      segmentCount: segments.length
    };
  }
}
