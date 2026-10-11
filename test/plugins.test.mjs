import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PluginBroker } from '../lib/plugins/broker.mjs';
import { IsolatedJavascriptSpider } from '../lib/plugins/js-isolated.mjs';
import { PythonSpider, pythonAvailable } from '../lib/plugins/python.mjs';
import { createApi } from '../lib/api.mjs';
import { matchesFilm, normalizedTitle, qualityRank, episodeKey } from '../lib/matching.mjs';

const origin='http://127.0.0.1:3210';
const movie={vod_id:'one',vod_name:'兰香如故',vod_year:'2026',type_name:'国产剧',
  vod_play_from:'1080p$$$4K原画',vod_play_url:'第01集$https://media.example/1.m3u8#第02集$https://media.example/2.m3u8$$$第1集$https://media.example/4k1.m3u8#第2集$https://media.example/4k2.m3u8'};
const jsCode='export default {init(ext){this.ext=ext},home(){return JSON.stringify({class:[{type_id:"tv",type_name:"剧集"}]})},'+
  'search(q){const r=req("https://data.example/search",{method:"POST",json:{q}});return JSON.stringify({list:[JSON.parse(r.content)]})},'+
  'detail(id){return JSON.stringify({list:['+JSON.stringify({...movie,vod_id:'rewritten'})+']})},'+
  'play(flag,id){return {parse:0,url:id,header:{Referer:"https://js.example/"}}}}';

test('同名不同年份、不同季数与电影/电视剧不混入同片候选',()=>{
  const target={title:'兰香如故',year:'2026',type:'国产剧'};
  assert.equal(matchesFilm({title:'兰香如故',year:'2025',type:'国产剧'},target),false);
  assert.equal(matchesFilm({title:'兰香如故',year:'2026',type:'剧情片'},target),false);
  assert.equal(matchesFilm({title:'兰香如故第二季',year:'2026',type:'国产剧'},target),false);
  assert.equal(matchesFilm({title:'兰香如故 (4K)',year:'2026',type:'国产剧'},target),true);
  assert.equal(normalizedTitle(' 动画·第二季 '),'动画第二季');
  assert.equal(episodeKey('第02集'),episodeKey('第2集'));
  assert.ok(qualityRank('4K超清')>qualityRank('1080p'));
});

test('JS 插件按需载入并通过受控请求桥支持搜索和播放解析',async t=>{
  const calls=[];
  const broker=new PluginBroker(async(url,options={})=>{
    calls.push({url,options});
    return url.endsWith('.js')?new Response(jsCode):Response.json(movie);
  });
  const spider=await IsolatedJavascriptSpider.create({api:'https://js.example/main.js',ext:{mode:'test'}},broker,origin+'/api/plugin-proxy/test?token=x');
  t.after(()=>spider.close());
  assert.equal((await spider.call('home',[true])).class[0].type_name,'剧集');
  assert.equal((await spider.call('search',['兰香如故',false,'1'])).list[0].vod_name,'兰香如故');
  assert.equal(calls.at(-1).options.method,'POST');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body),{q:'兰香如故'});
  assert.equal((await spider.call('play',['4K原画','https://media.example/4k1.m3u8',[]])).url,'https://media.example/4k1.m3u8');
});

test('异步 JS 插件连续 await 请求不会阻塞或损坏同步插件运行环境',async t=>{
  const code='export default {async search(q){const a=await req("https://data.example/a",{});const b=await req("https://data.example/b",{});return {list:[{vod_id:q,vod_name:a.content+b.content}]}}}';
  const spider=await IsolatedJavascriptSpider.create({api:'https://js.example/async.js',ext:''},
    new PluginBroker(async url=>new Response(url.endsWith('.js')?code:url.endsWith('/a')?'A':'B')),origin+'/api/plugin-proxy/test?token=x');
  t.after(()=>spider.close());
  assert.equal((await spider.call('search',['片名',false,'1'])).list[0].vod_name,'AB');
});

