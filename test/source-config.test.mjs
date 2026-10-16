import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSourceConfig } from '../lib/source-config.mjs';
import { Providers, DEFAULT_CONFIG } from '../lib/providers.mjs';
import { SELECTED_CONFIG_URL,WEB_CONFIG_URL,LIBRARY_CONFIG_URL, BUILTIN_CONFIGS } from '../lib/configs.mjs';

test('MoonTV api_site 转换为独立 HTTP 片源并去重、跳过禁用项', () => {
  const result = normalizeSourceConfig({ api_site: {
    a: { name: 'A', api: './vod', searchable: 0 },
    b: { name: '重复', api: './vod' },
    c: { name: '禁用', api: 'https://other.example/vod', disabled: true },
    d: { name: 'Spider', api: 'csp_Test' },
    e: null
  } }, 'https://config.example/data.json');
  // Non-HTTP Spider names must not become relative HTTP endpoints.
  assert.equal(result.sites.length, 1);
  assert.equal(result.sites[0].api, 'https://config.example/vod');
  assert.equal(result.sites[0].searchable, 0);
  assert.throws(() => normalizeSourceConfig({ api_site: { a: { api: 'csp_Test' } } }, 'https://config.example/'), /没有可导入/);
});

test('LibreTV sources 和数组配置保持请求头、名称及相对地址', () => {
  const sources = [{ name: '测试', url: '../vod', header: { Referer: 'https://site.example/' } },
    { url: 'file:///etc/passwd' }, { url: '' }];
  const result = normalizeSourceConfig({ sources }, 'https://config.example/dir/list.json');
  assert.equal(result.sites.length, 1);
  assert.equal(result.sites[0].api, 'https://config.example/vod');
  assert.equal(result.sites[0].header.Referer, 'https://site.example/');
  assert.deepEqual(normalizeSourceConfig(sources, 'https://config.example/dir/list.json').sites, result.sites);
});

test('TVBox 与直接点播 list 结构保持原意，跨平台列表仍有数量限制', () => {
  const native = { sites: [{ key: 'python', type: 3, api: './source.py' }] };
  const direct = { list: [{ vod_id: '1', vod_name: '影片' }] };
  assert.equal(normalizeSourceConfig(native, 'https://example.com/'), native);
  assert.equal(normalizeSourceConfig(direct, 'https://example.com/'), direct);
  assert.throws(() => normalizeSourceConfig({ sources: Array(1001).fill({}) }, 'https://example.com/'), /过多/);
});

test('精选配置直接读取项目内文件，不访问 GitHub，不改变原默认配置', async t => {
  const providers = new Providers(() => { throw new Error('不应下载内置配置'); });
  t.after(() => providers.close());
  const config = await providers.importConfig(SELECTED_CONFIG_URL);
  assert.equal(config.sources.length, 21);
  assert.equal(config.checkedAt, '2026-10-16');
  assert.equal(providers.eligible(config.id, true).length, 21);
  assert.ok(config.sources.every(s => s.kind === 'http'));
  assert.equal(BUILTIN_CONFIGS.find(c => c.default).url, DEFAULT_CONFIG);
});

test('综合片库离线合并 HTTP 与网页片源，键和接口无重复，所有来源可被搜索',async t=>{
 const p=new Providers(()=>assert.fail('内置合集不能下载远程文件'));t.after(()=>p.close());
 const [combined,http,web]=await Promise.all([p.importConfig(LIBRARY_CONFIG_URL),p.importConfig(SELECTED_CONFIG_URL),p.importConfig(WEB_CONFIG_URL)]);
 assert.equal(combined.sources.length,http.sources.length+web.sources.length);
 assert.deepEqual(new Set(combined.sources.map(s=>s.api)),new Set([...http.sources,...web.sources].map(s=>s.api)));
 assert.equal(new Set(combined.sources.map(s=>s.key)).size,combined.sources.length);
 assert.equal(p.eligible(combined.id,true).length,combined.sources.length);
});

test('直连精选只展示实际媒体选集，外部配置默认保留解析线路',async t=>{
 for(const directOnly of [true,false]){
  const p=new Providers(async raw=>new URL(raw).pathname==='/config.json'?Response.json({sites:[{key:'s',name:'片源',type:1,api:'https://source.example/vod',directOnly}]}):Response.json({list:[{vod_id:'1',vod_name:'样本',vod_play_from:'网页$$$直连',vod_play_url:'正片$https://source.example/play.html$$$第01集$https://cdn.example/1.m3u8#第02集$https://source.example/missing.html#第03集$https://cdn.example/3.m3u8'}]}));t.after(()=>p.close());
  const c=await p.importConfig('https://config.example/config.json'),d=await p.detail(c.sources[0].id,'1');
  assert.equal(d.lines.length,directOnly?1:2);
  assert.deepEqual(d.lines.at(-1).episodes.map(e=>e.name),directOnly?['第01集','第03集']:['第01集','第02集','第03集']);
  if(directOnly)assert.equal((await p.resolve(c.sources[0].id,'1',0,0)).url,'https://cdn.example/1.m3u8');
 }
});

test('远程 MoonTV 与 LibreTV 列表通过项目读取、搜索、详情和播放流程', async t => {
  for (const shape of ['moon', 'libre']) {
    const providers = new Providers(async raw => {
      const url = new URL(raw);
      if (url.pathname === '/config.json') return Response.json(shape === 'moon' ?
        { api_site: { a: { name: '测试源', api: '/vod' } } } :
        { sources: [{ name: '测试源', url: '/vod' }] });
      assert.equal(url.pathname, '/vod');
      if (url.searchParams.get('ac') === 'list' && !url.searchParams.has('wd'))
        return Response.json({ class: [{ type_id: '2', type_name: '电视剧' }], list: [] });
      return Response.json({ page: 1, pagecount: 1, list: [{ vod_id: '1', vod_name: '测试片',
        vod_play_from: '高清', vod_play_url: '第1集$https://media.example/video.m3u8' }] });
    });
    t.after(() => providers.close());
    const config = await providers.importConfig('https://config.example/config.json');
    const id = config.sources[0].id;
    assert.equal((await providers.getCategories(id))[0].name, '电视剧');
    assert.equal((await providers.catalog(id, { q: '测试片' })).list[0].title, '测试片');
    assert.equal((await providers.detail(id, '1')).lines[0].episodes.length, 1);
    assert.equal((await providers.resolve(id, '1', 0, 0)).url, 'https://media.example/video.m3u8');
  }
});
