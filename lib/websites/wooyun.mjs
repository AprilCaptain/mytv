import {HttpError} from '../util.mjs';
import {name,text,absolute,directMedia,vodLines} from './common.mjs';
const classes=[['movie','电影'],['tv_series','电视剧'],['animation','动漫'],['variety','综艺'],['short_drama','短剧']].map(([type_id,type_name])=>({type_id,type_name}));
const numeric=value=>/^\d{1,16}$/.test(String(value));
const seasonsPath=id=>'/movie/media/video/list?'+new URLSearchParams({mediaId:id,lineName:'',resolutionCode:''});
async function api(ctx,path,signal,body){
 let json;try{json=JSON.parse(await ctx.read(path,signal,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,headers:{accept:'application/json','content-type':'application/json',origin:ctx.base}}));}catch(e){if(e instanceof SyntaxError)throw new HttpError(502,'网站影片信息暂时无法读取。');throw e;}
 if(json.isSuccess===false||json.code!==200||json.data==null)throw new HttpError(502,'网站暂时无法提供影片信息。');return json.data;
}
function groups(data){return (Array.isArray(data)?data:[]).slice(0,100).filter(s=>Number.isInteger(s.seasonNo)&&s.seasonNo>=0&&s.seasonNo<=999&&Array.isArray(s.videoList));}
function card(v,base,season){
 const split=season!==undefined;
 const title=split?name(v.title).replace(/\s*第[零一二三四五六七八九十\d]+季\s*$/,'').trim():name(v.title);
 return {vod_id:String(v.id)+(split?'~'+season:''),vod_name:title+(split?' 第'+season+'季':''),vod_pic:absolute(v.posterUrlS3||v.posterUrl||v.thumbUrlS3||v.thumbUrl,base),vod_year:split?'':String(v.releaseYear||''),type_name:name(v.mediaType?.name),vod_remarks:name(v.episodeStatus||v.remark)};
}
async function listing(ctx,page,query,category,signal){
 const data=await api(ctx,'/movie/media/search',signal,{menuCodeList:[],pageIndex:String(page),pageSize:24,searchKey:query,sortCode:query?'':'latest',topCode:category});
 const records=(Array.isArray(data.records)?data.records:[]).slice(0,24).filter(v=>numeric(v.id)),out=Array(records.length);let next=0;
 // Only multi-season records need an extra request. Read actual season numbers;
 // never infer them from a count or synthesize missing seasons.
 await Promise.all(Array.from({length:Math.min(3,records.length)},async()=>{while(next<records.length){const i=next++,v=records[i];
  if(Number(v.seasonCount)>1){const data=groups(await api(ctx,seasonsPath(String(v.id)),signal)),numbers=[...new Set(data.filter(s=>s.videoList.length).map(s=>s.seasonNo))];out[i]=numbers.length>1&&!/电影/.test(v.mediaType?.name)?numbers.map(n=>card(v,ctx.base,n)):[card(v,ctx.base)];}
  else out[i]=[card(v,ctx.base)];
 }}));
 return {list:out.flat().slice(0,200),page,pagecount:Math.max(page,Math.min(10000,Number(data.pages)||page)),total:0};
}
function parseId(raw){const m=String(raw).match(/^(\d{1,16})(?:~(\d{1,3}))?$/);if(!m)throw new HttpError(400,'影片标识无效。');return {id:m[1],season:m[2]===undefined?undefined:Number(m[2])};}
export const wooyun={
 async categories(){return {class:classes};},
 async home(ctx,_args,signal){return listing(ctx,1,'','',signal);},
 async category(ctx,[category,page],signal){if(!classes.some(c=>c.type_id===category))throw new HttpError(400,'请选择有效分类。');return listing(ctx,Math.min(10000,Math.max(1,Number(page)||1)),'',category,signal);},
 async search(ctx,[q,_quick,page],signal){return listing(ctx,Math.min(10000,Math.max(1,Number(page)||1)),String(q).slice(0,200),'',signal);},
 async detail(ctx,[ids],signal){const {id,season}=parseId(Array.isArray(ids)?ids[0]:ids),[v,data]=await Promise.all([api(ctx,'/movie/media/detail?'+new URLSearchParams({mediaId:id}),signal),api(ctx,seasonsPath(id),signal)]);
  const all=groups(data),numbers=[...new Set(all.filter(s=>s.videoList.length).map(s=>s.seasonNo))];
  if(season===undefined&&numbers.length>1)throw new HttpError(422,'这部剧包含多季，请重新搜索并选择具体季数。');
  const selected=season??numbers[0],meta=card(v,ctx.base,season),seen=new Set(),numbered=new Map();
  for(const s of all.filter(s=>s.seasonNo===selected))for(const ep of s.videoList.slice(0,3000)){
   if(!numeric(ep.id)||seen.has(String(ep.id)))continue;seen.add(String(ep.id));
   const movie=/电影|片/.test(meta.type_name)&&!/动漫|动画/.test(meta.type_name);
   const label=movie?name(ep.remark)||'正片':Number.isInteger(ep.epNo)&&ep.epNo>0?'第'+String(ep.epNo).padStart(2,'0')+'集':name(ep.remark);
   if(!label)continue;
   // The API interleaves different upstreams for each episode and changes CDN
   // hosts between episodes. Transpose actual candidates into automatic and
   // backup lines; hostnames cannot reliably identify a whole season's line.
   try{directMedia(ep.playUrl,ctx.base);}catch{continue;}
   const key=movie?String(ep.id):label;
   if(!numbered.has(key))numbered.set(key,[]);numbered.get(key).push({name:label,url:'wooyun:'+id+':'+selected+':'+ep.id});
  }
  const lines=[];for(let i=0;i<Math.min(6,Math.max(0,...[...numbered.values()].map(v=>v.length)));i++){const episodes=[...numbered.values()].flatMap(v=>v[i]?[v[i]]:[]);if(episodes.length)lines.push({key:'season:'+selected+':auto:'+i,name:i?'备用线路'+i:'自动线路',episodes});}
  if(!lines.length)throw new HttpError(422,'这一季暂时没有可播放的选集。');
  return {list:[{...meta,vod_id:String(Array.isArray(ids)?ids[0]:ids),vod_content:text(v.overview||v.description),vod_actor:text((Array.isArray(v.actors)?v.actors:[]).join('、')),vod_director:text((Array.isArray(v.directors)?v.directors:[]).join('、')),vod_area:name(v.region),...vodLines(lines)}]};
 },
 async play(ctx,[_flag,raw],signal){const m=String(raw).match(/^wooyun:(\d{1,16}):(\d{1,3}):(\d{1,16})$/);if(!m)throw new HttpError(400,'播放入口无效。');
  const all=groups(await api(ctx,seasonsPath(m[1]),signal)),ep=all.filter(s=>s.seasonNo===Number(m[2])).flatMap(s=>s.videoList).find(v=>String(v.id)===m[3]);
  if(!ep?.playUrl)throw new HttpError(422,'原选集暂时不可用，请选择其他片源。');
  return {url:directMedia(ep.playUrl,ctx.base),header:ctx.mediaHeaders('/')};
 }
};
