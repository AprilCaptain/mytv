import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createCipheriv} from 'node:crypto';
import {Providers,parseLines} from '../lib/providers.mjs';
import {WEB_CONFIG_URL,BUILTIN_CONFIGS} from '../lib/configs.mjs';
import {WebsiteContext,playerData,dataAssignment,makeLines} from '../lib/websites/common.mjs';
import {listPage as hdList,detailPage as hdDetail,decodeMediaAddress} from '../lib/websites/hdmoli.mjs';
import {WebSources} from '../lib/web-sources.mjs';
import {guestHeaders,guestMedia} from '../lib/websites/jinpai.mjs';
const base='https://website.example';
const hdHtml=`<title>样本 - HDmoli</title><div class="myui-content__detail"><h1 class="title">样本<font>全集</font></h1><p class="data">分类：剧情地区：大陆语言：国语年份：2024 又名：其它名字</p></div><div class="myui-content__thumb"><img data-original="/a.jpg"></div><ul class="nav-tabs"><li><a href="#playlist1">4K蓝光</a></li><li><a href="#playlist2">夸克网盘</a></li></ul><div id="playlist1"><div class="myui-content__list"><a href="/play/1-7-1.html">1080P</a><a href="/play/1-7-2.html">2160P</a></div></div><div id="playlist2"><a href="/play/1-8-1.html">合集</a></div>`;
const a123Root=`<title>《样本》 - 国产剧 - 2024年 - A123TV</title><h1>样本</h1><div class="w4-player" data-src="https://media.example/main.m3u8" data-poster="/poster.jpg"></div><div class="w4-episode-list"><a href="/v/sample/a1z0.html" title="第01集">1</a><a href="/v/sample/a1z2.html" title="第03集">3</a></div><a class="w4-line-item" href="/v/sample/a1z0.html" title="高清"><div class="w4-line-cover"><div class="i">1080p</div></div></a><script>var pp={"no":"sample","ld":"a1","la":[["a1","高清",3,0,"https://media.example/main.m3u8"],["a2","重复",3,0,"https://media.example/main.m3u8"]]};</script>`;

