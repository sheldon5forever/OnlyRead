"""把 brand/ 的应用图标资产装配到 build/（electron-builder 的 buildResources）。

产出
----
    build/icon.png    ← brand/icon.png                        512，Linux / 通用源图
    build/icon.ico    ← brand/icon-sizes/*.png                 Windows，多尺寸
    build/icon.icns   ← brand/icon-sizes/*.png + 512 + 1024    macOS，多尺寸

为什么只"装箱"、不缩放
----------------------
应用图标是按尺寸**分档光栅化**的（≤32px 一套比例、≥48px 另一套）。ICO / ICNS 里
每个尺寸都必须直接取对应的原始产物；若让工具把 512 缩到 16，描边会被抗锯齿抹成
一圈灰线，小尺寸就退化成一块蓝白斑块。

所以本脚本不重新实现几何，只做容器装配：
  * 16 / 24 / 32 / 48 / 64 / 128 / 256 读 brand/icon-sizes/ 下已有的 PNG；
  * 512 读 brand/icon.png；
  * 1024（icns 的 ic10 = 512@2x）用同目录的 make_icon.py 现渲染，
    保证与其余尺寸同源、同属分档几何。
只依赖标准库（自己写 ICO / ICNS 容器），运行环境无需 Pillow。

要先重新生成 brand/ 下的 PNG 资产，再运行本脚本：
    python scripts/make_icon.py     # 渲染 brand/icon.png + brand/icon-sizes/
    python scripts/make-icon.py     # 装箱到 build/

用法
----
    python scripts/make-icon.py
"""
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BRAND_DIR = os.path.join(ROOT, 'brand')
SIZES_DIR = os.path.join(BRAND_DIR, 'icon-sizes')
BUILD_DIR = os.path.join(ROOT, 'build')

MAIN_PNG = os.path.join(BRAND_DIR, 'icon.png')

# ICO 内包含的尺寸：Windows 资源管理器 / 任务栏实际会用到的一整套
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)

# ICNS 条目：类型 -> 该条目承载的像素边长（沿用 Apple / Pillow 的标准映射）。
ICNS_ENTRIES = (
    (b'ic07', 128),
    (b'ic08', 256),
    (b'ic09', 512),
    (b'ic10', 1024),   # 512@2x，Retina Dock 用
    (b'ic11', 32),     # 16@2x
    (b'ic12', 64),     # 32@2x
    (b'ic13', 256),    # 128@2x
    (b'ic14', 512),    # 256@2x
)

PNG_MAGIC = b'\x89PNG\r\n\x1a\n'


def png_dimensions(data):
    """从 IHDR 读出 PNG 的边长，用来在装箱前核对尺寸。"""
    if data[:8] != PNG_MAGIC:
        raise ValueError('不是 PNG 数据')
    width, height = struct.unpack('>II', data[16:24])
    return width, height


def read_png(path):
    with open(path, 'rb') as fh:
        return fh.read()


def render_png(size):
    """用同目录的 make_icon.py 现场渲染某个尺寸（仅 icns 的 1024 需要）。"""
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import make_icon  # 仓库内模块，仅此处按需导入

    indices, width, height, palette, _white = make_icon.render_icon(size)
    return make_icon.encode_indexed_png(indices, width, height, palette)


def png_for_size(size):
    """返回该尺寸的 PNG 字节；优先用 brand/ 里现成的产物，1024 现渲染。"""
    if size == 1024:
        data = render_png(size)
    elif size == 512:
        data = read_png(MAIN_PNG)
    else:
        data = read_png(os.path.join(SIZES_DIR, 'icon-%d.png' % size))

    width, height = png_dimensions(data)
    if (width, height) != (size, size):
        raise ValueError(
            '尺寸不符：期望 %dx%d，实际 %dx%d' % (size, size, width, height)
        )
    return data


def build_ico(sizes):
    """多尺寸 ICO 容器；每个条目内嵌 PNG（Vista 及以上支持）。"""
    images = [png_for_size(size) for size in sizes]

    # ICONDIR：reserved(2) / type=1 图标(2) / count(2)
    out = bytearray(struct.pack('<HHH', 0, 1, len(sizes)))

    # 目录项各占 16 字节，图像数据紧随其后
    offset = len(out) + 16 * len(sizes)
    entries = bytearray()
    for size, data in zip(sizes, images):
        # 宽高字段各 1 字节，256 用 0 表示
        dim = 0 if size >= 256 else size
        entries += struct.pack(
            '<BBBBHHII',
            dim,          # bWidth
            dim,          # bHeight
            0,            # bColorCount（真彩 / PNG 填 0）
            0,            # bReserved
            1,            # wPlanes
            32,           # wBitCount
            len(data),    # dwBytesInRes
            offset,       # dwImageOffset
        )
        offset += len(data)

    out += entries
    for data in images:
        out += data
    return bytes(out)


def build_icns(entries):
    """ICNS 容器；每个条目内嵌 PNG。条目长度含 8 字节的 type+length 头。"""
    body = bytearray()
    for type_code, size in entries:
        data = png_for_size(size)
        body += type_code + struct.pack('>I', 8 + len(data)) + data
    return b'icns' + struct.pack('>I', 8 + len(body)) + bytes(body)


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as fh:
        fh.write(data)
    return len(data)


def main():
    main_png = read_png(MAIN_PNG)
    width, height = png_dimensions(main_png)
    print('源图 brand/icon.png: %dx%d' % (width, height))

    written = [
        ('build/icon.png', write(os.path.join(BUILD_DIR, 'icon.png'), main_png)),
        ('build/icon.ico', write(os.path.join(BUILD_DIR, 'icon.ico'), build_ico(ICO_SIZES))),
        ('build/icon.icns', write(os.path.join(BUILD_DIR, 'icon.icns'), build_icns(ICNS_ENTRIES))),
    ]

    print('ICO 尺寸: %s' % ', '.join(str(s) for s in ICO_SIZES))
    print('ICNS 条目: %s' % ', '.join('%s=%d' % (t.decode('ascii'), s) for t, s in ICNS_ENTRIES))
    for name, size in written:
        print('  %-16s %8d bytes' % (name, size))


if __name__ == '__main__':
    main()
