#!/bin/zsh
set -euo pipefail
tv_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$tv_root"
tv_action="${1:-}"

tv_node_ok() {
  [[ -x "$1" ]] && "$1" -e '
    const fs=require("fs"),path=require("path"),cp=require("child_process"),dir=path.dirname(process.execPath);
    if(Number(process.versions.node.split(".")[0])<22)process.exit(1);
    if(process.argv[1]==="--stop")process.exit(0);
    const v=process.versions.node.split(".").map(Number);
    if(v[0]===22&&v[1]<18)process.exit(1);
    try{if(typeof require("node:sqlite").DatabaseSync!=="function")process.exit(1);}catch{process.exit(1);}
    const cli=[path.join(dir,"node_modules/npm/bin/npm-cli.js"),path.join(dir,"../lib/node_modules/npm/bin/npm-cli.js")].find(x=>fs.existsSync(x));
    if(!cli)process.exit(1);
    process.exit(cp.spawnSync(process.execPath,[cli,"--version"],{stdio:"ignore",timeout:15000}).status===0?0:1);
  ' -- "$tv_action" >/dev/null 2>&1
}

tv_node=""
tv_nvm_dir="${NVM_DIR:-$HOME/.nvm}"
for tv_candidate in "$(command -v node || true)" /opt/homebrew/bin/node /usr/local/bin/node "$tv_nvm_dir"/versions/node/v*/bin/node(N); do
  if [[ -n "$tv_candidate" ]] && tv_node_ok "$tv_candidate"; then tv_node="$tv_candidate"; break; fi
done
if [[ -z "$tv_node" ]]; then
  print -u2 '未找到完整的 Node.js 22.18+ / npm / 内置 SQLite。请手动安装兼容 Node.js 后重试：https://nodejs.org/（无需单独安装 sqlite3）'
  exit 1
fi
export PATH="$(dirname "$tv_node"):$PATH"
if [[ "$tv_action" == --stop ]]; then
  exec "$tv_node" "$tv_root/scripts/control.mjs"
fi
exec "$tv_node" "$tv_root/scripts/bootstrap.mjs" "$@"
