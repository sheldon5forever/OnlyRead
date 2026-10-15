import { useMemo } from 'react'
import { CornerUpLeft, FilePlus2, FolderOpen, RefreshCw, Star, Trash2, X } from 'lucide-react'
import type { FileEntry, OpenedTarget } from '@shared/types'
import type { Heading } from '@renderer/lib/outline'
import type { BookmarkItem } from '@renderer/lib/library'
import { relativeTime } from '@renderer/lib/library'
import { dirName, parentLabel } from '@renderer/lib/format'
import { EntryIcon } from './EntryIcon'
import { FileTree } from './FileTree'

export type SidebarTab = 'outline' | 'history' | 'favorites' | 'files'

interface Props {
  tab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  target: OpenedTarget | null
  currentEntry: FileEntry | null
  outline: Heading[]
  activeHeadingId: string | null
  onOutlineSelect: (id: string) => void
  history: BookmarkItem[]
  favorites: BookmarkItem[]
  favoritePaths: Set<string>
  onOpenBookmark: (path: string) => void
  onRemoveBookmark: (path: string, from: 'history' | 'favorites') => void
  onClearHistory: () => void
  onSelectFile: (entry: FileEntry) => void
  onToggleFavorite: (entry: FileEntry) => void
  onReveal: (path: string) => void
  onNavigateRoot: (dir: string) => void
  onOpenFileDialog: () => void
  onOpenFolderDialog: () => void
  showHidden: boolean
  showAllFiles: boolean
  refreshToken: number
  onRefresh: () => void
}

const TABS: { key: SidebarTab; label: string }[] = [
  { key: 'outline', label: '目录' },
  { key: 'history', label: '历史' },
  { key: 'favorites', label: '收藏' },
  { key: 'files', label: '文件' }
]

