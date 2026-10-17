import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {systemProxyEnvironment} from './system-proxy.mjs';

export const RELEASE_PAGE='https://github.com/AprilCaptain/mytv/releases/latest';
const API='https://api.github.com/repos/AprilCaptain/mytv/releases/latest',execute=promisify(execFile);
export function stableVersion(raw){
 const match=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(raw));
 if(!match||match.slice(1).some(x=>!Number.isSafeInteger(Number(x))))throw Error('版本号无效。');
 return match.slice(1).map(Number);
}
export function compareVersions(a,b){const x=stableVersion(a),y=stableVersion(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
export async function projectVersion(root){const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));stableVersion(version);return version;}
export function releaseInfo(current,release,platform=process.platform){
 stableVersion(current);
 if(!release||release.draft||release.prerelease)throw Error('暂时没有正式发布的版本。');
 const version=stableVersion(release.tag_name).join('.'),tag='v'+version;
 const page='https://github.com/AprilCaptain/mytv/releases/tag/'+tag;
 if(release.html_url!==page)throw Error('版本发布信息无法确认，请稍后再试。');
 const filename=platform==='darwin'?'My-TV-macOS.zip':platform==='win32'?'My-TV-Windows.zip':'';
 const asset=release.assets?.find(a=>a.name===filename&&a.state==='uploaded'&&Number(a.size)>0);
 const download='https://github.com/AprilCaptain/mytv/releases/download/'+tag+'/'+filename;
 if(!asset||asset.browser_download_url!==download)throw Error('对应系统的安装包尚未就绪，请稍后再试。');
 return {current,version,available:compareVersions(version,current)>0,url:page,
  notes:typeof release.body==='string'?release.body.split('\n\n## 更新与安装')[0].replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').slice(0,4000):'',
  guide:'更新前请退出旧启动器。将新版解压到新文件夹，在首次运行新版前复制旧目录的整个 data 文件夹，保留旧目录作备份。请勿搬移 .venv，项目依赖会重新准备。'};
}
export async function checkForUpdates(root,{signal,platform=process.platform,env=process.env,run=execute}={}){
 const current=await projectVersion(root),proxy=await systemProxyEnvironment({env,platform});
 // Use the system curl so checking works before npm dependencies are installed.
 // The URL is fixed; remote release notes never control a command or URL to fetch.
 const command=platform==='darwin'?'/usr/bin/curl':platform==='win32'?join(env.SystemRoot||env.WINDIR||'C:\\Windows','System32','curl.exe'):null;
 if(!command)throw Error('请在版本发布页查看最新版本。');
 const merged={...env,...proxy};
 const httpsProxy=merged.https_proxy||merged.HTTPS_PROXY||(merged.MYTV_SYSTEM_PROXY==='1'?'':merged.http_proxy||merged.HTTP_PROXY)||'';
 const fetchEnv={...merged,https_proxy:httpsProxy,HTTPS_PROXY:httpsProxy,all_proxy:'',ALL_PROXY:''};
 let output;
 try{output=(await run(command,['--silent','--show-error','--connect-timeout','5','--max-time','12','--max-redirs','0','--proto','=https',
  '--header','Accept: application/vnd.github+json','--user-agent','My-TV-Updater/'+current,'--write-out','\n%{http_code}',API],
  {env:fetchEnv,signal,timeout:15000,maxBuffer:512*1024,windowsHide:true})).stdout;
 }catch(e){if(signal?.aborted)throw e;throw Error('暂时无法连接 GitHub，请检查网络，或直接打开版本发布页。');}
 const at=output.lastIndexOf('\n'),status=Number(output.slice(at+1));
 if(status===404)throw Error('暂时没有正式发布的版本，请稍后再试。');
 if(status===403||status===429)throw Error('GitHub 暂时限制了检查频率，请稍后再试，或打开版本发布页。');
 if(status!==200)throw Error('暂时无法读取最新版本，请稍后再试。');
 let release;try{release=JSON.parse(output.slice(0,at));}catch{throw Error('版本发布信息无法读取。');}
 return releaseInfo(current,release,platform);
}
