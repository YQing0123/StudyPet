"""Rebuild alpaca walk/play/petting/stretch/hug without crossfade ghosts.

The atlas keys are retained. Each action is driven by ONE cleaned texture
(or, for walk, four independent foot layers) with invertible deformations.
Interiors stay fully opaque, hind soles stay on the ground line, and no
frame-to-frame RGBA crossfade is used. Run --build, review the contact
sheets, then verify before publishing.
"""
import argparse
import hashlib
import json
import math
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT.parent / 'output/alpaca-motion-repair-20261115'
KEYS = ROOT.parent / 'output/alpaca-toon-20261114/keys.npz'
PACK = ROOT / 'assets/pets/alpaca_toon'
VERSION = '2026-11-15.alpaca-motion-v2'
FPS = 30
SIZE = 512
Y, X = np.mgrid[:SIZE, :SIZE].astype('float32')

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--build', action='store_true')
parser.add_argument('--publish', action='store_true')
parser.add_argument('--publish-only', action='store_true')
args = parser.parse_args()
WORK.mkdir(parents=True, exist_ok=True)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def clean(pose):
    """Opaque interior, one-pixel AA edge, colour padded before resampling."""
    mask = (pose[:, :, 3] >= .5).astype('uint8')
    inside = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    outside = cv2.distanceTransform(1 - mask, cv2.DIST_L2, 5)
    alpha = np.clip((inside - outside) * .5 + .5, 0, 1).astype('float32')
    rgb = pose[:, :, :3].copy()
    _, labels = cv2.distanceTransformWithLabels(1 - mask, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    fg = np.argwhere(mask)
    idx = np.clip(labels - 1, 0, len(fg) - 1)
    nearest_y, nearest_x = fg[idx][:, :, 0], fg[idx][:, :, 1]
    rgb[mask == 0] = rgb[nearest_y[mask == 0], nearest_x[mask == 0]]
    # Chroma residue only on the outer contour; painted cheeks stay intact.
    edge = (inside < 3)
    low = np.minimum(rgb[:, :, 0], rgb[:, :, 2])
    spill = edge & (low - rgb[:, :, 1] > .05)
    rgb[:, :, 1][spill] = (low[spill] * .985).clip(0, 1)
    return np.dstack((rgb * alpha[:, :, None], alpha)).astype('float32')


def rgba(frame):
    out = frame.copy()
    out[:, :, :3] /= np.maximum(out[:, :, 3:4], 1e-5)
    mask = (out[:, :, 3] >= .5).astype('uint8')
    interior = cv2.erode(mask, np.ones((3, 3), 'uint8')).astype(bool)
    out[:, :, 3][mask == 0] = 0
    out[:, :, 3][interior] = 1
    out[:, :, :3][out[:, :, 3] < .001] = 0
    return np.round(out.clip(0, 1) * 255).astype('uint8')


def remap(frame, sx, sy):
    return cv2.remap(frame, sx.astype('float32'), sy.astype('float32'), cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_CONSTANT)


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def bend(layer, dx, dy, root, ankle):
    """Invertible y->y+dy*w(y) and x->x+dx*w(y); the limb root never moves."""
    sy = Y.copy()
    for _ in range(12):
        t = np.clip((sy - root) / (ankle - root), 0, 1)
        w = smooth(t)
        derivative = 1 + dy * 6 * t * (1 - t) / (ankle - root)
        sy -= (sy + dy * w - Y) / np.maximum(derivative, .15)
    return remap(layer, X - dx * smooth((sy - root) / (ankle - root)), sy)


def lean(frame, dx=0, dy=0, angle=0, anchor=400):
    """Feet and hips below anchor stay put; the body above blends smoothly."""
    w = smooth((anchor - Y) / (anchor - 315))
    a = angle * math.pi / 180 * w
    cx, cy = 250, 350
    sx = cx + np.cos(a) * (X - cx) + np.sin(a) * (Y - cy) - dx * w
    sy = cy - np.sin(a) * (X - cx) + np.cos(a) * (Y - cy) - dy * w
    return remap(frame, sx, sy)


def over(back, front):
    return front + back * (1 - front[:, :, 3:4])


def stride(phase, amplitude=20., lift=12., duty=.68):
    p = phase % 1
    if p < duty:
        return -amplitude + 2 * amplitude * (p / duty), 0., 'support'
    q = (p - duty) / (1 - duty)
    return amplitude * math.cos(math.pi * q), -lift * math.sin(math.pi * q) ** 2, 'swing'


def foot_layers(source):
    """Four hooves separate below y=405; roots stay attached to the belly."""
    mask = (source[:, :, 3] > .5).astype('uint8')
    sub = np.zeros_like(mask)
    sub[405:] = mask[405:]
    n, labels, stats, centers = cv2.connectedComponentsWithStats(sub, 8)
    legs = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > 300]
    if len(legs) != 4:
        raise ValueError(f'expected four hooves, found {len(legs)}')
    legs.sort(key=lambda i: centers[i, 0])
    cuts = [0] + [int(round((centers[a, 0] + centers[b, 0]) / 2)) for a, b in zip(legs, legs[1:])] + [512]
    layers, body = [], source.copy()
    feather = smooth((Y - 399) / 6)[:, :, None]
    for i, leg in enumerate(legs):
        window = (X >= cuts[i]) & (X < cuts[i + 1])
        layer = source * (window & (Y >= 399))[:, :, None] * feather
        body[window & (Y >= 405)] = 0
        layers.append(layer)
    return body, layers, [int(stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT]) for i in legs]


