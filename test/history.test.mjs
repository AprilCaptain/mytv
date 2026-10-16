import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openHistory as openHistoryRaw, supportedHistoryNode } from '../lib/history.mjs';
import { historyEpisode, sameFilm, resumeDecision,nextHistoryEpisode } from '../public/history-utils.js';
import { serverAddresses } from '../lib/network-mode.mjs';
import { createApi } from '../lib/api.mjs';
import { HistoryService } from '../lib/history-service.mjs';
import { DatabaseSync } from 'node:sqlite';

const stores=new Map();
async function openHistory(root,options){const s=await openHistoryRaw(root,options);if(s?.close)stores.get(root)?.push(s);return s;}
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'My TV 历史-'));stores.set(root,[]);t.after(async()=>{for(const s of stores.get(root)||[])s.close();stores.delete(root);await rm(root,{recursive:true,force:true});});return root;}
const meta={title:'庆余年第二季',year:'2024',type:'国产剧',poster:''};
const locator={configUrl:'https://config.example/a.json',configName:'配置A',sourceKey:'a',sourceName:'A',sourceApi:'https://source.example/vod',videoId:'film',lineName:'4K',episodeName:'第01集'};
const entry={meta,locator,episodeKey:'episode:1',episodeName:'第01集',position:300,duration:2400};

