import { createDecipheriv } from 'node:crypto';
import JSON5 from 'json5';
import { load } from 'cheerio';
import { HttpError, readText, webUrl } from './util.mjs';

const maxSize = 8 * 1024 * 1024;
const htmlStart = /^\s*(?:<!doctype\s+html|<html|<head|<body)/i;
const usefulConfig = value => value && typeof value === 'object' &&
  (Array.isArray(value.sites) || Array.isArray(value.urls) || Array.isArray(value.list));

function decodeCbc(text) {
  const hex = text.replace(/\s+/g, '');
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) throw new Error('invalid hex');
  const bytes = Buffer.from(hex, 'hex');
  const boundary = bytes.indexOf(Buffer.from('#$'));
  if (boundary < 2 || boundary > 18 || bytes.length < boundary + 2 + 16 + 13) throw new Error('invalid envelope');
  const keyText = bytes.subarray(2, boundary).toString('utf8').toLowerCase();
  const ivText = bytes.subarray(-13).toString('utf8').toLowerCase();
  if (!/^[\x20-\x7e]{0,16}$/.test(keyText) || !/^[\x20-\x7e]{13}$/.test(ivText)) throw new Error('invalid key or iv');
  const ciphertext = bytes.subarray(boundary + 2, -13);
  if (ciphertext.length % 16) throw new Error('invalid ciphertext');
  const decipher = createDecipheriv('aes-128-cbc', Buffer.from(keyText.padEnd(16, '0')), Buffer.from(ivText.padEnd(16, '0')));
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

export function decodeConfig(text) {
  let current = text.replace(/^\uFEFF/, '').trim();
  const encodings = [];
  for (let depth = 0; depth < 5; depth++) {
    if (Buffer.byteLength(current) > maxSize) throw new HttpError(502, '解码后的配置数据过大。');
    if (/^<\?xml|^<rss\b/i.test(current)) return { text: current, format: 'xml', encodings };
    try {
      const value = JSON5.parse(current);
      if (typeof value === 'string') { current = value.trim();encodings.push('json-string');continue; }
      return { value, text: current, format: 'json', encodings };
    } catch {}
    try {
      if (/^2423/i.test(current)) { current = decodeCbc(current).trim();encodings.push('aes-cbc');continue; }
      // TVBox's public text wrapper carries an eight-character marker before **.
      const marker = /[a-z0-9]{8}\*\*/i.exec(current);
      if (marker && !htmlStart.test(current)) {
        const payload = current.slice(marker.index + marker[0].length).replace(/\s+/g, '');
        if (!payload || !/^[a-z0-9+/]+={0,2}$/i.test(payload) || payload.length % 4 === 1) throw new Error('invalid base64');
        current = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(payload, 'base64')).trim();
        encodings.push('base64');continue;
      }
    } catch { throw new HttpError(400, '识别到编码配置，但数据不完整或无法解码。请检查配置地址是否仍有效。'); }
    throw new HttpError(400, '配置地址没有返回有效的 JSON / XML 或受支持的编码配置。');
  }
  throw new HttpError(400, '配置编码嵌套过深。');
}

function htmlConfig(text, base) {
  const $ = load(text);
  // Only data blocks are read. Page scripts, verification challenges and advertisements are never executed.
  for (const node of $('script[type="application/json"],script[type="application/ld+json"]')) {
    try { const parsed = decodeConfig($(node).text());if (usefulConfig(parsed.value)) return { parsed }; } catch {}
  }
  if (/parklogic\.com|sedoparking\.com|parkingcrew\.(?:net|com)|domain\s+(?:is\s+)?for\s+sale/i.test(text))
    throw new HttpError(400, '该地址返回域名停放 / 广告跳转页面，未提供影视配置。请更换有效配置链接。');
  if (/拒绝访问|access denied|sign in|登录|captcha|验证码|verify you are human|just a moment/i.test($('title').text() + ' ' + $('body').text()))
    throw new HttpError(403, '配置地址返回登录、验证或访问限制页面，无法匿名读取配置。');
  let target;
  for (const node of $('meta[http-equiv]')) {
    if ($(node).attr('http-equiv')?.toLowerCase() !== 'refresh') continue;
    target = $(node).attr('content')?.match(/;\s*url\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/i)?.slice(1).find(Boolean);
    if (target) break;
  }
  if (!target) {
    const expression = /(?:window\.|document\.)?location(?:\.href)?\s*=\s*["']([^"'\r\n]+)["']|(?:window\.|document\.)?location\.(?:replace|assign)\(\s*["']([^"'\r\n]+)["']\s*\)/;
    for (const node of $('script:not([src])')) {
      const match = $(node).text().match(expression);
      if (match) { target = match[1] || match[2];break; }
    }
  }
  if (target) return { redirect: webUrl(target, base).href };
  throw new HttpError(400, '该地址返回的是 HTML 网页，未找到影视配置。需要能直接返回配置的链接。');
}

export async function readConfiguration(raw, fetcher, signal) {
  let url = webUrl(raw).href;
  const visited = new Set(), steps = [];
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000);
  try {
    for (let count = 0; count < 5; count++) {
      if (visited.has(url)) throw new HttpError(400, '配置跳转形成循环。');
      visited.add(url);
      const response = await fetcher(url, { signal: combined, headers: { 'user-agent': 'okhttp/4.12.0', accept: 'application/json, text/plain, */*' } });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const reason = [401,403].includes(response.status) ? '配置服务器拒绝访问，可能需要登录或受到访问限制' :
          response.status === 404 ? '配置地址不存在或已迁移' : response.status === 429 ? '配置服务器限制了请求频率，请稍后重试' : '配置服务器返回错误';
        throw new HttpError(502, reason + '（HTTP ' + response.status + '）。');
      }
      const base = webUrl(response.url || url).href;
      const text = await readText(response, maxSize);
      if (htmlStart.test(text) || /^text\/html\b/i.test(response.headers.get('content-type') || '') && /^\s*</.test(text)) {
        const result = htmlConfig(text, base);
        if (result.parsed) return { ...result.parsed, url: base, steps: [...steps, 'html-data'] };
        steps.push('html-redirect');url = result.redirect;continue;
      }
      return { ...decodeConfig(text), url: base, steps };
    }
    throw new HttpError(400, '配置网页跳转次数过多。');
  } catch (error) {
    if (signal?.aborted || error.status) throw error;
    if (combined.aborted) throw new HttpError(504, '配置读取超时，请检查地址或网络后重试。');
    if (['ENOTFOUND','EAI_AGAIN'].includes(error.code)) throw new HttpError(502, '无法解析配置域名，请检查地址是否仍有效。');
    throw new HttpError(502, '无法读取配置地址，请检查网络或稍后重试。');
  }
}