def walk_frames(source, count=48):
    """Rigid leg swing about the hip: short legs must not shear into rubber."""
    body, layers, soles = foot_layers(source)
    offsets = [0., .5, .75, .25]
    centers = []
    for layer in layers:
        ys, xs = np.where(layer[:, :, 3] > .5)
        centers.append(float(xs.mean()))
    frames, trace = [], []
    for i in range(count):
        t = i / count
        moved, feet = [], []
        for j, layer in enumerate(layers):
            dx, dy, state = stride(t + offsets[j], amplitude=13., lift=6.)
            length = max(1.0, 449 - 405)
            angle = math.degrees(math.asin(max(-.45, min(.45, dx / length))))
            m = cv2.getRotationMatrix2D((centers[j], 405), angle, 1.0)
            m[1, 2] += dy
            moved.append(cv2.warpAffine(layer, m, (SIZE, SIZE), flags=cv2.INTER_LINEAR,
                                        borderMode=cv2.BORDER_CONSTANT))
            feet.append({'dx': round(dx, 3), 'soleY': round(449 + dy, 3), 'angle': round(angle, 2), 'phase': state})
        canvas = np.zeros_like(source)
        for j in (1, 3):
            canvas = over(canvas, moved[j])
        canvas = over(canvas, body)
        for j in (0, 2):
            canvas = over(canvas, moved[j])
        canvas = lean(canvas, dy=-1.4 * math.sin(4 * math.pi * t), angle=.35 * math.sin(2 * math.pi * t))
        frames.append(rgba(canvas))
        trace.append(feet)
    return frames, trace


def green_blob(image):
    """Detached toy: take the whole alpha component, outline included."""
    rgb = image[:, :, :3] / np.maximum(image[:, :, 3:4], 1e-5)
    green = ((rgb[:, :, 1] > rgb[:, :, 0] + .015) & (rgb[:, :, 1] > rgb[:, :, 2] + .04) &
             (image[:, :, 3] > .5) & (Y > 380)).astype('uint8')
    n, labels, stats, centers = cv2.connectedComponentsWithStats(green, 8)
    if n < 2:
        raise ValueError('no ball found')
    blob = max(range(1, n), key=lambda i: stats[i, 4])
    green_mask = (labels == blob)
    body_n, body_labels, body_stats, _ = cv2.connectedComponentsWithStats((image[:, :, 3] > .5).astype('uint8'), 8)
    touching = np.unique(body_labels[green_mask])
    touching = [int(i) for i in touching if i > 0]
    if touching and body_stats[touching[0], cv2.CC_STAT_AREA] < 4000:
        mask = (body_labels == touching[0])
    else:
        mask = cv2.dilate(green_mask.astype('uint8'), np.ones((7, 7), 'uint8')).astype(bool)
    return mask, (float(centers[blob, 0]), float(centers[blob, 1]))


def ball_parts(source, ball_source):
    """Take a complete detached toy; remove the old toy without eating the paw."""
    old_mask, old_center = green_blob(source)
    sprite_mask, _ = green_blob(ball_source)
    ball = ball_source * sprite_mask[:, :, None]
    pet = source.copy()
    pet[old_mask] = 0
    return pet, ball, old_center


