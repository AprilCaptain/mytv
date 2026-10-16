import { load } from 'cheerio';
import { HttpError } from '../util.mjs';
import { createHash,createDecipheriv } from 'node:crypto';
import { readText } from '../util.mjs';
import { text,name,absolute,pageId,makeLines,vodLines,playerData,decodePlayerUrl,directMedia,pageCount } from './common.mjs';
const detailPattern=/^\/(?:movie|anime|tv|vod|detail)\/index\d+\.html$/;
const categories=[{type_id:'1',type_name:'电影'},{type_id:'2',type_name:'剧集'},{type_id:'4',type_name:'动漫'},{type_id:'3',type_name:'综艺'},{type_id:'5',type_name:'纪录片'}];
const canonicalType=value=>/^(?:剧情|动作|喜剧|科幻|爱情|恐怖|惊悚|悬疑|战争|犯罪|冒险|奇幻|灾难|纪录)$/.test(value)?value+'片':value;
export function listPage(html,base,page=1){
  const $=load(html),seen=new Set(),list=[];
  $('.myui-vodlist__box,.myui-vodlist__media>li').each((_i,e)=>{
    const box=$(e),a=box.find('a[href]').filter((_j,a)=>{try{return detailPattern.test(new URL($(a).attr('href')||'/',base).pathname);}catch{return false;}}).first();
    if(!a.length)return;let id;try{id=pageId(a.attr('href'),base,detailPattern);}catch{return;}if(seen.has(id))return;seen.add(id);
    const image=box.find('img').first();const background=a.attr('data-original')||a.attr('data-src')||a.attr('style')?.match(/url\(['"]?([^)'"\s]+)/)?.[1];
    const searchInfo=text(box.find('.detail p').filter((_j,e)=>$(e).text().includes('分类：')).text());
    const description=text(box.find('p.text-muted').text()),year=(searchInfo||description).match(/(?:19|20)\d{2}/)?.[0]||'';
    const type=searchInfo.match(/分类[:：]([^]*?)(?=地区[:：]|年份[:：]|$)/)?.[1]||description.split('/').at(-1)?.trim()||'';
    list.push({vod_id:id,vod_name:name(a.attr('title')||box.find('h4,h3').first().text()||image.attr('alt')),vod_pic:absolute(background||image.attr('data-original')||image.attr('src')||'',base),vod_remarks:name(box.find('.pic-text').text()),vod_year:year,type_name:canonicalType(name(type))});
  });
  return {list,page,pagecount:pageCount($,page),total:0};
}
export function detailPage(html,base,id){
  const $=load(html),heading=$('.myui-content__detail h1.title').first().clone();heading.children().remove();
  const vod={vod_id:id,vod_name:name(heading.text()),vod_pic:absolute($('.myui-content__thumb img').attr('data-original')||$('.myui-content__thumb img').attr('src')||'',base),vod_content:text($('.myui-panel p.text-muted').first().text().replace(/^剧情简介[:：]/,''))};
  $('.myui-content__detail p.data').each((_i,e)=>{const value=text($(e).text());
    for(const [label,key] of [['分类','type_name'],['地区','vod_area'],['年份','vod_year'],['演员','vod_actor'],['导演','vod_director']]){const m=value.match(new RegExp(label+'[:：]([^]*?)(?=地区[:：]|语言[:：]|年份[:：]|又名[:：]|$)'));if(m)vod[key]=name(m[1]);}
  });
  vod.type_name=canonicalType(vod.type_name||'');
  const groups=[];
  $('.nav-tabs a[href^="#playlist"]').each((_i,e)=>{const label=name($(e).text());if(/网盘|夸克|百度|下载|磁力/.test(label))return;
    const target=$(e).attr('href').slice(1),group=$('[id]').filter((_j,e)=>$(e).attr('id')===target).first(),episodes=[];
    group.find('a[href*="/play/"]').each((_j,a)=>{try{episodes.push({name:$(a).text(),url:new URL(pageId($(a).attr('href'),base,/^\/play\/\d+-\d+-\d+\.html$/),base).href});}catch{}});
    groups.push({name:label,episodes});
  });
  if(!vod.vod_name)throw new HttpError(502,'网站没有返回这部影片的详情。');
  return {list:[{...vod,...vodLines(makeLines(groups,vod.type_name))}]};
}
export function playerConstant(html,key){
  const $=load(html),code=$('script:not([src])').toArray().map(e=>$(e).text()).find(s=>s.includes('const isSmartPlay'))||'';
  const match=code.match(new RegExp('const\\s+'+key+'\\s*=\\s*("[^"\\r\\n]*"|true|false|\\[[^\\r\\n]*\\])\\s*;'));
  if(!match||match[1].length>64*1024)throw new HttpError(422,'网站播放方式已变化，请切换线路。');
  return JSON.parse(match[1]);
}
export function decodeMediaAddress(cipher,timestamp){
  if(/^https?:\/\//.test(cipher))return cipher;
  // URL envelope used by the public web player, not media/DRM decryption.
  const digest=createHash('md5').update(String(timestamp)+'RY7e48naFXPsLJC').digest('hex');
  try{const aes=createDecipheriv('aes-128-cbc',Buffer.from(digest.slice(16)),Buffer.from(digest.slice(0,16)));
    return Buffer.concat([aes.update(String(cipher),'base64'),aes.final()]).toString('utf8');
  }catch{throw new HttpError(422,'网站播放方式已变化，请切换线路。');}
}
async function resolvePlayer(ctx,data,path,signal){
  if(Number(data.encrypt)!==3)return directMedia(decodePlayerUrl(data.url,data.encrypt),ctx.base);
  if(typeof data.url!=='string'||data.url.length>16000)throw new HttpError(422,'播放信息无效，请切换线路。');
  const frame=await ctx.read('/static/player/artplayer/?'+new URLSearchParams({url:data.url}),signal,{headers:{referer:new URL(path,ctx.base).href}});
  const timestamp=playerConstant(frame,'timestamp');
  if(!playerConstant(frame,'isSmartPlay')){
    const qualities=playerConstant(frame,'qualities');
    const sorted=qualities.filter(q=>typeof q.url==='string').sort((a,b)=>(Number(b.height)||0)-(Number(a.height)||0));
    if(!sorted.length)throw new HttpError(422,'这条线路暂时没有可播放的视频。');
    return directMedia(decodeMediaAddress(sorted[0].url,timestamp),ctx.base);
  }
  const t=Math.floor(Date.now()/1000),body={vkey:playerConstant(frame,'playPageUrl'),code:playerConstant(frame,'secretKeySeed'),t,signature:createHash('md5').update(String(t)).digest('hex')};
  const response=await ctx.fetcher('https://hd.ticktockwow.com/smartplay-cache/api/webvideo_ty.php',{method:'POST',body:JSON.stringify(body),signal,
    headers:{'content-type':'application/json','user-agent':ctx.headers['user-agent'],referer:ctx.base+'/',origin:ctx.base}});
  if(!response.ok){await response.body?.cancel();throw new HttpError(502,'这条线路暂时无法连接，请切换线路。');}
  const result=JSON.parse(await readText(response,512*1024));
  if(Number(result.code)!==200||typeof result.url!=='string')throw new HttpError(422,'这条线路暂时没有可播放的视频。');
  return directMedia(decodeMediaAddress(result.url,timestamp),ctx.base);
}
export const hdmoli={
  async categories(){return {class:categories};},
  async home(ctx,_args,signal){return listPage(await ctx.read('/',signal),ctx.base);},
  async category(ctx,[id,page],signal){if(!categories.some(c=>c.type_id===id))throw new HttpError(400,'请选择有效分类。');const n=Math.max(1,Number(page)||1);return listPage(await ctx.read('/show/'+id+(n===1?'-----------':'--------'+n+'---')+'.html',signal),ctx.base,n);},
  async search(ctx,[q,_quick,page],signal){const n=Math.max(1,Number(page)||1);return listPage(await ctx.read('/search/'+(n===1?'-------------':'----------'+n+'---')+'.html?'+new URLSearchParams({wd:q}),signal),ctx.base,n);},
  async detail(ctx,[ids],signal){const id=pageId(Array.isArray(ids)?ids[0]:ids,ctx.base,detailPattern);return detailPage(await ctx.read(id,signal),ctx.base,id);},
  async play(ctx,[_flag,raw],signal){const path=pageId(raw,ctx.base,/^\/play\/\d+-\d+-\d+\.html$/),data=playerData(await ctx.read(path,signal));
    return {url:await resolvePlayer(ctx,data,path,signal),header:ctx.mediaHeaders(path)};
  }
};
