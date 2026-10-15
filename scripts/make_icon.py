"""生成 OnlyRead 应用图标（零第三方依赖，只用标准库）。

与 scripts/make-icon.py（旧脚本）的关系
--------------------------------------
本脚本是旧脚本的衍生版本，保留"自己写 PNG chunk + zlib 压缩"的零依赖做法，
但修掉了旧脚本的三个问题：

1. 旧脚本书本只占画布宽度 76% 却上下留白失衡、填充率低，与相邻图标并排时
   "缩一圈"。现在书本按「双栏书」重画：左右两个书页方块 + 中间书脊，
   宽度占画布 72%~76%、高度占 64%~70%，视觉重心居中。
2. 旧脚本的渐变用 `* 1.6` 硬夹取，在 t>0.625 后颜色被 max/min 截断，
   渐变右下半段是平的。现在改成平滑线性插值。
3. 旧脚本只出 512 一张图，小尺寸靠系统缩放，16px 下书脊缝会糊成白块。
   现在每个尺寸单独光栅化，并对 ≤32px 做专门优化。

用法
----
    python scripts/make_icon.py                 # 主图 brand/icon.png + 7 个尺寸
    python scripts/make_icon.py --size 1024     # 只出单张 brand/icon.png（1024）
    python scripts/make_icon.py --no-main       # 只出 brand/icon-sizes/ 里的尺寸组

输出（均为相对仓库根目录的 brand/ 资产目录）
------------------------------------------
    brand/icon.png                     默认 512x512 主图
    brand/icon-sizes/icon-{16,24,32,48,64,128,256}.png

本脚本只负责生成 PNG 资产；把它们装箱成 build/ 下的 ico / icns 由
`scripts/make-icon.py` 完成（见该脚本，或 README「打包与分发」一节）。

设计约束
--------
* 渐变 #2f7efc -> #1e4fd8（左上到右下），与 --accent 同色相，不引入新色相。
* 图形纯白 #ffffff，不放任何文字。
* 圆角半径 = 边长的 22%，图形外边距不小于边长的 12%。
* 描边空心双栏书按边长分档（≤32px / ≥48px），不做插值——理由见
  `BOOK_STROKE_SMALL` 上方的注释。
"""
import argparse
import math
import os
import struct
import sys
import zlib

# ---------------------------------------------------------------------------
# 顶层可配置常量
# ---------------------------------------------------------------------------

SIZE = 512                      # 主图边长，可用 --size 覆盖
ICON_STYLE = 'stroke'           # 'stroke' = 描边空心书（与 ReaderMark 同源）
                                # 'fill'   = 实心书本（第一版方案，保留用于对比）
SUPERSAMPLE = 3                 # 大尺寸：每轴超采样倍数（每像素 9 个样本）
SUPERSAMPLE_SMALL = 4           # ≤ SMALL_ICON_MAX 时用更高倍数，细节更干净
SMALL_ICON_MAX = 32             # "小尺寸"阈值：<= 该值走小尺寸专用几何

CORNER_RATIO = 0.22             # 圆角半径 / 边长

# 背景对角线渐变：左上 -> 右下
GRAD_FROM = (0x2f, 0x7e, 0xfc)  # #2f7efc，品牌蓝
GRAD_TO = (0x1e, 0x4f, 0xd8)    # #1e4fd8，品牌蓝深

BOOK_COLOR = (0xff, 0xff, 0xff)  # 书本纯白，不透明
SPINE_SLOPE = 0.148          # 水平书脊线相对透视收束的高度偏移（视口单位）

# 书本几何（100x100 视口，x 向右、y 向下），坐标可自由调整。
# width 决定书本占画布宽度的比例；height 由页高 + 透视收束共同决定。
BOOK_LARGE = {
    'width': 0.76,           # 大尺寸：占画布宽度 76%
    'height': 0.6746,        # 页高，合成后总高度 67.5%（落在 64%~70%）
    'spine_w': 0.0587,       # 书脊宽：76 * 0.0587 ≈ 4.46 视口单位
    'gutter': 0.0263,        # 页与书脊的细缝：76 * 0.0263 ≈ 2.0 视口单位
}

