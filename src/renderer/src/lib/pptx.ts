import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'

/* ------------------------------------------------------------------ *
 * 类型定义
 * ------------------------------------------------------------------ */

export interface PptxRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  sizePt?: number
  color?: string
}

export interface PptxParagraph {
  runs: PptxRun[]
  align?: 'left' | 'center' | 'right' | 'justify'
  level: number
  sizePt?: number
  bullet?: boolean
}

export interface PptxBox {
  x: number
  y: number
  cx: number
  cy: number
}

export interface PptxTextShape extends PptxBox {
  kind: 'text'
  paragraphs: PptxParagraph[]
  anchor: 'top' | 'middle' | 'bottom'
  /** 占位符类型，例如 title / ctrTitle / body */
  placeholder: string | null
  isTitle: boolean
}

export interface PptxImageShape extends PptxBox {
  kind: 'image'
  src: string
  alt: string
}

export interface PptxTableCell {
  paragraphs: PptxParagraph[]
  colspan: number
  rowspan: number
}

export interface PptxTableShape extends PptxBox {
  kind: 'table'
  rows: PptxTableCell[][]
  columnWidths: number[]
  rowHeights: number[]
}

export type PptxShape = PptxTextShape | PptxImageShape | PptxTableShape

export interface PptxSlide {
  /** 从 1 开始 */
  index: number
  title: string
  shapes: PptxShape[]
  notes: string
}

export interface PptxDeck {
  /** 幻灯片宽度（EMU） */
  width: number
  height: number
  slides: PptxSlide[]
}

/* ------------------------------------------------------------------ *
 * XML 解析
 * ------------------------------------------------------------------ */

const ARRAY_NODES = new Set([
  'p:sp',
  'p:pic',
  'p:graphicFrame',
  'p:grpSp',
  'p:cxnSp',
  'p:sldId',
  'a:p',
  'a:r',
  'a:br',
  'a:fld',
  'a:tr',
  'a:tc'
])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => ARRAY_NODES.has(name)
})

type XmlNode = Record<string, unknown>

function asArray(value: unknown): XmlNode[] {
  if (value === undefined || value === null) return []
  return (Array.isArray(value) ? value : [value]) as XmlNode[]
}

function asNode(value: unknown): XmlNode | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as XmlNode
  return null
}

/** 读取节点文本（兼容纯文本与 {#text} 两种形态） */
function nodeText(value: unknown): string {
  if (typeof value === 'string') return value
  const node = asNode(value)
  if (node && typeof node['#text'] === 'string') return node['#text']
  return ''
}

function attr(node: XmlNode | null, name: string): string | null {
  if (!node) return null
  const value = node[`@_${name}`]
  return typeof value === 'string' ? value : null
}