def play_frames(source, ball_source, count=72):
    pet, ball, center = ball_parts(source, ball_source)
    frames = []
    for i in range(count):
        t = i / count
        # Paw tap: small connected-arm deformation, never a cut.
        tap = math.sin(2 * math.pi * t) ** 2
        w = smooth((X - 250) / 80) * smooth((Y - 360) / 40) * (1 - smooth((Y - 440) / 20))
        head = smooth((360 - Y) / 90) * smooth((X - 150) / 90) * (1 - smooth((X - 400) / 40))
        pet_frame = remap(pet, X - (4 * tap * w + 3 * tap * head), Y + (3 * tap * w + 9 * tap * head))
        pet_frame = lean(pet_frame, dx=1.5 * tap, dy=-1.2 * tap, angle=-1.0 * tap)
        travel = .5 - .5 * math.cos(2 * math.pi * t)
        bx = center[0] + 30 * travel
        by = center[1] - 6 * math.sin(math.pi * travel)
        ball_frame = remap(ball, X + (bx - center[0]), Y + (by - center[1]))
        frames.append(rgba(over(ball_frame, pet_frame)))
    return frames


def pet_frames(source, count=48, out_count=21):
    frames = []
    for i in range(count):
        t = i / (count - 1)
        settle = float(smooth(t / .25))
        nuzzle = math.sin(2 * math.pi * t * 1.5) * math.sin(math.pi * t) ** 2
        frames.append(rgba(lean(source, dx=4 * settle + 5 * nuzzle, dy=-4 * settle - 2 * nuzzle,
                                angle=2.0 * settle + 1.5 * nuzzle)))
    ending = []
    for i in range(out_count):
        q = float(1 - smooth(i / (out_count - 1)))
        ending.append(rgba(lean(source, dx=4 * q, dy=-4 * q, angle=2.0 * q)))
    return frames, ending


def stretch_frames(source, count=60):
    frames = []
    for i in range(count):
        t = i / (count - 1)
        strain = float(math.sin(math.pi * t) ** 2)
        w = smooth((X - 210) / 100) * smooth((Y - 300) / 80)
        frame = remap(source, X - 6 * strain * w, Y)
        frame = lean(frame, angle=-.5 * strain, anchor=430)
        frames.append(rgba(frame))
    return frames


def hug_frames(stand, sit, count=60):
    # The action starts from the sitting hug pose: one clean cut, no crossfade.
    hug = []
    for i in range(count):
        t = i / (count - 1)
        press = float(math.sin(math.pi * t) ** 2)
        hug.append(rgba(lean(sit, dx=1.5 * press, dy=-2 * press, angle=1.2 * press, anchor=420)))
    return hug


def encode(path, frames):
    raw = b''.join(f.tobytes() for f in frames)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba',
                    '-s', f'{SIZE}x{SIZE}', '-r', str(FPS), '-i', '-', '-an', '-c:v', 'libvpx-vp9',
                    '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-lossless', '1', '-b:v', '0', str(path)],
                   input=raw, check=True)


