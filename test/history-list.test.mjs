import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../public/history-ui.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t){
  class Element extends EventTarget {
    constructor(tag='div'){super();this.tagName=tag;this.children=[];this.attributes={};this.value='';this.hidden=false;this.open=false;}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}
    setAttribute(name,value){this.attributes[name]=value;}
    showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}
  }
  const previous={document:globalThis.document,window:globalThis.window},elements=new Map();
  const document=new EventTarget();document.getElementById=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};document.createElement=tag=>new Element(tag);
  globalThis.document=document;globalThis.window=new EventTarget();
  const item={id:'film-1',title:'测试影片',year:'2024',type:'国产剧',lastPlayed:Date.now(),episode:{name:'第01集',position:300,duration:2400,locator:{}}};
  let items=[item],failClear=false;const calls=[],resumed=[];
  const api=async(path,options)=>{
    calls.push({path,options});if(options?.method==='DELETE'){
      if(failClear)throw new Error('数据库不可写');items=[];return {ok:true};
    }
    if(path==='/api/history/latest')return {item:items[0]||null};
    const url=new URL(path,'http://localhost'),q=url.searchParams.get('q')||'';
    const matches=items.filter(i=>i.title.includes(q));return {items:matches,total:matches.length,totalAll:items.length,page:Number(url.searchParams.get('page')||1),pages:3};
  };
  const history=createHistory({api,video:new Element(),resume:id=>resumed.push(id)});
  t.after(()=>{history.dispose();globalThis.document=previous.document;globalThis.window=previous.window;});
  const $=id=>document.getElementById(id),click=e=>e.dispatchEvent(new Event('click'));
  return {history,$,calls,resumed,click,setFailure(){failClear=true;}};
}

test('历史整条记录续播、删除操作独立，首页继续观看按钮保留',async t=>{
  const e=fixture(t);await e.history.refresh();
  const row=e.$('history-list').children[0];assert.equal(row.children[0].tagName,'button');assert.equal(row.children[0].attributes['aria-label'],'继续观看：测试影片');
  e.click(row.children[0]);assert.deepEqual(e.resumed,['film-1']);
  e.click(row.children[1].children[0]);assert.equal(e.$('history-choice').open,true);assert.equal(e.calls.filter(c=>c.options?.method==='DELETE').length,0);
  e.click(e.$('history-choice-actions').children[0]);await tick();assert.deepEqual(e.resumed,['film-1']);
  assert.equal(e.$('continue-card').children[0].children[2].children[0].textContent,'继续观看');
});
test('名称搜索从第一页开始，分页传参；首页卡片不受搜索影响',async t=>{
  const e=fixture(t);await e.history.refresh();e.click(e.$('history-next'));await tick();assert.match(e.calls.at(-2).path,/page=2/);
  e.$('history-search').value='不存在';e.$('history-search-form').dispatchEvent(new Event('submit',{cancelable:true}));await tick();
  assert.match(e.calls.at(-2).path,/page=1/);assert.equal(e.$('history-list').children.length,0);assert.equal(e.$('continue-section').hidden,false);assert.equal(e.$('history-clear').disabled,false);
});
test('清空确认后请求全部删除，取消不删除，成功更新列表和主页卡片',async t=>{
  const e=fixture(t);await e.history.refresh();e.click(e.$('history-clear'));e.click(e.$('history-choice-actions').children[0]);await tick();
  assert.equal(e.calls.filter(c=>c.options?.method==='DELETE').length,0);
  e.click(e.$('history-clear'));assert.match(e.$('history-choice-message').textContent,/包括未显示的记录/);
  e.click(e.$('history-choice-actions').children[1]);await tick();
  assert.equal(e.calls.find(c=>c.options?.method==='DELETE').path,'/api/history');
  assert.equal(e.$('history-list').children.length,0);assert.equal(e.$('continue-section').hidden,true);assert.equal(e.$('history-clear').disabled,true);
});
test('删除失败保留列表，并展示明确错误',async t=>{
  const e=fixture(t);await e.history.refresh();e.setFailure();e.click(e.$('history-clear'));e.click(e.$('history-choice-actions').children[1]);await tick();
  assert.equal(e.$('history-list').children.length,1);assert.equal(e.$('history-message').textContent,'暂时无法删除，请稍后重试。');assert.equal(e.$('history-error-detail').textContent,'数据库不可写');
});
