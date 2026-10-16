import { load } from 'cheerio';
import { HttpError, cleanText, readText, webUrl } from '../util.mjs';
import { sourceHeaders } from '../network.mjs';
import { qualityRank } from '../matching.mjs';

export const text=value=>cleanText(value).slice(0,8000);
export const name=value=>text(value).replace(/[$#]/g,' ').trim().slice(0,200);
export function absolute(value,base){try{return webUrl(value,base).href;}catch{return '';}}
export function pageId(value,base,pattern){
  const url=webUrl(value,base);
  if(url.origin!==new URL(base).origin||!pattern.test(url.pathname))throw new HttpError(400,'影片地址不属于这个网站。');
  return url.pathname;
}
export class WebsiteContext {
  constructor(source,fetcher){this.source=source;this.fetcher=fetcher;this.base=webUrl(source.api).origin;
    const ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
    this.headers=sourceHeaders({...source.headers,'user-agent':source.headers?.['user-agent']&&source.headers['user-agent']!=='Mozilla/5.0'?source.headers['user-agent']:ua,referer:source.headers?.referer||this.base+'/'});}
  async read(path,signal,{method='GET',body,headers={}}={}){
    signal?.throwIfAborted();
    const url=webUrl(path,this.base);
    if(url.origin!==this.base)throw new HttpError(400,'网页请求超出当前片源范围。');
    const deadline=AbortSignal.timeout(12_000),combined=signal?AbortSignal.any([signal,deadline]):deadline;
    const response=await this.fetcher(url.href,{signal:combined,method,body,headers:{...this.headers,...headers}});
    if(!response.ok){await response.body?.cancel();throw new HttpError(502,'网站暂时无法访问（HTTP '+response.status+'）。');}
    const html=await readText(response,3*1024*1024);
    if(/<title[^>]*>\s*(?:Just a moment|Attention Required|Protected by)/i.test(html))throw new HttpError(422,'这个网站需要访问验证，暂时无法自动读取。');
    return html;
  }
  mediaHeaders(page){return {...this.headers,referer:webUrl(page,this.base).href,origin:this.base};}
}
export function episodeName(raw,type=''){
  const value=name(raw);
  if(/^\d+$/.test(value))return /电影|片/.test(type)?'正片':'第'+value.padStart(2,'0')+'集';
  return value||'正片';
}
export function makeLines(groups,type){
  const names=new Map();for(const g of groups)names.set(g.name,(names.get(g.name)||0)+1);
  return groups.filter(g=>g.episodes.length).map(group=>{
    let episodes=group.episodes.map(ep=>({...ep,name:episodeName(ep.name,type)}));
    const numbers=episodes.map(ep=>ep.name.match(/^第(\d+)集$/)?.[1]).filter(Boolean).map(Number);
    if(numbers.length>1&&numbers[0]>numbers.at(-1))episodes.reverse();
    if(/电影|片/.test(type)&&!/动漫|动画/.test(type))episodes.sort((a,b)=>qualityRank(b.name)-qualityRank(a.name));
    const key=group.key||group.episodes[0].url.match(/-(\d+)-\d+\.html/)?.[1]||'';
    return {key,name:group.name+(names.get(group.name)>1&&key?' · '+key:''),episodes};
  });
}
export function vodLines(groups){return {vod_play_from:groups.map(g=>name(g.name)).join('$$$'),vod_play_url:groups.map(g=>g.episodes.map(ep=>name(ep.name)+'$'+ep.url).join('#')).join('$$$'),vod_play_sources:groups};}
// Parse a data assignment, never evaluate a website's JavaScript.
export function dataAssignment(html,variable='player_\\w+'){
  const $=load(html);
  for(const script of $('script:not([src])').toArray()){
    const code=$(script).text(),match=new RegExp('\\b(?:var|let|const)\\s+(?:'+variable+')\\s*=\\s*').exec(code);
    if(!match)continue;
    const start=match.index+match[0].length;if(code[start]!=='{')continue;
    let depth=0,string=false,escape=false;
    for(let i=start;i<Math.min(code.length,start+256*1024);i++){
      const c=code[i];if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;continue;}
      if(c==='"')string=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){
        try{return JSON.parse(code.slice(start,i+1));}catch{throw new HttpError(502,'网站播放信息暂时无法读取。');}
      }
    }
  }
  throw new HttpError(422,'这个播放页没有可读取的播放信息，请切换线路。');
}
export const playerData=html=>dataAssignment(html);
export function decodePlayerUrl(raw,mode){
  let value=String(raw||'');
  if(Number(mode)===2)value=Buffer.from(value,'base64').toString('utf8');
  if([1,2].includes(Number(mode)))try{value=decodeURIComponent(value);}catch{}
  return value;
}
export function directMedia(value,base){
  const url=webUrl(value,base);
  if(!/\.(?:m3u8|mp4|m4v|webm|mov)(?:$|[?#])/i.test(url.href))throw new HttpError(422,'这条线路需要网页播放器，请选择其他线路。');
  return url.href;
}
export function pageCount($,page){
  let max=page;
  $('a[href]').each((_i,e)=>{const href=$(e).attr('href')||'';const n=href.match(/[?&]page=(\d+)/)?.[1]||href.match(/--------(\d+)---\.html/)?.[1];if(n)max=Math.max(max,Math.min(10000,Number(n)));});
  return max;
}
