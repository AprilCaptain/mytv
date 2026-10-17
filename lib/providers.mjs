import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { HttpError, MemoryCache, cleanText, readText, webUrl } from './util.mjs';
import { sourceHeaders } from './network.mjs';
import { PluginManager } from './plugins/manager.mjs';
import { sourcePriority, qualityRank } from './matching.mjs';
import { readConfiguration } from './config-reader.mjs';
import { SELECTED_CONFIG_URL,WEB_CONFIG_URL,LIBRARY_CONFIG_URL,ALL_CONFIG_URL,BUILTIN_CONFIGS } from './configs.mjs';
import {sourceIdentity,abortable} from './aggregate.mjs';
import { normalizeSourceConfig } from './source-config.mjs';
import { WebSources } from './web-sources.mjs';

export const DEFAULT_CONFIG = ALL_CONFIG_URL;
const xml = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true });
const asArray = value => value == null ? [] : Array.isArray(value) ? value : [value];
const xmlText = value => typeof value === 'object' ? value?.['#text'] || '' : String(value ?? '');

function decodeXml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new HttpError(502, '不支持包含 DTD 的 XML 接口。');
  try { return xml.parse(text).rss; } catch { throw new HttpError(502, '源返回的 XML 无法解析。'); }
}

export function parsePayload(text, type) {
  if (type === 0) {
    const rss = decodeXml(text);
    if (!rss || !rss.list) throw new HttpError(502, '这个源没有返回影视 XML 数据。');
    return {
      list: asArray(rss.list.video).map(v => ({
        vod_id: xmlText(v.id), vod_name: xmlText(v.name), type_id: xmlText(v.tid),
        type_name: xmlText(v.type), vod_pic: xmlText(v.pic), vod_remarks: xmlText(v.note || v.state),
        vod_year: xmlText(v.year), vod_area: xmlText(v.area), vod_lang: xmlText(v.lang),
        vod_actor: xmlText(v.actor), vod_director: xmlText(v.director), vod_content: xmlText(v.des),
        vod_play_from: asArray(v.dl?.dd).map(d => d['@_flag'] || '默认线路').join('$$$'),
        vod_play_url: asArray(v.dl?.dd).map(xmlText).join('$$$')
      })),
      class: asArray(rss.class?.ty).map(c => ({ type_id: String(c['@_id']), type_name: xmlText(c) })),
      page: rss.list['@_page'], pagecount: rss.list['@_pagecount'], total: rss.list['@_recordcount']
    };
  }
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data.list)) throw new Error();
    return data;
  } catch { throw new HttpError(502, '这个源没有返回影视 JSON 数据，可能暂不可用或被拦截。'); }
}

export function card(video) {
  let poster = '';
  try { poster = webUrl(String(video.vod_pic).split(/@(?:Referer|User-Agent|Cookie)=/i)[0]).href; } catch {}
  return {
    id: String(video.vod_id), title: cleanText(video.vod_name), poster,
    remarks: cleanText(video.vod_remarks), type: cleanText(video.type_name),
    year: cleanText(video.vod_year), area: cleanText(video.vod_area)
  };
}

