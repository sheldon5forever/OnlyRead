# brand/ 品牌资产索引

> **产品名**：`OnlyRead`（原名 `MetaReader`，因商标撞车改名；原因见 `设计建议.md` 第 1.4 节）。
> 所有资产已按新名更新，包括 `<svg>` 的 `title`/`aria-label`。仓库目录名仍保留 `meta-reader`。

面向接手的人：这里只说明**每个文件是什么、怎么重新生成、还差什么**。
视觉取舍与设计论证见 `设计建议.md`，本文不重复。

> **命名约定**：两个图标脚本用**下划线**（`make_icon.py` / `verify_icon.py`）而不是连字符，
> 这样它们可以被 `import` —— `make-favicon.py` 就直接复用了 `make_icon.py` 的几何函数，
> 保证 favicon 与应用图标逐像素同源。其余脚本（`make-favicon.py`、`make-icon-sheet.py`）
> 只是入口，用连字符。

## 文件清单

| 文件 | 用途 | 生成方式 |
| --- | --- | --- |
| `make_icon.py` | 应用图标**唯一**生成脚本（零依赖，自写 PNG chunk + zlib） | 手写维护 |
| `icon.png` | 512 主图 | `python brand/make_icon.py` |
| `icon-sizes/icon-{16,24,32,48,64,128,256}.png` | 各尺寸单独光栅化，供打包与文档引用 | 同上（默认连主图一起出） |
| `verify_icon.py` | 图标校验器（PNG 结构、尺寸占比、透明边界、圆角溢出） | `python brand/verify_icon.py` |
| `icon-sheet.png` / `icon-sheet.html` | 全尺寸对照表（原始像素、三种底色） | `python brand/make-icon-sheet.py` |
| `make-favicon.py` | 生成 `favicon.svg`，**复用 `make_icon.py` 的几何函数** | `python brand/make-favicon.py` |
| `favicon.svg` | 浏览器标签页图标（16 视口） | 由上面脚本产出，**勿手改坐标** |
| `icon-template.svg` | macOS 菜单栏 template image（纯黑 + 透明镂空） | 手写 SVG |
| `icon-template.png` / `icon-template@2x.png` | 上面那张的光栅化产物（22×22 / 44×44） | 手写维护，见下方"重新生成" |
| `preview.html` / `preview.png` | 4 个标记方向的对比评审页 | 手写 |
| `mark-a-check.html` / `mark-a-check.png` | 概念 A 的尺寸×描边阶梯实测 | 当时的生成脚本已随 `_check/` 清理 |
| `logos/*.svg` | 5 个标记矢量草案（A / B / C / D / D2） | 手写 |
| `ReaderMark-替换补丁.md` | 概念 A 落地到 `ReaderMark.tsx` 的补丁 | 手写 |
| `preview-vs-actual.png` | "预览页示意 ↔ 实际交付"逐尺寸对照（事故留档） | 手写 |

## 尺寸分档规则：为什么不做插值

应用图标是**描边空心**双栏书，`make_icon.py` 按边长分两档（`SMALL_ICON_MAX = 32`）：

- **≤ 32px（`BOOK_STROKE_SMALL`）**：书宽 74%、高 62%，描边 = 书宽 17%（16px 上 2.01px），
  中缝 = 书宽 13.5%（1.60px）。
- **≥ 48px（`BOOK_STROKE_LARGE`）**：书宽 74%、高 67.5%，带透视收束；描边 = 书宽 9.32%，
  中缝 = 书宽 8.1%。

两档的**形态一致**（都是两页 + 中缝，不画书脊），差别只在比例。必须分档的原因：
描边宽度 = 比例 × 边长，若全程用大尺寸的 9.32%，16px 上描边只剩 1.1px，会被抗锯齿抹成一圈灰线。

切换点取 48px 而不让两套参数**插值**，因为中间态（缝半可见、描边半粗）恰好是最糊的形态，
插值只会把最差观感搬到 33–47px 上。详见 `make_icon.py` 里 `BOOK_STROKE_SMALL` 的注释。

