/** 判断是否为绝对路径（含 Windows 盘符与 UNC） */
export function isAbsolutePath(target: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(target) || target.startsWith('/') || target.startsWith('\\\\')
}

/** 拼接路径，处理 . 与 .. */
export function joinPath(baseDir: string, relative: string): string {
  if (isAbsolutePath(relative)) return relative

  const separator = baseDir.includes('\\') && !baseDir.includes('/') ? '\\' : '/'
  const segments = baseDir.replace(/\\/g, '/').split('/')

  for (const part of relative.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (segments.length > 1) segments.pop()
      continue
    }
    segments.push(part)
  }

  const joined = segments.join('/')
  return separator === '\\' ? joined.replace(/\//g, '\\') : joined
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon'
}

/** 根据扩展名推断图片 MIME 类型 */
export function mimeFromPath(target: string): string {
  const idx = target.lastIndexOf('.')
  if (idx < 0) return 'application/octet-stream'
  return MIME_BY_EXT[target.slice(idx).toLowerCase()] ?? 'application/octet-stream'
}

/** 判断链接是否为外部地址 */
export function isExternalUrl(href: string): boolean {
  return /^(https?|mailto|tel):/i.test(href)
}
