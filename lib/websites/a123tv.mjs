import { load } from 'cheerio';
import { HttpError } from '../util.mjs';
import { qualityRank } from '../matching.mjs';
import { text,name,absolute,pageId,vodLines,dataAssignment,directMedia,episodeName } from './common.mjs';
const detailPattern=/^\/v\/[a-zA-Z0-9_-]+\.html$/;
const playPattern=/^\/v\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+z\d+\.html$/;
const categories=[{type_id:'10',type_name:'电影'},{type_id:'11',type_name:'剧集'},{type_id:'13',type_name:'动漫'},{type_id:'12',type_name:'综艺'}];
export function listPage(html,base,page=1){
  const $=load(html),list=[],seen=new Set();
  $('.w4-item').each((_i,e)=>{const a=$(e);let id;try{id=pageId(a.attr('href'),base,detailPattern);}catch{return;}if(seen.has(id))return;seen.add(id);
    const metadata=name(a.find('.i').text());if(/福利|伦理|情色/.test(metadata))return;
    list.push({vod_id:id,vod_name:name(a.find('.t').attr('title')||a.find('.t').text()||a.find('img').attr('alt')),vod_pic:absolute(a.find('img').attr('data-src')||a.find('img').attr('src')||'',base),vod_remarks:name(a.find('.r').first().text()),vod_year:metadata.match(/(?:19|20)\d{2}/)?.[0]||'',type_name:metadata.split('/')[0].trim()});
  });
  let last=page;$('a[href]').each((_i,e)=>{const n=($(e).attr('href')||'').match(/\/p(\d+)\.html$/)?.[1];if(n)last=Math.max(last,Math.min(10000,Number(n)));});
  return {list:list.slice(0,200),page,pagecount:last,total:0};
}
export function episodePage(html,base,type){
  const $=load(html),seen=new Set(),episodes=[];
  $('.w4-episode-list a[href]').each((_i,e)=>{try{const id=pageId($(e).attr('href'),base,playPattern);if(seen.has(id))return;seen.add(id);episodes.push({name:episodeName($(e).attr('title')||$(e).text(),type),url:new URL(id,base).href});}catch{}});
  return episodes.slice(0,3000);
}
async function readDetail(ctx,id,signal){
  const html=await ctx.read(id,signal),$=load(html),pp=dataAssignment(html,'pp');
  const slug=id.match(/^\/v\/([\w-]+)\.html$/)[1];if(pp.no!==slug||!Array.isArray(pp.la))throw new HttpError(502,'网站影片信息不完整。');
  const title=name($('h1').first().text()),meta=$('title').text().split(' - '),type=name(meta[1]||''),description=text($('meta[name="description"]').attr('content'));
  const metadata=new Map();$('.w4-line-item').each((_i,e)=>{const path=$(e).attr('href')||'',key=path.match(/\/([\w-]+)z\d+\.html$/)?.[1];if(key)metadata.set(key,{quality:name($(e).find('.w4-line-cover .i').text()),title:name($(e).attr('title'))});});
  const seen=new Set(),candidates=[];
  for(const entry of pp.la.slice(0,300)){
    if(!Array.isArray(entry)||!/^\w[\w-]{0,80}$/.test(entry[0])||!Number.isInteger(entry[2])||entry[2]<1||entry[2]>3000)continue;
    const signature=typeof entry[4]==='string'&&entry[4]?entry[4]+'|'+entry[2]:entry[0];if(seen.has(signature))continue;seen.add(signature);
    const hint=metadata.get(entry[0])||{},quality=hint.quality?.match(/(?:4k|2160p|1080p|720p)/i)?.[0]||'';
    candidates.push({key:entry[0],name:(hint.title||name(entry[1])||'线路')+(quality?' · '+quality:''),score:qualityRank(quality)});
  }
  const selected=candidates.sort((a,b)=>b.score-a.score).slice(0,6);
  const groups=(await Promise.allSettled(selected.map(async line=>{
    const current=line.key===pp.ld,body=current?html:await ctx.read('/v/'+slug+'/'+line.key+'z0.html',signal);
    const episodes=episodePage(body,ctx.base,type);if(!episodes.length)throw new HttpError(502,'这条线路暂时没有选集。');
    return {key:line.key,name:line.name,episodes};
  }))).flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
  signal?.throwIfAborted();if(!title||!groups.length)throw new HttpError(502,'网站暂时没有可播放的线路。');
  const names=new Map();for(const g of groups){const n=(names.get(g.name)||0)+1;names.set(g.name,n);if(n>1)g.name+=' · '+n;}
  return {list:[{vod_id:id,vod_name:title,type_name:type,vod_year:meta.join(' ').match(/(?:19|20)\d{2}/)?.[0]||'',vod_pic:absolute($('.w4-player').attr('data-poster')||$('[data-poster]').first().attr('data-poster')||'',ctx.base),vod_content:description.split('剧情：')[1]||description,vod_actor:description.match(/演员[:：]([^。]+)/)?.[1]||'',vod_director:description.match(/导演[:：]([^。]+)/)?.[1]||'',vod_area:description.match(/地区[:：]([^。]+)/)?.[1]||'',...vodLines(groups)}]};
}
export const a123tv={
  async categories(){return {class:categories};},
  async home(ctx,_args,signal){return listPage(await ctx.read('/',signal),ctx.base);},
  async category(ctx,[id,page],signal){if(!categories.some(c=>c.type_id===id))throw new HttpError(400,'请选择有效分类。');const n=Math.max(1,Number(page)||1);return listPage(await ctx.read('/t/'+id+(n===1?'':'/p'+n)+'.html',signal),ctx.base,n);},
  async search(ctx,[q,_quick,page],signal){const n=Math.max(1,Number(page)||1);return listPage(await ctx.read('/s/'+encodeURIComponent(q)+(n===1?'':'/p'+n)+'.html',signal),ctx.base,n);},
  async detail(ctx,[ids],signal){return readDetail(ctx,pageId(Array.isArray(ids)?ids[0]:ids,ctx.base,detailPattern),signal);},
  async play(ctx,[_flag,raw],signal){const path=pageId(raw,ctx.base,playPattern),$=load(await ctx.read(path,signal)),url=$('.w4-player[data-src]').attr('data-src');
    if(!url)throw new HttpError(422,'这条线路暂时不可用，请切换线路。');return {url:directMedia(url,ctx.base),header:ctx.mediaHeaders(path)};}
};
