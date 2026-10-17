import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import {stopServer} from '../lib/lifecycle.mjs';
import { nodeDependenciesReady, acquireSetupLock } from '../scripts/environment.mjs';
import { pythonPath, pythonReady, checkPython, supportedPython } from '../scripts/setup-python.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'My TV 环境测试-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('依赖检查识别完整安装、模块文件缺失及 lockfile 变化（含中文空格路径）', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'node_modules/probe-module'), { recursive: true });
  await mkdir(join(root, 'node_modules/hls.js/dist'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { 'probe-module': '1.0.0', 'hls.js': '1.0.0' } }));
  const lock = { packages: { 'node_modules/probe-module': { version: '1.0.0' }, 'node_modules/hls.js': { version: '1.0.0' } } };
  await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock));
  await writeFile(join(root, 'node_modules/probe-module/package.json'), '{"name":"probe-module","version":"1.0.0","type":"module","main":"index.js"}');
  await writeFile(join(root, 'node_modules/probe-module/index.js'), 'export default true;');
  await writeFile(join(root, 'node_modules/hls.js/package.json'), '{"version":"1.0.0"}');
  await writeFile(join(root, 'node_modules/hls.js/dist/hls.min.js'), '');
  assert.equal(await nodeDependenciesReady(root), true);
  assert.equal(await nodeDependenciesReady(root), true);
  await rm(join(root, 'node_modules/probe-module/index.js'));
  assert.equal(await nodeDependenciesReady(root), false);
  await writeFile(join(root, 'node_modules/probe-module/index.js'), 'export default true;');
  lock.lockfileVersion = 3;
  await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock));
  assert.equal(await nodeDependenciesReady(root), false);
});

test('环境锁避免同时安装，退出后可重新取得，并恢复失效进程的锁', async t => {
  const root = await fixture(t);
  const release = await acquireSetupLock(root);
  await assert.rejects(acquireSetupLock(root), /另一个窗口/);
  await release();
  const releaseAgain = await acquireSetupLock(root); await releaseAgain();
  await writeFile(join(root, '.runtime/setup.lock'), JSON.stringify({ pid: 2147483647 }));
  const recovered = await acquireSetupLock(root); await recovered();
});

test('缺失的 Python 环境被识别，两平台使用正确的虚拟环境路径', async t => {
  const root = await fixture(t);
  assert.equal(await pythonReady(root), false);
  assert.equal(pythonPath(root, 'darwin'), join(root, '.venv/bin/python'));
  assert.equal(pythonPath(root, 'win32'), join(root, '.venv/Scripts/python.exe'));
});

