import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireSetupLock, ensureNodeDependencies } from './environment.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export function pythonPath(root = projectRoot, platform = process.platform) {
  return join(root, '.venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}

function probe(command, args = [], code = 'import sys,json,venv,ensurepip; print(json.dumps({"path":sys.executable,"prefix":sys.prefix,"version":list(sys.version_info[:2])}))') {
  const result = spawnSync(command, [...args, '-I', '-c', code], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
  if (result.error || result.status !== 0) return null;
  try { return JSON.parse(result.stdout.trim()); } catch { return null; }
}

export function supportedPython(info) {
  return info?.version?.[0] === 3 && info.version[1] >= 11 && info.version[1] <= 14;
}

function virtualEnvironment(info, root) {
  const normalize = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
  return supportedPython(info) && typeof info.prefix === 'string' && normalize(info.prefix) === normalize(join(root, '.venv'));
}

export async function pythonReady(root = projectRoot) {
  const executable = pythonPath(root);
  if (!existsSync(executable)) return false;
  const lock = await readFile(join(root, 'requirements.lock.txt'), 'utf8');
  const expected = Object.fromEntries(lock.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const match = /^([\w.-]+)==([^\s;]+)$/.exec(line.trim());
    if (!match) throw new Error('requirements.lock.txt 必须使用固定版本。');
    return [match[1], match[2]];
  }));
  const code = 'import sys,json,importlib.metadata as m; import requests,Crypto,lxml.etree,bs4; ' +
    'print(json.dumps({"version":list(sys.version_info[:2]),"prefix":sys.prefix,"packages":' +
    '{name:m.version(name) for name in ' + JSON.stringify(Object.keys(expected)) + '}}))';
  const info = probe(executable, [], code);
  return virtualEnvironment(info, root) &&
    Object.entries(expected).every(([name, version]) => info.packages[name] === version);
}

function run(command, args, root, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env, windowsHide: true, timeout: 10 * 60_000 });
  if (result.error || result.status !== 0) throw new Error('Python 环境准备失败：请检查网络、磁盘空间或 Python 版本，再次启动会重试。');
}

export function checkPython(root = projectRoot, { candidates } = {}) {
  if (candidates === undefined) {
    candidates = process.env.MYTV_BOOTSTRAP_PYTHON ? [[process.env.MYTV_BOOTSTRAP_PYTHON]] :
      [[pythonPath(root)], ...(process.platform === 'win32' ?
        [['py', '-3.14'], ['py', '-3.13'], ['py', '-3.12'], ['py', '-3.11'], ['python'], ['python3']] :
        [['python3'], ['/opt/homebrew/bin/python3'], ['/usr/local/bin/python3']])];
  }
  for (const [command, ...args] of candidates) {
    const info = probe(command, args);
    if (supportedPython(info) && (command !== pythonPath(root) || virtualEnvironment(info, root))) return info;
  }
  throw new Error('未找到可用的 Python 3.11–3.14（需要 venv / ensurepip）。请手动安装后重试：https://www.python.org/downloads/');
}

export async function setupPython(root = projectRoot, { log = console.log, runtime } = {}) {
  runtime ||= checkPython(root);
  if (await pythonReady(root)) { log('Python 与锁定版本的依赖已就绪，跳过安装。'); return pythonPath(root); }
  const venv = join(root, '.venv');
  const executable = pythonPath(root);
  const current = existsSync(executable) && probe(executable, [], 'import sys,json; print(json.dumps({"version":list(sys.version_info[:2]),"prefix":sys.prefix}))');
  if (!virtualEnvironment(current, root)) {
    await mkdir(join(root, '.runtime'), { recursive: true });
    const backup = existsSync(venv) ? join(root, '.runtime', 'venv-backup-' + Date.now()) : null;
    if (backup) await rename(venv, backup);
    try {
      log('使用已有 Python ' + runtime.version.join('.') + '，创建项目虚拟环境…');
      run(runtime.path, ['-m', 'venv', venv], root);
    } catch (error) {
      await rm(venv, { recursive: true, force: true });
      if (backup) await rename(backup, venv);
      throw error;
    }
    if (backup) await rm(backup, { recursive: true, force: true });
  }
  const pip = spawnSync(executable, ['-I', '-m', 'pip', '--version'], { timeout: 15_000, windowsHide: true });
  if (pip.status !== 0) run(executable, ['-I', '-m', 'ensurepip', '--upgrade'], root);
  log('正在安装 / 修复 Python 项目依赖（.venv）…');
  run(executable, ['-m', 'pip', 'install', '--require-virtualenv', '--only-binary=:all:',
    '--disable-pip-version-check', '--no-input', '-r', join(root, 'requirements.lock.txt')], root);
  if (!await pythonReady(root)) throw new Error('Python 项目依赖安装后校验失败。');
  log('Python 项目依赖已就绪。');
  return executable;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let release;
  try {
    const runtime = checkPython(projectRoot);
    release = await acquireSetupLock(projectRoot);
    await ensureNodeDependencies(projectRoot);
    await setupPython(projectRoot, { runtime });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await release?.(); }
}
