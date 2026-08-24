#!/usr/bin/env bash
# Linux host/boot experiment. Not the product install. Not a recording path.
#
# Official ./install.sh exits on non-Darwin. This script can build the host
# bundle and insert a Loader row so `dsh web` lists the package in
# window.__DSH_BOOT__. On Cloud Linux that is as far as it gets: the client
# dock, page-wide overlay, and + menu entry do not activate. See proof/.
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
python3 - "$patch" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
block = """# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; `!!js` expressions allowed).
- insert:
    - id: dsh-dragndrop-attachments
      name: dsh-dragndrop-attachments
"""
if not path.exists():
    path.write_text(block)
    raise SystemExit
text = path.read_text()
if 'id: dsh-dragndrop-attachments' in text:
    raise SystemExit
stripped = text.strip()
if stripped in ('', '[]') or stripped.endswith('\n[]') or stripped.splitlines()[-1].strip() == '[]':
    # Keep header comments, replace a lone empty-array document.
    comments = [line for line in text.splitlines() if line.startswith('#')]
    prefix = ('\n'.join(comments) + '\n') if comments else ''
    path.write_text(prefix + '- insert:\n    - id: dsh-dragndrop-attachments\n      name: dsh-dragndrop-attachments\n')
else:
    path.write_text(text.rstrip() + '\n- insert:\n    - id: dsh-dragndrop-attachments\n      name: dsh-dragndrop-attachments\n')
PY

printf '%s\n' "HOST_BOOT_OK: package is in the web profile. Start: dsh web --no-open --port $web_port"
printf '%s\n' "CLIENT_UI: do not assume the dock is live. On Cloud Linux it does not activate."
printf '%s\n' "OfficeCLI is darwin-arm64 only. Product recording is macOS Apple Silicon only."
