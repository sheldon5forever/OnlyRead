import { useEffect, useMemo, useState } from 'react'
import { ViewerFrame, type ViewerChrome } from './ViewerFrame'
import { ErrorState, LoadingState } from '@renderer/components/StatePanel'
import { mimeFromPath } from '@renderer/lib/path'

interface Props {
  chrome: ViewerChrome
  data: Uint8Array
  path: string
}

export function ImageViewer({ chrome, data, path }: Props): JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mime = useMemo(() => mimeFromPath(path), [path])

  useEffect(() => {
    try {
      const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: mime }))
      setUrl(url)
      setError(null)
      return () => URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return undefined
    }
  }, [data, mime])

  return (
    <ViewerFrame chrome={chrome}>
      {error ? (
        <ErrorState
          title="无法显示该图片"
          message={error}
          hint="文件可能已损坏，或使用了当前不支持的图片编码。"
        />
      ) : url ? (
        <div className="image-view">
          <img
            src={url}
            alt={chrome.title}
            onError={() => setError('图片解码失败，文件可能已损坏。')}
          />
        </div>
      ) : (
        <LoadingState label="正在载入图片…" />
      )}
    </ViewerFrame>
  )
}
