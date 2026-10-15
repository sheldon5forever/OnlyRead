# ReaderMark 替换补丁（概念 A · 双栏书）

> 状态：**已应用** —— `src/renderer/src/components/ReaderMark.tsx` 已按本补丁更新（几何 + `strokeFor` 分档）。
> 决策依据：使用者已选定方向 A；几何与 `brand/logos/concept-a-double-page.svg` 完全一致。

---

## 1. 现状

`src/renderer/src/components/ReaderMark.tsx` 当前是一本"翻开的书"（曲线书页 + 竖直线脊），
被两处调用：

| 调用点 | 尺寸 | 上下文 |
| --- | --- | --- |
| `src/renderer/src/components/TitleBar.tsx:98` | 18px | 深色标题栏（`#26282c`），前景 `#d6d8dc` |
| `src/renderer/src/components/Welcome.tsx:21` | 34px | 浅色页面（`#ffffff`），前景 `#1f2328` |

组件本身的机制是**正确且必须保留**的：尺寸由调用方通过 `size` 传入、颜色走
`stroke="currentColor"`（因此在深色标题栏与浅色欢迎页上能自动反色）、带 `aria-hidden`。
本次只换几何与描边策略。

---

## 2. 建议改动

把 `ReaderMark.tsx` 整体替换为：

```tsx
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
```

### 改动点逐条

1. **几何**：4 条 path 全部替换（`concept-a-double-page.svg` 的原样搬运）。
   两条竖线是两页的折角边，两个方框是两页内缘，中线处留 1 单位空隙形成中缝。
2. **新增 `strokeFor()`**：这是本次唯一的行为变化。若你希望改动最小化，
   也可以先只换 path、保留固定 `1.8`，验证观感后再加这个函数。
3. **其余全部不动**：props 签名、默认值 `18`、`aria-hidden`、根 `<svg>` 上的描边属性
   （概念 A 的 SVG 文件把描边放在 `<g>` 上，搬进组件时要提回根节点 —— 组件现有写法就是对的）。
4. **两处调用点无需修改**：18px 与 34px 都能直接工作。

---

## 3. 验收方式

```
brand/mark-a-check.html      # 打开就能看：16/18/20/24/34/64px × stroke 1.8/2.0/2.4 × 浅深双底
brand/mark-a-check.png       # 同上，已渲染好的截图
```

改完代码后建议实际跑 `npm run dev`，在**深色标题栏**里看 18px 那一格，
以及在**欢迎页**看 34px 那一格——这两处的底色差异是 `currentColor` 机制能否成立的现场验证。

---

## 4. 已知限制

- 本页实测都是 **1x** 渲染。高 DPI（2x）下 16px 有 32 个物理像素可用，
  1.8 的描边也能落在 2.4 个物理像素上，粗细观感会比 1x 更接近大尺寸档。
  如果你主要在 2x 屏上开发，`strokeFor` 的阈值可以整体调低一档。
- `strokeFor` 只按 `size` 判断，没有考虑 `devicePixelRatio`。
  若要做到像素级精确，需要读 `window.devicePixelRatio`，但那会让组件依赖渲染环境，
  对图标来说不值得 —— 建议保持当前这种纯 `size` 的简单策略。
- 概念 A 与"应用图标"并非同一套几何：应用图标用的是**实心**双栏书（含渐变底、书脊、透视收束），
  标记用的是**描边**双栏书。两者的共同语言是"两页 + 中缝"，这是刻意的：
  小尺寸用实心、大尺寸用描边，是同一母题在两种技术约束下的解，不是不一致。
