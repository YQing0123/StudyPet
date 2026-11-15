"""白底立绘 → 透明 RGBA：边缘泛洪 + 距离羽化，全自动无需人工修图。"""
import sys
import numpy as np
from PIL import Image
from collections import deque

def extract(src, dst, tol=26, feather=2):
    im = Image.open(src).convert('RGB')
    rgb = np.asarray(im).astype(np.int16)
    h, w, _ = rgb.shape
    # 背景判定：接近纯白
    near_white = (rgb.max(axis=2) > 255 - 40) & (rgb.min(axis=2) > 255 - 55)
    # 从四边泛洪，只清除与边缘连通的白色区域（保留角色内部高光）
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
        for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx] and near_white[ny, nx]:
                bg[ny, nx] = True; dq.append((ny, nx))
    alpha = (~bg).astype(np.float32) * 255.0
    # 羽化：对 alpha 做小半径均值模糊，消除锯齿
    if feather > 0:
        k = feather * 2 + 1
        pad = np.pad(alpha, feather, mode='edge')
        acc = np.zeros_like(alpha)
        for dy in range(k):
            for dx in range(k):
                acc += pad[dy:dy + h, dx:dx + w]
        alpha = acc / (k * k)
        # 保边：内部仍为实心
        alpha[~bg] = np.maximum(alpha[~bg], 235)
    out = np.dstack([rgb.astype(np.uint8), np.clip(alpha, 0, 255).astype(np.uint8)])
    img = Image.fromarray(out, 'RGBA')
    bbox = img.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        pad = 12
        img = img.crop((max(0, bbox[0]-pad), max(0, bbox[1]-pad),
                        min(w, bbox[2]+pad), min(h, bbox[3]+pad)))
    img.save(dst, 'PNG')
    a = np.asarray(img)[:, :, 3]
    print(f"OK {dst}  {img.size[0]}x{img.size[1]}  透明{100*(a==0).mean():.1f}%  半透明{100*((a>0)&(a<255)).mean():.2f}%")

if __name__ == '__main__':
    extract(sys.argv[1], sys.argv[2])
