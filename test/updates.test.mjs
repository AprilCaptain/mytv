import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {releaseInfo,compareVersions,checkForUpdates} from '../scripts/updates.mjs';
import {publishRelease,verifyTag} from '../scripts/publish-release.mjs';import {APP_VERSION} from '../lib/version.mjs';

function release(version='0.4.0'){
 const tag='v'+version;return {tag_name:tag,html_url:'https://github.com/AprilCaptain/mytv/releases/tag/'+tag,draft:false,prerelease:false,
  body:'改进播放与封面。\n\n## 更新与安装\n安装指引\nSHA256 ...',assets:['macOS','Windows'].map(platform=>({name:'My-TV-'+platform+'.zip',state:'uploaded',size:100,
   browser_download_url:'https://github.com/AprilCaptain/mytv/releases/download/'+tag+'/My-TV-'+platform+'.zip'}))};
}
test('更新使用语义版本比较、过滤草稿和预发布、校验官方页面及平台包',()=>{
 assert.equal(compareVersions('0.10.0','0.9.9'),1);assert.equal(compareVersions('v1.0.0','1.0.0'),0);assert.equal(compareVersions('0.4.0','1.0.0'),-1);
 assert.throws(()=>compareVersions('0.4.0-beta','0.3.0'));const info=releaseInfo('0.3.0',release(),'darwin');assert.equal(info.available,true);assert.equal(info.notes,'改进播放与封面。');assert.match(info.guide,/首次运行/);
 assert.equal(releaseInfo('0.4.0',release(),'win32').available,false);assert.equal(releaseInfo('0.5.0',release(),'win32').available,false);
 assert.throws(()=>releaseInfo('0.3.0',{...release(),draft:true},'darwin'));
 assert.throws(()=>releaseInfo('0.3.0',{...release(),prerelease:true},'darwin'));
 assert.throws(()=>releaseInfo('0.3.0',{...release(),html_url:'https://evil.example/'},'darwin'));
 assert.throws(()=>releaseInfo('0.3.0',{...release(),assets:[]},'darwin'));
 const malicious=release();malicious.assets[0].browser_download_url='file:///tmp/script';assert.throws(()=>releaseInfo('0.3.0',malicious,'darwin'));
});
test('无项目依赖时也能检查更新，URL 与命令固定，限流和坏响应不会下载代码',async t=>{
 const root=await mkdtemp(join(tmpdir(),'mytv-update-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(join(root,'package.json'),'{"version":"0.3.0"}');
 const env={HTTPS_PROXY:'http://proxy.example:8080'},calls=[];
 const result=await checkForUpdates(root,{platform:'darwin',env,run:async(command,args,opts)=>{calls.push({command,args,opts});return {stdout:JSON.stringify(release())+'\n200'};}});
 assert.equal(result.available,true);assert.equal(calls[0].command,'/usr/bin/curl');assert.equal(calls[0].args.at(-1),'https://api.github.com/repos/AprilCaptain/mytv/releases/latest');assert.equal(calls[0].opts.env.https_proxy,env.HTTPS_PROXY);assert.equal(calls[0].opts.env.ALL_PROXY,'');
 for(const status of [403,429,404,500])await assert.rejects(checkForUpdates(root,{platform:'darwin',env,run:async()=>({stdout:'{}\n'+status})}));
 await assert.rejects(checkForUpdates(root,{platform:'darwin',env,run:async()=>({stdout:'broken\n200'})}),/发布信息/);
 const abort=new AbortController();abort.abort();await assert.rejects(checkForUpdates(root,{signal:abort.signal,platform:'darwin',env,run:async()=>{throw abort.signal.reason;}}),/aborted/);
});
test('Release 两个平台上传完毕才公开，失败保留草稿、不覆盖已公开版本',async()=>{
 const tag='v'+APP_VERSION,bytes=Buffer.concat([Buffer.from('PK'),Buffer.alloc(110)]),calls=[];
 const read=async(path,encoding)=>encoding?'版本改进说明。':bytes;
 const request=async(url,opts)=>{calls.push({url,...opts});
  if(opts.method==='GET')return new Response('',{status:404});
  return Response.json(opts.method==='PATCH'?{id:12,draft:false,html_url:'https://github.com/AprilCaptain/mytv/releases/tag/'+tag}:{id:12,draft:true,assets:[]});};
 const result=await publishRelease({repo:'AprilCaptain/mytv',tag,token:'test-token',read,request});assert.equal(result.draft,false);
 assert.equal(calls.length,5);assert.equal(JSON.parse(calls[1].body).draft,true);assert.match(calls[2].url,/uploads\.github\.com.*macOS/);assert.match(calls[3].url,/Windows/);assert.equal(JSON.parse(calls[4].body).draft,false);assert.match(JSON.parse(calls[4].body).body,/SHA256/);
 let published=false;
 await assert.rejects(publishRelease({repo:'AprilCaptain/mytv',tag,token:'test-token',read,request:async(url,opts)=>{
  if(opts.method==='PATCH')published=true;if(url.includes('uploads.github.com'))return new Response('',{status:500});return request(url,opts);
 }}),/发布请求失败/);assert.equal(published,false);
 await assert.rejects(publishRelease({repo:'AprilCaptain/mytv',tag,token:'test-token',read,request:async()=>Response.json({draft:false,assets:[]})}),/不能覆盖/);
 assert.throws(()=>verifyTag('v999.0.0'),/标签必须/);
});
