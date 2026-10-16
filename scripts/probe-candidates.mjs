// Opt-in source research. A local candidate file is never imported into menus.
// Prints public source identities and results, never temporary media URLs.
import {readFile,writeFile} from 'node:fs/promises';
import {Providers} from '../lib/providers.mjs';
import {remoteFetch,crossOriginHeaders} from '../lib/network.mjs';
import {readText} from '../lib/util.mjs';
import {normalizedTitle} from '../lib/matching.mjs';
const [file,output,...queries]=process.argv.slice(2);
if(!file||!output){console.error('用法：node scripts/probe-candidates.mjs 候选.json 结果.json [影片名称…]');process.exit(1);}
const config=JSON.parse(await readFile(file,'utf8'));
if(!Array.isArray(config.sites)||config.sites.length>100)throw new Error('候选文件需要 sites 数组，最多 100 项。');
const configUrl='https://mytv-research.example/candidates.json';
const providers=new Providers((url,options)=>url===configUrl?Promise.resolve(Response.json(config)):remoteFetch(url,options));
const samples=queries.length?queries:['庆余年第二季','流浪地球2','仙逆'];
async function media(raw,headers,signal){
 const root=new URL(raw).origin;let url=raw;
 for(let i=0;i<4;i++){
  const h=new URL(url).origin===root?headers:crossOriginHeaders(headers);
  if(/\.(?:mp4|webm|m4v)(?:$|[?#])/i.test(url)){
   const r=await remoteFetch(url,{headers:{...h,range:'bytes=0-16383'},signal}),reader=r.body?.getReader();
   try{if(!r.ok||!reader)throw new Error('媒体 HTTP '+r.status);const chunk=await reader.read();if(!chunk.value?.length||/text\/|json/i.test(r.headers.get('content-type')||''))throw new Error('媒体响应无效');return {format:'mp4',status:r.status,bytes:chunk.value.length};}finally{await reader?.cancel().catch(()=>{});}
  }
  const r=await remoteFetch(url,{headers:h,signal});if(!r.ok){await r.body?.cancel();throw new Error('播放列表 HTTP '+r.status);}
  const body=await readText(r,2*1024*1024);if(!body.trimStart().startsWith('#EXTM3U'))throw new Error('不是 HLS 播放列表');
  const lines=body.split(/\r?\n/).map(s=>s.trim()),base=r.url||url;
  const variants=lines.flatMap((l,i)=>l.startsWith('#EXT-X-STREAM-INF:')&&lines[i+1]&&!lines[i+1].startsWith('#')?[{url:lines[i+1],height:Number(l.match(/RESOLUTION=\d+x(\d+)/)?.[1])||0}]:[]);
  if(variants.length){url=new URL(variants.sort((a,b)=>b.height-a.height)[0].url,base).href;continue;}
  const first=lines.find(l=>l&&!l.startsWith('#'));if(!first)throw new Error('没有媒体分片');
  const segment=new URL(first,base),s=await remoteFetch(segment.href,{headers:{...(segment.origin===root?headers:crossOriginHeaders(headers)),range:'bytes=0-16383'},signal}),reader=s.body?.getReader();
  try{if(!s.ok||!reader)throw new Error('分片 HTTP '+s.status);const chunk=await reader.read();if(!chunk.value?.length||/text\/|json|javascript|svg/i.test(s.headers.get('content-type')||''))throw new Error('分片不是媒体数据');return {format:'hls',status:s.status,bytes:chunk.value.length,mediaOrigin:segment.origin};}finally{await reader?.cancel().catch(()=>{});}
 }
 throw new Error('播放列表嵌套过深');
}
const results=[];let next=0,saving=Promise.resolve();
try{
 const c=await providers.importConfig(configUrl);
 await Promise.all(Array.from({length:4},async()=>{while(next<c.sources.length){const s=c.sources[next++],signal=AbortSignal.timeout(75_000),r={key:s.key,name:s.name,api:s.api,checkedAt:new Date().toISOString(),samples:[]};
  try{
   const categories=await providers.getCategories(s.id,AbortSignal.any([signal,AbortSignal.timeout(12_000)]));r.categories=categories.length;if(!categories.length)throw new Error('没有分类');
   const home=await providers.catalog(s.id,{},AbortSignal.any([signal,AbortSignal.timeout(12_000)]));r.home=home.list.length;if(!home.list.length)throw new Error('没有首页影片');
   const search=await Promise.allSettled(samples.map(q=>providers.catalog(s.id,{q},AbortSignal.any([signal,AbortSignal.timeout(12_000)]))));
   const matches=search.flatMap((v,i)=>{const list=v.status==='fulfilled'?v.value.list:[],match=list.find(v=>normalizedTitle(v.title)===normalizedTitle(samples[i]));return match?[{q:samples[i],video:match}]:[];});
   r.searches=search.map((v,i)=>({query:samples[i],ok:v.status==='fulfilled',matched:v.status==='fulfilled'?v.value.list.filter(x=>normalizedTitle(x.title).includes(normalizedTitle(samples[i]))).length:0}));
   if(!search.some(v=>v.status==='fulfilled'))throw new Error('搜索接口不可用');
   const ordinary=v=>!/伦理|成人|写真|情色/.test(v.type);
   const picks=matches.length?matches.filter(x=>ordinary(x.video)).slice(0,2):home.list.filter(ordinary).slice(0,1).map(video=>({q:'首页抽样',video}));
   for(const pick of picks){const sample={query:pick.q,title:pick.video.title,videoId:pick.video.id};
    try{const detail=await providers.detail(s.id,pick.video.id,AbortSignal.any([signal,AbortSignal.timeout(12_000)]));Object.assign(sample,{year:detail.year,type:detail.type,lines:detail.lines.length});let error;
     for(let i=0;i<Math.min(3,detail.lines.length);i++){try{const combined=AbortSignal.any([signal,AbortSignal.timeout(15_000)]),resolved=await providers.resolve(s.id,detail.id,i,0,combined);Object.assign(sample,await media(resolved.url,resolved.headers,combined),{line:detail.lines[i].name,episodes:detail.lines[i].episodes.length,ok:true});break;}catch(e){error=e;}}
     if(!sample.ok)throw error||new Error('没有播放线路');
    }catch(e){sample.ok=false;sample.error=e.message;}
    r.samples.push(sample);
   }
   r.ok=r.samples.some(s=>s.ok);if(!r.ok)r.error='媒体抽样未通过';
  }catch(e){r.ok=false;r.error=e.message;}
  results.push(r);console.log(JSON.stringify(r));const snapshot=JSON.stringify(results,null,2)+'\n';saving=saving.then(()=>writeFile(output,snapshot));await saving;
 }}));
}finally{providers.close();}
