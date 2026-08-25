import type { AttachmentRecord } from './domain.js'

export const ATTACHMENT_RPC_CHANNEL = '/dsh-dragndrop-attachments'
/** Bump whenever a mixed client/server pair could silently lose attachment state. */
export const RPC_PROTOCOL_VERSION = 2 as const
export const ENDPOINTS = {
  list: 'attachments/list',
  remove: 'attachments/remove',
  commitReferences: 'attachments/commit-references',
  uploadBegin: 'upload/begin',
  folderUploadBegin: 'folder-upload/begin',
  uploadChunk: 'upload/chunk',
  uploadCommit: 'upload/commit',
  uploadCancel: 'upload/cancel',
} as const

export interface RpcSuccess<T> { readonly ok: true; readonly value: T }
export interface RpcFailure {
  readonly ok: false
  readonly error: { readonly code: string; readonly message: string; readonly details?: Record<string, unknown>; readonly action?: string }
}
export type RpcResult<T> = RpcSuccess<T> | RpcFailure
export interface AttachmentListValue {
  readonly protocolVersion: typeof RPC_PROTOCOL_VERSION
  readonly attachments: readonly AttachmentRecord[]
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasCurrentRpcProtocol(value: unknown): value is Record<string, unknown> & { readonly protocolVersion: typeof RPC_PROTOCOL_VERSION } {
  return isRecord(value) && value.protocolVersion === RPC_PROTOCOL_VERSION
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string`)
  return value
}

export function requiredInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`)
  return value
}
