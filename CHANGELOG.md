# Changelog

All notable changes to this project are documented here.

## 1.2.1 - 2026-08-25

- Preserved every simultaneous or sequential file selection as its own attachment card and model-context entry, while retaining content-addressed byte deduplication underneath.
- Recovered the complete Finder `FileList` when browser item/handle APIs resolve only part of a multi-file drop.
- Bound pending attachment cards atomically to the accepted DSH user message before the first model request.
- Added a durable, visible attachment-context receipt after the user message while keeping the editor text untouched.
- Made current-turn attachments the primary subject of generic review requests so unrelated workspace files cannot silently take precedence.
- Added `read_attachment`, a path-free primary reader that searches every attachment kind and reads Markdown/text by bounded line range without opaque block ids.
- Scoped `list_attachments` to the exact current-turn attachment ids while a submitted attachment context is active.
- Added an agent-scoped routing guard that blocks broad filesystem discovery of current-turn uploads before `bash`, `find`, `grep`, or workspace readers can run.
- Converted the two observed wrong-tool patterns—an invented text block id and a folder-only query against Markdown—into successful attachment reads with structured routing corrections.
- Declared browser absolute paths unavailable by design; model access now documents only the durable attachment id and plugin-managed snapshot boundary.
- Kept rejected submissions in the composer and allowed the same content to be attached again in later turns.
- Added an explicit client/server attachment protocol handshake so a hot-updated browser cannot silently submit against stale Host code.
- Replaced optimistic card removal with an authoritative catalog reload after the user message is accepted.
- Raised the aggregate per-session attachment budget from 100 MiB to 1 GiB.

## 1.2.0 - 2026-08-24

- Added page-wide file, folder, mixed-drop, and clipboard intake without writing attachment markers into the editor.
- Integrated file and folder selection into DSH's native `+` command menu.
- Added silent oversized-image preparation before the native DSH image pipeline.
- Added durable, session-scoped text, Markdown, code, CSV, DOCX, XLSX, PPTX, ZIP, and folder attachments.
- Added bounded progressive model tools for outlines, search, blocks, spreadsheet ranges, slides, Word semantic paths, ZIP entries, folder entries, and Office files inside folders.
- Added safe ZIP and deterministic folder-snapshot handling with traversal, duplicate-path, expansion, and compression-ratio limits.
- Bundled and pinned OfficeCLI 1.0.144 for macOS arm64.
- Renamed the public project and plugin identity to `dsh-dragndrop-attachments`.
