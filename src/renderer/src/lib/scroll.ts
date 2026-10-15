import type { Heading } from './outline'
import { Slugger } from './outline'

/**
 * 按 DOM 顺序给标题补上锚点 id，并返回大纲。
 * 直接读取渲染结果，保证大纲与正文锚点严格一致。
 */
export function assignHeadingIds(container: HTMLElement): Heading[] {
  const slugger = new Slugger()
  const headings: Heading[] = []
  const nodes = container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')

  nodes.forEach((node) => {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!text) return
    const id = node.id || slugger.slug(text)
    node.id = id
    headings.push({ level: Number(node.tagName.slice(1)), text, id })
  })

  return headings
}

/** 在滚动容器内跳转到指定锚点 */
export function scrollToHeading(container: HTMLElement, id: string): void {
  const target = container.querySelector<HTMLElement>(`[id="${id}"]`)
  if (!target) return
  const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top
  container.scrollTo({ top: container.scrollTop + offset - 12, behavior: 'smooth' })
}

/** 滚动时同步左侧大纲高亮 */
export function trackActiveHeading(
  container: HTMLElement,
  onChange: (id: string | null) => void
): () => void {
  let frame = 0

  const update = (): void => {
    frame = 0
    const containerTop = container.getBoundingClientRect().top
    const nodes = container.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')
    let current: string | null = null
    for (const node of nodes) {
      if (node.getBoundingClientRect().top - containerTop <= 72) current = node.id
      else break
    }
    onChange(current)
  }

  const onScroll = (): void => {
    if (frame === 0) frame = requestAnimationFrame(update)
  }

  container.addEventListener('scroll', onScroll, { passive: true })
  update()

  return () => {
    container.removeEventListener('scroll', onScroll)
    if (frame !== 0) cancelAnimationFrame(frame)
  }
}
