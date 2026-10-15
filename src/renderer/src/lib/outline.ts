export interface Heading {
  level: number
  text: string
  id: string
}

/** 生成与正文标题一致的锚点 id（保留中文、字母、数字） */
export function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'section'
}

/** 处理重复标题：foo、foo-1、foo-2 … 与正文渲染保持一致 */
export class Slugger {
  private readonly seen = new Map<string, number>()

  slug(text: string): string {
    const base = slugify(text)
    const count = this.seen.get(base)
    if (count === undefined) {
      this.seen.set(base, 0)
      return base
    }
    const next = count + 1
    this.seen.set(base, next)
    return `${base}-${next}`
  }
}
