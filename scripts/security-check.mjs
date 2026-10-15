import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { npmCli } from './environment.mjs';
import { remoteFetch } from '../lib/network.mjs';
import { readText } from '../lib/util.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
function run(args){const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true,timeout:120_000});if(result.error||result.status!==0)throw new Error('安全检查未通过或未完成，请查看上方结果。');}
try{
  run(['--test','test/security.test.mjs']);
  const npm=npmCli();if(!npm)throw new Error('未找到 npm，请先修复 Node.js 安装。');
  run([npm,'audit','--omit=dev','--audit-level=low']);
  const lines=(await readFile(new URL('../requirements.lock.txt',import.meta.url),'utf8')).split(/\r?\n/).filter(line=>line.trim()&&!line.startsWith('#'));
  const requirements=lines.map(line=>{const match=/^([\w.-]+)==([^\s;]+)$/.exec(line.trim());if(!match)throw new Error('Python 依赖锁格式无效。');return {name:match[1],version:match[2]};});
  const response=await remoteFetch('https://api.osv.dev/v1/querybatch',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({queries:requirements.map(({name,version})=>({package:{name,ecosystem:'PyPI'},version}))}),signal:AbortSignal.timeout(20_000)});
  if(!response.ok){await response.body?.cancel();throw new Error('Python 漏洞库查询失败（HTTP '+response.status+'），检查未完成。');}
  const result=JSON.parse(await readText(response,2*1024*1024));
  if(!Array.isArray(result.results)||result.results.length!==requirements.length)throw new Error('Python 漏洞库响应不完整，检查未完成。');
  const issues=result.results.flatMap((r,i)=>(r.vulns||[]).map(v=>requirements[i].name+' '+requirements[i].version+'：'+v.id));
  if(issues.length)throw new Error('Python 依赖发现已知漏洞：\n'+issues.join('\n'));
  if(result.results.some(r=>r.next_page_token))throw new Error('Python 漏洞库结果需要继续分页，检查未完成。');
  console.log('Python 锁定依赖未命中 OSV 已知漏洞（'+requirements.length+' 项）。');
  console.log('检查通过。此结果不代表第三方片源可信，也不包含 Node / Python / 操作系统本身的漏洞。');
}catch(error){console.error(error.message);process.exitCode=1;}
