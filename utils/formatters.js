export function formatTime(seconds) {
  if (seconds === null || seconds === undefined || isNaN(seconds) || !isFinite(seconds)) return 'N/A';
  if (seconds < 0) return 'N/A';
  if (seconds === 0) return '00:00';
  const sec = Math.floor(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => n.toString().padStart(2, '0');
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
export function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return 'N/A';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(2)} ${units[i]}`;
}
export function sanitizeFilename(filename, extension = 'mp4') {
  if (!filename) filename = 'video';
  let sanitized = filename.replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, '_').trim();
  if (sanitized.length > 100) sanitized = sanitized.substring(0, 100);
  sanitized = sanitized.replace(/\.(mp4|webm|m3u8|ts)$/i, '');
  return `${sanitized}.${extension}`;
}
export function parseTimeStringToSeconds(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const str = timeStr.trim(); if (!str) return null;
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
  const parts = str.split(':').map((p) => parseFloat(p.trim()));
  if (parts.some((p) => isNaN(p))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}
