/**
 * 渲染进程按需读取本地文件所用的自定义协议。
 *
 * 大文件（例如几百 MB 的 PDF）不适合整份经 IPC 传进渲染进程，
 * 因此由主进程注册一个支持 Range 请求的协议，让 pdf.js 之类的
 * 解析器可以按需分片拉取，内存占用只与当前视口相关。
 */

export const STREAM_SCHEME = 'orfile'

/** 把本地绝对路径转换成可流式读取的 URL */
export function toStreamUrl(filePath: string): string {
  return `${STREAM_SCHEME}://local/?path=${encodeURIComponent(filePath)}`
}

/** 判断 URL 是否属于本应用的文件流协议 */
export function isStreamUrl(url: string): boolean {
  return url.startsWith(`${STREAM_SCHEME}://`)
}