# 小尺寸专用几何（关键优化，两轮实测的结论）
# --------------------------------------------------------------------------
# 第一版照搬大尺寸的"页–缝–书脊–缝–页"五段结构，只把缝和书脊按比例放大。
# 16px 实测：缝约 1.15px、书脊 1.54px，两条缝被抗锯齿抹成灰白糊边，
# 整枚图标退化成一块蓝白斑块，完全读不出"书"。
#
# 第二版改成"书脊不画、用背景当缝"：两页在中线相接、中间露出背景蓝。
# 16px 实测：缝只有 1.25px，而且它是"白色形状内部的一道蓝"，没有对比度，
# 看上去仍是一个白块 —— 小尺寸下**缝必须够宽**才成立，1px 级的缝没救。
#
# 最终方案：gutter 放大到书宽的 14%，spine_w=0（不画书脊）。于是背景蓝
# 在书本正中露出一道实缝：
#   * 16px: 书宽 74 * 0.16 = 11.84px，缝 11.84 * 0.14 ≈ 1.66px，每页约 5.1px
#   * 24px: 缝 ≈ 2.5px
# 书宽降到 74%、高降到 0.62 是为了让四个页角收进圆角方块之内（第一版 78%/65%
# 时页角会从圆角处戳出四个白色尖角，同样在 16px 实测中发现）。
BOOK_SMALL = {
    'width': 0.74,           # 74%：既要撑满，又要把页角收进圆角
    'height': 0.620,         # 62%：页角不越界，保持横长页形
    'spine_w': 0.0,          # 小尺寸不画书脊，缝由背景直接露出
    'gutter': 0.14,          # 实缝：书宽的 14%，16px 上约 1.66px
    'slope': 0.10,           # 轻微收束，保留"翻开的书"的顶边折角
}

# 调色板量化：渐变共 GRADIENT_LEVELS^2 个对角采样 + 纯白 + 全透明。
# 用索引色（色彩类型 3）而不是旧脚本的真彩色（类型 6），有两个好处：
#   * 抗锯齿边缘的过渡色在调色板里一定存在，不会出现"灰边"；
#   * 文件更小（16px 图标尤其明显）。
# 代价：颜色被量化到 GRADIENT_LEVELS 级，最大偏差约 QUANT_STEP/2 —— 相对
# 76 视口单位的渐变跨度完全不可见。
#
# 上限是硬约束：PNG 调色板最多 256 项，且索引以字节存放，所以
# GRADIENT_LEVELS^2 + 2 <= 256，即 GRADIENT_LEVELS <= 15。
# 14 级 => 196 + 2 = 198 项，留有余量。
GRADIENT_LEVELS = 14
QUANT_STEP = 255 // (GRADIENT_LEVELS - 1)   # = 19

DEFAULT_SIZES = (16, 24, 32, 48, 64, 128, 256)

# ---------------------------------------------------------------------------
# 描边（空心）档 —— 与标题栏标记 ReaderMark 同源的形态
# ---------------------------------------------------------------------------
# 设计目标：应用图标用**描边空心书**，和标题栏里的标记是同一套形态语言，
# 而不是"描边标记 + 实心图标"两套观感。
#
# preview.html 里那两枚示意用的就是描边书（27px / 70px 的 24-viewBox SVG 塞进
# 渐变方块，占方块 56%）。那里描边 = 1.8/24 = 方块的 7.5%。真做成图标要把书
# 放大到 ~74%，描边就得等比缩小以维持同样的"视觉粗细/方块"比例。
#
# 物理约束（决定必须分档，不能一套参数走到底）：
#   描边宽度(px) = ratio * size。要让空心可见，中缝空隙必须 >= ~1.5px。
#   而两页之间的空隙 = 书宽 - 2*描边 - 2*页宽。书宽 ≈ 0.74*size。
#     16px: 0.74*16 = 11.84px。若描边 7.5% -> 1.2px，两页各 1.5px 宽。
#           中缝 3.6px —— 但 1.2px 的描边本身只有 ~0.6 的覆盖率，会糊成灰线，
#           读出来是"三条细线"而不是"两页"。所以小尺寸必须把描边加粗。
#     512px: 7.5% 的描边 = 38px，相对 24 视口 = 1.8 视口单位，视觉偏粗，
#           大尺寸要适当收细。
# 结论：形态统一（描边空心），描边比例按尺寸分档 —— 这正是"光学尺寸"的做法，
# 和 ReaderMark 按 size 调 strokeWidth 是同一个道理。
BOOK_STROKE_SMALL = {
    'width': 0.74,           # 与实心小档同宽，保持外轮廓一致
    'height': 0.62,
    'gutter': 0.135,         # 中缝：书宽的 13.5%，16px 上 ≈ 1.60px / 方块 10%
    'slope': 0.10,
    'stroke': 0.170,         # 描边：书宽的 17% -> 16px 上 ≈ 2.01px
}

