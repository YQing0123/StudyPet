"""Alpaca atlas -> normalized RGBA keys -> RIFE -> VP9 alpha pet pack.

Single-age pack. Reuses the same contracts as build-pet-growth.py:
512 canvas, body height 330, horizontal centre 246, sole line 450.
No generation/API calls happen here; the atlas and prompt are archived.
"""
import argparse
import hashlib
import importlib.util
import json
import sys
import types
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ATLAS = ROOT.parent / 'assets/pets-alpaca-atlas-raw.png'
WORK = ROOT.parent / 'output/alpaca-toon-20261114'
PACK = ROOT / 'assets/pets/alpaca_toon'
if not ATLAS.exists():
    ATLAS = PACK / 'source/atlas.png'
VERSION = '2026-11-14.alpaca-v1'
ROWS = ['sit', 'walk', 'eat', 'pet', 'play', 'hug', 'sleep', 'stretch']
FPS = 30
SIZE = 512

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--prepare', action='store_true')
parser.add_argument('--render', action='store_true')
parser.add_argument('--publish', action='store_true')
parser.add_argument('--walk-warp', action='store_true')
parser.add_argument('--walk-order', default='', help='comma separated key order, e.g. 3,2,1,0,5,4')
parser.add_argument('--rife-dir', type=Path, default=ROOT.parent / 'output/family-smooth-20261113/rife')
args = parser.parse_args()
WORK.mkdir(exist_ok=True, parents=True)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def matte(image):
    """Magenta key + contour despill + opaque interior.

    The key removes magenta, but the recovered colour leaves a green fringe on
    the silhouette because background magenta lacks green. Only the outer ring
    takes colour from the nearest interior pixel; painted cheeks and ears keep
    their own colour.
    """
    rgb = np.asarray(image.convert('RGB')).astype('float32') / 255
    dom = np.minimum(rgb[:, :, 0], rgb[:, :, 2]) - rgb[:, :, 1]
    alpha = np.clip((.52 - dom) / .34, 0, 1)
    alpha = alpha * alpha * (3 - 2 * alpha)
    n, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > .4).astype('uint8'), 8)
    keep = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > 75]
    support = cv2.dilate(np.isin(labels, keep).astype('uint8'), np.ones((3, 3), 'uint8'))
    alpha *= support
    foreground = np.clip((rgb - (1 - alpha[:, :, None]) * [1, 0, 1]) / np.maximum(alpha[:, :, None], .015), 0, 1)
    mask = (alpha >= .5).astype('uint8')
    inside = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    ring = (mask > 0) & (inside < 3)
    if ring.any():
        # Magenta has no green, so recovered edge pixels gain a green cast.
        # Clamp green to the magenta-implied baseline; keep painted cheeks.
        low = np.minimum(foreground[:, :, 0], foreground[:, :, 2])
        spill = ring & (low - foreground[:, :, 1] > .05)
        foreground[:, :, 1][spill] = (low[spill] * .985).clip(0, 1)
    alpha = np.where(mask > 0, 1, alpha)
    alpha[alpha < .35] = 0
    return np.dstack((foreground, alpha)).astype('float32')


def box(frame):
    y, x = np.where(frame[:, :, 3] > .4)
    if len(x) < 500:
        raise ValueError('Missing sprite in atlas')
    return int(x.min()), int(y.min()), int(x.max() + 1), int(y.max() + 1)


