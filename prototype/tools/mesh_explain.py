"""离线渲染：同一张 PNG 在三个相位下的网格形变，用于说明「一张图怎么动起来」。"""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SRC = 'prototype/assets/pet_idle.png'
OUT = 'screenshots/20-网格三相位.png'

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)

def displacement(ux, uy, t, amp=3.0):
    """与前端着色器同一套公式，只是把幅度放大，便于肉眼看清。"""
    wHead = 1.0 - smoothstep(0.30, 0.52, uy)
    wEarL = 1.0 - smoothstep(0.10, 0.30, ux)
    wEarR = smoothstep(0.70, 0.90, ux)
    wEar = (wEarL + wEarR) * wHead
    wTail = smoothstep(0.05, 0.30, 0.25 - np.abs(uy - 0.62)) * (1.0 - smoothstep(0.18, 0.40, ux))
    wBot = smoothstep(0.55, 1.0, uy)

    dx = np.zeros_like(ux); dy = np.zeros_like(ux)
    # 头部倾斜（整个头上半区域横向剪切）
    tilt = math.sin(t * 1.5) * 0.85
    dx += (uy - 0.5) * tilt * 0.30 * wHead
    # 呼吸：身体横向胀缩
    br = math.sin(t * 1.95)
    dx += (ux - 0.5) * 0.030 * br * (1 - wHead * 0.5)
    dy -= 0.014 * br * wHead
    # 重心摆动
    dx += 0.022 * math.sin(t * 0.62) * (1 - wBot * 0.85)
    # 耳朵跟随（滞后）
    dx += math.sin(t * 1.35) * 0.026 * wEar
    dy += math.cos(t * 1.35) * 0.016 * wEar
    # 尾巴
    dx += math.sin(t * 2.6) * 0.034 * wTail
    # 看向
    dx += math.sin(t * 0.9) * 0.055 * wHead
    dy += math.cos(t * 1.2) * 0.030 * wHead
    return dx * amp, dy * amp

def sample(img, sx, sy):
    H, W = img.shape[:2]
    sx = np.clip(sx, 0, W - 1.001); sy = np.clip(sy, 0, H - 1.001)
    x0 = sx.astype(np.int32); y0 = sy.astype(np.int32)
    x1 = np.minimum(x0 + 1, W - 1); y1 = np.minimum(y0 + 1, H - 1)
    fx = (sx - x0)[..., None]; fy = (sy - y0)[..., None]
    return (img[y0, x0] * (1 - fx) + img[y0, x1] * fx) * (1 - fy) + \
           (img[y1, x0] * (1 - fx) + img[y1, x1] * fx) * fy

def forward(ux, uy, t, amp=3.0):
    """正向映射：源 uv → 形变后画布坐标（0..1）"""
    dx, dy = displacement(ux, uy, t, amp)
    return ux + dx, uy + dy

def render(src, t, size=(460, 690), amp=3.0):
    img = np.asarray(src.convert('RGBA'), dtype=np.float32) / 255.0
    H, W = img.shape[:2]
    OW, OH = size
    ys, xs = np.mgrid[0:OH, 0:OW].astype(np.float32)
    uvx0 = (xs - OW / 2) / W + 0.5
    uvy0 = (ys - OH / 2) / H + 0.5
    uvx, uvy = uvx0.copy(), uvy0.copy()
    for _ in range(3):
        dx, dy = displacement(uvx, uvy, t, amp)
        uvx = uvx0 - dx
        uvy = uvy0 - dy
    out = sample(img, uvx * W, uvy * H)
    outside = (uvx < 0) | (uvx > 1) | (uvy < 0) | (uvy > 1)
    out[outside] = 0
    return out, (OW, OH, W, H)

def draw_grid(canvas, t, geom, amp=3.0, step=0.083):
    OW, OH, W, H = geom
    d = ImageDraw.Draw(canvas, 'RGBA')
    offx, offy = (OW - W) / 2, (OH - H) / 2
    def to_px(ux, uy):
        return (offx + ux * W, offy + uy * H)
    # 竖线
    for k in range(1, int(1 / step)):
        u = k * step
        pts = []
        for j in range(0, 41):
            uy = j / 40
            fx, fy = forward(np.array([u]), np.array([uy]), t, amp)
            pts.append(to_px(float(fx[0]), float(fy[0])))
        d.line(pts, fill=(36, 92, 73, 150), width=2)
    # 横线
    for k in range(1, int(1 / step)):
        v = k * step
        pts = []
        for i in range(0, 41):
            ux = i / 40
            fx, fy = forward(np.array([ux]), np.array([v]), t, amp)
            pts.append(to_px(float(fx[0]), float(fy[0])))
        d.line(pts, fill=(36, 92, 73, 150), width=2)

def main():
    src = Image.open(SRC)
    phases = [0.0, 1.7, 3.4]
    tiles = []
    for t in phases:
        warped, geom = render(src, t, size=(420, 620), amp=3.2)
        tile = Image.new('RGBA', (460, 700), (255, 250, 238, 255))
        a = warped[..., 3:4]
        rgb = (warped[..., :3] * 255).astype(np.uint8)
        fg = Image.fromarray(np.dstack([rgb, (a * 255).astype(np.uint8)]), 'RGBA')
        tile.alpha_composite(fg, (20, 40))
        draw_grid(tile, t, geom, amp=3.2)
        tiles.append(tile.convert('RGB'))

    pad, label_h = 18, 48
    W = sum(x.width for x in tiles) + pad * (len(tiles) + 1)
    H = max(x.height for x in tiles) + pad * 2 + label_h
    sheet = Image.new('RGB', (W, H), (255, 248, 236))
    d = ImageDraw.Draw(sheet)
    font = None
    for fp in ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf']:
        try: font = ImageFont.truetype(fp, 24); break
        except Exception: pass
    x = pad
    for tile, t in zip(tiles, phases):
        sheet.paste(tile, (x, pad + label_h))
        d.text((x + 10, pad + 12), f't = {t:.1f} s', fill=(36, 92, 73), font=font)
        x += tile.width + pad
    sheet.save(OUT)
    print('已输出', OUT, sheet.size)

if __name__ == '__main__':
    main()
