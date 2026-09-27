import { collectDroppedItems, snapshotDroppedItems, type IntakeItem } from './folders.js'

/** Only Web folder drops need a fallback. Files, paste and all desktop drops stay native. */
export function bindFileIntake(
  documentTarget: EventTarget,
  windowTarget: EventTarget,
  onItems: (items: readonly IntakeItem[]) => void | Promise<void>,
  onDragActive: (active: boolean) => void,
  onError: (error: unknown) => void,
  options: { readonly desktop?: boolean; readonly canAccept?: () => boolean } = {},
): () => void {
  if (options.desktop) return () => {}
  let disposed = false
  let chain = Promise.resolve()
  const drop = (event: Event): void => {
    const transfer = (event as DragEvent).dataTransfer
    if (!transfer) return
    const hasFolder = Array.from(transfer.items ?? []).some(item => {
      try { return item.kind === 'file' && typeof item.webkitGetAsEntry === 'function' && item.webkitGetAsEntry()?.isDirectory === true }
      catch { return false }
    })
    if (!hasFolder) return
    const snapshot = snapshotDroppedItems(transfer)
    event.preventDefault()
    event.stopImmediatePropagation()
    // Native drop will not run for this event. Clear its hover overlay.
    windowTarget.dispatchEvent(new Event('dragend'))
    onDragActive(false)
    if (options.canAccept?.() === false) { onError(new Error('当前输入框暂时不能接收文件夹。')); return }
    chain = chain.then(async () => {
      const items = await collectDroppedItems(snapshot)
      if (!disposed) await onItems(items)
    }).catch(onError)
  }
  documentTarget.addEventListener('drop', drop, true)
  return () => { disposed = true; documentTarget.removeEventListener('drop', drop, true) }
}
