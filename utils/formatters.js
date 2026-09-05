/**
 * Formatters: Tiện ích định dạng dữ liệu
 */

export function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return 'N/A';
  const sec = Math.floor(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  const pad = (n) => n.toString().padStart(2, '0');

  if (h > 0) {
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(m)}:${pad(s)}`;
}

export function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return 'N/A';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(2)} ${units[i]}`;
}

export function sanitizeFilename(filename, extension = 'mp4') {
  if (!filename) filename = 'video';
  // Xóa các ký tự không hợp lệ trên Windows / macOS / Linux
  let sanitized = filename
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .trim();

  // Đảm bảo không quá dài
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100);
  }

  // Bỏ đuôi file cũ nếu trùng
  sanitized = sanitized.replace(/\.(mp4|webm|m3u8|ts)$/i, '');

  return `${sanitized}.${extension}`;
}

export function parseTimeStringToSeconds(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const str = timeStr.trim();
  if (!str) return null;

  // Nếu chỉ nhập số đơn thuần (ví dụ "90")
  if (/^\d+(\.\d+)?$/.test(str)) {
    return parseFloat(str);
  }

  const parts = str.split(':').map((p) => parseFloat(p.trim()));
  if (parts.some((p) => isNaN(p))) return null;

  if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
}

