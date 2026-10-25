import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../public/history-ui.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element extends EventTarget {
 constructor(){super();this.hidden=false;this.open=false;this.textContent='';}
 append(){} replaceChildren(){} setAttribute(){}
 showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}
}
class Video extends EventTarget {
 constructor(){super();this.duration=2400;this.currentTime=0;this.readyState=1;this.paused=true;this.seeking=false;this.ended=false;this.seekable={length:1,start:()=>0,end:()=>2400};}
 play(){this.paused=false;return Promise.resolve();}pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
 emit(name){this.dispatchEvent(new Event(name));}
}
function environment(t,api){
 const previous={document:globalThis.document,window:globalThis.window};const elements=new Map();
 const document=new EventTarget();document.hidden=false;document.getElementById=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};document.createElement=()=>new Element();
 globalThis.document=document;globalThis.window=new EventTarget();const video=new Video();
 const h=createHistory({api,video,resume(){}});t.after(()=>{h.dispose();globalThis.document=previous.document;globalThis.window=previous.window;});return {h,video};
}
test('元数据就绪或加载失败不会创建零进度历史，真正 playing 后才创建',async t=>{
 const calls=[];const {h,video}=environment(t,async(path,options)=>{calls.push({path,body:options?.body});return path.endsWith('prepare')?{candidates:[],bookmark:null,filmId:null}:{session:'s',filmId:'f'};});
 await h.prepare({url:'https://media.example/video.mp4'});video.emit('loadedmetadata');await tick();assert.equal(calls.filter(c=>c.path.endsWith('sessions')).length,0);
 h.markFailed();video.readyState=4;video.emit('playing');await tick();assert.equal(calls.filter(c=>c.path.endsWith('sessions')).length,0);
 h.reset();await h.prepare({url:'https://media.example/video.mp4'});video.readyState=4;video.currentTime=2;video.paused=false;video.emit('playing');await tick();
 assert.equal(calls.filter(c=>c.path.endsWith('sessions')).length,1);assert.equal(calls.at(-1).body.position,2);
});
test('切换前保存捕获原进度，之后 emptied/零时长事件不能覆盖记录',async t=>{
 const writes=[];const {h,video}=environment(t,async(path,options)=>{
   if(path.endsWith('prepare'))return {candidates:[],bookmark:null,filmId:null};if(path.endsWith('sessions'))return {session:'s',filmId:'f'};
   writes.push(options.body);return {accepted:true};
 });await h.prepare({url:'https://media.example/video.mp4'});video.readyState=4;video.currentTime=2;video.paused=false;video.emit('playing');await tick();
 const previous=writes.length;video.currentTime=123;const saved=h.reset();video.currentTime=0;video.duration=NaN;video.emit('pause');video.emit('emptied');await saved;
 assert.equal(writes.length,previous+1);assert.equal(writes.at(-1).position,123);assert.equal(writes.at(-1).duration,2400);
});
test('旧加载请求迟到不会污染新集的续播位置',async t=>{
 let resolveOld;const {h}=environment(t,async(path,options)=>options.body.url.endsWith('old.mp4')?new Promise(r=>resolveOld=r):{candidates:[],filmId:'new',bookmark:{position:20,duration:2400}});
 const old=h.prepare({url:'https://media.example/old.mp4'});h.reset();await h.prepare({url:'https://media.example/new.mp4'});
 resolveOld({candidates:[],filmId:'old',bookmark:{position:500,duration:2400}});assert.equal(await old,false);assert.equal(h.bookmark.position,20);
});

test('媒体重新初始化恢复已有位置，不因自动 playing 抢回共享会话',async t=>{
 let sessions=0;const {h,video}=environment(t,async(path)=>{
  if(path.endsWith('prepare'))return {candidates:[],bookmark:null,filmId:null};
  if(path.endsWith('sessions'))return {session:'s'+(++sessions),filmId:'f'};
  return {accepted:false};
 });await h.prepare({url:'https://media.example/video.mp4'});video.readyState=4;video.currentTime=2;video.paused=false;video.emit('playing');await tick();
 video.currentTime=450;video.emit('timeupdate');video.readyState=0;video.currentTime=0;video.emit('emptied');
 video.readyState=1;video.emit('loadedmetadata');assert.equal(video.currentTime,450);video.emit('seeked');
 video.readyState=4;video.emit('playing');await tick();assert.equal(sessions,1);
 h.requestClaim();video.emit('playing');await tick();assert.equal(sessions,2);
});


test('重新点击当前集从头播放，不再强制恢复该集旧进度；与自动跳过联动', async t => {
 const { createSkipPlayback } = await import('../public/skip-playback.js');
 const writes=[];
 const {h,video}=environment(t,async(path,options)=>{
  if(path.endsWith('prepare'))return {candidates:[],filmId:'f',bookmark:{position:541,duration:752}};
  if(path.endsWith('sessions')){writes.push(options.body);return {session:'s',filmId:'f'};}return {accepted:true};
 });
 const data={enabled:true,skipIntro:true,skipOutro:true,rules:[{title:'炼气十万年',year:'',enabled:true,intro:175,outro:620,outroMode:'position'}]};
 const skip=createSkipPlayback({video,api:async()=>data,current:()=>({title:'炼气十万年',year:'2023'}),ready:()=>h.canSkip,notice(){}});t.after(()=>skip.dispose());
 video.duration=752;video.seekable={length:1,start:()=>0,end:()=>752};
 await skip.refresh();await h.prepare({url:'https://media.example/episode.mp4'});video.emit('loadedmetadata');assert.equal(video.currentTime,541);
 video.readyState=4;video.emit('playing');await tick();assert.equal(video.currentTime,541);
 h.reset();skip.reset();video.currentTime=0;video.readyState=1;video.paused=true;
 await h.prepare({url:'https://media.example/episode.mp4'},'f',false,{fromStart:true});
 video.emit('loadedmetadata');assert.equal(video.currentTime,0);video.readyState=4;video.emit('playing');await tick();assert.equal(video.currentTime,175);
 video.currentTime=620;video.emit('timeupdate');assert.equal(video.currentTime,751.95);
 assert.ok(writes.length>=2);
});
