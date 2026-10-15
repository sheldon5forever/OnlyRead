import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Maximize2,
  Minimize2,
  Moon,
  Pin,
  SlidersHorizontal,
  Sun,
  X
} from 'lucide-react'
import type { ResolvedTheme, ThemeMode } from '@renderer/lib/theme'
import { ReaderMark } from './ReaderMark'

interface TitleBarProps {
  /** 标题栏中展示的路径 */
  location: string
  fileName: string | null
  themeMode: ThemeMode
  resolvedTheme: ResolvedTheme
  onThemeChange: (mode: ThemeMode) => void
  showHidden: boolean
  onShowHiddenChange: (value: boolean) => void
  showAllFiles: boolean
  onShowAllFilesChange: (value: boolean) => void
}

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' }
]

export function TitleBar({
  location,
  fileName,
  themeMode,
  resolvedTheme,
  onThemeChange,
  showHidden,
  onShowHiddenChange,
  showAllFiles,
  onShowAllFilesChange
}: TitleBarProps): JSX.Element {
  const [fullscreen, setFullscreen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const { windowControls } = window.reader
    void windowControls.getState().then((state) => {
      if (!state) return
      setFullscreen(state.fullscreen)
      setMaximized(state.maximized)
    })
    return windowControls.onStateChange((state) => {
      setFullscreen(state.fullscreen)
      setMaximized(state.maximized)
    })
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const togglePin = (): void => {
    const next = !pinned
    setPinned(next)
    void window.reader.windowControls.setAlwaysOnTop(next)
  }

  const toggleFullscreen = (): void => {
    void window.reader.windowControls.toggleFullscreen().then((state) => {
      if (state) {
        setFullscreen(state.fullscreen)
        setMaximized(state.maximized)
      }
    })
  }

  return (
    <header className="titlebar">
      <div className="titlebar__brand">
        <ReaderMark size={18} />
        <span className="titlebar__brand-name">OnlyRead</span>
      </div>

      <div className="titlebar__path" title={location}>
        <span>
          {location}
          {fileName ? (
            <>
              <em>&nbsp;—&nbsp;{fileName}</em>
            </>
          ) : null}
        </span>
      </div>

      <div className="titlebar__actions" ref={menuRef}>
        <button
          type="button"
          className="titlebar__button"
          title={resolvedTheme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          onClick={() => onThemeChange(resolvedTheme === 'dark' ? 'light' : 'dark')}
        >
          {resolvedTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        <button
          type="button"
          className="titlebar__button"
          title={fullscreen ? '退出全屏 (F11)' : '进入全屏 (F11)'}
          onClick={toggleFullscreen}
        >
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>

        <button
          type="button"
          className={`titlebar__button${pinned ? ' is-active' : ''}`}
          title={pinned ? '取消窗口置顶' : '窗口置顶'}
          onClick={togglePin}
        >
          <Pin size={15} />
        </button>

        <button
          type="button"
          className="titlebar__button"
          title="阅读设置"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <SlidersHorizontal size={15} />
        </button>

        {menuOpen ? (
          <div className="settings-menu">
            <div className="settings-menu__group-label">外观</div>
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="settings-menu__item"
                onClick={() => onThemeChange(option.value)}
              >
                <span>{option.label}</span>
                {themeMode === option.value ? <Check size={14} /> : null}
              </button>
            ))}

            <div className="settings-menu__divider" />
            <div className="settings-menu__group-label">文件列表</div>
            <button
              type="button"
              className="settings-menu__item"
              onClick={() => onShowHiddenChange(!showHidden)}
            >
              <span>显示隐藏文件</span>
              {showHidden ? <Check size={14} /> : null}
            </button>
            <button
              type="button"
              className="settings-menu__item"
              onClick={() => onShowAllFilesChange(!showAllFiles)}
            >
              <span>显示不支持的文件</span>
              {showAllFiles ? <Check size={14} /> : null}
            </button>
          </div>
        ) : null}
      </div>

      <div className="wincontrols">
        <button
          type="button"
          className="wincontrols__button"
          title="最小化"
          onClick={() => void window.reader.windowControls.minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          className="wincontrols__button"
          title={maximized ? '向下还原' : '最大化'}
          onClick={() => {
            void window.reader.windowControls.toggleMaximize().then((state) => {
              if (state) setMaximized(state.maximized)
            })
          }}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path
                d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="wincontrols__button wincontrols__button--close"
          title="关闭"
          onClick={() => void window.reader.windowControls.close()}
        >
          <X size={13} />
        </button>
      </div>
    </header>
  )
}
