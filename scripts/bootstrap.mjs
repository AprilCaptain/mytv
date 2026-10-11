import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureNodeDependencies, nodeDependenciesReady, acquireSetupLock } from './environment.mjs';
import { setupPython, pythonReady, checkPython } from './setup-python.mjs';

import { managedServer, portAvailable } from '../lib/lifecycle.mjs';
import { waitForService } from './control.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const setupOnly = process.argv.includes('--setup-only') || process.env.MYTV_SETUP_ONLY === '1';
const checkOnly = process.argv.includes('--check-only');
const noBrowser = process.argv.includes('--no-browser') || process.env.MYTV_NO_BROWSER === '1';
const skipPython = process.env.MYTV_SKIP_PYTHON === '1';
const port = Number(process.env.PORT || 3210);
const url = 'http://127.0.0.1:' + port;

function openBrowser() {
  if (noBrowser) return;
  const args = process.platform === 'darwin' ? ['open', [url]] : ['rundll32.exe', ['url.dll,FileProtocolHandler', url]];
  const child = spawn(...args, { stdio: 'ignore', detached: true, windowsHide: true });
  child.on('error', () => console.log('请在浏览器打开：' + url));
  child.unref();
}

async function launch() {
  let control = await managedServer(root, port);
  if (control) {
    console.log('My TV 已在运行，已连接到已有服务：' + url);
    openBrowser();
    await waitForService(root, port, control);
    return;
  }
  if (!await portAvailable(port)) throw new Error('端口 ' + port + ' 被其他程序或旧版服务占用。请关闭已有服务，或设置 PORT 后重试。');
  console.log('正在启动 My TV…');
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) }, windowsHide: true });
  child.once('error', error => console.error(error.message));
  const earlyStop = () => { if (child.exitCode === null && !child.killed) child.kill('SIGTERM'); };
  process.on('SIGINT', earlyStop); process.on('SIGTERM', earlyStop); process.on('exit', earlyStop);
  if (process.platform !== 'win32') process.on('SIGHUP', earlyStop);
  try {
    for (let attempt = 0; attempt < 60 && child.exitCode === null && !child.killed; attempt++) {
      control = await managedServer(root, port);
      if (control) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!control) throw new Error('服务启动失败，请查看上方错误。');
    process.removeListener('SIGINT', earlyStop); process.removeListener('SIGTERM', earlyStop); process.removeListener('SIGHUP', earlyStop);
    console.log('已就绪：' + url);
    openBrowser();
    await waitForService(root, port, control, child);
  } finally {
    process.removeListener('SIGINT', earlyStop); process.removeListener('SIGTERM', earlyStop);
    process.removeListener('SIGHUP', earlyStop); process.removeListener('exit', earlyStop);
    earlyStop();
  }
}

try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('需要 Node.js 22 或更新版本，请手动安装后重试：https://nodejs.org/');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1–65535 之间的整数。');
  console.log('My TV · 检查运行环境（' + process.platform + ' / ' + process.arch + '，Node ' + process.versions.node + '）');
  // Validate both runtimes before any dependency install or venv creation.
  const runtime = skipPython ? null : checkPython(root);
  if (checkOnly) {
    if (!await nodeDependenciesReady(root) || (!skipPython && !await pythonReady(root))) throw new Error('项目依赖未齐全，请运行启动脚本补装。');
    console.log('环境检查通过。');
  } else {
    const release = await acquireSetupLock(root);
    try {
      await ensureNodeDependencies(root);
      if (skipPython) console.log('MYTV_SKIP_PYTHON=1：跳过 Python 环境检查与项目依赖。');
      else await setupPython(root, { runtime });
    } finally { await release(); }
    if (process.platform === 'win32') console.log('Windows：HTTP / JS 片源可用；Python 片源暂缺系统隔离支持。');
    if (setupOnly) console.log('环境准备完成。');
    else await launch();
  }
} catch (error) { console.error('\n启动失败：' + error.message); process.exitCode = 1; }
