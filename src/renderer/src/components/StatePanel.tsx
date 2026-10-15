import { AlertTriangle, FileQuestion } from 'lucide-react'

interface LoadingProps {
  label?: string
}

export function LoadingState({ label = '正在读取文档…' }: LoadingProps): JSX.Element {
  return (
    <div className="state">
      <div className="state__inner">
        <div className="state__spinner" />
        <p className="state__desc">{label}</p>
      </div>
    </div>
  )
}

interface ErrorProps {
  title?: string
  message: string
  hint?: string
}

export function ErrorState({ title = '无法预览该文件', message, hint }: ErrorProps): JSX.Element {
  return (
    <div className="state">
      <div className="state__inner">
        <div className="state__icon state__icon--error">
          <AlertTriangle size={22} />
        </div>
        <h3 className="state__title">{title}</h3>
        <p className="state__desc">{message}</p>
        {hint ? <p className="state__desc" style={{ marginTop: 8 }}>{hint}</p> : null}
      </div>
    </div>
  )
}

interface UnsupportedProps {
  name: string
  kindLabel: string
  message?: string
}

export function UnsupportedState({ name, kindLabel, message }: UnsupportedProps): JSX.Element {
  return (
    <div className="state">
      <div className="state__inner">
        <div className="state__icon">
          <FileQuestion size={22} />
        </div>
        <h3 className="state__title">暂不支持预览 {kindLabel}</h3>
        <p className="state__desc">{message ?? `${name} 需要使用对应的专业软件打开。`}</p>
      </div>
    </div>
  )
}
