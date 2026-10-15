interface Props {
  size?: number
}

/**
 * 按尺寸选描边粗细：描边图形不能等比缩放。
 * 同一个 24 viewBox 放到 16px 时 1.8 的描边只有 1.2 个物理像素（发灰发虚），
 * 放到 34px 时却有 2.55 个（比 18px 更粗更闷）。
 * 依据：brand/mark-a-check.png 的实测阶梯。
 */
function strokeFor(size: number): number {
  if (size <= 16) return 2.4
  if (size <= 24) return 2.0
  return 1.8
}

/** 应用标识：双栏书（两页向中缝折角收束） */
export function ReaderMark({ size = 18 }: Props): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeFor(size)}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M7.5 4.5v15" />
      <path d="M16.5 4.5v15" />
      <path d="M2.5 7.5h5v12h-5z" />
      <path d="M16.5 7.5h5v12h-5z" />
    </svg>
  )
}
