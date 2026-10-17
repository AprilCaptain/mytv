import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {APP_VERSION} from '../lib/version.mjs';

export function verifyTag(tag,version=APP_VERSION){if(tag!=='v'+version||!/^v\d+\.\d+\.\d+$/.test(tag))throw Error('发布标签必须与 package.json 版本一致：v'+version);return tag;}
export async function publishRelease({repo,tag,token,request=fetch,read=readFile,root=fileURLToPath(new URL('../',import.meta.url))}){
 verifyTag(tag);if(!/^[\w.-]+\/[\w.-]+$/.test(repo)||!token)throw Error('发布环境不完整。');
 const base='https://api.github.com/repos/'+repo,headers={authorization:'Bearer '+token,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'My-TV-Release'};
 async function api(url,{method='GET',body,raw=false,allow404=false}={}){
  const r=await request(url,{method,redirect:'error',signal:AbortSignal.timeout(60000),headers:{...headers,...(body?{'content-type':raw?'application/zip':'application/json'}:{})},body:body?(raw?body:JSON.stringify(body)):undefined});
  if(allow404&&r.status===404)return null;if(!r.ok)throw Error('GitHub 发布请求失败（HTTP '+r.status+'）。');return r.status===204?null:r.json();
 }
 // Read both platform files before creating anything visible on GitHub.
 const files=await Promise.all(['My-TV-macOS.zip','My-TV-Windows.zip'].map(async name=>({name,bytes:await read(resolve(root,'dist',name))})));
 if(files.some(f=>f.bytes.length<100||f.bytes.subarray(0,2).toString()!=='PK'))throw Error('发布包不是有效 ZIP。');
 let notes;try{notes=await read(resolve(root,'docs/releases',tag+'.md'),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;notes='本次版本包含功能与稳定性更新。';}
 const body=notes+'\n\n## 更新与安装\n下载对应系统的完整 ZIP 包。更新前停止旧服务，新版解压到新目录，仅复制旧目录的 data 文件夹以保留历史；依赖由启动器重新准备。\n\nSHA256\n'+files.map(f=>f.name+'  '+createHash('sha256').update(f.bytes).digest('hex')).join('\n');
 let release=await api(base+'/releases/tags/'+tag,{allow404:true});
 if(release&&!release.draft){
  if(files.every(f=>release.assets?.some(a=>a.name===f.name&&a.state==='uploaded'&&a.size===f.bytes.length&&a.digest==='sha256:'+createHash('sha256').update(f.bytes).digest('hex')))){console.log('此版本已经完整发布：'+release.html_url);return release;}
  throw Error('此版本已经发布，不能覆盖。请使用新的版本号。');
 }
 if(!release)release=await api(base+'/releases',{method:'POST',body:{tag_name:tag,name:'My TV '+tag,body,draft:true,prerelease:false}});
 for(const file of files){
  const old=release.assets?.find(a=>a.name===file.name);if(old)await api(base+'/releases/assets/'+old.id,{method:'DELETE'});
  await api('https://uploads.github.com/repos/'+repo+'/releases/'+release.id+'/assets?name='+encodeURIComponent(file.name),{method:'POST',body:file.bytes,raw:true});
 }
 const published=await api(base+'/releases/'+release.id,{method:'PATCH',body:{body,draft:false,make_latest:'true'}});
 console.log('已发布：'+published.html_url);return published;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 if(process.argv.includes('--verify-tag')){verifyTag(process.env.GITHUB_REF_NAME);console.log('发布标签与版本一致。');}
 else await publishRelease({repo:process.env.GITHUB_REPOSITORY,tag:process.env.GITHUB_REF_NAME,token:process.env.GITHUB_TOKEN});
}
