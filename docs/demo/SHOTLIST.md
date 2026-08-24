# Demo shot list

The product video is a real recording of DeepSeek Harness Web UI with this plugin loaded.

Target cut: 15–30 s, landscape 16:9, H.264 MP4.

Do not demo PDF, RAR, 7z, tar, or legacy `.doc/.xls/.ppt`.

## Linux Cloud Agent capture

`docs/demo/linux/record.mjs` drives official `dsh web` in Chromium. It drops real files into the live page (DataTransfer + the native `+` folder picker). It does not render slides.

OfficeCLI in this package is darwin-arm64. On Linux the recorder still drops a DOCX so the UI can show the honest parse error. Image, Markdown, CSV, ZIP, and folder intake do not need OfficeCLI.

## Fixture map

From `docs/demo/fixtures/` (built by `prepare-fixtures.sh` from `tests/fixtures`):

| File | What it shows |
| --- | --- |
| `oversized-image-4096x3072.png` | Page-wide drop overlay; native DSH image well after Codex-style resize |
| `paste-note.md` | Plugin card for Markdown / text |
| `utf8.csv` | CSV card (JS parser, works on Linux) |
| `sample-folder/` | Folder card via `+` → 文件和文件夹 → 选择文件夹 |
| `project-archive.zip` | ZIP card with local tree index |
| `operations-policy.docx` | Office drop; READY on macOS arm64, expected fail on Linux without OfficeCLI |

## Record

```sh
# after docs/demo/linux/install.sh and `dsh web --no-open`
cd docs/demo
./prepare-fixtures.sh
node linux/record.mjs
```

Writes `docs/demo/out/plugin-demo.mp4` and `plugin-demo.gif` from the Playwright video. The raw WebM stays in `docs/demo/raw/`.
