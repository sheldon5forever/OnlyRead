/** 把字节数格式化为易读文本 */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 修改时间的友好显示 */
export function formatDate(mtimeMs: number): string {
  if (!mtimeMs) return '—'
  const date = new Date(mtimeMs)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

/** 兼容 Windows 与 POSIX 的路径拆分 */
export function splitPath(target: string): string[] {
  const normalized = target.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.split('/').filter(Boolean)
}

/** 取路径末段（文件名） */
export function baseName(target: string): string {
  const parts = splitPath(target)
  return parts.length ? parts[parts.length - 1] : target
}

/** 取父目录 */
export function dirName(target: string): string {
  const normalized = target.replace(/\\/g, '/').replace(/\/+$/, '')
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return '/'
  return normalized.slice(0, idx)
}

/** 取父目录的末段名称，用于面包屑展示 */
export function parentLabel(target: string): string {
  const parts = splitPath(dirName(target))
  return parts.length ? parts[parts.length - 1] : ''
}
