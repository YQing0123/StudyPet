"""把「同一只狗、不同表情」的图对齐到基准立绘的坐标系，再裁出头部贴图。

对齐原理：两张图里主体（狗）的包围盒应该一一对应，
用包围盒等比缩放+平移，就能把表情图对到基准图上。
"""
import sys
import numpy as np
from PIL import Image

BASE = 'app/web/public/pet/idle.png'

def subject_bbox(im):
    """非白/非透明像素的包围盒"""
    a = np.asarray(im.convert('RGBA'), dtype=np.uint8)
    if a[..., 3].min() < 250:           # 自带 alpha
        mask = a[..., 3] > 16
    else:                                # 白底
        rgb = a[..., :3].astype(np.int16)
        mask = rgb.min(axis=2) < 240
    ys, xs = np.where(mask)
    return (xs.min(), ys.min(), xs.max(), ys.max())

def align_to_base(src_path, base_im):
    base = base_im
    bw, bh = base.size
    bx0, by0, bx1, by1 = subject_bbox(base)
    im = Image.open(src_path).convert('RGBA')
    ex0, ey0, ex1, ey1 = subject_bbox(im)
    ew, eh = ex1 - ex0 + 1, ey1 - ey0 + 1
    tw, th = bx1 - bx0 + 1, by1 - by0 + 1
    scale = min(tw / ew, th / eh)

    # 裁到主体，再缩放
    subj = im.crop((ex0, ey0, ex1 + 1, ey1 + 1))
    nw, nh = max(1, round(ew * scale)), max(1, round(eh * scale))
    subj = subj.resize((nw, nh), Image.LANCZOS)

    canvas = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
    # 水平居中，垂直按包围盒顶部对齐
    px = bx0 + (tw - nw) // 2
    py = by0 + (th - nh) // 2
    canvas.alpha_composite(subj, (max(0, px), max(0, py)))
    return canvas

def extract_head(aligned, out_path, rect):
    w, h = aligned.size
    x, y, rw, rh = rect
    box = (int(x * w), int(y * h), int((x + rw) * w), int((y + rh) * h))
    head = aligned.crop(box)
    head.save(out_path)
    return box, head.size

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    base_im = Image.open(BASE)
    aligned = align_to_base(src, base_im)
    HEAD_RECT = (0.10, 0.00, 0.80, 0.58)     # 与 PetParts 中 head 部件一致
    box, size = extract_head(aligned, out, HEAD_RECT)
    aligned.save(out.replace('.png', '_aligned.png'))
    print(f"对齐完成 → {out}  裁剪区域{box} 尺寸{size}")
