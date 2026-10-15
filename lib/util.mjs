export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class MemoryCache {
  constructor(limit = 128, ttl = 600_000) { this.limit = limit; this.ttl = ttl; this.items = new Map(); }
  get(key) {
    const entry = this.items.get(key);
    if (!entry) return undefined;
    if (entry.expires < Date.now()) { this.items.delete(key); return undefined; }
    return entry.value;
  }
  set(key, value) {
    this.items.delete(key);
    while (this.items.size >= this.limit) this.items.delete(this.items.keys().next().value);
    this.items.set(key, { value, expires: Date.now() + this.ttl });
    return value;
  }
}

export async function readBytes(response, limit = 8 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new HttpError(502, '源返回的数据过大，请更换源。');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks, total);
}

export async function readText(response, limit = 8 * 1024 * 1024) {
  return (await readBytes(response,limit)).toString('utf8').replace(/^\uFEFF/, '');
}

export function cleanText(value = '') {
  // Exclude another '<': unmatched runs must not trigger quadratic backtracking.
  return String(value).replace(/<[^<>]*>/g, ' ').replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

export function webUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error();
    return url;
  } catch { throw new HttpError(400, '请输入有效的 HTTP 或 HTTPS 地址。'); }
}
