import { HttpError, webUrl } from './util.mjs';

// Adapt public HTTP source-list formats without importing another application's runtime.
export function normalizeSourceConfig(value, base) {
  if (value && !Array.isArray(value) && Array.isArray(value.sites)) return value;
  const moon = value && typeof value.api_site === 'object' && !Array.isArray(value.api_site) && value.api_site;
  const entries = moon ? Object.entries(moon).map(([key, site]) => ({ ...site, key, url: site?.api })) :
    Array.isArray(value) ? value : Array.isArray(value?.sources) ? value.sources : null;
  if (!entries) return value;
  if (entries.length > 1000) throw new HttpError(400, '配置里的站点数量过多。');
  const seen = new Set();
  const sites = [];
  for (const entry of entries) {
    if (!entry || entry.disabled === true || typeof entry.url !== 'string' || !entry.url.trim()) continue;
    if (/^csp_|\.(?:jar|js|py)(?:$|[?#])/i.test(entry.url.trim())) continue;
    let api;
    try { api = webUrl(entry.url.trim(), base).href; } catch { continue; }
    if (seen.has(api)) continue;
    seen.add(api);
    sites.push({ key: String(entry.key || 'http_' + sites.length), name: String(entry.name || new URL(api).hostname),
      type: 1, api, searchable: entry.searchable ?? 1, header: entry.header });
  }
  if (!sites.length) throw new HttpError(400, '这个列表没有可导入的 HTTP JSON 点播源，可能只包含插件或禁用项。');
  return { ...(!Array.isArray(value) ? value : {}), sites };
}