test('失控 JS 插件受到 CPU 限制，随后能关闭独立运行环境',async t=>{
  const spider=await IsolatedJavascriptSpider.create({api:'https://js.example/loop.js',ext:''},
    new PluginBroker(async()=>new Response('export default {search(){while(true){}}}')),origin+'/api/plugin-proxy/test?token=x');
  t.after(()=>spider.close());
  const started=Date.now();
  await assert.rejects(spider.call('search',['x',false,'1']),/interrupted|取消|超时/);
  assert.ok(Date.now()-started<5000);
});

test('Python Spider 支持 requests 与 base.spider；阻止读取用户文件和直接联网',
  {skip:!pythonAvailable()},async t=>{
    const path=fileURLToPath(new URL('../README.md',import.meta.url));
    const code='from base.spider import Spider\nimport requests,socket\nclass Spider(Spider):\n'+
      ' def searchContent(self,key,quick,pg="1"):\n'+
      '  allowed=False\n  try:\n   open('+JSON.stringify(path)+').read()\n   allowed=True\n  except PermissionError:\n   pass\n'+
      '  network=False\n  try:\n   socket.create_connection(("127.0.0.1",9),timeout=1)\n   network=True\n  except OSError:\n   pass\n'+
      '  result=requests.post("https://data.example/search",json={"q":key}).json()\n'+
      '  return {"list":[result],"file_allowed":allowed,"direct_network_allowed":network}\n';
    const calls=[];
    const broker=new PluginBroker(async(url,options={})=>{
      calls.push({url,options});return url.endsWith('.py')?new Response(code):Response.json(movie);
    });
    const spider=await PythonSpider.create({id:'python',api:'https://py.example/test.py',ext:''},broker,origin+'/api/plugin-proxy/python?token=x');
    t.after(()=>spider.close());
    const result=await spider.call('searchContent',['兰香如故',false,'1']);
    assert.equal(result.list[0].vod_name,'兰香如故');
    assert.equal(result.file_allowed,false);assert.equal(result.direct_network_allowed,false);
    assert.equal(calls.at(-1).options.method,'POST');
    assert.deepEqual(JSON.parse(calls.at(-1).options.body),{q:'兰香如故'});
});

test('配置范围隔离，流式搜索继续查找后排源，匹配严格核对版本',async t=>{
  const providerCalls=[];
  const fetcher=async(url,options={})=>{
    const u=new URL(url);providerCalls.push({u,options});
    if(u.pathname.endsWith('a.json'))return new Response('{//允许配置注释\nsites:[{key:"first",name:"普通源",type:1,api:"https://http.example/empty"},{key:"second",name:"JS源",type:3,api:"https://js.example/main.js"}],}');
    if(u.pathname.endsWith('b.json'))return Response.json({sites:[{key:'other',name:'另一个配置源',type:1,api:'https://other.example/api'}]});
    if(u.pathname.endsWith('.js'))return new Response(jsCode);
    if(u.hostname==='data.example')return Response.json(movie);
    if(u.hostname==='http.example')return Response.json({list:[{...movie,vod_id:'unrelated',vod_name:'完全无关影片'}],class:[]});
    return Response.json({list:[],class:[]});
  };
  const api=createApi(fetcher);t.after(()=>api.close());
  const call=(path,body)=>api(new Request(origin+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}));
  const a=await(await call('/api/config',{url:'https://config.example/a.json'})).json();
  const b=await(await call('/api/config',{url:'https://config.example/b.json'})).json();
  const events=(await(await call('/api/search?'+new URLSearchParams({config:a.id,q:'兰香如故'}))).text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).type,'done');
  assert.equal(events.find(e=>e.type==='results'&&e.sourceName==='JS源').list[0].title,'兰香如故');
  assert.equal(events.find(e=>e.type==='results'&&e.sourceName==='普通源').list.length,0);
  assert.equal(providerCalls.some(c=>c.u.hostname==='other.example'),false);
  const wrongYear=(await(await call('/api/matches?'+new URLSearchParams({config:a.id,title:'兰香如故',year:'2025',type:'国产剧'}))).text()).trim().split('\n').map(JSON.parse);
  assert.equal(wrongYear.filter(e=>e.type==='results').flatMap(e=>e.list).length,0);
  const sid=a.sources.find(s=>s.kind==='js').id;
  const detail=await(await call('/api/detail?source='+sid+'&id=original-id')).json();
  assert.equal(detail.id,'original-id');
  const denied=await call('/api/play',{config:b.id,source:sid,id:'original-id',line:1,episode:0});
  assert.equal(denied.status,400);
});

