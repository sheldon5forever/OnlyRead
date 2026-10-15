/**
 * 正文排版宽度。
 *
 * Markdown / Word / HTML 这类「文档型」内容默认按阅读栏宽居中排版，
 * 在宽屏显示器上两侧会留下大片空白，因此提供三档宽度供用户切换。
 */

export type DocWidth = 'comfortable' | 'wide' | 'full'

export const DOC_WIDTH_STORAGE_KEY = 'onlyread.docWidth'

export interface DocWidthOption {
  value: DocWidth
  /** 菜单里的短标签 */
  label: string
  /** 悬浮提示里的补充说明 */
  hint: string
}

export const DOC_WIDTH_OPTIONS: readonly DocWidthOption[] = [
  { value: 'comfortable', label: '居中', hint: '阅读栏宽约 900px，长文更易读' },
  { value: 'wide', label: '宽屏', hint: '约 1280px，兼顾表格与代码块' },
  { value: 'full', label: '全宽', hint: '占满整个预览区' }
]

export const DEFAULT_DOC_WIDTH: DocWidth = 'comfortable'

export function isDocWidth(value: unknown): value is DocWidth {
  return value === 'comfortable' || value === 'wide' || value === 'full'
}

/** 从任意输入中取得合法的宽度设置 */
export function normalizeDocWidth(value: unknown): DocWidth {
  return isDocWidth(value) ? value : DEFAULT_DOC_WIDTH
}

export function docWidthLabel(width: DocWidth): string {
  return DOC_WIDTH_OPTIONS.find((option) => option.value === width)?.label ?? '居中'
}

/** 正文容器使用的修饰类名 */
export function docWidthClass(width: DocWidth): string {
  return `doc--${width}`
}

/** 供 HTML 预览的 iframe 使用的最大宽度值 */
export function docMaxWidthCss(width: DocWidth): string {
  if (width === 'wide') return '1280px'
  if (width === 'full') return 'none'
  return '900px'
}
