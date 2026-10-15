import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import {
  FileTooLargeError,
  entryFor,
  readBinaryFile,
  readDirectory,
  readTextFile,
  resolveTarget
} from './fs-service'
import { handleStreamRequests, registerStreamScheme } from './stream-protocol'
import type { OpenedTarget, WindowState } from '../shared/types'
import { SUPPORTED_EXTS } from '../shared/kind'
import { MAX_BINARY_BYTES } from '../shared/limits'

/** 选择文件对话框的过滤器（分类 + 全量），扩展名统一来自 shared/kind */
const OPEN_FILE_FILTERS = [
  { name: '全部支持的文档', extensions: SUPPORTED_EXTS.map((ext) => ext.slice(1)) },
  { name: '文本文件', extensions: ['txt', 'log', 'csv', 'json', 'xml', 'yml', 'yaml', 'ini', 'conf'] },
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdx', 'mdown'] },
  { name: '网页', extensions: ['html', 'htm', 'xhtml'] },
  { name: 'PDF', extensions: ['pdf'] },
  { name: 'Word 文档', extensions: ['docx', 'docm'] },
  { name: 'PowerPoint', extensions: ['pptx', 'pptm'] },
  { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
  { name: '所有文件', extensions: ['*'] }
]

/**
 * 与 electron-builder.yml 的 appId 保持一致。
 * Windows 靠它给任务栏按钮做身份识别；不设置时开发模式会被归到 "Electron" 名下，
 * 任务栏与通知里显示的都是 Electron 默认图标。
 */
const APP_ID = 'com.onlyread.app'

/**
 * 窗口 / 任务栏图标。
 * 开发模式下运行的 exe 是 node_modules 里的 electron.exe，任务栏图标取自进程 exe，
 * 所以必须显式给窗口设图标，否则看到的是 Electron 默认图标；
 * 打包后图标已内嵌进 OnlyRead.exe，这里再指一份是为 Linux 等依赖窗口图标的场景兜底。
 */
function windowIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png')
}

let mainWindow: BrowserWindow | null = null

/** 启动前（macOS open-file / 二次启动）缓存的待打开目标 */
let pendingTargets: string[] = []

function pushPendingTarget(targetPath: string): void {
  const absolute = resolve(targetPath)
  if (pendingTargets.includes(absolute)) return
  pendingTargets.push(absolute)
  mainWindow?.webContents.send('app:open-targets', [absolute])
}

/** 从命令行参数中提取真实存在的文件 / 文件夹路径 */
function pathsFromArgv(argv: string[]): string[] {
  const result: string[] = []
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith('-')) continue
    if (arg === '.') continue
    // 开发模式下 electron-vite 会把项目目录作为参数传入，需要排除
    const absolute = resolve(arg)
    if (absolute === resolve(process.cwd()) && !app.isPackaged) continue
    if (existsSync(absolute)) result.push(absolute)
  }
  return result
}

function currentWindowState(win: BrowserWindow): WindowState {
  return { maximized: win.isMaximized(), fullscreen: win.isFullScreen() }
}

function broadcastWindowState(win: BrowserWindow): void {
  win.webContents.send('window:state', currentWindowState(win))
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#ffffff',
    title: 'OnlyRead',
    icon: windowIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.on('maximize', () => broadcastWindowState(win))
  win.on('unmaximize', () => broadcastWindowState(win))
  win.on('enter-full-screen', () => broadcastWindowState(win))
  win.on('leave-full-screen', () => broadcastWindowState(win))

  // 站内链接用系统浏览器打开，避免阅读器自身被导航走
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 开发期把渲染进程日志转发到终端，便于排查
  if (!app.isPackaged || process.env['META_READER_DEBUG'] === '1') {
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      const tag = ['debug', 'info', 'warning', 'error'][level] ?? 'log'
      console.log(`[renderer:${tag}] ${message}${sourceId ? ` (${sourceId}:${line})` : ''}`)
    })
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    mainWindow = null
  })

  return win
}

/** 把 IPC 回调统一包装为 {ok,data} / {ok,error} 结构，避免异常直接抛到渲染进程 */
function handle<T>(channel: string, handler: (...args: never[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const data = await handler(...(args as never[]))
      return { ok: true as const, data }
    } catch (error) {
      const message =
        error instanceof FileTooLargeError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error)
      return { ok: false as const, error: message }
    }
  })
}

function registerIpc(): void {
  handle('dialog:openFile', async (): Promise<OpenedTarget | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '打开文件',
          properties: ['openFile'],
          filters: OPEN_FILE_FILTERS
        })
      : await dialog.showOpenDialog({ title: '打开文件', properties: ['openFile'], filters: OPEN_FILE_FILTERS })
    if (result.canceled || result.filePaths.length === 0) return null
    return resolveTarget(result.filePaths[0])
  })

  handle('dialog:openFolder', async (): Promise<OpenedTarget | null> => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '打开文件夹',
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({ title: '打开文件夹', properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return resolveTarget(result.filePaths[0])
  })

  handle('fs:openPath', (targetPath: string) => resolveTarget(targetPath))

  handle('fs:entry', (targetPath: string) => entryFor(targetPath))

  handle('fs:readDir', (dirPath: string, showHidden = false) => readDirectory(dirPath, showHidden))

  handle('fs:readText', (filePath: string) => readTextFile(filePath))

  handle('fs:readBinary', (filePath: string, maxBytes?: number) =>
    readBinaryFile(filePath, maxBytes ?? MAX_BINARY_BYTES)
  )

  handle('shell:showItemInFolder', (filePath: string) => {
    shell.showItemInFolder(resolve(filePath))
  })

  handle('shell:openExternal', (url: string) => shell.openExternal(url))

  handle('app:consumePendingTargets', (): string[] => {
    const targets = [...pendingTargets]
    pendingTargets = []
    return targets
  })

  handle('window:minimize', () => mainWindow?.minimize())

  handle('window:toggleMaximize', () => {
    if (!mainWindow) return null
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return currentWindowState(mainWindow)
  })

  handle('window:close', () => mainWindow?.close())

  handle('window:getState', (): WindowState | null =>
    mainWindow ? currentWindowState(mainWindow) : null
  )

  handle('window:toggleFullscreen', (): WindowState | null => {
    if (!mainWindow) return null
    mainWindow.setFullScreen(!mainWindow.isFullScreen())
    return currentWindowState(mainWindow)
  })

  handle('window:setAlwaysOnTop', (flag: boolean) => {
    mainWindow?.setAlwaysOnTop(flag, 'floating')
  })

  handle('window:setTitle', (title: string) => {
    mainWindow?.setTitle(title)
  })
}

// 自定义协议必须在 app ready 之前声明权限
registerStreamScheme()

// 任务栏身份：必须在创建窗口之前设置，否则 Windows 会把它归到 Electron 名下
app.setAppUserModelId(APP_ID)

// 单实例：第二次启动时把参数交给已有窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const targets = pathsFromArgv(argv)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    targets.forEach(pushPendingTarget)
  })

  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    pushPendingTarget(filePath)
  })

  app.whenReady().then(() => {
    pendingTargets = pathsFromArgv(process.argv)
    handleStreamRequests()
    registerIpc()
    mainWindow = createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
