# Demo shot list

Record these on macOS Apple Silicon against live DeepSeek Harness Web, after `./install.sh` and a refresh. See [RECORDING.md](RECORDING.md).

Cloud Linux is not a recording host. The client dock does not activate there.

Target cut: 15–30 s, landscape 16:9, H.264 MP4.

Do not demo PDF, RAR, 7z, tar, or legacy `.doc/.xls/.ppt`.

## Fixture map

`docs/demo/prepare-fixtures.sh` copies or builds these from `tests/fixtures`:

| File | Shot | Source |
| --- | --- | --- |
| `oversized-image-4096x3072.png` | 01 | `tests/fixtures/images/large-4096x3072.png` |
| `sample-folder/` | 02 | `docs/README.md`, `docs/quoted-newlines.csv`, `src/index.ts` |
| `paste-note.md` | 03 | Markdown body from `tests/common.spec.ts` |
| `operations-policy.docx` | 04, 08 | `tests/fixtures/office/operations-policy.docx` |
| `operations-analysis.xlsx` | 05, 08 | `tests/fixtures/office/operations-analysis.xlsx` |
| `operations-report.pptx` | 06, 08 | `tests/fixtures/office/operations-report.pptx` |
| `project-archive.zip` | 07 | ZIP tree from the archive test |
| `quoted-newlines.csv`, `utf8.csv`, `gb18030.csv` | spare | `tests/fixtures/csv/` |

## Shots

Name files `NN-id.mov` or `NN-id.mp4` under `docs/demo/raw/`.

### 01 · Drag image · 拖入图片

Drag `oversized-image-4096x3072.png` onto any part of the page. Overlay “拖到这里，自动处理图片、文件和文件夹”. Image lands in the native DSH thumbnail well.

### 02 · Drag folder · 拖入文件夹

Drag `sample-folder`. One folder card named `sample-folder` (not `.zip`). Status like `3 文件 · 2 文件夹` plus READY.

### 03 · Paste · 粘贴

Copy `paste-note.md` and paste near the composer. Markdown card.

### 04–06 · Office

Drag the DOCX / XLSX / PPTX fixtures. Cards READY. OfficeCLI is darwin-arm64; skip these beats only if parse fails on that Mac.

### 07 · ZIP

Drag `project-archive.zip`. ZIP card, not a folder. Outline shows `README.md`, `src/index.ts`, `assets/logo.bin`.

### 08 · On-demand tools

Optional. Needs a model key. Ask for a search / spreadsheet range / slide. Skip if you are only recording the attach UI.
