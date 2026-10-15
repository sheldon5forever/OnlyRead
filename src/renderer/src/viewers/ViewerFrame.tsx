import type { ReactNode } from 'react'
import { FolderOpen, Star } from 'lucide-react'
import { DocWidthMenu } from './DocWidthMenu'
import type { DocWidth } from '@renderer/lib/docWidth'

/** 预览区顶部工具条所需的公共信息 */
export interface ViewerChrome {
  title: string
  info: string
  favorited: boolean
  onToggleFavorite: () => void
  onReveal: () => void
}

/** 大纲 / 滚动桥接 */
export interface OutlineBridge {
  onOutline: (headings: import('@renderer/lib/outline').Heading[]) => void
  onActiveHeading: (id: string | null) => void
  registerScrollTo: (handler: ((id: string) => void) | null) => void
}

interface Props {
  chrome: ViewerChrome
  /** 工具条右侧的额外控件 */
  extra?: ReactNode
  /** 传入后显示「排版宽度」切换按钮（仅文档型内容需要） */
  docWidth?: { value: DocWidth; onChange: (width: DocWidth) => void }
  children: ReactNode
}

/** 预览区外框：统一的顶栏 + 内容区 */
export function ViewerFrame({ chrome, extra, docWidth, children }: Props): JSX.Element {
  return (
    <div className="viewer">
      <div className="viewer__toolbar">
        <div className="viewer__file">
          <span className="viewer__filename" title={chrome.title}>
            {chrome.title}
          </span>
          <span className="viewer__meta">{chrome.info}</span>
        </div>

        <span className="viewer__spacer" />

        {extra}

        {docWidth ? <DocWidthMenu value={docWidth.value} onChange={docWidth.onChange} /> : null}

        <button
          type="button"
          className="viewer__control"
          title={chrome.favorited ? '取消收藏' : '加入收藏'}
          onClick={chrome.onToggleFavorite}
        >
          <Star size={13} fill={chrome.favorited ? 'currentColor' : 'none'} />
        </button>
        <button type="button" className="viewer__control" title="在文件管理器中显示" onClick={chrome.onReveal}>
          <FolderOpen size={13} />
        </button>
      </div>

      <div className="viewer__body">{children}</div>
    </div>
  )
}