def prepare():
    atlas = Image.open(ATLAS)
    if atlas.size != (2048, 2048):
        raise ValueError(f'{ATLAS}: unexpected size {atlas.size}')
    full = matte(atlas)
    n, labels, stats, centers = cv2.connectedComponentsWithStats((full[:, :, 3] > .4).astype('uint8'), 8)
    bodies = sorted(range(1, n), key=lambda i: stats[i, 4], reverse=True)[:48]
    if len(bodies) != 48 or min(stats[i, 4] for i in bodies) < 3000:
        raise ValueError('Incomplete body grid')
    bodies.sort(key=lambda i: centers[i, 1])
    groups = [sorted(bodies[i:i + 6], key=lambda j: centers[j, 0]) for i in range(0, 48, 6)]
    ybounds = [0] + [round((max(stats[j, 1] + stats[j, 3] for j in groups[r - 1]) + min(stats[j, 1] for j in groups[r])) / 2) for r in range(1, 8)] + [2048]
    cells = {}
    for row, name in enumerate(ROWS):
        xbounds = [0] + [round((centers[groups[row][c - 1], 0] + centers[groups[row][c], 0]) / 2) for c in range(1, 6)] + [2048]
        cells[name] = [matte(atlas.crop((xbounds[c], ybounds[row], xbounds[c + 1], ybounds[row + 1]))) for c in range(6)]
    heights = [box(f)[3] - box(f)[1] for f in cells['sit']]
    scale = 330 / float(np.median(heights))
    normalized = {}
    for name, frames in cells.items():
        normalized[name] = []
        for frame in frames:
            x0, y0, x1, y1 = box(frame)
            # Body component anchors ignore the loose bowl/ball.
            n, labels, stats, _ = cv2.connectedComponentsWithStats((frame[:, :, 3] > .4).astype('uint8'), 8)
            body = stats[1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])]
            x, y, w, h, _ = body
            matrix = np.array([[scale, 0, 246 - (x + w / 2) * scale], [0, scale, 450 - y1 * scale]], 'float32')
            pre = frame.copy()
            pre[:, :, :3] *= pre[:, :, 3:4]
            fitted = cv2.warpAffine(pre, matrix, (SIZE, SIZE), flags=cv2.INTER_CUBIC).clip(0, 1)
            fitted[:, :, :3] /= np.maximum(fitted[:, :, 3:4], .001)
            normalized[name].append(fitted.clip(0, 1))
    if args.walk_order:
        order = [int(v) for v in args.walk_order.split(',')]
        normalized['walk'] = [normalized['walk'][i] for i in order]
    else:
        order = list(range(6))
    np.savez_compressed(WORK / 'keys.npz', **{k: np.stack(v) for k, v in normalized.items()})
    report = {'source': str(ATLAS.relative_to(ROOT.parent)), 'sha256': digest(ATLAS), 'model': 'gpt-image-2.6-sunburst',
              'quality': 'high', 'size': [2048, 2048], 'walkKeyOrder': order, 'scale': scale, 'extractedRowBoundaries': ybounds}
    (WORK / 'source.json').write_text(json.dumps(report, indent=2) + '\n')
    sheet = Image.new('RGB', (1536, 8 * 256), '#f6efdf')
    draw = ImageDraw.Draw(sheet)
    for row, name in enumerate(ROWS):
        for col, frame in enumerate(normalized[name]):
            im = Image.fromarray(np.round(frame * 255).astype('uint8')).resize((256, 256), Image.Resampling.LANCZOS)
            bg = Image.new('RGB', (256, 256), '#34463c' if col % 2 else '#f6efdf')
            bg.paste(im, (0, 0), im)
            sheet.paste(bg, (col * 256, row * 256))
            draw.text((col * 256 + 8, row * 256 + 6), f'{name} {col}', fill='#d1aa6d')
    sheet.save(WORK / 'review.jpg', quality=94)
    print('Prepared', WORK / 'review.jpg', flush=True)


