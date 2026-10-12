import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, seekBounds, seekTarget, hoverTime } from '../public/player-utils.js';

test('播放器时间与跳转支持长视频，越界跳转被限制在有效范围内',()=>{
  assert.equal(formatTime(3675.9),'1:01:15');assert.equal(formatTime(NaN),'00:00');
  assert.equal(formatTime(-8),'00:00');assert.equal(formatTime(70),'01:10');
  assert.deepEqual(seekBounds(120),{start:0,end:120});
  assert.equal(seekTarget(5,-10,{start:0,end:120}),0);
  assert.equal(seekTarget(115,10,{start:0,end:120}),120);
  assert.equal(seekTarget(30,10,null),null);
});

test('悬停时间按鼠标位置计算，直播窗口可跳转，未就绪媒体禁用进度',()=>{
  const range={start:0,end:240};
  assert.equal(hoverTime(150,50,200,range),120);
  assert.equal(hoverTime(-10,50,200,range),0);assert.equal(hoverTime(400,50,200,range),240);
  assert.equal(hoverTime(50,50,0,range),null);
  const live={length:1,start:()=>120,end:()=>180};
  assert.deepEqual(seekBounds(Infinity,live),{start:120,end:180});
  assert.equal(seekTarget(125,-10,seekBounds(Infinity,live)),120);
  assert.equal(seekBounds(NaN,{length:0}),null);
});
