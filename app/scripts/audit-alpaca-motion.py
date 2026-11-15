"""Quantify alpaca clip problems: translucent interior, sole drift, loop seam."""
import json, subprocess
from pathlib import Path
import cv2, numpy as np

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT.parent / 'output/alpaca-motion-repair-20261115'
CLIPS = ROOT / 'assets/pets/alpaca_toon/videos'


def decode(path):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(path),
                                   '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'])
    return np.frombuffer(raw, np.uint8).reshape(-1, 512, 512, 4)


def measure(frames):
    translucent, soles, centers, widths = [], [], [], []
    for f in frames:
        a = f[:, :, 3].astype('float32')
        core = cv2.erode((a > 128).astype('uint8'), np.ones((5, 5), 'uint8')) > 0
        translucent.append(int(((a > 16) & (a < 240) & core).sum()))
        ys, xs = np.where(a > 128)
        soles.append(int(ys.max()) if len(ys) else None)
        centers.append(float(xs.mean()) if len(xs) else None)
        widths.append(int(xs.max() - xs.min()) if len(xs) else 0)
    seam = None
    if len(frames) > 1:
        seam = float(np.abs(frames[0].astype('float32') - frames[-1].astype('float32')).mean())
    adj = [float(np.abs(frames[i].astype('float32') - frames[i - 1].astype('float32')).mean()) for i in range(1, len(frames))]
    return {
        'frames': len(frames),
        'translucentCoreMax': max(translucent),
        'translucentCoreMean': round(float(np.mean(translucent)), 1),
        'soleMin': min(s for s in soles if s is not None),
        'soleMax': max(s for s in soles if s is not None),
        'centerRange': round(max(centers) - min(centers), 2),
        'widthMin': min(widths), 'widthMax': max(widths),
        'loopSeam': round(seam, 3) if seam is not None else None,
        'maxAdjacent': round(max(adj), 3) if adj else None,
    }


result = {}
for name in ['greet', 'walk', 'eat', 'eatrev', 'petted', 'petted-out', 'play', 'hug', 'sleep', 'wake', 'stretch']:
    frames = decode(CLIPS / f'{name}.alpha.webm')
    result[name] = measure(frames)
    print(name, json.dumps(result[name]), flush=True)
WORK.mkdir(parents=True, exist_ok=True)
(WORK / 'before-audit.json').write_text(json.dumps(result, indent=2) + '\n')
