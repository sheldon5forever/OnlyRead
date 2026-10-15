import { useCallback, useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'onlyread.theme'

/**
 * 旧版本（应用名为 MetaReader 时）使用的键。
 * 主题读取不经过 useLocalStorage，所以这里单独迁移一次，
 * 否则老用户升级后主题会被重置为"跟随系统"。
 */
const LEGACY_STORAGE_KEY = 'meta-reader.theme'

function readStoredMode(): ThemeMode {
  try {
    const storage = window.localStorage
    if (storage.getItem(STORAGE_KEY) === null) {
      const legacy = storage.getItem(LEGACY_STORAGE_KEY)
      if (legacy !== null) {
        storage.setItem(STORAGE_KEY, legacy)
        storage.removeItem(LEGACY_STORAGE_KEY)
      }
    }
  } catch {
    // 忽略读取失败，走默认值
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 主题管理：light / dark / 跟随系统 */
export function useTheme(): {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (mode: ThemeMode) => void
  toggle: () => void
} {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode)
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (event: MediaQueryListEvent): void => {
      setSystem(event.matches ? 'dark' : 'light')
    }
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])

  const resolved: ResolvedTheme = mode === 'system' ? system : mode

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 忽略写入失败
    }
  }, [])

  const toggle = useCallback(() => {
    setMode(resolved === 'dark' ? 'light' : 'dark')
  }, [resolved, setMode])

  return { mode, resolved, setMode, toggle }
}
