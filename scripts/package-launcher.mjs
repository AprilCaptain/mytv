import {spawnSync} from 'node:child_process';
import {mkdir,cp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Stage only repository files, never local dependencies, credentials or history.
const root=fileURLToPath(new URL('../',import.meta.url));
function run(command,args,options={}){
 const result=spawnSync(command,args,{cwd:root,windowsHide:true,encoding:'utf8',...options});
 if(result.error||result.status!==0)throw new Error(result.error?.message||result.stderr||'打包失败');
 return result.stdout;
}
const platform=process.platform==='darwin'?'macOS':process.platform==='win32'?'Windows':null;
if(!platform)throw new Error('图形启动器支持 macOS 和 Windows。');
run(process.execPath,[join(root,'scripts/build-launcher.mjs')],{stdio:'inherit'});
const dist=join(root,'dist'),stage=join(dist,'staging'),project=join(stage,'My TV');
await rm(stage,{recursive:true,force:true});await mkdir(project,{recursive:true});
const files=run('git',['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean);
for(const file of new Set(files)){
 if(/^(?:data|\.runtime|\.venv|node_modules|test-results|dist|\.git)(?:\/|$)/.test(file))continue;
 await cp(join(root,file),join(project,file),{recursive:true,preserveTimestamps:true});
}
await cp(join(root,platform==='macOS'?'My TV.app':'My TV.exe'),join(project,platform==='macOS'?'My TV.app':'My TV.exe'),{recursive:true});
const archive=join(dist,'My-TV-'+platform+'.zip');await rm(archive,{force:true});
if(platform==='macOS')run('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',project,archive]);
else run('tar.exe',['-a','-c','-f',archive,'-C',stage,'My TV']);
console.log('已打包：'+archive);
