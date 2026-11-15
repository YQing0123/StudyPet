"""批量把表情图转成可用的头部贴图：对齐 → 白底抠透明 → 裁头部区域"""
import numpy as np
from PIL import Image
from collections import deque

BASE = 'app/web/public/pet/idle.png'
HEAD_RECT = (0.10, 0.00, 0.80, 0.58)      # 与 PetParts 中 head 部件一致
OUT_DIR = 'app/web/public/pet/heads'

VARIANTS = {
    'happy': 'dsh-image-gen/image-b501e44d.png',   # 闭眼大笑
    'sleep': 'dsh-image-gen/image-275f5a11.png',   # 闭眼安静
    'sick':  'dsh-image-gen/image-fd77e2a0.png',   # 耷眼难过
}

def subject_bbox(im):
    a = np.asarray(im.convert('RGBA'), dtype=np.uint8)
    if a[..., 3].min() < 250:
        mask = a[..., 3] > 16
    else:
        rgb = a[..., :3].astype(np.int16)
        mask = rgb.min(axis=2) < 240
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())

def align_to_base(im, base):
    bw, bh = base.size
    bx0, by0, bx1, by1 = subject_bbox(base)
    im = im.convert('RGBA')
    ex0, ey0, ex1, ey1 = subject_bbox(im)
    ew, eh = ex1 - ex0 + 1, ey1 - ey0 + 1
    tw, th = bx1 - bx0 + 1, by1 - by0 + 1
    scale = min(tw / ew, th / eh)
    subj = im.crop((ex0, ey0, ex1 + 1, ey1 + 1))
    nw, nh = max(1, round(ew * scale)), max(1, round(eh * scale))
    subj = subj.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
    canvas.alpha_composite(subj, (max(0, bx0 + (tw - nw) // 2), max(0, by0 + (th - nh) // 2)))
    return canvas

def white_to_alpha(im, tol=238):
    """从四边泛洪去白底，保留主体内部的浅色高光"""
    rgb = np.asarray(im.convert('RGB')).astype(np.int16)
    h, w, _ = rgb.shape
    near_white = (rgb.min(axis=2) >= tol)
    bg = np.zeros((h, w), bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True; dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True; dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx] and near_white[ny, nx]:
                bg[ny, nx] = True; dq.append((ny, nx))
    alpha = (~bg).astype(np.float32) * 255.0
    # 羽化边缘
    k = 5; pad = np.pad(alpha, 2, mode='edge'); acc = np.zeros_like(alpha)
    for dy in range(k):
        for dx in range(k):
            acc += pad[dy:dy + h, dx:dx + w]
    alpha = acc / (k * k)
    alpha[~bg] = np.maximum(alpha[~bg], 232)
    out = np.dstack([rgb.astype(np.uint8), np.clip(alpha, 0, 255).astype(np.uint8)])
    return Image.fromarray(out, 'RGBA')

def feather_bottom(im, ratio=0.13):
    """把头部贴图下边缘做透明羽化。
    底层身体图在颈部是同一片毛发，柔化后能自然融合，避免硬切缝。"""
    a = np.asarray(im.convert('RGBA')).astype(np.float32)
    h = a.shape[0]
    start = int(h * (1 - ratio))
    ramp = np.ones(h, dtype=np.float32)
    ramp[start:] = np.linspace(1.0, 0.0, h - start) ** 1.4
    a[..., 3] *= ramp[:, None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')

def main():
    base = Image.open(BASE).convert('RGBA')
    w, h = base.size
    x, y, rw, rh = HEAD_RECT
    box = (int(x * w), int(y * h), int((x + rw) * w), int((y + rh) * h))
    print(f"基准 {w}×{h}，头部裁剪框 {box}")

    # 基准自身的头部（neutral）也导一份，方便对比与兜底
    base_head = base.crop(box)
    base_head.save(f'{OUT_DIR}/neutral.png')
    print(f"  neutral.png   {base_head.size}")

    for name, path in VARIANTS.items():
        keyed = white_to_alpha(Image.open(path))   # 必须先抠底，否则透明边界挡住泛洪
        aligned = align_to_base(keyed, base)
        head = feather_bottom(aligned.crop(box))
        out = f'{OUT_DIR}/{name}.png'
        head.save(out)
        import os
        print(f"  {name}.png  {head.size}  {os.path.getsize(out)/1024:.0f} KB")

if __name__ == '__main__':
    main()
