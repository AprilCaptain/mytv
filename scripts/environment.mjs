import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, open, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

export function npmCli(executable = process.execPath) {
  const folder = dirname(executable);
  return [join(folder, 'node_modules/npm/bin/npm-cli.js'),
    join(folder, '../lib/node_modules/npm/bin/npm-cli.js'), process.env.npm_execpath]
    .find(path => path && existsSync(path));
}

export async function nodeDependenciesReady(root) {
  let lock;
  try { lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')); } catch { return false; }
  // Check the entire locked tree; this also detects a partially interrupted npm ci.
  for (const [path, expected] of Object.entries(lock.packages || {})) {
    if (!path.startsWith('node_modules/')) continue;
    try {
      const actual = JSON.parse(await readFile(join(root, path, 'package.json'), 'utf8'));
      if (actual.version !== expected.version) return false;
    } catch { return false; }
  }
  const marker = join(root, 'node_modules', '.my-tv-environment.json');
  const fingerprint = createHash('sha256').update(JSON.stringify(lock)).update(
    process.platform + '/' + process.arch + '/' + process.versions.node.split('.')[0]).digest('hex');
  try {
    const previous = JSON.parse(await readFile(marker, 'utf8'));
    if (previous.fingerprint !== fingerprint) return false;
  } catch { /* Existing correct installs can be adopted after the import check. */ }
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    'await Promise.all(' + JSON.stringify(Object.keys(pkg.dependencies).filter(x => x !== 'hls.js')) + '.map(x=>import(x)));'],
  { cwd: root, timeout: 20_000, windowsHide: true, stdio: 'ignore' });
  if (result.status !== 0 || !existsSync(join(root, 'node_modules/hls.js/dist/hls.min.js'))) return false;
  await writeFile(marker, JSON.stringify({ fingerprint }));
  return true;
}

export async function ensureNodeDependencies(root, log = console.log) {
  if (await nodeDependenciesReady(root)) { log('Node 依赖已就绪，跳过安装。'); return; }
  const cli = npmCli();
  if (!cli) throw new Error('npm 不完整，请手动修复 / 安装 Node.js 后重试：https://nodejs.org/');
  log('正在按照 package-lock.json 安装 / 修复 Node 依赖…');
  const result = spawnSync(process.execPath, [cli, 'ci', '--no-audit', '--no-fund'],
    { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 10 * 60_000,
      env: { ...process.env, PATH: dirname(process.execPath) + (process.platform === 'win32' ? ';' : ':') + process.env.PATH } });
  if (result.error || result.status !== 0) throw new Error('Node 依赖安装失败。请检查网络 / npm 源、目录写入权限和磁盘空间后重试。');
  if (!await nodeDependenciesReady(root)) throw new Error('Node 依赖安装后校验失败。');
}

export async function acquireSetupLock(root) {
  await mkdir(join(root, '.runtime'), { recursive: true });
  const path = join(root, '.runtime', 'setup.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx');
      await file.writeFile(JSON.stringify({ pid: process.pid }));
      await file.close();
      return () => unlink(path).catch(() => {});
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let existing;
      try { existing = JSON.parse(await readFile(path, 'utf8')); } catch {
        throw new Error('环境准备锁不完整。请确认没有其他启动窗口，再删除 .runtime/setup.lock 重试。');
      }
      try { process.kill(existing.pid, 0); } catch (error) {
        if (error.code === 'ESRCH') { await unlink(path).catch(() => {}); continue; }
      }
      throw new Error('另一个窗口正在检查 / 安装环境，请等待它完成后再启动。');
    }
  }
  throw new Error('无法取得环境准备锁，请重新启动。');
}
