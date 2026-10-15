import type { FileKind } from './types'

/** 视为纯文本的扩展名 */
const TEXT_EXTS = new Set([
  '.txt',
  '.text',
  '.log',
  '.csv',
  '.tsv',
  '.json',
  '.jsonc',
  '.xml',
  '.ini',
  '.cfg',
  '.conf',
  '.yml',
  '.yaml',
  '.toml',
  '.env',
  '.sql',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.php',
  '.sh',
  '.bat',
  '.ps1',
  '.css',
  '.scss',
  '.less',
  '.vue',
  '.svelte'
])

const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx'])
const HTML_EXTS = new Set(['.html', '.htm', '.xhtml'])
const PDF_EXTS = new Set(['.pdf'])
const WORD_EXTS = new Set(['.docx', '.docm'])
const POWERPOINT_EXTS = new Set(['.pptx', '.pptm'])
const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.avif',
  '.ico'
])

/** 取小写扩展名（含点），无扩展名时返回空串 */
export function extname(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? ''
  const idx = base.lastIndexOf('.')
  if (idx <= 0) return ''
  return base.slice(idx).toLowerCase()
}

/** 根据扩展名推断文件类别 */
export function detectKind(filePath: string): FileKind {
  const ext = extname(filePath)
  if (MARKDOWN_EXTS.has(ext)) return 'markdown'
  if (HTML_EXTS.has(ext)) return 'html'
  if (PDF_EXTS.has(ext)) return 'pdf'
  if (WORD_EXTS.has(ext)) return 'word'
  if (POWERPOINT_EXTS.has(ext)) return 'powerpoint'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (TEXT_EXTS.has(ext)) return 'text'
  return 'unsupported'
}

/** 该类别是否可以按文本方式读取 */
export function isTextKind(kind: FileKind): boolean {
  return kind === 'text' || kind === 'markdown' || kind === 'html'
}

/** 供界面展示的类别中文名 */
export const KIND_LABEL: Record<FileKind, string> = {
  text: '纯文本',
  markdown: 'Markdown',
  html: '网页',
  pdf: 'PDF',
  word: 'Word 文档',
  powerpoint: 'PowerPoint',
  image: '图片',
  unsupported: '不支持'
}

/** 阅读器可预览的全部扩展名（用于过滤文件列表） */
export const SUPPORTED_EXTS: string[] = [
  ...TEXT_EXTS,
  ...MARKDOWN_EXTS,
  ...HTML_EXTS,
  ...PDF_EXTS,
  ...WORD_EXTS,
  ...POWERPOINT_EXTS,
  ...IMAGE_EXTS
]