BOOK_STROKE_LARGE = {
    'width': 0.74,
    'height': 0.6746,
    'gutter': 0.081,         # 中缝：书宽的 8.1%，512px 上 ≈ 30.7px / 方块 6.0%
    'slope': 0.148,
    'stroke': 0.0932,        # 描边：书宽的 9.32% -> 512px 上 ≈ 35.3px
}
HERE = os.path.dirname(os.path.abspath(__file__))
# 本脚本位于 scripts/，图标资产目录在仓库根目录的 brand/
BRAND_DIR = os.path.normpath(os.path.join(HERE, os.pardir, 'brand'))
DEFAULT_MAIN_PATH = os.path.join(BRAND_DIR, 'icon.png')
DEFAULT_SIZES_DIR = os.path.join(BRAND_DIR, 'icon-sizes')


# ---------------------------------------------------------------------------
# 几何工具
# ---------------------------------------------------------------------------

def in_rounded_rect(x, y, size, radius):
    """点 (x, y) 是否落在 size x size、圆角半径 radius 的圆角方块内。"""
    if x < 0.0 or y < 0.0 or x >= size or y >= size:
        return False
    # 把点夹到圆心可移动的范围内，再判距；中心区域 cx==x、cy==y，距离恒为 0。
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= radius * radius


def in_polygon(x, y, points):
    """射线法判断点是否在多边形内（含边界的处理对图标足够）。"""
    inside = False
    n = len(points)
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xt = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < xt:
                inside = not inside
    return inside


def geometry_for_size(size, override=None, style=ICON_STYLE):
    """按输出尺寸取书本几何参数。

    两套几何是**结构性差异**而不是同一形态的缩放：
      * 实心档（style='fill'）：「页–缝–书脊–缝–页」五段结构。
      * 描边档（style='stroke'）：只有两页 + 中间空隙（不画书脊），
        形态与标题栏标记 ReaderMark 同源。

    两者都在 SMALL_ICON_MAX 处**直接切换**而不插值：中间态（缝半可见、
    书脊半宽）恰好是最糊的形态，插值只会把最差的观感搬到 33~47px 上。
    切换点定在 48px：那里 2.0 视口单位的缝已有约 0.9px，看得见了。
    """
    if override:
        cfg = dict(BOOK_LARGE)
        cfg.update(override)
        return cfg
    if style == 'stroke':
        return (dict(BOOK_STROKE_SMALL) if size <= SMALL_ICON_MAX
                else dict(BOOK_STROKE_LARGE))
    return dict(BOOK_SMALL) if size <= SMALL_ICON_MAX else dict(BOOK_LARGE)


