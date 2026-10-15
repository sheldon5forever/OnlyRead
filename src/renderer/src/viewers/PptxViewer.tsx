import { useEffect, useMemo, useRef, useState } from 'react'
import { ViewerFrame, type OutlineBridge, type ViewerChrome } from './ViewerFrame'
import { ErrorState, LoadingState } from '@renderer/components/StatePanel'
import { parsePptx, type PptxDeck, type PptxParagraph, type PptxShape } from '@renderer/lib/pptx'

interface Props {
  chrome: ViewerChrome
  bridge: OutlineBridge
  data: Uint8Array
}

/** 标准幻灯片高度为 540pt（7.5 英寸） */
const DEFAULT_TITLE_PT = 40
const DEFAULT_BODY_PT = 18
const DEFAULT_TABLE_PT = 12

export function PptxViewer({ chrome, bridge, data }: Props): JSX.Element {
  const { onOutline, onActiveHeading, registerScrollTo } = bridge

  const scrollRef = useRef<HTMLDivElement>(null)
  const slideRefs = useRef(new Map<number, HTMLDivElement>())

  const [deck, setDeck] = useState<PptxDeck | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDeck(null)
    setError(null)

    void parsePptx(new Uint8Array(data))
      .then((result) => {
        if (cancelled) return
        setDeck(result)
        onOutline(
          result.slides.map((slide) => ({
            level: 1,
            text: `${slide.index}. ${slide.title}`,
            id: `ppt-slide-${slide.index}`
          }))
        )
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [data, onOutline])

  // 滚动时高亮当前幻灯片
  useEffect(() => {
    const container = scrollRef.current
    if (!container || !deck) return

    let frame = 0
    const onScroll = (): void => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const marker = container.scrollTop + 120
        let active = 1
        slideRefs.current.forEach((node, index) => {
          if (node.offsetTop <= marker) active = Math.max(active, index)
        })
        onActiveHeading(`ppt-slide-${active}`)
      })
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    onActiveHeading('ppt-slide-1')

    return () => {
      container.removeEventListener('scroll', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [deck, onActiveHeading])

  useEffect(() => {
    registerScrollTo((id) => {
      const index = Number(id.replace('ppt-slide-', ''))
      const node = slideRefs.current.get(index)
      const container = scrollRef.current
      if (!node || !container) return
      container.scrollTo({ top: node.offsetTop - 12, behavior: 'smooth' })
    })
    return () => registerScrollTo(null)
  }, [registerScrollTo, deck])

  // 1pt 对应多少 cqh（幻灯片容器高度为 100cqh）
  const ptUnit = useMemo(() => {
    if (!deck?.height) return 100 / 540
    const heightPt = deck.height / 12700
    return heightPt > 0 ? 100 / heightPt : 100 / 540
  }, [deck])

  if (error) {
    return (
      <ViewerFrame chrome={chrome}>
        <ErrorState
          title="无法解析 PowerPoint 文件"
          message={error}
          hint="阅读器支持 .pptx 格式；较老的 .ppt 请先用 PowerPoint 另存为 .pptx。"
        />
      </ViewerFrame>
    )
  }

  return (
    <ViewerFrame
      chrome={chrome}
      extra={deck ? <span className="viewer__control">共 {deck.slides.length} 张</span> : null}
    >
      {!deck ? (
        <LoadingState label="正在解析 PowerPoint 文件…" />
      ) : (
        <div className="ppt-view" ref={scrollRef}>
          <div className="ppt-slides">
            {deck.slides.map((slide) => (
              <div
                key={slide.index}
                id={`ppt-slide-${slide.index}`}
                className="ppt-slide"
                ref={(node) => {
                  if (node) slideRefs.current.set(slide.index, node)
                  else slideRefs.current.delete(slide.index)
                }}
              >
                <div
                  className="ppt-slide__frame"
                  style={{ aspectRatio: `${deck.width} / ${deck.height}` }}
                >
                  {slide.shapes.map((shape, shapeIndex) => (
                    <ShapeView
                      key={shapeIndex}
                      shape={shape}
                      deckWidth={deck.width}
                      deckHeight={deck.height}
                      ptUnit={ptUnit}
                    />
                  ))}
                </div>
                <div className="ppt-slide__index">第 {slide.index} 张</div>
                {slide.notes ? <div className="ppt-slide__notes">备注：{slide.notes}</div> : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </ViewerFrame>
  )
}

interface ShapeProps {
  shape: PptxShape
  deckWidth: number
  deckHeight: number
  ptUnit: number
}

function ShapeView({ shape, deckWidth, deckHeight, ptUnit }: ShapeProps): JSX.Element | null {
  const base = {
    left: `${(shape.x / deckWidth) * 100}%`,
    top: `${(shape.y / deckHeight) * 100}%`,
    width: `${(shape.cx / deckWidth) * 100}%`,
    height: `${(shape.cy / deckHeight) * 100}%`
  }

  if (shape.kind === 'image') {
    return (
      <div className="ppt-shape ppt-shape--picture" style={base}>
        <img src={shape.src} alt={shape.alt} />
      </div>
    )
  }

  if (shape.kind === 'table') {
    return (
      <div className="ppt-shape ppt-shape--table" style={base}>
        <table>
          <colgroup>
            {shape.columnWidths.map((width, index) => (
              <col key={index} style={{ width: `${(width / shape.cx) * 100}%` }} />
            ))}
          </colgroup>
          <tbody>
            {shape.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} colSpan={cell.colspan} rowSpan={cell.rowspan}>
                    <Paragraphs
                      paragraphs={cell.paragraphs}
                      ptUnit={ptUnit}
                      defaultPt={DEFAULT_TABLE_PT}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const anchor =
    shape.anchor === 'middle' ? 'center' : shape.anchor === 'bottom' ? 'flex-end' : 'flex-start'
  const defaultPt = shape.isTitle ? DEFAULT_TITLE_PT : DEFAULT_BODY_PT

  return (
    <div className="ppt-shape" style={{ ...base, display: 'flex', alignItems: anchor }}>
      <div style={{ width: '100%' }}>
        <Paragraphs
          paragraphs={shape.paragraphs}
          ptUnit={ptUnit}
          defaultPt={defaultPt}
          forceAlignCenter={shape.isTitle}
        />
      </div>
    </div>
  )
}

interface ParagraphsProps {
  paragraphs: PptxParagraph[]
  ptUnit: number
  defaultPt: number
  forceAlignCenter?: boolean
}

function Paragraphs({
  paragraphs,
  ptUnit,
  defaultPt,
  forceAlignCenter = false
}: ParagraphsProps): JSX.Element | null {
  const usable = paragraphs.filter((paragraph) => paragraph.runs.some((run) => run.text.length > 0))
  if (usable.length === 0) return null

  return (
    <>
      {usable.map((paragraph, index) => {
        const sizePt = paragraph.sizePt ?? paragraph.runs.find((run) => run.sizePt)?.sizePt ?? defaultPt
        const align = forceAlignCenter && !paragraph.align ? 'center' : (paragraph.align ?? 'left')
        const color = paragraph.runs.find((run) => run.color)?.color

        return (
          <p
            key={index}
            style={{
              margin: '0 0 0.18em',
              marginLeft: `${paragraph.level * 1.4}em`,
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
              fontSize: `${sizePt * ptUnit}cqh`,
              lineHeight: 1.28,
              textAlign: align,
              color: color ?? '#1f2328',
              fontWeight: paragraph.runs.some((run) => run.bold) ? 700 : 400,
              listStyle: 'none'
            }}
          >
            {paragraph.bullet ? '• ' : null}
            {paragraph.runs.map((run, runIndex) => (
              <span
                key={runIndex}
                style={{
                  fontWeight: run.bold ? 700 : undefined,
                  fontStyle: run.italic ? 'italic' : undefined,
                  textDecoration: run.underline ? 'underline' : undefined,
                  color: run.color,
                  whiteSpace: 'pre-wrap'
                }}
              >
                {run.text}
              </span>
            ))}
          </p>
        )
      })}
    </>
  )
}
