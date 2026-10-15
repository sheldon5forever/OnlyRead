import { useEffect, useState } from 'react'
import type { ImgHTMLAttributes } from 'react'
import { isAbsolutePath, joinPath, mimeFromPath } from '@renderer/lib/path'

interface Props extends ImgHTMLAttributes<HTMLImageElement> {
  /** 文档所在目录，用于解析相对路径 */
  baseDir: string
}

/**
 * 把相对路径的本地图片转换成 blob URL 再展示。
 * 直接使用 file:// 在内置浏览器中会受到安全策略限制，这里统一走主进程读取。
 */
export function LocalImage({ baseDir, src, alt, ...rest }: Props): JSX.Element {
  const [resolved, setResolved] = useState<string | null>(null)

  const isRemote = !src || /^(https?:|data:|blob:)/i.test(src)
  const absolute = src && !isRemote ? (isAbsolutePath(src) ? src : joinPath(baseDir, src)) : src

  useEffect(() => {
    if (!absolute || isRemote) {
      setResolved(null)
      return
    }

    let url: string | null = null
    let cancelled = false

    void window.reader
      .readBinary(absolute)
      .then((payload) => {
        if (cancelled) return
        const bytes = new Uint8Array(payload.data)
        url = URL.createObjectURL(new Blob([bytes], { type: mimeFromPath(absolute) }))
        setResolved(url)
      })
      .catch(() => {
        if (!cancelled) setResolved(null)
      })

    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [absolute, isRemote])

  if (isRemote) {
    return <img src={src} alt={alt} {...rest} />
  }

  if (resolved) {
    return <img src={resolved} alt={alt} {...rest} />
  }

  return <span className="local-image--pending">{alt || '图片'}</span>
}