def make_book_geometry(view, cfg, slope=None):
    """按配置生成书本多边形 + 外接盒。

    返回 (spine, left_page, right_page, bbox)。三块几何按绘制顺序排列，
    因为后面用「首个命中的多边形」来决定颜色，不依赖多边形互相覆盖。

    两种用法：
      * 实心档（BOOK_* 提供 spine_w / gutter）：返回「左页 + 书脊 + 右页」三块。
      * 描边档（BOOK_STROKE_* 提供 stroke，见 geometry_for_size）：返回
        「左页 + 右页」两块，**故意不生成书脊** —— 页与页之间留出的空隙
        本身就是那道中缝，也正是描边观感的关键（和 preview 的示意一致）。
    """
    w = view * cfg['width']
    h = view * cfg['height']
    x0 = (view - w) / 2.0
    y0 = (view - h) / 2.0
    x1 = x0 + w
    y1 = y0 + h

    spine_w = w * cfg.get('spine_w', 0.0)
    gutter = w * cfg.get('gutter', 0.0)
    cx = view / 2.0
    # 书脊左右两侧各留一道 gutter，把两个书页和书脊分开
    spine_l = cx - spine_w / 2.0
    spine_r = cx + spine_w / 2.0
    left_r = spine_l - gutter
    right_l = spine_r + gutter

    if slope is None:
        slope = cfg.get('slope', SPINE_SLOPE)

    # 透视收束：水平书脊线在中间最高、往两侧各下沉 slope 个单位，
    # 让两个书页呈"略微向内翻开"的感觉（不用浮点三角函数，纯线性）。
    def lift(x):
        if slope == 0.0:
            return 0.0
        return slope * (1.0 - abs(x - cx) / (w / 2.0))

    left_page = (
        (x0, y0 + lift(x0)),
        (left_r, y0 + lift(left_r)),
        (left_r, y1),
        (x0, y1),
    )
    right_page = (
        (right_l, y0 + lift(right_l)),
        (x1, y0 + lift(x1)),
        (x1, y1),
        (right_l, y1),
    )

    if cfg.get('stroke'):
        # 描边档：只有两页。bbox 要含描边向外的一半，否则外接盒快速排除
        # 会把描边的外沿切掉（那正是"空心"能不能看出来的关键区域）。
        half = cfg['stroke'] / 2.0
        top = y0 + max(lift(x) for x in (x0, left_r))
        bbox = (x0 - half, top - half, x1 + half, y1 + half)
        return None, left_page, right_page, bbox

    spine = (
        (spine_l, y0 + lift(spine_l)),
        (spine_r, y0 + lift(spine_r)),
        (spine_r, y1),
        (spine_l, y1),
    )

    top = y0 + max(lift(x) for x in (x0, left_r, spine_l, spine_r, right_l, x1))
    bbox = (x0, top, x1, y1)
    return spine, left_page, right_page, bbox


