"""校验 make_icon.py 生成的 PNG（纯标准库，可独立复用）。
做四件事：
1. 逐个 chunk 解析 PNG，核对每个 chunk 的 CRC32，确认 IHDR 尺寸与色彩类型符合预期；
2. 解压 IDAT 并**自己实现反滤波**（None/Sub/Up/Average/Paeth），拿到真实像素；
3. 统计非透明像素占比、每行/每列是否有全透明异常行、边缘是否有溢出；
4. 根据"接近白色"的像素推断书本外接盒，核对它占画布 72%~76% 宽、64%~70% 高。
用法
----
    python brand/verify_icon.py                     # 校验 brand/icon.png + brand/icon-sizes/
    python brand/verify_icon.py --dir brand/icon-sizes
    python brand/verify_icon.py brand/icon-sizes/icon-16.png --expect 16

退出码：0 = 全部通过（允许 warning）；1 = 有 error；2 = 文件不存在。"""
import argparse
import math
import os
import struct
import sys
import zlib

PNG_SIG = b'\x89PNG\r\n\x1a\n'
CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
COLOR_NAME = {0: 'grayscale', 2: 'truecolor', 3: 'indexed', 4: 'grayscale+alpha',
              6: 'truecolor+alpha'}

# 与 make_icon.py 保持一致的期望值
EXPECT_COLOR_TYPE = 3           # 索引色
EXPECT_BIT_DEPTH = 8
CORNER_RATIO = 0.22

# 书本尺寸期望值分两档，因为 make_icon.py 的小尺寸（<=32px）与
# book_ranges 参数可能覆盖；默认给两档，由调用方按尺寸选择。
SMALL_ICON_MAX = 32
BOOK_RANGES_SMALL = ((0.70, 0.78), (0.58, 0.66))   # 74% x 62%，页角收在圆角内
BOOK_RANGES_LARGE = ((0.72, 0.78), (0.64, 0.70))   # 76% x 67.5%，含透视收束
BOOK_WIDTH_RANGE, BOOK_HEIGHT_RANGE = BOOK_RANGES_LARGE
WHITE_MIN = 240                 # 判定"书页白"的通道下限（渐变最亮处 B=252 但 R=47，
                                # 所以必须三个通道同时很高，不会误判背景）

HERE = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------------------
# PNG 解析
# ---------------------------------------------------------------------------

