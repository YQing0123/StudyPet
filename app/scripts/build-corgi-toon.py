"""Publish reference-locked native GIFs as a transparent pet pack.
Original model bytes stay in source/. Processing: magenta matte, fixed scale/anchor,
component cleanup, native keyframe timing, VP9 alpha. No paid calls here.
"""
from pathlib import Path
import json, shutil, hashlib, subprocess, sys
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT.parent / 'output/imagegen/corgi-toon-v1'
PACK = ROOT / 'assets/pets/dog_corgi_toon'
OUT = ROOT.parent / 'output/corgi-toon-20261113'
SMOOTH = Path(sys.argv[sys.argv.index('--smooth-from') + 1]).resolve() if '--smooth-from' in sys.argv else None
FPS = 30 if SMOOTH else 24
SMOOTH_META = json.loads((SMOOTH/'interpolation.json').read_text()) if SMOOTH else {}
EXISTING = json.loads((PACK/'pet.json').read_text()) if (PACK/'pet.json').exists() else {}
if EXISTING.get('growth') and '--export-keys' not in sys.argv:
    raise SystemExit('This pack has growth appearances. Rebuild with build-pet-growth.py; refusing to overwrite growth metadata with the legacy builder.')
if SMOOTH and EXISTING.get('version', '').endswith('v3') and not SMOOTH_META.get('keyCuration', {}).get('play'):
    raise SystemExit('Published play animation uses reviewed v3 keys; refusing an uncurated downgrade.')
if not SMOOTH and '--export-keys' not in sys.argv and (PACK/'pet.json').exists() and json.loads((PACK/'pet.json').read_text()).get('version','') not in ('', '2026-11-13.v1'):
    raise SystemExit('Published pack uses smooth frames. Pass --smooth-from PATH to rebuild; original GIFs are kept in source/.')
PACK.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
for folder in ['source', 'frames', 'videos']:
    (PACK / folder).mkdir(exist_ok=True)
for p in GEN.glob('*.gif'):
    shutil.copy2(p, PACK / 'source' / p.name)
for p in [GEN / 'character-master.png', GEN / 'original-cartoon-reference.png']:
    shutil.copy2(p, PACK / 'source' / p.name)
shutil.copytree(GEN / 'prompts', PACK / 'source/prompts', dirs_exist_ok=True)

FILES = {'sit': 'sit-native-retry.gif', **{a: f'{a}-native.gif' for a in ['walk', 'eat', 'pet', 'play', 'sleep']}}
# First-frame eye separation, measured on the returned native frames. One fixed
# transform per clip preserves intentional pose motion; no per-frame box resizing.
EYES = {'sit': 68.6, 'walk': 64.8, 'eat': 66.1, 'pet': 70.0, 'play': 71.6, 'sleep': 68.3}
sources, diagnostics = {}, {}

def matte(rgb, action):
    rgb = rgb.astype(np.float32) / 255
    dominance = np.minimum(rgb[:, :, 0], rgb[:, :, 2]) - rgb[:, :, 1]
    alpha = np.clip((.52 - dominance) / .34, 0, 1)
    alpha = alpha * alpha * (3 - 2 * alpha)
    # Unmix the known key colour on edge pixels without global colour deletion.
    foreground = (rgb - (1 - alpha[:, :, None]) * np.array([1, 0, 1])) / np.maximum(alpha[:, :, None], .015)
    foreground = np.clip(foreground, 0, 1)
    n, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > .35).astype('uint8'), 8)
    order = sorted(range(1, n), key=lambda x: stats[x, cv2.CC_STAT_AREA], reverse=True)
    keep = order[:2] if action in ['eat', 'play'] else order[:1]
    keep = [x for x in keep if stats[x, cv2.CC_STAT_AREA] > 250]
    support = np.isin(labels, keep).astype('uint8')
    support = cv2.dilate(support, np.ones((3, 3), 'uint8'))
    alpha *= support
    return np.dstack([foreground, alpha]).astype('float32')

def bounds(frame):
    ys, xs = np.where(frame[:, :, 3] > .5)
    return (int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1))

