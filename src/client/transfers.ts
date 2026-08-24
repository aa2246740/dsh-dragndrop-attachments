import { collectDroppedItems, snapshotDroppedItems, type IntakeItem } from './folders.js'

export function bindFileIntake(
  documentTarget: EventTarget,
  windowTarget: EventTarget,
  onItems: (items: readonly IntakeItem[]) => void | Promise<void>,
  onDragActive: (active: boolean) => void,
  onError: (error: unknown) => void,
): () => void {
  let dragDepth = 0
  let intakeChain = Promise.resolve()
  const enqueue = (work: () => Promise<void>): void => { intakeChain = intakeChain.then(work).catch(onError) }
  const fileTransfer = (event: Event): DataTransfer | null => {
    const transfer = (event as DragEvent).dataTransfer
    return transfer !== null && transfer !== undefined && Array.from(transfer.types).includes('Files') ? transfer : null
  }
  const reset = (): void => { dragDepth = 0; onDragActive(false) }
  const enter = (event: Event): void => {
    if (fileTransfer(event) === null) return
    event.preventDefault(); event.stopImmediatePropagation(); dragDepth += 1; onDragActive(true)
  }
  const over = (event: Event): void => {
    const transfer = fileTransfer(event); if (transfer === null) return
    event.preventDefault(); event.stopImmediatePropagation(); transfer.dropEffect = 'copy'; onDragActive(true)
  }
  const leave = (event: Event): void => {
    if (fileTransfer(event) === null) return
    event.preventDefault(); event.stopImmediatePropagation(); dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) onDragActive(false)
  }
  const drop = (event: Event): void => {
    const transfer = fileTransfer(event); if (transfer === null) return
    const snapshot = snapshotDroppedItems(transfer)
    event.preventDefault(); event.stopImmediatePropagation(); reset(); enqueue(async () => { await onItems(await collectDroppedItems(snapshot)) })
  }
  const paste = (event: Event): void => {
    const files = Array.from((event as ClipboardEvent).clipboardData?.files ?? [])
    if (files.length === 0) return
    event.preventDefault(); event.stopImmediatePropagation(); enqueue(async () => { await onItems(files.map(file => ({ kind: 'file', file }))) })
  }

  documentTarget.addEventListener('dragenter', enter, true)
  documentTarget.addEventListener('dragover', over, true)
  documentTarget.addEventListener('dragleave', leave, true)
  documentTarget.addEventListener('drop', drop, true)
  documentTarget.addEventListener('paste', paste, true)
  windowTarget.addEventListener('dragend', reset)
  return () => {
    documentTarget.removeEventListener('dragenter', enter, true)
    documentTarget.removeEventListener('dragover', over, true)
    documentTarget.removeEventListener('dragleave', leave, true)
    documentTarget.removeEventListener('drop', drop, true)
    documentTarget.removeEventListener('paste', paste, true)
    windowTarget.removeEventListener('dragend', reset)
  }
}
