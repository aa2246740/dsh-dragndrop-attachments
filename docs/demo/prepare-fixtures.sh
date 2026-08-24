#!/usr/bin/env bash
# Copy and build the droppable demo pack from tests/fixtures.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
src="$root/tests/fixtures"
dest="$here/fixtures"

mkdir -p "$dest/sample-folder/docs" "$dest/sample-folder/src"

cp -f "$src/images/large-4096x3072.png" "$dest/oversized-image-4096x3072.png"
cp -f "$src/office/operations-policy.docx" "$dest/operations-policy.docx"
cp -f "$src/office/operations-analysis.xlsx" "$dest/operations-analysis.xlsx"
cp -f "$src/office/operations-report.pptx" "$dest/operations-report.pptx"
cp -f "$src/csv/quoted-newlines.csv" "$dest/quoted-newlines.csv"
cp -f "$src/csv/utf8.csv" "$dest/utf8.csv"
cp -f "$src/csv/gb18030.csv" "$dest/gb18030.csv"
cp -f "$src/csv/quoted-newlines.csv" "$dest/sample-folder/docs/quoted-newlines.csv"

# Same Markdown / code bodies the catalog tests already ingest.
printf '%s\n' '# 经营制度' '' '北京分行得分 83。' '' '## 口径' '只使用已保存数据。' > "$dest/paste-note.md"
printf '%s\n' '# 月报' '北京分行 91' > "$dest/sample-folder/docs/README.md"
printf '%s\n' 'export const score = 91' > "$dest/sample-folder/src/index.ts"

python3 - "$dest" <<'PY'
from pathlib import Path
import sys
import zipfile

dest = Path(sys.argv[1])
archive = dest / 'project-archive.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    zf.writestr('README.md', '# 项目说明\n\n北京分行得分 91。\n')
    zf.writestr('src/index.ts', 'export const score = 91\n')
    zf.writestr('assets/logo.bin', bytes([0, 1, 2, 3]))
print(f'wrote {archive}')
PY

echo "FIXTURES_OK $dest"
