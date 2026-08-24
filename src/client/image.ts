/*
 * The patch-budget dimension algorithm is adapted from OpenAI Codex:
 * https://github.com/openai/codex/tree/main/codex-rs/utils/image
 * Copyright 2025 OpenAI. Licensed under Apache-2.0.
 * Translated from Rust to TypeScript and modified for the DSH browser image path.
 */
const MAX_NATIVE_DIMENSION = 2_000
const MAX_PATCHES = 2_500
const PATCH_SIZE = 32
const MAX_NATIVE_BYTES = Math.floor(3.4 * 1024 * 1024)

export interface ImageDimensions { readonly width: number; readonly height: number }
export interface PreparedImage {
  readonly file: File
  readonly source: ImageDimensions
  readonly output: ImageDimensions
  readonly resized: boolean
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.subarray(offset, offset + length))
}

function uint24le(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8) | ((data[offset + 2] ?? 0) << 16)
}

function pngDimensions(data: Uint8Array): ImageDimensions | undefined {
  if (data.length < 24 || ascii(data, 1, 3) !== 'PNG') return undefined
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function gifDimensions(data: Uint8Array): ImageDimensions | undefined {
  if (data.length < 10 || (ascii(data, 0, 6) !== 'GIF87a' && ascii(data, 0, 6) !== 'GIF89a')) return undefined
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
}

function jpegDimensions(data: Uint8Array): ImageDimensions | undefined {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return undefined
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 2
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) { offset += 1; continue }
    const marker = data[offset + 1] ?? 0
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue }
    const length = view.getUint16(offset + 2)
    if (length < 2 || offset + 2 + length > data.length) return undefined
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) }
    }
    offset += 2 + length
  }
  return undefined
}

function webpDimensions(data: Uint8Array): ImageDimensions | undefined {
  if (data.length < 30 || ascii(data, 0, 4) !== 'RIFF' || ascii(data, 8, 4) !== 'WEBP') return undefined
  const kind = ascii(data, 12, 4)
  if (kind === 'VP8X') return { width: uint24le(data, 24) + 1, height: uint24le(data, 27) + 1 }
  if (kind === 'VP8L' && data[20] === 0x2f) {
    const b1 = data[21] ?? 0; const b2 = data[22] ?? 0; const b3 = data[23] ?? 0; const b4 = data[24] ?? 0
    return { width: 1 + b1 + ((b2 & 0x3f) << 8), height: 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10) }
  }
  if (kind === 'VP8 ' && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
  }
  return undefined
}

export function outputDimensions(sourceWidth: number, sourceHeight: number): ImageDimensions {
  const originalWidth = Math.max(1, sourceWidth)
  const originalHeight = Math.max(1, sourceHeight)
  const fits = (width: number, height: number) => width <= MAX_NATIVE_DIMENSION && height <= MAX_NATIVE_DIMENSION
    && Math.ceil(width / PATCH_SIZE) * Math.ceil(height / PATCH_SIZE) <= MAX_PATCHES
  if (fits(originalWidth, originalHeight)) return { width: originalWidth, height: originalHeight }
  const sideScale = Math.min(1, MAX_NATIVE_DIMENSION / Math.max(originalWidth, originalHeight))
  const width = Math.max(1, Math.round(originalWidth * sideScale))
  const height = Math.max(1, Math.round(originalHeight * sideScale))
  if (fits(width, height)) return { width, height }
  let scale = Math.sqrt((PATCH_SIZE * PATCH_SIZE * MAX_PATCHES) / width / height)
  const patchesWide = width * scale / PATCH_SIZE
  const patchesHigh = height * scale / PATCH_SIZE
  scale *= Math.min(Math.floor(patchesWide) / patchesWide, Math.floor(patchesHigh) / patchesHigh)
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }
}

async function probe(file: File): Promise<ImageDimensions> {
  const header = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
  const parsed = pngDimensions(header) ?? gifDimensions(header) ?? jpegDimensions(header) ?? webpDimensions(header)
  if (parsed !== undefined && parsed.width > 0 && parsed.height > 0) return parsed
  const bitmap = await createImageBitmap(file)
  try { return { width: bitmap.width, height: bitmap.height } } finally { bitmap.close() }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => { if (blob === null) reject(new Error('浏览器无法编码图片。')); else resolve(blob) },
    type,
    quality,
  ))
}

async function encode(canvas: HTMLCanvasElement, sourceType: string): Promise<Blob> {
  const preferred = sourceType === 'image/jpeg' ? 'image/jpeg' : 'image/webp'
  let latest: Blob | undefined
  for (const quality of [0.92, 0.86, 0.8, 0.72, 0.64]) {
    latest = await canvasBlob(canvas, preferred, quality)
    if (latest.size <= MAX_NATIVE_BYTES) return latest
  }
  if (preferred !== 'image/jpeg') {
    for (const quality of [0.8, 0.7, 0.6]) {
      latest = await canvasBlob(canvas, 'image/jpeg', quality)
      if (latest.size <= MAX_NATIVE_BYTES) return latest
    }
  }
  throw new Error(`图片压缩后仍超过 ${Math.round(MAX_NATIVE_BYTES / 1024 / 1024 * 10) / 10} MiB。`)
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const source = await probe(file)
  const output = outputDimensions(source.width, source.height)
  const normalizedType = file.type === 'image/jpg' ? 'image/jpeg' : file.type
  const supported = normalizedType === 'image/png' || normalizedType === 'image/jpeg' || normalizedType === 'image/webp'
  if (supported && file.size <= MAX_NATIVE_BYTES && output.width === source.width && output.height === source.height) {
    return { file, source, output, resized: false }
  }
  const bitmap = await createImageBitmap(file, {
    resizeWidth: output.width, resizeHeight: output.height, resizeQuality: 'high', imageOrientation: 'from-image',
  })
  try {
    const canvas = document.createElement('canvas')
    canvas.width = output.width; canvas.height = output.height
    const context = canvas.getContext('2d', { alpha: true })
    if (context === null) throw new Error('浏览器无法创建图片画布。')
    context.drawImage(bitmap, 0, 0, output.width, output.height)
    const blob = await encode(canvas, normalizedType)
    return { file: new File([blob], file.name, { type: blob.type, lastModified: file.lastModified }), source, output, resized: true }
  } finally {
    bitmap.close()
  }
}

export function isImageFile(file: File): boolean {
  return /^(image\/(png|jpeg|jpg|webp|gif))$/u.test(file.type)
    || /\.(png|jpe?g|webp|gif)$/iu.test(file.name)
}
