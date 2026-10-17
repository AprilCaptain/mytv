import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Generated files are committed: normal builds on either platform need no image tools.
if(process.platform!=='darwin')throw new Error('图标重新生成使用 macOS 系统绘图工具；普通构建直接使用已提交的图标。');
const root=fileURLToPath(new URL('../',import.meta.url)),assets=join(root,'launcher/assets');
const temp=await mkdtemp(join(tmpdir(),'mytv-icons-'));
function run(command,args){const r=spawnSync(command,args,{stdio:'inherit'});if(r.error||r.status!==0)throw new Error(r.error?.message||'图标生成失败');}
try{
 const renderer=join(temp,'render');run('/usr/bin/clang',['-fobjc-arc','-O2',join(assets,'render-icons.m'),'-o',renderer,'-framework','AppKit']);run(renderer,[temp]);
 const iconset=join(temp,'MyTV.iconset');await mkdir(iconset);
 for(const size of [16,32,128,256,512])for(const retina of [1,2])await copyFile(join(temp,`icon-${size*retina}.png`),join(iconset,`icon_${size}x${size}${retina===2?'@2x':''}.png`));
 run('/usr/bin/iconutil',['-c','icns',iconset,'-o',join(assets,'MyTV.icns')]);
 await copyFile(join(temp,'icon-1024.png'),join(assets,'icon.png'));
 await copyFile(join(temp,'icon-256.png'),join(assets,'icon-preview.png'));
 const sizes=[16,20,24,32,40,48,64,128,256],pngs=await Promise.all(sizes.map(s=>readFile(join(temp,`icon-${s}.png`))));
 const directory=Buffer.alloc(6+16*sizes.length);directory.writeUInt16LE(1,2);directory.writeUInt16LE(sizes.length,4);let offset=directory.length;
 pngs.forEach((png,i)=>{const entry=6+i*16,size=sizes[i];directory[entry]=directory[entry+1]=size===256?0:size;directory.writeUInt16LE(1,entry+4);directory.writeUInt16LE(32,entry+6);directory.writeUInt32LE(png.length,entry+8);directory.writeUInt32LE(offset,entry+12);offset+=png.length;});
 await writeFile(join(assets,'MyTV.ico'),Buffer.concat([directory,...pngs]));
 console.log('已生成 macOS / Windows 多尺寸图标与预览。');
}finally{await rm(temp,{recursive:true,force:true});}
