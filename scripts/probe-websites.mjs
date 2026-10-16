// Explicit live samples only; never run during startup or CI.
import {Providers} from '../lib/providers.mjs';
import {WEB_CONFIG_URL} from '../lib/configs.mjs';
import {remoteFetch,crossOriginHeaders} from '../lib/network.mjs';
import {readText} from '../lib/util.mjs';
import {normalizedTitle} from '../lib/matching.mjs';
const p=new Providers(remoteFetch),signal=()=>AbortSignal.timeout(18_000);
const sourceFilter=process.argv.slice(2).find(a=>a.startsWith('--source='))?.slice(9)||'';
const custom=process.argv.slice(2).filter(a=>!a.startsWith('--source='));
const samples={HDmoli:['人生交换','哪吒','冰之城墙第二季'],A123TV:['流浪地球2','藏海传','仙逆'],'金牌影视':['流浪地球2','藏海传','仙逆']};
async function checkMedia(raw,headers){
 let url=raw,origin=new URL(raw).origin,resolutions=[];
 for(let n=0;n<4;n++){
  const requestHeaders=new URL(url).origin===origin?headers:crossOriginHeaders(headers);
  if(/\.mp4(?:$|[?#])/i.test(url)){
   const r=await remoteFetch(url,{method:'HEAD',headers:requestHeaders,signal:signal()});if(!r.ok)throw new Error('媒体 HTTP '+r.status);
   return {format:'mp4',status:r.status,bytes:Number(r.headers.get('content-length'))||null};
  }
  const r=await remoteFetch(url,{headers:requestHeaders,signal:signal()});if(!r.ok){await r.body?.cancel();throw new Error('媒体 HTTP '+r.status);}
  const body=await readText(r,2*1024*1024);if(!body.trimStart().startsWith('#EXTM3U'))throw new Error('没有返回 HLS 播放列表');
  resolutions.push(...[...body.matchAll(/RESOLUTION=(\d+x\d+)/g)].map(m=>m[1]));
  const lines=body.split(/\r?\n/).map(l=>l.trim()),base=r.url||url;
  const variants=lines.flatMap((l,i)=>l.startsWith('#EXT-X-STREAM-INF:')&&lines[i+1]&&!lines[i+1].startsWith('#')?[{url:lines[i+1],height:Number(l.match(/RESOLUTION=\d+x(\d+)/)?.[1])||0}]:[]);
  if(variants.length){url=new URL(variants.sort((a,b)=>b.height-a.height)[0].url,base).href;continue;}
  const first=lines.find(l=>l&&!l.startsWith('#'));if(!first)throw new Error('播放列表没有媒体分片');
  const segment=new URL(first,base).href,s=await remoteFetch(segment,{headers:{...crossOriginHeaders(headers),range:'bytes=0-16383'},signal:signal()}),reader=s.body?.getReader();
  try{if(!s.ok||!reader)throw new Error('媒体分片 HTTP '+s.status);const chunk=await reader.read();if(!chunk.value?.length||/text\/html|application\/json/i.test(s.headers.get('content-type')||''))throw new Error('分片不是媒体数据');return {format:'hls',status:r.status,resolutions:[...new Set(resolutions)],segmentStatus:s.status,sampledBytes:chunk.value.length,segmentType:s.headers.get('content-type')};}
  finally{await reader?.cancel().catch(()=>{});}
 }
 throw new Error('播放列表嵌套过深');
}
try{
 const c=await p.importConfig(WEB_CONFIG_URL),jobs=c.sources.filter(s=>!sourceFilter||s.name===sourceFilter||s.key===sourceFilter).flatMap(s=>(custom.length?custom:samples[s.name]||[]).map(q=>({s,q})));let next=0;
 await Promise.all(Array.from({length:2},async()=>{while(next<jobs.length){const {s,q}=jobs[next++],result={source:s.name,query:q,checkedAt:new Date().toISOString()};
  try{const data=await p.catalog(s.id,{q},signal()),matches=data.list.filter(v=>normalizedTitle(v.title).includes(normalizedTitle(q))),item=matches.find(v=>normalizedTitle(v.title)===normalizedTitle(q))||matches[0];if(!item)throw new Error('未找到样本');
   const d=await p.detail(s.id,item.id,signal());Object.assign(result,{title:d.title,year:d.year,type:d.type,videoId:d.id,lines:d.lines.map(l=>({name:l.name,episodes:l.episodes.length}))});
   let error;for(let line=0;line<Math.min(d.lines.length,3);line++){try{const r=await p.resolve(s.id,d.id,line,0,signal());Object.assign(result,await checkMedia(r.url,r.headers),{line:d.lines[line].name,ok:true});break;}catch(e){error=e;}}
   if(!result.ok)throw error||new Error('没有可验证的线路');
  }catch(e){result.ok=false;result.error=e.message;process.exitCode=1;}console.log(JSON.stringify(result));
 }}));
}finally{p.close();}
