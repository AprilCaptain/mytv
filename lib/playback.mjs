import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError, MemoryCache, readText, webUrl } from './util.mjs';
import { sourceHeaders } from './network.mjs';

export class Playback {
  constructor(fetcher) {
    this.fetcher = fetcher;
    this.secret = randomBytes(32);
    this.sessions = new MemoryCache(200, 6 * 60 * 60_000);
  }

  async create(raw, headers = {}, signal) {
    const url = webUrl(raw).href;
    if (/\.(html?)(?:$|[?#])|\/share\//i.test(url))
      throw new HttpError(422, '这是网页播放线路，请选择 m3u8 / MP4 线路。');
    let hls = /\.m3u8(?:$|[?#])/i.test(url);
    if (!/\.(m3u8|mp4|m4v|webm|mov)(?:$|[?#])/i.test(url)) {
      const response = await this.fetcher(url, { headers, signal });
      const contentType = response.headers.get('content-type') || '';
      await response.body?.cancel();
      if (!response.ok) throw new HttpError(502, '播放地址返回 HTTP ' + response.status + '。');
      if (/text\/html|application\/json/i.test(contentType))
        throw new HttpError(422, '这是网页或接口地址，请使用 m3u8 / MP4 视频地址。');
      hls = /mpegurl/i.test(contentType);
    }
    const token = randomBytes(18).toString('hex');
    this.sessions.set(token, { url, headers: sourceHeaders(headers) });
    return { url: this.link(token, url), format: hls ? 'hls' : 'auto' };
  }

  signature(token, encoded) {
    return createHmac('sha256', this.secret).update(token + '\n' + encoded).digest('hex');
  }

  link(token, raw) {
    const encoded = Buffer.from(webUrl(raw).href).toString('base64url');
    return '/api/media/' + token + '?u=' + encoded + '&s=' + this.signature(token, encoded);
  }

  verify(token, encoded, signature) {
    const session = this.sessions.get(token);
    if (!session) throw new HttpError(410, '播放链接已失效，请重新选择这一集。');
    const expected = this.signature(token, encoded);
    if (!/^[0-9a-f]{64}$/.test(signature || '') ||
      !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex')))
      throw new HttpError(403, '播放链接无效。');
    return { ...session, url: webUrl(Buffer.from(encoded, 'base64url').toString()).href };
  }

  rewrite(text, base, token) {
    return text.split(/\r?\n/).map(line => {
      if (!line.trim()) return line;
      if (line.startsWith('#')) return line.replace(/\bURI="([^"]+)"/g,
        (_match, uri) => 'URI="' + this.link(token, webUrl(uri, base).href) + '"');
      return this.link(token, webUrl(line.trim(), base).href);
    }).join('\n');
  }

  async media(token, encoded, signature, range, signal) {
    const session = this.verify(token, encoded, signature);
    const headers = { ...session.headers };
    if (range && /^bytes=\d*-\d*(?:,\d*-\d*)*$/.test(range)) headers.range = range;
    const response = await this.fetcher(session.url, { headers, signal, timeout: 30_000 });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status === 416 ? 416 : 502, '媒体源返回 HTTP ' + response.status + '。');
    }
    const contentType = response.headers.get('content-type') || '';
    const hls = /\.m3u8(?:$|[?#])/i.test(session.url) || /mpegurl/i.test(contentType);
    if (hls) {
      const text = await readText(response, 2 * 1024 * 1024);
      if (!text.trimStart().startsWith('#EXTM3U'))
        throw new HttpError(502, '这个播放地址没有返回有效的 HLS 播放列表。');
      return new Response(this.rewrite(text, response.url || session.url, token), {
        headers: { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' }
      });
    }
    if (/text\/html|application\/json/i.test(contentType)) {
      await response.body?.cancel();
      throw new HttpError(422, '这条线路返回了网页或错误信息，请更换播放线路。');
    }
    const outgoing = new Headers({ 'cache-control': 'no-store' });
    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-encoding'])
      if (response.headers.has(key)) outgoing.set(key, response.headers.get(key));
    return new Response(response.body, { status: response.status, headers: outgoing });
  }
}