def polygon_bbox(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


# ---------------------------------------------------------------------------
# 调色板
# ---------------------------------------------------------------------------

def gradient_rgba(t):
    """对角渐变的平滑线性插值：t=0 取 GRAD_FROM，t=1 取 GRAD_TO。

    旧脚本写的是 `74 + (47-74) * t * 1.6` 再 max/min 夹取，t 超过 0.625 之后
    结果被截断，渐变后半段是死平的。这里直接插值，全程连续。
    """
    t = min(max(t, 0.0), 1.0)
    return tuple(
        int(round(a + (b - a) * t)) for a, b in zip(GRAD_FROM, GRAD_TO)
    )


def build_palette():
    """索引色调色板：渐变背景 + 纯白 + 全透明。

    返回 (palette_rgba, white_index)。总项数必须 <= 256：PNG 的 PLTE 上限是
    256 项，而且 build_lookup 用 bytearray 存索引（单字节 0..255）。
    """
    palette = []
    for i in range(GRADIENT_LEVELS):
        for j in range(GRADIENT_LEVELS):
            # i 走 x 方向、j 走 y 方向，合成对角线参数 t
            t = (i + j) / (2.0 * (GRADIENT_LEVELS - 1))
            r, g, b = gradient_rgba(t)
            palette.append((quantize(r), quantize(g), quantize(b), 255))

    white_index = len(palette)
    palette.append((255, 255, 255, 255))          # 书本纯白
    palette.append((0, 0, 0, 0))                  # 圆角外全透明
    if len(palette) > 256:
        raise ValueError(
            'palette has %d entries, max 256 (PNG PLTE limit and byte indices); '
            'lower GRADIENT_LEVELS' % len(palette)
        )
    return palette, white_index


def quantize(v):
    """把 0..255 量化到 16 级中心值（0,17,...,255）。"""
    return min(255, max(0, int(round(v / QUANT_STEP)) * QUANT_STEP))


def _weighted_sqdist(c1, c2, wa):
    """调色板选色用的加权色距。

    alpha 权重远大于颜色权重是刻意的：渐变本身是蓝色的低饱和变化，
    如果按普通欧氏距离，"暗蓝且半透明"会比"白且几乎不透明"更接近书本的
    抗锯齿边缘像素，结果就是白书页周围出现灰蓝色脏边。加大 alpha 权重后，
    alpha 成为选色的主导项，颜色只在 alpha 相近的候选里做微调。
    """
    dr = c1[0] - c2[0]
    dg = c1[1] - c2[1]
    db = c1[2] - c2[2]
    da = c1[3] - c2[3]
    return dr * dr + dg * dg + db * db + wa * da * da


_PALETTE_CACHE = None


def get_palette():
    """调色板和查找表与输出尺寸无关，构建一次即可反复使用。"""
    global _PALETTE_CACHE
    if _PALETTE_CACHE is None:
        palette, white_index = build_palette()
        _PALETTE_CACHE = (palette, white_index, build_lookup(palette))
    return _PALETTE_CACHE


def build_lookup(palette, alpha_weight=64.0):
    """预计算 (r>>4, g>>4, b>>4, a>>4) -> 调色板索引 的查找表。

    16^4 = 65536 项，一次构建反复使用；每个像素最多一次查表，
    避免了逐像素扫描 258 色调色板的开销。
    """
    table = bytearray(65536)
    for r in range(16):
        for g in range(16):
            for b in range(16):
                for a in range(16):
                    key = (r << 12) | (g << 8) | (b << 4) | a
                    if a == 0:
                        table[key] = len(palette) - 1     # 全透明槽位
                        continue
                    probe = (r << 4 | r, g << 4 | g, b << 4 | b, a << 4 | a)
                    best_i = 0
                    best_d = None
                    for i, entry in enumerate(palette):
                        d = _weighted_sqdist(probe, entry, alpha_weight)
                        if best_d is None or d < best_d:
                            best_d = d
                            best_i = i
                    table[key] = best_i
    return table


# ---------------------------------------------------------------------------
# 光栅化
# ---------------------------------------------------------------------------

def render_icon(size, override_geometry=None, style=ICON_STYLE):
    """把图标光栅化成索引色像素，返回 (indices, width, height, palette, white_index)。

    每个像素独立光栅化（不做"先画 512 再缩小"），保证小尺寸是单独优化的结果。
    边缘用固定总样本数的超采样做抗锯齿：累加值除以总样本数（而不是命中数），
    于是圆角方块和书本的外沿 alpha 会自然从 255 平滑过渡到 0，没有硬边或灰边。
    """
    cfg = geometry_for_size(size, override_geometry, style)
    ss = SUPERSAMPLE_SMALL if size <= SMALL_ICON_MAX else SUPERSAMPLE
    view = 100.0            # 书本几何使用 100x100 视口
    # 透视收束量由几何配置决定：小尺寸用 0（顶边水平），大尺寸用 SPINE_SLOPE。
    slope = cfg.get('slope', SPINE_SLOPE)
    spine, left, right, _bbox = make_book_geometry(view, cfg, slope)
    polygons = (left, right, spine) if spine is not None else (left, right)
    boxes = [polygon_bbox(p) for p in polygons]

    # 描边档：书本的画法是"多边形的轮廓线"，而不是填充多边形本身。
    half_stroke = None
    if cfg.get('stroke'):
        half_stroke = view * cfg['width'] * cfg['stroke'] / 2.0

    radius = view * CORNER_RATIO
    step = view / size          # 一个像素在视口单位下的边长
    total = ss * ss

    def in_book(vx, vy, cx, cy):
        """该点是否应当取"书本色"（白）。描边档判距离，实心档判内外。"""
        if half_stroke is None:
            return point_in_book(vx, vy, polygons, boxes)
        d = dist_to_outline(vx, vy, polygons, boxes)
        return d is not None and d <= half_stroke

    palette, white_index, lookup = get_palette()

    indices = bytearray(size * size)
    for py in range(size):
        row_off = py * size
        for px in range(size):
            acc_r = acc_g = acc_b = acc_a = 0
            for sy in range(ss):
                vy = (py + (sy + 0.5) / ss) * step
                for sx in range(ss):
                    vx = (px + (sx + 0.5) / ss) * step
                    if not in_rounded_rect(vx, vy, view, radius):
                        continue        # 圆角外：不计入，等于全透明
                    # 渐变参数：对角线投影，左上 0 -> 右下 1
                    t = 0.5 * (vx / view) + 0.5 * (vy / view)
                    cr, cg, cb = gradient_rgba(t)
                    if in_book(vx, vy, px, py):
                        cr, cg, cb = BOOK_COLOR
                    acc_r += cr
                    acc_g += cg
                    acc_b += cb
                    acc_a += 255

            # 除以总样本数（不是命中样本数）：边缘自然得到 alpha 过渡。
            samples = total
            # 中心点补正：细缝/圆角在小尺寸下比采样格还窄，可能整格都没采到，
            # 那样边缘会退化成硬边（出现锯齿）。若像素中心确实在图形内，
            # 就至少记一次"虚拟样本"，把这列像素从 0 拉到可见的 1/ss²。
            cxf = (px + 0.5) * step
            cyf = (py + 0.5) * step
            if acc_a == 0 and in_rounded_rect(cxf, cyf, view, radius):
                samples = total + 1
                acc_a = 255
                if in_book(cxf, cyf, px, py):
                    acc_r, acc_g, acc_b = BOOK_COLOR
                else:
                    t = 0.5 * (cxf / view) + 0.5 * (cyf / view)
                    acc_r, acc_g, acc_b = gradient_rgba(t)

            r = acc_r // samples
            g = acc_g // samples
            b = acc_b // samples
            a = acc_a // samples
            if a == 0:
                indices[row_off + px] = len(palette) - 1
            else:
                key = ((r >> 4) << 12) | ((g >> 4) << 8) | ((b >> 4) << 4) | (a >> 4)
                indices[row_off + px] = lookup[key]
    return indices, size, size, palette, white_index


def point_in_book(vx, vy, polygons, boxes):
    """点是否落在书本（任意一块）内部，先用外接盒快速排除。"""
    for i, poly in enumerate(polygons):
        x0, y0, x1, y1 = boxes[i]
        if vx < x0 or vx > x1 or vy < y0 or vy > y1:
            continue
        if in_polygon(vx, vy, poly):
            return True
    return False


def dist_point_segment(px, py, ax, ay, bx, by):
    """点到线段的距离（平方根形式，调用方按需比较）。"""
    dx = bx - ax
    dy = by - ay
    if dx == 0.0 and dy == 0.0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    if t < 0.0:
        t = 0.0
    elif t > 1.0:
        t = 1.0
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def dist_to_outline(vx, vy, polygons, boxes):
    """点到任意一块多边形**边界**的最小距离。

    描边档用它来判断"这个点是否落在描边上"：描边 = 多边形的轮廓线，
    宽度 half_w 向内外各扩一半。这比"先求内缩多边形再判内外"稳健得多 ——
    内缩多边形在窄边处会自交，而距离场不会。
    """
    best = None
    for i, poly in enumerate(polygons):
        x0, y0, x1, y1 = boxes[i]
        # 外接盒要放宽 half_w（已在 make_book_geometry 里放宽过），
        # 这里只做粗筛，宁可多算也不能漏。
        if vx < x0 or vx > x1 or vy < y0 or vy > y1:
            continue
        n = len(poly)
        for j in range(n):
            ax, ay = poly[j]
            bx, by = poly[(j + 1) % n]
            d = dist_point_segment(vx, vy, ax, ay, bx, by)
            if best is None or d < best:
                best = d
    return best


# ---------------------------------------------------------------------------
# PNG 编码（自己写 chunk，沿用旧脚本的做法）
# ---------------------------------------------------------------------------

def chunk(tag, data):
    return (
        struct.pack('>I', len(data))
        + tag
        + data
        + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def encode_indexed_png(indices, width, height, palette, compression=9):
    """把索引色像素编码成 PNG（色彩类型 3 + tRNS）。

    每行前面是 filter byte 0（无滤波）：图标里横向相邻像素差异本来就小，
    用 zlib 压缩已经够；手写 Sub/Up/Paeth 只会增加出错面。
    """
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw += indices[y * width:(y + 1) * width]

    plte = b''.join(bytes(entry[:3]) for entry in palette)
    # tRNS 按调色板顺序给出每个索引的 alpha；末尾的 255/0 可以省略；
    # 但显式写入最直观，最大 256 字节。
    trns = bytes(entry[3] for entry in palette)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 3, 0, 0, 0))
    png += chunk(b'sRGB', b'\x00')          # 渲染意图：perceptual
    png += chunk(b'PLTE', plte)
    png += chunk(b'tRNS', trns)
    png += chunk(b'IDAT', zlib.compress(bytes(raw), compression))
    png += chunk(b'IEND', b'')
    return png


