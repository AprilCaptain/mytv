import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { managedServer, stopServer } from '../lib/lifecycle.mjs';

export async function waitForService(root, port, control, child) {
  console.log('此窗口可控制服务：按 Ctrl+C，或输入 q 回车停止并释放端口。');
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('正在停止 My TV…');
    try { await stopServer(root, port, control.instance); console.log('My TV 已停止，端口 ' + port + ' 已释放。'); finish(); }
    catch (error) { console.error(error.message); stopping = false; }
  };
  const fallback = () => { if (child && child.exitCode === null && !child.killed) child.kill('SIGTERM'); };
  const lines = createInterface({ input: process.stdin, terminal: false });
  lines.on('line', line => { if (['q', 'quit', 'exit', '退出'].includes(line.trim().toLowerCase())) void stop(); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('exit', fallback);
  if (process.platform !== 'win32') process.on('SIGHUP', stop);
  let checking = false;
  let missed = 0;
  const timer = setInterval(async () => {
    if (stopping || checking) return;
    checking = true;
    try {
      const active = await managedServer(root, port);
      missed = active?.instance === control.instance ? 0 : missed + 1;
      if (missed >= 3) {
        console.log('My TV 服务已结束，此控制窗口退出。'); finish();
      }
    } finally { checking = false; }
  }, 500);
  try { await done; }
  finally {
    clearInterval(timer); lines.close();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    process.removeListener('SIGHUP', stop); process.removeListener('exit', fallback);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const port = Number(process.env.PORT || 3210);
  try {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1–65535 之间的整数。');
    await stopServer(root, port);
    console.log('My TV 已停止或未运行，端口 ' + port + ' 已释放。');
  } catch (error) { console.error('停止失败：' + error.message); process.exitCode = 1; }
}