test('SQLite 首次初始化，doctor 不创建文件，重启保留各集记录',async t=>{
 const root=await fixture(t);assert.equal(await openHistory(root,{checkOnly:true}),null);
 assert.deepEqual(await readdir(root),[]);let store=await openHistory(root);
 const s=store.start(entry);store.update({session:s.session,seq:1,position:450,duration:2400});store.close();
 assert.deepEqual(await openHistory(root,{checkOnly:true}),{checked:true});
 store=await openHistory(root);assert.equal(store.get(s.filmId).episode.position,450);store.close();
});
test('迁移前备份、更新版本与损坏数据库保留原文件',async t=>{
 const root=await fixture(t);await mkdir(join(root,'data'));const filename=join(root,'data/history.sqlite');
 let db=new DatabaseSync(filename);db.exec("CREATE TABLE legacy_note(value TEXT); INSERT INTO legacy_note VALUES('saved')");db.close();
 let store=await openHistory(root);store.close();assert.ok((await readdir(join(root,'data'))).some(n=>n.includes('.backup-')));
 db=new DatabaseSync(filename);assert.equal(db.prepare('SELECT value FROM legacy_note').get().value,'saved');db.exec('PRAGMA user_version=99');db.close();
 await assert.rejects(openHistory(root),/版本比当前程序更新/);
 const broken=await fixture(t);await mkdir(join(broken,'data'));await writeFile(join(broken,'data/history.sqlite'),'broken data');
 await assert.rejects(openHistory(broken),/原文件不会被清空/);assert.equal(await readFile(join(broken,'data/history.sqlite'),'utf8'),'broken data');
});
test('不可写数据目录退出；Node 版本判断保留停止脚本独立性',async t=>{
 assert.equal(supportedHistoryNode('22.17.0'),false);assert.equal(supportedHistoryNode('22.18.0'),true);assert.equal(supportedHistoryNode('24.0.0'),true);
 const root=await fixture(t);await writeFile(join(root,'data'),'not a directory');await assert.rejects(openHistory(root));
});
test('跨配置同片合并，各集独立，年份/类型/季数分开',async t=>{
 const root=await fixture(t),s=await openHistory(root);t.after(()=>s.close());
 const a=s.start(entry);const b=s.start({...entry,locator:{...locator,configUrl:'https://config.example/b.json',sourceKey:'b'}});
 assert.equal(a.filmId,b.filmId);
 s.start({...entry,episodeKey:'episode:2',episodeName:'第02集',position:90});assert.equal(s.list().length,1);assert.equal(s.episode(a.filmId,'episode:1').position,300);
 assert.equal(s.prepare(meta,locator,'episode:1').record.episode.name,'第02集');
 for(const changed of [{...meta,year:'2021'},{...meta,type:'国产动漫'},{...meta,title:'庆余年第一季'}])s.start({...entry,meta:changed,locator:{...locator,videoId:changed.title+changed.year+changed.type}});
 assert.equal(s.list().length,4);
});
test('信息不足时返回同名候选，确认绑定后续播；链接独立记录',async t=>{
 const s=await openHistory(await fixture(t));t.after(()=>s.close());const a=s.start(entry);
 const unknown={...meta,year:''},other={...locator,sourceKey:'other'};
 assert.equal(s.prepare(unknown,other,'episode:1').candidates.length,1);
 const b=s.start({...entry,meta:unknown,locator:other,filmId:a.filmId});assert.equal(b.filmId,a.filmId);
 const link=s.start({...entry,meta:{title:'链接播放',year:'',type:''},locator:{direct:true,url:'https://media.example/movie.mp4'}});
 assert.notEqual(link.filmId,a.filmId);assert.equal(s.list().length,2);
});
test('100 条淘汰关联数据，删除后旧会话不重建记录',async t=>{
 const s=await openHistory(await fixture(t));t.after(()=>s.close());const first=s.start(entry);
 for(let i=0;i<100;i++)s.start({...entry,meta:{...meta,title:'电影'+i},locator:{...locator,videoId:String(i)}});
 assert.equal(s.list().length,100);assert.throws(()=>s.get(first.filmId),/删除或被淘汰/);
 assert.equal(s.db.prepare('SELECT count(*) AS n FROM episodes').get().n,100);
 assert.equal(s.db.prepare('SELECT count(*) AS n FROM films').get().n,100);
 assert.equal(s.db.prepare('SELECT count(*) AS n FROM bindings').get().n,100);
 assert.equal(s.sessions.has(first.session),false);
 const last=s.start({...entry,meta:{...meta,title:'最后'},locator:{...locator,videoId:'last'}});s.delete(last.filmId);
 assert.equal(s.update({session:last.session,seq:1,position:500,duration:2400}).accepted,false);
});
test('历史按片名搜索并分页，特殊字符是字面量，删掉最后一页时回到有效页',async t=>{
 const s=await openHistory(await fixture(t));
 for(let i=0;i<41;i++)s.start({...entry,meta:{...meta,title:'影视 Test '+i},locator:{...locator,videoId:String(i)}});
 const first=s.page();assert.equal(first.items.length,20);assert.equal(first.total,41);assert.equal(first.pages,3);assert.equal(first.items[0].title,'影视 Test 40');
 const second=s.page({page:2});assert.equal(second.items[0].title,'影视 Test 20');
 const last=s.page({page:3});assert.equal(last.items.length,1);s.delete(last.items[0].id);assert.equal(s.page({page:3}).page,2);
 const match=s.page({query:'  test 2  ',page:2});assert.equal(match.total,11);assert.equal(match.page,1);assert.equal(match.totalAll,40);
 assert.equal(s.page({query:'不存在'}).total,0);assert.equal(s.page({query:"%' OR 1=1 --"}).total,0);
 s.start({...entry,meta:{...meta,title:'100%_高清'},locator:{...locator,videoId:'literal'}});
 assert.equal(s.page({query:'%_'}).total,1);assert.equal(s.page({page:'invalid',pageSize:-3}).page,1);
});
test('清空物理删除所有表关联数据，旧会话和已准备的旧入口不能重建',async t=>{
 const root=await fixture(t),s=await openHistory(root),a=s.start(entry);
 s.start({...entry,episodeKey:'episode:2',episodeName:'第02集'});
 assert.equal(s.clear().deleted,1);
 for(const table of ['films','episodes','bindings'])assert.equal(s.db.prepare('SELECT count(*) AS n FROM '+table).get().n,0);
 assert.equal(s.sessions.size,0);assert.equal(s.update({session:a.session,seq:1,position:600,duration:2400}).accepted,false);
 assert.throws(()=>s.start({...entry,filmId:a.filmId}),/不匹配/);assert.equal(s.clear().deleted,0);
 s.close();const reopened=await openHistory(root);assert.equal(reopened.page().total,0);
 const fresh=reopened.start(entry);assert.notEqual(fresh.filmId,a.filmId);
});
test('清空期间尚未解析完的会话请求被拒绝，防止晚到写入',async t=>{
 const s=await openHistory(await fixture(t)),service=new HistoryService(s);
 let finish;service.context=()=>new Promise(resolve=>finish=resolve);
 const pending=service.start({position:300,duration:2400});s.clear();finish(entry);
 await assert.rejects(pending,/历史已清空/);assert.equal(s.list().length,0);
});
test('最近主动会话优先、请求乱序、手动回退及结束标记',async t=>{
 const s=await openHistory(await fixture(t));t.after(()=>s.close());const a=s.start(entry),b=s.start({...entry,position:600});
 assert.equal(s.update({session:a.session,seq:99,position:1000,duration:2400}).accepted,false);
 s.update({session:b.session,seq:2,position:200,duration:2400});s.update({session:b.session,seq:1,position:1000,duration:2400});
 assert.equal(s.get(b.filmId).episode.position,200);
 const before=s.get(b.filmId).lastPlayed;s.update({session:b.session,seq:3,position:2400,duration:2400,completed:true});
 assert.equal(s.get(b.filmId).lastPlayed,before);assert.equal(s.get(b.filmId).episode.completed,true);
 const stale=s.start({...entry,claimedAt:1});assert.equal(stale.superseded,true);assert.equal(s.get(b.filmId).episode.completed,true);
 assert.throws(()=>s.update({session:b.session,seq:4,position:NaN,duration:0}),/无效/);
});
test('集数匹配不混淆上下集/番外；时长、范围与结束处理',()=>{
 assert.equal(historyEpisode('第01集','国产剧'),historyEpisode('第一集','国产剧'));
 assert.equal(historyEpisode('EP01','国产剧'),historyEpisode('第1集','国产剧'));
 assert.notEqual(historyEpisode('第01集上','国产剧'),historyEpisode('第01集下','国产剧'));
 assert.notEqual(historyEpisode('番外1','国产剧'),historyEpisode('第01集','国产剧'));
 assert.equal(nextHistoryEpisode([{name:'第03集'},{name:'第02集'},{name:'第01集'}],1,'国产剧'),0);
 assert.equal(nextHistoryEpisode([{name:'第03集'},{name:'第01集'}],1,'国产剧'),-1);
 assert.equal(sameFilm(meta,{...meta,type:'国产动漫'}),false);
 assert.equal(sameFilm(meta,{...meta,title:'庆余年第2季'}),true);
 const b={position:600,duration:2400};assert.equal(resumeDecision(b,NaN).kind,'wait');assert.equal(resumeDecision(b,Infinity).kind,'wait');
 assert.equal(resumeDecision(b,2400).kind,'wait');assert.equal(resumeDecision(b,2400,{start:0,end:800}).position,600);
 assert.equal(resumeDecision(b,500,{start:0,end:500}).kind,'choice');assert.equal(resumeDecision(b,2000,{start:0,end:2000}).kind,'choice');
 assert.equal(resumeDecision({...b,completed:true},2400).kind,'start');
});
test('局域网主机白名单与默认本机模式',()=>{
 const interfaces={en0:[{family:'IPv4',address:'192.168.1.5',internal:false},{family:'IPv4',address:'8.8.8.8',internal:false}]};
 assert.equal(serverAddresses(3210,false,interfaces).allowedHosts.has('192.168.1.5:3210'),false);
 const lan=serverAddresses(3210,true,interfaces);assert.equal(lan.host,'0.0.0.0');assert.ok(lan.allowedHosts.has('127.0.0.1:3210'));assert.ok(lan.allowedHosts.has('192.168.1.5:3210'));assert.equal(lan.allowedHosts.has('evil.example:3210'),false);
});
test('历史 API 恢复重排配置/线路，不使用旧下标或代理地址',async t=>{
 const store=await openHistory(await fixture(t));let reordered=false;
 const api=createApi(async raw=>{const u=new URL(raw);if(u.pathname==='/config.json')return Response.json({sites:reordered?
 [{key:'unused',name:'别的源',type:1,api:'https://other.example/vod'},{key:'stable',name:'稳定源',type:1,api:'https://source.example/vod'}]:
 [{key:'stable',name:'稳定源',type:1,api:'https://source.example/vod'}]});
 const from=reordered?'备用$$$主线':'主线$$$备用';return Response.json({list:[{vod_id:'1',vod_name:meta.title,vod_year:'2024',type_name:'国产剧',vod_play_from:from,vod_play_url:'第01集$https://media.example/new.m3u8$$$第01集$https://media.example/other.m3u8'}]});}, {history:store});t.after(()=>api.close());
 const call=async(path,body,method='POST')=>{const r=await api(new Request('http://127.0.0.1:3210'+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined}));return {status:r.status,data:await r.json()};};
 const c=await call('/api/config',{url:'https://config.example/config.json'});const body={source:c.data.sources[0].id,id:'1',line:0,episode:0,configName:'测试配置'};
 const prep=await call('/api/history/prepare',body);assert.equal(prep.data.bookmark,null);
 const start=await call('/api/history/sessions',{...body,position:300,duration:2400});assert.equal(start.status,200);
 reordered=true;const resumed=await call('/api/history/resume',{id:start.data.filmId});assert.equal(resumed.status,200);assert.equal(resumed.data.line,1);assert.equal(resumed.data.config.sources[1].key,'stable');
 const records=await call('/api/history',undefined,'GET');assert.equal(records.data.items.length,1);assert.equal(records.data.items[0].episode.position,300);
 const denied=await api(new Request('http://127.0.0.1:3210/api/history',{headers:{origin:'https://other.example'}}));assert.equal(denied.status,403);
 const deleted=await call('/api/history/'+start.data.filmId,{},'DELETE');assert.equal(deleted.status,200);
 const late=await call('/api/history/progress',{session:start.data.session,seq:1,position:500,duration:2400});assert.equal(late.data.accepted,false);
 const again=await call('/api/history/sessions',{...body,position:300,duration:2400});
 const filtered=await call('/api/history?q='+encodeURIComponent('庆余年')+'&page=2',undefined,'GET');assert.equal(filtered.data.total,1);assert.equal(filtered.data.page,1);
 const noMatch=await call('/api/history?q=missing',undefined,'GET');assert.equal(noMatch.data.items.length,0);assert.equal(noMatch.data.totalAll,1);
 const deniedClear=await api(new Request('http://127.0.0.1:3210/api/history',{method:'DELETE',headers:{origin:'https://other.example'}}));assert.equal(deniedClear.status,403);assert.equal(store.list().length,1);
 const cleared=await call('/api/history',{},'DELETE');assert.equal(cleared.data.deleted,1);
 assert.equal((await call('/api/history/latest',undefined,'GET')).data.item,null);
 const lateAfterClear=await call('/api/history/progress',{session:again.data.session,seq:1,position:500,duration:2400});assert.equal(lateAfterClear.data.accepted,false);
});

