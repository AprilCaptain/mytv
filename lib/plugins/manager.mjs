import { randomBytes } from 'node:crypto';
import { PluginBroker } from './broker.mjs';
import { IsolatedJavascriptSpider } from './js-isolated.mjs';
import { PythonSpider, pythonAvailable } from './python.mjs';
import { HttpError } from '../util.mjs';

export class PluginManager {
  constructor(fetcher, origin) {
    this.broker = new PluginBroker(fetcher); this.origin = origin;
    this.engines = new Map(); this.sources = new Map(); this.loading = new Map(); this.queues = new Map();
    this.proxyToken = randomBytes(20).toString('hex');
    this.closed = false;
    this.cleanup = setInterval(() => {
      for (const [id, entry] of this.engines)
        if (!entry.busy && Date.now() - entry.used > 120_000) { entry.spider.close(); this.engines.delete(id); }
    }, 30_000).unref();
  }
  capability(kind) {
    if(process.env.MYTV_DISABLE_PLUGINS==='1')return false;
    return kind === 'js' || (kind === 'python' && pythonAvailable());
  }
  proxyUrl(id) { return this.origin + '/api/plugin-proxy/' + id + '?token=' + this.proxyToken; }
  async engine(source, signal) {
    if(!this.capability(source.kind))throw new HttpError(403,'脚本片源未启用或隔离环境不可用。');
    if(this.closed)throw new HttpError(499,'插件运行环境已关闭。');
    this.sources.set(source.id, source);
    if (this.engines.has(source.id)) return this.engines.get(source.id);
    if (this.loading.has(source.id)) return this.loading.get(source.id);
    // Only keep a few active interpreters. Config import does not launch plugins.
    while (this.engines.size + this.loading.size >= 4) {
      if(this.closed)throw new HttpError(499,'插件运行环境已关闭。');
      signal?.throwIfAborted();
      const idle = [...this.engines].filter(([, entry]) => !entry.busy).sort((a,b) => a[1].used - b[1].used)[0];
      if (idle) { idle[1].spider.close(); this.engines.delete(idle[0]); }
      else await new Promise(resolve => setTimeout(resolve, 100));
    }
    const promise = (async () => {
      const type = source.kind === 'js' ? IsolatedJavascriptSpider : PythonSpider;
      const spider = await type.create(source, this.broker, this.proxyUrl(source.id), signal);
      if(this.closed){spider.close();throw new HttpError(499,'插件运行环境已关闭。');}
      const entry = { spider, busy: 0, used: Date.now() }; this.engines.set(source.id, entry); return entry;
    })();
    this.loading.set(source.id, promise);
    try { return await promise; } finally { this.loading.delete(source.id); }
  }
  call(source, method, args, signal) {
    const task = async () => {
      signal?.throwIfAborted();
      const entry = await this.engine(source, signal);
      entry.busy++; entry.used = Date.now();
      try { return await entry.spider.call(method, args, signal); }
      catch(error) {
        if(source.kind==='js'&&!entry.spider.worker || source.kind==='python'&&!entry.spider.child)
          this.engines.delete(source.id);
        throw error;
      }
      finally {
        entry.busy--; entry.used = Date.now();
        if (signal?.aborted) { entry.spider.close(); this.engines.delete(source.id); }
      }
    };
    const promise = (this.queues.get(source.id) || Promise.resolve()).then(task, task);
    this.queues.set(source.id, promise.catch(() => {}));
    return promise;
  }
  async fetchProxy(raw, options = {}) {
    const url = new URL(raw);
    if (url.origin !== this.origin || !url.pathname.startsWith('/api/plugin-proxy/')) return null;
    if (url.searchParams.get('token') !== this.proxyToken) throw new HttpError(403, '插件代理地址无效。');
    const id = url.pathname.slice('/api/plugin-proxy/'.length);
    const source = this.sources.get(id);
    if (!source) throw new HttpError(404, '插件代理已释放。');
    const params = Object.fromEntries(url.searchParams); delete params.token;
    params.__headers = options.headers || {};
    const result = await this.call(source, source.kind === 'js' ? 'proxy' : 'localProxy', [params], options.signal);
    if (!Array.isArray(result) || result.length < 3) throw new HttpError(502, '插件没有返回有效的代理内容。');
    let body = result[2];
    if (body?.__bytes) body = Buffer.from(body.__bytes, 'base64');
    if (Array.isArray(body)) body = Uint8Array.from(body);
    const response = new Response(body, { status: Number(result[0]) || 200, headers: {
      ...(typeof result[3] === 'object' ? result[3] : {}), 'content-type': result[1] || 'application/octet-stream'
    } });
    Object.defineProperty(response, 'url', { value: raw }); return response;
  }
  close() { this.closed=true;clearInterval(this.cleanup); for (const entry of this.engines.values()) entry.spider.close(); this.engines.clear(); }
}
