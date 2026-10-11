import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createApi } from './lib/api.mjs';
import { timingSafeEqual } from 'node:crypto';
import { registerServer, removeControl } from './lib/lifecycle.mjs';

const root = new URL('./', import.meta.url);
const publicRoot = new URL('./public/', root);
const port = Number(process.env.PORT || 3210);
const host = process.env.HOST || '127.0.0.1';
let control;
const rootPath = fileURLToPath(root);
const api = createApi(undefined, { origin: 'http://' + host + ':' + port,
  health: () => control ? { rootId: control.rootId, instance: control.instance } : {} });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const securityHeaders = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: http: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-origin'
};

const server = http.createServer(async (incoming, outgoing) => {
  const controller = new AbortController();
  outgoing.on('close', () => { if (!outgoing.writableFinished) controller.abort(); });
  try {
    const hostname = incoming.headers.host || '';
    const expected = host === '127.0.0.1' ?
      new Set(['127.0.0.1:' + port, 'localhost:' + port]) : new Set([host + ':' + port]);
    if (!expected.has(hostname)) { outgoing.writeHead(403); outgoing.end('Invalid host'); return; }
    const url = new URL(incoming.url, 'http://' + hostname);
    for (const [name, value] of Object.entries(securityHeaders)) outgoing.setHeader(name, value);
    if (url.pathname === '/api/shutdown') {
      const secret = String(incoming.headers['x-mytv-control'] || '');
      const origin = incoming.headers.origin;
      const allowed = control && incoming.method === 'POST' && (!origin || origin === url.origin) &&
        incoming.headers['sec-fetch-site'] !== 'cross-site' && /^[a-f0-9]{64}$/.test(secret) &&
        timingSafeEqual(Buffer.from(secret), Buffer.from(control.token));
      outgoing.writeHead(allowed ? 200 : 403, { 'content-type': 'application/json' });
      if (allowed) outgoing.once('finish', shutdown);
      incoming.resume();
      outgoing.end(JSON.stringify({ ok: Boolean(allowed) }));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const method = incoming.method;
      let body;
      if (method !== 'GET' && method !== 'HEAD') {
        if (!incoming.headers['content-type']?.startsWith('application/json')) {
          outgoing.writeHead(415); outgoing.end('Expected application/json'); return;
        }
        const chunks = []; let length = 0;
        for await (const chunk of incoming) {
          length += chunk.length;
          if (length > 32_768) { outgoing.writeHead(413); outgoing.end(); return; }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
      }
      const request = new Request(url, { method, headers: incoming.headers, body, signal: controller.signal });
      const response = await api(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing, { signal: controller.signal });
      else outgoing.end();
      return;
    }
    if (!['GET', 'HEAD'].includes(incoming.method)) { outgoing.writeHead(405); outgoing.end(); return; }
    const files = new Map([
      ['/', new URL('index.html', publicRoot)], ['/index.html', new URL('index.html', publicRoot)],
      ['/app.js', new URL('app.js', publicRoot)], ['/style.css', new URL('style.css', publicRoot)],
      ['/favicon.svg', new URL('favicon.svg', publicRoot)],
      ['/placeholder.svg', new URL('placeholder.svg', publicRoot)],
      ['/vendor/hls.min.js', new URL('node_modules/hls.js/dist/hls.min.js', root)]
    ]);
    const file = files.get(url.pathname);
    if (!file) { outgoing.writeHead(404); outgoing.end('Not found'); return; }
    const data = await readFile(file);
    const extension = file.pathname.slice(file.pathname.lastIndexOf('.'));
    outgoing.writeHead(200, { 'content-type': types[extension] || 'application/octet-stream',
      'cache-control': url.pathname.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache' });
    outgoing.end(incoming.method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (!controller.signal.aborted) console.error(error.message);
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
});

server.listen(port, host, async () => {
  try {
    control = await registerServer(rootPath, port);
    console.log('My TV 已启动：http://' + host + ':' + port);
    console.log('按 Ctrl+C 停止。目录：' + rootPath);
  } catch (error) { console.error('服务控制文件写入失败：' + error.message); shutdown(); }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ?
    '端口 ' + port + ' 已被占用。请关闭已有服务，或设置 PORT 使用其他端口。' : error.message);
  process.exitCode = 1;
});
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  setTimeout(() => process.exit(0), 5000).unref();
  server.close(async () => {
    if (control) await removeControl(rootPath, port, control.instance);
    process.exit(0);
  });
  server.closeAllConnections();
  api.close();
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, shutdown);