test('同名网页线路重排或改名后，历史按稳定线路 key 恢复',async t=>{
 const store=await openHistory(await fixture(t));let reordered=false;
 const api=createApi(async raw=>{const u=new URL(raw);if(u.pathname==='/config.json')return Response.json({sites:[{key:'stable',name:'片源',type:1,api:'https://source.example/vod'}]});
  const lines=[{key:'original',name:reordered?'新名称':'高清',episodes:[{name:'第01集',url:'https://media.example/a.m3u8'}]},{key:'other',name:'高清',episodes:[{name:'第01集',url:'https://media.example/b.m3u8'}]}];
  return Response.json({list:[{vod_id:'1',vod_name:meta.title,vod_year:'2024',type_name:'国产剧',vod_play_sources:reordered?lines.reverse():lines}]});
 },{history:store});t.after(()=>api.close());
 const call=async(path,body)=>{const r=await api(new Request('http://127.0.0.1:3210'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));return r.json();};
 const c=await call('/api/config',{url:'https://config.example/config.json'});const start=await call('/api/history/sessions',{source:c.sources[0].id,id:'1',line:0,episode:0,position:200,duration:2400});
 assert.equal(store.get(start.filmId).episode.locator.lineKey,'original');reordered=true;
 // Use a fresh provider instance so persisted identities, not its detail cache, are exercised.
 const {HistoryService}=await import('../lib/history-service.mjs');
 const original=await api(new Request('http://127.0.0.1:3210/api/config-state?config='+c.id));assert.equal(original.status,200);
 const resolver=new HistoryService(store,{importConfig:async()=>({sources:[{supported:true,key:'stable',id:'new'}]}),detail:async()=>({id:'1',title:meta.title,year:'2024',type:'国产剧',lines:[{key:'other',name:'高清',episodes:[{name:'第01集'}]},{key:'original',name:'新名称',episodes:[{name:'第01集'}]}]})});
 const resumed=await resolver.resolveRecord(start.filmId);assert.equal(resumed.line,1);
});