test('取消流式跨源搜索会把取消信号传给上游请求',async t=>{
  let aborted=false;
  const fetcher=async(url,options={})=>{
    if(url.endsWith('config.json'))return Response.json({sites:[{key:'one',name:'测试',type:1,api:'https://slow.example/api'}]});
    return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(options.signal.reason);},{once:true}));
  };
  const api=createApi(fetcher);t.after(()=>api.close());
  const config=await(await api(new Request(origin+'/api/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:'https://config.example/config.json'})}))).json();
  const response=await api(new Request(origin+'/api/search?'+new URLSearchParams({config:config.id,q:'测试'})));
  const reader=response.body.getReader();await reader.read();await reader.cancel();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(aborted,true);
});

test('脚本请求桥正确解码 GBK 页面，避免中文片名乱码',async()=>{
  const broker=new PluginBroker(async()=>new Response(Buffer.from('c0bccfe3c8e7b9ca','hex'),
    {headers:{'content-type':'text/html; charset=gb2312'}}));
  assert.equal((await broker.request('https://legacy.example/search')).content,'兰香如故');
});

test('Python 本地代理通过内部桥转发 HLS，子资源继续使用同一播放请求头',
  {skip:!pythonAvailable()},async t=>{
    const code='from base.spider import Spider\nfrom urllib.parse import quote\nclass Spider(Spider):\n'+
      ' def detailContent(self,ids):\n  return {"list":[{"vod_id":ids[0],"vod_name":"测试剧","vod_play_from":"高清","vod_play_url":"第01集$opaque-id"}]}\n'+
      ' def playerContent(self,flag,id,vipFlags):\n  return {"url":self.getProxyUrl()+"&type=m3u8&url="+quote("https://media.example/folder/main.m3u8"),"header":{"Referer":"https://source.example/"}}\n'+
      ' def localProxy(self,params):\n  return self.proxyM3u8(params)\n';
    const calls=[];
    const fetcher=async(url,options={})=>{
      calls.push({url,options});
      if(url.endsWith('config.json'))return Response.json({sites:[{key:'py',name:'Python测试',type:3,api:'https://py.example/test.py'}]});
      if(url.endsWith('.py'))return new Response(code);
      if(url.endsWith('.m3u8'))return new Response('#EXTM3U\n#EXTINF:3,\nsegment.ts\n#EXT-X-ENDLIST\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
      return new Response(new Uint8Array([47,48,49]),{headers:{'content-type':'video/mp2t'}});
    };
    const api=createApi(fetcher);t.after(()=>api.close());
    const call=(path,body)=>api(new Request(origin+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}));
    const c=await(await call('/api/config',{url:'https://config.example/config.json'})).json();
    const p=await(await call('/api/play',{config:c.id,source:c.sources[0].id,id:'one',line:0,episode:0})).json();
    assert.equal(p.format,'hls');
    const text=await(await call(p.url)).text();
    const child=text.split('\n').find(line=>line.startsWith('/api/media/'));
    const response=await call(child);assert.equal(response.status,200);
    assert.equal(calls.at(-1).url,'https://media.example/folder/segment.ts');
    assert.equal(calls.at(-1).options.headers.referer,'https://source.example/');
    await response.body.cancel();
});