export function isMediaUrl(raw) {
  try { return /\.(m3u8|mp4|webm|m4v|mov)(?:$|[?#])/i.test(webUrl(raw).href); } catch { return false; }
}

export function parseLines(video) {
  if(Array.isArray(video.vod_play_sources))return video.vod_play_sources.slice(0,100).map(line=>({
    name:cleanText(line.name||'线路'),key:String(line.key||'').slice(0,200),
    episodes:(Array.isArray(line.episodes)?line.episodes:[]).slice(0,10000).map(ep=>({name:cleanText(ep.name||'正片'),url:String(ep.url||''),direct:isMediaUrl(ep.url)}))
  })).filter(line=>line.episodes.length);
  const names = String(video.vod_play_from || '').split('$$$');
  return String(video.vod_play_url || '').split('$$$').filter(Boolean).map((group, index) => ({
    name: cleanText(names[index] || '线路 ' + (index + 1)),
    episodes: group.split('#').filter(Boolean).map((entry, i) => {
      const delimiter = entry.indexOf('$');
      const name = delimiter < 0 ? '第 ' + (i + 1) + ' 集' : cleanText(entry.slice(0, delimiter));
      const url = delimiter < 0 ? entry.trim() : entry.slice(delimiter + 1).trim();
      return { name, url, direct: isMediaUrl(url) };
    })
  }));
}

export class Providers {
  constructor(fetcher, options = {}) {
    this.fetcher = fetcher;
    this.websites=new WebSources(fetcher);
    this.plugins = new PluginManager(fetcher, options.origin || 'http://127.0.0.1:' + (process.env.PORT || 3210));
    this.sources = new MemoryCache(4096, 24 * 60 * 60_000);
    this.configurations = new MemoryCache(24, 24 * 60 * 60_000);
    this.health = new MemoryCache(4096, 5 * 60_000);
    this.categories = new MemoryCache(128, 10 * 60_000);
    this.details = new MemoryCache(64, 60_000);
    this.knownConfigs=new Map();
  }

  async importConfig(raw, signal, depth = 0,members) {
    if (depth > 3) throw new HttpError(400, '配置合集嵌套过深。');
    const base = webUrl(raw).href;
    if(base===ALL_CONFIG_URL){if(depth)throw new HttpError(400,'配置合集不能再次嵌套「全部」。');return this.importAll(members,signal);}
    const localFile=base===SELECTED_CONFIG_URL?'selected.json':base===WEB_CONFIG_URL?'websites.json':base===LIBRARY_CONFIG_URL?'library.json':'';
    const loaded = localFile ? {
      value: JSON.parse(await readFile(new URL('../configs/'+localFile, import.meta.url), 'utf8')),
      url: base, format: 'json', encodings: []
    } : await readConfiguration(base, this.fetcher, signal);
    const resolvedBase = loaded.url;
    signal?.throwIfAborted();
    let config;
    if (loaded.format === 'xml') {
      parsePayload(loaded.text, 0);
      config = { sites: [{ key: 'custom', name: '自定义 XML 源', type: 0, api: resolvedBase }] };
    } else {
      config = normalizeSourceConfig(loaded.value, resolvedBase);
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new HttpError(400, '配置内容不是有效的配置对象。');
      if (!config.sites && Array.isArray(config.list))
        config = { sites: [{ key: 'custom', name: '自定义 JSON 源', type: 1, api: resolvedBase }] };
    }
    if (!config.sites && Array.isArray(config.urls) && config.urls.length) {
      const nested = await this.importConfig(webUrl(config.urls[0].url, resolvedBase).href, signal, depth + 1);
      return { ...nested, depots: config.urls.map(c => ({ name: cleanText(c.name), url: webUrl(c.url, resolvedBase).href })) };
    }
    if (!Array.isArray(config.sites))
      throw new HttpError(400, '配置中没有 sites 站点列表。也可以直接填写 JSON/XML 点播接口地址。');
    if (config.sites.length > 1000) throw new HttpError(400, '配置里的站点数量过多。');
    const configId = createHash('sha256').update(base).digest('hex').slice(0, 24);
    const parsers = (Array.isArray(config.parses) ? config.parses : []).map(parser => {
      if (!parser || typeof parser !== 'object' || typeof parser.url !== 'string') return parser;
      try { return { ...parser, url: webUrl(parser.url, resolvedBase).href }; } catch { return parser; }
    });
    const sites = config.sites.map((site, index) => {
      const type = Number(site.type);
      let api;
      try { api = webUrl(site.api, resolvedBase).href; } catch {}
      const kind = site.adapter ? 'web' : [0,1].includes(type) ? 'http' : type === 3 && /\.js(?:$|[?])/i.test(site.api) ?
        'js' : type === 3 && /\.py(?:$|[?])/i.test(site.api) ? 'python' : 'android';
      const supported = Boolean(api) && (kind === 'web'?this.websites.capability(site.adapter):kind === 'http' || this.plugins.capability(kind));
      const id = createHash('sha256').update(base + '\n' + index + '\n' + site.key).digest('hex').slice(0, 24);
      const name = cleanText(site.name || site.key || '未命名源');
      let reason = supported ? '' : kind==='web'?'暂不支持这个网站适配器':['js','python'].includes(kind)&&process.env.MYTV_DISABLE_PLUGINS==='1'?'已关闭脚本片源':kind === 'python' ? 'Python 环境未准备好或当前系统缺少进程隔离' :
        kind === 'android' ? '需要 Android 插件' : '暂不支持这个源的接口格式';
      let ext = site.ext;
      if (typeof ext === 'string' && /^(?:\.\.?\/|https?:)/.test(ext)) ext = webUrl(ext, resolvedBase).href;
      const searchable = Number(site.searchable) !== 0;
      // changeable controls switching sources, not whether the site's own videos can play.
      const playable = Number(site.indexs) !== 1 &&
        !/搜索.*豆瓣|官源|直播|音频|音乐|广播|听书|播客|配置|预告|本地|免费|广告/.test(name);
      if (supported) this.sources.set(id, { id, configId, key:String(site.key||''), name, type, kind, adapter:site.adapter, api, ext, searchable, playable,directOnly:site.directOnly===true,
        headers: sourceHeaders(site.header), parsers });
      return { id, key:String(site.key||''), api, name, supported, reason, type, kind, searchable, playable,
        quality: qualityRank(name) >= 40 ? '4K 标识' : '' };
    });
    const result=this.configurations.set(configId, {
      id: configId, url: base, effectiveUrl: resolvedBase, encodings: loaded.encodings,
      checkedAt: config.checkedAt || '', description: cleanText(config.description),
      sources: sites, supported: sites.filter(s => s.supported).length
    });
    this.knownConfigs.set(base,{url:base,name:cleanText(config.name||'自定义配置').slice(0,100)});
    while(this.knownConfigs.size>32)this.knownConfigs.delete(this.knownConfigs.keys().next().value);
    return result;
  }

  async importAll(members,signal){
    if(members!==undefined&&!Array.isArray(members))throw new HttpError(400,'聚合配置列表无效。');
    if(members?.length>32)throw new HttpError(400,'最多聚合 32 个配置。');
    const inputs=new Map();
    for(const item of [...BUILTIN_CONFIGS,...(members||[]),...this.knownConfigs.values()]){
      let url;try{url=webUrl(typeof item==='string'?item:item.url).href;}catch{continue;}
      if(url===ALL_CONFIG_URL)continue;
      if(!inputs.has(url))inputs.set(url,{url,name:cleanText(item.name||'自定义配置').slice(0,100)});
    }
    if(inputs.size>32)throw new HttpError(400,'最多聚合 32 个配置，请减少自定义配置。');
    const deadline=AbortSignal.timeout(12_000),combined=signal?AbortSignal.any([signal,deadline]):deadline;
    const list=[...inputs.values()],results=Array(list.length);let next=0;
    await Promise.all(Array.from({length:3},async()=>{while(next<list.length){const index=next++,member=list[index];
      try{const perMember=AbortSignal.any([combined,AbortSignal.timeout(6500)]);
        const config=await abortable(this.importConfig(member.url,perMember,1),perMember);
        results[index]={...member,status:'ok',config,definitions:config.sources.filter(s=>s.supported&&s.playable).map(s=>({...this.source(s.id)}))};
      }catch(error){if(signal?.aborted)throw error;results[index]={...member,status:'error',message:error.name==='TimeoutError'?'读取超时':error.message};}
    }}));
    signal?.throwIfAborted();
    for(const [url,member] of inputs)if(this.knownConfigs.has(url))this.knownConfigs.set(url,member);
    const rank=url=>url===SELECTED_CONFIG_URL?0:url===WEB_CONFIG_URL?1:url===LIBRARY_CONFIG_URL?2:3;
    const unique=new Map();let total=0,omitted=0;
    for(const member of results.filter(r=>r.status==='ok').sort((a,b)=>rank(a.url)-rank(b.url)||a.url.localeCompare(b.url))){
      for(const source of member.definitions){total++;let identity;try{identity=sourceIdentity(source);}catch{identity=source.id;}
        const origin={configUrl:member.config.url,configName:member.name,sourceKey:source.key};
        const found=unique.get(identity);
        if(found){found.origins.push(origin);found.searchable||=source.searchable;continue;}
        if(unique.size>=1000){omitted++;continue;}
        unique.set(identity,{...source,identity,origin,origins:[origin]});
      }
    }
    if(!unique.size)throw new HttpError(422,'暂时没有可用的聚合片源，请选择单个配置或检查网络。');
    const id=createHash('sha256').update(ALL_CONFIG_URL).digest('hex').slice(0,24),sources=[];
    for(const source of unique.values()){
      const sourceId=createHash('sha256').update(ALL_CONFIG_URL+'\n'+source.identity).digest('hex').slice(0,24);
      this.sources.set(sourceId,{...source,id:sourceId,configId:id});
      sources.push({id:sourceId,key:'all_'+sourceId,api:source.api,name:source.name,type:source.type,kind:source.kind,searchable:source.searchable,playable:true,supported:true,reason:'',quality:qualityRank(source.name)>=40?'4K 标识':'',origins:source.origins});
    }
    return this.configurations.set(id,{id,url:ALL_CONFIG_URL,aggregate:true,sources,supported:sources.length,
      members:results.map(({name,url,status,message,config})=>({name,url,status,message,sourceCount:config?.sources.filter(s=>s.supported&&s.playable).length||0})),
      duplicateCount:total-unique.size-omitted,omittedCount:omitted,description:'合并当前配置中的可用片源；首页浏览一个片库，搜索覆盖全部去重后的来源。'});
  }

  configuration(id) {
    const config = this.configurations.get(id);
    if (!config) throw new HttpError(404, '配置已失效，请重新选择配置。');
    return { ...config, sources: config.sources.map(s => ({ ...s, health: this.health.get(s.id) || null })) };
  }

  eligible(id, search = false, excluded = []) {
    return this.configuration(id).sources.filter(s => s.supported && s.playable &&
      (!search || s.searchable) && !excluded.includes(s.id)).sort((a,b) =>
      sourcePriority(b) - sourcePriority(a));
  }

  async pluginCall(source, method, args, signal) {
    try {
      const result = source.kind==='web'?await this.websites.call(source,method,args,signal):await this.plugins.call(source, method, args, signal);
      this.health.set(source.id, { status: 'ok' }); return result || {};
    } catch (error) {
      if (!signal?.aborted) this.health.set(source.id, { status: 'error', message: error.message });
      if (error.status === 400 && /请输入有效的 HTTP/.test(error.message))
        throw new HttpError(502, source.name + ' 的脚本请求了无效地址，可能不兼容当前运行环境；配置已成功读取。');
      throw error;
    }
  }

  source(id) {
    const source = this.sources.get(id);
    if (!source) throw new HttpError(404, '源配置已失效，请重新导入配置。');
    return source;
  }

  async query(source, parameters, signal) {
    const url = new URL(source.api);
    for (const key of ['ac', 'wd', 'ids', 't', 'pg', 'h']) url.searchParams.delete(key);
    for (const [key, value] of Object.entries(parameters))
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    const response = await this.fetcher(url.href, { headers: source.headers, signal });
    if (!response.ok) {
      await response.body?.cancel();
      const error = new HttpError(502, '源返回 HTTP ' + response.status + '，请更换源。');
      this.health.set(source.id, { status: 'error', message: error.message }); throw error;
    }
    const data = parsePayload(await readText(response), source.type);
    this.health.set(source.id, { status: 'ok' }); return data;
  }

  async getCategories(id, signal) {
    const cached = this.categories.get(id);
    if (cached) return cached;
    const source = this.source(id);
    const data = source.kind === 'http' ? await this.query(source, { ac: 'list' }, signal) :
      await this.pluginCall(source, source.kind === 'js' ? 'home' : 'homeContent', [true], signal);
    return this.categories.set(id, asArray(data.class).map(c => ({
      id: String(c.type_id), name: cleanText(c.type_name), parent: String(c.type_pid || '')
    })));
  }

  async catalog(id, { page = 1, category = '', q = '' } = {}, signal) {
    const source = this.source(id);
    if (source.kind !== 'http') {
      let data;
      if (q) data = await this.pluginCall(source, source.kind === 'js' ? 'search' : 'searchContent',
        [q, false, String(page)], signal);
      else if (category) data = await this.pluginCall(source, source.kind === 'js' ? 'category' : 'categoryContent',
        [category, String(page), true, {}], signal);
      else data = await this.pluginCall(source, source.kind === 'js' ? 'homeVod' : 'homeVideoContent', [], signal);
      if (!q && !category && !data.list?.length) {
        const classes = await this.getCategories(id, signal);
        if (classes.length) return this.catalog(id, { page, category: classes[0].id }, signal);
      }
      return { list: (data.list || []).map(card), page: Number(data.page) || page,totalKnown:source.kind==='web'?data.totalKnown===true:undefined,
        pageCount: Number(data.pagecount) || (data.list?.length ? page + 1 : page), total: Number(data.total) || data.list?.length || 0 };
    }
    const params = { ac: q ? 'list' : source.type === 0 ? 'videolist' : 'detail', pg: page, t: category, wd: q };
    let data = await this.query(source, params, signal);
    // Some providers return compact search results even when ac=detail is requested.
    if (data.list.length && data.list.slice(0, 6).every(v => !v.vod_pic)) {
      const ids = data.list.map(v => v.vod_id).filter(v => v != null).join(',');
      if (ids) {
        const full = await this.query(source, { ac: source.type === 0 ? 'videolist' : 'detail', ids }, signal);
        const map = new Map(full.list.map(v => [String(v.vod_id), v]));
        data = { ...data, list: data.list.map(v => map.get(String(v.vod_id)) || v) };
      }
    }
    return {
      list: data.list.map(card), page: Number(data.page) || page,
      pageCount: Number(data.pagecount) || page, total: Number(data.total) || data.list.length
    };
  }

  async detail(id, videoId, signal) {
    const key = id + ':' + videoId;
    const cached = this.details.get(key);
    if (cached) return cached;
    const source = this.source(id);
    const data = source.kind !== 'http' ? await this.pluginCall(source,
      source.kind === 'js' ? 'detail' : 'detailContent', [source.kind === 'js' ? videoId : [videoId]], signal) :
      await this.query(source, {
      ac: source.type === 0 ? 'videolist' : 'detail', ids: videoId
    }, signal);
    const video = (data.list || []).find(v => String(v.vod_id) === String(videoId)) ||
      (source.kind !== 'http' && data.list?.length === 1 ? data.list[0] : null);
    if (!video) throw new HttpError(404, '源没有返回这部影片的详情。');
    let lines=parseLines(video);
    if(source.kind==='http'&&source.directOnly)lines=lines.map(line=>({...line,episodes:line.episodes.filter(ep=>ep.direct)})).filter(line=>line.episodes.length);
    return this.details.set(key, {
      ...card(video), id: String(videoId), source: id, sourceName: source.name, sourceKey:source.key, kind: source.kind,
      originConfigName:source.origin?.configName||'',
      description: cleanText(video.vod_content),
      actors: cleanText(video.vod_actor), director: cleanText(video.vod_director),
      lines
    });
  }

  async resolve(id, videoId, lineIndex, episodeIndex, signal) {
    const source = this.source(id);
    const detail = await this.detail(id, String(videoId), signal);
    const line = detail.lines[lineIndex], episode = line?.episodes[episodeIndex];
    if (!episode) throw new HttpError(400, '请选择有效的集数。');
    let result = { url: episode.url };
    if (source.kind !== 'http') result = await this.pluginCall(source,
      source.kind === 'js' ? 'play' : 'playerContent', [line.name, episode.url, []], signal);
    if (!result.url) throw new HttpError(422, '插件没有返回播放地址。');
    let url = result.url;
    if (Array.isArray(url)) {
      const choices = [];
      for (let i=0;i<url.length;i+=2) choices.push({ name: url[i], url: url[i+1] });
      choices.sort((a,b) => qualityRank(b.name) - qualityRank(a.name)); url = choices[0]?.url;
    } else if (typeof url === 'object') {
      const choices = [...(url.values || [])].sort((a,b) => qualityRank(b.n) - qualityRank(a.n));
      url = choices[0]?.v;
    }
    let header = result.header || {};
    if (typeof header === 'string') { try { header = JSON.parse(header); } catch { header = {}; } }
    if (!isMediaUrl(url) && !String(url).includes('/api/plugin-proxy/')) {
      const prefix = String(result.playUrl || '');
      const parsers = prefix.startsWith('json:') ? [{ url: prefix.slice(5), type: 1 }] :
        source.parsers.filter(p => Number(p.type) === 1);
      for (const parser of parsers.slice(0,2)) {
        try {
          const data = await this.plugins.broker.request(String(parser.url) + url,
            { headers: parser.ext?.header }, signal);
          const parsed = JSON.parse(data.content);
          const candidate = parsed.url || parsed.data?.url;
          if (candidate && isMediaUrl(candidate)) {
            url = candidate; header = parsed.header || header; break;
          }
        } catch (error) { if (signal?.aborted) throw error; }
      }
    }
    return { url, headers: sourceHeaders({ ...source.headers, ...header }) };
  }
  close() { this.plugins.close(); }
}
