#!/bin/sh
set -eu
PLUGIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
command -v dsh >/dev/null 2>&1 || { printf '%s\n' '请安装官方 DeepSeek Harness CLI；桌面用户请在 设置 → 插件 → 添加插件 中选择本目录。' >&2; exit 1; }
dsh plugin --profile web add "$PLUGIN_DIR"
printf '%s\n' '插件已加入 Web profile；等任务完成后重开对应 Host 并刷新页面。桌面端请使用应用内插件管理器。'
