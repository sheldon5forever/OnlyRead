/**
 * 各类预览的体积限制（主进程与渲染进程共用）。
 */

/** 文本类文件：整份载入内存并渲染，限制在 8 MB */
export const MAX_TEXT_BYTES = 8 * 1024 * 1024

/** Word / PowerPoint / 图片：需要整份载入内存解析 */
export const MAX_BINARY_BYTES = 200 * 1024 * 1024

/** PDF：走自定义协议流式读取，上限放宽到 2 GB */
export const MAX_PDF_BYTES = 2 * 1024 * 1024 * 1024

/** PDF 在自定义协议不可用时的兜底整份读取上限 */
export const MAX_PDF_FALLBACK_BYTES = 512 * 1024 * 1024
