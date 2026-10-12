import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { decodeConfig, readConfiguration } from '../lib/config-reader.mjs';
import { Providers } from '../lib/providers.mjs';
import { createApi } from '../lib/api.mjs';
import { remoteFetch } from '../lib/network.mjs';

const value={sites:[{key:'one',name:'测试片源',type:1,api:'./api'}]};
const base64=text=>'TVBOX123**'+Buffer.from(text).toString('base64');
function cbc(text) {
  const key='TestKey',iv='AbcDef0123456';
  const cipher=createCipheriv('aes-128-cbc',Buffer.from(key.toLowerCase().padEnd(16,'0')),Buffer.from(iv.toLowerCase().padEnd(16,'0')));
  return Buffer.concat([Buffer.from('$#'+key+'#$'),cipher.update(text),cipher.final(),Buffer.from(iv)]).toString('hex');
}

test('明文 JSON5、BOM、XML 和包含 ** 的 JSON 字符串不会被误解码',()=>{
  assert.deepEqual(decodeConfig('\uFEFF'+JSON.stringify(value)).value,value);
  assert.equal(decodeConfig('{/*comment*/ sites:[], note:"literal**text",}').value.note,'literal**text');
  assert.equal(decodeConfig('<rss><list/></rss>').format,'xml');
});

test('支持 TVBox 标记 Base64、2423 AES-CBC 和组合编码配置',()=>{
  const text=JSON.stringify(value);
  assert.deepEqual(decodeConfig(base64(text).replace(/(.{60})/g,'$1\n')).value,value);
  const encrypted=cbc(text);
  assert.deepEqual(decodeConfig(encrypted).value,value);
  const wrapped=decodeConfig(JSON.stringify(base64(encrypted)));
  assert.deepEqual(wrapped.value,value);assert.deepEqual(wrapped.encodings,['json-string','base64','aes-cbc']);
  assert.throws(()=>decodeConfig('TVBOX123**bad%payload'),/无法解码/);
  assert.throws(()=>decodeConfig('2423ffff'),/无法解码/);
});

test('使用最终 HTTP 地址解析相对 API、ext 和解析器，同时保留用户导入地址',async t=>{
  const requested='https://entry.example/tv';
  const providers=new Providers(async()=>{
    const r=Response.json({sites:[{key:'js',name:'JS',type:3,api:'./main.js',ext:'../rules/site.js'}],parses:[{type:1,url:'./parse?url='}]});
    Object.defineProperty(r,'url',{value:'https://cdn.example/dir/config.json'});return r;
  });t.after(()=>providers.close());
  const config=await providers.importConfig(requested);
  assert.equal(config.url,requested);assert.equal(config.effectiveUrl,'https://cdn.example/dir/config.json');
  const source=providers.source(config.sources[0].id);
  assert.equal(source.api,'https://cdn.example/dir/main.js');assert.equal(source.ext,'https://cdn.example/rules/site.js');
  assert.equal(source.parsers[0].url,'https://cdn.example/dir/parse?url=');
});

test('只识别静态 HTML 跳转，不执行网页脚本',async()=>{
  const calls=[];
  const r=await readConfiguration('https://config.example/start',async url=>{
    calls.push(url);
    if(url.endsWith('/start'))return new Response('<html><meta http-equiv="refresh" content="0; url=./next"><body></body></html>');
    if(url.endsWith('/next'))return new Response('<html><script>globalThis.configReaderExecuted=true; window.location.replace("./data/config.txt");</script></html>');
    return new Response(base64(JSON.stringify(value)),{headers:{'content-type':'text/html'}});
  });
  assert.deepEqual(calls,['https://config.example/start','https://config.example/next','https://config.example/data/config.txt']);
  assert.deepEqual(r.value,value);assert.equal(globalThis.configReaderExecuted,undefined);
});

test('HTML 中独立的 JSON 数据块可导入，普通页面、广告停放与验证页分别报错',async()=>{
  const load=text=>readConfiguration('https://config.example/',async()=>new Response(text));
  assert.deepEqual((await load('<html><script type="application/json">'+JSON.stringify(value)+'</script></html>')).value,value);
  await assert.rejects(load('<html><title>Redirecting...</title><script src="https://router.parklogic.com/ad.js"></script></html>'),/域名停放/);
  await assert.rejects(load('<html><title>拒绝访问</title><body>请登录</body></html>'),/访问限制/);
  await assert.rejects(load('<html><title>普通网站</title></html>'),/HTML 网页/);
});

test('HTTP 拒绝与域名解析失败不会误报为 JSON 格式错误',async()=>{
  await assert.rejects(readConfiguration('https://config.example/',async()=>new Response('<html>deny</html>',{status:401})),/HTTP 401/);
  await assert.rejects(readConfiguration('https://config.example/',async()=>new Response('missing',{status:404})),/不存在或已迁移/);
  await assert.rejects(readConfiguration('https://config.example/',async()=>{throw Object.assign(new Error('dns'),{code:'ENOTFOUND'});}),/无法解析配置域名/);
});

test('静态跳转受次数限制，不允许文件地址或局域网目标',async()=>{
  let calls=0;
  await assert.rejects(readConfiguration('https://config.example/',async()=>{calls++;return new Response('<html><script>location="./";</script></html>');}),/循环/);
  assert.equal(calls,1);
  calls=0;
  await assert.rejects(readConfiguration('https://config.example/',async()=>new Response('<html><script>location="https://config.example/'+(++calls)+'";</script></html>')),/次数过多/);
  assert.equal(calls,5);
  await assert.rejects(readConfiguration('https://config.example/',async()=>new Response('<html><meta http-equiv="refresh" content="0; url=file:///etc/passwd"></html>')),/HTTP/);
  await assert.rejects(readConfiguration('https://config.example/',async url=>url==='https://config.example/'?
    new Response('<html><script>location="http://127.0.0.1:9/";</script></html>'):remoteFetch(url)),/局域网/);
});

test('编码配置可以成功读取，全部 Android 源则明确提示播放兼容限制',async t=>{
  const api=createApi(async()=>new Response(base64(JSON.stringify({sites:[{key:'jar',name:'4K源',type:3,api:'csp_Test'}]}))));
  t.after(()=>api.close());
  const imported=await api(new Request('http://127.0.0.1:3210/api/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:'https://config.example/'})}));
  assert.equal(imported.status,200);const config=await imported.json();assert.equal(config.supported,0);
  const feed=await api(new Request('http://127.0.0.1:3210/api/feed?config='+config.id));
  assert.equal(feed.status,422);assert.match((await feed.json()).error,/配置已成功读取.*Android JAR/);
});

test('禁止换源不等于禁止点播，仍按 searchable 与直播标记筛选',async t=>{
  const providers=new Providers(async()=>Response.json({sites:[
    {key:'children',name:'儿童启蒙',type:3,api:'./main.js',changeable:0,searchable:0},
    {key:'live',name:'虎牙直播',type:3,api:'./main.js',changeable:0,searchable:1}
  ]}));t.after(()=>providers.close());
  const config=await providers.importConfig('https://config.example/list.json');
  assert.equal(config.sources[0].playable,true);assert.equal(config.sources[1].playable,false);
  assert.equal(providers.eligible(config.id).length,1);assert.equal(providers.eligible(config.id,true).length,0);
});
