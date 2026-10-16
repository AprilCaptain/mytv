import {createHash} from 'node:crypto';
import {HttpError} from '../util.mjs';
import {normalizedTitle} from '../matching.mjs';
import {text,name,absolute,vodLines,directMedia,episodeName} from './common.mjs';
const prefix='/api/mw-movie/anonymous/';
const ua='Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36';
const classes=[{type_id:'1',type_name:'电影'},{type_id:'2',type_name:'电视剧'},{type_id:'4',type_name:'动漫'},{type_id:'3',type_name:'综艺'},{type_id:'88',type_name:'短剧'}];
const id=value=>{const s=String(value??'');if(!/^\d{1,16}$/.test(s))throw new HttpError(400,'影片或集数标识无效。');return s;};
// The public website client uses this non-secret request-format key for its
// anonymous APIs. No user credentials or login-only playback are used.
export function guestHeaders(params,t=String(Date.now())){
 const raw=Object.entries({...params,key:'cb808529bae6b6be45ecfab29a4889bc',t}).filter(([,v])=>v!==''&&v!=null).map(([k,v])=>k+'='+v).join('&');
 return {'user-agent':ua,t,sign:createHash('sha1').update(createHash('md5').update(raw).digest('hex')).digest('hex')};
}
async function api(ctx,path,params,signal){
 const query=new URLSearchParams(Object.entries(params).filter(([,v])=>v!==''&&v!=null));
 let result;try{result=JSON.parse(await ctx.read(prefix+path+(query.size?'?'+query:''),signal,{headers:guestHeaders(params)}));}catch(error){if(error instanceof SyntaxError)throw new HttpError(502,'网站影片信息暂时无法读取。');throw error;}
 if(result.code!==200||!result.data)throw new HttpError(502,'网站暂时无法提供影片信息，请稍后重试。');
 return result.data;
}
function mapVod(v,base){
 const category=classes.find(c=>c.type_id===String(v.typeId1));
 return {vod_id:id(v.vodId),vod_name:name(v.vodName),vod_pic:absolute(v.vodPic,base),vod_year:name(v.vodYear||v.vodPubdate).match(/(?:19|20)\d{2}/)?.[0]||'',type_name:category?.type_name||name(v.typeName),vod_remarks:name(v.vodRemarks)};
}
function catalog(data,ctx,page,q=''){
 let list=(Array.isArray(data.list)?data.list:[]).slice(0,100).filter(v=>classes.some(c=>c.type_id===String(v.typeId1))).map(v=>mapVod(v,ctx.base));
 if(q)list=list.filter(v=>normalizedTitle(v.vod_name).includes(normalizedTitle(q)));
 return {list,page,pagecount:Math.min(10000,Math.max(page,Number(data.totalPage)||page)),total:0};
}
export function guestMedia(list){
 // The endpoint also lists resolutions explicitly reserved for signed-in
 // viewers. Even if it includes a URL, never select those entries.
 const candidates=(Array.isArray(list)?list:[]).filter(v=>v.flag===true&&v.needLogin===false&&typeof v.url==='string');
 candidates.sort((a,b)=>(Number(b.resolution)||0)-(Number(a.resolution)||0));
 if(!candidates.length)throw new HttpError(422,'这条线路需要登录，暂时无法播放，请选择其他片源。');
 return candidates[0];
}
export const jinpai={
 async categories(){return {class:classes};},
 async home(ctx,_args,signal){const data=await api(ctx,'home/hotSearch',{},signal);return catalog({list:Array.isArray(data)?data:[],totalPage:1},ctx,1);},
 async category(ctx,[category,page],signal){if(!classes.some(c=>c.type_id===category))throw new HttpError(400,'请选择有效分类。');const n=Math.min(10000,Math.max(1,Number(page)||1));
  return catalog(await api(ctx,'video/list',{area:'',lang:'',pageNum:String(n),pageSize:'30',sort:'1',sortBy:'1',type:'',type1:category,v_class:'',year:''},signal),ctx,n);},
 async search(ctx,[query,_quick,page],signal){const n=Math.min(10000,Math.max(1,Number(page)||1));return catalog(await api(ctx,'video/searchByWordPageable',{keyword:String(query).slice(0,200),pageNum:String(n),pageSize:'30'},signal),ctx,n,query);},
 async detail(ctx,[ids],signal){const video=id(Array.isArray(ids)?ids[0]:ids),v=await api(ctx,'video/detail',{id:video},signal),meta=mapVod(v,ctx.base);
  const episodes=(Array.isArray(v.episodeList)?v.episodeList:[]).slice(0,3000).map(ep=>({name:episodeName(ep.name,meta.type_name),url:'guest:'+video+':'+id(ep.nid)}));
  if(!episodes.length)throw new HttpError(422,'这部影片暂时没有可播放的选集。');
  return {list:[{...meta,vod_actor:text(v.vodActor),vod_director:text(v.vodDirector),vod_area:name(v.vodArea),vod_content:text(v.vodContent),...vodLines([{key:'guest',name:'访客线路',episodes}])}]};},
 async play(ctx,[_flag,raw],signal){const m=String(raw).match(/^guest:(\d{1,16}):(\d{1,16})$/);if(!m)throw new HttpError(400,'播放入口无效。');
  const data=await api(ctx,'v2/video/episode/url',{clientType:'3',id:m[1],nid:m[2]},signal),entry=guestMedia(data.list);
  return {url:directMedia(entry.url,ctx.base),header:{'user-agent':ua,referer:ctx.base+'/'}};}
};
