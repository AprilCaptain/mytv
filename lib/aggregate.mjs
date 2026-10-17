import {createHash} from 'node:crypto';

function stable(value,depth=0){
 if(depth>20)throw new Error('source options are too deeply nested');
 if(Array.isArray(value))return value.map(v=>stable(v,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k],depth+1)]));
 return value;
}
export function endpointIdentity(raw,http=false){
 const url=new URL(raw);url.hash='';
 if(http){for(const key of ['ac','wd','ids','t','pg','h'])url.searchParams.delete(key);url.pathname=url.pathname.replace(/\/+$/,'')||'/';}
 url.searchParams.sort();return url.href;
}
export function sourceIdentity(source){
 const http=source.kind==='http';
 return createHash('sha256').update(JSON.stringify(stable({kind:source.kind,type:source.type,api:endpointIdentity(source.api,http),headers:source.headers,
  ...(http?{}:{adapter:source.adapter,ext:source.ext,parsers:source.parsers})}))).digest('hex');
}
export function abortable(promise,signal){
 if(!signal)return promise;
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason);if(signal.aborted){promise.catch(()=>{});abort();return;}
  signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}
