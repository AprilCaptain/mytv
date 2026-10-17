import {spawn,execFile} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {managedServer,portAvailable,stopServer} from '../lib/lifecycle.mjs';
import {serverAddresses} from '../lib/network-mode.mjs';

const delay=ms=>new Promise(r=>setTimeout(r,ms));
const exited=child=>!child||child.exitCode!==null||child.signalCode!==null;
export function validPort(value){const port=Number(value);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('端口必须是 1–65535 之间的整数。');return port;}
export async function terminateTree(child){
 if(!child?.pid)return;
 const alive=()=>{if(process.platform==='win32')return !exited(child);try{process.kill(-child.pid,0);return true;}catch{return !exited(child);}};
 if(!alive())return;
 if(process.platform==='win32')await new Promise(resolve=>execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:5000},()=>resolve()));
 else {try{process.kill(-child.pid,'SIGTERM');}catch{try{child.kill('SIGTERM');}catch{}}}
 for(let i=0;i<50&&alive();i++)await delay(100);
 if(alive()&&process.platform!=='win32'){
  try{process.kill(-child.pid,'SIGKILL');}catch{try{child.kill('SIGKILL');}catch{}}
  for(let i=0;i<30&&alive();i++)await delay(100);
 }
 if(alive())throw new Error('进程尚未结束，请稍后再试。');
}
export class GuiService {
 constructor(root,{port=3210,emit=()=>{},prepare}={}){
  this.root=resolve(root);this.port=validPort(port);this.lan=false;this.emit=emit;this.prepare=prepare;
  this.busy=false;this.closing=false;this.generation=0;this.phase='stopped';this.message='服务未启动';this.control=null;
 }
 snapshot(){return {type:'state',phase:this.phase,message:this.message,port:this.port,lan:this.lan,url:'http://127.0.0.1:'+this.port,
  addresses:this.lan?serverAddresses(this.port,true).urls:[],root:this.root};}
 state(phase,message){this.phase=phase;this.message=message;this.emit(this.snapshot());}
 log(message){this.emit({type:'log',message:String(message).slice(0,4000)});}
 attachLogs(child){for(const stream of [child.stdout,child.stderr]){if(!stream)continue;stream.setEncoding('utf8');let pending='';
  stream.on('data',chunk=>{pending+=chunk;let n;while((n=pending.indexOf('\n'))>=0){this.log(pending.slice(0,n));pending=pending.slice(n+1);}if(pending.length>16000){this.log(pending);pending='';}});
  stream.on('end',()=>{if(pending)this.log(pending);});}}
 process(script,args=[],env={}){
  const child=spawn(process.execPath,[join(this.root,script),...args],{cwd:this.root,env:{...process.env,PATH:dirname(process.execPath)+(process.platform==='win32'?';':':')+(process.env.PATH||''),...env},
   detached:process.platform!=='win32',windowsHide:true,stdio:['ignore','pipe','pipe']});
  this.attachLogs(child);return child;
 }
 async refresh(){if(this.busy||this.closing)return this.snapshot();const generation=this.generation,active=await managedServer(this.root,this.port);
  if(this.busy||this.closing||generation!==this.generation)return this.snapshot();
  const available=active?false:await portAvailable(this.port);
  if(this.busy||this.closing||generation!==this.generation)return this.snapshot();
  if(active){this.control=active;this.lan=active.mode==='lan';if(this.phase!=='running')this.state('running','服务正在运行');}
  else if(available){this.control=null;if(this.phase==='running'||this.phase==='occupied')this.state('stopped','服务已停止，端口已释放');}
  else if(this.phase!=='occupied')this.state('occupied','此端口被其他程序或无法确认的服务占用，请更换端口。');
  return this.snapshot();
 }
 async start({port=this.port,lan=false}={}){
  if(this.closing||this.busy)return;
  const target=validPort(port);if(this.phase==='running'&&(target!==this.port||Boolean(lan)!==this.lan))throw new Error('请先停止当前服务，再更改端口或访问模式。');
  if(typeof lan!=='boolean')throw new Error('访问模式无效。');
  this.port=target;this.lan=Boolean(lan);this.busy=true;const token=++this.generation;
  try{
   let active=await managedServer(this.root,this.port);
   if(token!==this.generation||this.closing)return;
   if(active){if((active.mode==='lan')!==this.lan)throw new Error('已有服务的访问模式不同，请先停止再启动。');this.control=active;this.state('running','已连接到正在运行的 My TV');return;}
   if(!await portAvailable(this.port))throw new Error('端口被其他程序占用，请更换端口。');
   if(token!==this.generation||this.closing)return;
   this.state('preparing','正在检查环境与项目依赖…');
   if(this.prepare)await this.prepare();else{
    const child=this.preparing=this.process('scripts/bootstrap.mjs',['--setup-only'],{MYTV_NO_BROWSER:'1',PORT:String(this.port)});
    await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('环境准备未完成，请查看下方日志。')));});
    if(this.preparing===child)this.preparing=null;
   }
   if(token!==this.generation||this.closing)return;
   active=await managedServer(this.root,this.port);
   if(active){if((active.mode==='lan')!==this.lan)throw new Error('已有服务的访问模式不同，请先停止再启动。');this.control=active;this.state('running','已连接到正在运行的 My TV');return;}
   if(!await portAvailable(this.port))throw new Error('端口已被占用，请更换端口。');
   if(token!==this.generation||this.closing)return;
   this.state('starting','正在启动 My TV…');
   const child=this.serverChild=this.process('server.mjs',[],{PORT:String(this.port),HOST:this.lan?'0.0.0.0':'127.0.0.1',MYTV_LAN:this.lan?'1':'0'});
   child.on('error',error=>this.log(error.message));
   for(let i=0;i<75&&token===this.generation&&!this.closing;i++){
    active=await managedServer(this.root,this.port);if(active)break;if(exited(child))break;await delay(150);
   }
   if(token!==this.generation||this.closing)return;
   if(!active)throw new Error('服务未能启动，请查看下方日志。');
   if((active.mode==='lan')!==this.lan)throw new Error('启动期间出现了不同访问模式的服务，请先停止后重试。');
   this.control=active;this.state('running','服务已就绪');
  }catch(error){if(token===this.generation&&!this.closing){await terminateTree(this.serverChild);this.state('error',error.message);this.log(error.message);}}
  finally{if(token===this.generation)this.busy=false;}
 }
 async stop(){
  if(this.stopping)return this.stopping;
  const work=async()=>{this.generation++;this.busy=true;this.state('stopping','正在停止并释放端口…');
   try{await terminateTree(this.preparing);this.preparing=null;const active=await managedServer(this.root,this.port);
    if(active)await stopServer(this.root,this.port,active.instance);
    await terminateTree(this.serverChild);this.serverChild=null;
    if(!await portAvailable(this.port))throw new Error('端口仍被其他进程占用，未停止无法确认为当前项目的进程。');
    this.control=null;this.state('stopped','服务已停止，端口已释放');
   }catch(error){this.state('error',error.message);throw error;}finally{this.busy=false;}
  };this.stopping=work();try{return await this.stopping;}finally{this.stopping=null;}
 }
 async close(){this.closing=true;try{
  if(exited(this.preparing)&&exited(this.serverChild)&&!await managedServer(this.root,this.port))return;
  await this.stop();
 }catch(e){this.closing=false;throw e;}}
}
