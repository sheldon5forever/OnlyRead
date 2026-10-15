/**
 * 环境相关的模块声明。
 * 该文件不能包含顶层 import/export，否则会变成模块，
 * 其中的 declare module 会被当作模块增强而无法用于「无类型声明的包」。
 */

declare module '*?raw' {
  const content: string
  export default content
}

declare module '*?url' {
  const url: string
  export default url
}

declare module '*?worker' {
  const workerConstructor: new () => Worker
  export default workerConstructor
}

declare module 'mammoth' {
  export interface MammothMessage {
    type: string
    message: string
  }

  export interface MammothResult {
    value: string
    messages: MammothMessage[]
  }

  export interface MammothInput {
    arrayBuffer?: ArrayBuffer
    buffer?: Uint8Array
    path?: string
  }

  export interface MammothOptions {
    styleMap?: string[]
    includeDefaultStyleMap?: boolean
    convertImage?: unknown
    transformDocument?: unknown
  }

  export function convertToHtml(
    input: MammothInput,
    options?: MammothOptions
  ): Promise<MammothResult>

  export function convertToMarkdown(
    input: MammothInput,
    options?: MammothOptions
  ): Promise<MammothResult>

  export function extractRawText(input: MammothInput): Promise<MammothResult>

  const mammoth: {
    convertToHtml: typeof convertToHtml
    convertToMarkdown: typeof convertToMarkdown
    extractRawText: typeof extractRawText
  }

  export default mammoth
}
