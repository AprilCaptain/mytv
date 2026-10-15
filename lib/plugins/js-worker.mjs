import { parentPort } from 'node:worker_threads';
import { JavascriptSpider } from './javascript.mjs';
import { MAX_PLUGIN_FRAME } from './limits.mjs';

let spider, sequence=0;
const pending=new Map();
function rpc(operation,args) {
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    pending.set(id,{resolve,reject});
    parentPort.postMessage({type:'request',id,operation,args});
  });
}
const broker={script:(...args)=>rpc('script',args.slice(0,1)),request:(...args)=>rpc('request',args.slice(0,2))};
parentPort.on('message',async message=>{
  if(message.type==='reply') {
    const item=pending.get(message.id);if(!item)return;pending.delete(message.id);
    message.error?item.reject(new Error(message.error)):item.resolve(message.result);return;
  }
  try {
    if(message.method==='__init') {
      spider=await JavascriptSpider.create(message.source,broker,message.proxy,AbortSignal.timeout(30_000));
      parentPort.postMessage({type:'result',result:{ready:true}});
    } else {
      const result=await spider.call(message.method,message.args,AbortSignal.timeout(25_000));
      if(Buffer.byteLength(JSON.stringify(result)??'null')>MAX_PLUGIN_FRAME)throw new Error('插件响应超过大小限制。');
      parentPort.postMessage({type:'result',result});
    }
  } catch(error) {parentPort.postMessage({type:'result',error:error.message||'JS 插件执行失败'});}
});
