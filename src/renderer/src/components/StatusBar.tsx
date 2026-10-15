import type { FileEntry } from '@shared/types'
import { KIND_LABEL } from '@shared/kind'
import { formatSize } from '@renderer/lib/format'
import type { DocInfo } from '@renderer/viewers/Viewer'

interface Props {
  entry: FileEntry | null
  docInfo: DocInfo
  outlineCount: number
}

export function StatusBar({ entry, docInfo, outlineCount }: Props): JSX.Element {
  if (!entry) {
    return (
      <footer className="statusbar">
        <span className="statusbar__item">就绪</span>
        <span className="statusbar__spacer" />
        <span className="statusbar__item">OnlyRead 0.1.0</span>
      </footer>
    )
  }

  return (
    <footer className="statusbar">
      <span className="statusbar__item" title={entry.path}>
        {entry.path}
      </span>
      <span className="statusbar__spacer" />
      <span className="statusbar__item">{KIND_LABEL[entry.kind]}</span>
      <span className="statusbar__item">{formatSize(entry.size)}</span>
      {docInfo.encoding ? <span className="statusbar__item">{docInfo.encoding}</span> : null}
      {docInfo.pages ? <span className="statusbar__item">{docInfo.pages} 页</span> : null}
      {docInfo.slides ? <span className="statusbar__item">{docInfo.slides} 张</span> : null}
      {outlineCount > 0 ? <span className="statusbar__item">目录 {outlineCount} 项</span> : null}
    </footer>
  )
}
