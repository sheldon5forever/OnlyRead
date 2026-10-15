import { useEffect, useMemo, useRef } from 'react'
import { prepareHtmlForPreview, type PreviewPalette } from '@renderer/lib/html'
import { isExternalUrl, joinPath } from '@renderer/lib/path'
import { docMaxWidthCss, type DocWidth } from '@renderer/lib/docWidth'
import { ViewerFrame, type OutlineBridge, type ViewerChrome } from './ViewerFrame'

interface Props {
  chrome: ViewerChrome
  bridge: OutlineBridge
  html: string
  baseDir: string
  palette: PreviewPalette
  onOpenLocal: (path: string) => void
  docWidth: DocWidth
  onDocWidthChange: (width: DocWidth) => void
}

export function HtmlViewer({
  chrome,
  bridge,
  html,
  baseDir,
  palette,
  onOpenLocal,
  docWidth,
  onDocWidthChange
}: Props): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { onOutline, onActiveHeading, registerScrollTo } = bridge

  const prepared = useMemo(
    () => prepareHtmlForPreview(html, baseDir, palette, docMaxWidthCss(docWidth)),
    [html, baseDir, palette, docWidth]
  )

  useEffect(() => {
    onActiveHeading(null)
    onOutline(prepared.headingIds)
  }, [prepared, onOutline, onActiveHeading])

  useEffect(() => {
    registerScrollTo((headingId) => {
      const doc = iframeRef.current?.contentDocument
      doc?.getElementById(headingId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => registerScrollTo(null)
  }, [registerScrollTo, prepared])

  // 拦截 iframe 内的链接：外部地址交给系统浏览器，本地文件用阅读器打开
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return

    const onClick = (event: MouseEvent): void => {
      const anchor = (event.target as HTMLElement | null)?.closest('a')
      const href = anchor?.getAttribute('href')
      if (!href) return

      event.preventDefault()

      if (href.startsWith('#')) {
        doc.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: 'smooth' })
        return
      }
      if (isExternalUrl(href)) {
        void window.reader.openExternal(href)
        return
      }
      const [pathPart] = href.split('#')
      if (pathPart) onOpenLocal(joinPath(baseDir, decodeURIComponent(pathPart)))
    }

    doc.addEventListener('click', onClick)
    return () => doc.removeEventListener('click', onClick)
  }, [prepared, baseDir, onOpenLocal])

  return (
    <ViewerFrame chrome={chrome} docWidth={{ value: docWidth, onChange: onDocWidthChange }}>
      <iframe
        ref={iframeRef}
        className="html-frame"
        title="HTML 预览"
        sandbox="allow-same-origin"
        srcDoc={prepared.html}
      />
    </ViewerFrame>
  )
}
