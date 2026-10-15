import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { ViewerFrame, type OutlineBridge, type ViewerChrome } from './ViewerFrame'
import { LoadingState, ErrorState } from '@renderer/components/StatePanel'
import type { Heading } from '@renderer/lib/outline'

/**
 * pdf.js 的 worker 在页面为 file:// 时无法直接以文件 URL 构造 Worker，
 * 这里把打包进来的 worker 源码转成 Blob URL 使用，开发与打包后行为一致。
 */
let workerBlobUrl: string | null = null

async function configureWorker(): Promise<void> {
  const { GlobalWorkerOptions } = await import('pdfjs-dist')
  if (!workerBlobUrl) {
    const source = (await import('pdfjs-dist/build/pdf.worker.min.mjs?raw')).default
    workerBlobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  }
  GlobalWorkerOptions.workerSrc = workerBlobUrl
}

/** 没有书签时，页码列表最多展开多少项（避免超大文档撑爆侧栏） */
const MAX_PAGE_OUTLINE = 200

interface Props {
  chrome: ViewerChrome
  bridge: OutlineBridge
  /** 经过自定义协议的流式地址，pdf.js 会按需分片读取 */
  url: string
  /** 协议不可用时整份读取的兜底入口 */
  loadFallback: () => Promise<Uint8Array>
  /** 重新加载的令牌 */
  reloadToken: number
}

const MIN_SCALE = 0.4
const MAX_SCALE = 4

