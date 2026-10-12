// Manual live checks; never run during startup or CI.
import { Providers, isMediaUrl } from '../lib/providers.mjs';
import { SELECTED_CONFIG_URL } from '../lib/configs.mjs';
import { remoteFetch } from '../lib/network.mjs';
import { readText } from '../lib/util.mjs';
import { normalizedTitle } from '../lib/matching.mjs';

const providers = new Providers(remoteFetch);
const queries = process.argv.slice(2).length ? process.argv.slice(2) : ['庆余年第二季', '流浪地球2', '斗罗大陆'];
const results = [];
const signal = () => AbortSignal.timeout(15_000);

async function checkMedia(url, headers) {
  let resolutions = [], duration = 0;
  for (let hop = 0; hop < 4; hop++) {
    const response = await remoteFetch(url, { headers, signal: signal() });
    if (!response.ok) { await response.body?.cancel(); throw new Error('媒体 HTTP ' + response.status); }
    const base = response.url || url;
    const text = await readText(response, 2 * 1024 * 1024);
    if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('未返回有效 HLS 播放列表');
    const lines = text.split(/\r?\n/).map(l => l.trim());
    resolutions.push(...[...text.matchAll(/RESOLUTION=(\d+x\d+)/g)].map(m => m[1]));
    const child = lines.find(l => l && !l.startsWith('#'));
    if (!child) throw new Error('播放列表没有媒体地址');
    url = new URL(child, base).href;
    if (!text.includes('#EXTINF:')) continue;
    duration = Math.round([...text.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum,m) => sum + Number(m[1]), 0));
    const segment = await remoteFetch(url, { headers: { ...headers, range: 'bytes=0-16383' }, signal: signal() });
    const reader = segment.body?.getReader();
    try {
      if (!segment.ok || !reader) throw new Error('分片 HTTP ' + segment.status);
      const chunk = await reader.read();
      if (!chunk.value?.length || /text\/html|application\/json/i.test(segment.headers.get('content-type') || ''))
        throw new Error('分片未返回媒体内容');
      return { manifest: true, resolutions: [...new Set(resolutions)], durationSeconds: duration,
        segmentStatus: segment.status, sampledBytes: chunk.value.length };
    } finally { await reader?.cancel().catch(() => {}); }
  }
  throw new Error('播放列表嵌套过深');
}

try {
  const config = await providers.importConfig(SELECTED_CONFIG_URL);
  const jobs = config.sources.flatMap(source => queries.map(query => ({ source, query })));
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < jobs.length) {
      const { source, query } = jobs[next++];
      const result = { source: source.name, query, checkedAt: new Date().toISOString() };
      try {
        result.categories = (await providers.getCategories(source.id, signal())).length;
        const data = await providers.catalog(source.id, { q: query }, signal());
        const matches = data.list.filter(v => normalizedTitle(v.title) === normalizedTitle(query));
        const video = matches.find(v => /动漫|动画/.test(v.type)) || matches[0];
        if (!video) throw new Error('未找到名称完全匹配的样本');
        const detail = await providers.detail(source.id, video.id, signal());
        result.title = detail.title;result.videoId = video.id;result.type = detail.type;
        result.lines = detail.lines.map(l => ({ name: l.name, episodes: l.episodes.length }));
        let lastError;
        for (let line = 0; line < Math.min(3, detail.lines.length); line++) {
          try {
            const resolved = await providers.resolve(source.id, video.id, line, 0, signal());
            if (!isMediaUrl(resolved.url) || !/\.m3u8(?:$|[?#])/i.test(resolved.url)) continue;
            Object.assign(result, await checkMedia(resolved.url, resolved.headers), { line: detail.lines[line].name });
            break;
          } catch (error) { lastError = error; }
        }
        if (!result.manifest) throw lastError || new Error('没有可验证的直连 HLS 线路');
        result.ok = true;
      } catch (error) { result.ok = false;result.error = error.message; }
      results.push(result);console.log(JSON.stringify(result));
    }
  }));
  if (results.some(r => !r.ok)) process.exitCode = 1;
} finally { providers.close(); }
