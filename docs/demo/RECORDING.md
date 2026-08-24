# Record the product demo (macOS Apple Silicon)

The product clip is a real screen recording of DeepSeek Harness Web (or Desktop) with this plugin’s client UI live: page-wide drop overlay, native `+` → 文件和文件夹, and attachment cards.

Cloud Linux cannot produce that clip. Official `install.sh` exits on non-Darwin. OfficeCLI is darwin-arm64 only. A manual Linux host install can put `dsh-dragndrop-attachments` in `window.__DSH_BOOT__` and still never mount the dock. Drops then hit native DSH (“Images cannot be added right now”). See [linux/proof](linux/proof).

Do not ship a slide animation. Do not record Linux DSH and call it the plugin.

## Machine

- macOS on Apple Silicon
- Node.js 22.19+ or 24+
- pnpm
- DeepSeek Harness `0.1.0-rc.8` Web Host running (default install port `43127`; `dsh web` default is `3080`)
- `dshx` recorded, or `DSHX_HARNESS` set to the Harness checkout

## Install the plugin

Start DSH Web first.

```sh
# from a release tarball, or from this checkout after pnpm build
./install.sh
# if the UI is not on 43127:
# DSH_WEB_PORT=3080 ./install.sh
```

Refresh the page. Confirm all of these before you press record:

1. Page-wide drag shows “拖到这里，自动处理图片、文件和文件夹”
2. Native `+` lists “文件和文件夹” above the other commands
3. A Markdown or ZIP drop creates a plugin card (name, READY, 预览 / 移除), not a fake `.zip` name for a folder
4. An image drop lands in the native DSH thumbnail well

If any of those fail, stop. The client is not loaded.

## Fixtures

```sh
cd docs/demo
./prepare-fixtures.sh
```

Drop from `docs/demo/fixtures/`. Shot list: [SHOTLIST.md](SHOTLIST.md).

## Record

QuickTime, `screencapture`, or Playwright is fine. The file has to be the DSH window, not a mock.

Suggested cut, 15–30 s, 16:9 H.264:

1. Drag `oversized-image-4096x3072.png` onto the page. Hold the overlay, then the native thumbnail.
2. Drag `sample-folder`. Card says `sample-folder`, not `sample-folder.zip`.
3. Paste `paste-note.md` or drop it. Markdown card.
4. Drag `operations-policy.docx`, `operations-analysis.xlsx`, `operations-report.pptx` if OfficeCLI is healthy. Preview, not a full dump.
5. Drag `project-archive.zip`. ZIP card with `README.md` / `src/index.ts` / `assets/logo.bin`.

Model replies are optional. No API key is required for the drag/attach UI.

Name clips `docs/demo/raw/01-drag-image.mov` through `08-on-demand.mov` (or `.mp4`) if you split takes. One continuous take is also fine.

## Encode

```sh
# single take already named plugin-demo.mp4:
ffmpeg -y -i docs/demo/raw/full-take.mov \
  -vf 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2' \
  -c:v libx264 -pix_fmt yuv420p -an -movflags +faststart \
  docs/demo/out/plugin-demo.mp4

ffmpeg -y -i docs/demo/out/plugin-demo.mp4 \
  -vf 'fps=12,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=80:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4' \
  -loop 0 docs/demo/out/plugin-demo.gif
```

Embed the GIF in the README only after those two files exist and you have watched the overlay and cards in them.

## Playwright on the Mac (optional)

If you automate the drops, wait for `[data-dsh-dragndrop-attachments="ready"]` before the first drag. If that node is missing, abort. Do not keep recording native DSH chrome.
