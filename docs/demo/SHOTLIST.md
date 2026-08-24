# Demo shot list

This pack supports two honest outputs:

1. **Shipped X / README cut** — a labeled capability animation rendered from real `tests/fixtures` files and `docs/assets/dsh-dragndrop-architecture.png`. It is **not** a live DeepSeek Harness screen recording. This Linux environment cannot run DSH UI (macOS Apple Silicon + running Host).
2. **Optional live cut** — if you later record DSH on a Mac, drop clips into `docs/demo/raw/` using the IDs below and run `./assemble.sh --from-raw`.

Target for the posted video: **15–30 s**, landscape 16:9, H.264 MP4. Live clip durations below are a budget for that cut, not a mandate to hold every beat that long.

Do not demo PDF, RAR, 7z, tar, or legacy `.doc/.xls/.ppt`. Those are out of scope.

## Fixture map

Drop these from `docs/demo/fixtures/` (copied or built from `tests/fixtures` plus the same text the tests already use):

| File | Shot | Source |
| --- | --- | --- |
| `oversized-image-4096x3072.png` | 01 | `tests/fixtures/images/large-4096x3072.png` |
| `sample-folder/` | 02 | folder snapshot used in tests: `docs/README.md`, `docs/quoted-newlines.csv`, `src/index.ts` |
| `paste-note.md` | 03 | Markdown body from `tests/common.spec.ts` |
| `operations-policy.docx` | 04, 08 | `tests/fixtures/office/operations-policy.docx` |
| `operations-analysis.xlsx` | 05, 08 | `tests/fixtures/office/operations-analysis.xlsx` |
| `operations-report.pptx` | 06, 08 | `tests/fixtures/office/operations-report.pptx` |
| `project-archive.zip` | 07 | same ZIP tree as the archive test: `README.md`, `src/index.ts`, `assets/logo.bin` |
| `quoted-newlines.csv`, `utf8.csv`, `gb18030.csv` | spare | `tests/fixtures/csv/` |

The committed `sample-folder` has `docs/` and `src/` (3 files, 2 folders). Empty directories are a live-DSH capability when the browser reports them; add an empty subfolder in Finder before recording if you want that beat.

## Shots

Each live shot: start recording, do the action, hold the result, stop. Name the file `NN-id.mov` or `NN-id.mp4` (example: `01-drag-image.mov`).

### 01 · Drag image · 拖入图片

- **ID:** `01-drag-image`
- **Duration:** 3 s
- **Action:** Open a DSH session. Drag `oversized-image-4096x3072.png` onto any part of the page (not only the composer).
- **Expected:** Page overlay “拖到这里，自动处理图片、文件和文件夹”. Image lands in the **native** DSH thumbnail well. Source is 4096×3072; plugin prep fits DSH RC8 bounds (test: 1823×1367). USER_GUIDE documents a green hint such as `4096×3072→1823×1367` when resize is visible.
- **Capability animation:** Shows the real fixture thumbnail and the 4096×3072 → 1823×1367 callout. Does not draw fake DSH chrome.

### 02 · Drag folder · 拖入文件夹

- **ID:** `02-drag-folder`
- **Duration:** 3 s
- **Action:** Drag the `sample-folder` directory from Finder onto the page.
- **Expected:** One folder card named `sample-folder` (not `sample-folder.zip`). Status like `3 文件 · 2 文件夹` plus `READY` and a local size. Preview / remove on the card. Editor text unchanged.
- **Capability animation:** Folder card + relative paths `docs/README.md`, `docs/quoted-newlines.csv`, `src/index.ts`.

### 03 · Paste · 粘贴

- **ID:** `03-paste`
- **Duration:** 2 s
- **Action:** Copy `paste-note.md` (or a screenshot) in Finder / clipboard. Paste near the composer.
- **Expected:** Same intake as drag. Markdown gets a plugin card (`READY`, preview, remove). A screenshot follows the native image path.
- **Capability animation:** Clipboard chip + `paste-note.md` card. Caption states paste shares the drag path.

### 04 · DOCX · Word

- **ID:** `04-docx`
- **Duration:** 2 s
- **Action:** Drag `operations-policy.docx`.
- **Expected:** Card `operations-policy.docx`, status `READY` / 本地解析. Preview shows a bounded outline, not the full document dump.
- **Capability animation:** DOCX card and locator `/body/tbl[1]` (from the Office test that searches `北京分行`).

### 05 · XLSX · Excel

- **ID:** `05-xlsx`
- **Duration:** 2 s
- **Action:** Drag `operations-analysis.xlsx`.
- **Expected:** Card ready. Outline includes sheets `汇总` and hidden `隐藏参数`.
- **Capability animation:** Range `汇总!A1:D2` with `北京分行`, `=B2*C2`, and `FORMULA_ONLY` — the same assertions as `tests/office.spec.ts`.

### 06 · PPTX · PowerPoint

- **ID:** `06-pptx`
- **Duration:** 2 s
- **Action:** Drag `operations-report.pptx`.
- **Expected:** Card ready. Slide 1 body includes `重点指标为 83 分`; speaker notes include `演讲者备注`.
- **Capability animation:** Slide 1 + notes from that fixture.

### 07 · ZIP · 压缩包

- **ID:** `07-zip`
- **Duration:** 3 s
- **Action:** Drag `project-archive.zip`. Send. Ask the model to list the archive, then read `README.md` lines 1–3.
- **Expected:** Card is a ZIP, not a folder. Outline shows `README.md`, `src/index.ts`, `assets/logo.bin`. Search `北京分行` hits `README.md`. `read_archive_entry` returns those lines. `logo.bin` is listed only (binary, not unpacked into the prompt).
- **Capability animation:** That tree, with the binary row marked listed-only.

### 08 · On-demand tools · 按需读取

- **ID:** `08-on-demand`
- **Duration:** 6 s
- **Action:** With the Office files already on the session (shots 04–06), send one turn that asks the model to use tools, not to guess:

  ```text
  Search operations-policy.docx for 北京分行 and read the hit table by semantic path.
  Read 汇总!A1:D2 from operations-analysis.xlsx, including formula vs saved-value status.
  Read slide 1 of operations-report.pptx with speaker notes.
  Cite filename and locator. Do not paste the whole files.
  ```

- **Expected:** Tool traces for `search_attachment` + `read_document_path`, `read_spreadsheet_range`, and `read_slide`. Answers cite `/body/tbl[1]`, `汇总!A1:D2`, and slide 1. Coverage stays partial; the prompt does not receive entire Office packages.
- **Capability animation:** Three tool chips with those real locators, then the architecture closer: “Send the slice” / 模型只拿到请求的片段.

## Assemble

From `docs/demo/`:

```sh
./assemble.sh              # capability MP4 + README GIF (default; this is what we ship)
./assemble.sh --from-raw   # stitch raw/ clips; if any shot is missing, dry-run and exit 0
./assemble.sh --dry-run    # print the plan only
```

Outputs:

- `docs/demo/out/plugin-demo.mp4` — X-ready H.264, 16:9
- `docs/demo/out/plugin-demo.gif` — looping README embed

Missing raw clips are not a failure. ffmpeg errors, a broken renderer, or a half-written MP4 are failures.
