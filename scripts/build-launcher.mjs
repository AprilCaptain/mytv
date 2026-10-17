import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),at=process.argv.indexOf('--out'),out=at>=0?resolve(process.argv[at+1]):root;
await mkdir(out,{recursive:true});
function run(command,args){const r=spawnSync(command,args,{cwd:root,stdio:'inherit',windowsHide:true,timeout:120000});if(r.error||r.status!==0)throw new Error('启动器编译失败：'+(r.error?.message||r.status));}
if(process.platform==='darwin'){
 const contents=join(out,'My TV.app','Contents');await mkdir(join(contents,'MacOS'),{recursive:true});await mkdir(join(contents,'Resources'),{recursive:true});
 await copyFile(join(root,'launcher/assets/MyTV.icns'),join(contents,'Resources/MyTV.icns'));
 run('/usr/bin/clang',['-fobjc-arc','-O2','-arch','arm64','-arch','x86_64','-mmacosx-version-min=12.0',join(root,'launcher/macos/main.m'),'-o',join(contents,'MacOS/MyTV'),'-framework','AppKit']);
 await writeFile(join(contents,'Info.plist'),'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>MyTV</string><key>CFBundleIdentifier</key><string>local.mytv.launcher</string><key>CFBundleName</key><string>My TV</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>2</string><key>CFBundleIconFile</key><string>MyTV.icns</string><key>NSDocumentsFolderUsageDescription</key><string>读取 My TV 项目与保存观看历史。</string><key>NSHighResolutionCapable</key><true/><key>LSMinimumSystemVersion</key><string>12.0</string></dict></plist>');
 run('/usr/bin/codesign',['--force','--sign','-',join(out,'My TV.app')]);
 console.log('已生成：'+join(out,'My TV.app'));
}else if(process.platform==='win32'){
 const system=process.env.WINDIR||'C:\\Windows',csc=['Framework64','Framework'].map(d=>join(system,'Microsoft.NET',d,'v4.0.30319','csc.exe')).find(existsSync);
 if(!csc)throw new Error('未找到系统 .NET Framework C# 编译器，请使用 GitHub Actions 生成的 Windows 启动器。');
 run(csc,['/nologo','/codepage:65001','/target:winexe','/win32icon:'+join(root,'launcher/assets/MyTV.ico'),'/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/out:'+join(out,'My TV.exe'),join(root,'launcher/windows/MyTV.cs')]);
 console.log('已生成：'+join(out,'My TV.exe'));
}else throw new Error('图形启动器支持 macOS 和 Windows。');
