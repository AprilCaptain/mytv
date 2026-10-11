import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { EnvHttpProxyAgent, request as proxyRequest } from 'undici';
import { HttpError, MemoryCache, webUrl } from './util.mjs';

const agents = {
  'http:': new http.Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 8 }),
  'https:': new https.Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 8 })
};
const dnsCache = new MemoryCache(256, 60_000);
const directHosts = new MemoryCache(128, 5 * 60_000);
const proxyAgent = ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY'].some(key => process.env[key]) ?
  new EnvHttpProxyAgent({ connections: 8 }) : null;

export function discardStream(source) {
  source.on('error', () => {});
  source.destroy();
}

export function toWebStream(source) {
  let finished = false;
  let onData, onEnd, onError;
  const detach = () => {
    source.off('data', onData);
    source.off('end', onEnd);
    // Keep the guarded error listener for late socket errors after cancellation.
  };
  return new ReadableStream({
    start(controller) {
      source.pause();
      onData = chunk => {
        if (finished) return;
        controller.enqueue(chunk);
        if (controller.desiredSize <= 0) source.pause();
      };
      onEnd = () => {
        if (finished) return;
        finished = true; detach(); controller.close();
      };
      onError = error => {
        if (finished) return;
        finished = true; detach(); controller.error(error);
      };
      source.on('data', onData);
      source.on('end', onEnd);
      source.on('error', onError);
    },
    pull() { if (!finished) source.resume(); },
    cancel() { finished = true; detach(); source.destroy(); }
  });
}

export function isPublicAddress(address) {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19].includes(b)));
  }
  if (isIP(ip) === 6) {
    if (ip.startsWith('::ffff:')) {
      const suffix = ip.slice(7);
      if (isIP(suffix) === 4) return isPublicAddress(suffix);
      const parts = suffix.split(':');
      if (parts.length === 2) {
        const n = (parseInt(parts[0], 16) * 65536) + parseInt(parts[1], 16);
        return isPublicAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
      }
      return false;
    }
    return /^[23][0-9a-f]{3}:/.test(ip) && !ip.startsWith('2001:db8:');
  }
  return false;
}

async function resolveAddress(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local'))
    throw new HttpError(400, '源地址不能指向本机或局域网。');
  const cached = dnsCache.get(host);
  if (cached) return cached;
  const records = isIP(host) ? [{ address: host, family: isIP(host) }] :
    await lookup(host, { all: true });
  if (!records.length || records.some(r => !isPublicAddress(r.address)))
    throw new HttpError(400, '源地址不能指向本机或局域网。');
  // Pin the checked address to this connection instead of resolving it again.
  return dnsCache.set(host, records.find(r => r.family === 4) || records[0]);
}

export function sourceHeaders(raw = {}) {
  const headers = { 'user-agent': 'Mozilla/5.0', accept: '*/*' };
  const blocked = new Set(['host', 'connection', 'content-length', 'transfer-encoding',
    'accept-encoding', 'proxy-authorization', 'upgrade']);
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = {}; } }
  for (const [key, value] of Object.entries(raw || {})) {
    const name = key.toLowerCase();
    if (!blocked.has(name) && /^[a-z0-9-]+$/.test(name) && typeof value === 'string' &&
      value.length <= 8192 && !/[\r\n]/.test(value)) headers[name] = value;
  }
  headers['accept-encoding'] = 'identity';
  return headers;
}

export async function remoteFetch(raw, options = {}, redirects = 0) {
  const url = webUrl(raw);
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'HEAD'].includes(method)) throw new HttpError(400, '插件请求方法不受支持。');
  const requestHeaders = sourceHeaders(options.headers);
  const requestBody = options.body == null ? undefined : Buffer.from(options.body);
  if (requestBody?.length > 2 * 1024 * 1024) throw new HttpError(400, '插件请求内容过大。');
  if (redirects > 5) throw new HttpError(502, '源重定向次数过多。');
  const record = await resolveAddress(url);
  const transport = url.protocol === 'https:' ? https : http;
  const useProxy = proxyAgent && !options.direct && !directHosts.get(url.hostname);
  const retryDirect = async () => {
    const response = await remoteFetch(raw, { ...options, direct: true }, redirects);
    if (response.ok) directHosts.set(url.hostname, true);
    return response;
  };
  let response;
  try {
    if (useProxy) {
      const result = await proxyRequest(url, {
        dispatcher: proxyAgent, method, body: requestBody, signal: options.signal,
        headers: requestHeaders, headersTimeout: options.timeout || 25_000,
        bodyTimeout: options.timeout || 30_000, maxRedirections: 0
      });
      response = result.body;
      response.statusCode = result.statusCode;
      response.headers = result.headers;
    } else response = await new Promise((resolve, reject) => {
      const request = transport.request(url, {
        method, agent: agents[url.protocol], signal: options.signal,
        headers: requestHeaders,
        lookup: (_host, opts, callback) => opts.all ?
          callback(null, [record]) : callback(null, record.address, record.family)
      }, result => { clearTimeout(deadline); resolve(result); });
      const deadline = setTimeout(() => request.destroy(new Error('upstream timeout')), options.timeout || 25_000);
      request.setTimeout(options.timeout || 25_000, () => request.destroy(new Error('upstream timeout')));
      request.on('error', error => { clearTimeout(deadline); reject(error); });
      request.end(requestBody);
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (useProxy) return retryDirect();
    throw new HttpError(502, /timeout/i.test(error.message) ?
      '源连接超时，请更换源或稍后重试。' : '无法连接这个源，请更换源或检查网络。');
  }
  // Some media CDNs reject a proxy's egress IP while allowing the user's own IP.
  if (useProxy && method === 'GET' && [403, 404].includes(response.statusCode)) {
    discardStream(response);
    return retryDirect();
  }
  if (options.redirect !== false && [301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
    discardStream(response);
    const next = webUrl(response.headers.location, url).href;
    const headers = { ...options.headers };
    if (new URL(next).origin !== url.origin) {
      for (const key of Object.keys(headers))
        if (['cookie', 'authorization'].includes(key.toLowerCase())) delete headers[key];
    }
    const switchToGet = response.statusCode === 303 || (method === 'POST' && [301, 302].includes(response.statusCode));
    return remoteFetch(next, { ...options, headers, method: switchToGet ? 'GET' : method,
      body: switchToGet ? undefined : options.body }, redirects + 1);
  }
  const headers = new Headers();
  for (const [name, values] of Object.entries(response.headers))
    if (values != null && !['connection', 'transfer-encoding'].includes(name))
      headers.set(name, Array.isArray(values) ? values.join(', ') : values);
  let stream = response;
  const encoding = headers.get('content-encoding');
  const decompressor = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ?
    createInflate() : encoding === 'br' ? createBrotliDecompress() : null;
  if (decompressor) {
    response.on('error', error => decompressor.destroy(error));
    stream = response.pipe(decompressor);
    decompressor.on('close', () => response.destroy());
    headers.delete('content-encoding');
    headers.delete('content-length');
  }
  if (method === 'HEAD' || [204, 304].includes(response.statusCode)) {
    discardStream(response);
    return new Response(null, { status: response.statusCode, headers });
  }
  const result = new Response(toWebStream(stream), { status: response.statusCode, headers });
  Object.defineProperty(result, 'url', { value: url.href });
  return result;
}
