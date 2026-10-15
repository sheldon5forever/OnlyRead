"""生成 brand/favicon.svg：**直接复用渲染器的几何函数**，与应用图标逐像素同源。

为什么最后改成这个写法
----------------------
前面两版都是"手工用 BOOK_STROKE_SMALL 的常量再算一遍页框坐标"，两次都算错了：
第一版用"居中描边"（描边一半落在矩形外），第二版把页宽按"描边内净宽"理解。
两次的结果都是书比 icon-16.png 更宽、留白更小，16px 下能看出不一致。

根因是 make-icon.py 的描边语义和直觉写法不同：描边是**页框多边形的轮廓线**，
以多边形的边为中心线向内外各扩一半。与其继续手工推导，不如直接调用
make_icon.make_book_geometry()，让 favicon 和 PNG 用同一份几何。

因此本脚本不重新实现任何几何，只做两件事：
  1. 以 16 视口调 make_book_geometry，拿到两个页框多边形；
  2. 把它们写成 <rect> + stroke（直线边，用 rect 比 path 更短）。
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))   # = brand/
sys.path.insert(0, HERE)

import make_icon  # noqa: E402  仅本仓库模块

OUT = os.path.join(HERE, 'favicon.svg')
VIEW = 16.0


def main():
    cfg = dict(make_icon.BOOK_STROKE_SMALL)
    # 与 icon-16.png 走同一条路径：由 geometry_for_size 决定用哪一档
    cfg = make_icon.geometry_for_size(16, style='stroke')

    spine, left, right, bbox = make_icon.make_book_geometry(VIEW, cfg)
    assert spine is None, '描边档不应生成书脊'

    # 页框：多边形的点顺序是 (左上, 右上, 右下, 左下)
    (lx0, ly0), (lx1, _), _, _ = left
    (rx0, ry0), (rx1, _), _, _ = right
    top = ly0
    bottom = left[3][1]
    page_w = lx1 - lx0
    page_h = bottom - top
    stroke = VIEW * cfg['width'] * cfg['stroke']
    rx = VIEW * make_icon.CORNER_RATIO

    def f(v):
        return ('%.4f' % v).rstrip('0').rstrip('.')

    hexf = '#%02x%02x%02x' % tuple(make_icon.GRAD_FROM)
    hext = '#%02x%02x%02x' % tuple(make_icon.GRAD_TO)

    # 外轮廓与中缝，用于自检
    outer_w = bbox[2] - bbox[0]
    gap = rx0 - lx1

    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="OnlyRead">
  <!--
    OnlyRead favicon · 描边空心双栏书，与应用图标同源。
    坐标由 brand/make-favicon.py 调用 make_icon.make_book_geometry() 生成，
    与 icon-16.png 走的是同一份几何 —— 请勿手改坐标。

    16 视口（= favicon 最小显示尺寸，1 单位 = 1 像素）：
      圆角 rx = %(rx)s
      页框    %(pw)s x %(ph)s，y %(top)s ~ %(bottom)s
      左页    x %(lx0)s ~ %(lx1)s
      右页    x %(rx0)s ~ %(rx1)s    中缝 = %(gap)s
      描边    %(st)s（书宽的比例 %(stroke_pct).2f%%）
  -->
  <defs>
    <linearGradient id="mrg" x1="0" y1="0" x2="16" y2="16" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="%(hexf)s"/>
      <stop offset="1" stop-color="%(hext)s"/>
    </linearGradient>
  </defs>
  <rect width="16" height="16" rx="%(rx)s" fill="url(#mrg)"/>
  <g fill="none" stroke="#fff" stroke-width="%(st)s">
    <rect x="%(lx0)s" y="%(top)s" width="%(pw)s" height="%(ph)s"/>
    <rect x="%(rx0)s" y="%(top)s" width="%(pw)s" height="%(ph)s"/>
  </g>
</svg>
''' % {
        'rx': f(rx), 'st': f(stroke), 'stroke_pct': cfg['stroke'] * 100,
        'pw': f(page_w), 'ph': f(page_h), 'top': f(top), 'bottom': f(bottom),
        'lx0': f(lx0), 'lx1': f(lx1), 'rx0': f(rx0), 'rx1': f(rx1),
        'gap': f(gap), 'hexf': hexf, 'hext': hext,
    }

    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(svg)

    print('wrote %s' % OUT)
    print('  页框 %.2f x %.2f   左页 x %.2f~%.2f   右页 x %.2f~%.2f'
          % (page_w, page_h, lx0, lx1, rx0, rx1))
    print('  中缝 %.2f   描边 %.2f   外轮廓含描边 %.2f x %.2f (%.1f%% x %.1f%%)'
          % (gap, stroke,
             outer_w, bbox[3] - bbox[1],
             outer_w / VIEW * 100, (bbox[3] - bbox[1]) / VIEW * 100))


if __name__ == '__main__':
    main()
