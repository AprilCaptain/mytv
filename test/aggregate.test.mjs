import test from 'node:test';import assert from 'node:assert/strict';
import {Providers,DEFAULT_CONFIG} from '../lib/providers.mjs';import {ALL_CONFIG_URL,BUILTIN_CONFIGS} from '../lib/configs.mjs';
import {sourceIdentity} from '../lib/aggregate.mjs';import {HistoryService} from '../lib/history-service.mjs';
const a='https://config.example/a.json',b='https://config.example/b.json',broken='https://config.example/broken.json';
function fixture(){return new Providers(async raw=>{
 const u=new URL(raw);if(raw===broken)throw new Error('配置暂不可读');
 if(raw===a)return Response.json({sites:[{key:'original',name:'A 同源',type:1,api:'https://media.example/vod/?ac=list&token=a'},{key:'js1',name:'脚本1',type:3,api:'https://scripts.example/drpy.js',ext:{site:'one'}},{key:'js2',name:'脚本2',type:3,api:'https://scripts.example/drpy.js',ext:{site:'two'}}]});
 if(raw===b)return Response.json({sites:[{key:'copy',name:'B 同源',type:1,api:'https://MEDIA.EXAMPLE:443/vod?token=a&pg=1'},{key:'private',name:'不同鉴权',type:1,api:'https://media.example/vod?token=a',header:{Authorization:'different'}}]});
 if(u.hostname==='media.example')return Response.json({list:[{vod_id:'42',vod_name:'样本剧',vod_year:'2024',type_name:'国产剧',vod_play_from:'高清',vod_play_url:'第01集$https://cdn.example/1.m3u8'}]});
 return Response.json({sites:[]});
 });}
test('全部是默认选项，动态聚合兼容片源、保留来源且仅合并等价 HTTP 请求',async t=>{
 const p=fixture();t.after(()=>p.close());const c=await p.importConfig(ALL_CONFIG_URL,undefined,0,[{name:'A',url:a},{name:'B',url:b},{name:'坏配置',url:broken}]);
 assert.equal(DEFAULT_CONFIG,ALL_CONFIG_URL);assert.equal(BUILTIN_CONFIGS.find(c=>c.default).name,'全部');assert.ok(c.aggregate);
 const custom=c.sources.filter(s=>s.api.includes('media.example')||s.api.includes('scripts.example'));assert.equal(custom.length,4);
 const merged=custom.find(s=>s.origins.length===2);assert.ok(merged);assert.deepEqual(merged.origins.map(o=>o.sourceKey),['original','copy']);
 assert.equal(c.members.find(m=>m.url===broken).status,'error');assert.ok(c.sources.length>=29);assert.ok(c.duplicateCount>=26);
 const again=await p.importConfig(ALL_CONFIG_URL,undefined,0,[{name:'B',url:b},{name:'A',url:a}]);assert.equal(again.sources.find(s=>s.origins.some(o=>o.sourceKey==='original')).id,merged.id);
 const history=new HistoryService({metadata:x=>x},p);const context=await history.context({source:merged.id,id:'42',line:0,episode:0,configName:'全部'});
 assert.equal(context.locator.configUrl,a);assert.equal(context.locator.configName,'A');assert.equal(context.locator.sourceKey,'original');assert.notEqual(context.locator.configUrl,ALL_CONFIG_URL);
});
test('相同脚本不同 ext、不同请求凭证不会误合并；对象键顺序不影响等价性',()=>{
 const s={kind:'js',type:3,api:'https://script.example/a.js',headers:{referer:'https://site.example/'},ext:{a:1,b:2},parsers:[]};
 assert.equal(sourceIdentity(s),sourceIdentity({...s,ext:{b:2,a:1}}));assert.notEqual(sourceIdentity(s),sourceIdentity({...s,ext:{a:1,b:3}}));
 assert.notEqual(sourceIdentity(s),sourceIdentity({...s,headers:{authorization:'token'}}));
});
test('聚合取消会结束等待，非法成员数量及自引用不会递归构建',async t=>{
 const p=new Providers(async()=>new Promise(()=>{}));t.after(()=>p.close());const c=new AbortController(),work=p.importConfig(ALL_CONFIG_URL,c.signal);c.abort();await assert.rejects(work);
 await assert.rejects(p.importConfig(ALL_CONFIG_URL,undefined,1),/嵌套/);
 await assert.rejects(p.importConfig(ALL_CONFIG_URL,undefined,0,Array(33).fill(a)),/32/);
});
