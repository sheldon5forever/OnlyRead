import type { FileKind } from '@shared/types'

export interface BookmarkItem {
  path: string
  name: string
  kind: FileKind
  /** 最近一次打开的时间戳 */
  openedAt: number
}

export const MAX_HISTORY = 60

/** 把一个条目插到列表最前（同路径去重） */
export function promoteItem(list: BookmarkItem[], item: BookmarkItem, limit = MAX_HISTORY): BookmarkItem[] {
  const rest = list.filter((entry) => entry.path !== item.path)
  return [item, ...rest].slice(0, limit)
}

/** 切换收藏状态 */
export function toggleFavorite(list: BookmarkItem[], item: BookmarkItem): BookmarkItem[] {
  return list.some((entry) => entry.path === item.path)
    ? list.filter((entry) => entry.path !== item.path)
    : [item, ...list]
}

export function isFavorited(list: BookmarkItem[], path: string | null | undefined): boolean {
  if (!path) return false
  return list.some((entry) => entry.path === path)
}

/** 相对时间描述 */
export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(timestamp).toLocaleDateString()
}
