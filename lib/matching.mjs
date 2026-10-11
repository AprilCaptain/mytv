export function normalizedTitle(value = '') {
  return String(value).normalize('NFKC').toLowerCase()
    .replace(/[\[(【]\s*(?:4k|2160p|1080p|uhd|hdr|蓝光)\s*[\])】]/gi, '')
    .replace(/\s+(?:4k|2160p|uhd)$/gi, '').replace(/[\s\p{P}\p{S}]/gu, '');
}
function yearOf(value) { return String(value || '').match(/(?:19|20)\d{2}/)?.[0] || ''; }
function family(value = '') {
  return /动漫|动画/.test(value) ? 'anime' : /电影|片/.test(value) ? 'movie' :
    /剧|电视/.test(value) ? 'tv' : '';
}
export function matchesFilm(candidate, target) {
  if (normalizedTitle(candidate.title) !== normalizedTitle(target.title)) return false;
  const a = yearOf(candidate.year), b = yearOf(target.year);
  if (a && b && a !== b) return false;
  const fa = family(candidate.type), fb = family(target.type);
  return !(fa && fb && fa !== fb);
}
export function qualityRank(value = '') {
  return /4k|2160p|uhd/i.test(value) ? 40 : /蓝光|原画|1080p|全高清/i.test(value) ? 20 : /720p|高清/i.test(value) ? 10 : 0;
}
export function episodeKey(value = '') {
  const text = String(value).normalize('NFKC').trim();
  const match = text.match(/^(?:第\s*)?0*(\d+)\s*(?:集|话|期)?(?:$|\s)/);
  return match ? 'number:' + Number(match[1]) : normalizedTitle(text);
}

export function sourcePriority(source) {
  return qualityRank(source.name) + (/量子|百度|索尼|率率/.test(source.name) ? 5 : 0);
}
