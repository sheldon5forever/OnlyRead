import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { FileEntry, OpenedTarget } from '@shared/types'
import { TitleBar } from './components/TitleBar'
import { Sidebar, type SidebarTab } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { Welcome } from './components/Welcome'
import { Viewer, type DocInfo, type TextPrefs } from './viewers/Viewer'
import type { OutlineBridge } from './viewers/ViewerFrame'
import type { Heading } from './lib/outline'
import {
  isFavorited,
  promoteItem,
  toggleFavorite as toggleFavoriteItem,
  type BookmarkItem
} from './lib/library'
import { baseName, dirName } from './lib/format'
import {
  DEFAULT_DOC_WIDTH,
  DOC_WIDTH_STORAGE_KEY,
  normalizeDocWidth,
  type DocWidth
} from './lib/docWidth'
import { useLocalStorage, useResizableWidth } from './lib/hooks'
import { useTheme } from './lib/theme'

const EMPTY_OUTLINE: Heading[] = []

export default function App(): JSX.Element {
  const { mode: themeMode, resolved: resolvedTheme, setMode: setThemeMode } = useTheme()

  const [tab, setTab] = useLocalStorage<SidebarTab>('onlyread.tab', 'files')
  const [showHidden, setShowHidden] = useLocalStorage('onlyread.showHidden', false)
  const [showAllFiles, setShowAllFiles] = useLocalStorage('onlyread.showAllFiles', false)
  const [textPrefs, setTextPrefs] = useLocalStorage<TextPrefs>('onlyread.textPrefs', {
    showLineNumbers: false,
    wrap: true
  })
  const [history, setHistory] = useLocalStorage<BookmarkItem[]>('onlyread.history', [])
  const [favorites, setFavorites] = useLocalStorage<BookmarkItem[]>('onlyread.favorites', [])
  const [docWidth, setDocWidth] = useLocalStorage<DocWidth>(
    DOC_WIDTH_STORAGE_KEY,
    DEFAULT_DOC_WIDTH
  )

  const [target, setTarget] = useState<OpenedTarget | null>(null)
  const [currentEntry, setCurrentEntry] = useState<FileEntry | null>(null)
  const [outline, setOutline] = useState<Heading[]>(EMPTY_OUTLINE)
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null)
  const [docInfo, setDocInfo] = useState<DocInfo>({})
  const [refreshToken, setRefreshToken] = useState(0)
  const [dragActive, setDragActive] = useState(false)

  const [sidebarWidth, , resizing, startResize] = useResizableWidth(248, 180, 520)

  /* ----------------------------- 大纲 / 滚动桥接 ----------------------------- */

  const scrollToRef = useRef<((id: string) => void) | null>(null)

  const onOutline = useCallback((headings: Heading[]) => {
    setOutline(headings)
  }, [])

  const onActiveHeading = useCallback((id: string | null) => {
    setActiveHeadingId(id)
  }, [])

  const registerScrollTo = useCallback((handler: ((id: string) => void) | null) => {
    scrollToRef.current = handler
  }, [])

  const onDocInfo = useCallback((info: DocInfo) => {
    setDocInfo(info)
  }, [])

  const bridge = useMemo<OutlineBridge>(
    () => ({ onOutline, onActiveHeading, registerScrollTo }),
    [onOutline, onActiveHeading, registerScrollTo]
  )

  /* -------------------------------- 打开逻辑 -------------------------------- */

  const rememberEntry = useCallback(
    (entry: FileEntry) => {
      setHistory((previous) =>
        promoteItem(previous, {
          path: entry.path,
          name: entry.name,
          kind: entry.kind,
          openedAt: Date.now()
        })
      )
    },
    [setHistory]
  )

  /** 重置预览区派生状态（切换文档时必须清空，避免残留上一个文件的大纲） */
  const resetPreviewState = useCallback(() => {
    setOutline(EMPTY_OUTLINE)
    setActiveHeadingId(null)
    setDocInfo({})
    scrollToRef.current = null
  }, [])

  const selectEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.isDirectory) return
      resetPreviewState()
      setCurrentEntry(entry)
      rememberEntry(entry)
    },
    [rememberEntry, resetPreviewState]
  )

  const openTarget = useCallback(
    async (next: OpenedTarget) => {
      setTarget(next)
      resetPreviewState()

      if (next.type === 'file') {
        try {
          const entry = await window.reader.readEntry(next.path)
          setCurrentEntry(entry)
          rememberEntry(entry)
        } catch {
          setCurrentEntry(null)
        }
      } else {
        setCurrentEntry(null)
      }
    },
    [rememberEntry, resetPreviewState]
  )

  const openPathString = useCallback(
    async (path: string) => {
      try {
        const resolved = await window.reader.openPath(path)
        await openTarget(resolved)
      } catch (error) {
        // 文件可能已被移动或删除，保持当前界面并提示
        window.alert(error instanceof Error ? error.message : String(error))
      }
    },
    [openTarget]
  )

  const handleOpenFileDialog = useCallback(async () => {
    const result = await window.reader.openFileDialog()
    if (result) await openTarget(result)
  }, [openTarget])

  const handleOpenFolderDialog = useCallback(async () => {
    const result = await window.reader.openFolderDialog()
    if (result) await openTarget(result)
  }, [openTarget])

  const navigateRoot = useCallback(
    (dir: string) => {
      void openTarget({ type: 'folder', path: dir, name: baseName(dir) || dir })
    },
    [openTarget]
  )

  /* --------------------------------- 启动 --------------------------------- */

  useEffect(() => {
    let disposed = false

    void window.reader.consumePendingTargets().then((paths) => {
      if (disposed || paths.length === 0) return
      void openPathString(paths[0])
    })

    const unsubscribe = window.reader.onOpenTargets((paths) => {
      if (paths.length > 0) void openPathString(paths[0])
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [openPathString])

  /* ------------------------------- 快捷键 --------------------------------- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const meta = event.ctrlKey || event.metaKey
      if (meta && !event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void handleOpenFileDialog()
        return
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void handleOpenFolderDialog()
        return
      }
      if (event.key === 'F11') {
        event.preventDefault()
        void window.reader.windowControls.toggleFullscreen()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleOpenFileDialog, handleOpenFolderDialog])

  /* ------------------------------- 拖拽打开 -------------------------------- */

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDragActive(false)

      const files = Array.from(event.dataTransfer.files)
      if (files.length === 0) return

      const paths = files
        .map((file) => {
          const viaBridge = window.reader.getPathForFile(file)
          if (viaBridge) return viaBridge
          const legacy = (file as File & { path?: string }).path
          return legacy ?? ''
        })
        .filter(Boolean)

      if (paths.length === 0) return

      if (paths.length === 1) {
        void openPathString(paths[0])
        return
      }

      // 多选时打开所在文件夹，并定位到第一个文件
      const first = paths[0]
      void (async () => {
        try {
          const entry = await window.reader.readEntry(first)
          await openTarget({ type: 'folder', path: dirName(first), name: baseName(dirName(first)) })
          selectEntry(entry)
        } catch {
          void openPathString(first)
        }
      })()
    },
    [openPathString, openTarget, selectEntry]
  )

  /* ------------------------------- 收藏 / 历史 ----------------------------- */

  const favoritePaths = useMemo(
    () => new Set(favorites.map((item) => item.path)),
    [favorites]
  )

  const handleToggleFavorite = useCallback(
    (entry: FileEntry) => {
      setFavorites((previous) =>
        toggleFavoriteItem(previous, {
          path: entry.path,
          name: entry.name,
          kind: entry.kind,
          openedAt: Date.now()
        })
      )
    },
    [setFavorites]
  )

  const removeBookmark = useCallback(
    (path: string, from: 'history' | 'favorites') => {
      const setter = from === 'history' ? setHistory : setFavorites
      setter((previous) => previous.filter((item) => item.path !== path))
    },
    [setFavorites, setHistory]
  )

  const toggleTextPref = useCallback(
    (key: keyof TextPrefs) => {
      setTextPrefs((previous) => ({ ...previous, [key]: !previous[key] }))
    },
    [setTextPrefs]
  )

  /* --------------------------------- 渲染 --------------------------------- */

  const location = target?.path ?? '未打开文件'
  const fileName = currentEntry?.name ?? null

  // localStorage 里可能是旧版本写入的非法值，这里兜底
  const safeDocWidth = normalizeDocWidth(docWidth)

  const mainContent = (() => {
    if (!target) {
      return (
        <Welcome
          onOpenFile={() => void handleOpenFileDialog()}
          onOpenFolder={() => void handleOpenFolderDialog()}
          onOpenPath={(path) => void openPathString(path)}
          recent={history}
        />
      )
    }

    if (!currentEntry) {
      return (
        <div className="state">
          <div className="state__inner">
            <div className="state__icon">
              <FolderOpen size={22} />
            </div>
            <h3 className="state__title">已打开文件夹</h3>
            <p className="state__desc">在左侧「文件」列表中点击任意文件即可开始阅读。</p>
          </div>
        </div>
      )
    }

    return (
      <Viewer
        key={currentEntry.path}
        entry={currentEntry}
        reloadToken={refreshToken}
        theme={resolvedTheme}
        bridge={bridge}
        favorited={isFavorited(favorites, currentEntry.path)}
        onToggleFavorite={() => handleToggleFavorite(currentEntry)}
        onReveal={() => void window.reader.showItemInFolder(currentEntry.path)}
        onOpenLocal={(path) => void openPathString(path)}
        onDocInfo={onDocInfo}
        textPrefs={textPrefs}
        onToggleLineNumbers={() => toggleTextPref('showLineNumbers')}
        onToggleWrap={() => toggleTextPref('wrap')}
        docWidth={safeDocWidth}
        onDocWidthChange={setDocWidth}
      />
    )
  })()

  return (
    <div
      className="app"
      onDragOver={(event) => {
        event.preventDefault()
        setDragActive(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragActive(false)
      }}
      onDrop={onDrop}
    >
      <TitleBar
        location={location}
        fileName={fileName}
        themeMode={themeMode}
        resolvedTheme={resolvedTheme}
        onThemeChange={setThemeMode}
        showHidden={showHidden}
        onShowHiddenChange={setShowHidden}
        showAllFiles={showAllFiles}
        onShowAllFilesChange={setShowAllFiles}
      />

      <div className="workspace">
        <div className="workspace__sidebar" style={{ width: sidebarWidth }}>
          <Sidebar
            tab={tab}
            onTabChange={setTab}
            target={target}
            currentEntry={currentEntry}
            outline={outline}
            activeHeadingId={activeHeadingId}
            onOutlineSelect={(id) => scrollToRef.current?.(id)}
            history={history}
            favorites={favorites}
            favoritePaths={favoritePaths}
            onOpenBookmark={(path) => void openPathString(path)}
            onRemoveBookmark={removeBookmark}
            onClearHistory={() => setHistory([])}
            onSelectFile={selectEntry}
            onToggleFavorite={handleToggleFavorite}
            onReveal={(path) => void window.reader.showItemInFolder(path)}
            onNavigateRoot={navigateRoot}
            onOpenFileDialog={() => void handleOpenFileDialog()}
            onOpenFolderDialog={() => void handleOpenFolderDialog()}
            showHidden={showHidden}
            showAllFiles={showAllFiles}
            refreshToken={refreshToken}
            onRefresh={() => setRefreshToken((value) => value + 1)}
          />
        </div>

        <div
          className={`workspace__resizer${resizing ? ' is-dragging' : ''}`}
          onPointerDown={startResize}
        />

        <div className="workspace__main">{mainContent}</div>
      </div>

      <StatusBar entry={currentEntry} docInfo={docInfo} outlineCount={outline.length} />

      {dragActive ? (
        <div className="dropzone">
          <div className="dropzone__card">松开鼠标即可打开该文件或文件夹</div>
        </div>
      ) : null}
    </div>
  )
}
