import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, ExternalLink, Star } from 'lucide-react'
import type { FileEntry } from '@shared/types'
import { EntryIcon } from './EntryIcon'

interface Props {
  /** 根目录绝对路径 */
  dir: string
  /** 当前预览的文件路径 */
  currentPath: string | null
  /** 是否显示隐藏文件 */
  showHidden: boolean
  /** 是否显示阅读器不支持的文件 */
  showAllFiles: boolean
  /** 变化时强制重新加载 */
  refreshToken: number
  /** 收藏集合 */
  favorites: Set<string>
  onSelect: (entry: FileEntry) => void
  onToggleFavorite: (entry: FileEntry) => void
  onReveal: (path: string) => void
}

export function FileTree({
  dir,
  currentPath,
  showHidden,
  showAllFiles,
  refreshToken,
  favorites,
  onSelect,
  onToggleFavorite,
  onReveal
}: Props): JSX.Element {
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const loadDir = useCallback(
    async (target: string): Promise<void> => {
      setLoading((prev) => new Set(prev).add(target))
      try {
        const listing = await window.reader.readDirectory(target, true)
        setChildren((prev) => ({ ...prev, [target]: listing.entries }))
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading((prev) => {
          const next = new Set(prev)
          next.delete(target)
          return next
        })
      }
    },
    []
  )

  // 根目录变化 / 刷新 / 过滤条件变化时重新加载
  useEffect(() => {
    setChildren({})
    setExpanded(new Set())
    setError(null)
    void loadDir(dir)
  }, [dir, refreshToken, loadDir])

  const toggleDir = (entry: FileEntry): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(entry.path)) {
        next.delete(entry.path)
      } else {
        next.add(entry.path)
        if (!children[entry.path]) void loadDir(entry.path)
      }
      return next
    })
  }

  const visibleEntries = (list: FileEntry[]): FileEntry[] =>
    list.filter((entry) => {
      if (entry.isDirectory) return showHidden || !entry.name.startsWith('.')
      if (!showHidden && entry.name.startsWith('.')) return false
      return showAllFiles || entry.kind !== 'unsupported'
    })

  const renderRows = (target: string, depth: number): JSX.Element[] => {
    const list = visibleEntries(children[target] ?? [])
    const rows: JSX.Element[] = []

    if (loading.has(target)) {
      rows.push(
        <div key={`${target}:loading`} className="tree-row__loading">
          正在读取…
        </div>
      )
    }

    for (const entry of list) {
      const isOpen = expanded.has(entry.path)
      const isSelected = !entry.isDirectory && entry.path === currentPath
      const favorited = favorites.has(entry.path)

      rows.push(
        <div
          key={entry.path}
          className={[
            'tree-row',
            isSelected ? 'is-selected' : '',
            !entry.isDirectory && entry.kind === 'unsupported' ? 'is-unsupported' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ paddingLeft: 6 + depth * 14 }}
          title={entry.path}
          onClick={() => (entry.isDirectory ? toggleDir(entry) : onSelect(entry))}
        >
          <span className={`tree-row__chevron${isOpen ? ' is-open' : ''}`}>
            {entry.isDirectory ? <ChevronRight size={12} /> : null}
          </span>

          <span className="tree-row__icon">
            <EntryIcon kind={entry.isDirectory ? 'unsupported' : entry.kind} open={isOpen} />
          </span>

          <span className="tree-row__name">{entry.name}</span>

          {isSelected ? <span className="tree-row__badge">当前</span> : null}

          {!entry.isDirectory ? (
            <>
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
                <ExternalLink size={12} />
              </button>
            </>
          ) : null}
        </div>
      )

      if (entry.isDirectory && isOpen) {
        rows.push(...renderRows(entry.path, depth + 1))
      }
    }

    if (!loading.has(target) && list.length === 0) {
      rows.push(
        <div key={`${target}:empty`} className="tree__empty" style={{ paddingLeft: 16 + depth * 14 }}>
          {depth === 0 ? '该文件夹中没有可预览的文件' : '空文件夹'}
        </div>
      )
    }

    return rows
  }

  if (error) {
    return (
      <div className="tree__empty">
        无法读取目录
        <br />
        {error}
      </div>
    )
  }

  return <div className="tree">{renderRows(dir, 0)}</div>
}
