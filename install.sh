#!/bin/sh
set -eu

PLUGIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
HARNESS_ROOT=${DSHX_HARNESS:-}
WEB_PORT=${DSH_WEB_PORT:-43127}

fail() {
  printf '%s\n' "INSTALL_FAILED: $*" >&2
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "当前发布包只支持 macOS。"
[ "$(uname -m)" = "arm64" ] || fail "当前发布包只支持 Apple Silicon。"
command -v node >/dev/null 2>&1 || fail "找不到 Node.js。"
command -v pnpm >/dev/null 2>&1 || fail "找不到 pnpm。"

if [ -z "$HARNESS_ROOT" ]; then
  CONFIGURED_HARNESS="$HOME/.config/dshx/harness"
  [ -f "$CONFIGURED_HARNESS" ] || fail "dshx 尚未记录 Harness 路径；请设置 DSHX_HARNESS。"
  HARNESS_ROOT=$(sed -n '1p' "$CONFIGURED_HARNESS")
fi
[ -d "$HARNESS_ROOT" ] || fail "Harness 路径不存在：$HARNESS_ROOT"
HARNESS_ROOT=$(CDPATH= cd -- "$HARNESS_ROOT" && pwd)

DSHX="$HARNESS_ROOT/tools/dshx/skill/dshx/scripts/dshx.sh"
[ -x "$DSHX" ] || fail "找不到可执行的 dshx：$DSHX"
[ -f "$PLUGIN_DIR/lib/dsh-dragndrop-attachments.js" ] || fail "发布包缺少 Host bundle。"
[ -f "$PLUGIN_DIR/lib/client.js" ] || fail "发布包缺少 client bundle。"

mkdir -p "$HARNESS_ROOT/my-plugins"
PLUGIN_LINK="$HARNESS_ROOT/my-plugins/dsh-dragndrop-attachments"
if [ -L "$PLUGIN_LINK" ]; then
  CURRENT_LINK=$(readlink "$PLUGIN_LINK")
  case "$CURRENT_LINK" in
    /*) CURRENT_TARGET=$CURRENT_LINK ;;
    *) CURRENT_TARGET=$(CDPATH= cd -- "$(dirname -- "$PLUGIN_LINK")/$(dirname -- "$CURRENT_LINK")" && pwd)/$(basename -- "$CURRENT_LINK") ;;
  esac
  [ "$CURRENT_TARGET" = "$PLUGIN_DIR" ] || fail "已有同名插件指向其他目录：$CURRENT_TARGET"
elif [ -e "$PLUGIN_LINK" ]; then
  fail "已有非符号链接路径：$PLUGIN_LINK"
else
  ln -s "$PLUGIN_DIR" "$PLUGIN_LINK"
fi

pnpm --dir "$PLUGIN_DIR" install --ignore-workspace --frozen-lockfile
DSHX_HARNESS="$HARNESS_ROOT" pnpm --dir "$PLUGIN_DIR" build
"$DSHX" check dsh-dragndrop-attachments --harness "$HARNESS_ROOT"
"$DSHX" activate-new-client dsh-dragndrop-attachments --profile web --port "$WEB_PORT" --harness "$HARNESS_ROOT"

printf '%s\n' "INSTALL_OK: dsh-dragndrop-attachments 已挂入当前 DSH；Host 未重启。请刷新一次页面。"
