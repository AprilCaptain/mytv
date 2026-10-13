import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openHistory as openHistoryRaw, supportedHistoryNode } from '../lib/history.mjs';
import { historyEpisode, sameFilm, resumeDecision,nextHistoryEpisode } from '../public/history-utils.js';
import { serverAddresses } from '../lib/network-mode.mjs';
import { createApi } from '../lib/api.mjs';
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
 const last=s.start({...entry,meta:{...meta,title:'最后'},locator:{...locator,videoId:'last'}});s.delete(last.filmId);
 assert.equal(s.update({session:last.session,seq:1,position:500,duration:2400}).accepted,false);
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
});
