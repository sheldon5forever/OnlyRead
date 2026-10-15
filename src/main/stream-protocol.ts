import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { STREAM_SCHEME } from '../shared/protocol'

/**
 * 本应用注册的协议会把本地文件直接流式（支持 Range）提供给渲染进程，
 * 因此需要放宽默认的跨源限制，让 file:// 页面也能读取响应头。
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range, Content-Length, Content-Encoding'
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8'
}

function mimeFor(filePath: string): string {
  const index = filePath.lastIndexOf('.')
  if (index < 0) return 'application/octet-stream'
  return MIME_BY_EXT[filePath.slice(index + 1).toLowerCase()] ?? 'application/octet-stream'
}

/** 解析 `bytes=start-end` / `bytes=start-` / `bytes=-suffix` */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null

  let start: number
  let end: number

  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start > end || start >= size) return null
  return { start, end }
}

/** 必须在 app ready 之前调用 */
export function registerStreamScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: STREAM_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ])
}

/** 在 app ready 之后调用，接管该协议的全部请求 */
export function handleStreamRequests(): void {
  protocol.handle(STREAM_SCHEME, async (request) => {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    const filePath = url.searchParams.get('path')
    if (url.hostname !== 'local' || !filePath) {
      return new Response('缺少 path 参数', { status: 400, headers: CORS_HEADERS })
    }

    let info
    try {
      info = await stat(filePath)
    } catch {
      return new Response('文件不存在', { status: 404, headers: CORS_HEADERS })
    }

    if (!info.isFile()) {
      return new Response('目标不是文件', { status: 400, headers: CORS_HEADERS })
    }

    const headers: Record<string, string> = {
      ...CORS_HEADERS,
      'Content-Type': mimeFor(filePath),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    }

    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { ...headers, 'Content-Length': String(info.size) }
      })
    }

    const rangeHeader = request.headers.get('range')
    const range = rangeHeader ? parseRange(rangeHeader, info.size) : null

    if (rangeHeader && !range) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${info.size}` }
      })
    }

    if (info.size === 0) {
      return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } })
    }

    const start = range?.start ?? 0
    const end = range?.end ?? info.size - 1

    // 用文件流作为响应体，读多少算多少，不会把整个文件载入内存
    const body = Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as ReadableStream

    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        ...headers,
        'Content-Length': String(end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {})
      }
    })
  })
}
