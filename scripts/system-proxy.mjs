import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
function proxyUrl(raw){
 try{const url=new URL(/^https?:\/\//i.test(raw)?raw:'http://'+raw);
  if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.pathname!=='/'||url.search||url.hash)return '';
  return url.href;
 }catch{return '';}
}
function bypass(raw){return raw.split(/[;,\n]/).map(x=>x.trim()).filter(Boolean).flatMap(x=>{
 if(x==='<local>')return ['localhost','127.0.0.1','::1'];
 if(x.startsWith('*.'))x=x.slice(1);
 return /^[\w.:[\]-]+$/.test(x)?[x]:[];
}).join(',');}
export function macSystemProxy(text){
 const value=key=>text.match(new RegExp('^\\s*'+key+'\\s*:\\s*(.+)$','m'))?.[1]?.trim()||'';
 const env={};
 for(const [prefix,key] of [['HTTP','HTTP_PROXY'],['HTTPS','HTTPS_PROXY']]){
  const host=value(prefix+'Proxy'),port=Number(value(prefix+'Port'));
  if(value(prefix+'Enable')==='1'&&host&&Number.isInteger(port)&&port>0&&port<65536){
   const url=proxyUrl((host.includes(':')&&!host.startsWith('[')?'['+host+']':host)+':'+port);if(url)env[key]=url;
  }
 }
 const exceptions=text.match(/ExceptionsList\s*:\s*<array>\s*\{([^}]+)\}/)?.[1]||'';
 const noProxy=bypass(exceptions.split('\n').map(line=>line.replace(/^\s*\d+\s*:\s*/,'' )).join('\n'));
 if(noProxy)env.NO_PROXY=noProxy;return env;
}
export function windowsSystemProxy(text){
 const value=key=>text.match(new RegExp('^\\s*'+key+'\\s+REG_\\w+\\s+(.+)$','mi'))?.[1]?.trim()||'';
 if(Number(value('ProxyEnable'))!==1)return {};
 const server=value('ProxyServer'),env={};
 if(server.includes('=')){
  for(const part of server.split(';')){const at=part.indexOf('='),scheme=part.slice(0,at).trim().toLowerCase();
   if(at>0&&['http','https'].includes(scheme)){const url=proxyUrl(part.slice(at+1).trim());if(url)env[scheme.toUpperCase()+'_PROXY']=url;}
  }
 }else{const url=proxyUrl(server);if(url){env.HTTP_PROXY=url;env.HTTPS_PROXY=url;}}
 const noProxy=bypass(value('ProxyOverride'));if(noProxy)env.NO_PROXY=noProxy;return env;
}
export async function systemProxyEnvironment({env=process.env,platform=process.platform,run=execute}={}){
 // Explicit process settings always win; never edit machine settings or evaluate PAC scripts.
 if(['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'].some(k=>env[k]))return {};
 let settings;
 try{
  if(platform==='darwin')settings=macSystemProxy((await run('/usr/sbin/scutil',['--proxy'],{timeout:2000,maxBuffer:65536})).stdout);
  else if(platform==='win32')settings=windowsSystemProxy((await run('reg.exe',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],{timeout:2000,maxBuffer:65536,windowsHide:true})).stdout);
  else return {};
 }catch{return {};}
 if(!settings.HTTP_PROXY&&!settings.HTTPS_PROXY)return {};
 if(env.NO_PROXY||env.no_proxy)delete settings.NO_PROXY;
 else settings.NO_PROXY=[settings.NO_PROXY,'localhost','127.0.0.1','::1'].filter(Boolean).join(',');
 return settings;
}
