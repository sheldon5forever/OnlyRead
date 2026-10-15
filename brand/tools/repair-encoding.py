"""诊断并尝试修复"编码往返"造成的乱码文件（Windows 上常见）。

典型症状
--------
文件用 UTF-8 存中文，但被某个工具按系统 ANSI 代码页（简体中文 Windows 上是 GBK）
读取后又以 UTF-8 写出。结果中文全变成形如 `璁捐寤鸿` 的乱码，
并且因为解码时的字节边界错位，**部分换行会被吃掉**（多行粘成一行）。

最常见的触发方式就是 PowerShell：
    (Get-Content -Raw a.md) -replace 'x','y' | Set-Content a.md -Encoding UTF8
`Get-Content` 在 Windows PowerShell 5.1 下按 ANSI 读取，于是中文就毁了。

用法
----
    python brand/tools/repair-encoding.py <文件> [...]            # 只诊断
    python brand/tools/repair-encoding.py <文件> [...] --write    # 诊断并写回

行为
----
1. 先判断文件是否像"GBK 误读的 UTF-8"（统计落在典型乱码区块的 CJK 字符占比）。
2. 依次尝试用 gbk / gb18030 / cp936 / big5 / shift_jis / latin-1 把当前文本
   编码回字节，再按 UTF-8 解码，取第一个 strict 成功的候选。
3. **strict 失败就明确报告失败**，不假装修好了 —— 这种情况下有字节已在误解码时
   丢失，不可无损恢复，应当整份重写。脚本不会在有不可恢复字符时写回。

输出刻意全用 ASCII：Windows 控制台默认 GBK，打印中文或 ✓/✗ 会抛
UnicodeEncodeError，反而让工具本身变成新的故障源。
"""
import argparse
import os
import sys

# 按可能性排序：简体中文 Windows 是 GBK/GB18030，繁体是 Big5，日文是 Shift_JIS
CANDIDATES = ['gbk', 'gb18030', 'cp936', 'big5', 'shift_jis', 'latin-1']

# GBK 误读 UTF-8 后的汉字大量落在这些区块。
#
# 注意这是**启发式**，不是判据：合法汉字里也有落在这两段的常用字
# （例如「页」U+9875、「面」U+9762、「题」U+9898），所以只有当 CJK 样本
# 足够大时按占比判断才有意义 —— 否则一个只含 7 个汉字的文件会被误报。
MOJIBAKE_RANGES = [
    (0x3400, 0x4DBF),   # CJK 扩展 A
    (0x9000, 0x9FFF),   # CJK（正常中文很少用这一段，误读后大量出现）
    (0xE000, 0xF8FF),   # 私用区
]

# 少于这个 CJK 字数就不做占比判断（样本太小，误报率高于检出率）
MIN_CJK_FOR_HEURISTIC = 30
# 占比阈值：正常中文约 5~10% 落在这两段，GBK 误读后约 30% 以上
MOJIBAKE_RATIO_THRESHOLD = 0.20


def mojibake_score(text):
    """返回 (落在乱码区块的字符数, CJK 总数)。占比高就基本可以断定是乱码。"""
    in_range = 0
    cjk = 0
    for ch in text:
        o = ord(ch)
        if 0x3400 <= o <= 0x9FFF or 0xE000 <= o <= 0xF8FF:
            cjk += 1
        for lo, hi in MOJIBAKE_RANGES:
            if lo <= o <= hi:
                in_range += 1
                break
    return in_range, cjk


def try_strict(text, enc):
    try:
        return text.encode(enc, errors='strict').decode('utf-8', errors='strict')
    except (UnicodeEncodeError, UnicodeDecodeError) as exc:
        return None, '%s' % type(exc).__name__


def main():
    ap = argparse.ArgumentParser(description='诊断并尝试修复编码往返乱码。')
    ap.add_argument('files', nargs='+')
    ap.add_argument('--write', action='store_true',
                    help='strict 修复成功且无残留损坏时写回（默认只诊断）')
    args = ap.parse_args()

    exit_code = 0
    for path in args.files:
        print('=' * 72)
        if not os.path.isfile(path):
            print('MISSING  %s' % path)
            exit_code = 1
            continue

        with open(path, 'rb') as fh:
            raw = fh.read()
        has_bom = raw[:3] == b'\xef\xbb\xbf'
        try:
            text = raw.decode('utf-8-sig')
        except UnicodeDecodeError as exc:
            print('NOT-UTF8 %s  (%s)' % (path, exc))
            print('  -> 文件本身不是合法 UTF-8，本工具不处理这种情况')
            exit_code = 1
            continue

        in_range, cjk = mojibake_score(text)
        pct = (in_range / cjk * 100.0) if cjk else 0.0
        print('FILE     %s' % path)
        print('  bytes=%d  lines=%d  bom=%s  cjk=%d  in_mojibake_range=%d (%.1f%%)'
              % (len(raw), text.count('\n') + 1, has_bom, cjk, in_range, pct))

        if cjk == 0:
            print('  -> 不含中文，无需修复')
            continue
        if cjk < MIN_CJK_FOR_HEURISTIC:
            print('  -> CJK 样本太少（%d 字），占比启发式不可靠，跳过' % cjk)
            continue
        if pct < MOJIBAKE_RATIO_THRESHOLD * 100.0:
            print('  -> 乱码区块占比低，可能本来就是正常中文，跳过')
            continue

        fixed = None
        used = None
        for enc in CANDIDATES:
            result = try_strict(text, enc)
            if isinstance(result, tuple):
                continue
            fixed, used = result, enc
            break

        if fixed is None:
            print('  -> REPAIR FAILED: 所有候选编码的 strict 往返都失败')
            print('     说明有字节在误解码时已丢失，**不可无损恢复**；应整份重写。')
            exit_code = 1
            continue

        residual = [i + 1 for i, line in enumerate(fixed.split('\n')) if '\ufffd' in line]
        print('  -> repaired with %s (strict round-trip OK)' % used)
        print('     residual_replacement_chars_in_lines=%d' % len(residual))
        if residual:
            print('     lines: %s' % ', '.join(str(n) for n in residual[:20]))
            print('     -> 有残留损坏，不写回')
            exit_code = 1
            continue

        if args.write:
            with open(path, 'w', encoding='utf-8', newline='\n') as fh:
                fh.write(fixed)
            print('     -> WRITTEN')
        else:
            print('     -> dry-run（加 --write 才写回）')

    return exit_code


if __name__ == '__main__':
    sys.exit(main())
