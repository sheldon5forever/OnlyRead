import { useEffect, useRef, useState } from 'react'
import mammoth from 'mammoth'
import { ViewerFrame, type OutlineBridge, type ViewerChrome } from './ViewerFrame'
import { ErrorState, LoadingState } from '@renderer/components/StatePanel'
import { assignHeadingIds, scrollToHeading, trackActiveHeading } from '@renderer/lib/scroll'
import { docWidthClass, type DocWidth } from '@renderer/lib/docWidth'

interface Props {
  chrome: ViewerChrome
  bridge: OutlineBridge
  data: Uint8Array
  docWidth: DocWidth
  onDocWidthChange: (width: DocWidth) => void
}

/** 把 IPC 传回的字节转成独立的 ArrayBuffer */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export function DocxViewer({ chrome, bridge, data, docWidth, onDocWidthChange }: Props): JSX.Element {
  const { onOutline, onActiveHeading, registerScrollTo } = bridge
  const containerRef = useRef<HTMLDivElement>(null)

  const [html, setHtml] = useState<string | null>(null)
  const [warnings, setWarnings] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setHtml(null)
    setError(null)

    void mammoth
      .convertToHtml({ arrayBuffer: toArrayBuffer(new Uint8Array(data)) })
      .then((result) => {
        if (cancelled) return
        setHtml(result.value)
        setWarnings(result.messages.length)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [data])

  // 内容挂载后建立大纲与滚动联动
  useEffect(() => {
    const container = containerRef.current
    if (!container || html === null) return

    const timer = window.setTimeout(() => onOutline(assignHeadingIds(container)), 0)
    const stopTracking = trackActiveHeading(container, onActiveHeading)
    registerScrollTo((headingId) => scrollToHeading(container, headingId))

    return () => {
      window.clearTimeout(timer)
      stopTracking()
      registerScrollTo(null)
    }
  }, [html, onOutline, onActiveHeading, registerScrollTo])

  if (error) {
    return (
      <ViewerFrame chrome={chrome}>
        <ErrorState
          title="无法解析 Word 文档"
          message={error}
          hint="阅读器支持 .docx 格式；较老的 .doc 请先用 Word 另存为 .docx。"
        />
      </ViewerFrame>
    )
  }

  return (
    <ViewerFrame
      chrome={chrome}
      extra={warnings > 0 ? <span className="viewer__control">{warnings} 处格式被简化</span> : null}
      docWidth={{ value: docWidth, onChange: onDocWidthChange }}
    >
      {html === null ? (
        <LoadingState label="正在解析 Word 文档…" />
      ) : (
        <div className="doc-scroll">
          <article
            className={`doc ${docWidthClass(docWidth)}`}
            ref={containerRef}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      )}
    </ViewerFrame>
  )
}