def load_rife():
    import torch
    import torch.nn.functional as F
    weight = args.rife_dir / 'model.pkl'
    if digest(weight) != '6615790efd627772917205db291f51cd392528a157ecbb2ecaeec3bff8eb6de2':
        raise ValueError('Unexpected RIFE weight')
    device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
    torch.set_num_threads(4)

    def warp(image, flow):
        n, _, h, w = flow.shape
        x = torch.linspace(-1, 1, w, device=flow.device).view(1, 1, 1, w).expand(n, -1, h, -1)
        y = torch.linspace(-1, 1, h, device=flow.device).view(1, 1, h, 1).expand(n, -1, -1, w)
        grid = torch.cat((x, y), 1) + torch.cat((flow[:, :1] / ((w - 1) / 2), flow[:, 1:] / ((h - 1) / 2)), 1)
        return F.grid_sample(image, grid.clamp(-1, 1).permute(0, 2, 3, 1), mode='bilinear', padding_mode='zeros', align_corners=True)

    sys.modules['model'] = types.ModuleType('model')
    sys.modules['model.warplayer'] = types.ModuleType('model.warplayer')
    sys.modules['model.warplayer'].warp = warp
    spec = importlib.util.spec_from_file_location('rife_alpaca', args.rife_dir / 'IFNet_HDv3.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    net = mod.IFNet().eval()
    state = torch.load(weight, map_location='cpu', weights_only=True)
    net.load_state_dict({k.removeprefix('module.'): v for k, v in state.items() if not k.removeprefix('module.').startswith(('teacher.', 'caltime.'))}, strict=True)
    return torch, net.to(device), device, F


def action_keys(keys):
    return {
        'greet': (keys['sit'], 2.4, True),
        'walk': (keys['walk'], 1.2, True),
        'eat': (keys['eat'][:4], 1.6, False),
        'eatrev': (keys['eat'][3:], .8, False),
        'petted': (keys['pet'][:4], 1.6, False),
        'petted-out': (keys['pet'][3:], .7, False),
        'play': (keys['play'], 2.4, True),
        'hug': (keys['hug'], 2.2, False),
        'sleep': (keys['sleep'], 2.4, False),
        'wake': (keys['sleep'][::-1], 2., False),
        'stretch': (keys['stretch'], 2.6, False),
    }


# Four hooves are separate below y=405; above that the fleece is continuous.
# A smooth horizontal displacement field moves each leg on its own phase while
# the belly stays intact, so the character keeps one identity and no seam opens.
LEG_X = [149, 201, 271, 309]
LEG_PHASE = [0.0, 0.5, 0.75, 0.25]
STRIDE = 20.0
LIFT = 12.0


def encode(frames, path, fps=FPS):
    import subprocess
    raw = b''.join(f.tobytes() for f in frames)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '512x512', '-r', str(fps), '-i', '-',
                    '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-crf', '22', '-b:v', '0', str(path)],
                   input=raw, check=True)