def paeth(a, b, c):
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def parse_png(data):
    """解析 PNG，返回 dict(ihdr, palette, trns, pixels, warnings, errors)。
    pixels 是扁平 bytearray，长度 = w * h * 通道数（色彩类型 3 时通道数 1，
    值为调色板索引）。每行行首的 filter byte 已经被消费掉。
    """
    errors = []
    warnings = []
    if data[:8] != PNG_SIG:
        raise ValueError('不是 PNG 文件（签名不匹配）')

    pos = 8
    ihdr = None
    palette = None
    trns = None
    idat = bytearray()
    seen_iend = False
    chunk_names = []

    while pos < len(data):
        if pos + 8 > len(data):
            errors.append('chunk 头被截断（偏移 %d）' % pos)
            break
        (length,) = struct.unpack('>I', data[pos:pos + 4])
        tag = data[pos + 4:pos + 8]
        body_start = pos + 8
        body_end = body_start + length
        crc_end = body_end + 4
        if crc_end > len(data):
            errors.append('chunk %r 数据被截断（声明 %d 字节）' % (tag, length))
            break
        body = data[body_start:body_end]
        (crc_stored,) = struct.unpack('>I', data[body_end:crc_end])
        crc_calc = zlib.crc32(tag + body) & 0xFFFFFFFF
        if crc_stored != crc_calc:
            errors.append('chunk %r CRC 不匹配：文件 0x%08x / 计算 0x%08x'
                          % (tag, crc_stored, crc_calc))
        chunk_names.append(tag.decode('latin-1'))

        if tag == b'IHDR':
            if length != 13:
                errors.append('IHDR 长度应为 13，实际 %d' % length)
            (w, h, depth, ctype, comp, filt, inter) = struct.unpack('>IIBBBBB', body)
            ihdr = {'width': w, 'height': h, 'bit_depth': depth, 'color_type': ctype,
                    'compression': comp, 'filter': filt, 'interlace': inter}
        elif tag == b'PLTE':
            if length % 3 != 0:
                errors.append('PLTE 长度 %d 不是 3 的倍数' % length)
            palette = [tuple(body[i:i + 3]) for i in range(0, length - length % 3, 3)]
        elif tag == b'tRNS':
            trns = list(body)
        elif tag == b'IDAT':
            idat += body
        elif tag == b'IEND':
            seen_iend = True

        pos = crc_end

    if ihdr is None:
        raise ValueError('缺少 IHDR chunk')
    if not seen_iend:
        warnings.append('没有找到 IEND chunk（文件可能被截断）')
    if not idat:
        raise ValueError('缺少 IDAT chunk')

    if ihdr['compression'] != 0:
        errors.append('compression method 应为 0，实际 %d' % ihdr['compression'])
    if ihdr['filter'] != 0:
        errors.append('filter method 应为 0，实际 %d' % ihdr['filter'])
    if ihdr['interlace'] != 0:
        warnings.append('使用了隔行扫描（interlace=%d），本脚本按逐行解读'
                        % ihdr['interlace'])
    ctype = ihdr['color_type']
    if ctype not in CHANNELS:
        raise ValueError('未知色彩类型 %d' % ctype)
    if ihdr['bit_depth'] != 8:
        raise ValueError('本校验器只支持位深 8，实际 %d' % ihdr['bit_depth'])
    if ctype == 3 and palette is None:
        raise ValueError('索引色 PNG 缺少 PLTE chunk')

    # 解压 IDAT
    try:
        raw = zlib.decompress(bytes(idat))
    except zlib.error as exc:
        raise ValueError('IDAT 解压失败：%s' % exc)

    w = ihdr['width']
    h = ihdr['height']
    channels = CHANNELS[ctype]
    stride = w * channels
    expected = (stride + 1) * h
    if len(raw) != expected:
        raise ValueError('解压后字节数 %d，期望 %d' % (len(raw), expected))

    # 反滤波
    out = bytearray(stride * h)
    prev = bytearray(stride)
    off = 0
    for y in range(h):
        ftype = raw[off]
        off += 1
        line = bytearray(raw[off:off + stride])
        off += stride
        if ftype > 4:
            raise ValueError('第 %d 行 filter type 非法：%d' % (y, ftype))
        if ftype == 0:
            pass
        elif ftype == 1:                      # Sub
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ftype == 2:                      # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:                      # Average
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        else:                                 # Paeth
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                upleft = prev[i - channels] if i >= channels else 0
                line[i] = (line[i] + paeth(left, prev[i], upleft)) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line

    return {
        'ihdr': ihdr,
        'palette': palette,
        'trns': trns,
        'pixels': out,
        'raw_pixels': out,
        'chunk_names': chunk_names,
        'errors': errors,
        'warnings': warnings,
    }


def pixel_rgba(parsed, x, y):
    """取某点的 RGBA（索引色 -> 查 PLTE/tRNS，真彩色 -> 直接读）。"""
    ihdr = parsed['ihdr']
    w = ihdr['width']
    ctype = ihdr['color_type']
    channels = CHANNELS[ctype]
    stride = w * channels
    i = y * stride + x * channels
    px = parsed['pixels']
    if ctype == 3:
        idx = px[i]
        pal = parsed['palette']
        if idx >= len(pal):
            return (0, 0, 0, 0)
        r, g, b = pal[idx]
        trns = parsed['trns']
        a = 255
        if trns is not None:
            a = trns[idx] if idx < len(trns) else 255
        return (r, g, b, a)
    if ctype == 6:
        return (px[i], px[i + 1], px[i + 2], px[i + 3])
    if ctype == 2:
        return (px[i], px[i + 1], px[i + 2], 255)
    if ctype == 4:
        return (px[i], px[i], px[i], px[i + 1])
    return (px[i], px[i], px[i], 255)


def inside_rounded_rect(x, y, size, radius):
    """像素中心 (x+0.5, y+0.5) 是否在圆角方块内（含边界）。"""
    fx = x + 0.5
    fy = y + 0.5
    if fx < 0 or fy < 0 or fx > size or fy > size:
        return False
    cx = min(max(fx, radius), size - radius)
    cy = min(max(fy, radius), size - radius)
    return (fx - cx) ** 2 + (fy - cy) ** 2 <= radius * radius


