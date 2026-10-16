export const filmTitle = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/第([零一二三四五六七八九十\d]+)季/g,(_m,n)=>'第'+(/^\d+$/.test(n)?Number(n):chineseNumber(n))+'季')
  .replace(/[\[(【]\s*(?:4k|2160p|1080p|uhd|hdr|蓝光)\s*[\])】]/gi, '')
  .replace(/\s+(?:4k|2160p|uhd)$/gi, '').replace(/[\s\p{P}\p{S}]/gu, '');
export const filmYear = value => String(value || '').match(/(?:19|20)\d{2}/)?.[0] || '';
export const filmFamily = value => /动漫|动画/.test(value || '') ? 'anime' : /电影|片/.test(value || '') ? 'movie' : /剧|电视/.test(value || '') ? 'tv' : '';
export function sameFilm(a, b) {
  return !!filmTitle(a.title) && filmTitle(a.title) === filmTitle(b.title) &&
    !!filmYear(a.year) && filmYear(a.year) === filmYear(b.year) &&
    !!filmFamily(a.type) && filmFamily(a.type) === filmFamily(b.type);
}
function chineseNumber(s) {
  const digits='零一二三四五六七八九';
  if(s==='十')return 10;
  if(s.includes('十')){const [a,b]=s.split('十');return (a?digits.indexOf(a):1)*10+(b?digits.indexOf(b):0);}
  return digits.indexOf(s);
}
export function historyEpisode(name, type = '') {
  if(filmFamily(type)==='movie')return 'feature';
  const s=String(name||'').normalize('NFKC').trim();
  let m=s.match(/^(?:第\s*|ep(?:isode)?\s*)?0*(\d+)\s*(?:集|话|期)?$/i);
  if(m)return 'episode:'+Number(m[1]);
  m=s.match(/^第([零一二三四五六七八九十]+)(?:集|话|期)$/);
  if(m&&chineseNumber(m[1])>=0)return 'episode:'+chineseNumber(m[1]);
  return 'named:'+filmTitle(s);
}
export function resumeDecision(bookmark, duration, seekable = null) {
  if(!Number.isFinite(duration)||duration<=0)return {kind:'wait'};
  if(!bookmark||bookmark.completed)return {kind:'start',position:0};
  const position=Number(bookmark.position);
  if(!Number.isFinite(position)||position<0)return {kind:'start',position:0};
  const changed=bookmark.duration>0&&Math.abs(duration-bookmark.duration)>Math.max(60,bookmark.duration*.05);
  if(position>=duration||changed)return {kind:'choice',position,canResume:position<duration};
  if(position>0&&(!seekable||position<seekable.start||position>seekable.end))return {kind:'wait'};
  return {kind:'resume',position};
}
export function nextHistoryEpisode(episodes,index,type=''){
  if(filmFamily(type)==='movie')return -1;
  const key=historyEpisode(episodes[index]?.name,type),n=key.match(/^episode:(\d+)$/);
  return n?episodes.findIndex(ep=>historyEpisode(ep.name,type)==='episode:'+(Number(n[1])+1)):-1;
}
