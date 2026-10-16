import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError, MemoryCache, readText, webUrl } from './util.mjs';
import { sourceHeaders, crossOriginHeaders } from './network.mjs';
import { mediaType } from './media-security.mjs';
import { normalizeRasterTs } from './segment-stream.mjs';
const validPlaylist=text=>/^\s*#EXTM3U(?:\r?\n|$)/.test(text);

export class Playback {
  constructor(fetcher) {
    this.fetcher = fetcher;
    this.secret = randomBytes(32);
    this.sessions = new MemoryCache(200, 6 * 60 * 60_000);
    this.initialLists = new MemoryCache(8, 10_000);
  }

  async create(raw, headers = {}, signal) {
    headers=sourceHeaders(headers);
    const url = webUrl(raw).href;
    if (/\.(html?)(?:$|[?#])|\/share\//i.test(url))
      throw new HttpError(422, '这是网页播放线路，请选择 m3u8 / MP4 线路。');
    let hls = /\.m3u8(?:$|[?#])/i.test(url);
    let initial;
    if (hls || !/\.(m3u8|mp4|m4v|webm|mov)(?:$|[?#])/i.test(url)) {
      const deadline=AbortSignal.timeout(10_000),combined=signal?AbortSignal.any([signal,deadline]):deadline;
      let response;
      try{response=await this.fetcher(url, { headers, signal:combined });}
      catch(error){if(!signal?.aborted&&deadline.aborted)throw new HttpError(504,'这条线路连接超时，请尝试其他线路。');throw error;}
      const contentType = response.headers.get('content-type') || '';
      if(!response.ok){await response.body?.cancel();throw new HttpError(502,[404,410].includes(response.status)?'这条线路的播放地址已失效，请尝试其他线路。':'播放地址返回 HTTP '+response.status+'，请尝试其他线路。');}
      if(hls||/mpegurl|text\/plain/i.test(contentType)){
        const text=await readText(response,2*1024*1024);
        if(!validPlaylist(text))throw new HttpError(422,'这条线路没有返回有效的视频播放列表，请尝试其他线路。');
        hls=true;initial={text,base:response.url||url};
      }else await response.body?.cancel();
      if (!hls&&/text\/html|application\/json/i.test(contentType))
        throw new HttpError(422, '这是网页或接口地址，请使用 m3u8 / MP4 视频地址。');
    }
    const token = randomBytes(18).toString('hex');
    this.sessions.set(token, { url, headers: sourceHeaders(headers) });
    if(initial&&initial.text.length<=256*1024)this.initialLists.set(token,initial);
    return { url: this.link(token, url,hls), format: hls ? 'hls' : 'auto' };
  }

  signature(token, encoded, playlist=false) {
    return createHmac('sha256', this.secret).update(token + '\n' + encoded+(playlist?'\nplaylist':'')).digest('hex');
  }

  link(token, raw,playlist=false) {
    const encoded = Buffer.from(webUrl(raw).href).toString('base64url');
    return '/api/media/' + token + '?u=' + encoded + (playlist?'&p=playlist':'')+'&s=' + this.signature(token, encoded,playlist);
  }

  verify(token, encoded, signature,playlist=false) {
    const session = this.sessions.get(token);
    if (!session) throw new HttpError(410, '播放链接已失效，请重新选择这一集。');
    const expected = this.signature(token, encoded,playlist);
    if (!/^[0-9a-f]{64}$/.test(signature || '') ||
      !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex')))
      throw new HttpError(403, '播放链接无效。');
    return { ...session, credentialOrigin:new URL(session.url).origin,
      url: webUrl(Buffer.from(encoded, 'base64url').toString()).href };
  }

  rewrite(text, base, token) {
    let variant=false;
    return text.split(/\r?\n/).map(line => {
      const value=line.trim();if (!value) return line;
      if (value.startsWith('#')) {
        if(value.startsWith('#EXT-X-STREAM-INF:'))variant=true;
        const playlist=/^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|IMAGE-STREAM-INF|RENDITION-REPORT):/.test(value);
        return line.replace(/\bURI="([^"]+)"/g,(_match, uri) => 'URI="' + this.link(token, webUrl(uri, base).href,playlist) + '"');
      }
      const playlist=variant;variant=false;
      return this.link(token, webUrl(value, base).href,playlist);
    }).join('\n');
  }

  async media(token, encoded, signature, range, signal,playlist=false) {
    const session = this.verify(token, encoded, signature,playlist);
    const initial=this.initialLists.get(token);
    if(initial&&session.url===this.sessions.get(token).url&&!range){
      this.initialLists.items.delete(token);
      return new Response(this.rewrite(initial.text,initial.base,token),{headers:{'content-type':'application/vnd.apple.mpegurl','cache-control':'no-store'}});
    }
    const headers = new URL(session.url).origin===session.credentialOrigin ?
      {...session.headers}:crossOriginHeaders(session.headers);
    if (range && /^bytes=\d*-\d*(?:,\d*-\d*)*$/.test(range)) headers.range = range;
    let response = await this.fetcher(session.url, { headers, signal, timeout: 30_000 });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status === 416 ? 416 : 502, '媒体源返回 HTTP ' + response.status + '。');
    }
    const contentType = response.headers.get('content-type') || '';
    const hls = playlist || /\.m3u8(?:$|[?#])/i.test(session.url) || /mpegurl/i.test(contentType);
    if (hls) {
      const text = await readText(response, 2 * 1024 * 1024);
      if (!validPlaylist(text))
        throw new HttpError(502, '这个播放地址没有返回有效的 HLS 播放列表。');
      return new Response(this.rewrite(text, response.url || session.url, token), {
        headers: { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' }
      });
    }
    let type;
    try{type=mediaType(contentType);}catch(error){await response.body?.cancel();throw error;}
    response=await normalizeRasterTs(response);
    const outgoing = new Headers({ 'cache-control': 'no-store' });
    outgoing.set('content-type',type);
    outgoing.set('content-security-policy',"default-src 'none'; sandbox");
    outgoing.set('x-content-type-options','nosniff');
    for (const key of ['content-length', 'content-range', 'accept-ranges', 'content-encoding'])
      if (response.headers.has(key)) outgoing.set(key, response.headers.get(key));
    return new Response(response.body, { status: response.status, headers: outgoing });
  }
}
