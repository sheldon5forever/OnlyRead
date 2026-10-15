import { basename, join, resolve } from 'node:path'
import { readFile, readdir, stat } from 'node:fs/promises'
import { detectKind, extname } from '../shared/kind'
import { MAX_BINARY_BYTES, MAX_TEXT_BYTES } from '../shared/limits'
import type {
  BinaryPayload,
  DirListing,
  FileEntry,
  FileKind,
  OpenedTarget,
  TextPayload
} from '../shared/types'

export class FileTooLargeError extends Error {
  constructor(size: number, limit: number) {
    super(`文件大小 ${formatSize(size)} 超过预览上限 ${formatSize(limit)}`)
    this.name = 'FileTooLargeError'
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 把任意路径解析为「打开目标」，同时校验其存在性 */
export async function resolveTarget(targetPath: string): Promise<OpenedTarget> {
  const absolute = resolve(targetPath)
  const info = await stat(absolute)
  return {
    type: info.isDirectory() ? 'folder' : 'file',
    path: absolute,
    name: basename(absolute) || absolute
  }
}

/** 读取单个路径的详细信息（供「单独打开文件」构造列表项） */
export async function entryFor(targetPath: string): Promise<FileEntry> {
  const path = resolve(targetPath)
  const info = await stat(path)
  const isDirectory = info.isDirectory()
  return {
    name: basename(path) || path,
    path,
    isDirectory,
    size: isDirectory ? 0 : info.size,
    mtimeMs: info.mtimeMs,
    ext: isDirectory ? '' : extname(path),
    kind: isDirectory ? 'unsupported' : detectKind(path)
  }
}

function isHidden(name: string): boolean {
  return name.startsWith('.')
}

/** 读取目录的直接子项（目录在前，同级按名称排序） */
export async function readDirectory(dirPath: string, showHidden = false): Promise<DirListing> {
  const dir = resolve(dirPath)
  const dirents = await readdir(dir, { withFileTypes: true })

  const entries: FileEntry[] = []
  for (const dirent of dirents) {
    if (!showHidden && isHidden(dirent.name)) continue
    const fullPath = join(dir, dirent.name)
    const isDirectory = dirent.isDirectory()
    let size = 0
    let mtimeMs = 0
    try {
      const info = await stat(fullPath)
      size = isDirectory ? 0 : info.size
      mtimeMs = info.mtimeMs
    } catch {
      // 无权限或已删除的条目：保留但标记为 0 字节
    }
    const ext = isDirectory ? '' : extname(dirent.name)
    entries.push({
      name: dirent.name,
      path: fullPath,
      isDirectory,
      size,
      mtimeMs,
      ext,
      kind: isDirectory ? 'unsupported' : detectKind(dirent.name)
    })
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
  })

  return { dir, entries }
}

interface DecodeResult {
  text: string
  encoding: string
}

/** 按 BOM / 编码探测把字节解码为文本 */
function decodeBuffer(buffer: Buffer): DecodeResult {
  // 1) BOM 探测
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'UTF-8 (BOM)' }
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString('utf16le'), encoding: 'UTF-16 LE' }
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2))
    swapped.swap16()
    return { text: swapped.toString('utf16le'), encoding: 'UTF-16 BE' }
  }

  // 2) 严格 UTF-8 解码
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return { text, encoding: 'UTF-8' }
  } catch {
    // 继续尝试其它常见编码
  }

  // 3) 中文 / 繁体常见遗留编码
  for (const encoding of ['gb18030', 'big5']) {
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(buffer)
      return { text, encoding: encoding.toUpperCase() }
    } catch {
      // 换下一种
    }
  }

  // 4) 兜底：宽松 UTF-8（非法字节替换为 U+FFFD）
  return { text: new TextDecoder('utf-8').decode(buffer), encoding: 'UTF-8 (宽松)' }
}

/** 读取文本类文件（TXT / Markdown / HTML 等） */
export async function readTextFile(filePath: string): Promise<TextPayload & { encoding: string }> {
  const path = resolve(filePath)
  const info = await stat(path)
  if (info.size > MAX_TEXT_BYTES) {
    throw new FileTooLargeError(info.size, MAX_TEXT_BYTES)
  }
  const buffer = await readFile(path)
  const { text, encoding } = decodeBuffer(buffer)
  const ext = extname(path)
  return {
    path,
    name: basename(path),
    ext,
    kind: detectKind(path),
    size: info.size,
    mtimeMs: info.mtimeMs,
    text,
    encoding,
    truncated: false
  }
}

/**
 * 读取二进制文件（Word / PowerPoint / 图片，以及 PDF 的兜底路径）。
 * `maxBytes` 允许调用方为特定场景放宽上限。
 */
export async function readBinaryFile(
  filePath: string,
  maxBytes: number = MAX_BINARY_BYTES
): Promise<BinaryPayload> {
  const path = resolve(filePath)
  const info = await stat(path)
  if (info.size > maxBytes) {
    throw new FileTooLargeError(info.size, maxBytes)
  }
  const buffer = await readFile(path)
  const kind: FileKind = detectKind(path)
  return {
    path,
    name: basename(path),
    ext: extname(path),
    kind,
    size: info.size,
    mtimeMs: info.mtimeMs,
    data: new Uint8Array(buffer)
  }
}
