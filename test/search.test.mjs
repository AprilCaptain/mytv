import test from 'node:test';
import assert from 'node:assert/strict';
import { Discovery } from '../lib/discovery.mjs';

async function events(response) {
  return (await response.text()).trim().split('\n').map(JSON.parse);
}

test('慢源不会阻挡后续源，HTTP 与脚本分开限流，同名结果保留来源', { timeout: 5000 }, async () => {
  const sources=[...Array.from({length:12},(_,i)=>({id:'http'+i,name:'HTTP '+i,kind:'http'})),
    ...Array.from({length:5},(_,i)=>({id:'js'+i,name:'JS '+i,kind:'js'}))];
  let release;const gate=new Promise(resolve=>release=resolve);
  const started=[],active={http:0,js:0},peak={http:0,js:0};
  const discovery=new Discovery({eligible:()=>sources,catalog:async(id)=>{
    const kind=id.startsWith('http')?'http':'js';started.push(id);peak[kind]=Math.max(peak[kind],++active[kind]);
    if(id==='http0'||id==='js0')await gate;
    else await new Promise(resolve=>setTimeout(resolve,5));
    active[kind]--;
    return {list:[{id:'same-id',title:'测试影片'}],page:1,pageCount:3,total:60};
  }});
  const collecting=events(discovery.stream('config','测试',null,[],undefined));
  try {
    for(let i=0;i<100&&(!started.includes('http11')||!started.includes('js4'));i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.ok(started.includes('http11'),'后排 HTTP 源应在慢源结束之前得到执行');
    assert.ok(started.includes('js4'),'脚本队列也应滚动补位');
    assert.ok(peak.http>3&&peak.http<=8);assert.ok(peak.js>1&&peak.js<=4);
  } finally {release();}
  const result=await collecting,items=result.filter(e=>e.type==='results');
  assert.equal(items.length,17);assert.equal(new Set(items.map(e=>e.source)).size,17);
  assert.ok(items.every(e=>e.list[0].id==='same-id'&&e.list[0].source===e.source));
  assert.equal(items[0].pageCount,3);assert.equal(result.at(-1).complete,17);
});

test('取消搜索会停止全部在途任务，也不会继续启动排队的片源', async () => {
  const sources=Array.from({length:15},(_,i)=>({id:String(i),name:'源'+i,kind:'http'}));
  let started=0,aborted=0;
  const discovery=new Discovery({eligible:()=>sources,catalog:(_id,_options,signal)=>{
    started++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(signal.reason);},{once:true}));
  }});
  const reader=discovery.stream('config','测试',null,[],undefined).body.getReader();
  await reader.read();const before=started;assert.ok(before>1);
  await reader.cancel();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(aborted,before);assert.equal(started,before);assert.ok(started<15);
});

test('指定片源分页会保留该页的全部匹配结果，其他源不会收到请求', async () => {
  const calls=[];
  const discovery=new Discovery({eligible:()=>[{id:'one',name:'源一',kind:'http'},{id:'two',name:'源二',kind:'http'}],
    catalog:async(id,options)=>{calls.push({id,options});return {list:Array.from({length:45},(_,i)=>({id:String(i),title:'测试'+i})),page:2,pageCount:4,total:180};}});
  const result=await events(discovery.stream('config','测试',null,[],undefined,'two',2));
  assert.equal(calls.length,1);assert.equal(calls[0].id,'two');assert.equal(calls[0].options.page,2);
  const page=result.find(e=>e.type==='results');assert.equal(page.list.length,45);assert.equal(page.page,2);
});
