import { newAsyncContext } from 'quickjs-emscripten';
import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { HttpError, webUrl } from '../util.mjs';

function htmlQuery(html, expression, many = false) {
  if (String(html).length > 2 * 1024 * 1024 || String(expression).length > 2000)
    throw new Error('HTML 解析内容过大');
  const $ = load(String(html));
  const parts = String(expression || '').split('&&').filter(Boolean);
  const attribute = many ? null : parts.pop();
  let nodes = $.root();
  for (const part of parts) {
    const [selector, ...exclusions] = part.split('--');
    nodes = nodes.find(selector || '*');
    for (const exclusion of exclusions) nodes.find(exclusion).remove();
  }
  if (many) return nodes.toArray().map(node => $.html(node));
  const node = nodes.first();
  if (/^Text$/i.test(attribute)) return node.text().trim();
  if (/^Html$/i.test(attribute)) return node.html() || '';
  if (!attribute) return node.text().trim();
  return node.attr(attribute) || '';
}

const BOOTSTRAP = [
  'globalThis.console={log(){},warn(){},error(){}}; globalThis.print=()=>{}; globalThis.log=()=>{};',
  'globalThis.__asyncMode=false;',
  'globalThis.req=(url,options)=>__asyncMode?__requestAsync(String(url),JSON.stringify(options||{})).then(JSON.parse):JSON.parse(__request(String(url),JSON.stringify(options||{})));',
  'globalThis._http=req;',
  'globalThis.pdfh=(html,expr)=>JSON.parse(__html(String(html),String(expr),false));',
  'globalThis.pdfa=(html,expr)=>JSON.parse(__html(String(html),String(expr),true));',
  'globalThis.pd=(html,expr,base)=>{let v=pdfh(html,expr);return v?__join(String(base||""),v):""};',
  'globalThis.joinUrl=(base,child)=>__join(String(base),String(child));',
  'globalThis.base64Encode=s=>__base64(String(s),true); globalThis.base64Decode=s=>__base64(String(s),false);',
  'globalThis.md5=s=>__md5(String(s)); globalThis.md5X=md5;',
  'globalThis.local={values:new Map(),get(ns,k){return this.values.get(ns+"::"+k)||""},set(ns,k,v){if(this.values.size>200)this.values.delete(this.values.keys().next().value);this.values.set(ns+"::"+k,String(v))},delete(ns,k){this.values.delete(ns+"::"+k)}};',
  'globalThis.getProxy=()=>__proxy; globalThis.getPort=()=>Number(__port);',
  'globalThis.TextEncoder=class{encode(s){return new Uint8Array(JSON.parse(__encode(String(s))))}};',
  'globalThis.TextDecoder=class{constructor(enc){this.enc=enc||"utf-8"}decode(a){return __decode(JSON.stringify(Array.from(a||[])),this.enc)}};',
  'globalThis.atob=s=>__base64(String(s),false); globalThis.btoa=s=>__base64(String(s),true);',
  'globalThis.s2t=s=>s;globalThis.t2s=s=>s;'
].join('\n');

