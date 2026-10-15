import {
  BookOpen,
  File as FileIconBase,
  FileCode,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  Presentation
} from 'lucide-react'
import type { FileKind } from '@shared/types'

/** 各文件类别的强调色 */
const KIND_COLOR: Record<FileKind, string> = {
  text: '#8b939c',
  markdown: '#4f8ef7',
  html: '#e07a3f',
  pdf: '#e0453f',
  word: '#2b6bd8',
  powerpoint: '#d9503f',
  image: '#2fa36b',
  unsupported: '#9aa0a8'
}

const KIND_GLYPH: Record<FileKind, typeof FileText> = {
  text: FileCode,
  markdown: BookOpen,
  html: Globe,
  pdf: FileType,
  word: FileText,
  powerpoint: Presentation,
  image: ImageIcon,
  unsupported: FileIconBase
}

interface Props {
  kind: FileKind
  size?: number
  /** 目录图标：是否为展开状态 */
  open?: boolean
}

/** 文件 / 目录图标 */
export function EntryIcon({ kind, size = 15, open = false }: Props): JSX.Element {
  if (kind === 'unsupported') {
    return open ? (
      <FolderOpen size={size} color="#e0a52f" strokeWidth={1.9} />
    ) : (
      <Folder size={size} color="#e0a52f" strokeWidth={1.9} />
    )
  }
  const Glyph = KIND_GLYPH[kind]
  return <Glyph size={size} color={KIND_COLOR[kind]} strokeWidth={1.9} />
}

export { KIND_COLOR }
