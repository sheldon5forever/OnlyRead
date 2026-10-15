import { useEffect, useRef, useState } from 'react'
import { Check, MoveHorizontal } from 'lucide-react'
import { DOC_WIDTH_OPTIONS, docWidthLabel, type DocWidth } from '@renderer/lib/docWidth'

interface Props {
  value: DocWidth
  onChange: (width: DocWidth) => void
}

/** 工具条上的「排版宽度」切换按钮 */
export function DocWidthMenu({ value, onChange }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="toolbar-menu" ref={rootRef}>
      <button
        type="button"
        className={`viewer__control${value === 'comfortable' ? '' : ' is-on'}`}
        title={`排版宽度：${docWidthLabel(value)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MoveHorizontal size={13} />
        <span className="viewer__control-label">{docWidthLabel(value)}</span>
      </button>

      {open ? (
        <div className="toolbar-menu__panel" role="menu">
          <div className="toolbar-menu__label">排版宽度</div>
          {DOC_WIDTH_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={value === option.value}
              className="toolbar-menu__item"
              title={option.hint}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              <span className="toolbar-menu__item-text">
                <span className="toolbar-menu__item-title">{option.label}</span>
                <span className="toolbar-menu__item-hint">{option.hint}</span>
              </span>
              {value === option.value ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
