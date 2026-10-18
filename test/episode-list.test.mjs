import test from 'node:test';import assert from 'node:assert/strict';
import {episodeVisibleCount,revealEpisode} from '../public/episode-list.js';
test('恢复靠后集数、倒序与跨过展开边界时，当前集始终包含在展示范围内',()=>{
 assert.equal(episodeVisibleCount(1000,899,false,180),900);
 assert.equal(episodeVisibleCount(1000,179,false,180),180);
 assert.equal(episodeVisibleCount(1000,180,false,180),360);
 assert.equal(episodeVisibleCount(1000,10,true,180),1000);
 assert.equal(episodeVisibleCount(1000,999,true,180),180);
 assert.equal(episodeVisibleCount(36,30,false,180),36);
 assert.equal(episodeVisibleCount(0,0,false,180),0);
});
test('只滚动选集容器，当前集已可见时不打断用户位置；没有当前集或区域隐藏时不滚动',()=>{
 const list={scrollTop:0,clientTop:1,clientHeight:190,scrollHeight:9900,getBoundingClientRect:()=>({top:100}),querySelector:()=>selected};
 const selected={getBoundingClientRect:()=>({top:9960-list.scrollTop,bottom:9992-list.scrollTop,height:32}),scrollIntoView:()=>assert.fail('不能滚动外层页面')};
 revealEpisode(list);const rect=selected.getBoundingClientRect();assert.ok(rect.top>=101);assert.ok(rect.bottom<=291);
 const previous=list.scrollTop;revealEpisode(list);assert.equal(list.scrollTop,previous);
 list.clientHeight=0;revealEpisode(list);assert.equal(list.scrollTop,previous);list.clientHeight=190;list.querySelector=()=>null;revealEpisode(list);assert.equal(list.scrollTop,previous);
});
