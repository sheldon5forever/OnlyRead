/**
 * 主进程与渲染进程共享的类型定义。
 */

/** 阅读器支持的文件类别 */
export type FileKind =
  | 'text'
  | 'markdown'
  | 'html'
  | 'pdf'
  | 'word'
  | 'powerpoint'
  | 'image'
  | 'unsupported'

export interface FileEntry {
  /** 文件 / 目录名 */
  name: string
  /** 绝对路径 */
  path: string
  isDirectory: boolean
  /** 字节大小，目录为 0 */
  size: number
  /** 修改时间（毫秒时间戳） */
  mtimeMs: number
  /** 小写扩展名，含前导点，目录为空串 */
  ext: string
  kind: FileKind
}

export interface DirListing {
  /** 被展开的目录绝对路径 */
  dir: string
  entries: FileEntry[]
}

/** 用户打开的目标：单个文件或整个文件夹 */
export interface OpenedTarget {
  type: 'file' | 'folder'
  path: string
  name: string
}

export interface FilePayloadMeta {
  path: string
  name: string
  ext: string
  kind: FileKind
  size: number
  mtimeMs: number
}

export interface TextPayload extends FilePayloadMeta {
  text: string
  /** 探测到的文本编码，例如 UTF-8 / GB18030 */
  encoding: string
  /** 文件过大而被截断时为 true */
  truncated: boolean
}

export interface BinaryPayload extends FilePayloadMeta {
  /** 原始字节内容，用于 PDF / Word / PowerPoint 解析 */
  data: Uint8Array
}

export interface WindowState {
  maximized: boolean
  fullscreen: boolean
}