`ICON_STYLE = 'stroke' | 'fill'` 可切换形态：`'fill'` 是第一版的实心书本（含书脊的五段结构），
两套几何常量都保留着，便于对比或回退。

## 重新生成

```powershell
python brand/make_icon.py            # 主图 + 7 个尺寸
python brand/verify_icon.py          # 校验（应为 0 error / 0 warning）
python brand/make-favicon.py         # favicon.svg（依赖 make_icon.py 的几何）
python brand/make-icon-sheet.py      # 对照表 HTML（再用无头 Chrome 截图成 PNG）
python scripts/make-icon.py          # 装箱到 build/：icon.png + icon.ico + icon.icns
```

改了 `make_icon.py` 的几何后，必须重跑最后一行，`build/` 下的三份产物才会同步；
`icon.ico` / `icon.icns` 只是容器，内容全部来自 `brand/icon.png` 与 `brand/icon-sizes/`。

`make_icon.py` 输出的 `icon-sheet.html`、`favicon-check.html` 之类页面都是自包含的，
截图命令示例：

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu `
  --hide-scrollbars --user-data-dir="$env:TEMP\chrome-shot" --force-device-scale-factor=1 `
  --window-size=940,900 --screenshot="brand\icon-sheet.png" `
  "file:///D:/Workspaces/meta-reader/brand/icon-sheet.html"
```

`icon-template.svg` 是手写 SVG，**没有**生成脚本；改动几何后要同步三处：
SVG 本身、两张 PNG（22×22 / 44×44）、以及"中缝列 alpha 必须恒为 0"的断言口径。
注意 template image **只允许纯黑 + 透明**，出现任何灰色都会被系统当作普通图像而非模板。

## 待办与已知限制

- ✅ `build/` 下的应用图标**已替换**：`build/icon.png`（= `brand/icon.png`）、
  `build/icon.ico`（16/24/32/48/64/128/256）、`build/icon.icns`（32/64/128/256/512/1024）。
  三者由 `python scripts/make-icon.py` 从 `brand/` 资产装箱生成；ICO/ICNS 内每个尺寸
  都直接取对应的原始产物，**没有插值缩放**（1024 由 `brand/make_icon.py` 现渲染）。
- ✅ `src/renderer/index.html` **已加 favicon**：`brand/favicon.svg` 内联成 data-URI。
- ✅ `ReaderMark.tsx` 的替换补丁**已应用**（双栏书几何 + `strokeFor` 分档）。
- 应用图标的描边档**只做过 1x 渲染验收**，尚未在真实任务栏 / Dock 与打包产物上验证。
- 未验证：electron-builder 打包（图标是索引色 PNG + tRNS，Pillow 往返正常，但未跑过真实打包）。
  ICO 条目内嵌的是 PNG（Vista 及以上支持）；若要兼容更老的 Windows，需要改成 BMP/DIB。
- 改名后 Electron 的 `userData` 目录会从 `meta-reader` 变成 `onlyread`，旧目录被孤立。
  当前仍是 `0.1.0`（未发布），实际影响可忽略。
- `OnlyRead` 这个名字**只做过快速检索**（未见同名软件产品），未做正式商标检索；
  且它与 ONLYOFFICE 在"办公/文档"语境下读音接近，检索时需注意区分。
- `verify_icon.py` 的"圆角方块外必须透明"守卫曾有一个**逻辑写反**的条件（要求邻居也在外侧，
  结果成片的不透明区域整片被跳过）。已修正，当时的验证脚本（原 `brand/_check/test-outside-guard.py`）：
  真实产物仍 0 error（无假阳性），而"整张画布涂满"从漏检变为报 69 个越界像素。
- `brand/_check/` 原本是过程脚本目录（验收页生成器、对照工具、坏图测试），不属于交付物。
  已按本节说明清理，现在只保留 `设计建议.corrupted.md` 作为那次编码事故的证据。