test('网页配置离线载入，适配器是受控注册项，原默认配置保持',async t=>{
 const p=new Providers(()=>assert.fail('内置配置不应访问网络'));t.after(()=>p.close());const c=await p.importConfig(WEB_CONFIG_URL);
 assert.equal(c.sources.length,4);assert.ok(c.sources.every(s=>s.kind==='web'&&s.supported));assert.equal(BUILTIN_CONFIGS.find(c=>c.default).name,'电视');
 const web=new WebSources(()=>assert.fail());assert.equal(web.capability('__proto__'),false);assert.equal(web.capability('constructor'),false);
 await assert.rejects(web.call({adapter:'https://evil.example/code.js'},'home',[]),/不受支持/);
});
test('播放数据仅按 JSON 读取，花括号和转义字符串不破坏解析，不执行页面脚本',()=>{
 const data={url:'https://media.example/a.m3u8?x={a}',text:'quote" slash\\'};
 assert.deepEqual(playerData('<script>var player_aaaa='+JSON.stringify(data)+';globalThis.pwned=1;</script>'),data);
 assert.equal(globalThis.pwned,undefined);assert.throws(()=>dataAssignment('<script>var pp=(process.exit(1));</script>','pp'),/没有可读取/);
 assert.throws(()=>playerData('<script>var player_x={url:(()=>"x")()};</script>'),/无法读取/);
});
test('网页请求拒绝跨站影片 ID，取消请求会传递给网络层',async()=>{
 let called=false;const ctx=new WebsiteContext({api:base,headers:{}},async(_url,options)=>{called=true;assert.ok(options.signal.aborted);throw options.signal.reason;});
 await assert.rejects(ctx.read('http://127.0.0.1/private'),/超出/);assert.equal(called,false);
 const controller=new AbortController();controller.abort();await assert.rejects(ctx.read('/page',controller.signal));assert.equal(called,false);
 const web=new WebSources(()=>assert.fail('无效 ID 不应发起请求'));
 await assert.rejects(web.call({adapter:'hdmoli',api:base},'detailContent',[['https://evil.example/movie/index1.html']]),/不属于/);
});
test('HDmoli 搜索提取真实年份分类，详情排除网盘并优先电影高画质版本',()=>{
 const html='<ul class="myui-vodlist__media"><li><a href="/movie/index1.html" title="样本" data-original="/pic.jpg"></a><div class="detail"><p>分类：剧情地区：大陆年份：2024</p></div></li></ul>';
 const list=hdList(html,base).list;assert.equal(list[0].vod_year,'2024');assert.equal(list[0].type_name,'剧情片');
 const detail=hdDetail(hdHtml,base,'/movie/index1.html').list[0];assert.equal(detail.vod_year,'2024');assert.equal(detail.type_name,'剧情片');
 const lines=parseLines(detail);assert.equal(lines.length,1);assert.equal(lines[0].key,'7');assert.equal(lines[0].episodes[0].name,'2160P');assert.ok(!detail.vod_play_from.includes('网盘'));
});
test('剧集按真实集名升序排列，番外仍保留，不伪造缺失集数',()=>{
 const lines=makeLines([{name:'蓝光',episodes:[{name:'番外',url:base+'/play/1-3-4.html'},{name:'3',url:base+'/play/1-3-3.html'},{name:'1',url:base+'/play/1-3-1.html'}]}],'国产剧');
 assert.deepEqual(lines[0].episodes.map(e=>e.name),['第01集','第03集','番外']);
});
test('HDmoli 播放接口的 URL 包装在本机解码，媒体密钥不来自用户文件',()=>{
 const stamp='1792124160',url='https://media.example/a.mp4?token=test',digest=createHash('md5').update(stamp+'RY7e48naFXPsLJC').digest('hex');
 const aes=createCipheriv('aes-128-cbc',Buffer.from(digest.slice(16)),Buffer.from(digest.slice(0,16)));const cipher=Buffer.concat([aes.update(url),aes.final()]).toString('base64');
 assert.equal(decodeMediaAddress(cipher,stamp),url);assert.throws(()=>decodeMediaAddress(cipher,'wrong'),/已变化/);
});
test('HDmoli 完整播放路径只请求明确的站内页面与播放服务，外域不携带源凭证',async()=>{
 const requests=[],stamp='1792124160',url='https://cdn.example/a.mp4',digest=createHash('md5').update(stamp+'RY7e48naFXPsLJC').digest('hex'),aes=createCipheriv('aes-128-cbc',Buffer.from(digest.slice(16)),Buffer.from(digest.slice(0,16)));
 const cipher=Buffer.concat([aes.update(url),aes.final()]).toString('base64');
 const fetcher=async(raw,options)=>{requests.push({raw,options});const u=new URL(raw);
  if(u.hostname==='cdn.example')return new Response(new Uint8Array([1,2]),{headers:{'content-type':'video/mp4'}});
  if(u.pathname==='/play/1-7-1.html')return new Response('<script>var player_aaaa={"encrypt":3,"url":"opaque"};</script>');
  if(u.pathname==='/static/player/artplayer/')return new Response('<script>const isSmartPlay=true;const playPageUrl="video-key";const secretKeySeed="guest-code";const timestamp="'+stamp+'";</script>');
  assert.equal(u.origin,'https://hd.ticktockwow.com');const body=JSON.parse(options.body);assert.equal(body.vkey,'video-key');assert.equal(body.signature,createHash('md5').update(String(body.t)).digest('hex'));assert.equal(options.headers.cookie,undefined);return Response.json({code:200,url:cipher});
 };
 const web=new WebSources(fetcher);const result=await web.call({adapter:'hdmoli',api:base,headers:{cookie:'private',authorization:'private'}},'playerContent',['高清',base+'/play/1-7-1.html',[]]);
 assert.equal(result.url,url);assert.equal(requests.length,4);assert.equal(result.header.referer,base+'/play/1-7-1.html');
});
test('A123TV 去重线路且保留实际的集名，不用序号补齐缺失集',async()=>{
 const calls=[],web=new WebSources(async url=>{calls.push(url);return new URL(url).hostname==='media.example'?new Response('#EXTM3U\n#EXTINF:1,\na.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}}):new Response(a123Root);});
 const result=await web.call({adapter:'a123tv',api:base},'detailContent',[['/v/sample.html']]);
 const lines=parseLines(result.list[0]);assert.equal(lines.length,1);assert.equal(lines[0].key,'a1');assert.deepEqual(lines[0].episodes.map(e=>e.name),['第01集','第03集']);assert.equal(calls.length,1);
 const play=await web.call({adapter:'a123tv',api:base},'playerContent',['高清',lines[0].episodes[0].url,[]]);assert.equal(play.url,'https://media.example/main.m3u8');
});
test('网站适配器通过配置、搜索、详情、播放的现有 Providers 接口，不依赖插件运行时',async t=>{
 const url=base+'/config.json',p=new Providers(async raw=>{const u=new URL(raw);if(u.hostname==='media.example')return new Response('#EXTM3U\n#EXTINF:1,\na.ts\n');if(u.pathname==='/config.json')return Response.json({sites:[{key:'web',name:'网页片源',type:1,api:base,adapter:'a123tv'}]});if(u.pathname.startsWith('/s/'))return new Response('<a class="w4-item" href="/v/sample.html"><img data-src="/a.jpg"><div class="t">样本</div><div class="i">国产剧 / 2024年</div></a>');return new Response(a123Root);});t.after(()=>p.close());
 const c=await p.importConfig(url),s=c.sources[0];assert.equal(s.kind,'web');assert.equal((await p.getCategories(s.id)).length,4);
 const search=await p.catalog(s.id,{q:'样本'});assert.equal(search.list[0].title,'样本');assert.equal(search.totalKnown,false);
 const detail=await p.detail(s.id,search.list[0].id);assert.equal(detail.lines[0].key,'a1');assert.equal((await p.resolve(s.id,detail.id,0,0)).url,'https://media.example/main.m3u8');
});

test('网页播放预检拒绝伪装播放列表的 HTML，并取消响应',async()=>{
 let cancelled=false;
 const web=new WebSources(async raw=>new URL(raw).hostname==='media.example'?new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('<html>not a playlist</html>'));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/html'}}):new Response(a123Root));
 await assert.rejects(web.call({adapter:'a123tv',api:base},'playerContent',['高清',base+'/v/sample/a1z0.html',[]]),/有效播放列表/);assert.equal(cancelled,true);
});
test('网页播放预检接受被拆开的 BOM 与 HLS 文件头，并取消剩余响应',async()=>{
 let offset=0,cancelled=false;const bytes=new TextEncoder().encode('\uFEFF#EXTM3U\n#EXTINF:5,\na.ts\n');
 const web=new WebSources(async raw=>new URL(raw).hostname==='media.example'?new Response(new ReadableStream({pull(c){if(offset<bytes.length)c.enqueue(bytes.slice(offset,++offset));else c.close();},cancel(){cancelled=true;}}),{headers:{'content-type':'application/vnd.apple.mpegurl'}}):new Response(a123Root));
 const result=await web.call({adapter:'a123tv',api:base},'playerContent',['高清',base+'/v/sample/a1z0.html',[]]);assert.equal(result.url,'https://media.example/main.m3u8');assert.ok(cancelled);
});

test('金牌普通访客只选公开可用画质，不采用需要登录的地址',()=>{
 const denied={flag:true,needLogin:true,resolution:2160,url:'https://media.example/login.m3u8'};
 const allowed={flag:true,needLogin:false,resolution:480,url:'https://media.example/guest.m3u8'};
 assert.equal(guestMedia([denied,{...allowed,resolution:360},allowed]),allowed);
 assert.throws(()=>guestMedia([denied,{...allowed,flag:false},{url:allowed.url}]),/需要登录/);
 const t='1700000000000',params={keyword:'测试',pageNum:'1',pageSize:'30'},raw='keyword=测试&pageNum=1&pageSize=30&key=cb808529bae6b6be45ecfab29a4889bc&t='+t;
 assert.equal(guestHeaders(params,t).sign,createHash('sha1').update(createHash('md5').update(raw).digest('hex')).digest('hex'));
});
test('金牌访客接口保留真实集数和稳定入口，筛除无关搜索并拒绝注入的 ID',async()=>{
 const calls=[],web=new WebSources(async(raw,options)=>{const u=new URL(raw);calls.push(u);
  if(u.hostname==='media.example')return new Response('#EXTM3U\n#EXTINF:1,\na.ts\n');
  assert.ok(options.headers.sign);assert.ok(options.headers['user-agent'].includes('Mobile'));
  if(u.pathname.endsWith('searchByWordPageable'))return Response.json({code:200,data:{totalPage:2,list:[{vodId:12,typeId1:2,vodName:'测试剧',vodYear:'2024'},{vodId:13,typeId1:2,vodName:'无关推荐'}]}});
  if(u.pathname.endsWith('/detail'))return Response.json({code:200,data:{vodId:12,typeId1:2,vodName:'测试剧',vodYear:'2024',episodeList:[{nid:10,name:'1'},{nid:30,name:'3'}]}});
  return Response.json({code:200,data:{list:[{flag:true,needLogin:true,resolution:1080,url:'https://media.example/blocked.m3u8'},{flag:true,needLogin:false,resolution:480,url:'https://media.example/open.m3u8'}]}});
 });
 const source={adapter:'jinpai',api:base};assert.equal((await web.call(source,'searchContent',['测试',false,1])).list.length,1);
 const result=await web.call(source,'detailContent',[['12']]),lines=parseLines(result.list[0]);assert.equal(lines[0].key,'guest');assert.deepEqual(lines[0].episodes.map(ep=>ep.name),['第01集','第03集']);
 assert.equal((await web.call(source,'playerContent',['访客线路',lines[0].episodes[1].url])).url,'https://media.example/open.m3u8');
 assert.equal(calls.find(u=>u.pathname.endsWith('/url')).searchParams.get('nid'),'30');
 const n=calls.length;await assert.rejects(web.call(source,'detailContent',[['12&url=http://127.0.0.1']]),/标识无效/);assert.equal(calls.length,n);
 await assert.rejects(web.call(source,'constructor',[]),/不受支持/);
});

test('乌云使用真实季号拆分条目，各季入口独立，不按数量虚构季和集',async()=>{
 const source={adapter:'wooyun',api:base},record={id:12,title:'样本剧',releaseYear:2024,seasonCount:2,mediaType:{name:'电视剧'}},seasons=[{seasonNo:1,videoList:[{id:101,epNo:1,playUrl:'https://media.example/1.m3u8'}]},{seasonNo:3,videoList:[{id:305,epNo:5,playUrl:'https://media.example/3.m3u8'}]}];
 const web=new WebSources(async url=>{const u=new URL(url);if(u.pathname.endsWith('/search'))return Response.json({code:200,data:{records:[record],pages:1}});return Response.json({code:200,data:u.pathname.endsWith('/detail')?record:seasons});});
 const result=await web.call(source,'searchContent',['样本剧',false,1]);assert.deepEqual(result.list.map(v=>v.vod_id),['12~1','12~3']);assert.deepEqual(result.list.map(v=>v.vod_name),['样本剧 第1季','样本剧 第3季']);assert.ok(result.list.every(v=>v.vod_year===''));
 const detail=await web.call(source,'detailContent',[['12~3']]),lines=parseLines(detail.list[0]);assert.equal(detail.list[0].vod_name,'样本剧 第3季');assert.equal(lines[0].key,'season:3:auto:0');assert.deepEqual(lines[0].episodes,[{name:'第05集',url:'wooyun:12:3:305',direct:false}]);
 await assert.rejects(web.call(source,'detailContent',[['12~2']]),/这一季/);
 await assert.rejects(web.call(source,'detailContent',[['12']]),/具体季数/);
});

test('乌云只有一个实际季号时不把电影续集变成第2季，同集多来源分成线路',async()=>{
 const record={id:12,title:'电影2',seasonCount:2,releaseYear:2023,mediaType:{name:'电影'}},data=[{seasonNo:2,videoList:[{id:1,epNo:1,remark:'正片',playUrl:'https://a.cdn1.example/a.m3u8'}]}];
 const web=new WebSources(async url=>Response.json({code:200,data:url.endsWith('/search')?{records:[record]}:url.includes('/detail?')?record:data}));
 const source={adapter:'wooyun',api:base},list=await web.call(source,'searchContent',['电影2',false,1]);assert.equal(list.list[0].vod_name,'电影2');assert.equal(list.list[0].vod_year,'2023');assert.equal(list.list[0].vod_id,'12');
 record.title='样本剧';record.mediaType.name='电视剧';data[0].videoList=[{id:1,epNo:1,playUrl:'https://a.cdn1.example/a.m3u8'},{id:2,epNo:1,playUrl:'https://b.other.example/b.m3u8'},{id:3,epNo:2,playUrl:'https://a.cdn2.example/c.m3u8'},{id:4,epNo:2,playUrl:'https://b.other.example/d.m3u8'}];
 const detail=await web.call(source,'detailContent',[['12']]),lines=parseLines(detail.list[0]);assert.equal(lines.length,2);assert.ok(lines.every(line=>line.episodes.map(ep=>ep.name).join(',')==='第01集,第02集'));
});

test('乌云播放重新读取原季和视频 ID，链接更新可用，失效时不跳到其它集',async()=>{
 let available=true,version=1,requests=0;
 const web=new WebSources(async url=>{requests++;const u=new URL(url);if(u.hostname==='media.example')return new Response('#EXTM3U\n#EXTINF:1,\na.ts\n');
  assert.equal(u.pathname,'/movie/media/video/list');assert.equal(u.searchParams.get('mediaId'),'12');
  return Response.json({code:200,data:[{seasonNo:1,videoList:[{id:101,playUrl:'https://media.example/other.m3u8'}]},{seasonNo:3,videoList:available?[{id:305,playUrl:'https://media.example/updated'+version+'.m3u8'}]:[]}]});
 });
 const source={adapter:'wooyun',api:base};assert.equal((await web.call(source,'playerContent',['默认','wooyun:12:3:305'])).url,'https://media.example/updated1.m3u8');version=2;
 assert.equal((await web.call(source,'playerContent',['默认','wooyun:12:3:305'])).url,'https://media.example/updated2.m3u8');
 available=false;await assert.rejects(web.call(source,'playerContent',['默认','wooyun:12:3:305']),/原选集/);
 const n=requests;await assert.rejects(web.call(source,'playerContent',['默认','wooyun:12:3:305&url=http://127.0.0.1']),/入口无效/);assert.equal(requests,n);
});
