import { useMemo } from 'react'
import { Hash, WrapText } from 'lucide-react'
import { ViewerFrame, type ViewerChrome } from './ViewerFrame'

interface Props {
  chrome: ViewerChrome
  text: string
  showLineNumbers: boolean
  onToggleLineNumbers: () => void
  wrap: boolean
  onToggleWrap: () => void
}

const MAX_NUMBERED_LINES = 5000

export function TextViewer({
  chrome,
  text,
  showLineNumbers,
  onToggleLineNumbers,
  wrap,
  onToggleWrap
}: Props): JSX.Element {
  const lines = useMemo(() => text.split(/\r?\n/), [text])
  const withNumbers = showLineNumbers && lines.length <= MAX_NUMBERED_LINES
  const noWrapStyle = wrap ? undefined : { whiteSpace: 'pre' as const, wordBreak: 'normal' as const }

  return (
    <ViewerFrame
      chrome={chrome}
      extra={
        <>
          <button
            type="button"
            className={`viewer__control${showLineNumbers ? ' is-on' : ''}`}
            title="显示行号"
            onClick={onToggleLineNumbers}
          >
            <Hash size={13} />
          </button>
          <button
            type="button"
            className={`viewer__control${wrap ? '' : ' is-off'}`}
            title={wrap ? '关闭自动换行' : '开启自动换行'}
            onClick={onToggleWrap}
          >
            <WrapText size={13} />
          </button>
        </>
      }
    >
      <div className="text-view">
        {withNumbers ? (
          <div className="text-view__gutter">
            <div className="text-view__lines" aria-hidden>
              {lines.map((_, index) => `${index + 1}\n`).join('')}
            </div>
            <pre className="text-view__content" style={noWrapStyle}>
              {text}
            </pre>
          </div>
        ) : (
          <pre className="text-view__pre" style={noWrapStyle}>
            {text}
          </pre>
        )}
      </div>
    </ViewerFrame>
  )
}