export function PdfViewer({ chrome, bridge, url, loadFallback, reloadToken }: Props): JSX.Element {
  const { onOutline, onActiveHeading, registerScrollTo } = bridge

  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>())
  const tasksRef = useRef(new Map<number, RenderTask>())

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [baseSize, setBaseSize] = useState<{ width: number; height: number } | null>(null)
  const [scale, setScale] = useState(1.2)
  const [currentPage, setCurrentPage] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState('正在解析 PDF…')

  const renderedRef = useRef(new Set<number>())
  const genRef = useRef(0)
  const docRef = useRef<PDFDocumentProxy | null>(null)

  // 载入文档
  useEffect(() => {
    let cancelled = false

    setDoc(null)
    setNumPages(0)
    setBaseSize(null)
    setError(null)
    setProgress('正在解析 PDF…')
    genRef.current += 1
    renderedRef.current.clear()
    pageRefs.current.clear()
    canvasRefs.current.clear()

    const load = async (): Promise<void> => {
      await configureWorker()
      const { getDocument } = await import('pdfjs-dist')

      const options = {
        cMapUrl: './cmaps/',
        cMapPacked: true,
        standardFontDataUrl: './standard_fonts/',
        useSystemFonts: true
      }

      const trackProgress = (task: PDFDocumentLoadingTask): void => {
        task.onProgress = (data: { loaded: number; total: number }): void => {
          if (data.total) {
            setProgress(`正在解析 PDF… ${Math.round((data.loaded / data.total) * 100)}%`)
          }
        }
      }

      let proxy: PDFDocumentProxy
      try {
        // 首选流式读取：几百 MB 的文件也只按需拉取分片
        const task = getDocument({ url, ...options })
        trackProgress(task)
        proxy = await task.promise
      } catch (streamError) {
        if (cancelled) throw streamError
        console.log('[pdf] 流式读取失败，回退为整份读取：', String(streamError))
        setProgress('正在整份读取 PDF…')
        const bytes = await loadFallback()
        const task = getDocument({ data: bytes, ...options })
        trackProgress(task)
        proxy = await task.promise
      }

      if (cancelled) {
        void proxy.destroy()
        return
      }

      const firstPage = await proxy.getPage(1)
      const viewport = firstPage.getViewport({ scale: 1 })

      docRef.current = proxy
      setDoc(proxy)
      setNumPages(proxy.numPages)
      setBaseSize({ width: viewport.width, height: viewport.height })
      setCurrentPage(1)

      void buildOutline(proxy).then((headings) => {
        if (!cancelled) onOutline(headings)
      })
    }

    load().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err))
    })

    return () => {
      cancelled = true
      tasksRef.current.forEach((task) => task.cancel())
      tasksRef.current.clear()
      void docRef.current?.destroy()
      docRef.current = null
    }
  }, [url, reloadToken, loadFallback, onOutline])

  const renderPage = useCallback(
    async (pageNumber: number): Promise<void> => {
      if (!doc || renderedRef.current.has(pageNumber)) return
      const canvas = canvasRefs.current.get(pageNumber)
      const holder = pageRefs.current.get(pageNumber)
      if (!canvas || !holder) return

      renderedRef.current.add(pageNumber)
      const generation = genRef.current

      try {
        const page = await doc.getPage(pageNumber)
        if (genRef.current !== generation) return

        const viewport = page.getViewport({ scale })
        const ratio = Math.min(window.devicePixelRatio || 1, 2)

        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        holder.style.width = `${Math.floor(viewport.width)}px`
        holder.style.height = `${Math.floor(viewport.height)}px`

        const context = canvas.getContext('2d')
        if (!context) return

        const task = page.render({
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]
        })
        tasksRef.current.set(pageNumber, task)
        await task.promise
        tasksRef.current.delete(pageNumber)
      } catch {
        renderedRef.current.delete(pageNumber)
      }
    },
    [doc, scale]
  )

  /** 渲染视口内（含上下各一屏）的页面 */
  const renderVisible = useCallback((): void => {
    const container = scrollRef.current
    if (!container) return
    const top = container.scrollTop - container.clientHeight
    const bottom = container.scrollTop + container.clientHeight * 2

    pageRefs.current.forEach((holder, pageNumber) => {
      if (renderedRef.current.has(pageNumber)) return
      const pageTop = holder.offsetTop
      if (pageTop >= top && pageTop <= bottom) void renderPage(pageNumber)
    })
  }, [renderPage])

  // 缩放或文档变化后重绘
  useEffect(() => {
    if (!doc) return
    genRef.current += 1
    renderedRef.current.clear()
    tasksRef.current.forEach((task) => task.cancel())
    tasksRef.current.clear()
    const timer = window.setTimeout(renderVisible, 0)
    return () => window.clearTimeout(timer)
  }, [doc, scale, renderVisible])

  // 滚动时按需渲染并同步当前页码
  useEffect(() => {
    const container = scrollRef.current
    if (!container || !doc) return

    let frame = 0
    const onScroll = (): void => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        renderVisible()

        const marker = container.scrollTop + 90
        let active = 1
        pageRefs.current.forEach((holder, pageNumber) => {
          if (holder.offsetTop <= marker) active = Math.max(active, pageNumber)
        })
        setCurrentPage(active)
        onActiveHeading(`pdf-page-${active}`)
      })
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    renderVisible()

    return () => {
      container.removeEventListener('scroll', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [doc, renderVisible, onActiveHeading])

  // 大纲跳转
  useEffect(() => {
    registerScrollTo((id) => {
      const pageNumber = Number(id.replace('pdf-page-', ''))
      if (!Number.isFinite(pageNumber)) return
      const holder = pageRefs.current.get(pageNumber)
      const container = scrollRef.current
      if (!holder || !container) return
      container.scrollTo({ top: holder.offsetTop - 12, behavior: 'smooth' })
    })
    return () => registerScrollTo(null)
  }, [registerScrollTo, doc])

  const goToPage = (pageNumber: number): void => {
    const next = Math.min(Math.max(1, pageNumber), numPages)
    setCurrentPage(next)
    const holder = pageRefs.current.get(next)
    const container = scrollRef.current
    if (holder && container) container.scrollTo({ top: holder.offsetTop - 12 })
  }

  const fitWidth = (): void => {
    const container = scrollRef.current
    if (!container || !baseSize) return
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, (container.clientWidth - 48) / baseSize.width)))
  }

  const totalWidth = baseSize ? Math.floor(baseSize.width * scale) : 0
  const totalHeight = baseSize ? Math.floor(baseSize.height * scale) : 0

  if (error) {
    return (
      <ViewerFrame chrome={chrome}>
        <ErrorState
          title="无法解析 PDF"
          message={error}
          hint="文件可能已损坏，或使用了加密保护。"
        />
      </ViewerFrame>
    )
  }

  return (
    <ViewerFrame
      chrome={chrome}
      extra={
        <>
          <div className="viewer__pagebox">
            <button
              type="button"
              className="viewer__control"
              title="上一页"
              onClick={() => goToPage(currentPage - 1)}
            >
              <ChevronLeft size={13} />
            </button>
            <input
              value={currentPage}
              onChange={(event) => {
                const value = Number(event.target.value.replace(/\D/g, ''))
                if (value) goToPage(value)
              }}
              aria-label="页码"
            />
            <span>/ {numPages || '—'}</span>
            <button
              type="button"
              className="viewer__control"
              title="下一页"
              onClick={() => goToPage(currentPage + 1)}
            >
              <ChevronRight size={13} />
            </button>
          </div>
          <button
            type="button"
            className="viewer__control"
            title="缩小"
            onClick={() => setScale((value) => Math.max(MIN_SCALE, value - 0.2))}
          >
            <ZoomOut size={13} />
          </button>
          <span className="viewer__zoom">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="viewer__control"
            title="放大"
            onClick={() => setScale((value) => Math.min(MAX_SCALE, value + 0.2))}
          >
            <ZoomIn size={13} />
          </button>
          <button type="button" className="viewer__control" title="适应宽度" onClick={fitWidth}>
            <Maximize size={13} />
          </button>
        </>
      }
    >
      {!doc || !baseSize ? (
        <LoadingState label={progress} />
      ) : (
        <div className="pdf-view" ref={scrollRef}>
          <div className="pdf-pages">
            {Array.from({ length: numPages }, (_, index) => {
              const pageNumber = index + 1
              return (
                <div
                  key={pageNumber}
                  id={`pdf-page-${pageNumber}`}
                  className="pdf-page"
                  style={{ width: totalWidth, height: totalHeight }}
                  ref={(node) => {
                    if (node) pageRefs.current.set(pageNumber, node)
                    else pageRefs.current.delete(pageNumber)
                  }}
                >
                  <canvas
                    className="pdf-page__canvas"
                    ref={(node) => {
                      if (node) canvasRefs.current.set(pageNumber, node)
                      else canvasRefs.current.delete(pageNumber)
                    }}
                  />
                  <div className="pdf-page__label">{pageNumber}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </ViewerFrame>
  )
}

/* ------------------------------------------------------------------ *
 * 大纲：优先使用 PDF 自带书签，没有书签的小文档回退为页码列表
 * ------------------------------------------------------------------ */

interface OutlineNode {
  title: string
  dest: string | unknown[] | null
  items?: OutlineNode[]
}

async function resolveDestPage(proxy: PDFDocumentProxy, dest: OutlineNode['dest']): Promise<number | null> {
  if (!dest) return null
  try {
    const explicit = typeof dest === 'string' ? await proxy.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit.length === 0) return null

    const target = explicit[0]
    if (typeof target === 'number') return target + 1
    const index = await proxy.getPageIndex(target as never)
    return index + 1
  } catch {
    return null
  }
}

async function buildOutline(proxy: PDFDocumentProxy): Promise<Heading[]> {
  const bookmarks = await proxy.getOutline().catch(() => null)

  if (bookmarks && bookmarks.length > 0) {
    const headings: Heading[] = []

    const visit = async (nodes: OutlineNode[], level: number): Promise<void> => {
      for (const node of nodes) {
        const page = await resolveDestPage(proxy, node.dest)
        // 无法定位页码的书签（外链等）不进入目录
        if (page !== null) {
          headings.push({ level, text: node.title || `第 ${page} 页`, id: `pdf-page-${page}` })
        }
        if (node.items && node.items.length > 0) await visit(node.items, level + 1)
      }
    }

    await visit(bookmarks as OutlineNode[], 1)
    if (headings.length > 0) return headings
  }

  // 没有书签时给出页码列表，但限制条目数避免超大文档拖慢侧栏
  if (proxy.numPages <= MAX_PAGE_OUTLINE) {
    return Array.from({ length: proxy.numPages }, (_, index) => ({
      level: 1,
      text: `第 ${index + 1} 页`,
      id: `pdf-page-${index + 1}`
    }))
  }

  return []
}
