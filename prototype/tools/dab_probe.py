"""小达人 .dab 结构探测：只读分析，输出容器类型、内部文件、音频与码表线索。

用法: python3 dab_probe.py <file.dab>
"""
import sys, zipfile, struct, re, io
from pathlib import Path

ZIP_MAGIC = b'PK\x03\x04'
RAR4 = b'Rar!\x1a\x07\x00'
RAR5 = b'Rar!\x1a\x07\x01\x00'
SEVENZ = b'7z\xbc\xaf\x27\x1c'
GZIP = b'\x1f\x8b\x08'

def sniff(head):
    if head.startswith(ZIP_MAGIC): return 'ZIP 容器'
    if head.startswith(RAR4): return 'RAR4 容器'
    if head.startswith(RAR5): return 'RAR5 容器'
    if head.startswith(SEVENZ): return '7z 容器'
    if head.startswith(GZIP): return 'GZIP'
    if head.startswith(b'SQLite format 3'): return 'SQLite 数据库'
    if head.startswith(b'RIFF'): return 'RIFF/WAV'
    if head.startswith(b'ID3') or head.startswith(b'\xff\xfb'): return '直接是 MP3'
    return '未知自定义头'

def find_mp3_frames(data):
    """扫描 MP3 帧同步字，统计连续音频区段"""
    offs = []
    i = 0; n = len(data)
    while i < n - 4:
        if data[i] == 0xFF and (data[i+1] & 0xE0) == 0xE0 and (data[i+1] & 0x06) != 0:
            # 校验后续帧是否也在合理距离内，排除偶然字节
            ok = 0
            for probe in (100, 400, 900):
                j = i + probe
                if j < n - 1 and data[j] == 0xFF and (data[j+1] & 0xE0) == 0xE0:
                    ok += 1
            if ok >= 1:
                offs.append(i)
                i += 400
                continue
        i += 1
    return offs

def extract_strings(data, minlen=4, limit=40):
    out = []
    # ASCII / UTF-8
    for m in re.finditer(rb'[\x20-\x7e]{%d,}' % minlen, data):
        out.append((m.start(), m.group().decode('latin-1')))
        if len(out) >= limit: break
    # UTF-16LE
    for m in re.finditer(rb'(?:[\x20-\x7e]\x00){%d,}' % minlen, data):
        out.append((m.start(), m.group().decode('utf-16-le', 'ignore')))
        if len(out) >= limit: break
    # GBK 中文
    for m in re.finditer(rb'(?:[\xb0-\xf7][\xa1-\xfe]){2,}', data):
        try:
            out.append((m.start(), m.group().decode('gbk')))
        except UnicodeDecodeError:
            pass
        if len(out) >= limit: break
    return sorted(out)[:limit]

def find_oid_like(data):
    """寻找疑似码表：连续递增的 32 位整数序列"""
    hits = []
    for width, name in ((4, 'u32le'), (2, 'u16le')):
        seq, start, prev = 0, 0, None
        step = width
        for i in range(0, len(data) - width, width):
            v = int.from_bytes(data[i:i+width], 'little')
            if prev is not None and 0 < v - prev <= 4 and 1000 < v < 100_000_000:
                if seq == 0: start = i - width
                seq += 1
            else:
                if seq >= 24:
                    hits.append((name, start, seq + 1))
                seq = 0
            prev = v
        if seq >= 24:
            hits.append((name, start, seq + 1))
    return sorted(hits, key=lambda x: -x[2])[:5]

def main(path):
    p = Path(path)
    if not p.is_file():
        print(f"文件不存在: {p}"); return 2
    data = p.read_bytes()
    print(f"文件: {p.name}")
    print(f"大小: {len(data):,} 字节 ({len(data)/1048576:.2f} MB)")
    print(f"头部 16 字节: {data[:16].hex(' ')}")
    ctype = sniff(data[:32])
    print(f"容器类型: {ctype}")

    if ctype.startswith('ZIP'):
        print("\n=== ZIP 内部条目 ===")
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                names = z.namelist()
                print(f"条目数: {len(names)}")
                ext_count = {}
                for n in names:
                    e = Path(n).suffix.lower() or '(无后缀)'
                    ext_count[e] = ext_count.get(e, 0) + 1
                print("后缀分布:", dict(sorted(ext_count.items(), key=lambda x: -x[1])))
                for n in names[:30]:
                    print(f"  {n}")
                if len(names) > 30: print(f"  ... 另有 {len(names)-30} 条")
        except Exception as ex:
            print(f"ZIP 解析失败: {ex}")

    if ctype == 'SQLite 数据库':
        print("\n=== SQLite 表 ===")
        try:
            import sqlite3
            con = sqlite3.connect(f'file:{p}?mode=ro', uri=True)
            for (name,) in con.execute("SELECT name FROM sqlite_master WHERE type='table'"):
                cnt = con.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
                cols = [r[1] for r in con.execute(f'PRAGMA table_info("{name}")')]
                print(f"  {name}: {cnt} 行, 列={cols}")
            con.close()
        except Exception as ex:
            print(f"SQLite 解析失败: {ex}")

    frames = find_mp3_frames(data)
    print(f"\n=== 音频线索 ===")
    print(f"MP3 帧同步点: {len(frames)} 处")
    if frames:
        gaps = [b - a for a, b in zip(frames, frames[1:])]
        span = frames[-1] - frames[0]
        print(f"首帧偏移 {frames[0]:,}，末帧 {frames[-1]:,}，跨度 {span:,} 字节")
        if gaps:
            print(f"帧间距中位数 {sorted(gaps)[len(gaps)//2]:,} 字节（越小说明连续音频越密集）")

    oids = find_oid_like(data)
    print(f"\n=== 码表线索 ===")
    if oids:
        for kind, off, n in oids:
            print(f"  {kind}: 偏移 {off:,} 起，连续 {n} 个递增整数")
    else:
        print("  未发现连续递增整数序列")

    print(f"\n=== 可读字符串（前 25 条）===")
    for off, s in extract_strings(data, limit=25):
        s = s.strip()
        if 2 <= len(s) <= 80:
            print(f"  @{off:>10,}  {s!r}")

    print("\n=== 尾部 32 字节 ===")
    print(f"  {data[-32:].hex(' ')}")
    return 0

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print("用法: python3 dab_probe.py <file.dab>"); sys.exit(2)
    sys.exit(main(sys.argv[1]))
