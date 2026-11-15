"""离线渲染网格变形动画帧：验证"单张立绘 + 自动变形"能否产生自然生命感。
与浏览器版使用同一套位移公式，确保所见即所得。"""
import math, sys
import numpy as np
from PIL import Image

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)

def displacement(uvx, uvy, t, look=(0.0, 0.0), blink=0.0, energy=0.0):
    """返回 uv 空间位移 d=(dx,dy)，与 GLSL 版逐项一致。"""
    wHead  = 1.0 - smoothstep(0.30, 0.52, uvy)
    wEarL  = 1.0 - smoothstep(0.10, 0.30, uvx)
    wEarR  = smoothstep(0.70, 0.90, uvx)
    wEar   = (wEarL + wEarR) * wHead
    wTail  = smoothstep(0.05, 0.30, 0.25 - np.abs(uvy - 0.62)) * (1.0 - smoothstep(0.18, 0.40, uvx))
    wBot   = smoothstep(0.55, 1.0, uvy)

    dx = np.zeros_like(uvx); dy = np.zeros_like(uvx)

    br = math.sin(t * 1.95)
    dx += (uvx - 0.5) * 0.012 * br * (1.0 - wHead * 0.5)
    dy -= 0.006 * br * wHead

    sw = math.sin(t * 0.62)
    dx += 0.008 * sw * (1.0 - wBot * 0.85)

    dx += look[0] * 0.030 * wHead
    dy += look[1] * 0.016 * wHead
    dx += math.sin(t * 0.9) * 0.004 * wHead

    fl = math.sin(t * 1.35)
    dx += fl * 0.010 * wEar
    dy += math.cos(t * 1.35) * 0.006 * wEar

    dx += math.sin(t * 2.6) * 0.014 * wTail
    dy += math.cos(t * 2.6) * 0.006 * wTail

    band = smoothstep(0.16, 0.22, uvy) * (1.0 - smoothstep(0.27, 0.33, uvy))
    dy += (0.245 - uvy) * 0.85 * band * blink

    dy -= 0.030 * energy * (1.0 - smoothstep(0.6, 1.0, uvy))
    return dx, dy

def sample_bilinear(img, sx, sy):
    H, W = img.shape[:2]
    sx = np.clip(sx, 0, W - 1.001); sy = np.clip(sy, 0, H - 1.001)
    x0 = sx.astype(np.int32); y0 = sy.astype(np.int32)
    x1 = np.minimum(x0 + 1, W - 1); y1 = np.minimum(y0 + 1, H - 1)
    fx = sx - x0; fy = sy - y0
    fx = fx[..., None]; fy = fy[..., None]
    p00 = img[y0, x0]; p10 = img[y0, x1]; p01 = img[y1, x0]; p11 = img[y1, x1]
    top = p00 * (1 - fx) + p10 * fx
    bot = p01 * (1 - fx) + p11 * fx
    return top * (1 - fy) + bot * fy

def render(img, t, look=(0,0), blink=0.0, energy=0.0, pad=0.0, scale=1.0):
    src = img.astype(np.float32) / 255.0
    H, W = src.shape[:2]
    # 输出画布略放大，留出形变余量
    m = 1.18
    OW, OH = int(W * m), int(H * m)
    ys, xs = np.mgrid[0:OH, 0:OW].astype(np.float32)
    # 反算基准 uv（正向: px = offset + ((uv-0.5)*size)）
    uvx0 = (xs - OW / 2.0) / W + 0.5
    uvy0 = (ys - OH / 2.0) / H + 0.5
    # 迭代反解（位移较小，3 次足够收敛）
    uvx, uvy = uvx0.copy(), uvy0.copy()
    for _ in range(3):
        dx, dy = displacement(uvx, uvy, t, look, blink, energy)
        uvx = uvx0 - dx
        uvy = uvy0 - dy
    out = sample_bilinear(src, uvx * W, uvy * H)
    # 越界处透明
    outside = (uvx < 0) | (uvx > 1) | (uvy < 0) | (uvy > 1)
    out[outside] = 0.0
    return out

if __name__ == '__main__':
    pet = np.array(Image.open('prototype/assets/pet_idle.png').convert('RGBA'))
    # 动画序列：待机循环 6 帧
    frames = []
    for i, t in enumerate(np.linspace(0, 6.2, 6)):
        frames.append(render(pet, t))
    # 拼成横向序列，米色纸底
    pad = 8
    fh, fw = frames[0].shape[:2]
    sheet = np.ones((fh, (fw + pad) * len(frames), 4), np.float32)
    sheet[..., 0] = 0.976; sheet[..., 1] = 0.973; sheet[..., 2] = 0.925; sheet[..., 3] = 1.0
    for i, f in enumerate(frames):
        x = i * (fw + pad)
        a = f[..., 3:4]
        sheet[:, x:x + fw, :3] = f[..., :3] * a + sheet[:, x:x + fw, :3] * (1 - a)
    Image.fromarray((sheet * 255).astype(np.uint8)).save('prototype/预览-待机序列.png')
    print("待机序列已输出")

    # 交互帧：看向左下 + 眨眼
    solo = []
    specs = [((0,0),0.0,"待机"), ((-0.9,0.8),0.0,"看左下"), ((0,0),1.0,"眨眼"),
             ((0.9,-0.6),0.0,"看右上"), ((0,0),0.0,"回正")]
    for look, bl, name in specs:
        solo.append(render(pet, 1.2, look=look, blink=bl))
    sh = np.ones((fh, (fw + pad) * len(solo), 4), np.float32)
    sh[..., 0] = 0.976; sh[..., 1] = 0.973; sh[..., 2] = 0.925; sh[..., 3] = 1.0
    for i, f in enumerate(solo):
        x = i * (fw + pad); a = f[..., 3:4]
        sh[:, x:x + fw, :3] = f[..., :3] * a + sh[:, x:x + fw, :3] * (1 - a)
    Image.fromarray((sh * 255).astype(np.uint8)).save('prototype/预览-交互状态.png')
    print("交互状态已输出")