def warp_walk(count=48):
    keys = np.load(WORK / 'keys.npz')
    pose = keys['walk'][0]
    Yg, Xg = np.mgrid[0:512, 0:512].astype('float32')
    sigma = 18.0
    weights = np.exp(-((Xg[None] - np.array(LEG_X)[:, None, None]) ** 2) / (2 * sigma ** 2))
    weights /= weights.sum(0, keepdims=True)
    ramp = np.clip((Yg - 398) / 32.0, 0, 1)
    ramp = ramp * ramp * (3 - 2 * ramp)
    premult = pose.copy()
    premult[:, :, :3] *= premult[:, :, 3:4]
    frames = []
    for i in range(count):
        t = i / count
        dx = np.zeros((512, 512), 'float32')
        dy = np.zeros((512, 512), 'float32')
        for j in range(4):
            p = (t + LEG_PHASE[j]) % 1
            if p < .68:
                sx = -STRIDE + 2 * STRIDE * (p / .68)
                sy = 0.0
            else:
                q = (p - .68) / .32
                sx = STRIDE * np.cos(np.pi * q)
                sy = LIFT * np.sin(np.pi * q) ** 2
            dx += weights[j] * sx
            dy += weights[j] * sy
        dx *= ramp
        dy *= ramp
        dy += (-2.0 * np.sin(4 * np.pi * t)) * (1 - ramp)
        out = cv2.remap(premult, Xg + dx, Yg + dy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        out[:, :, :3] /= np.maximum(out[:, :, 3:4], 1e-4)
        out[:, :, :3][out[:, :, 3] < .01] = 0
        frames.append(np.round(out.clip(0, 1) * 255).astype('uint8'))
    path = WORK / 'walk.alpha.webm'
    encode(frames, path)
    meta = {'frames': count, 'distinctFrames': len(set(hashlib.sha256(f.tobytes()).hexdigest() for f in frames)),
            'seconds': 1.6, 'keys': 1, 'method': 'four-hoof displacement field', 'sha256': digest(path)}
    (WORK / 'walk.json').write_text(json.dumps(meta))
    report_path = WORK / 'production.json'
    report = json.loads(report_path.read_text()) if report_path.exists() else {'fps': FPS, 'actions': {}}
    report['walk'] = meta
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    # Preview as a three-cycle GIF on a paper background.
    from PIL import Image
    thumbs = []
    for frame in frames * 3:
        im = Image.fromarray(frame).resize((384, 384))
        bg = Image.new('RGB', (384, 384), '#f6efdf')
        bg.paste(im, (0, 0), im)
        thumbs.append(bg)
    thumbs[0].save(WORK / 'walk-preview.gif', save_all=True, append_images=thumbs[1:], duration=33, loop=0)
    print('warped walk', count, meta['sha256'][:12], flush=True)



def render():
    torch, net, device, F = load_rife()
    keys = np.load(WORK / 'keys.npz')
    report = {'fps': FPS, 'method': 'RIFE 4.25; curated atlas keys, premultiplied RGBA; VP9 alpha', 'actions': {}}
    for name, (poses, seconds, loop) in action_keys(keys).items():
        if name == 'walk':
            continue
        path = WORK / f'{name}.alpha.webm'
        key_hash = hashlib.sha256(poses.tobytes()).hexdigest()
        if path.exists() and (WORK / f'{name}.json').exists():
            previous = json.loads((WORK / f'{name}.json').read_text())
            if previous.get('keySHA256') == key_hash:
                report['actions'][name] = previous
                continue
        tensors = []
        for pose in poses:
            pre = pose.copy()
            pre[:, :, :3] *= pre[:, :, 3:4]
            tensors.append(torch.from_numpy(pre.transpose(2, 0, 1).copy()).unsqueeze(0).to(device))
        count = round(seconds * FPS)
        frames = []
        with torch.inference_mode():
            for i in range(count):
                pos = i * len(poses) / count if loop else i * (len(poses) - 1) / (count - 1)
                index = min(int(pos), len(poses) - 1)
                t = pos - index
                if t < 1e-5:
                    frame = tensors[index]
                else:
                    frame = net(torch.cat((tensors[index], tensors[(index + 1) % len(poses)]), 1), timestep=t, scale_list=[16, 8, 4, 2, 1])[-1][-1]
                rgba = frame[0].detach().cpu().numpy().transpose(1, 2, 0).clip(0, 1)
                rgba[:, :, :3] /= np.maximum(rgba[:, :, 3:4], .015)
                rgba[:, :, :3][rgba[:, :, 3] < .01] = 0
                frames.append(np.round(rgba.clip(0, 1) * 255).astype('uint8'))
        encode(frames, path)
        meta = {'frames': count, 'distinctFrames': len(set(hashlib.sha256(f.tobytes()).hexdigest() for f in frames)),
                'seconds': seconds, 'keys': len(poses), 'sha256': digest(path), 'keySHA256': key_hash}
        (WORK / f'{name}.json').write_text(json.dumps(meta))
        report['actions'][name] = meta
        print('rendered', name, meta['frames'], flush=True)
    if (WORK / 'walk.json').exists():
        report['actions']['walk'] = json.loads((WORK / 'walk.json').read_text())
    (WORK / 'production.json').write_text(json.dumps(report, indent=2) + '\n')


def publish():
    keys = np.load(WORK / 'keys.npz')
    meta = json.loads((WORK / 'production.json').read_text())
    for d in ['frames', 'videos', 'source/prompts']:
        (PACK / d).mkdir(parents=True, exist_ok=True)
    poses = {'sit': keys['sit'][0], 'walk': keys['walk'][0], 'sleep': keys['sleep'][-1],
             'stretch': keys['stretch'][2], 'roll': keys['play'][2], 'jump': keys['hug'][2]}
    frames = []
    for name, pose in poses.items():
        path = f'frames/frame-{name}.png'
        Image.fromarray(np.round(pose * 255).astype('uint8')).save(PACK / path)
        frames.append({'key': name, 'file': path, 'bottom': round(box(pose)[3] / 512, 6)})
    videos = {}
    for name in meta['actions']:
        path = f'videos/{name}.alpha.webm'
        (PACK / path).write_bytes((WORK / f'{name}.alpha.webm').read_bytes())
        videos[name] = {'file': path, 'mode': 'alpha', 'bottom': round(450 / 512, 6)}
    videos['walk']['gait'] = {'stridePixels': round(2 * STRIDE, 1), 'supportSeconds': round(1.6 * .68, 3), 'canvasPixels': 512}
    sit = np.round(keys['sit'][0] * 255).astype('uint8')
    x0, y0, x1, y1 = box(keys['sit'][0])
    cx = int((x0 + x1) / 2)
    top = max(0, y0 - 8)
    Image.fromarray(sit).crop((cx - 128, top, cx + 128, min(512, top + 240))).resize((256, 240), Image.Resampling.LANCZOS).save(PACK / 'avatar.png')
    (PACK / 'source/atlas.png').write_bytes(ATLAS.read_bytes())
    (PACK / 'source/prompt.txt').write_text(PROMPT)
    (PACK / 'source/production.json').write_text(json.dumps(meta, indent=2) + '\n')
    spec = {
        'id': 'alpaca_toon', 'name': '羊驼', 'species': 'alpaca', 'walkTransitions': False,
        'avatar': 'avatar.png', 'frames': frames, 'videos': videos, 'version': VERSION,
    }
    (PACK / 'pet.json').write_text(json.dumps(spec, ensure_ascii=False, indent=2) + '\n')
    print('Published', PACK, VERSION, flush=True)


PROMPT = '''Use the reference image ONLY for the exact same character identity and watercolor style. Create a production 2D virtual pet animation sprite atlas. Output exactly 2048x2048 pixels, a STRICT REGULAR GRID of 6 equal columns and 8 equal rows = 48 separate full-body sprites. Cell boundaries x=0,341,683,1024,1365,1707,2048 and y=0,256,512,768,1024,1280,1536,1792,2048. Each cell contains exactly ONE full-body alpaca, centered horizontally, feet at 92 percent cell height, all ears/neck/body/legs/tail inside the cell with 12 percent clear padding. Absolutely no grid lines, labels, numbers, arrows or text. The SAME individual cream-white fluffy baby alpaca with sandy-beige back patch, banana ears with pink inner ear, big dark-brown eyes, rosy cheeks, soft brown painted contours, warm watercolor paper texture, 3/4 view facing RIGHT, camera fully locked at eye level. Same face, head size, fleece pattern and body proportions in EVERY cell. Correct animal anatomy: exactly four legs total; occluded legs may be hidden but never extra paws. Heads and limbs must not merge. Six columns are consecutive animation keyframes, not six different animals. Entire empty background must be SOLID FLAT CHROMA MAGENTA #FF00FF, no shadow, floor, scenery, paper or gradient. Rows from top to bottom: 1 GREETING: standing calmly, gentle breathing, one blink, small friendly head tilt, return to neutral standing. 2 WALK: six phases of a natural four-leg walking gait in place, constant body size and height, legs articulate with clear support and swing, no translation. 3 EAT: standing beside a small cream bowl of fresh green hay, lower the long neck, nibble, chew, lift head back, return. 4 PETTED: standing, tilt head and close eyes with enjoyment, relax, return, NO human hand. 5 PLAY: standing, lower one front leg and gently tap a small sage green ball, lean forward, return. Keep exactly two front legs; hide the occluded far front leg. 6 HUG: sit upright on hind quarters, bring both front legs toward the chest in a self-hug, happy closed eyes, gently lean, return, NO person, NO other animal, no floating hearts. 7 SLEEP: standing awake, lower the body, lie curled on the ground with eyes closing, finish lying asleep, same fleece throughout. 8 STRETCH: standing, front legs extend forward and shoulders lower into a long low stretch with neck extended forward, then return to neutral standing. Six consecutive poses must visibly differ by articulated neck/head/limb/body movement, not just position or scaling. End poses reconnect to the neutral standing greeting. No floating marks, accessories outside the body, silhouettes, missing cells, text or watermark.'''

if __name__ == '__main__':
    if args.prepare:
        prepare()
    if args.walk_warp:
        warp_walk()
    if args.render:
        render()
    if args.publish:
        publish()
