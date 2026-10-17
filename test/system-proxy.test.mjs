import test from 'node:test';import assert from 'node:assert/strict';
import {macSystemProxy,windowsSystemProxy,systemProxyEnvironment} from '../scripts/system-proxy.mjs';
import {loadPoster} from '../public/poster.js';
const mac=`<dictionary> {
 HTTPEnable : 1
 HTTPProxy : 127.0.0.1
 HTTPPort : 10808
 HTTPSEnable : 1
 HTTPSProxy : ::1
 HTTPSPort : 10808
 ExceptionsList : <array> {
  0 : *.example.org
  1 : localhost
 }
}`;
test('启动器只沿用已启用的系统 HTTP 代理，不执行 PAC 或修改机器设置',async()=>{
 const m=macSystemProxy(mac);assert.equal(m.HTTP_PROXY,'http://127.0.0.1:10808/');assert.equal(m.HTTPS_PROXY,'http://[::1]:10808/');assert.match(m.NO_PROXY,/\.example.org/);
 assert.deepEqual(macSystemProxy('ProxyAutoConfigEnable : 1\nSOCKSEnable : 1\nHTTPEnable : 0\nHTTPProxy : 127.0.0.1\nHTTPPort : 10808'),{});
 const win='ProxyEnable    REG_DWORD    0x1\nProxyServer    REG_SZ    http=127.0.0.1:10808;https=proxy.example:3128;socks=localhost:1080\nProxyOverride    REG_SZ    *.example.org;<local>';
 assert.equal(windowsSystemProxy(win).HTTPS_PROXY,'http://proxy.example:3128/');assert.match(windowsSystemProxy(win).NO_PROXY,/localhost/);
 assert.deepEqual(windowsSystemProxy(win.replace('0x1','0x0')),{});
 assert.equal(windowsSystemProxy('ProxyEnable REG_DWORD 0x1\nProxyServer REG_SZ 127.0.0.1:8888').HTTPS_PROXY,'http://127.0.0.1:8888/');
 const calls=[];const result=await systemProxyEnvironment({env:{},platform:'darwin',run:async(c,a)=>{calls.push([c,a]);return {stdout:mac};}});
 assert.equal(result.HTTP_PROXY,m.HTTP_PROXY);assert.match(result.NO_PROXY,/127.0.0.1/);assert.deepEqual(calls,[['/usr/sbin/scutil',['--proxy']]]);
 assert.deepEqual(await systemProxyEnvironment({env:{https_proxy:'http://explicit.example:80'},platform:'darwin',run:()=>assert.fail('显式配置不读取系统代理')}),{});
 const explicit=await systemProxyEnvironment({env:{no_proxy:'chosen.example'},platform:'darwin',run:async()=>({stdout:mac})});assert.equal(explicit.NO_PROXY,undefined);
 assert.deepEqual(await systemProxyEnvironment({env:{},platform:'win32',run:async()=>{throw Error('Unavailable');}}),{});
});
test('封面暂时失败仅重试一次；离开页面不再请求，永久失败保留占位图',()=>{
 const fake=()=>({isConnected:true,events:{},getAttribute(){return this.src;},addEventListener(n,f){this.events[n]=f;}});
 const img=fake(),tasks=[];loadPoster(img,'https://cdn.example/cover.jpg',{schedule:f=>tasks.push(f)});const original=img.src;
 assert.match(original,/^\/api\/poster\?/);img.events.error();assert.equal(img.src,'/placeholder.svg');assert.equal(tasks.length,1);
 tasks[0]();assert.equal(img.src,original);img.events.error();assert.equal(img.src,'/placeholder.svg');assert.equal(tasks.length,1);img.events.error();assert.equal(tasks.length,1);
 const gone=fake();loadPoster(gone,'https://cdn.example/a.jpg',{schedule:f=>tasks.push(f)});gone.events.error();gone.isConnected=false;tasks[1]();assert.equal(gone.src,'/placeholder.svg');
 const empty=fake();loadPoster(empty,'',{schedule:()=>assert.fail('空封面不重试')});empty.events.error();assert.equal(empty.src,'/placeholder.svg');
});
