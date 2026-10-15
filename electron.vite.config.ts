import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 生产环境的内容安全策略。
 * 只允许加载同源脚本、blob worker 与本地资源，禁止执行内联脚本。
 * `orfile:` 是本应用用于流式读取本地文件的私有协议。
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: file: orfile:",
  "font-src 'self' data: orfile:",
  "media-src 'self' blob: data: orfile:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data: orfile:",
  "frame-src 'self' blob: data: orfile:",
  "object-src 'none'",
  "base-uri 'self'"
].join('; ')

/**
 * 开发模式下 Vite 会注入内联脚本（React Fast Refresh 预置代码、HMR 客户端），
 * 因此只在打包产物里写入严格的 CSP。
 */
function contentSecurityPolicyPlugin(): Plugin {
  return {
    name: 'onlyread:production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      // 必须放在 <head> 最前面，才能覆盖后续注入的脚本标签
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />`
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    // pdf.js 的 worker 以 ES module 形式单独打包，配合相对 base 可在打包后的 file:// 下加载
    worker: {
      format: 'es'
    },
    build: {
      chunkSizeWarningLimit: 2048
    },
    plugins: [react(), contentSecurityPolicyPlugin()]
  }
})

