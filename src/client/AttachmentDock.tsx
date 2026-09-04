import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { isPendingAttachment, type AttachmentRecord } from '../domain.js'
import { collectPickedDirectory, collectWebkitDirectory, encodeFolderSnapshot, supportsModernDirectoryPicker, type IntakeItem } from './folders.js'
import { isImageFile } from './image.js'
import { bindFileIntake } from './transfers.js'
import css from './AttachmentDock.module.css'

const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.markdown,.csv,.docx,.xlsx,.pptx,.zip,.json,.jsonl,.yaml,.yml,.toml,.xml,.tsv,.py,.js,.jsx,.ts,.tsx,.css,.html,.sh,.sql,.log'
const SUPPORTED = /\.(png|jpe?g|webp|gif|txt|md|markdown|csv|docx|xlsx|pptx|zip|json|jsonl|ndjson|ya?ml|toml|xml|tsv|py|jsx?|tsx?|css|html?|sh|zsh|sql|log|ini|conf|env|properties|java|go|rs|c|h|cpp|hpp)$/iu

interface UploadProgress { readonly id: number; readonly name: string; readonly percent: number; readonly phase: string }
let nextUploadId = 0
export type ClientUploadSource =
  | { readonly kind: 'file'; readonly file: File }
  | { readonly kind: 'folder'; readonly name: string; readonly snapshot: Uint8Array; readonly sourceBytes: number; readonly fileCount: number; readonly directoryCount: number }

