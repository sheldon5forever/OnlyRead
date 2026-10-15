import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ReaderApi } from '../shared/api'
import type {
  BinaryPayload,
  DirListing,
  FileEntry,
  OpenedTarget,
  TextPayload,
  WindowState
} from '../shared/types'

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string }

/** 解包主进程返回的信封结构，失败时抛出可读错误 */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>
  if (!result.ok) throw new Error(result.error)
  return result.data
}

/** 订阅主进程事件，返回取消订阅函数 */
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: ReaderApi = {
  openFileDialog: (): Promise<OpenedTarget | null> => invoke('dialog:openFile'),
  openFolderDialog: (): Promise<OpenedTarget | null> => invoke('dialog:openFolder'),
  openPath: (path: string): Promise<OpenedTarget> => invoke('fs:openPath', path),

  readDirectory: (dir: string, showHidden = false): Promise<DirListing> =>
    invoke('fs:readDir', dir, showHidden),
  readEntry: (path: string): Promise<FileEntry> => invoke('fs:entry', path),
  readText: (file: string): Promise<TextPayload> => invoke('fs:readText', file),
  readBinary: (file: string, maxBytes?: number): Promise<BinaryPayload> =>
    invoke('fs:readBinary', file, maxBytes),

  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  showItemInFolder: (path: string): Promise<void> => invoke('shell:showItemInFolder', path),
  openExternal: (url: string): Promise<void> => invoke('shell:openExternal', url),

  consumePendingTargets: (): Promise<string[]> => invoke('app:consumePendingTargets'),
  onOpenTargets: (callback: (targets: string[]) => void): (() => void) =>
    subscribe<string[]>('app:open-targets', callback),

  windowControls: {
    minimize: (): Promise<void> => invoke('window:minimize'),
    toggleMaximize: (): Promise<WindowState | null> => invoke('window:toggleMaximize'),
    close: (): Promise<void> => invoke('window:close'),
    getState: (): Promise<WindowState | null> => invoke('window:getState'),
    setTitle: (title: string): Promise<void> => invoke('window:setTitle', title),
    toggleFullscreen: (): Promise<WindowState | null> => invoke('window:toggleFullscreen'),
    setAlwaysOnTop: (flag: boolean): Promise<void> => invoke('window:setAlwaysOnTop', flag),
    onStateChange: (callback: (state: WindowState) => void): (() => void) =>
      subscribe<WindowState>('window:state', callback)
  }
}

contextBridge.exposeInMainWorld('reader', api)