test('缺少 Python 或版本不符合时只提示退出，不下载运行时', async t => {
  const root = await fixture(t);
  assert.throws(() => checkPython(root, { candidates: [[join(root, 'missing-python')]] }), /请手动安装/);
  assert.equal(supportedPython({ version: [3, 10] }), false);
  assert.equal(supportedPython({ version: [3, 15] }), false);
  assert.equal(supportedPython({ version: [3, 13] }), true);
  await assert.rejects(import('node:fs/promises').then(fs => fs.access(join(root, '.runtime'))));
});

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function runLauncher(port,lan=false) {
  const child = spawn(process.execPath, ['scripts/bootstrap.mjs', '--no-browser',...(lan?['--lan']:[])], {
    cwd: project, env: { ...process.env, PORT: String(port), MYTV_SKIP_PYTHON: '1', MYTV_SETUP_ONLY: '0' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  return { child, output: () => output, finished: new Promise(resolve => child.once('exit', code => resolve(code))) };
}

test('启动入口遇到缺失 Python 时先退出，不进入项目依赖安装', { timeout: 20_000 }, async t => {
  const root = await fixture(t);
  const child = spawn(process.execPath, ['scripts/bootstrap.mjs', '--setup-only'], {
    cwd: project, env: { ...process.env, MYTV_SKIP_PYTHON: '0', MYTV_BOOTSTRAP_PYTHON: join(root, 'missing-python') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = ''; child.stdout.on('data', x => output += x); child.stderr.on('data', x => output += x);
  assert.equal(await new Promise(resolve => child.once('exit', resolve)), 1);
  assert.match(output, /请手动安装/);
  assert.doesNotMatch(output, /Node 依赖|正在安装|正在下载/);
});

test('缺少 Node 内置 SQLite 时先退出，不安装运行时或项目依赖',async()=>{
  const child=spawn(process.execPath,['--no-experimental-sqlite','scripts/bootstrap.mjs','--setup-only'],{cwd:project,stdio:'pipe'});
  let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  assert.equal(await new Promise(resolve=>child.once('exit',resolve)),1);
  assert.match(output,/缺少内置 SQLite.*手动安装/);assert.doesNotMatch(output,/Node 依赖|正在.*安装|正在.*下载/);
});

test('重复启动仍保留控制窗口，输入 q 可停止服务并释放所有窗口', { timeout: 30_000 }, async t => {
  const port = await freePort();
  const run = runLauncher(port);
  t.after(() => run.child.kill('SIGTERM'));
  for (let i = 0; i < 100 && !run.output().includes('已就绪：'); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.match(run.output(), /已就绪：/);
  const health = await (await fetch('http://127.0.0.1:' + port + '/api/health')).json();
  assert.equal(health.app, 'my-tv');
  // Fetch the browser module graph too: an omitted static-route entry leaves
  // the whole UI uninitialized even when API and syntax checks pass.
  const pending=['/app.js'],seen=new Set();
  while(pending.length){const path=pending.shift();if(seen.has(path))continue;seen.add(path);assert.ok(seen.size<30);
    const response=await fetch('http://127.0.0.1:'+port+path);assert.equal(response.status,200,path);
    const code=await response.text();for(const match of code.matchAll(/from\s+['"](\.[^'"]+)['"]/g))pending.push(new URL(match[1],'http://127.0.0.1:'+port+path).pathname);
  }
  const again = runLauncher(port);
  t.after(() => again.child.kill('SIGTERM'));
  for (let i = 0; i < 100 && !again.output().includes('此窗口可控制服务'); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.match(again.output(), /已连接到已有服务/);
  assert.equal(again.child.exitCode, null);
  again.child.stdin.write('q\n');
  assert.equal(await again.finished, 0);
  assert.equal(await run.finished, 0);
  await assert.rejects(fetch('http://127.0.0.1:' + port + '/api/health'));
});

test('独立停止脚本无需 Python 或项目依赖，校验凭证并关闭服务', { timeout: 30_000 }, async t => {
  const port = await freePort();
  const run = runLauncher(port); t.after(() => run.child.kill('SIGTERM'));
  for (let i = 0; i < 100 && !run.output().includes('此窗口可控制服务'); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.match(run.output(), /此窗口可控制服务/);
  const denied = await fetch('http://127.0.0.1:' + port + '/api/shutdown', { method: 'POST', headers: { 'x-mytv-control': '0'.repeat(64) } });
  assert.equal(denied.status, 403);
  const stop = spawn(process.execPath, ['scripts/control.mjs'], { cwd: project,
    env: { ...process.env, PORT: String(port), MYTV_BOOTSTRAP_PYTHON: 'not-installed' }, stdio: 'pipe' });
  assert.equal(await new Promise(resolve => stop.once('exit', resolve)), 0);
  assert.equal(await run.finished, 0);
  await assert.rejects(fetch('http://127.0.0.1:' + port + '/api/health'));
});

test('Ctrl+C 与终端关闭信号能停止前台服务', { timeout: 30_000, skip: process.platform === 'win32' }, async t => {
  for (const signal of ['SIGINT', 'SIGHUP']) {
    const port = await freePort(); const run = runLauncher(port);
    t.after(async () => {await stopServer(project,port).catch(()=>{});run.child.kill('SIGTERM');});
    for (let i = 0; i < 100 && !run.output().includes('此窗口可控制服务'); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(run.output(), /此窗口可控制服务/);
    run.child.kill(signal);
    assert.equal(await run.finished, 0, JSON.stringify({signal,exitSignal:run.child.signalCode,output:run.output()}));
    await assert.rejects(fetch('http://127.0.0.1:' + port + '/api/health'));
  }
});

test('普通端口占用与伪装的健康响应不会被误认为可用服务', { timeout: 30_000 }, async t => {
  const server = http.createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true,"version":"0.2.0","app":"other"}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const run = runLauncher(server.address().port);
  assert.equal(await run.finished, 1);
  assert.match(run.output(), /被其他程序或旧版服务占用/);
});

test('局域网模式共享历史、拒绝错误 Host/Origin，模式不一致不切换服务', {timeout:30_000}, async t=>{
  const port=await freePort(),run=runLauncher(port,true);t.after(()=>run.child.kill('SIGTERM'));
  for(let i=0;i<100&&!run.output().includes('此窗口可控制服务');i++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.match(run.output(),/局域网访问/);
  const health=await(await fetch('http://127.0.0.1:'+port+'/api/health')).json();assert.equal(health.mode,'lan');
  const local=await(await fetch('http://127.0.0.1:'+port+'/api/history')).json();
  const {serverAddresses}=await import('../lib/network-mode.mjs');const url=serverAddresses(port,true).urls[0];
  if(url){const shared=await(await fetch(url+'/api/history')).json();assert.deepEqual(shared,local);}
  const denied=await new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port,path:'/api/history',headers:{host:'evil.example:'+port}},response=>{response.resume();resolve(response.statusCode);});req.on('error',reject);});assert.equal(denied,403);
  const cross=await fetch('http://127.0.0.1:'+port+'/api/history',{headers:{origin:'https://evil.example'}});assert.equal(cross.status,403);
  const mismatch=runLauncher(port);assert.equal(await mismatch.finished,1);assert.match(mismatch.output(),/模式.*先用停止脚本/);
  run.child.stdin.write('q\n');assert.equal(await run.finished,0);
});