def preview(dest, name, frames):
    font = None
    for fp in ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/Hiragino Sans GB.ttc']:
        try:
            font = ImageFont.truetype(fp, 18)
            break
        except Exception:
            pass
    cols, rows = 8, 3
    sheet = Image.new('RGB', (cols * 256, rows * 256), '#34463c')
    draw = ImageDraw.Draw(sheet)
    for j in range(cols * rows):
        i = round(j * (len(frames) - 1) / (cols * rows - 1))
        im = Image.fromarray(frames[i]).resize((256, 256), Image.Resampling.LANCZOS)
        bg = Image.new('RGB', (256, 256), '#34463c' if j % 2 else '#f6efdf')
        bg.paste(im, (0, 0), im)
        sheet.paste(bg, (j % cols * 256, j // cols * 256))
        draw.text((j % cols * 256 + 8, j // cols * 256 + 6), f'{name} {i}', fill='#c79a53', font=font)
    sheet.save(dest / f'{name}-contact.jpg', quality=94)
    gif = []
    for f in frames:
        im = Image.fromarray(f).resize((384, 384), Image.Resampling.LANCZOS)
        bg = Image.new('RGB', (384, 384), '#f6efdf')
        bg.paste(im, (0, 0), im)
        gif.append(bg)
    gif[0].save(dest / f'{name}-preview.gif', save_all=True, append_images=gif[1:],
                duration=[33] * len(gif), loop=0)


def build():
    keys = np.load(KEYS)
    dest = WORK
    dest.mkdir(parents=True, exist_ok=True)
    sources = {
        'walk': clean(keys['sit'][0]),
        'play': clean(keys['play'][5]),
        'petted': clean(keys['pet'][2]),
        'stretch': clean(keys['stretch'][2]),
        'hug': clean(keys['hug'][3]),
    }
    walk, trace = walk_frames(sources['walk'])
    pet, ending = pet_frames(sources['petted'])
    actions = {
        'walk': walk,
        'play': play_frames(sources['play'], clean(keys['play'][0])),
        'petted': pet,
        'petted-out': ending,
        'stretch': stretch_frames(sources['stretch']),
        'hug': hug_frames(clean(keys['hug'][0]), sources['hug']),
    }
    report = {'version': VERSION,
              'method': 'single opaque textures; independent hoof layers; invertible deformation; lossless VP9 alpha',
              'sourceKeys': str(KEYS.relative_to(ROOT.parent)), 'sourceSHA256': sha(KEYS),
              'sourceModel': 'gpt-image-2.6-sunburst', 'sourceQuality': 'high', 'fps': FPS,
              'walkDutyFactor': .68, 'walkPhases': [0, .5, .75, .25], 'actions': {}}
    for name, frames in actions.items():
        path = dest / f'{name}.alpha.webm'
        encode(path, frames)
        preview(dest, name, frames)
        np.savez_compressed(dest / f'{name}-frames.npz', frames=np.stack(frames))
        report['actions'][name] = {'frames': len(frames), 'seconds': round(len(frames) / FPS, 3),
                                   'sha256': sha(path),
                                   'distinctFrames': len({hashlib.sha256(f.tobytes()).hexdigest() for f in frames})}
        print(name, len(frames), flush=True)
    np.savez_compressed(dest / 'sources.npz', **sources)
    (dest / 'walk-foot-trajectories.json').write_text(json.dumps(trace))
    Image.fromarray(walk[0]).save(dest / 'frame-walk.png')
    Image.fromarray(actions['play'][0]).save(dest / 'frame-roll.png')
    (dest / 'production.json').write_text(json.dumps(report, indent=2) + '\n')


def publish():
    verification = json.loads((WORK / 'verification.json').read_text())
    verified = {c['action']: c['sha256'] for c in verification['clips']}
    report = json.loads((WORK / 'production.json').read_text())
    if not (WORK / 'backup').exists():
        shutil.copytree(PACK, WORK / 'backup')
    spec = json.loads((PACK / 'pet.json').read_text())
    for action, meta in report['actions'].items():
        source = WORK / f'{action}.alpha.webm'
        assert sha(source) == meta['sha256']
        assert verified[action] == meta['sha256'], 'Run verify-alpaca-motion.py after rebuilding.'
        shutil.copy2(source, PACK / 'videos' / source.name)
        spec['videos'][action]['sha256'] = meta['sha256']
    spec['videos']['walk']['gait'] = {'stridePixels': 26, 'supportSeconds': round(1.6 * .68, 3), 'canvasPixels': 512}
    shutil.copy2(WORK / 'frame-walk.png', PACK / 'frames/frame-walk.png')
    shutil.copy2(WORK / 'frame-roll.png', PACK / 'frames/frame-roll.png')
    spec['frames'] = [dict(f, bottom=round(449 / 512, 6)) if f['key'] in ('walk', 'roll') else f for f in spec['frames']]
    shutil.copy2(WORK / 'production.json', PACK / 'source/motion-repair-v2.json')
    shutil.copy2(WORK / 'walk-foot-trajectories.json', PACK / 'source/walk-foot-trajectories-v2.json')
    spec['version'] = VERSION
    (PACK / 'pet.json').write_text(json.dumps(spec, ensure_ascii=False, indent=2) + '\n')
    print('Published', VERSION, flush=True)


if __name__ == '__main__':
    if args.build:
        build()
    if args.publish or args.publish_only:
        publish()
