import { FilePlus2, FolderOpen } from 'lucide-react'
import type { BookmarkItem } from '@renderer/lib/library'
import { relativeTime } from '@renderer/lib/library'
import { EntryIcon } from './EntryIcon'
import { ReaderMark } from './ReaderMark'

interface Props {
  onOpenFile: () => void
  onOpenFolder: () => void
  onOpenPath: (path: string) => void
  recent: BookmarkItem[]
}

const FORMATS = ['TXT', 'Markdown', 'HTML', 'PDF', 'Word (.docx)', 'PowerPoint (.pptx)', '图片']

export function Welcome({ onOpenFile, onOpenFolder, onOpenPath, recent }: Props): JSX.Element {
  return (
    <div className="welcome">
      <div className="welcome__inner">
        <div className="welcome__logo">
          <ReaderMark size={34} />
        </div>

        <h1 className="welcome__title">通用文件阅读器</h1>
        <p className="welcome__subtitle">
          打开单个文件，或直接打开整个文件夹，在左侧列表中浏览、在右侧阅读。
          <br />
          Windows / macOS / Ubuntu 下的能力完全一致。
        </p>

        <div className="welcome__actions">
          <button type="button" className="button button--primary" onClick={onOpenFile}>
            <FilePlus2 size={16} />
            打开文件
          </button>
          <button type="button" className="button" onClick={onOpenFolder}>
            <FolderOpen size={16} />
            打开文件夹
          </button>
        </div>

        <div className="welcome__formats">
          {FORMATS.map((format) => (
            <span key={format} className="welcome__chip">
              {format}
            </span>
          ))}
        </div>

        {recent.length > 0 ? (
          <div style={{ marginTop: 34, textAlign: 'left' }}>
            <div className="welcome__recent-label">最近打开</div>
            <div className="panel-list" style={{ padding: 0 }}>
              {recent.slice(0, 5).map((item) => (
                <div
                  key={item.path}
                  className="panel-item"
                  title={item.path}
                  onClick={() => onOpenPath(item.path)}
                >
                  <span className="panel-item__icon">
                    <EntryIcon kind={item.kind} size={14} />
                  </span>
                  <span className="panel-item__text">
                    <span className="panel-item__name">{item.name}</span>
                    <span className="panel-item__path">
                      <span>{item.path}</span>
                    </span>
                  </span>
                  <span className="panel-item__time">{relativeTime(item.openedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="welcome__hint">
            也可以直接把文件或文件夹拖到窗口中，或在「打开方式」里选择本应用。
          </p>
        )}
      </div>
    </div>
  )
}
