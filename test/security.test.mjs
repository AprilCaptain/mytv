import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PluginBroker } from '../lib/plugins/broker.mjs';
import { IsolatedJavascriptSpider } from '../lib/plugins/js-isolated.mjs';
import { PythonSpider, pythonAvailable } from '../lib/plugins/python.mjs';
import { boundedLines } from '../lib/plugins/limits.mjs';
import { pinnedProxyClient,isPublicAddress,isLocalAddress,remoteFetch,sourceHeaders } from '../lib/network.mjs';
import { localRequestUrl } from '../lib/request-security.mjs';
import { createApi } from '../lib/api.mjs';
import { Playback } from '../lib/playback.mjs';
import { posterResponse } from '../lib/media-security.mjs';
import { PluginManager } from '../lib/plugins/manager.mjs';
import { mediaType } from '../lib/media-security.mjs';
import { cleanText } from '../lib/util.mjs';
const origin='http://127.0.0.1:3210';

test('代理 CONNECT 使用校验后的 IP，保留端口，拒绝私网重定向目标',async()=>{
 const calls=[];const resolve=async url=>{calls.push(url.href);return {address:'8.8.8.8',family:4};};
 let captured;
 const client=pinnedProxyClient(new URL('http://127.0.0.1:8888'),{},resolve,()=>({connect:async opts=>{captured=opts;return {socket:'mock'};}}));
 await client.connect({path:'video.example:443',headers:{host:'video.example:443','proxy-authorization':'test'}});
 assert.equal(captured.path,'8.8.8.8:443');assert.equal(captured.headers.host,'8.8.8.8:443');assert.equal(captured.headers['proxy-authorization'],'test');assert.equal(calls[0],'http://video.example:443/');
 const denied=pinnedProxyClient(new URL('http://127.0.0.1:8888'),{},async()=>{throw new Error('private target');},()=>({connect:()=>assert.fail('unsafe connection')}));
 await assert.rejects(denied.connect({path:'internal.example:80'}),/private target/);
});
test('SSRF 拒绝编码回环地址、IPv6 过渡地址与保留网段',async()=>{
 for(const ip of ['2002:7f00:1::','2001::1','2001:0000:abcd::1','2001:2::1','3fff::1','198.51.100.1','203.0.113.1','192.88.99.1'])assert.equal(isPublicAddress(ip),false,ip);
 for(const url of ['http://2130706433/','http://0x7f000001/','http://127.1/','http://[::ffff:7f00:1]/'])await assert.rejects(remoteFetch(url),/本机或局域网/);
 assert.equal(isPublicAddress('2001:4860:4860::8888'),true);
 const interfaces={en0:[{address:'8.8.8.8'},{address:'2001:4860:4860::8888'}]};
 assert.equal(isLocalAddress('::ffff:808:808',interfaces),true);
 assert.equal(isLocalAddress('2001:4860:4860:0:0:0:0:8888',interfaces),true);
 assert.equal(isLocalAddress('1.1.1.1',interfaces),false);
 const headers=sourceHeaders({Host:'localhost','X-Forwarded-For':'127.0.0.1','Proxy-Connection':'keep-alive',Referer:'https://video.example/'});
 assert.equal(headers.host,undefined);assert.equal(headers['x-forwarded-for'],undefined);assert.equal(headers['proxy-connection'],undefined);assert.equal(headers.referer,'https://video.example/');
});
test('畸形外部简介中的连续尖括号不会触发清洗正则的二次回溯',()=>{
 const input='<'.repeat(200_000),start=performance.now();assert.equal(cleanText(input),input);assert.ok(performance.now()-start<1000);
 assert.equal(cleanText('<p>正常 <b>简介</b></p>'),'正常 简介');
});
test('Host 正确也不能用绝对请求地址或反斜线绕过同源校验',()=>{
 for(const raw of ['https://evil.example/api/config','//evil.example/api/history','/\\evil.example/api/history'])assert.throws(()=>localRequestUrl(raw,'127.0.0.1:3210'),/Invalid/);
 assert.equal(localRequestUrl('/api/history?q=影片','127.0.0.1:3210').pathname,'/api/history');
});
test('签名媒体代理拒绝 JS、SVG、HTML、XML，二进制媒体不传播上游安全头',async()=>{
 for(const type of ['application/javascript','text/javascript','image/svg+xml','text/html','application/xhtml+xml','text/xml','application/json']){
  let cancelled=false;const player=new Playback(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':type}}));
  const link=new URL((await player.create('https://video.example/a.mp4')).url,origin);
  await assert.rejects(player.media(link.pathname.split('/').pop(),link.searchParams.get('u'),link.searchParams.get('s')),/没有返回可播放/);assert.equal(cancelled,true);
 }
 const player=new Playback(async()=>new Response(new Uint8Array([1,2]),{headers:{'content-type':'video/mp4','set-cookie':'owned=true','content-security-policy':"script-src * 'unsafe-inline'"}}));
 const link=new URL((await player.create('https://video.example/a.mp4')).url,origin),response=await player.media(link.pathname.split('/').pop(),link.searchParams.get('u'),link.searchParams.get('s'));
 assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('content-security-policy'),"default-src 'none'; sandbox");assert.equal(response.headers.get('x-content-type-options'),'nosniff');await response.body.cancel();
});
test('海报检查实际格式并限制体积，HTML/SVG 伪装成图片也会拒绝',async()=>{
 assert.equal(mediaType('image/png'),'application/octet-stream');assert.equal(mediaType('image/jpeg'),'application/octet-stream');assert.throws(()=>mediaType('image/svg+xml'),/没有返回可播放/);
 for(const content of ['<svg onload="alert(1)"></svg>','<html><script>alert(1)</script></html>'])await assert.rejects(posterResponse('https://image.example/a.jpg',async()=>new Response(content,{headers:{'content-type':'image/jpeg'}})),/海报格式/);
 const image=await posterResponse('https://image.example/a.jpg',async()=>new Response(Buffer.from([255,216,255,0]),{headers:{'content-type':'text/html'}}));
 assert.equal(image.headers.get('content-type'),'image/jpeg');assert.equal(image.headers.get('content-security-policy'),"default-src 'none'; sandbox");
 await assert.rejects(posterResponse('https://image.example/huge',async()=>new Response(new Uint8Array(5*1024*1024+1))),/数据过大/);
 await assert.rejects(posterResponse('http://127.0.0.1:9/a.jpg',remoteFetch),/本机或局域网/);
});
test('跨域 HLS 子资源保留播放所需 Referer，不携带 Cookie 或密钥',async()=>{
 const calls=[];const player=new Playback(async(url,options)=>{calls.push({url,headers:options.headers});return url.endsWith('.m3u8')?
  new Response('#EXTM3U\n#EXTINF:5,\nhttps://cdn.example/seg.ts\n'):
  new Response(new Uint8Array([1]),{headers:{'content-type':'video/mp2t'}});});
 const play=await player.create('https://video.example/main.m3u8',{Cookie:'private',Authorization:'Bearer secret','X-Api-Key':'secret',Referer:'https://source.example/'});
 const read=raw=>{const url=new URL(raw,origin);return player.media(url.pathname.split('/').pop(),url.searchParams.get('u'),url.searchParams.get('s'));};
 const text=await(await read(play.url)).text(),child=text.split('\n').find(line=>line.startsWith('/api/media/'));
 await(await read(child)).body.cancel();assert.equal(calls[0].headers.cookie,'private');
 assert.equal(calls[1].headers.cookie,undefined);assert.equal(calls[1].headers.authorization,undefined);assert.equal(calls[1].headers['x-api-key'],undefined);assert.equal(calls[1].headers.referer,'https://source.example/');
});
test('插件原始代理不可由浏览器直接访问，跨站海报请求也不转发',async t=>{
 let fetched=false;const api=createApi(async()=>{fetched=true;return new Response('unused');});t.after(()=>api.close());
 assert.equal((await api(new Request(origin+'/api/plugin-proxy/abc?token=madeup'))).status,403);
 assert.equal((await api(new Request(origin+'/api/poster?url=https://image.example/a.jpg',{headers:{'sec-fetch-site':'cross-site'}}))).status,403);assert.equal(fetched,false);
});
test('JS 插件不能取得 Node 全局对象，动态 node:fs 导入被拒绝',async t=>{
 const code='export default {inspect(){return {process:typeof process,require:typeof require,host:typeof __request.constructor("return this")().process}},async read(){return await import("node:fs")}}';
 const spider=await IsolatedJavascriptSpider.create({api:'https://plugin.example/a.js'},new PluginBroker(async()=>new Response(code)),origin+'/api/plugin-proxy/test?token=x');t.after(()=>spider.close());
 assert.deepEqual(await spider.call('inspect',[]),{process:'undefined',require:'undefined',host:'undefined'});await assert.rejects(spider.call('read',[]));
});
test('JS 插件网络洪泛受并发限制，不会发出所有远程请求',async t=>{
 let calls=0;const code='export default {async search(){return await Promise.all(Array.from({length:20},()=>req("https://data.example/a")))}}';
 const spider=await IsolatedJavascriptSpider.create({api:'https://plugin.example/a.js'},new PluginBroker(async url=>{
  if(url.endsWith('.js'))return new Response(code);calls++;await new Promise(r=>setTimeout(r,20));return new Response('ok');
 }),origin+'/api/plugin-proxy/test?token=x');t.after(()=>spider.close());
 await assert.rejects(spider.call('search',[]),/频繁/);assert.ok(calls<=4);
});
test('Python 通信不允许无换行的无限输出；正常多行和分块不会误报',async()=>{
 const wire=boundedLines(8);wire.resume();wire.write(Buffer.from('1234'));const error=once(wire,'error');wire.end(Buffer.from('56789'));assert.match((await error)[0].message,/大小限制/);
 const normal=boundedLines(8),chunks=[];normal.on('data',c=>chunks.push(c));normal.write(Buffer.from('12345678\n1'));normal.end(Buffer.from('23\n'));await once(normal,'end');assert.equal(Buffer.concat(chunks).toString(),'12345678\n123\n');
});
test('Python 收紧隔离后仍可导入依赖，拒绝宽目录和执行任意本机命令',{skip:!pythonAvailable()},async t=>{
 const code='from base.spider import Spider\nimport os,subprocess,requests,resource\nclass Spider(Spider):\n def inspect(self):\n  result={}\n  for path in ["/private/var/db/ConfigurationProfiles","/opt/homebrew/etc","/dev/zero"]:\n   try:\n    os.listdir(path) if path!="/dev/zero" else open(path,"rb").read(1)\n    result[path]=True\n   except OSError:\n    result[path]=False\n  try:\n   subprocess.run(["/usr/bin/true"],check=True)\n   result["exec"]=True\n  except (OSError,subprocess.CalledProcessError):\n   result["exec"]=False\n  result["cpu_hard"]=resource.getrlimit(resource.RLIMIT_CPU)[1]\n  result["nproc_hard"]=resource.getrlimit(resource.RLIMIT_NPROC)[1]\n  return result\n';
 const spider=await PythonSpider.create({api:'https://plugin.example/a.py'},new PluginBroker(async()=>new Response(code)),origin+'/api/plugin-proxy/test?token=x');t.after(()=>spider.close());
 const result=await spider.call('inspect',[]);assert.deepEqual(result,{'/private/var/db/ConfigurationProfiles':false,'/opt/homebrew/etc':false,'/dev/zero':false,exec:false,cpu_hard:90,nproc_hard:0});
});
test('恶意 Python 的 null 通信帧只释放插件，不触发主进程未处理异常',{skip:!pythonAvailable()},async t=>{
 const code='from base.spider import Spider\nimport __main__\nclass Spider(Spider):\n def searchContent(self,*args):\n  __main__.wire_out.write("null\\n")\n  __main__.wire_out.flush()\n  return {}\n';
 const spider=await PythonSpider.create({api:'https://plugin.example/a.py'},new PluginBroker(async()=>new Response(code)),origin+'/api/plugin-proxy/test?token=x');t.after(()=>spider.close());await assert.rejects(spider.call('searchContent',[]),/格式错误/);
});
test('可显式关闭脚本片源；HTTP 源仍能正常导入',async t=>{
 const previous=process.env.MYTV_DISABLE_PLUGINS;process.env.MYTV_DISABLE_PLUGINS='1';t.after(()=>{if(previous===undefined)delete process.env.MYTV_DISABLE_PLUGINS;else process.env.MYTV_DISABLE_PLUGINS=previous;});
 const manager=new PluginManager(async()=>new Response(''),'http://127.0.0.1:3210');t.after(()=>manager.close());assert.equal(manager.capability('js'),false);assert.equal(manager.capability('python'),false);
 const api=createApi(async()=>Response.json({sites:[{key:'http',name:'点播',type:1,api:'https://source.example/vod'},{key:'js',name:'脚本',type:3,api:'https://source.example/a.js'}]}));t.after(()=>api.close());
 const response=await api(new Request(origin+'/api/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:'https://config.example/a.json'})}));const data=await response.json();assert.equal(data.sources[0].supported,true);assert.equal(data.sources[1].supported,false);
});