function num(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseXml(xml: string): XmlNode {
  return parser.parse(xml) as XmlNode
}

/* ------------------------------------------------------------------ *
 * 颜色 / 尺寸
 * ------------------------------------------------------------------ */

const SCHEME_COLORS: Record<string, string> = {
  dk1: '#000000',
  tx1: '#000000',
  lt1: '#ffffff',
  bg1: '#ffffff',
  dk2: '#44546a',
  tx2: '#44546a',
  lt2: '#e7e6e6',
  bg2: '#e7e6e6',
  accent1: '#4472c4',
  accent2: '#ed7d31',
  accent3: '#a5a5a5',
  accent4: '#ffc000',
  accent5: '#5b9bd5',
  accent6: '#70ad47',
  hlink: '#0563c1',
  folHlink: '#954f72'
}

/** 解析 <a:solidFill> 等颜色节点 */
function readColor(node: XmlNode | null): string | undefined {
  if (!node) return undefined

  const solidFill = asNode(node['a:solidFill'])
  if (solidFill) {
    const srgb = asNode(solidFill['a:srgbClr'])
    const hex = attr(srgb, 'val')
    if (hex) return `#${hex}`

    const scheme = asNode(solidFill['a:schemeClr'])
    const schemeName = attr(scheme, 'val')
    if (schemeName && SCHEME_COLORS[schemeName]) return SCHEME_COLORS[schemeName]

    const preset = asNode(solidFill['a:prstClr'])
    const presetName = attr(preset, 'val')
    if (presetName) return presetName
  }

  const highlight = asNode(node['a:highlight'])
  if (highlight) {
    const srgb = asNode(highlight['a:srgbClr'])
    const hex = attr(srgb, 'val')
    if (hex) return `#${hex}`
  }

  return undefined
}

/** 读取 a:rPr / a:defRPr / a:endParaRPr 上的字号与样式 */
function readRunProps(properties: XmlNode | null): {
  sizePt?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
} {
  if (!properties) return {}

  const result: {
    sizePt?: number
    bold?: boolean
    italic?: boolean
    underline?: boolean
    color?: string
  } = {}

  const sizeRaw = num(attr(properties, 'sz'))
  if (sizeRaw !== null) result.sizePt = sizeRaw / 100

  const bold = attr(properties, 'b')
  if (bold !== null) result.bold = bold === '1' || bold === 'true'

  const italic = attr(properties, 'i')
  if (italic !== null) result.italic = italic === '1' || italic === 'true'

  const underline = attr(properties, 'u')
  if (underline !== null) result.underline = underline !== 'none'

  const color = readColor(properties)
  if (color) result.color = color

  return result
}

const ALIGN_MAP: Record<string, PptxParagraph['align']> = {
  l: 'left',
  ctr: 'center',
  r: 'right',
  just: 'justify',
  dist: 'justify'
}

/** 解析 a:p 段落 */
function readParagraphs(txBody: XmlNode | null): PptxParagraph[] {
  if (!txBody) return []
  const paragraphs: PptxParagraph[] = []

  for (const p of asArray(txBody['a:p'])) {
    const pPr = asNode(p['a:pPr'])
    const defProps = readRunProps(asNode(pPr?.['a:defRPr']))
    const runs: PptxRun[] = []

    const pushRun = (node: XmlNode, key: string): void => {
      const value = node[key]
      for (const item of asArray(value)) {
        const props = readRunProps(asNode(item['a:rPr']))
        runs.push({
          text: nodeText(item['a:t']),
          ...defProps,
          ...props,
          sizePt: props.sizePt ?? defProps.sizePt
        })
      }
    }

    pushRun(p, 'a:r')
    pushRun(p, 'a:fld')
    for (const br of asArray(p['a:br'])) {
      void br
      runs.push({ text: '\n' })
    }

    const level = num(attr(pPr, 'lvl')) ?? 0
    const bullet = pPr ? !asNode(pPr['a:buNone']) : false
    const alignRaw = attr(pPr, 'algn')

    if (runs.length === 0) {
      runs.push({ text: '' })
    }

    paragraphs.push({
      runs,
      level,
      sizePt: defProps.sizePt,
      align: alignRaw ? ALIGN_MAP[alignRaw] : undefined,
      bullet: bullet && level === 0 && runs.some((run) => run.text.trim().length > 0)
    })
  }

  return paragraphs
}

function paragraphText(paragraphs: PptxParagraph[]): string {
  return paragraphs
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    .join('\n')
    .trim()
}

/** 从 <a:xfrm> 读取位置与尺寸 */
function readTransform(node: XmlNode | null): PptxBox | null {
  const xfrm = asNode(node?.['a:xfrm'])
  if (!xfrm) return null
  const off = asNode(xfrm['a:off'])
  const ext = asNode(xfrm['a:ext'])
  const x = num(attr(off, 'x'))
  const y = num(attr(off, 'y'))
  const cx = num(attr(ext, 'cx'))
  const cy = num(attr(ext, 'cy'))
  if (x === null || y === null || cx === null || cy === null) return null
  return { x, y, cx, cy }
}

/** 占位符在版式 / 母版中的定义 */
interface PlaceholderInfo {
  type: string | null
  box: PptxBox | null
}

/**
 * 收集形状树中所有占位符定义。
 * 幻灯片里的占位符通常不写 a:xfrm，位置与类型都继承自版式或母版。
 */
function collectPlaceholders(tree: XmlNode | null): Map<string, PlaceholderInfo> {
  const map = new Map<string, PlaceholderInfo>()
  if (!tree) return map

  for (const sp of asArray(tree['p:sp'])) {
    const nvSpPr = asNode(sp['p:nvSpPr'])
    const ph = asNode(asNode(nvSpPr?.['p:nvPr'])?.['p:ph'])
    if (!ph) continue

    const type = attr(ph, 'type')
    const idx = attr(ph, 'idx')
    const info: PlaceholderInfo = { type, box: readTransform(asNode(sp['p:spPr'])) }

    if (idx !== null) map.set(`idx:${idx}`, info)
    if (type !== null) map.set(`type:${type}`, info)
  }

  return map
}

/** 按 idx（优先）或类型查找占位符定义 */
function lookupPlaceholder(
  map: Map<string, PlaceholderInfo>,
  type: string | null,
  idx: string | null
): PlaceholderInfo | undefined {
  if (idx !== null) {
    const hit = map.get(`idx:${idx}`)
    if (hit?.box) return hit
  }
  if (type !== null) {
    const hit = map.get(`type:${type}`)
    if (hit?.box) return hit
  }
  if (idx === null && type === null) {
    const hit = map.get('idx:0')
    if (hit?.box) return hit
  }
  return undefined
}

/* ------------------------------------------------------------------ *
 * 关系文件
 * ------------------------------------------------------------------ */

function normalizePartPath(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const segments = baseDir ? baseDir.split('/') : []
  for (const part of target.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  return segments.join('/')
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  emf: 'image/emf',
  wmf: 'image/wmf',
  tiff: 'image/tiff'
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

export async function parsePptx(data: Uint8Array): Promise<PptxDeck> {
  const zip = await JSZip.loadAsync(data)

  const relsCache = new Map<string, Map<string, string>>()

  /** 读取某个 part 的 _rels 映射：rId -> 目标 part 路径 */
  const loadRels = async (partPath: string): Promise<Map<string, string>> => {
    const cached = relsCache.get(partPath)
    if (cached) return cached

    const dir = partPath.includes('/') ? partPath.slice(0, partPath.lastIndexOf('/')) : ''
    const file = partPath.split('/').pop() ?? ''
    const relsPath = `${dir ? `${dir}/` : ''}_rels/${file}.rels`

    const map = new Map<string, string>()
    const entry = zip.file(relsPath)
    if (entry) {
      const xml = await entry.async('string')
      const parsed = parseXml(xml)
      for (const rel of asArray(asNode(parsed['Relationships'])?.['Relationship'])) {
        const id = attr(rel, 'Id')
        const target = attr(rel, 'Target')
        const mode = attr(rel, 'TargetMode')
        if (id && target && mode !== 'External') {
          map.set(id, normalizePartPath(dir, target))
        }
      }
    }
    relsCache.set(partPath, map)
    return map
  }

  const mediaCache = new Map<string, string | null>()
  /** 读取媒体文件并转成 data URL */
  const loadMedia = async (path: string | undefined): Promise<string | null> => {
    if (!path) return null
    if (mediaCache.has(path)) return mediaCache.get(path) ?? null
    const entry = zip.file(path)
    if (!entry) {
      mediaCache.set(path, null)
      return null
    }
    const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : ''
    const base64 = await entry.async('base64')
    const url = `data:${MIME_BY_EXT[ext] ?? 'application/octet-stream'};base64,${base64}`
    mediaCache.set(path, url)
    return url
  }

  /** 读取版式 / 母版中的占位符定义（并向上合并母版信息） */
  const placeholderCache = new Map<string, Map<string, PlaceholderInfo>>()
  const loadPlaceholderMap = async (partPath: string): Promise<Map<string, PlaceholderInfo>> => {
    const cached = placeholderCache.get(partPath)
    if (cached) return cached

    const map = new Map<string, PlaceholderInfo>()
    const entry = zip.file(partPath)

    if (entry) {
      const root = parseXml(await entry.async('string'))
      const node = asNode(root['p:sldLayout']) ?? asNode(root['p:sldMaster']) ?? {}
      const tree = asNode(asNode(node['p:cSld'])?.['p:spTree'])
      for (const [key, info] of collectPlaceholders(tree)) map.set(key, info)

      // 版式本身可能仍缺少位置，继续向上查找母版
      if ([...map.values()].some((info) => !info.box)) {
        const ownRels = await loadRels(partPath)
        const masterPath = [...ownRels.values()].find((target) =>
          target.startsWith('ppt/slideMasters/')
        )
        if (masterPath) {
          const masterMap = await loadPlaceholderMap(masterPath)
          for (const [key, info] of map) {
            if (info.box) continue
            const inherited = masterMap.get(key)
            if (inherited?.box) {
              map.set(key, { type: info.type ?? inherited.type, box: inherited.box })
            }
          }
        }
      }
    }

    placeholderCache.set(partPath, map)
    return map
  }

  /* -------- 幻灯片尺寸与顺序 -------- */

  const presentationEntry = zip.file('ppt/presentation.xml')
  if (!presentationEntry) throw new Error('不是有效的 .pptx 文件（缺少 ppt/presentation.xml）')

  const presentation = parseXml(await presentationEntry.async('string'))
  const presentationNode = asNode(presentation['p:presentation']) ?? {}
  const slideSize = asNode(presentationNode['p:sldSz'])
  const width = num(attr(slideSize, 'cx')) ?? 9144000
  const height = num(attr(slideSize, 'cy')) ?? 6858000

  const presentationRels = await loadRels('ppt/presentation.xml')
  const slideOrder: string[] = []
  const sldIdLst = asNode(presentationNode['p:sldIdLst'])
  for (const sldId of asArray(sldIdLst?.['p:sldId'])) {
    const rid = attr(sldId, 'r:id') ?? attr(sldId, 'id')
    const target = rid ? presentationRels.get(rid) : undefined
    if (target) slideOrder.push(target)
  }

  if (slideOrder.length === 0) {
    // 兜底：直接按文件名顺序
    Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const na = Number(a.replace(/\D/g, ''))
        const nb = Number(b.replace(/\D/g, ''))
        return na - nb
      })
      .forEach((name) => slideOrder.push(name))
  }

  /* -------- 逐页解析 -------- */

  const slides: PptxSlide[] = []

  for (let index = 0; index < slideOrder.length; index += 1) {
    const slidePath = slideOrder[index]
    const entry = zip.file(slidePath)
    if (!entry) continue

    const slideXml = parseXml(await entry.async('string'))
    const slideNode = asNode(slideXml['p:sld']) ?? {}
    const rels = await loadRels(slidePath)

    // 占位符的位置与类型通常由版式（乃至母版）提供
    const layoutPath = [...rels.values()].find((target) =>
      target.startsWith('ppt/slideLayouts/')
    )
    const layoutPlaceholders = layoutPath
      ? await loadPlaceholderMap(layoutPath)
      : new Map<string, PlaceholderInfo>()

    const shapes: PptxShape[] = []
    let title = ''

    const handleShapeTree = async (
      tree: XmlNode,
      offsetX = 0,
      offsetY = 0,
      scaleX = 1,
      scaleY = 1
    ): Promise<void> => {
      const adjust = (box: PptxBox): PptxBox => ({
        x: offsetX + box.x * scaleX,
        y: offsetY + box.y * scaleY,
        cx: box.cx * scaleX,
        cy: box.cy * scaleY
      })

      const children: [string, unknown][] = [
        ['p:sp', tree['p:sp']],
        ['p:pic', tree['p:pic']],
        ['p:graphicFrame', tree['p:graphicFrame']],
        ['p:grpSp', tree['p:grpSp']],
        ['p:cxnSp', tree['p:cxnSp']]
      ]

      for (const [key, value] of children) {
        for (const node of asArray(value)) {
          if (key === 'p:sp') {
            const nvSpPr = asNode(node['p:nvSpPr'])
            const ph = asNode(asNode(nvSpPr?.['p:nvPr'])?.['p:ph'])
            const placeholderIdx = attr(ph, 'idx')
            let placeholder = attr(ph, 'type')

            let box = readTransform(asNode(node['p:spPr']))

            // 没有显式坐标时，从版式 / 母版继承
            if (ph) {
              const inherited = lookupPlaceholder(layoutPlaceholders, placeholder, placeholderIdx)
              if (inherited) {
                if (!box) box = inherited.box
                if (!placeholder) placeholder = inherited.type
              }
            }

            if (!box) continue

            const isTitle = placeholder === 'title' || placeholder === 'ctrTitle'

            const paragraphs = readParagraphs(asNode(node['p:txBody']))
            const text = paragraphText(paragraphs)
            if (isTitle && !title && text) title = text.split('\n')[0]

            const bodyPr = asNode(asNode(node['p:txBody'])?.['a:bodyPr'])
            const anchorRaw = attr(bodyPr, 'anchor')
            const anchor: PptxTextShape['anchor'] =
              anchorRaw === 'ctr' ? 'middle' : anchorRaw === 'b' ? 'bottom' : 'top'

            shapes.push({
              kind: 'text',
              ...adjust(box),
              paragraphs,
              anchor,
              placeholder: placeholder ?? (placeholderIdx ? 'body' : null),
              isTitle
            })
          }

          if (key === 'p:pic') {
            const spPr = asNode(node['p:spPr'])
            const box = readTransform(spPr)
            if (!box) continue

            const blip = asNode(asNode(node['p:blipFill'])?.['a:blip'])
            const embed = attr(blip, 'r:embed')
            const src = await loadMedia(embed ? rels.get(embed) : undefined)
            if (!src) continue

            const cNvPr = asNode(asNode(node['p:nvPicPr'])?.['p:cNvPr'])
            shapes.push({ kind: 'image', ...adjust(box), src, alt: attr(cNvPr, 'name') ?? '' })
          }

          if (key === 'p:graphicFrame') {
            const xfrm = asNode(node['p:xfrm'])
            const off = asNode(xfrm?.['a:off'])
            const ext = asNode(xfrm?.['a:ext'])
            const box: PptxBox = {
              x: num(attr(off, 'x')) ?? 0,
              y: num(attr(off, 'y')) ?? 0,
              cx: num(attr(ext, 'cx')) ?? 0,
              cy: num(attr(ext, 'cy')) ?? 0
            }

            const tbl = asNode(asNode(asNode(node['a:graphic'])?.['a:graphicData'])?.['a:tbl'])
            if (!tbl) continue

            const columnWidths = asArray(asNode(tbl['a:tblGrid'])?.['a:gridCol']).map(
              (col) => num(attr(col, 'w')) ?? 0
            )

            const rows: PptxTableCell[][] = []
            const rowHeights: number[] = []
            for (const tr of asArray(tbl['a:tr'])) {
              rowHeights.push(num(attr(tr, 'h')) ?? 0)
              const cells: PptxTableCell[] = []
              for (const tc of asArray(tr['a:tc'])) {
                cells.push({
                  paragraphs: readParagraphs(asNode(tc['p:txBody'])),
                  colspan: num(attr(tc, 'gridSpan')) ?? 1,
                  rowspan: num(attr(tc, 'rowSpan')) ?? 1
                })
              }
              rows.push(cells)
            }

            shapes.push({ kind: 'table', ...adjust(box), rows, columnWidths, rowHeights })
          }

          if (key === 'p:grpSp') {
            const grpSpPr = asNode(node['p:grpSpPr'])
            const xfrm = asNode(grpSpPr?.['a:xfrm'])
            const off = asNode(xfrm?.['a:off'])
            const ext = asNode(xfrm?.['a:ext'])
            const chOff = asNode(xfrm?.['a:chOff'])
            const chExt = asNode(xfrm?.['a:chExt'])

            const offX = num(attr(off, 'x')) ?? 0
            const offY = num(attr(off, 'y')) ?? 0
            const extX = num(attr(ext, 'cx')) ?? 0
            const extY = num(attr(ext, 'cy')) ?? 0
            const chOffX = num(attr(chOff, 'x')) ?? 0
            const chOffY = num(attr(chOff, 'y')) ?? 0
            const chExtX = num(attr(chExt, 'cx')) ?? extX
            const chExtY = num(attr(chExt, 'cy')) ?? extY

            // 组合变换：先映射到子坐标系，再叠加父级变换
            const kx = chExtX ? extX / chExtX : 1
            const ky = chExtY ? extY / chExtY : 1

            await handleShapeTree(
              node,
              offsetX + (offX - chOffX * kx) * scaleX,
              offsetY + (offY - chOffY * ky) * scaleY,
              scaleX * kx,
              scaleY * ky
            )
          }
        }
      }
    }

    const cSld = asNode(slideNode['p:cSld'])
    const spTree = asNode(cSld?.['p:spTree'])
    if (spTree) await handleShapeTree(spTree)

    // 没有显式标题时退化为第一个文本形状
    if (!title) {
      const firstText = shapes.find(
        (shape): shape is PptxTextShape => shape.kind === 'text' && paragraphText(shape.paragraphs).length > 0
      )
      if (firstText) title = paragraphText(firstText.paragraphs).split('\n')[0]
    }

    // 备注
    let notes = ''
    for (const target of rels.values()) {
      if (!target.startsWith('ppt/notesSlides/')) continue
      const notesEntry = zip.file(target)
      if (!notesEntry) continue
      const notesXml = parseXml(await notesEntry.async('string'))
      const notesTree = asNode(asNode(asNode(notesXml['p:notes'])?.['p:cSld'])?.['p:spTree'])
      for (const sp of asArray(notesTree?.['p:sp'])) {
        const paragraphs = readParagraphs(asNode(sp['p:txBody']))
        const text = paragraphText(paragraphs)
        if (text) notes += (notes ? '\n' : '') + text
      }
      break
    }

    slides.push({ index: index + 1, title: title || `第 ${index + 1} 张幻灯片`, shapes, notes })
  }

  return { width, height, slides }
}
