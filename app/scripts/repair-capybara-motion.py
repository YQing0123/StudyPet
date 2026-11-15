"""Rebuild capybara care/gait clips from a single texture per action.

The sunburst source art is retained. Animation uses independent opaque limb
layers and invertible deformations, never optical-flow or RGBA crossfades.
Run without --publish to review; publishing only touches this breed's four
repaired actions and their two static fallbacks.
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
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / 'output/capybara-motion-repair-20261114'
PACK = ROOT / 'app/assets/pets/capybara_toon'
VERSION = '2026-11-14.capybara-motion-v2'
FPS = 30
SIZE = 512
Y, X = np.mgrid[:SIZE, :SIZE].astype('float32')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean(pose):
    """Opaque interior, one-pixel AA edge, colour padding before resampling."""
    mask = (pose[:, :, 3] >= .5).astype('uint8')
    inside = distance_transform_edt(mask)
    outside, nearest = distance_transform_edt(1-mask, return_indices=True)
    alpha = np.clip((inside-outside)*.5+.5, 0, 1).astype('float32')
    rgb = pose[:, :, :3].copy()
    rgb[mask == 0] = rgb[nearest[0][mask == 0], nearest[1][mask == 0]]
    # Remove chroma-key residue only on the outer contour, preserving painted
    # pink cheeks/ears and all of the interior watercolor texture.
    _, core = distance_transform_edt(inside < 3, return_indices=True)
    spill = (inside < 3) & (np.minimum(rgb[:, :, 0], rgb[:, :, 2])-rgb[:, :, 1] > .065)
    rgb[spill] = rgb[core[0][spill], core[1][spill]]
    pink_edge = (inside < 5) & (rgb[:, :, 2] > rgb[:, :, 1])
    rgb[:, :, 2][pink_edge] = rgb[:, :, 1][pink_edge]*.85
    return np.dstack((rgb*alpha[:, :, None], alpha)).astype('float32')


def over(back, front):
    return front + back*(1-front[:, :, 3:4])


def rgba(frame):
    out = frame.copy()
    out[:, :, :3] /= np.maximum(out[:, :, 3:4], 1e-5)
    # Only the one-pixel silhouette may be antialiased. Fix subpixel cracks at
    # touching layer roots; never fade a body/limb interior during animation.
    mask = (out[:, :, 3] >= .5).astype('uint8')
    interior = cv2.erode(mask, np.ones((3, 3), 'uint8')).astype(bool)
    out[:, :, 3][mask == 0] = 0
    out[:, :, 3][interior] = 1
    out[:, :, :3][out[:, :, 3] < .001] = 0
    return np.round(out.clip(0, 1)*255).astype('uint8')


def remap(frame, sx, sy):
    return cv2.remap(frame, sx.astype('float32'), sy.astype('float32'), cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_CONSTANT)


def smooth(t):
    t = np.clip(t, 0, 1)
    return t*t*(3-2*t)


def bend(layer, dx, dy, root, ankle):
    # Invert monotonic y -> y + dy*w(y). Inversion prevents stretched duplicate
    # contours; source-over ensures that overlapping solid limbs remain solid.
    sy = Y.copy()
    for _ in range(12):
        t = np.clip((sy-root)/(ankle-root), 0, 1)
        w = smooth(t)
        derivative = 1 + dy*6*t*(1-t)/(ankle-root)
        sy -= (sy+dy*w-Y)/np.maximum(derivative, .15)
    return remap(layer, X-dx*smooth((sy-root)/(ankle-root)), sy)


def affine(frame, dx=0, dy=0, angle=0, pivot=(256, 350)):
    m = cv2.getRotationMatrix2D(pivot, angle, 1)
    m[:, 2] += [dx, dy]
    return cv2.warpAffine(frame, m, (SIZE, SIZE), flags=cv2.INTER_LINEAR)


def lean(frame, dx=0, dy=0, angle=0, anchor=405):
    # Feet and hips below the anchor do not move. The head is rigid above 320;
    # the neck/torso blends into the seated body with a continuous weight.
    w = smooth((anchor-Y)/(anchor-315))
    a = angle*math.pi/180*w
    cx, cy = 250, 350
    # Small angles (< 4deg) have a positive Jacobian across this deformation.
    sx = cx + np.cos(a)*(X-cx) + np.sin(a)*(Y-cy) - dx*w
    sy = cy - np.sin(a)*(X-cx) + np.cos(a)*(Y-cy) - dy*w
    return remap(frame, sx, sy)


def stride(phase, amplitude=20., lift=19., duty=.68):
    """Four-beat walk: support/backward push, toe-off, forward swing, landing.

    Cubic swing matches the stance velocity at both contacts; sin² height has
    zero vertical velocity at toe-off and landing. No duplicate end frame.
    """
    p = phase % 1
    if p < duty:
        return amplitude*(1-2*p/duty), 0., 'support'
    q = (p-duty)/(1-duty)
    m = -2*amplitude*(1-duty)/duty
    x = -amplitude + m*q + (6*amplitude-3*m)*q*q + (-4*amplitude+2*m)*q*q*q
    return x, -lift*math.sin(math.pi*q)**2, 'swing'


def walk_rig(source, stage):
    xoff = [0, -2, 0, 4, 6, 4][stage-1]
    # Cut below the existing belly, where the four paws have distinct contours.
    # Their roots overlap the fixed body by 11px; that overlap never moves.
    limits = [(80, 156), (156, 219), (219, 280), (280, 350)]
    body = source.copy()
    body[399:] = 0
    limbs = []
    for lo, hi in limits:
        mask = (X >= lo+xoff) & (X < hi+xoff) & (Y >= 388)
        layer = source*mask[:, :, None]
        limbs.append(layer)
    return body, limbs


def walk_frames(source, stage, count=48):
    body, limbs = walk_rig(source, stage)
    # Order: near hind, far hind, near fore, far fore. Left/right pairs are
    # offset by half a stride; fore/hind contacts are a quarter stride apart.
    offsets = [0., .5, .75, .25]
    # Baseline sole locations measured from the source, not guessed per frame.
    soles = [int(np.where(l[:, :, 3] > .5)[0].max()) for l in limbs]
    trace = []
    frames = []
    for i in range(count):
        phase = i/count
        moved = []
        feet = []
        for j, layer in enumerate(limbs):
            dx, dy, state = stride(phase+offsets[j], 22,
                                   17 if j in [1, 3] else 21)
            target = 440 if j in [1, 3] else 449
            delta_y = target-soles[j]+dy
            moved.append(bend(layer, dx, delta_y, 400, soles[j]-4))
            feet.append({'x': round(dx, 5), 'soleY': round(target+dy, 5), 'phase': state})
        canvas = np.zeros_like(source)
        for j in [1, 3]:
            canvas = over(canvas, moved[j])
        canvas = over(canvas, body)
        for j in [0, 2]:
            canvas = over(canvas, moved[j])
        canvas = lean(canvas, dy=-1.2*math.sin(4*math.pi*phase),
                      angle=.35*math.sin(2*math.pi*phase), anchor=400)
        frames.append(rgba(canvas))
        trace.append(feet)
    return frames, trace


def play_frames(source, ball_source, count=84):
    # The intact reaching pose supplies the body; a detached complete ball from
    # the same generated atlas supplies the toy. No missing belly is invented.
    n, labels, stats, centers = cv2.connectedComponentsWithStats((ball_source[:, :, 3] > .5).astype('uint8'), 8)
    ball_id = max([i for i in range(1, n) if centers[i, 0] > 330], key=lambda i: stats[i, 4])
    ball_mask = (labels == ball_id).astype('uint8')
    ball_mask = cv2.dilate(ball_mask, np.ones((3, 3), 'uint8')).astype(bool)
    ball = ball_source*ball_mask[:, :, None]
    rgb = source[:, :, :3]/np.maximum(source[:, :, 3:4], 1e-5)
    green = ((rgb[:, :, 1] > rgb[:, :, 0]+.02) & (rgb[:, :, 1] > rgb[:, :, 2]+.10) &
             (source[:, :, 3] > .5) & (X > 315) & (Y > 350)).astype('uint8')
    n, glabel, gstat, gc = cv2.connectedComponentsWithStats(green, 8)
    gid = max([j for j in range(1, n) if gc[j, 0] > 350], key=lambda j: gstat[j, 4])
    gx, gy, gw, gh, _ = gstat[gid]
    cx, cy = gx+gw/2, gy+gh-37
    old_ball = ((X-cx)/(gw/2+8))**2 + ((Y-cy)/46)**2 < 1
    brown = ((X < cx-15) & (Y < cy+8) & (rgb[:, :, 0] > rgb[:, :, 1]+.07)).astype('uint8')
    palm = cv2.morphologyEx(brown, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    palm = cv2.dilate(palm, np.ones((3, 3), 'uint8')).astype(bool)
    pet = source*(~(old_ball & ~palm))[:, :, None]
    # Delete only detached fragments of the old toy's outline.
    n, lab, st, _ = cv2.connectedComponentsWithStats((pet[:, :, 3] > .3).astype('uint8'), 8)
    body_id = 1+np.argmax(st[1:, 4])
    support = cv2.dilate((lab == body_id).astype('uint8'), np.ones((3, 3), 'uint8'))
    pet *= support[:, :, None]
    support = cv2.morphologyEx((pet[:, :, 3] > .5).astype('uint8'), cv2.MORPH_OPEN,
                               cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    pet *= support[:, :, None]
    frames = []
    ball_center = tuple(map(float, centers[ball_id]))
    for i in range(count):
        p = i/(count-1)
        reach = float(smooth(p/.24)) if p < .24 else float(1-smooth((p-.32)/.27))
        # Contact at .24-.32, a small bouncing roll away, then return.
        travel = float(smooth((p-.28)/.28)*(1-smooth((p-.63)/.32)))
        # Deform the complete connected arm instead of cutting it off the
        # torso. This small bijective warp keeps the palm attached and solid.
        w = smooth((X-250)/85)*smooth((Y-350)/35)*(1-smooth((Y-413)/22))
        pet_frame = remap(pet, X-7*reach*w, Y+5*reach*w)
        pet_frame = lean(pet_frame, dx=3*reach, dy=-2*reach, angle=-1.5*reach)
        ball_frame = affine(ball, dx=cx-ball_center[0]+70*travel+5*reach,
                            dy=cy-ball_center[1]-5*math.sin(math.pi*travel),
                            angle=-70*travel, pivot=ball_center)
        frames.append(rgba(over(ball_frame, pet_frame)))
    return frames


def pet_frames(source, count=60, out_count=27):
    frames = []
    # One smiling source, fixed feet, gentle neck nuzzle with a return segment.
    for i in range(count):
        t = i/(count-1)
        settle = float(smooth(t/.22))
        nuzzle = math.sin(2*math.pi*t*2)*math.sin(math.pi*t)**2
        frames.append(rgba(lean(source, dx=4*settle+7*nuzzle,
                               dy=-5*settle-3*nuzzle, angle=2.2*settle+2*nuzzle)))
    ending = []
    for i in range(out_count):
        q = float(1-smooth(i/(out_count-1)))
        ending.append(rgba(lean(source, dx=4*q, dy=-5*q, angle=2.2*q)))
    return frames, ending


def encode(path, frames):
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba',
                    '-s', '512x512', '-r', str(FPS), '-i', '-', '-an', '-c:v', 'libvpx-vp9',
                    '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-lossless', '1', '-b:v', '0',
                    str(path)], input=b''.join(f.tobytes() for f in frames), check=True)


def previews(dest, name, frames):
    sheet = Image.new('RGB', (8*256, 3*256), '#34463c')
    draw = ImageDraw.Draw(sheet)
    for j in range(24):
        i = round(j*(len(frames)-1)/23)
        im = Image.fromarray(frames[i]).resize((256, 256), Image.Resampling.LANCZOS)
        bg = Image.new('RGB', (256, 256), '#34463c' if j % 2 else '#f6efdf')
        bg.paste(im, (0, 0), im)
        sheet.paste(bg, (j % 8*256, j // 8*256))
        draw.text((j % 8*256+8, j // 8*256+8), f'{name} {i}', fill='#c79a53')
    sheet.save(dest/f'{name}-contact.jpg', quality=95)
    gif = []
    for f in frames:
        im = Image.fromarray(f).resize((384, 384), Image.Resampling.LANCZOS)
        bg = Image.new('RGB', (384, 384), '#f6efdf')
        bg.paste(im, (0, 0), im)
        gif.append(bg)
    # Preview only, the production animation is lossless VP9 alpha.
    gif[0].save(dest/f'{name}-preview.gif', save_all=True, append_images=gif[1:],
                duration=[30, 30, 40]*(len(gif)//3), loop=0)


def build(stage):
    dest = WORK/f'age-{stage}'
    dest.mkdir(parents=True, exist_ok=True)
    keys_path = ROOT/f'output/pet-growth-20261114/capybara-{stage}/keys.npz'
    keys = np.load(keys_path)
    walk, trace = walk_frames(clean(keys['walk'][2]), stage)
    play = play_frames(clean(keys['play'][2]), clean(keys['play'][0]))
    pet, ending = pet_frames(clean(keys['pet'][2]))
    report = {'version': VERSION, 'method': 'fixed sunburst textures; independent opaque paws; analytic continuous rig; lossless VP9 alpha',
              'sourceKeys': str(keys_path.relative_to(ROOT)), 'sourceSHA256': sha(keys_path),
              'sourceModel': 'gpt-image-2.6-sunburst', 'sourceQuality': 'high', 'fps': FPS,
              'walkDutyFactor': .68, 'walkPhases': [0, .5, .75, .25], 'actions': {}}
    for name, frames in {'walk': walk, 'play': play, 'petted': pet, 'petted-out': ending}.items():
        path = dest/f'{name}.alpha.webm'
        encode(path, frames)
        previews(dest, name, frames)
        report['actions'][name] = {'frames': len(frames), 'seconds': len(frames)/FPS, 'sha256': sha(path),
                                   'distinctFrames': len({hashlib.sha256(f.tobytes()).hexdigest() for f in frames})}
        np.savez_compressed(dest/f'{name}-frames.npz', frames=np.stack(frames))
        print(f'age {stage} {name}: {len(frames)} frames', flush=True)
    Image.fromarray(walk[0]).save(dest/'frame-walk.png')
    Image.fromarray(play[0]).save(dest/'frame-roll.png')
    (dest/'walk-foot-trajectories.json').write_text(json.dumps(trace))
    (dest/'production.json').write_text(json.dumps(report, indent=2)+'\n')


def publish():
    if (PACK/'source/motion-repair-v3.json').exists():
        raise RuntimeError('Reviewed v3 motion is installed. Use repair-capybara-motion-v3.py to avoid restoring the old slow walk.')
    verified = json.loads((WORK/'verification.json').read_text())
    verified_hashes = {(r['age'], r['action']): r['sha256'] for r in verified['clips']}
    assert verified['clipCount'] == 24
    if not (WORK/'backup').exists():
        shutil.copytree(PACK, WORK/'backup')
    spec = json.loads((PACK/'pet.json').read_text())
    for stage in range(1, 7):
        dest = WORK/f'age-{stage}'
        report = json.loads((dest/'production.json').read_text())
        folder = PACK if stage == 1 else PACK/f'growth/{stage}'
        for action, meta in report['actions'].items():
            source = dest/f'{action}.alpha.webm'
            assert sha(source) == meta['sha256']
            assert verified_hashes[(stage, action)] == meta['sha256'], 'Run verify-capybara-motion.py after rebuilding.'
            shutil.copy2(source, folder/'videos'/source.name)
        for name in ['walk', 'roll']:
            shutil.copy2(dest/f'frame-{name}.png', folder/f'frames/frame-{name}.png')
        shutil.copy2(dest/'production.json', folder/'source/motion-repair-v2.json')
        shutil.copy2(dest/'walk-foot-trajectories.json', folder/'source/walk-foot-trajectories-v2.json')
        look = spec if stage == 1 else spec['growth'][str(stage)]
        look['videos']['walk']['gait'] = {'stridePixels': 44, 'supportSeconds': 1.6*.68, 'canvasPixels': 512}
    spec['version'] = VERSION
    (PACK/'pet.json').write_text(json.dumps(spec, ensure_ascii=False, indent=2)+'\n')
    print('Published capybara repaired actions only', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', type=int, choices=range(1, 7))
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--publish-only', action='store_true', help='Publish the already verified and reviewed outputs.')
    args = parser.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    if not args.publish_only:
        for age in [args.stage] if args.stage else range(1, 7):
            build(age)
    if args.publish or args.publish_only:
        assert not args.stage, 'Publishing requires rebuilding and checking every age.'
        publish()