test('电影同一线路有多个清晰度版本时，历史优先恢复原版本名',async t=>{
 const {HistoryService}=await import('../lib/history-service.mjs'),store=await openHistory(await fixture(t));
 const record=store.start({...entry,meta:{title:'电影',year:'2024',type:'剧情片'},locator:{...locator,lineKey:'stable',episodeName:'1080P'},episodeKey:'feature',episodeName:'1080P'});
 const resolver=new HistoryService(store,{importConfig:async()=>({sources:[{supported:true,key:locator.sourceKey,id:'new'}]}),detail:async()=>({id:locator.videoId,title:'电影',year:'2024',type:'剧情片',lines:[{key:'stable',name:'高清',episodes:[{name:'2160P'},{name:'1080P'}]}]})});
 const resumed=await resolver.resolveRecord(record.filmId);assert.equal(resumed.episode,1);
});

test('旧版剧情片按集名保存的进度仍可恢复，不清空原记录',async t=>{
 const store=await openHistory(await fixture(t)),movie={title:'旧电影',year:'2024',type:'剧情片'},route={...locator,episodeName:'正片',lineKey:'stable'};
 const record=store.start({...entry,meta:movie,locator:route,episodeKey:'named:正片',episodeName:'正片'});
 const resolver=new HistoryService(store,{importConfig:async()=>({sources:[{supported:true,key:route.sourceKey,id:'new'}]}),detail:async()=>({...movie,id:route.videoId,lines:[{key:'stable',name:'高清',episodes:[{name:'正片'}]}]})});
 assert.equal((await resolver.resolveRecord(record.filmId)).episode,0);
 assert.equal(store.prepare(movie,route,'feature').bookmark.position,300);assert.equal(store.list().length,1);
});
