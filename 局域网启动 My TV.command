#!/bin/zsh
tv_root="$(cd "$(dirname "$0")" && pwd)" || exit 1
exec /bin/zsh "$tv_root/scripts/bootstrap-macos.sh" --lan "$@"
