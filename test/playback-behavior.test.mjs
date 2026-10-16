import test from 'node:test';import assert from 'node:assert/strict';
import {qualityOptions,alternateLine,streamFailure,watchPlayback} from '../public/playback-utils.js';
test('画质档位保留真实列表参数，按尺寸与码率排序，不把源名称作为解码尺寸',()=>{
 const list=qualityOptions([{width:1280,height:720,bitrate:2e6},{width:1920,height:1080,bitrate:3e6},{width:3840,height:1608,bitrate:8e6},{width:1920,height:1080,bitrate:5e6}]);
 assert.deepEqual(list.map(v=>v.index),[2,3,1,0]);assert.match(list[0].label,/3840×1608.*8.0 Mbps/);assert.equal(list[0].width,3840);
});
test('自动备用跳过缺集线路，不浪费重试次数，也不把番外或上下集对应到普通集',()=>{
 const lines=['当前','缺集1','4K缺集','高清备用'].map((name,i)=>({name,episodes:[{name:i===0||i===3?'第01集':'第02集'}]}));
 const next=alternateLine(lines,0,new Set(),'s','第01集','国产剧');assert.equal(next.index,3);assert.equal(next.episode,0);
 assert.equal(alternateLine(lines,0,new Set(['s:3']),'s','第01集','国产剧'),null);
 assert.equal(alternateLine(lines,0,new Set(),'s','第01集上','国产剧'),null);
});
test('播放错误区分编码、密钥、失效地址与超时，详情不包含临时地址',()=>{
 assert.match(streamFailure({details:'manifestIncompatibleCodecsError'}).message,/解码/);
 assert.match(streamFailure({details:'fragLoadTimeOut'}).message,/分片加载超时/);
 assert.match(streamFailure({details:'fragLoadError',response:{code:404,url:'https://cdn.example/private?token=secret'}}).message,/失效/);
 assert.ok(!streamFailure({details:'fragLoadError',response:{code:404,url:'https://cdn.example/private?token=secret'}}).detail.includes('secret'));
 assert.match(streamFailure({details:'keyLoadError'}).message,/密钥/);
});
function monitor(t){const video=new EventTarget();Object.assign(video,{paused:false,ended:false,currentTime:0,videoWidth:0});const errors=[];
 t.mock.timers.enable({apis:['setTimeout']});const watcher=watchPlayback(video,e=>errors.push(e),{startupMs:1000,stallMs:2000});t.after(()=>watcher.dispose());watcher.start();return {video,watcher,errors,emit:name=>video.dispatchEvent(new Event(name))};}
test('无首帧达到截止时间后提示，旧播放器释放后不再触发迟到换线',t=>{
 const e=monitor(t);t.mock.timers.tick(999);assert.equal(e.errors.length,0);t.mock.timers.tick(1);assert.match(e.errors[0],/没有显示画面/);
 e.watcher.start();e.watcher.dispose();t.mock.timers.tick(5000);assert.equal(e.errors.length,1);
});
test('真实播放后才按缓冲截止时间检测，手动暂停不误判失败',t=>{
 const e=monitor(t);e.video.videoWidth=1920;e.emit('play');e.emit('playing');t.mock.timers.tick(5000);assert.equal(e.errors.length,0);
 e.emit('waiting');t.mock.timers.tick(1999);assert.equal(e.errors.length,0);t.mock.timers.tick(1);assert.match(e.errors[0],/持续缓冲/);
 e.emit('play');e.video.paused=true;e.emit('pause');t.mock.timers.tick(5000);assert.equal(e.errors.length,1);
});
