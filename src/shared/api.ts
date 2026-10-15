import type {
  BinaryPayload,
  DirListing,
  FileEntry,
  OpenedTarget,
  TextPayload,
  WindowState
} from './types'

export interface WindowControlsApi {
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<WindowState | null>
  close: () => Promise<void>
  getState: () => Promise<WindowState | null>
  setTitle: (title: string) => Promise<void>
  /** 切换全屏 */
  toggleFullscreen: () => Promise<WindowState | null>
  /** 切换「窗口置顶」 */
  setAlwaysOnTop: (flag: boolean) => Promise<void>
  /** 监听窗口最大化 / 全屏状态变化，返回取消订阅函数 */
  onStateChange: (callback: (state: WindowState) => void) => () => void
}

/** preload 通过 contextBridge 暴露到 window.reader 的能力集合 */
export interface ReaderApi {
  /** 弹出系统对话框选择单个文件 */
  openFileDialog: () => Promise<OpenedTarget | null>
  /** 弹出系统对话框选择文件夹 */
  openFolderDialog: () => Promise<OpenedTarget | null>
  /** 按绝对路径打开文件或文件夹 */
  openPath: (path: string) => Promise<OpenedTarget>

  readDirectory: (dir: string, showHidden?: boolean) => Promise<DirListing>
  /** 读取单个路径的详细信息 */
  readEntry: (path: string) => Promise<FileEntry>
  readText: (file: string) => Promise<TextPayload>
  /** 整份读取二进制内容；`maxBytes` 可放宽默认上限（PDF 兜底路径用） */
  readBinary: (file: string, maxBytes?: number) => Promise<BinaryPayload>

  /** 取得拖拽进窗口的本地文件路径（Electron 32+ 不再提供 File.path） */
  getPathForFile: (file: File) => string

  showItemInFolder: (path: string) => Promise<void>
  openExternal: (url: string) => Promise<void>

  /** 取出启动参数中待打开的目标 */
  consumePendingTargets: () => Promise<string[]>
  /** 监听运行期「用本应用打开」的目标 */
  onOpenTargets: (callback: (targets: string[]) => void) => () => void

  windowControls: WindowControlsApi
}
