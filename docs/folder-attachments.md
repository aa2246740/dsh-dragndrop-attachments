# Folder attachments

## Problem

The plugin stores files by attachment ID and renders cards above the composer. Folder intake must retain its root relationship instead of falling through to `DataTransfer.files`, which can flatten children and surface the folder name as an unsupported zero-byte file. The editor remains user-owned text.

Public Codex core does not expose a generic folder input. It treats directories as workspace paths and reads them with tools. Codex Desktop has a "Files and folders" experience on macOS, but its private implementation is not a public protocol. This plugin targets the visible outcome while staying inside the external DSH plugin boundary.

## Usage

The dock receives typed selections and never reads or writes the editor text.

```ts
const items = await collectDroppedItems(dataTransfer)
const records = await intake.add(items)

cards.add(records)
await draftAttachments.commitForTurn()
```

The shared `+` menu keeps one "文件和文件夹" row. It opens a second native DSH popup with "选择文件" and "选择文件夹" because a browser picker cannot select both in one native dialog.

The model uses the existing attachment ID as the authority.

```ts
await list_attachments()
await get_attachment_outline({ attachment_id: folderId })
await search_attachment({ attachment_id: folderId, query: "经营" })
await read_folder_entry({ attachment_id: folderId, path: "docs/制度.md" })
await query_folder_document({
  attachment_id: folderId,
  path: "reports/月报.xlsx",
  operation: "spreadsheet-range",
  sheet: "汇总",
  range: "A1:F20",
})
```

## Shape

The browser boundary produces one discriminated selection model.

```ts
type IntakeItem =
  | { readonly kind: "file"; readonly file: File }
  | { readonly kind: "folder"; readonly name: string; readonly entries: readonly FolderEntry[] }

type FolderEntry =
  | { readonly kind: "directory"; readonly path: RelativeFolderPath }
  | { readonly kind: "file"; readonly path: RelativeFolderPath; readonly file: File }

interface EncodedFolderSnapshot {
  readonly kind: "folder"
  readonly name: string
  readonly sourceBytes: number
  readonly fileCount: number
  readonly directoryCount: number
  readonly snapshot: File
}
```

`RelativeFolderPath` has one constructor. It rejects absolute paths, `.` and `..`, NUL, backslashes, duplicate normalized paths, and file or directory ancestor conflicts.

The Host receives an explicit upload source. It never infers a folder from a `.zip` filename.

```ts
type UploadSource =
  | { readonly kind: "file"; readonly name: string; readonly bytes: number }
  | {
      readonly kind: "folder"
      readonly name: string
      readonly snapshotBytes: number
      readonly sourceBytes: number
      readonly fileCount: number
      readonly directoryCount: number
    }
```

The catalog adds one first-class record variant while preserving existing v1 records.

```ts
interface FolderAttachmentRecord extends AttachmentRecordBase {
  readonly kind: "folder"
  readonly documentKind: "folder"
  readonly mediaType: "application/vnd.dsh.folder-snapshot+zip"
  readonly sourceBytes: number
  readonly fileCount: number
  readonly directoryCount: number
  readonly ref: ArchiveRef
}
```

The ZIP is a private atomic codec. The UI, catalog, system prompt, locators, and tools call the object a folder. `ArchiveStore` validates every entry before persistence and remains the single reader for the immutable snapshot. Folder locators use `{ kind: "folder", path }`, never `{ kind: "archive" }`.

Browser traversal prefers `getAsFileSystemHandle`, then `webkitGetAsEntry`, then `webkitRelativePath`. Directory readers drain every batch until empty. Mixed drops remain grouped. Drag and modern directory selection preserve empty directories. A `webkitdirectory` fallback reports that empty directories are omitted instead of claiming full fidelity.

Attachment cards are the only visible draft state. Submit uses `pendingIds`, removal uses `attachmentId`, and restore uses `attachments/list`. The plugin never creates, parses, or deletes attachment markers; pre-existing draft text remains byte-for-byte unchanged.

## Storage and crash behavior

The client sorts normalized paths and writes a deterministic ZIP with explicit directory entries and fixed metadata. Folder upload uses the existing bounded chunk path with `source.kind = "folder"`.

The Host verifies declared counts and sizes against the ZIP manifest before saving it. `ArchiveStore.save` writes and fsyncs a temporary file, publishes the content-addressed object, then the catalog atomically replaces the session JSON. An interrupted upload cannot produce a folder card. A published record always points to a complete immutable snapshot.

Session limits apply to source bytes. ZIP limits still apply to snapshot bytes, entry count, expanded bytes, duplicate paths, unsafe paths, and compression ratio.

## Folder reads

Folder outline and search reuse the bounded archive index but rewrite returned kinds and locators to folder semantics.

`read_folder_entry` reads text and code. `query_folder_document` extracts one validated Office or CSV entry into the existing content-addressed `DocumentPipeline`, then applies the requested typed query. Cache identity comes from the entry bytes and existing parser fingerprint. The result locator keeps the parent folder attachment ID and relative path.

Images and other binary entries remain listed. This slice does not silently inject binary data or recursively expand nested archives.

## Synthesis decision

Candidate B is the base because one compressed upload is the smallest reliable route for a mixed folder with hundreds of entries. It hides the codec behind a first-class folder record and reuses the ZIP parser that already passed traversal and resource-limit tests.

The following parts came from Candidate A:

- explicit empty-directory manifest entries;
- session plus attachment plus relative-path authorization;
- per-entry Office parsing through the existing pipeline;
- fail-closed browser capability tags and exact path validation.

The global attachment schema v2 migration from Candidate B was rejected. Adding `folder` does not justify rewriting existing text, document, and archive records. The per-file RPC and CAS design from Candidate A was also rejected. It would turn one folder drop into hundreds of uploads and many partial states without improving the user's experience.

## Tradeoffs

- The folder is an immutable snapshot. Changes in Finder after the drop do not alter the attachment.
- The browser does not expose reliable native symlink metadata. The snapshot writes only regular files and directories returned by the browser API and never writes ZIP symlink entries.
- The fallback folder picker cannot preserve empty directories. The primary drag and File System Access paths can.
- One Host restart is required because the domain, RPC, catalog, and model tools change. A client-only styling update can hot-reload, but this release has Host-side changes.

## Acceptance

1. A page-wide drop accepts one folder, multiple folders, or mixed files and folders without an unsupported-folder error.
2. Nested relative paths and empty directories survive snapshot, upload, catalog reopen, and Host restart.
3. Attachment cards show folder name, file count, size, preview, remove, and restore state. No `.zip` name appears.
4. The editor value stays byte-for-byte unchanged after add, remove, failed upload, and restore.
5. Folder outline, bounded search, text read, and nested DOCX, XLSX, PPTX, and CSV queries run through attachment-scoped tools.
6. Traversal paths, duplicate normalized paths, oversized trees, and compression bombs fail before publication.
7. The external package passes tests, build, package verification, `dshx check`, one Host restart, and a real DSH browser flow.
