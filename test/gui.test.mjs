import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,symlink,writeFile,rm,readFile,realpath} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import net from 'node:net';import http from 'node:http';import {spawn} from 'node:child_process';
import {GuiService,validPort} from '../scripts/gui-service.mjs';import {managedServer,portAvailable} from '../lib/lifecycle.mjs';
const project=fileURLToPath(new URL('../',import.meta.url)),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function fixture(t,prepare='console.log("环境检查测试通过")'){
 const root=await realpath(await mkdtemp(join(tmpdir(),'My TV 图形测试-')));await mkdir(join(root,'scripts'));await copyFile(join(project,'server.mjs'),join(root,'server.mjs'));
 for(const name of ['lib','public','node_modules','configs'])await symlink(join(project,name),join(root,name),process.platform==='win32'?'junction':'dir');
 await writeFile(join(root,'scripts/bootstrap.mjs'),prepare);t.after(()=>rm(root,{recursive:true,force:true}));return root;
}
async function until(check){for(let i=0;i<150;i++){if(await check())return;await pause(50);}throw new Error('等待图形控制器超时');}
test('图形控制器可启动、复用、停止并关闭服务，关闭后端口释放',async t=>{
 const root=await fixture(t),p=await port(),first=new GuiService(root,{port:p}),second=new GuiService(root,{port:p,prepare:()=>assert.fail('已有实例不应再次准备')});
 t.after(()=>first.close());t.after(()=>second.close());await first.start();assert.equal(first.phase,'running');const original=await managedServer(root,p);assert.ok(original);
 await second.start();assert.equal(second.phase,'running');assert.equal((await managedServer(root,p)).instance,original.instance);
 await assert.rejects(second.start({lan:true}),/先停止/);assert.equal((await managedServer(root,p)).instance,original.instance);
 await second.stop();assert.ok(await portAvailable(p));await first.refresh();assert.equal(first.phase,'stopped');await first.start();assert.equal(first.phase,'running');await first.close();assert.ok(await portAvailable(p));
});
test('启动期间关闭会结束依赖准备及子进程，不能迟到启动服务',async t=>{
 const childCode='process.on("SIGTERM",()=>{});require("node:fs").writeFileSync("preparing-child.pid",String(process.pid));setInterval(()=>{},1000);';
 const root=await fixture(t,`import {spawn} from "node:child_process";spawn(process.execPath,["-e",${JSON.stringify(childCode)}],{stdio:"ignore"});setInterval(()=>{},1000);`),p=await port(),gui=new GuiService(root,{port:p});t.after(()=>gui.close());
 const starting=gui.start();await until(async()=>{try{return Boolean(await readFile(join(root,'preparing-child.pid')));}catch{return false;}});
 const child=Number(await readFile(join(root,'preparing-child.pid'),'utf8'));await gui.close();await starting;await pause(150);assert.ok(await portAvailable(p));
 await until(()=>{try{process.kill(child,0);return false;}catch{return true;}});
});
test('图形控制器不停止其他项目的端口；占用冲突仍允许关闭自己的窗口',async t=>{
 const root=await fixture(t),server=http.createServer((_q,r)=>r.end('other'));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const p=server.address().port;
 const gui=new GuiService(root,{port:p});await gui.start();assert.equal(gui.phase,'error');await gui.close();assert.equal(await(await fetch('http://127.0.0.1:'+p)).text(),'other');
 assert.throws(()=>validPort(-1));assert.throws(()=>validPort('abc'));assert.equal(validPort('3210'),3210);
});
test('原生窗口通过私有标准输入输出控制；窗口意外退出的 EOF 也会停止服务',async t=>{
 const root=await fixture(t),p=await port(),child=spawn(process.execPath,[join(project,'scripts/gui-controller.mjs'),'--root',root],{env:{...process.env,PORT:String(p)},stdio:'pipe'});let output='';child.stdout.setEncoding('utf8');child.stdout.on('data',x=>output+=x);child.stderr.resume();t.after(()=>{if(child.exitCode===null)child.kill();});
 child.stdin.write('null\n[]\n{"action":"__proto__"}\n{"action":"start"}\n');await until(()=>managedServer(root,p));assert.match(output,/控制请求无效/);
 child.stdin.end();await until(()=>child.exitCode!==null);assert.equal(child.exitCode,0);assert.ok(await portAvailable(p));assert.match(output,/"type":"closed"/);
});
