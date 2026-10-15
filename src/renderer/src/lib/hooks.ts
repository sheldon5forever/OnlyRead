import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

/**
 * 旧存储键 → 新存储键。
 *
 * 应用从 MetaReader 改名为 OnlyRead 时，localStorage 的键前缀也随之从
 * `meta-reader.` 换成 `onlyread.`。若不迁移，老用户的主题、阅读历史、收藏
 * 会在升级后**静默清空**（键变了就等于读不到）。
 *
 * 迁移在每个键首次被读取时惰性执行：旧值搬到新键，随后删除旧键。
 */
const LEGACY_STORAGE_KEYS: Record<string, string> = {
  'meta-reader.tab': 'onlyread.tab',
  'meta-reader.showHidden': 'onlyread.showHidden',
  'meta-reader.showAllFiles': 'onlyread.showAllFiles',
  'meta-reader.textPrefs': 'onlyread.textPrefs',
  'meta-reader.history': 'onlyread.history',
  'meta-reader.favorites': 'onlyread.favorites',
  'meta-reader.docWidth': 'onlyread.docWidth',
  'meta-reader.theme': 'onlyread.theme'
}

function migrateLegacyKey(key: string): void {
  const legacy = Object.keys(LEGACY_STORAGE_KEYS).find((old) => LEGACY_STORAGE_KEYS[old] === key)
  if (!legacy) return
  try {
    const storage = window.localStorage
    // 新键已有值就说明迁移过了（或用户已在新版本里改过），不覆盖
    if (storage.getItem(key) !== null) return
    const old = storage.getItem(legacy)
    if (old === null) return
    storage.setItem(key, old)
    storage.removeItem(legacy)
  } catch {
    // 隐私模式等场景下静默失败，不影响功能
  }
}

/** 与 localStorage 同步的状态 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      migrateLegacyKey(key)
      const raw = window.localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initialValue
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // 忽略隐私模式等写入失败
    }
  }, [key, value])

  return [value, setValue]
}

/** 可拖拽调整宽度的面板尺寸 */
export function useResizableWidth(
  initial: number,
  min: number,
  max: number
): [number, (next: number) => void, boolean, (event: React.PointerEvent) => void] {
  const [width, setWidth] = useState(initial)
  const [dragging, setDragging] = useState(false)
  const frame = useRef<number | null>(null)

  const clamp = useCallback((next: number) => Math.min(max, Math.max(min, next)), [min, max])

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = width
      setDragging(true)

      const onMove = (moveEvent: PointerEvent): void => {
        const next = clamp(startWidth + (moveEvent.clientX - startX))
        if (frame.current !== null) cancelAnimationFrame(frame.current)
        frame.current = requestAnimationFrame(() => setWidth(next))
      }

      const onUp = (): void => {
        setDragging(false)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.style.cursor = ''
      }

      document.body.style.cursor = 'col-resize'
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [clamp, width]
  )

  return [width, setWidth, dragging, startDrag]
}