export function Sidebar({
  tab,
  onTabChange,
  target,
  currentEntry,
  outline,
  activeHeadingId,
  onOutlineSelect,
  history,
  favorites,
  favoritePaths,
  onOpenBookmark,
  onRemoveBookmark,
  onClearHistory,
  onSelectFile,
  onToggleFavorite,
  onReveal,
  onNavigateRoot,
  onOpenFileDialog,
  onOpenFolderDialog,
  showHidden,
  showAllFiles,
  refreshToken,
  onRefresh
}: Props): JSX.Element {
  const rootDir = useMemo(() => {
    if (!target) return null
    return target.type === 'folder' ? target.path : dirName(target.path)
  }, [target])

  const headerLabel = useMemo(() => {
    if (!target) return '未打开任何位置'
    return target.type === 'folder' ? target.name : `${parentLabel(target.path)} / ${target.name}`
  }, [target])

  const counts: Record<SidebarTab, number> = {
    outline: outline.length,
    history: history.length,
    favorites: favorites.length,
    files: 0
  }

  // 目录模式下（且不在盘符根目录）才提供返回上级
  const canGoUp = Boolean(rootDir) && dirName(rootDir as string) !== rootDir

  return (
    <div className="sidebar">
      <nav className="sidebar__tabs">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`sidebar__tab${tab === item.key ? ' is-active' : ''}`}
            onClick={() => onTabChange(item.key)}
          >
            {item.label}
            {counts[item.key] > 0 && item.key !== 'files' ? (
              <span className="sidebar__tab-badge">{counts[item.key]}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="sidebar__header">
        <span className="sidebar__title" title={target?.path ?? ''}>
          {headerLabel}
        </span>

        <button type="button" className="sidebar__tool" title="打开文件" onClick={onOpenFileDialog}>
          <FilePlus2 size={14} />
        </button>
        <button type="button" className="sidebar__tool" title="打开文件夹" onClick={onOpenFolderDialog}>
          <FolderOpen size={14} />
        </button>
        <button
          type="button"
          className="sidebar__tool"
          title="刷新列表"
          onClick={onRefresh}
          disabled={!target}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="sidebar__body">
        {tab === 'files' ? (
          target && rootDir ? (
            <>
              {canGoUp ? (
                <div
                  className="tree-row"
                  style={{ paddingLeft: 6, color: 'var(--fg-muted)' }}
                  title={dirName(rootDir)}
                  onClick={() => onNavigateRoot(dirName(rootDir))}
                >
                  <span className="tree-row__chevron" />
                  <span className="tree-row__icon">
                    <CornerUpLeft size={14} />
                  </span>
                  <span className="tree-row__name">..</span>
                </div>
              ) : null}

              {target.type === 'file' ? (
                <div className="tree">
                  <FileRow
                    entry={currentEntry}
                    selected
                    favorited={favoritePaths.has(target.path)}
                    onSelect={onSelectFile}
                    onToggleFavorite={onToggleFavorite}
                    onReveal={onReveal}
                  />
                </div>
              ) : (
                <FileTree
                  dir={rootDir}
                  currentPath={currentEntry?.path ?? null}
                  showHidden={showHidden}
                  showAllFiles={showAllFiles}
                  refreshToken={refreshToken}
                  favorites={favoritePaths}
                  onSelect={onSelectFile}
                  onToggleFavorite={onToggleFavorite}
                  onReveal={onReveal}
                />
              )}
            </>
          ) : (
            <div className="tree__empty">
              还没有打开文件或文件夹
              <br />
              点击上方图标，或把文件拖到窗口中
            </div>
          )
        ) : null}

        {tab === 'outline' ? (
          outline.length > 0 ? (
            <div className="outline">
              {outline.map((heading) => (
                <button
                  key={heading.id}
                  type="button"
                  className={`outline__item outline__item--${heading.level}${
                    activeHeadingId === heading.id ? ' is-active' : ''
                  }`}
                  title={heading.text}
                  onClick={() => onOutlineSelect(heading.id)}
                >
                  {heading.text}
                </button>
              ))}
            </div>
          ) : (
            <div className="tree__empty">
              当前文档没有可提取的目录
            </div>
          )
        ) : null}

        {tab === 'history' ? (
          <BookmarkList
            items={history}
            emptyText="还没有阅读记录"
            onOpen={onOpenBookmark}
            onRemove={(path) => onRemoveBookmark(path, 'history')}
            extra={
              history.length > 0 ? (
                <button
                  type="button"
                  className="sidebar__tool"
                  title="清空历史"
                  onClick={onClearHistory}
                >
                  <Trash2 size={14} />
                </button>
              ) : null
            }
          />
        ) : null}

        {tab === 'favorites' ? (
          <BookmarkList
            items={favorites}
            emptyText="还没有收藏任何文件"
            onOpen={onOpenBookmark}
            onRemove={(path) => onRemoveBookmark(path, 'favorites')}
          />
        ) : null}
      </div>
    </div>
  )
}

interface FileRowProps {
  entry: FileEntry | null
  selected?: boolean
  favorited: boolean
  onSelect: (entry: FileEntry) => void
  onToggleFavorite: (entry: FileEntry) => void
  onReveal: (path: string) => void
}

function FileRow({
  entry,
  selected = false,
  favorited,
  onSelect,
  onToggleFavorite,
  onReveal
}: FileRowProps): JSX.Element {
  if (!entry) {
    return <div className="tree__empty">正在载入…</div>
  }

  return (
    <div
      className={`tree-row${selected ? ' is-selected' : ''}${
        entry.kind === 'unsupported' ? ' is-unsupported' : ''
      }`.trim()}
      style={{ paddingLeft: 6 }}
      title={entry.path}
      onClick={() => onSelect(entry)}
    >
      <span className="tree-row__chevron" />
      <span className="tree-row__icon">
        <EntryIcon kind={entry.kind} />
      </span>
      <span className="tree-row__name">{entry.name}</span>
      {selected ? <span className="tree-row__badge">当前</span> : null}
      <button
        type="button"
        className={`tree-row__action${favorited ? ' is-on' : ''}`}
        title={favorited ? '取消收藏' : '加入收藏'}
        onClick={(event) => {
          event.stopPropagation()
          onToggleFavorite(entry)
        }}
      >
        <Star size={12} fill={favorited ? 'currentColor' : 'none'} />
      </button>
      <button
        type="button"
        className="tree-row__action"
        title="在文件管理器中显示"
        onClick={(event) => {
          event.stopPropagation()
          onReveal(entry.path)
        }}
      >
        <FolderOpen size={12} />
      </button>
    </div>
  )
}

interface BookmarkListProps {
  items: BookmarkItem[]
  emptyText: string
  onOpen: (path: string) => void
  onRemove: (path: string) => void
  extra?: JSX.Element | null
}

function BookmarkList({ items, emptyText, onOpen, onRemove, extra }: BookmarkListProps): JSX.Element {
  if (items.length === 0) {
    return (
      <div className="tree__empty">
        {emptyText}
      </div>
    )
  }

  return (
    <div>
      {extra ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 8px' }}>{extra}</div>
      ) : null}
      <div className="panel-list">
        {items.map((item) => (
          <div
            key={item.path}
            className="panel-item"
            title={item.path}
            onClick={() => onOpen(item.path)}
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
            <button
              type="button"
              className="panel-item__remove"
              title="从列表移除"
              onClick={(event) => {
                event.stopPropagation()
                onRemove(item.path)
              }}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