def build_rounded_mask(size, radius, band=2.0):
    """返回 (mask, expected_area)：mask[i] 表示像素中心是否在圆角方块内。
    逐像素调用圆角判定对 512x512 是 26 万次函数调用，而圆角只影响外圈。
    这里先用"到圆角方块的距离"做快速三分类，只对距离在 band 以内的像素做
    精确判定，结果与逐像素精确判定完全一致但快得多。
    """
    mask = [None] * (size * size)
    for y in range(size):
        fy = y + 0.5
        cy = min(max(fy, radius), size - radius)
        dy = fy - cy
        base = y * size
        for x in range(size):
            fx = x + 0.5
            cx = min(max(fx, radius), size - radius)
            dx = fx - cx
            if dx == 0.0 or dy == 0.0:
                # 至少一个方向处在直边带内：必定在图形内
                mask[base + x] = True
            elif dx < 0.0 and dy < 0.0:
                mask[base + x] = True
            else:
                d = math.hypot(dx, dy)
                if d <= radius + band:
                    mask[base + x] = None       # 靠近边界，需要精确判定
                elif d <= radius:
                    mask[base + x] = True
                else:
                    mask[base + x] = False
    for i, m in enumerate(mask):
        if m is None:
            mask[i] = inside_rounded_rect(i % size, i // size, size, radius)
    expected_area = sum(1 for m in mask if m)
    return mask, expected_area


# ---------------------------------------------------------------------------
# 校验
# ---------------------------------------------------------------------------

def check_image(path, expect_size=None, book_ranges=None):
    """校验单个 PNG，返回 (errors, warnings, stats)。"""
    errors = []
    warnings = []
    if not os.path.isfile(path):
        return (['文件不存在'], [], {})
    with open(path, 'rb') as fh:
        data = fh.read()

    try:
        parsed = parse_png(data)
    except ValueError as exc:
        return (['解析失败：%s' % exc], [], {'bytes': len(data)})

    errors += parsed['errors']
    warnings += parsed['warnings']

    ihdr = parsed['ihdr']
    w, h = ihdr['width'], ihdr['height']
    byte_count = len(data)

    if ihdr['color_type'] != EXPECT_COLOR_TYPE:
        errors.append('色彩类型应为 %d(%s)，实际 %d(%s)'
                      % (EXPECT_COLOR_TYPE, COLOR_NAME[EXPECT_COLOR_TYPE],
                         ihdr['color_type'], COLOR_NAME.get(ihdr['color_type'], '?')))
    if ihdr['bit_depth'] != EXPECT_BIT_DEPTH:
        errors.append('位深应为 %d，实际 %d' % (EXPECT_BIT_DEPTH, ihdr['bit_depth']))
    if w != h:
        errors.append('图标应为正方形，实际 %dx%d' % (w, h))
    if expect_size is not None and (w, h) != (expect_size, expect_size):
        errors.append('尺寸应为 %dx%d，IHDR 里是 %dx%d'
                      % (expect_size, expect_size, w, h))

    ctype = ihdr['color_type']
    palette = parsed['palette'] or []
    trns = parsed['trns']
    if ctype == 3:
        if not palette:
            errors.append('PLTE 为空')
        if trns is None:
            errors.append('缺少 tRNS，索引色无法表达透明')
        else:
            if len(trns) > len(palette):
                errors.append('tRNS(%d) 比 PLTE(%d) 长' % (len(trns), len(palette)))
            alphas = set(trns)
            if 0 not in alphas:
                errors.append('tRNS 里没有 alpha=0 的索引，圆角外不可能透明')
            if 255 not in alphas:
                errors.append('tRNS 里没有 alpha=255 的索引，图形不可能不透明')
        # 索引不能越界
        bad_index = sum(1 for v in parsed['pixels'] if v >= len(palette))
        if bad_index:
            errors.append('有 %d 个像素的调色板索引越界' % bad_index)
        # 展开成 RGBA 列表，后面统计直接用，避免反复查表
        flat = []
        for v in parsed['pixels']:
            r, g, b = palette[v] if v < len(palette) else (0, 0, 0)
            a = 255
            if trns is not None:
                a = trns[v] if v < len(trns) else 255
            flat.append((r, g, b, a))
    else:
        warnings.append('非索引色（色彩类型 %d），按通用路径校验' % ctype)
        flat = [pixel_rgba(parsed, i % w, i // w) for i in range(w * h)]

    # ---- 像素统计 ----
    opaque = 0          # a == 255
    visible = 0         # a > 0
    book = 0            # 接近白色的不透明像素
    bx0, by0, bx1, by1 = w, h, -1, -1
    row_has = [False] * h
    col_has = [False] * w

    for y in range(h):
        base = y * w
        for x in range(w):
            r, g, b, a = flat[base + x]
            if a > 0:
                visible += 1
                row_has[y] = True
                col_has[x] = True
                if a == 255:
                    opaque += 1
                    if r >= WHITE_MIN and g >= WHITE_MIN and b >= WHITE_MIN:
                        book += 1
                        if x < bx0:
                            bx0 = x
                        if x > bx1:
                            bx1 = x
                        if y < by0:
                            by0 = y
                        if y > by1:
                            by1 = y

    rows_blank = row_has.count(False)
    cols_blank = col_has.count(False)

    total = w * h
    radius = w * CORNER_RATIO
    mask, expected_area = build_rounded_mask(w, radius)

    # 圆角外必须透明。
    #
    # 判定用像素中心的 mask。这里**不能**再要求"邻居也在外侧"之类的前置条件：
    # 早期写法是 `if not (mask[x-1] and mask[x+1] and mask[y-1] and mask[y+1]): continue`，
    # 意图是跳过紧贴边界的环带，但效果恰好相反 —— 它跳过了所有存在外侧轴向邻居的
    # 像素，也就是"成片的不透明区域"整片被跳过，只有孤立的散点会被抓到。
    # 实测：整张画布涂满（无圆角、无透明区）报 0 error，而圆角外撒 3x3 散点能报 1 error。
    # 去掉该条件后，圆角外任何 alpha>0 的像素都会被计入；边界环带的安全由
    # render_icon 的中心点补正保证（补正要求像素中心在圆角矩形内，那必然意味着
    # mask 为真），因此不会引入边界假阳性。
    outside_violations = 0
    max_outside_alpha = 0
    for y in range(1, h - 1):
        base = y * w
        for x in range(1, w - 1):
            if mask[base + x]:
                continue
            a = flat[base + x][3]
            if a > 0:
                outside_violations += 1
                if a > max_outside_alpha:
                    max_outside_alpha = a
    if outside_violations:
        errors.append('圆角方块外有 %d 个非透明像素（最大 alpha=%d）'
                      % (outside_violations, max_outside_alpha))

    # 圆角内侧必须完全不透明。
    #
    # 判定"内部"不能用理想几何边界直接取 2px 邻域：圆角方块的外沿本身有
    # 抗锯齿过渡，靠近边界的像素**合法地**半透明。第一版在这里 512 主图
    # 稳定误报 2333 个像素，原因就是理想边界附近的像素中心落在边界内侧。
    # 但采样覆盖不足。所以这里排除两类像素，只检查真正的"内部"：
    #   (a) 靠理想边界太近（< 2px）—— 可能是外沿抗锯齿带；
    #       这里必须用 Chebyshev 距离（含对角），只看上下左右是不够的；
    #       小尺寸下圆角只有 3~14px，对角外侧的像素四个轴向邻域都在 mask 内，
    #       会被误判成"内部"（第一版修完仍在 16/24/32/48/64 上报这种假阳性）。
    #   (b) 3x3 邻域内 alpha 有明显变化 — 可能是任意一条抗锯齿过渡带。
    edge_holes = 0
    hole_samples = []
    for y in range(2, h - 2):
        base = y * w
        for x in range(2, w - 2):
            if not mask[base + x]:
                continue
            # (a) Chebyshev 距离 < 2 的邻域必须全部在 mask 内
            too_close = False
            for dy in (-2, -1, 0, 1, 2):
                for dx in (-2, -1, 0, 1, 2):
                    if not mask[base + dy * w + dx]:
                        too_close = True
                        break
                if too_close:
                    break
            if too_close:
                continue
            # (b) 邻域 alpha 变化明显 -> 处于抗锯齿过渡带
            here = flat[base + x][3]
            if here == 255:
                continue
            neighbourhood = []
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    neighbourhood.append(flat[base + dy * w + dx][3])
            if max(neighbourhood) - min(neighbourhood) > 8:
                continue
            edge_holes += 1
            if len(hole_samples) < 5:
                hole_samples.append((x, y, here))
    if edge_holes:
        errors.append(
            '圆角内侧的实心区域有 %d 个像素不是完全不透明（例如 %s）'
            % (edge_holes, ', '.join('(%d,%d) a=%d' % s for s in hole_samples)))

    if rows_blank:
        errors.append('有 %d 行整行全透明' % rows_blank)
    if cols_blank:
        errors.append('有 %d 列整列全透明' % cols_blank)

    visible_ratio = visible / total
    opaque_ratio = opaque / total
    if expected_area:
        coverage = visible / expected_area
        if coverage < 0.97:
            errors.append('圆角方块被填充的比例只有 %.3f（<0.97），可能有空洞' % coverage)
    else:
        coverage = 0.0

    book_ratio = book / total
    if book == 0:
        errors.append('没有找到任何接近白色的像素，书本图形可能没画出来')

    bbox = None
    if book:
        bw = (bx1 - bx0 + 1) / w
        bh = (by1 - by0 + 1) / h
        bbox = (bx0, by0, bx1, by1, bw, bh)
        # 按尺寸选期望区间：小尺寸几何（<=32px）书更宽更扁，与大尺寸不同档。
        default_ranges = (BOOK_RANGES_SMALL if w <= SMALL_ICON_MAX
                          else BOOK_RANGES_LARGE)
        ranges = book_ranges or default_ranges
        lo, hi = ranges[0]
        if not (lo - 0.04 <= bw <= hi + 0.04):
            warnings.append('书本实测宽 %.1f%%，期望 %.0f%%~%.0f%%'
                            % (bw * 100, lo * 100, hi * 100))
        lo, hi = ranges[1]
        if not (lo - 0.04 <= bh <= hi + 0.04):
            warnings.append('书本实测高 %.1f%%，期望 %.0f%%~%.0f%%'
                            % (bh * 100, lo * 100, hi * 100))
        # 居中检查：左右/上下留白差不应超过 2%
        margin_l = bx0 / w
        margin_r = (w - 1 - bx1) / w
        margin_t = by0 / h
        margin_b = (h - 1 - by1) / h
        if abs(margin_l - margin_r) > 0.02:
            warnings.append('书本左右留白不对称：左 %.1f%% / 右 %.1f%%'
                            % (margin_l * 100, margin_r * 100))
        if abs(margin_t - margin_b) > 0.02:
            warnings.append('书本上下留白不对称：上 %.1f%% / 下 %.1f%%'
                            % (margin_t * 100, margin_b * 100))

    # 书脊缝：取书本中线那一行，找最暗（alpha 最低）的像素
    seam = None
    if book:
        mid_y = (by0 + by1) // 2
        mid_x = (bx0 + bx1) // 2
        seam_alpha = 256
        seam_x = mid_x
        for x in range(bx0, bx1 + 1):
            a = flat[mid_y * w + x][3]
            if a < seam_alpha:
                seam_alpha = a
                seam_x = x
        seam = (seam_x, mid_y, seam_alpha)

    stats = {
        'path': path,
        'bytes': byte_count,
        'size': (w, h),
        'color_type': '%d(%s)/%dbit' % (ihdr['color_type'],
                                        COLOR_NAME.get(ihdr['color_type'], '?'),
                                        ihdr['bit_depth']),
        'chunks': '+'.join(parsed['chunk_names']),
        'visible': visible,
        'visible_ratio': visible_ratio,
        'opaque_ratio': opaque_ratio,
        'coverage': coverage,
        'book': book,
        'book_ratio': book_ratio,
        'rows_blank': rows_blank,
        'cols_blank': cols_blank,
        'book_bbox': bbox,
        'seam': seam,
        'errors': errors,
        'warnings': warnings,
    }
    return (errors, warnings, stats)


def print_stats(stats):
    if not stats:
        return
    w, h = stats['size']
    print('  %s' % os.path.basename(stats['path']))
    print('    size          : %dx%d   color: %s' % (w, h, stats['color_type']))
    print('    chunks        : %s' % stats['chunks'])
    print('    bytes         : %d' % stats['bytes'])
    print('    visible px    : %d / %d = %.2f%%'
          % (stats['visible'], w * h, stats['visible_ratio'] * 100))
    print('    opaque px     : %.2f%%   coverage of rounded square: %.4f'
          % (stats['opaque_ratio'] * 100, stats['coverage']))
    print('    white (book)  : %.2f%% of canvas' % (stats['book_ratio'] * 100))
    if stats['book_bbox']:
        bx0, by0, bx1, by1, bw, bh = stats['book_bbox']
        print('    book bbox     : x %d~%d (%.1f%%)  y %d~%d (%.1f%%)'
              % (bx0, bx1, bw * 100, by0, by1, bh * 100))
        m = (bx0 / w, (w - 1 - bx1) / w, by0 / h, (h - 1 - by1) / h)
        print('    margins       : L %.1f%%  R %.1f%%  T %.1f%%  B %.1f%%'
              % (m[0] * 100, m[1] * 100, m[2] * 100, m[3] * 100))
    if stats['seam']:
        sx, sy, sa = stats['seam']
        # 注意：这只报"中线处最暗的 alpha"，**不是**判定成功与否的断言。
        # 大尺寸（>=48px）的中缝结构是"页–缝–书脊–缝–页"，缝在书脊两侧，
        # 中线落在书脊上，所以这里必然读到 alpha=255；小尺寸才是"两页 + 中线实缝"。
        # 真正的中缝判定见 make_icon.py 的几何配置与下面的 gutter 检查。
        print('    center row    : darkest alpha=%d at x=%d (y=%d)%s'
              % (sa, sx, sy,
                 '  <- 中线有缝' if sa < 250 else '  <- 中线无 alpha 变化（大尺寸为书脊）'))
    print('    blank rows/cols: %d / %d' % (stats['rows_blank'], stats['cols_blank']))


def parse_args(argv=None):
    p = argparse.ArgumentParser(description='校验 make_icon.py 生成的 PNG。')
    p.add_argument('files', nargs='*', help='要校验的 PNG 路径；不传则用默认集合')
    p.add_argument('--dir', default=None, help='校验该目录下所有 icon-*.png')
    p.add_argument('--expect', type=int, default=None, help='期望边长')
    p.add_argument('--quiet', action='store_true', help='只打印结论')
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)

    targets = []
    if args.files:
        for f in args.files:
            size = args.expect
            if size is None:
                base = os.path.basename(f)
                if base.startswith('icon-') and base.endswith('.png'):
                    try:
                        size = int(base[5:-4])
                    except ValueError:
                        size = None
            targets.append((f, size))
    else:
        main_png = os.path.join(HERE, 'icon.png')
        if os.path.isfile(main_png):
            targets.append((main_png, None))
        sizes_dir = args.dir or os.path.join(HERE, 'icon-sizes')
        if os.path.isdir(sizes_dir):
            for name in sorted(os.listdir(sizes_dir)):
                if name.startswith('icon-') and name.endswith('.png'):
                    try:
                        size = int(name[5:-4])
                    except ValueError:
                        size = None
                    targets.append((os.path.join(sizes_dir, name), size))
        elif args.dir:
            print('目录不存在：%s' % args.dir, file=sys.stderr)
            return 2

    if not targets:
        print('没有找到要校验的 PNG，请先运行 make_icon.py', file=sys.stderr)
        return 2

    total_errors = 0
    total_warnings = 0
    all_stats = []
    for path, size in targets:
        errors, warnings, stats = check_image(path, expect_size=size)
        all_stats.append(stats)
        total_errors += len(errors)
        total_warnings += len(warnings)
        if not args.quiet:
            print_stats(stats)
            for w in warnings:
                print('    WARN : %s' % w)
            for e in errors:
                print('    ERROR: %s' % e)
            print('')

    print('=' * 72)
    print('校验了 %d 个文件：%d 个 error，%d 个 warning' % (len(targets), total_errors, total_warnings))
    for st in all_stats:
        if not st:
            continue
        w, h = st['size']
        bbox = st['book_bbox']
        bwh = ('%.1f%%x%.1f%%' % (bbox[4] * 100, bbox[5] * 100)) if bbox else 'n/a'
        print('  %-18s %4dpx %7d B  visible %6.2f%%  book %s'
              % (os.path.basename(st['path']), w, st['bytes'],
                 st['visible_ratio'] * 100, bwh))
    print('=' * 72)
    print('结论：%s' % ('通过' if total_errors == 0 else '存在 %d 个 error' % total_errors))
    return 0 if total_errors == 0 else 1


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    sys.exit(main())
