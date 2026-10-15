import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BinaryPayload, FileEntry, TextPayload } from '@shared/types'
import { KIND_LABEL, isTextKind } from '@shared/kind'
import { MAX_PDF_BYTES, MAX_PDF_FALLBACK_BYTES } from '@shared/limits'
import { toStreamUrl } from '@shared/protocol'
import { formatDate, formatSize, dirName } from '@renderer/lib/format'
import type { DocWidth } from '@renderer/lib/docWidth'
import { DARK_PALETTE, LIGHT_PALETTE, type PreviewPalette } from '@renderer/lib/html'
import type { ResolvedTheme } from '@renderer/lib/theme'
import { ErrorState, LoadingState, UnsupportedState } from '@renderer/components/StatePanel'
import type { OutlineBridge, ViewerChrome } from './ViewerFrame'
import { TextViewer } from './TextViewer'
import { MarkdownViewer } from './MarkdownViewer'
import { HtmlViewer } from './HtmlViewer'
import { DocxViewer } from './DocxViewer'
import { PptxViewer } from './PptxViewer'
import { PdfViewer } from './PdfViewer'
import { ImageViewer } from './ImageViewer'

export interface DocInfo {
  encoding?: string
  pages?: number
  slides?: number
}

export interface TextPrefs {
  showLineNumbers: boolean
  wrap: boolean
}

interface Props {
  entry: FileEntry
  /** 重新读取文件的令牌（点击刷新时递增） */
  reloadToken: number
  theme: ResolvedTheme
  bridge: OutlineBridge
  favorited: boolean
  onToggleFavorite: () => void
  onReveal: () => void
  onOpenLocal: (path: string) => void
  onDocInfo: (info: DocInfo) => void
  textPrefs: TextPrefs
  onToggleLineNumbers: () => void
  onToggleWrap: () => void
  /** 文档型内容的排版宽度 */
  docWidth: DocWidth
  onDocWidthChange: (width: DocWidth) => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'stream' }
  | { status: 'error'; message: string }
  | { status: 'text'; payload: TextPayload }
  | { status: 'binary'; payload: BinaryPayload }

export function Viewer({
  entry,
  reloadToken,
  theme,
  bridge,
  favorited,
  onToggleFavorite,
  onReveal,
  onOpenLocal,
  onDocInfo,
  textPrefs,
  onToggleLineNumbers,
  onToggleWrap,
  docWidth,
  onDocWidthChange
}: Props): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  const palette: PreviewPalette = theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE

  const pdfUrl = useMemo(() => (entry.kind === 'pdf' ? toStreamUrl(entry.path) : null), [entry.kind, entry.path])

  /** PDF 在自定义协议不可用时整份读取（放宽上限） */
  const loadPdfFallback = useCallback(async (): Promise<Uint8Array> => {
    const payload = await window.reader.readBinary(entry.path, MAX_PDF_FALLBACK_BYTES)
    return new Uint8Array(payload.data)
  }, [entry.path])

  useEffect(() => {
    if (entry.kind === 'unsupported') {
      setState({ status: 'error', message: '__unsupported__' })
      return
    }

    // PDF 直接交给 pdf.js 流式读取，不在这里整份载入
    if (entry.kind === 'pdf') {
      setState({ status: 'stream' })
      onDocInfo({})
      return
    }

    let cancelled = false
    setState({ status: 'loading' })
    onDocInfo({})

    const run = async (): Promise<void> => {
      if (isTextKind(entry.kind)) {
        const payload = await window.reader.readText(entry.path)
        if (cancelled) return
        setState({ status: 'text', payload })
        onDocInfo({ encoding: payload.encoding })
      } else {
        const payload = await window.reader.readBinary(entry.path)
        if (cancelled) return
        setState({ status: 'binary', payload })
        onDocInfo({})
      }
    }

    run().catch((error: unknown) => {
      if (cancelled) return
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })

    return () => {
      cancelled = true
    }
  }, [entry.path, entry.kind, reloadToken, onDocInfo])

  const chrome: ViewerChrome = useMemo(
    () => ({
      title: entry.name,
      info: `${KIND_LABEL[entry.kind]} · ${formatSize(entry.size)} · ${formatDate(entry.mtimeMs)}`,
      favorited,
      onToggleFavorite,
      onReveal
    }),
    [entry.name, entry.kind, entry.size, entry.mtimeMs, favorited, onToggleFavorite, onReveal]
  )

  if (entry.kind === 'unsupported') {
    return (
      <UnsupportedState
        name={entry.name}
        kindLabel={entry.ext ? `${entry.ext.slice(1).toUpperCase()} 文件` : '该类型文件'}
        message={`${entry.name} 暂时无法在阅读器中预览，可在文件管理器中用对应软件打开。`}
      />
    )
  }

  if (state.status === 'loading') {
    return <LoadingState label={`正在读取 ${entry.name}…`} />
  }

  if (state.status === 'error') {
    return <ErrorState message={state.message} />
  }

  // PDF：交给 pdf.js 通过自定义协议按需分片读取
  if (state.status === 'stream' && pdfUrl) {
    if (entry.size > MAX_PDF_BYTES) {
      return (
        <ErrorState
          title="PDF 过大"
          message={`${entry.name} 大小为 ${formatSize(entry.size)}，超过 ${formatSize(MAX_PDF_BYTES)} 的预览上限。`}
        />
      )
    }

    return (
      <PdfViewer
        chrome={chrome}
        bridge={bridge}
        url={pdfUrl}
        loadFallback={loadPdfFallback}
        reloadToken={reloadToken}
      />
    )
  }

  const baseDir = dirName(entry.path)

  if (state.status === 'text') {
    const { text } = state.payload

    if (entry.kind === 'markdown') {
      return (
        <MarkdownViewer
          chrome={chrome}
          bridge={bridge}
          text={text}
          baseDir={baseDir}
          onOpenLocal={onOpenLocal}
          docWidth={docWidth}
          onDocWidthChange={onDocWidthChange}
        />
      )
    }

    if (entry.kind === 'html') {
      return (
        <HtmlViewer
          chrome={chrome}
          bridge={bridge}
          html={text}
          baseDir={baseDir}
          palette={palette}
          onOpenLocal={onOpenLocal}
          docWidth={docWidth}
          onDocWidthChange={onDocWidthChange}
        />
      )
    }

    return (
      <TextViewer
        chrome={chrome}
        text={text}
        showLineNumbers={textPrefs.showLineNumbers}
        onToggleLineNumbers={onToggleLineNumbers}
        wrap={textPrefs.wrap}
        onToggleWrap={onToggleWrap}
      />
    )
  }

  if (state.status !== 'binary') {
    return <LoadingState />
  }

  const { data } = state.payload

  switch (entry.kind) {
    case 'word':
      return (
        <DocxViewer
          chrome={chrome}
          bridge={bridge}
          data={data}
          docWidth={docWidth}
          onDocWidthChange={onDocWidthChange}
        />
      )
    case 'powerpoint':
      return <PptxViewer chrome={chrome} bridge={bridge} data={data} />
    case 'image':
      return <ImageViewer chrome={chrome} data={data} path={entry.path} />
    default:
      return (
        <UnsupportedState name={entry.name} kindLabel={`${entry.ext.slice(1).toUpperCase()} 文件`} />
      )
  }
}
