import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeRasterTs} from '../lib/segment-stream.mjs';
const segment=()=>{const b=Buffer.alloc(188*12,32);for(let i=0;i<12;i++)b[i*188]=71;return b;};
test('仅对图片前缀后有连续 TS 同步包的数据移除前缀，并移除失效长度头',async()=>{
 const prefix=Buffer.alloc(120);Buffer.from([137,80,78,71,13,10,26,10]).copy(prefix);const bytes=segment(),input=Buffer.concat([prefix,bytes]);
 const output=await normalizeRasterTs(new Response(input,{status:206,headers:{'content-type':'image/png','content-length':String(input.length),'content-range':'bytes 0-2375/2376','accept-ranges':'bytes'}}));
 assert.equal(output.status,200);assert.equal(output.headers.get('content-length'),null);assert.equal(output.headers.get('content-range'),null);assert.deepEqual(Buffer.from(await output.arrayBuffer()),bytes);
});
test('真实图片、加密数据与原始 TS 不被错误截断，取消仍传到上游',async()=>{
 for(const data of [Buffer.from([137,80,78,71,13,10,26,10]),segment(),Buffer.alloc(1500,9)]){
  const output=await normalizeRasterTs(new Response(data,{headers:{'content-type':'image/png','content-length':String(data.length)}}));assert.deepEqual(Buffer.from(await output.arrayBuffer()),data);assert.equal(output.headers.get('content-length'),String(data.length));
 }
 let cancelled=false;const bytes=segment(),output=await normalizeRasterTs(new Response(new ReadableStream({start(c){c.enqueue(bytes);},cancel(){cancelled=true;}}),{headers:{'content-type':'image/png'}}));await output.body.cancel();assert.equal(cancelled,true);
});
