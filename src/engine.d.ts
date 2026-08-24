import type { Context } from '@deepseek-ai/cordis'

export interface EngineCoverage {
  readonly status: 'COMPLETE' | 'PARTIAL'
  readonly included: readonly string[]
  readonly omitted: readonly string[]
  readonly unsupported: readonly string[]
}

export interface EngineDocumentRef extends Record<string, unknown> {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly documentKind: 'document' | 'spreadsheet' | 'presentation'
  readonly status: 'READY' | 'PARTIAL'
  readonly coverage: EngineCoverage
  readonly warnings: readonly { readonly code: string; readonly message: string; readonly locator?: Record<string, unknown> }[]
  readonly preview: string
  readonly parserVersion: string
  readonly name?: string
}

export interface EngineTextRef extends Record<string, unknown> {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly encoding: 'utf-8'
  readonly name?: string
}

export interface EngineDocumentLimits {
  readonly maxDocumentBytes: number
  readonly maxDocumentsPerMessage: number
  readonly maxMessageDocumentBytes: number
  readonly maxDecompressedBytes: number
  readonly maxArchiveEntries: number
  readonly maxCompressionRatio: number
  readonly maxXmlNodes: number
  readonly maxParserOutputBytes: number
  readonly parseTimeoutMs: number
  readonly maxConcurrentParses: number
  readonly maxPreviewCharacters: number
  readonly maxSearchResults: number
  readonly maxQueryItems: number
  readonly csvRowsPerBlock: number
  readonly streamThresholdBytes: number
  readonly mediaTypes: readonly string[]
}

export type EngineDocumentQuery =
  | { readonly kind: 'outline' }
  | { readonly kind: 'search'; readonly query: string; readonly limit: number }
  | { readonly kind: 'blocks'; readonly blockIds: readonly string[] }
  | { readonly kind: 'spreadsheet-range'; readonly sheet: string; readonly range: string }
  | { readonly kind: 'slide'; readonly slide: number; readonly includeNotes: boolean }
  | { readonly kind: 'document-path'; readonly path: string }

export class DocumentPipeline {
  readonly parserVersion: string
  constructor(ctx: Context, root: string, limits: EngineDocumentLimits, officeCliPath?: string)
  save(input: { readonly data: Uint8Array; readonly mediaType: string; readonly name?: string }, signal?: AbortSignal): Promise<EngineDocumentRef>
  query(ref: EngineDocumentRef, query: EngineDocumentQuery, signal?: AbortSignal): Promise<Record<string, unknown>>
}

export function saveTextFile(
  root: string,
  input: { readonly data: Uint8Array; readonly mediaType: string; readonly name?: string },
  limits: { readonly maxTextBytes: number; readonly maxTextAttachmentsPerMessage: number; readonly maxMessageTextBytes: number; readonly mediaTypes: readonly string[] },
): Promise<EngineTextRef>

export function readTextFile(
  root: string,
  ref: EngineTextRef,
  signal?: AbortSignal,
): Promise<{ readonly ref: EngineTextRef; readonly data: Uint8Array }>

export const OFFICECLI_VERSION: '1.0.144'
export const OFFICECLI_DARWIN_ARM64_SHA256: '04757163428c5bde8d91e8f838517818e74722157722ca5f3877b6716b77bd45'
