$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$tvRoot = $env:MYTV_LAUNCH_ROOT
if (-not $tvRoot) { $tvRoot = Split-Path $PSScriptRoot -Parent }
Set-Location -LiteralPath $tvRoot

function Test-TvNode([string]$Candidate) {
    if (-not $Candidate -or -not (Test-Path -LiteralPath $Candidate -PathType Leaf)) { return $false }
    try {
        & $Candidate -e "const fs=require('fs'),path=require('path'),cp=require('child_process'),dir=path.dirname(process.execPath);const npm=[path.join(dir,'node_modules/npm/bin/npm-cli.js'),path.join(dir,'../lib/node_modules/npm/bin/npm-cli.js')];const v=process.versions.node.split('.').map(Number);if(v[0]<22)process.exit(1);if(process.argv[1]==='--stop')process.exit(0);if(v[0]===22&&v[1]<18)process.exit(1);try{if(typeof require('node:sqlite').DatabaseSync!=='function')process.exit(1)}catch{process.exit(1)}const cli=npm.find(x=>fs.existsSync(x));if(!cli)process.exit(1);process.exit(cp.spawnSync(process.execPath,[cli,'--version'],{stdio:'ignore',timeout:15000}).status===0?0:1)" -- $env:MYTV_LAUNCH_ACTION *> $null
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}

try {
    $tvNode = $null
    $tvSystemNode = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($tvSystemNode -and (Test-TvNode $tvSystemNode.Source)) { $tvNode = $tvSystemNode.Source }
    if (-not $tvNode) { throw '未找到完整的 Node.js 22.18+ / npm / 内置 SQLite。请手动安装兼容 Node.js 后重试：https://nodejs.org/（无需单独安装 sqlite3）' }
    $env:PATH = (Split-Path $tvNode -Parent) + ';' + $env:PATH
    if ($env:MYTV_LAUNCH_ACTION -eq '--stop') {
        & $tvNode (Join-Path $tvRoot 'scripts\control.mjs')
    } else {
        & $tvNode (Join-Path $tvRoot 'scripts\bootstrap.mjs')
    }
    exit $LASTEXITCODE
} catch {
    Write-Host ('启动失败：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
