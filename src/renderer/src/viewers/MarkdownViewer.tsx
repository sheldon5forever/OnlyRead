import { useCallback, useEffect, useMemo, useRef } from 'react'
import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { assignHeadingIds, scrollToHeading, trackActiveHeading } from '@renderer/lib/scroll'
import { isExternalUrl, joinPath } from '@renderer/lib/path'
import { docWidthClass, type DocWidth } from '@renderer/lib/docWidth'
import { LocalImage } from '@renderer/components/LocalImage'
import { ViewerFrame, type OutlineBridge, type ViewerChrome } from './ViewerFrame'

interface Props {
  chrome: ViewerChrome
  bridge: OutlineBridge
  text: string
  /** 当前文档所在目录，用于解析相对链接与图片 */
  baseDir: string
  onOpenLocal: (path: string) => void
  docWidth: DocWidth
  onDocWidthChange: (width: DocWidth) => void
}

export function MarkdownViewer({
  chrome,
  bridge,
  text,
  baseDir,
  onOpenLocal,
  docWidth,
  onDocWidthChange
}: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const { onOutline, onActiveHeading, registerScrollTo } = bridge

  const handleLink = useCallback(
    (href?: string) => {
      if (!href) return
      const container = containerRef.current
      if (href.startsWith('#')) {
        if (container) scrollToHeading(container, decodeURIComponent(href.slice(1)))
        return
      }
      if (isExternalUrl(href)) {
        void window.reader.openExternal(href)
        return
      }
      const [pathPart] = href.split('#')
      if (!pathPart) return
      onOpenLocal(joinPath(baseDir, decodeURIComponent(pathPart)))
    },
    [baseDir, onOpenLocal]
  )

  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, node: _node, ...rest }) => (
        <a
          {...rest}
          href={href}
          onClick={(event) => {
            event.preventDefault()
            handleLink(href)
          }}
        >
          {children}
        </a>
      ),
      img: ({ src, alt, node: _node, ...rest }) => (
        <LocalImage
          {...rest}
          baseDir={baseDir}
          src={typeof src === 'string' ? src : undefined}
          alt={alt ?? ''}
        />
      )
    }),
    [baseDir, handleLink]
  )

  // 渲染完成后统一补锚点，保证大纲与正文一致
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const timer = window.setTimeout(() => onOutline(assignHeadingIds(container)), 0)
    const stopTracking = trackActiveHeading(container, onActiveHeading)
    registerScrollTo((headingId) => scrollToHeading(container, headingId))

    return () => {
      window.clearTimeout(timer)
      stopTracking()
      registerScrollTo(null)
    }
  }, [text, onOutline, onActiveHeading, registerScrollTo])

  return (
    <ViewerFrame
      chrome={chrome}
      docWidth={{ value: docWidth, onChange: onDocWidthChange }}
    >
      <div className="doc-scroll" ref={containerRef}>
        <article className={`doc ${docWidthClass(docWidth)}`}>
          <Markdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
            components={components}
          >
            {text}
          </Markdown>
        </article>
      </div>
    </ViewerFrame>
  )
}
