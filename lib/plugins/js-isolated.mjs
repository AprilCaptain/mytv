import { Worker } from 'node:worker_threads';
import { HttpError } from '../util.mjs';

export class IsolatedJavascriptSpider {
  constructor(source,broker) {this.source=source;this.broker=broker;this.worker=null;this.pending=null;this.signal=null;}
  static async create(source,broker,proxy,signal) {
    const instance=new IsolatedJavascriptSpider(source,broker);
    instance.worker=new Worker(new URL('./js-worker.mjs',import.meta.url),{
      execArgv:[],resourceLimits:{maxOldGenerationSizeMb:128},stdout:true,stderr:true
    });
    instance.worker.stdout.on('data',()=>{});instance.worker.stderr.on('data',()=>{});
    instance.worker.on('message',message=>instance.message(message));
    instance.worker.on('error',()=>instance.reject(new HttpError(502,'JS 插件运行环境发生错误，请换源或重试。')));
    instance.worker.on('exit',()=>{instance.worker=null;instance.reject(new HttpError(502,'JS 插件运行环境已退出，请重试。'));});
    try {await instance.run({method:'__init',source,proxy},signal);return instance;}
    catch(error){instance.close();throw error;}
  }
  reject(error){if(this.pending){this.pending.reject(error);this.pending=null;}}
  async message(message) {
    if(message.type==='request') {
      try {
        const result=message.operation==='script'?await this.broker.script(message.args[0],this.signal):
          await this.broker.request(message.args[0],message.args[1],this.signal);
        this.worker?.postMessage({type:'reply',id:message.id,result});
      } catch(error) {this.worker?.postMessage({type:'reply',id:message.id,error:error.message||'插件请求失败'});}
    } else if(message.type==='result') {
      const pending=this.pending;if(!pending)return;this.pending=null;
      message.error?pending.reject(new HttpError(502,message.error)):pending.resolve(message.result);
    }
  }
  run(message,signal) {
    return new Promise((resolve,reject)=>{
      if(!this.worker)return reject(new HttpError(502,'JS 插件运行环境已释放。'));
      if(signal?.aborted)return reject(signal.reason);
      this.signal=signal;
      const done=callback=>value=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);callback(value);};
      const cancel=()=>{this.close();done(reject)(signal.reason);};
      const timer=setTimeout(()=>{this.close();done(reject)(new HttpError(504,'JS 插件运行超时。'));},30_000);
      this.pending={resolve:done(resolve),reject:done(reject)};
      signal?.addEventListener('abort',cancel,{once:true});this.worker.postMessage(message);
    });
  }
  call(method,args,signal) {return this.run({method,args},signal);}
  close() {this.worker?.terminate();this.worker=null;this.reject(new HttpError(499,'JS 插件请求已取消。'));}
}
