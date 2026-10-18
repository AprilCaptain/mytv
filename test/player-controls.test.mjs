import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from '../public/player.js';

function environment(t,actions={}) {
  const previous={document:globalThis.document,window:globalThis.window};
  class Element extends EventTarget {
    constructor(){super();this.style={setProperty(){}};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x)};this.hover=false;this.keyboard=false;}
    setAttribute(){} matches(selector){return selector===':hover'?this.hover:this.keyboard;}
    contains(element){return element===this.child;}
    closest(){return null;}
    blur(){if(document.activeElement===this)document.activeElement=document.body;this.keyboard=false;this.dispatchEvent(new Event('blur'));}
  }
  const elements=new Map(),document=new EventTarget();
  document.getElementById=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  document.querySelector=()=>null;document.body=new Element();document.activeElement=document.body;globalThis.document=document;globalThis.window=new EventTarget();
  const video=new Element(),stage=new Element();Object.assign(video,{paused:false,ended:false,volume:1,currentTime:10,duration:120,seekable:{length:0},buffered:{length:0},playbackRate:1});
  t.mock.timers.enable({apis:['setTimeout']});const player=createPlayer(video,stage,actions);
  t.after(()=>{player.reset();globalThis.document=previous.document;globalThis.window=previous.window;});
  const emit=(element,name,props={})=>{const event=new Event(name,{cancelable:true});for(const [key,value] of Object.entries(props))Object.defineProperty(event,key,{value});element.dispatchEvent(event);return event;};
  return {video,stage,document,element:id=>document.getElementById(id),emit,idle:()=>stage.classes.has('controls-idle')};
}

test('鼠标点击产生的播放器焦点不阻止自动隐藏；暂停立即显示',t=>{
  const e=environment(t);e.document.activeElement=e.video;e.emit(e.stage,'focusin');
  t.mock.timers.tick(2599);assert.equal(e.idle(),false);t.mock.timers.tick(1);assert.equal(e.idle(),true);
  e.video.paused=true;e.emit(e.video,'pause');t.mock.timers.tick(5000);assert.equal(e.idle(),false);
});
test('控制栏悬停与拖动期间保持显示，离开或松开后重新计时',t=>{
  const e=environment(t),controls=e.element('player-controls'),seek=e.element('player-seek');
  e.emit(controls,'pointerenter');t.mock.timers.tick(5000);assert.equal(e.idle(),false);
  e.emit(seek,'pointerdown');e.emit(controls,'pointerleave');t.mock.timers.tick(5000);assert.equal(e.idle(),false);
  e.emit(globalThis.window,'pointerup');t.mock.timers.tick(2600);assert.equal(e.idle(),true);
  e.emit(e.stage,'pointermove');assert.equal(e.idle(),false);
});
test('键盘焦点与倍速菜单保持显示，全屏切换后仍可自动隐藏',t=>{
  const e=environment(t),controls=e.element('player-controls'),speed=e.element('player-speed');
  controls.child=speed;e.document.activeElement=speed;speed.keyboard=true;e.emit(e.stage,'focusin');
  t.mock.timers.tick(5000);assert.equal(e.idle(),false);
  speed.keyboard=false;e.emit(speed,'pointerdown');t.mock.timers.tick(5000);assert.equal(e.idle(),false);
  speed.value='1.5';e.emit(speed,'change');e.emit(e.document,'fullscreenchange');
  t.mock.timers.tick(2600);assert.equal(e.idle(),true);assert.equal(e.video.playbackRate,1.5);
});
test('画质菜单展开时保持控制栏，选中后恢复自动隐藏并通知播放器',t=>{
 let selected;const e=environment(t,{onQualityChange:value=>{selected=value;}}),quality=e.element('player-quality');e.emit(quality,'pointerdown');t.mock.timers.tick(5000);assert.equal(e.idle(),false);
 quality.value='auto';e.emit(quality,'change');assert.equal(selected,'auto');t.mock.timers.tick(2600);assert.equal(e.idle(),true);
});
test('鼠标拖动或点击进度后释放焦点，方向键仍控制播放器且控制栏可自动收起',t=>{
 const e=environment(t),seek=e.element('player-seek'),controls=e.element('player-controls');controls.child=seek;
 e.document.activeElement=seek;e.emit(seek,'pointerdown');e.emit(globalThis.window,'pointerup');assert.equal(e.document.activeElement,e.document.body);
 // A browser may focus the range again as its final click default action runs.
 e.document.activeElement=seek;e.emit(seek,'click',{detail:1});assert.equal(e.document.activeElement,e.document.body);
 e.emit(e.document,'keydown',{key:'ArrowRight',target:e.document.body});assert.equal(e.video.currentTime,15);assert.equal(e.document.activeElement,e.document.body);
 e.emit(e.document,'keydown',{key:'ArrowLeft',target:e.document.body});assert.equal(e.video.currentTime,10);
 t.mock.timers.tick(2600);assert.equal(e.idle(),true);
});
test('保留有意的键盘焦点；指针取消也释放滑块，松开时不抢其他控件的焦点',t=>{
 const e=environment(t),seek=e.element('player-seek'),controls=e.element('player-controls');controls.child=seek;seek.keyboard=true;e.document.activeElement=seek;
 e.emit(seek,'click',{detail:0});e.emit(e.document,'keydown',{key:'ArrowRight',target:seek});assert.equal(e.video.currentTime,15);assert.equal(e.document.activeElement,seek);t.mock.timers.tick(3000);assert.equal(e.idle(),false);
 e.emit(seek,'pointerdown');e.emit(globalThis.window,'pointercancel');assert.equal(e.document.activeElement,e.document.body);
 e.emit(seek,'pointerdown');const other=e.element('player-toggle');e.document.activeElement=other;e.emit(globalThis.window,'pointerup');assert.equal(e.document.activeElement,other);
});