for action, file in FILES.items():
    path = PACK / 'source' / file
    image = Image.open(path)
    assert image.format == 'GIF' and image.n_frames > 1, file
    frames, durations = [], []
    for i in range(image.n_frames):
        image.seek(i)
        frames.append(matte(np.array(image.convert('RGB')), action))
        durations.append(image.info.get('duration', 0))
    assert sum(durations) > 0
    # Align animal, excluding the bowl/ball from the body anchor.
    n, labels, stats, _ = cv2.connectedComponentsWithStats((frames[0][:, :, 3] > .5).astype('uint8'), 8)
    main = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    x, y, w, h, _ = stats[main]
    scale = 67 / EYES[action]
    dx = 246 - (x + w / 2) * scale
    dy = 450 - (y + h) * scale
    matrix = np.array([[scale, 0, dx], [0, scale, dy]], np.float32)
    normalized = []
    for rgba in frames:
        # Premultiplication prevents dark/key edges during resampling.
        premult = rgba.copy(); premult[:, :, :3] *= premult[:, :, 3:4]
        fitted = cv2.warpAffine(premult, matrix, (512, 512), flags=cv2.INTER_CUBIC)
        fitted = np.clip(fitted, 0, 1)
        fitted[:, :, :3] /= np.maximum(fitted[:, :, 3:4], .001)
        # Keep contact with the same floor as the body lowers into sleep.
        # Translate only: never resize individual poses or interpolate anatomy.
        floor_shift = 450 - bounds(fitted)[3]
        fitted = cv2.warpAffine(fitted, np.array([[1, 0, 0], [0, 1, floor_shift]], np.float32),
                               (512, 512), flags=cv2.INTER_NEAREST)
        normalized.append(np.clip(fitted, 0, 1))
    sources[action] = normalized
    diagnostics[action] = {'file': file, 'originalFrames': image.n_frames, 'originalDurationMs': sum(durations),
                           'originalSize': list(image.size), 'originalSHA256': hashlib.sha256(path.read_bytes()).hexdigest(),
                           'scale': scale, 'offset': [dx, dy], 'normalizedBounds': [bounds(f) for f in normalized]}

# Export unchanged, aligned keys for the offline neural interpolation tool.
import sys
if '--export-keys' in sys.argv:
    target = Path(sys.argv[sys.argv.index('--export-keys') + 1])
    np.savez_compressed(target, **{k: np.stack(v) for k, v in sources.items()})
    print('Exported normalized original keys:', target)
    raise SystemExit(0)

def retain_keys(keys, seconds, loop=False):
    """Encode native cartoon keys at 24 fps without synthetic in-between anatomy."""
    count = round(seconds * 24)
    return [np.round(keys[min(int(i * len(keys) / count), len(keys) - 1)] * 255).astype('uint8')
            for i in range(count)]

def publish(action, frames):
    path = PACK / 'videos' / f'{action}.alpha.webm'
    if SMOOTH:
        shutil.copy2(SMOOTH / path.name, path)
        print(action, len(frames), 'RIFE', flush=True)
        return {'file': f'videos/{path.name}', 'mode': 'alpha', 'bottom': 450 / 512}
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '512x512', '-r', '24', '-i', '-',
                    '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-crf', '20', '-b:v', '0', str(path)],
                   input=b''.join(f.tobytes() for f in frames), check=True)
    print(action, len(frames), flush=True)
    return {'file': f'videos/{path.name}', 'mode': 'alpha', 'bottom': 450 / 512}

actions = {
    'greet': (sources['sit'], 2.4, True),
    'walk': (sources['walk'], 1.8, True),
    'eat': (sources['eat'][:6], 1.8, False),
    'eatrev': (sources['eat'][5:], .8, False),
    'petted': (sources['pet'][:6], 1.8, False),
    'petted-out': (sources['pet'][5:], .7, False),
    'play': (sources['play'], 2.6, True),
    'sleep': (sources['sleep'], 2.4, False),
    'wake': (list(reversed(sources['sleep'])), 2.0, False),
}
videos = {}
renders = {}
for action, (keys, seconds, loop) in actions.items():
    if SMOOTH:
        raw = subprocess.check_output(['ffmpeg','-v','error','-c:v','libvpx-vp9','-i',str(SMOOTH/f'{action}.alpha.webm'),'-f','rawvideo','-pix_fmt','rgba','-'])
        renders[action] = list(np.frombuffer(raw,dtype='uint8').reshape(-1,512,512,4))
        assert len(renders[action]) == round(seconds*30)
    else:
        renders[action] = retain_keys(keys, seconds, loop)
    videos[action] = publish(action, renders[action])
