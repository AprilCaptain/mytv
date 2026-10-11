import { HttpError, MemoryCache, readText, webUrl } from '../util.mjs';

export class PluginBroker {
  constructor(fetcher) { this.fetcher = fetcher; this.code = new MemoryCache(40, 15 * 60_000); }
  async script(raw, signal) {
    const url = webUrl(raw).href;
    const cached = this.code.get(url);
    if (cached) return cached;
    const response = await this.fetcher(url, { signal, timeout: 12_000 });
    if (!response.ok) { await response.body?.cancel(); throw new HttpError(502, '插件或依赖无法下载（HTTP ' + response.status + '）。'); }
    return this.code.set(url, await readText(response, 3 * 1024 * 1024));
  }
  async request(raw, options = {}, signal) {
    const url = webUrl(raw);
    const headers = { ...options.headers };
    let body = options.bodyBase64 ? Buffer.from(options.bodyBase64, 'base64') : options.body;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json); headers['content-type'] = 'application/json';
    } else if (options.data != null) {
      body = typeof options.data === 'string' ? options.data : new URLSearchParams(options.data).toString();
      headers['content-type'] ||= 'application/x-www-form-urlencoded';
    }
    if (options.params) for (const [key, value] of Object.entries(options.params)) url.searchParams.set(key, String(value));
    const response = await this.fetcher(url.href, {
      headers, body, method: options.method || (body != null ? 'POST' : 'GET'), signal,
      redirect: options.redirect !== false && options.redirect !== 0,
      timeout: Math.min(15_000, Math.max(1000, Number(options.timeout) || 12_000))
    });
    const reader = response.body?.getReader();
    const chunks = []; let size = 0;
    try {
      if (reader) while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 8 * 1024 * 1024) throw new HttpError(502, '插件响应超过大小限制。');
        chunks.push(chunk.value);
      }
    } finally { await reader?.cancel().catch(() => {}); }
    const bytes = Buffer.concat(chunks, size);
    let content;
    const charsetFrom = value => String(value||'').match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
    const requestType = Object.entries(headers).find(([key])=>key.toLowerCase()==='content-type')?.[1];
    const encoding = options.encoding || charsetFrom(requestType) || charsetFrom(response.headers.get('content-type')) ||
      charsetFrom(bytes.subarray(0,4096).toString('latin1')) || 'utf-8';
    try { content = new TextDecoder(encoding,{fatal:true}).decode(bytes); }
    catch { try {content=new TextDecoder('gb18030').decode(bytes);}catch{content=bytes.toString('utf8');} }
    return { code: response.status, status: response.status, url: response.url || url.href,
      headers: Object.fromEntries(response.headers), content: options.buffer === 2 ? bytes.toString('base64') : content,
      base64: bytes.toString('base64') };
  }
}