export class JavascriptSpider {
  constructor(source, broker, proxyUrl) {
    this.source = source; this.broker = broker; this.proxyUrl = proxyUrl;
    this.tail = Promise.resolve(); this.vm = null; this.signal = null; this.deadline = 0;
    this.hostTasks = new Set(); this.evaluations = 0; this.closing = false; this.executingJobs = false;
    this.cpuDeadline = 0;
  }
  static async create(source, broker, proxyUrl, signal) {
    const instance = new JavascriptSpider(source, broker, proxyUrl);
    try { await instance.initialize(signal); return instance; }
    catch (error) { instance.close(); throw error; }
  }
  install(name, callback, async = false) {
    const vm = this.vm;
    const handle = async ? vm.newAsyncifiedFunction(name, callback) : vm.newFunction(name, callback);
    vm.setProp(vm.global, name, handle); handle.dispose();
  }
  async evaluate(code, filename = 'host.js', type = 'global') {
    this.evaluations++;
    this.cpuDeadline=Date.now()+2000;
    let handle, state;
    try {
      handle = this.vm.unwrapResult(await this.vm.evalCodeAsync(code, filename, { type }));
      state = this.vm.getPromiseState(handle);
      if(state.type==='pending')this.vm.unwrapResult(this.vm.evalCode('globalThis.__asyncMode=true')).dispose();
      while(state.type==='pending') {
        if(this.closing||this.signal?.aborted||Date.now()>this.deadline)throw new Error('插件请求已取消或超时');
        if(this.hostTasks.size)await Promise.allSettled([...this.hostTasks]);
        this.executingJobs = true;
        this.cpuDeadline=Date.now()+2000;
        try { this.vm.unwrapResult(this.vm.runtime.executePendingJobs()); }
        finally { this.executingJobs = false; }
        state = this.vm.getPromiseState(handle);
        if(state.type==='pending'&&!this.hostTasks.size)await new Promise(resolve=>setTimeout(resolve,5));
      }
      if(state.type==='rejected')throw new Error(this.vm.dump(state.error)?.message||'插件 Promise 执行失败');
      return this.vm.dump(state.notAPromise?handle:state.value);
    } finally {
      if(state&&!state.notAPromise){if(state.value?.alive)state.value.dispose();if(state.error?.alive)state.error.dispose();}
      if(handle?.alive)handle.dispose();
      this.evaluations--;
      if(this.closing&&this.evaluations===0)this.dispose();
    }
  }
  async initialize(signal) {
    this.signal = signal; this.deadline = Date.now() + 30_000;
    this.vm = await newAsyncContext();
    const vm = this.vm;
    vm.runtime.setMemoryLimit(64 * 1024 * 1024);
    vm.runtime.setMaxStackSize(1024 * 1024);
    vm.runtime.setInterruptHandler(() => this.closing || Date.now() > this.cpuDeadline || Date.now() > this.deadline || this.signal?.aborted);
    vm.runtime.setModuleLoader(url => {
      if(this.executingJobs)throw new Error('暂不支持运行时动态模块下载');
      return this.broker.script(url, this.signal).then(code=>{this.cpuDeadline=Date.now()+2000;return code;});
    },
      (base, name) => webUrl(name, base).href);
    this.install('__request', async (url, opts) => {
      const result = await this.broker.request(vm.getString(url), JSON.parse(vm.getString(opts)), this.signal);
      this.cpuDeadline=Date.now()+2000;
      return vm.newString(JSON.stringify(result));
    }, true);
    this.install('__requestAsync', (url, opts) => {
      const deferred=vm.newPromise();
      const task=this.broker.request(vm.getString(url),JSON.parse(vm.getString(opts)),this.signal)
        .then(result=>{
          if(!vm.alive)return;
          this.cpuDeadline=Date.now()+2000;
          const value=vm.newString(JSON.stringify(result));deferred.resolve(value);value.dispose();
        }).catch(error=>{
          if(!vm.alive)return;
          const value=vm.newError({message:error.message||'插件网络请求失败'});deferred.reject(value);value.dispose();
        }).finally(()=>{
          this.hostTasks.delete(task);
          if(deferred.handle.alive)deferred.handle.dispose();
        });
      this.hostTasks.add(task);return deferred.handle;
    });
    this.install('__html', (html, expression, many) =>
      vm.newString(JSON.stringify(htmlQuery(vm.getString(html), vm.getString(expression), vm.dump(many)))));
    this.install('__join', (base, child) => {
      try { return vm.newString(new URL(vm.getString(child), vm.getString(base) || this.source.api).href); }
      catch { return vm.newString(vm.getString(child)); }
    });
    this.install('__base64', (value, encode) => vm.newString(vm.dump(encode) ?
      Buffer.from(vm.getString(value)).toString('base64') : Buffer.from(vm.getString(value), 'base64').toString('utf8')));
    this.install('__md5', value => vm.newString(createHash('md5').update(vm.getString(value)).digest('hex')));
    this.install('__encode', value => vm.newString(JSON.stringify(Array.from(Buffer.from(vm.getString(value))))));
    this.install('__decode', (value, encoding) => vm.newString(
      new TextDecoder(vm.getString(encoding)).decode(Uint8Array.from(JSON.parse(vm.getString(value))))));
    for (const [key, value] of Object.entries({ __proxy: this.proxyUrl, __port: new URL(this.proxyUrl).port })) {
      const handle = vm.newString(value); vm.setProp(vm.global, key, handle); handle.dispose();
    }
    await this.evaluate(BOOTSTRAP);
    await this.evaluate('import * as plugin from ' + JSON.stringify(this.source.api) +
      ';globalThis.__spider=plugin.default||plugin;if(typeof __spider==="function")globalThis.__spider=__spider();',
      this.source.api + '.host', 'module');
    await this.evaluate('globalThis.__asyncMode=__spider.init?.constructor?.name==="AsyncFunction";if(__spider.init)__spider.init(' + JSON.stringify(this.source.ext ?? '') + ');');
  }
  call(method, args, signal) {
    const task = async () => {
      if (!this.vm) throw new HttpError(502, 'JS 插件实例已经释放。');
      signal?.throwIfAborted(); this.signal = signal; this.deadline = Date.now() + 25_000;
      try {
        const value = await this.evaluate('globalThis.__asyncMode=__spider['+JSON.stringify(method)+']?.constructor?.name==="AsyncFunction";if(typeof __spider[' + JSON.stringify(method) +
          ']!=="function")throw new Error("插件未提供 ' + method + ' 方法");__spider[' +
          JSON.stringify(method) + '].apply(__spider,' + JSON.stringify(args) + ');');
        return typeof value === 'string' ? JSON.parse(value) : value;
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new HttpError(502, 'JS 插件执行失败：' + String(error.message || error).slice(0,180));
      }
    };
    const promise = this.tail.then(task, task);
    this.tail = promise.catch(() => {});
    return promise;
  }
  dispose() { if(this.vm){try{this.vm.dispose();}catch{}this.vm=null;} }
  close() { this.closing=true;if(this.evaluations===0)this.dispose(); }
}