# Existing hug interaction reuses the same relaxed reaction, explicitly recorded.
videos['hug'] = dict(videos['petted'])

poses = {'sit': sources['sit'][0], 'walk': sources['walk'][0], 'jump': sources['play'][2],
         'sleep': sources['sleep'][-1], 'stretch': sources['sleep'][2], 'roll': sources['play'][5]}
frame_specs = []
for key, frame in poses.items():
    path = PACK / 'frames' / f'frame-{key}.png'
    Image.fromarray(np.round(frame * 255).astype('uint8')).save(path)
    # Actual visible bottom is stable across one action, including lowered head.
    bottom = bounds(frame)[3] / 512
    frame_specs.append({'key': key, 'file': f'frames/{path.name}', 'bottom': bottom})
avatar = Image.open(PACK / 'frames/frame-sit.png')
avatar.crop((100, 50, 400, 450)).resize((192, 256), Image.Resampling.LANCZOS).save(PACK / 'avatar.png')
spec = {'id': 'dog_corgi_toon', 'name': '卡通柯基', 'species': 'dog', 'version': ('2026-11-13.v3' if SMOOTH_META.get('keyCuration') else '2026-11-13.v2') if SMOOTH else '2026-11-13.v1',
        'avatar': 'avatar.png', 'frames': frame_specs, 'videos': videos, 'walkTransitions': False}
(PACK / 'pet.json').write_text(json.dumps(spec, ensure_ascii=False, indent=2))
(PACK / 'source/production.json').write_text(json.dumps({'model': 'gpt-image-2.6-sunburst', 'quality': 'high',
    'master': 'character-master.png', 'nativeAnimationSources': diagnostics,
    'derivations': {'wake': 'reverse sleep', 'eatrev': 'last four eat keys', 'petted-out': 'last four pet keys', 'hug': 'reuses petted'},
    'processing': ('magenta matte; fixed scale and floor contact; RIFE 4.25 learned occlusion-aware intermediate RGBA frames; 30fps VP9 alpha' if SMOOTH else 'magenta matte; fixed per-clip scale; floor-contact translation; native keys held in a 24 fps container (no optical-flow interpolation); VP9 alpha'),
    'interpolation': SMOOTH_META if SMOOTH else None,
    'failedAttempts': ['first sit request returned non-GIF, discarded; retry returned valid native GIF']}, ensure_ascii=False, indent=2))

font = ImageFont.truetype('/System/Library/Fonts/Hiragino Sans GB.ttc', 18)
sheet = Image.new('RGB', (900, len(renders) * 280), '#F7F0DF'); draw = ImageDraw.Draw(sheet)
for row, (action, frames) in enumerate(renders.items()):
    for col, idx in enumerate([0, len(frames) // 2, len(frames) - 1]):
        bg = Image.new('RGB', (300, 280), '#F7F0DF' if col != 1 else '#34463C')
        im = Image.fromarray(frames[idx]); im.thumbnail((260, 260)); bg.paste(im, (20, -6), im)
        sheet.paste(bg, (col * 300, row * 280))
        draw.text((col * 300 + 10, row * 280 + 252), f'{action} · {idx / FPS:.2f}s', font=font, fill='#385C49' if col != 1 else '#F7F0DF')
sheet.save(OUT / 'new-corgi-contact.jpg', quality=94)
# Preview only: this GIF is a derived export, never described as model-returned.
for action in ['walk', 'play', 'sleep']:
    frames = renders[action]
    previews = []
    for rgba in frames[::2]:
        bg = Image.new('RGB', (512, 512), '#F7F0DF'); im = Image.fromarray(rgba); bg.paste(im, (0, 0), im); previews.append(bg)
    previews[0].save(OUT / f'{action}-processed-preview.gif', save_all=True, append_images=previews[1:], duration=round(2000/FPS), loop=0)
if SMOOTH:
    shutil.copy2(SMOOTH/'interpolation.json', PACK/'source/interpolation.json')
    if SMOOTH_META.get('keyCuration'):
        (PACK/'source/key-curation.json').write_text(json.dumps(SMOOTH_META['keyCuration'], ensure_ascii=False, indent=2) + '\n')
print('Published own pet pack:', PACK)
