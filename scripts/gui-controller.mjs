import {createInterface} from 'node:readline';
import {realpath,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {GuiService} from './gui-service.mjs';

export async function runGuiBridge({root,port=3210,input=process.stdin,output=process.stdout}={}){
 root=await realpath(root);await access(join(root,'server.mjs'));await access(join(root,'scripts/bootstrap.mjs'));
 const send=value=>{if(!output.destroyed)output.write(JSON.stringify(value)+'\n');};
 const service=new GuiService(root,{port,emit:send});
 const lines=createInterface({input,terminal:false});let closing=false,timer;
 const quit=async()=>{if(closing)return;closing=true;try{await service.close();clearInterval(timer);send({type:'closed'});lines.close();input.destroy();}
  catch(error){closing=false;send({type:'error',action:'quit',message:error.message});}};
 lines.on('line',line=>{if(line.length>8192){send({type:'error',message:'控制请求过大。'});return;}
  let body;try{body=JSON.parse(line.replace(/^\uFEFF/,''));}catch{send({type:'error',message:'控制请求无效。'});return;}
  if(!body||typeof body!=='object'||Array.isArray(body)){send({type:'error',message:'控制请求无效。'});return;}
  const actions={start:()=>service.start(body),stop:()=>service.stop(),status:async()=>send(await service.refresh()),quit};
  if(!Object.hasOwn(actions,body.action)){send({type:'error',message:'不支持此操作。'});return;}
  Promise.resolve().then(actions[body.action]).catch(error=>{send({type:'error',action:body.action,message:error.message});send(service.snapshot());});
 });
 lines.on('close',()=>{if(!closing)void quit();});output.on('error',()=>{void quit();});
 for(const name of ['SIGINT','SIGTERM',...(process.platform==='win32'?[]:['SIGHUP'])])process.once(name,()=>{void quit();});
 timer=setInterval(()=>{void service.refresh().catch(e=>send({type:'error',message:e.message}));},1500);
 send(service.snapshot());await service.refresh();return service;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const at=process.argv.indexOf('--root'),root=at>=0?process.argv[at+1]:fileURLToPath(new URL('../',import.meta.url));
 try{await runGuiBridge({root,port:Number(process.env.PORT||3210)});}catch(error){process.stdout.write(JSON.stringify({type:'error',message:error.message})+'\n');process.exitCode=1;}
}
