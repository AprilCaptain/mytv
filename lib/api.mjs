import { Providers, DEFAULT_CONFIG } from './providers.mjs';
import { Playback } from './playback.mjs';
import { remoteFetch } from './network.mjs';
import { HttpError } from './util.mjs';
import { Discovery } from './discovery.mjs';
import { BUILTIN_CONFIGS } from './configs.mjs';
import { HistoryService } from './history-service.mjs';

const json = (body, status = 200) => Response.json(body, {
  status, headers: { 'cache-control': 'no-store' }
});

export function createApi(fetcher = remoteFetch, options = {}) {
  const providers = new Providers(fetcher, options);
  const discovery = new Discovery(providers);
  const history=options.history?new HistoryService(options.history,providers,discovery):null;
  const mediaFetcher = async (url, opts) => await providers.plugins.fetchProxy(url, opts) || fetcher(url, opts);
  const playback = new Playback(mediaFetcher);
  const api = async function api(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) throw new HttpError(403, '请从本机网页访问服务。');
      if (request.headers.get('sec-fetch-site') === 'cross-site')
        throw new HttpError(403, '请从本机网页访问服务。');
      if(path.startsWith('/api/history')) {
        if(!history)throw new HttpError(503,'历史存储尚未就绪，请重启服务。');
        if(request.method==='GET'&&path==='/api/history')return json(history.store.page({query:url.searchParams.get('q')||'',page:url.searchParams.get('page'),pageSize:20}));
        if(request.method==='DELETE'&&path==='/api/history')return json({ok:true,...history.store.clear()});
        if(request.method==='GET'&&path==='/api/history/latest')return json({item:history.store.list()[0]||null});
        if(request.method==='POST'&&path==='/api/history/prepare')return json(await history.prepare(await request.json(),request.signal));
        if(request.method==='POST'&&path==='/api/history/sessions')return json(await history.start(await request.json(),request.signal));
        if(request.method==='POST'&&path==='/api/history/progress')return json(history.store.update(await request.json()));
        if(request.method==='POST'&&path==='/api/history/resume')return json(await history.resolveRecord((await request.json()).id,request.signal));
        if(request.method==='POST'&&path==='/api/history/matches'){const body=await request.json();return json(await history.matches(history.store.get(body.id),body.config,request.signal,Array.isArray(body.exclude)?body.exclude:[]));}
        if(request.method==='DELETE'&&/^\/api\/history\/[\w-]+$/.test(path)){history.store.delete(path.split('/').pop());return json({ok:true});}
        throw new HttpError(405,'不支持这个历史请求。');
      }
      if (path === '/api/config' && request.method === 'POST') {
        const body = await request.json();
        return json(await providers.importConfig(body.url || DEFAULT_CONFIG, request.signal));
      }
      if (path === '/api/play' && request.method === 'POST') {
        const body = await request.json();
        if (body.source) {
          const source = providers.source(body.source);
          if (body.config && source.configId !== body.config)
            throw new HttpError(400, '这个片源不属于当前配置。');
          const resolved = await providers.resolve(body.source, body.id, Number(body.line), Number(body.episode), request.signal);
          return json(await playback.create(resolved.url, resolved.headers, request.signal));
        }
        return json(await playback.create(body.url, {}, request.signal));
      }
      if (request.method !== 'GET') throw new HttpError(405, '不支持这个请求方法。');
      if (path === '/api/health') return json({ ok: true, app: 'my-tv', version: '0.3.0', ...options.health?.() });
      if (path === '/api/configs') return json({ configs: BUILTIN_CONFIGS,
        reference: 'https://github.com/qist/tvbox#readme', default: DEFAULT_CONFIG });
      if (path === '/api/config-state') return json(providers.configuration(url.searchParams.get('config')));
      if (path === '/api/feed') return json(await discovery.feed(url.searchParams.get('config'), {
        source: url.searchParams.get('source') || '', genre: url.searchParams.get('genre') || 'all',
        skip: url.searchParams.get('skip') || '',
        category: url.searchParams.get('category') || '', page: Math.max(1, Number(url.searchParams.get('page')) || 1)
      }, request.signal));
      if (path === '/api/search' || path === '/api/matches') {
        const title = (url.searchParams.get('title') || url.searchParams.get('q') || '').trim().slice(0,120);
        if (!title) throw new HttpError(400, '请输入影片名称。');
        return discovery.stream(url.searchParams.get('config'), title,
          path === '/api/matches' ? { title, year: url.searchParams.get('year'), type: url.searchParams.get('type') } : null,
          (url.searchParams.get('exclude') || '').split(',').filter(Boolean), request.signal, url.searchParams.get('only') || '',
          Math.max(1, Math.min(10000, Number(url.searchParams.get('page')) || 1)));
      }
      if (path.startsWith('/api/plugin-proxy/')) {
        const response = await providers.plugins.fetchProxy(url.href, { signal: request.signal });
        if (!response) throw new HttpError(404, '插件代理不存在。');
        return response;
      }
      if (path === '/api/categories')
        return json(await providers.getCategories(url.searchParams.get('source'), request.signal));
      if (path === '/api/catalog') {
        const page = Math.max(1, Math.min(10000, Number(url.searchParams.get('page')) || 1));
        const q = (url.searchParams.get('q') || '').slice(0, 120);
        return json(await providers.catalog(url.searchParams.get('source'), {
          page, q, category: url.searchParams.get('category') || ''
        }, request.signal));
      }
      if (path === '/api/detail')
        return json(await providers.detail(url.searchParams.get('source'), url.searchParams.get('id'), request.signal));
      if (path.startsWith('/api/media/'))
        return await playback.media(path.slice('/api/media/'.length), url.searchParams.get('u') || '',
          url.searchParams.get('s'), request.headers.get('range'), request.signal);
      throw new HttpError(404, '没有这个接口。');
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      const status = error.status || (error instanceof SyntaxError ? 400 : 502);
      return json({ error: error.status ? error.message :
        error instanceof SyntaxError ? '请求数据格式错误。' : '请求失败，请重试或更换源。' }, status);
    }
  };
  api.close = () => {providers.close();options.history?.close();};
  return api;
}