export interface AttachmentDockInjected {
  readonly list: () => Promise<readonly AttachmentRecord[]>
  readonly upload: (source: ClientUploadSource, progress: (percent: number, phase: string) => void) => Promise<AttachmentRecord>
  readonly removeDraft: (attachmentId: string) => Promise<boolean>
  readonly commitReferences: (attachmentIds: readonly string[]) => Promise<void>
  readonly registerPicker: (picker: { readonly openFile: () => Promise<void>; readonly openFolder: () => Promise<void> }) => () => void
  readonly attachNativeImages: (files: readonly File[], accept: (ids: readonly DraftAttachmentId[]) => boolean) => Promise<readonly { readonly name: string; readonly resized: boolean; readonly source: string; readonly output: string }[]>
}
export type AttachmentDockProps = PropsRuntime<'conversation.input.dock'> & AttachmentDockInjected

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`
  return `${Math.round(bytes / 1024 / 1024 * 10) / 10} MiB`
}
function supported(file: File): boolean { return isImageFile(file) || SUPPORTED.test(file.name) }
function isPickerAbort(value: unknown): boolean { return value instanceof Error && value.name === 'AbortError' }
function fileBadge(record: AttachmentRecord): string {
  if (record.kind === 'folder') return 'DIR'
  const extension = /\.([^.]+)$/u.exec(record.name)?.[1]?.toLocaleUpperCase()
  return extension === undefined ? 'FILE' : extension.slice(0, 4)
}

export function AttachmentDock({ useConversation, useInput, inputActions, list, upload, removeDraft, commitReferences, registerPicker, attachNativeImages }: AttachmentDockProps) {
  const phase = useInput(state => state.phase)
  const latestUserSeq = useConversation(snapshot => snapshot.views.get('chat')?.legacy.nodes.reduce(
    (latest, node) => node.kind === 'user' ? Math.max(latest, node.seq) : latest,
    0,
  ) ?? 0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const handleItemsRef = useRef<(items: readonly IntakeItem[]) => Promise<void>>(() => Promise.resolve())
  const previousPhase = useRef(phase)
  const latestUserSeqRef = useRef(latestUserSeq)
  const [records, setRecords] = useState<readonly AttachmentRecord[]>([])
  const [uploads, setUploads] = useState<readonly UploadProgress[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reportError = useCallback((value: unknown): void => { setError(value instanceof Error ? value.message : String(value)) }, [])
  const pending = useMemo(() => records.filter(isPendingAttachment), [records])
  const pendingIds = useMemo(() => pending.map(record => record.attachmentId), [pending])

  const openInput = useCallback(async (input: HTMLInputElement | null): Promise<void> => {
    if (input === null) return
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => { input.removeEventListener('change', settle); input.removeEventListener('cancel', settle) }
      const settle = (): void => { cleanup(); resolve() }
      const fail = (value: unknown): void => { cleanup(); reject(value) }
      input.addEventListener('change', settle, { once: true }); input.addEventListener('cancel', settle, { once: true })
      if (typeof input.showPicker === 'function') {
        try { input.showPicker(); return } catch (showPickerError) {
          try { input.click(); return } catch { fail(showPickerError); return }
        }
      }
      try { input.click() } catch (value) { fail(value) }
    })
  }, [])
  const openFile = useCallback(async (): Promise<void> => {
    try { await openInput(fileInputRef.current) } catch (value) { reportError(value) }
  }, [openInput, reportError])
  const openFolder = useCallback(async (): Promise<void> => {
    if (!supportsModernDirectoryPicker()) {
      try { await openInput(folderInputRef.current) } catch (value) { reportError(value) }
      return
    }
    try { await handleItemsRef.current([await collectPickedDirectory()]) } catch (value) { if (!isPickerAbort(value)) reportError(value) }
  }, [openInput, reportError])
  useEffect(() => {
    const input = folderInputRef.current
    input?.setAttribute('webkitdirectory', '')
    input?.setAttribute('directory', '')
  }, [])
  useEffect(() => registerPicker({ openFile, openFolder }), [openFile, openFolder, registerPicker])

  const refresh = useCallback(async (): Promise<void> => { setRecords(await list()) }, [list])
  useEffect(() => { void refresh().catch(value => { setError(value instanceof Error ? value.message : String(value)) }) }, [refresh])
  useEffect(() => {
    const enteringSubmit = phase === 'submitting' && previousPhase.current !== 'submitting'
    previousPhase.current = phase
    if (!enteringSubmit || pendingIds.length === 0) return
    void commitReferences(pendingIds).catch(value => { setError(value instanceof Error ? value.message : String(value)) })
  }, [commitReferences, pendingIds, phase])
  useEffect(() => {
    if (latestUserSeq <= latestUserSeqRef.current) return
    latestUserSeqRef.current = latestUserSeq
    void refresh().catch(value => { setError(value instanceof Error ? value.message : String(value)) })
  }, [latestUserSeq, refresh])

  const updateUpload = useCallback((id: number, name: string, percent: number, uploadPhase: string): void => {
    setUploads(current => [...current.filter(item => item.id !== id), { id, name, percent, phase: uploadPhase }])
  }, [])
  const appendRecord = useCallback((record: AttachmentRecord): void => {
    setRecords(current => current.some(entry => entry.attachmentId === record.attachmentId)
      ? current.map(entry => entry.attachmentId === record.attachmentId ? record : entry)
      : [...current, record])
  }, [])
  const uploadOne = useCallback(async (source: ClientUploadSource): Promise<void> => {
    const name = source.kind === 'file' ? source.file.name : source.name
    const id = ++nextUploadId
    updateUpload(id, name, 0, '上传中')
    try { appendRecord(await upload(source, (percent, uploadPhase) => { updateUpload(id, name, percent, uploadPhase) })) }
    finally { setUploads(current => current.filter(item => item.id !== id)) }
  }, [appendRecord, updateUpload, upload])
  const handleItems = useCallback(async (items: readonly IntakeItem[]): Promise<void> => {
    setError(null); setNotice(null)
    const files = items.filter((item): item is Extract<IntakeItem, { readonly kind: 'file' }> => item.kind === 'file').map(item => item.file)
    const rejected = files.filter(file => !supported(file))
    if (rejected.length > 0) setError(`不支持：${rejected.map(file => file.name).join('、')}。支持图片、文本/Markdown、CSV、Office 和 ZIP。`)
    const accepted = files.filter(supported)
    const images = accepted.filter(isImageFile)
    if (images.length > 0) {
      try { await attachNativeImages(images, inputActions.addImages) } catch (value) { setError(value instanceof Error ? value.message : String(value)) }
    }
    for (const file of accepted.filter(file => !isImageFile(file))) await uploadOne({ kind: 'file', file })
    for (const folder of items.filter((item): item is Extract<IntakeItem, { readonly kind: 'folder' }> => item.kind === 'folder')) {
      const encoded = await encodeFolderSnapshot(folder)
      if (encoded.emptyDirectories === 'unavailable') setNotice('当前文件夹选择器无法报告空目录；其余文件和路径已作为快照保存。')
      await uploadOne(encoded)
    }
  }, [attachNativeImages, inputActions.addImages, uploadOne])
  handleItemsRef.current = handleItems
  useEffect(() => bindFileIntake(document, window, handleItems, setDragActive, reportError), [handleItems, reportError])

  const detach = useCallback((record: AttachmentRecord): void => {
    setExpanded(current => current === record.attachmentId ? null : current)
    void removeDraft(record.attachmentId).then(refresh).catch(value => { setError(value instanceof Error ? value.message : String(value)) })
  }, [refresh, removeDraft])
  const visible = pending.length > 0 || uploads.length > 0 || notice !== null || error !== null
  return <>
    <input ref={fileInputRef} className={css.hidden} type="file" multiple accept={ACCEPT} data-dsh-dragndrop-attachments="ready" onChange={event => { const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = ''; void handleItems(files.map(file => ({ kind: 'file', file }))).catch(reportError) }} />
    <input ref={folderInputRef} className={css.hidden} type="file" multiple onChange={event => { const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = ''; void handleItems(collectWebkitDirectory(files)).catch(reportError) }} />
    {dragActive && <div className={css.overlay}><div className={css.overlayBox}>拖到这里，自动处理图片、文件和文件夹</div></div>}
    {visible && <div className={css.dock} data-dsh-dragndrop-attachment-dock="ready"><div className={css.rail}>
      {uploads.map(item => <div className={css.card} key={`upload:${item.id}`}><div className={css.cardTop}><span className={css.icon}>UP</span><div className={css.meta}><div className={css.name}>{item.name}</div><div className={css.status}>{item.phase} · {item.percent}%</div></div></div><div className={css.progress}><div className={css.progressBar} style={{ width: `${item.percent}%` }} /></div></div>)}
      {pending.map(record => <div className={css.card} key={record.attachmentId} data-attachment-id={record.attachmentId}><div className={css.cardTop}>
        <span className={css.icon}>{fileBadge(record)}</span><div className={css.meta}><div className={css.name} title={record.name}>{record.name}</div>
          <div className={css.status}>{record.kind === 'folder' ? `${record.fileCount} 文件 · ${record.directoryCount} 文件夹 · ` : ''}{record.status} · {formatBytes(record.bytes)} · 本地</div></div>
        <div className={css.actions}><button type="button" className={css.action} onClick={() => setExpanded(current => current === record.attachmentId ? null : record.attachmentId)}>预览</button><button type="button" className={css.action} onClick={() => detach(record)}>移除</button></div>
      </div>{record.warnings.map(warning => <div key={`${warning.code}:${warning.message}`} className={warning.code === 'ARCHIVE_BINARY_ENTRIES' || warning.code === 'FOLDER_BINARY_ENTRIES' ? css.note : css.warning}>{warning.message}</div>)}{expanded === record.attachmentId && <div className={css.preview}>{record.preview || '已建立结构索引，模型会按需读取。'}</div>}</div>)}
    </div>{notice !== null && <div className={css.notice}>{notice}</div>}{error !== null && <div className={css.error}>{error}</div>}</div>}
  </>
}
