/**
 * 把 pdf.js 的 cMap（中文/日文/韩文等 CID 字体映射）与标准字体资源
 * 复制到渲染进程的 public 目录，保证打包后仍能正确显示中文 PDF。
 *
 * 由 npm 的 predev / prebuild 钩子自动执行。
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json'))
const publicDir = resolve('src/renderer/public')

const ASSETS = ['cmaps', 'standard_fonts']

for (const name of ASSETS) {
  const from = resolve(pdfjsDir, name)
  const to = resolve(publicDir, name)

  try {
    await stat(from)
  } catch {
    console.warn(`[prepare-assets] 跳过：未找到 ${from}`)
    continue
  }

  await rm(to, { recursive: true, force: true })
  await mkdir(dirname(to), { recursive: true })
  await cp(from, to, { recursive: true })
  console.log(`[prepare-assets] ${name} -> ${to}`)
}
