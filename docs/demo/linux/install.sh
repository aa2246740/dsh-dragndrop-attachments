#!/usr/bin/env bash
# Linux equivalent of the macOS install.sh path.
#
# Official install.sh exits on non-Darwin. This script:
# 1. Points DSHX_HARNESS at a stub that supplies externalClientBundle
# 2. Installs plugin deps and builds host + client bundles
# 3. Adds the package to the official `dsh` web profile
# 4. Inserts the host row so client-modules can scan dsh.client
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
plugin="$(cd "$here/../../.." && pwd)"
stub="$here/harness-stub"
web_port="${DSH_WEB_PORT:-3080}"
profile_dir="${DSH_HOME:-$HOME/.dsh}/profiles/web"
patch="$profile_dir/cordis.patch.yml"

fail() {
  printf '%s\n' "INSTALL_FAILED: $*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js is required (22.19+ or >=24)."
command -v pnpm >/dev/null 2>&1 || fail "pnpm is required."
command -v dsh >/dev/null 2>&1 || fail "dsh is required. Install with: npm i -g @deepseek-ai/dsh@0.1.0-rc.8"

node_major="$(node -p 'process.versions.node.split(".")[0]')"
node_minor="$(node -p 'process.versions.node.split(".")[1]')"
if [ "$node_major" -lt 22 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -lt 19 ]; }; then
  if [ "$node_major" -lt 24 ]; then
    fail "Node $(node -v) is too old. Need ^22.19 or >=24."
  fi
fi

mkdir -p "$stub/tools/dshx/src"
ln -sfn "$here/client-build.js" "$stub/tools/dshx/src/client-build.js"
mkdir -p "$HOME/.config/dshx"
printf '%s\n' "$stub" > "$HOME/.config/dshx/harness"
export DSHX_HARNESS="$stub"

printf '%s\n' "DSHX_HARNESS=$DSHX_HARNESS (Linux stub; public RC8 has no tools/dshx)"

pnpm --dir "$plugin" install --ignore-workspace --frozen-lockfile
DSHX_HARNESS="$stub" pnpm --dir "$plugin" build
[ -f "$plugin/lib/dsh-dragndrop-attachments.js" ] || fail "host bundle missing after build"
[ -f "$plugin/lib/client.js" ] || fail "client bundle missing after build"

dsh plugin --profile web add "$plugin"

mkdir -p "$profile_dir"
if [ ! -f "$patch" ]; then
  printf '%s\n' '[]' > "$patch"
fi
if ! grep -q 'id: dsh-dragndrop-attachments' "$patch"; then
  python3 - "$patch" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text()
block = """- insert:
    - id: dsh-dragndrop-attachments
      name: dsh-dragndrop-attachments
"""
if text.strip() in ('', '[]'):
    path.write_text(block)
else:
    path.write_text(text.rstrip() + '\n' + block)
PY
fi

printf '%s\n' "INSTALL_OK: dsh-dragndrop-attachments is in the web profile."
printf '%s\n' "Start with: dsh web --no-open --port $web_port"
printf '%s\n' "OfficeCLI in this package is darwin-arm64 only. Linux can demo image, text/Markdown, folder, ZIP, and CSV. DOCX/XLSX/PPTX parse will fail until a Linux OfficeCLI exists."