_MADE_DIRS = set()


def write_icon(path, size):
    indices, w, h, palette, _white = render_icon(size)
    data = encode_indexed_png(indices, w, h, palette)
    parent = os.path.dirname(os.path.abspath(path))
    if parent not in _MADE_DIRS:
        os.makedirs(parent, exist_ok=True)
        _MADE_DIRS.add(parent)
    with open(path, 'wb') as fh:
        fh.write(data)
    return len(data)


def describe_geometry(size, style=ICON_STYLE):
    """打印实际使用的书本几何参数与占比，方便核对外轮廓占比。

    必须走 geometry_for_size，否则拿到的参数会和渲染时实际用的不一致。
    描边档没有书脊（spine 为 None），改报"描边宽度"与"中缝宽度"。
    """
    cfg = geometry_for_size(size, style=style)
    spine, left, right, bbox = make_book_geometry(100.0, cfg)
    if spine is None:
        stroke_u = 100.0 * cfg['width'] * cfg['stroke']
        # 中缝 = 左页右边界 到 右页左边界 的净空
        gap_u = right[0][0] - left[1][0]
        return (
            'x {:.1f}~{:.1f} ({:.1f}%)  y {:.1f}~{:.1f} ({:.1f}%)  '
            'stroke {:.2f}u ({:.2f}px)  gap {:.2f}u ({:.2f}px)'.format(
                bbox[0], bbox[2], bbox[2] - bbox[0],
                bbox[1], bbox[3], bbox[3] - bbox[1],
                stroke_u, stroke_u * size / 100.0,
                gap_u, gap_u * size / 100.0,
            )
        )
    return (
        'x {:.1f}~{:.1f} ({:.1f}%)  y {:.1f}~{:.1f} ({:.1f}%)  '
        'spine {:.2f}u ({:.2f}px)  gutter {:.2f}u ({:.2f}px)'.format(
            bbox[0], bbox[2], bbox[2] - bbox[0],
            bbox[1], bbox[3], bbox[3] - bbox[1],
            spine[1][0] - spine[0][0],
            (spine[1][0] - spine[0][0]) * size / 100.0,
            spine[0][0] - left[1][0],
            (spine[0][0] - left[1][0]) * size / 100.0,
        )
    )


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description='生成 OnlyRead 应用图标（零第三方依赖）。',
    )
    parser.add_argument(
        '--size', type=int, default=SIZE,
        help='主图边长，默认 %d' % SIZE,
    )
    parser.add_argument(
        '--out', default=DEFAULT_MAIN_PATH,
        help='主图输出路径，默认 brand/icon.png',
    )
    parser.add_argument(
        '--sizes-dir', default=DEFAULT_SIZES_DIR,
        help='多尺寸输出目录，默认 brand/icon-sizes',
    )
    parser.add_argument(
        '--sizes', default=','.join(str(s) for s in DEFAULT_SIZES),
        help='多尺寸列表，逗号分隔，默认 %s' % ','.join(str(s) for s in DEFAULT_SIZES),
    )
    parser.add_argument(
        '--no-main', action='store_true',
        help='不生成主图',
    )
    parser.add_argument(
        '--no-sizes', action='store_true',
        help='不生成多尺寸组',
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    if args.size < 8:
        print('--size 至少为 8', file=sys.stderr)
        return 2

    written = []
    if not args.no_main:
        n = write_icon(args.out, args.size)
        written.append((args.out, args.size, n))
        print('{:<40} {:>4}px {:>8} bytes'.format(
            os.path.relpath(args.out, HERE), args.size, n))

    if not args.no_sizes:
        sizes = [int(s) for s in str(args.sizes).split(',') if s.strip()]
        for s in sizes:
            path = os.path.join(args.sizes_dir, 'icon-%d.png' % s)
            n = write_icon(path, s)
            written.append((path, s, n))
            print('{:<40} {:>4}px {:>8} bytes   [{}]'.format(
                os.path.relpath(path, HERE), s, n, describe_geometry(s)))

    print('\n共生成 %d 个文件：' % len(written))
    for path, size, n in written:
        print('  %-46s %4dpx %7d bytes' % (path, size, n))
    return 0


if __name__ == '__main__':
    # Windows 控制台默认编码可能不是 UTF-8，出错时不要让中文 print 崩溃
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    sys.exit(main())
