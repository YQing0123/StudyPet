"""Check decoded repaired media, opaque interiors, fixed feet and gait closure."""
import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT/'output/capybara-motion-repair-20261114'
spec = importlib.util.spec_from_file_location('rig', Path(__file__).with_name('repair-capybara-motion.py'))
rig = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rig)
report = {'clips': [], 'frames': 0, 'gait': []}


def decode(path):
    return np.frombuffer(subprocess.check_output([
        'ffmpeg', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(path),
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']), np.uint8).reshape(-1, 512, 512, 4)


def core_alpha(frames):
    counts = []
    for frame in frames:
        a = frame[:, :, 3]
        # Alpha-existence checks cannot detect translucent ghost limbs.
        core = cv2.erode((a > 16).astype('uint8'), np.ones((7, 7), 'uint8')) > 0
        counts.append(int(((a < 250) & core).sum()))
    return max(counts)


for age in range(1, 7):
    dest = WORK/f'age-{age}'
    meta = json.loads((dest/'production.json').read_text())
    arrays = {}
    for action, info in meta['actions'].items():
        path = dest/f'{action}.alpha.webm'
        expected = np.load(dest/f'{action}-frames.npz')['frames']
        frames = decode(path)
        arrays[action] = frames
        assert len(frames) == len(expected) == info['frames']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == info['sha256']
        alpha_error = int(np.abs(frames[:, :, :, 3].astype(int)-expected[:, :, :, 3]).max())
        assert alpha_error <= 1, (age, action, 'alpha encoding changed')
        translucent = core_alpha(frames)
        assert translucent == 0, (age, action, 'interior translucency', translucent)
        a = frames[:, :, :, 3]
        assert a[:, :8].max() == 0 and a[:, -8:].max() == 0
        assert a[:, :, :8].max() == 0 and a[:, :, -8:].max() == 0
        # Colour encoding may subsample contour pixels, but must reproduce
        # opaque interior texture rather than introduce time-varying tints.
        interior = np.stack([cv2.erode((f[:, :, 3] == 255).astype('uint8'), np.ones((7, 7), 'uint8')) > 0 for f in expected])
        color_error = float(np.abs(frames[:, :, :, :3].astype(float)-expected[:, :, :, :3])[interior].mean())
        assert color_error < 2, (age, action, 'interior color error', color_error)
        before = WORK/'backup' if age == 1 else WORK/f'backup/growth/{age}'
        old = decode(before/f'videos/{action}.alpha.webm')
        entry = {'age': age, 'action': action, 'frames': len(frames),
                 'sha256': info['sha256'],
                 'translucentCorePixelsBefore': core_alpha(old),
                 'translucentCorePixelsAfter': translucent, 'alphaMaxEncodingError': alpha_error,
                 'meanInteriorColorEncodingError': round(color_error, 4)}
        if action in ['petted', 'petted-out']:
            foot = expected[:, 405:]
            assert np.all(foot == foot[0]), (age, action, 'feet moved')
            entry['fixedFootPixelsExact'] = True
        if action == 'walk':
            diffs = np.abs(frames[1:].astype(float)-frames[:-1].astype(float)).mean(axis=(1, 2, 3))
            seam = float(np.abs(frames[0].astype(float)-frames[-1].astype(float)).mean())
            assert seam <= float(diffs.max())*1.1, (age, 'loop discontinuity')
            entry['loopSeamMeanDifference'] = round(seam, 4)
            entry['maximumAdjacentMeanDifference'] = round(float(diffs.max()), 4)
        report['clips'].append(entry)
        report['frames'] += len(frames)
        print('checked', age, action, flush=True)
    assert np.array_equal(arrays['petted'][-1, :, :, 3], arrays['petted-out'][0, :, :, 3]), (age, 'petting exit seam')
    # Test the analytic motion at a much finer resolution than the render.
    # Support is a constant-height backward push; swing lifts and recovers.
    gait = []
    for phase in [0, .5, .75, .25]:
        points = [rig.stride((t+.5)/1000+phase, 22, 21) for t in range(1000)]
        support = [p for p in points if p[2] == 'support']
        swing = [p for p in points if p[2] == 'swing']
        assert len(support) == 680 and len(swing) == 320
        assert max(abs(p[1]) for p in support) == 0
        assert min(p[1] for p in swing) <= -20.9
        # Wrapped phase must have equal position and velocity at the seam.
        eps = 1e-5
        left = np.array(rig.stride(1-eps, 22, 21)[:2])
        middle = np.array(rig.stride(0, 22, 21)[:2])
        right = np.array(rig.stride(eps, 22, 21)[:2])
        assert np.max(np.abs((middle-left)/eps-(right-middle)/eps)) < .1
        gait.append({'supportSamples': len(support), 'swingSamples': len(swing), 'liftPixels': -min(p[1] for p in swing)})
    contacts = [sum(rig.stride(t/1000+p)[2] == 'support' for p in [0, .5, .75, .25]) for t in range(1000)]
    assert min(contacts) >= 2, (age, 'all-feet flight')
    report['gait'].append({'age': age, 'feet': gait, 'minimumSimultaneousSupports': min(contacts)})

report['clipCount'] = len(report['clips'])
(WORK/'verification.json').write_text(json.dumps(report, indent=2)+'\n')
print('PASS', report['clipCount'], 'clips;', report['frames'], 'decoded frames; opaque cores, fixed petting feet, continuous four-beat gait')
