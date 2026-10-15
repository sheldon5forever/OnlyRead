import { Slugger } from './outline'

/** 把本地目录转换成 file:/// 形式的 base，便于 HTML 引用同目录资源 */
export function toFileBaseUrl(dir: string): string {
  let normalized = dir.replace(/\\/g, '/')
  if (!normalized.startsWith('/')) normalized = `/${normalized}`
  const encoded = normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `file://${encoded}/`
}

/** 预览用配色（与主界面主题保持一致） */
export interface PreviewPalette {
  background: string
  foreground: string
  link: string
  codeBg: string
  codeBorder: string
  quoteBorder: string
  tableBorder: string
  tableHead: string
}

export const LIGHT_PALETTE: PreviewPalette = {
  background: '#ffffff',
  foreground: '#1f2328',
  link: '#2f7efc',
  codeBg: '#f4f5f7',
  codeBorder: '#e3e5e8',
  quoteBorder: '#d5d8dc',
  tableBorder: '#cfd3d8',
  tableHead: '#f6f7f8'
}

export const DARK_PALETTE: PreviewPalette = {
  background: '#191a1e',
  foreground: '#e4e6ea',
  link: '#6aa5ff',
  codeBg: '#232429',
  codeBorder: '#2e3036',
  quoteBorder: '#3a3d44',
  tableBorder: '#3d4048',
  tableHead: '#232429'
}

function paletteStyles(palette: PreviewPalette, maxWidth: string): string {
  return `
    :root { color-scheme: ${palette.background === '#ffffff' ? 'light' : 'dark'}; }
    html, body {
      margin: 0;
      padding: 0;
      background: ${palette.background};
      color: ${palette.foreground};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
        'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif;
      font-size: 15.5px;
      line-height: 1.78;
    }
    body { padding: 28px 40px 100px; max-width: ${maxWidth}; margin: 0 auto; }
    body > :first-child { margin-top: 0; }
    h1, h2, h3, h4, h5, h6 { line-height: 1.35; margin: 1.6em 0 .7em; scroll-margin-top: 16px; }
    h1 { font-size: 1.85em; }
    h2 { font-size: 1.42em; padding-bottom: .3em; border-bottom: 1px solid ${palette.codeBorder}; }
    h3 { font-size: 1.2em; }
    h4 { font-size: 1.05em; }
    p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }
    a { color: ${palette.link}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code, pre, kbd, samp { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; }
    code { font-size: .88em; }
    pre { padding: 14px 16px; border-radius: 6px; background: ${palette.codeBg}; border: 1px solid ${palette.codeBorder}; overflow: auto; }
    :not(pre) > code { padding: .16em .38em; border-radius: 4px; background: ${palette.codeBg}; border: 1px solid ${palette.codeBorder}; }
    blockquote { margin-left: 0; padding: .2em 0 .2em 1em; border-left: 3px solid ${palette.quoteBorder}; opacity: .82; }
    img { max-width: 100%; height: auto; }
    table { border-collapse: collapse; font-size: .94em; display: block; overflow: auto; max-width: 100%; width: max-content; }
    th, td { border: 1px solid ${palette.tableBorder}; padding: 8px 13px; text-align: left; }
    th { background: ${palette.tableHead}; font-weight: 620; }
    hr { border: none; height: 1px; background: ${palette.codeBorder}; margin: 2em 0; }
  `
}

export interface PreparedHtml {
  /** 注入 base / 样式 / 锚点后的完整 HTML */
  html: string
  /** 标题大纲 */
  headingIds: { level: number; text: string; id: string }[]
}

/**
 * 为 iframe 预览整理 HTML：
 * - 注入 <base> 让同目录的相对资源可解析
 * - 注入阅读器风格样式
 * - 给标题补锚点 id，供左侧大纲跳转
 *
 * `maxWidth` 为正文最大宽度（受「排版宽度」设置控制）。
 */
export function prepareHtmlForPreview(
  source: string,
  dir: string,
  palette: PreviewPalette,
  maxWidth: string
): PreparedHtml {
  const doc = new DOMParser().parseFromString(source, 'text/html')

  // 移除可能干扰阅读的脚本（预览不需要执行页面脚本）
  doc.querySelectorAll('script').forEach((node) => node.remove())

  const head = doc.head ?? doc.documentElement.insertBefore(
    doc.createElement('head'),
    doc.documentElement.firstChild
  )

  doc.querySelectorAll('base').forEach((node) => node.remove())
  const base = doc.createElement('base')
  base.setAttribute('href', toFileBaseUrl(dir))
  head.insertBefore(base, head.firstChild)

  const style = doc.createElement('style')
  style.textContent = paletteStyles(palette, maxWidth)
  head.appendChild(style)

  const slugger = new Slugger()
  const headingIds: { level: number; text: string; id: string }[] = []
  doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((node) => {
    const text = (node.textContent ?? '').trim()
    if (!text) return
    const id = node.id || slugger.slug(text)
    node.setAttribute('id', id)
    headingIds.push({ level: Number(node.tagName.slice(1)), text, id })
  })

  const doctype = '<!doctype html>'
  return { html: `${doctype}\n${doc.documentElement.outerHTML}`, headingIds }
}
