import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';
import { HttpError } from '../util.mjs';
import { boundedLines } from './limits.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runner = fileURLToPath(new URL('./python/runner.py', import.meta.url));
const python = process.env.MYTV_PYTHON || root + '.venv/bin/python';

export function pythonAvailable() {
  return process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec') && existsSync(python);
}

export class PythonSpider {
  constructor(source, broker) {
    this.source = source; this.broker = broker; this.pending = null;
    this.tail = Promise.resolve(); this.child = null; this.signal = null;this.requests=0;this.activeRequests=0;
  }
  static async create(source, broker, proxy, signal) {
    if (!pythonAvailable()) throw new HttpError(502, 'Python 环境尚未准备好，或当前系统不支持插件进程隔离。');
    const instance = new PythonSpider(source, broker);
    const executable = await realpath(python);
    const paths = ['/System', '/usr/lib', '/usr/share', '/private/var/db/dyld', root + '.venv',
      fileURLToPath(new URL('./python/', import.meta.url)), dirname(dirname(executable))];
    // Permit shared libraries, not the entire package-manager prefix or its secrets.
    for(const prefix of ['/opt/homebrew','/usr/local'])for(const dependency of ['openssl@3','gettext','libffi','xz','zstd','sqlite','mpdecimal']) {
      try{paths.push(await realpath(prefix+'/opt/'+dependency+'/lib'));}catch{}
    }
    const ancestors=new Set(['/']);
    for(const path of [...paths,python,executable])for(let parent=dirname(path);parent!=='/';parent=dirname(parent))ancestors.add(parent);
    const profile = '(version 1)(deny default)(allow process-exec (literal '+JSON.stringify(executable)+') (literal '+JSON.stringify(python)+') (literal '+JSON.stringify(dirname(dirname(executable))+'/Resources/Python.app/Contents/MacOS/Python')+'))'+
      '(allow process-info* (target self))(allow sysctl-read)(allow file-read-metadata)(allow file-read-data '+[...ancestors].map(path=>'(literal '+JSON.stringify(path)+')').join(' ')+')(allow file-read* ' +
      paths.map(path => '(subpath ' + JSON.stringify(path) + ')').join(' ') +
      ' (literal "/dev/null")(literal "/dev/urandom")(literal "/dev/random"))' +
      '(allow file-write* (literal "/dev/null"))';
    instance.child = spawn('/usr/bin/sandbox-exec', ['-p', profile, python, '-I', '-B', runner], {
      cwd: fileURLToPath(new URL('./python/', import.meta.url)),
      env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    instance.child.stderr.on('data', () => {});
    instance.child.stdin.on('error', () => {});
    const wire=boundedLines();
    wire.on('error',error=>{instance.reject(error);instance.close();});
    instance.child.stdout.pipe(wire);
    createInterface({ input: wire }).on('line', line => {void instance.message(line).catch(error=>{instance.reject(error);instance.close();});});
    instance.child.on('error', () => instance.reject(new HttpError(502, 'Python 插件进程启动失败。')));
    instance.child.on('exit', () => {instance.child=null;instance.reject(new HttpError(502, 'Python 插件进程已退出。'));});
    try {
      const code = await broker.script(source.api, signal);
      await instance.run({ method: '__init', code, proxy, ext: typeof source.ext === 'string' ?
        source.ext : JSON.stringify(source.ext || {}) }, signal);
      return instance;
    } catch (error) { instance.close(); throw error; }
  }
  reject(error) { if (this.pending) { this.pending.reject(error); this.pending = null; } }
  async message(line) {
    let message;
    try { message = JSON.parse(line); } catch { this.reject(new HttpError(502, 'Python 插件响应格式错误。'));this.close();return; }
    if(!message||typeof message!=='object'||Array.isArray(message)||!['request','result'].includes(message.type)){
      this.reject(new HttpError(502,'Python 插件响应格式错误。'));this.close();return;
    }
    if (!this.pending) return;
    if (message.type === 'request') {
      if(++this.requests>64||this.activeRequests>=4){this.reject(new HttpError(502,'插件请求过于频繁。'));this.close();return;}
      this.activeRequests++;
      const signal=this.signal;
      try {
        const result = await this.broker.request(message.url, message.options, signal);
        if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify({ result }) + '\n');
      } catch (error) {
        if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify({ error: error.message }) + '\n');
      }
      finally{this.activeRequests--;}
    } else if (message.type === 'result') {
      const pending = this.pending; this.pending = null;
      if (message.error) pending.reject(new HttpError(502, 'Python 插件执行失败：' + message.error));
      else pending.resolve(message.result);
    }
  }
  run(command, signal) {
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.killed || this.child.exitCode != null)
        return reject(new HttpError(502, 'Python 插件进程已释放。'));
      if (signal?.aborted) return reject(signal.reason);
      this.requests=0;
      const operation=new AbortController();
      this.signal=signal?AbortSignal.any([signal,operation.signal]):operation.signal;
      const done = callback => value => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);operation.abort();callback(value);
      };
      const abort = () => { this.close(); done(reject)(signal.reason); };
      const timer = setTimeout(() => {
        this.close(); done(reject)(new HttpError(504, 'Python 插件执行超时，请换源。'));
      }, 30_000);
      this.pending = { resolve: done(resolve), reject: done(reject) };
      signal?.addEventListener('abort', abort, { once: true });
      this.child.stdin.write(JSON.stringify(command) + '\n');
    });
  }
  call(method, args, signal) {
    const task = async () => {
      const result = await this.run({ method, args }, signal);
      return typeof result === 'string' ? JSON.parse(result) : result;
    };
    const promise = this.tail.then(task, task); this.tail = promise.catch(() => {}); return promise;
  }
  close() { this.child?.kill('SIGKILL'); this.child = null; this.reject(new HttpError(499, 'Python 插件请求已取消。')); }
}
