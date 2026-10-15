"""生成图标验收表 brand/icon-sheet.html。

把 brand/icon.png 与 brand/icon-sizes/ 下各尺寸**按原始像素**并排展示在
深色任务栏、浅色背景、以及放大视图三种上下文里，便于肉眼验收。

PNG 以 data-URI 内嵌，因此生成的文件是自包含的：双击即可打开，
不依赖相对路径，也不会被 file:// 的路径解析影响。
"""
import base64
import os
import string

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'icon-sheet.html')

# (显示名, 路径, 单元格边长)  —— 单元格按图标原始像素设定，绝不缩放
ENTRIES = [
    ('16 px', os.path.join(HERE, 'icon-sizes', 'icon-16.png'), 16),
    ('24 px', os.path.join(HERE, 'icon-sizes', 'icon-24.png'), 24),
    ('32 px', os.path.join(HERE, 'icon-sizes', 'icon-32.png'), 32),
    ('48 px', os.path.join(HERE, 'icon-sizes', 'icon-48.png'), 48),
    ('64 px', os.path.join(HERE, 'icon-sizes', 'icon-64.png'), 64),
    ('128 px', os.path.join(HERE, 'icon-sizes', 'icon-128.png'), 128),
    ('256 px', os.path.join(HERE, 'icon-sizes', 'icon-256.png'), 256),
    ('512 px', os.path.join(HERE, 'icon.png'), 512),
]


def data_uri(path):
    with open(path, 'rb') as fh:
        return 'data:image/png;base64,' + base64.b64encode(fh.read()).decode('ascii')


def main():
    rows = []
    for label, path, cell in ENTRIES:
        if not os.path.isfile(path):
            rows.append('<tr><td colspan="4" class="missing">缺失：%s</td></tr>'
                        % os.path.basename(path))
            continue
        uri = data_uri(path)
        rows.append(
            '<tr>'
            '<td class="label">%s</td>'
            '<td class="cell dark"><span style="width:%dpx;height:%dpx">'
            '<img src="%s" alt=""></span></td>'
            '<td class="cell light"><span style="width:%dpx;height:%dpx">'
            '<img src="%s" alt=""></span></td>'
            '<td class="cell page"><span style="width:%dpx;height:%dpx">'
            '<img src="%s" alt=""></span></td>'
            '</tr>' % (label, cell, cell, uri, cell, cell, uri, cell, cell, uri)
        )

    # 用 string.Template 而不是 % 格式化：下面的 CSS 里有大量 %，
    # 用 % 格式化会被当成格式符（实测直接 ValueError）。
    html = string.Template("""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>OnlyRead 应用图标验收表</title>
<style>
  body { margin:0; padding:28px 30px 60px; background:#f6f7f9; color:#1f2328;
         font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif; font-size:14px; }
  h1 { font-size:20px; margin:0 0 6px; letter-spacing:-.01em; }
  p.lede { margin:0 0 22px; color:#5b6470; max-width:80ch; line-height:1.6; }
  table { border-collapse:collapse; background:#fff; border:1px solid #e3e6ea; border-radius:10px; overflow:hidden; }
  th, td { border-bottom:1px solid #eef1f4; padding:0; }
  th { font-size:12px; font-weight:600; color:#5b6470; text-align:left; padding:10px 14px; background:#fafbfc; }
  td.label { width:72px; padding:0 14px; font-family:ui-monospace,Consolas,monospace;
             font-size:12px; color:#5b6470; white-space:nowrap; vertical-align:middle; }
  td.cell { padding:11px 0; vertical-align:middle; text-align:left; }
  /* 关键：图标必须保持原始像素。span 用 max-content + flex:none，
     否则 td 宽度由 512px 那行撑开，width:100% 会把 16px 图标拉伸到 570px。 */
  td.cell span { display:inline-flex; align-items:center; justify-content:flex-start;
                 flex:none; width:max-content; height:max-content; line-height:0; }
  td.cell img { display:block; flex:none; width:auto; height:auto; }
  td.dark  { background:#26282c; }
  td.light { background:#ffffff; }
  td.page  { background:#f6f7f9; }
  tr:last-child td { border-bottom:none; }
  .missing { padding:14px; color:#c0392b; font-size:13px; }
  .note { margin-top:20px; padding:14px 16px; background:#fff; border:1px solid #e3e6ea;
          border-radius:10px; max-width:88ch; line-height:1.65; font-size:13px; color:#3d444d; }
  .note b { color:#1f2328; }
  code { font-family:ui-monospace,Consolas,monospace; font-size:12px; background:#f2f4f7; padding:1px 4px; border-radius:3px; }
</style>
</head>
<body>
<h1>OnlyRead 应用图标验收表</h1>
<p class="lede">每一行都是该尺寸的<b>原始像素</b>（未缩放），因此这张表反映的就是它在系统里的真实观感。
请重点看 16 px 与 24 px 两行：小尺寸下唯一能站住的特征是中间那道缝。</p>

<table>
  <thead>
    <tr><th>尺寸</th><th>深色底</th><th>浅色底</th><th>页面底</th></tr>
  </thead>
  <tbody>
$rows
  </tbody>
</table>

<div class="note">
  <b>两个尺寸档（不是等比缩放）：</b><br>
  &bull; <b>≤ 32 px</b>：书宽 74%、高 62%，描边 = 书宽 17%（16 px 上 2.01 px），
    中缝 = 书宽 13.5%（1.60 px）。这一档还刻意收窄了书本，让四个页角落在圆角方块之内 ——
    早期版本书太宽，页角会从圆角处戳出四个白色尖角。<br>
  &bull; <b>≥ 48 px</b>：书宽 74%、高 67.5%，带透视收束；描边 = 书宽 9.32%，
    中缝 = 书宽 8.1%。<br>
  <b>形态是统一的</b>：两档都是描边空心书（两页 + 中缝，不画书脊），与标题栏标记同源；
  差别只在比例。必须分档的原因是描边宽度 = 比例 × 边长：若全程用大尺寸的 9.32%，
  16 px 上描边只剩 1.1 px，会被抗锯齿抹成一圈灰线。<br>
  <b>为什么不做插值：</b>中间态（缝半可见、描边半粗）恰好是最糊的形态，
  插值只会把最差观感搬到 33~47 px 上，所以切换点直接定在 48 px。
</div>
</body>
</html>
""").substitute(rows='\n'.join(rows))

    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(html)
    print('wrote %s (%d bytes, %d entries)'
          % (OUT, os.path.getsize(OUT), len(ENTRIES)))


if __name__ == '__main__':
    main()
