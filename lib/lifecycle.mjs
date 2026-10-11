import http from 'node:http';
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export const rootIdentity = root => createHash('sha256').update(
  process.platform === 'win32' ? resolve(root).toLowerCase() : resolve(root)).digest('hex');
export const controlPath = (root, port) => join(root, '.runtime', 'server-' + port + '.json');

export async function readControl(root, port) {
  try {
    const value = JSON.parse(await readFile(controlPath(root, port), 'utf8'));
    return value.rootId === rootIdentity(root) && value.port === port &&
      /^[a-f0-9]{64}$/.test(value.token) && /^[a-f0-9]{32}$/.test(value.instance) ? value : null;
  } catch { return null; }
}

export async function registerServer(root, port) {
  const value = { pid: process.pid, port, rootId: rootIdentity(root),
    instance: randomBytes(16).toString('hex'), token: randomBytes(32).toString('hex') };
  await mkdir(join(root, '.runtime'), { recursive: true });
  const temp = controlPath(root, port) + '.' + process.pid + '.tmp';
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, controlPath(root, port));
  return value;
}

export async function removeControl(root, port, instance) {
  const current = await readControl(root, port);
  if (current?.instance === instance) await unlink(controlPath(root, port)).catch(() => {});
}

function request(port, path, { method = 'GET', token } = {}) {
  return new Promise(resolve => {
    let complete = false;
    const finish = value => { if (!complete) { complete = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { req.destroy(); finish(null); }, 1500);
    const req = http.request({ hostname: '127.0.0.1', port, path, method,
      headers: token ? { 'content-type': 'application/json', 'x-mytv-control': token } : {} }, response => {
      let body = '';
      response.on('data', data => { body += data; if (body.length > 4096) { req.destroy(); finish(null); } });
      response.on('end', () => {
        try { finish(response.statusCode === 200 ? JSON.parse(body) : null); } catch { finish(null); }
      });
      response.on('error', () => finish(null));
    });
    req.on('error', () => finish(null));
    req.end(token ? '{}' : undefined);
  });
}

export const serverHealth = port => request(port, '/api/health');
export function portAvailable(port) {
  return new Promise(resolve => {
    const socket = net.createServer();
    socket.once('error', () => resolve(false));
    socket.listen(port, '127.0.0.1', () => socket.close(() => resolve(true)));
  });
}

export async function managedServer(root, port) {
  const control = await readControl(root, port);
  if (!control) return null;
  const health = await serverHealth(port);
  return health?.app === 'my-tv' && health.rootId === control.rootId && health.instance === control.instance ? control : null;
}

export async function stopServer(root, port, expectedInstance) {
  const control = await managedServer(root, port);
  if (!control) {
    if (await portAvailable(port)) return;
    // Ctrl+C may reach the child before the controlling window; allow that shutdown to finish.
    if (expectedInstance) for (let attempt = 0; attempt < 70; attempt++) {
      if (await portAvailable(port)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('端口 ' + port + ' 上的服务无法确认为当前项目的 My TV，未停止其他进程。');
  }
  if (expectedInstance && control.instance !== expectedInstance) return;
  const result = await request(port, '/api/shutdown', { method: 'POST', token: control.token });
  if (!result?.ok) {
    if (await portAvailable(port)) return;
    throw new Error('停止请求失败，请在原运行窗口重试 Ctrl+C。');
  }
  for (let attempt = 0; attempt < 70; attempt++) {
    if (await portAvailable(port)) { await removeControl(root, port, control.instance); return; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('服务停止超时，端口 ' + port + ' 尚未释放。');
}
