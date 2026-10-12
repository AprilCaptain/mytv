export function formatTime(value) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60;
  return (hours ? hours + ':' : '') + String(minutes).padStart(2, '0') + ':' + String(rest).padStart(2, '0');
}

export function seekBounds(duration, seekable) {
  if (Number.isFinite(duration) && duration > 0) return { start: 0, end: duration };
  if (seekable?.length) {
    const start = seekable.start(0), end = seekable.end(seekable.length - 1);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) return { start, end };
  }
  return null;
}

export function seekTarget(current, delta, bounds) {
  return bounds ? Math.max(bounds.start, Math.min(bounds.end, (Number.isFinite(current) ? current : bounds.start) + delta)) : null;
}

export function hoverTime(clientX, left, width, bounds) {
  if (!bounds || width <= 0) return null;
  return bounds.start + Math.max(0, Math.min(1, (clientX - left) / width)) * (bounds.end - bounds.start);
}
