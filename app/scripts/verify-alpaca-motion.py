"""Verify rebuilt alpaca clips: opaque interiors, fixed soles, gait closure."""
import hashlib, importlib.util, json, subprocess
from pathlib import Path
import cv2, numpy as np

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT.parent / 'output/alpaca-motion-repair-20261115'
spec = importlib.util.spec_from_file_location('rig', Path(__file__).with_name('repair-alpaca-motion.py'))
rig = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rig)

report = {'clips': [], 'frames': 0, 'gait': []}
BUILT = ['walk', 'play', 'petted', 'petted-out', 'stretch', 'hug']


def decode(path):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(path),
                                   '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'])
    return np.frombuffer(raw, np.uint8).reshape(-1, 512, 512, 4)


for action in BUILT:
    path = WORK / f'{action}.alpha.webm'
    frames = decode(path)
    assert len(frames) > 10, action
    translucent, soles, centers = [], [], []
    for frame in frames:
        a = frame[:, :, 3].astype('float32')
        core = cv2.erode((a > 128).astype('uint8'), np.ones((5, 5), 'uint8')) > 0
        translucent.append(int(((a > 16) & (a < 240) & core).sum()))
        ys, xs = np.where(a > 128)
        soles.append(int(ys.max()) if len(ys) else None)
        centers.append(float(xs.mean()) if len(xs) else None)
    entry = {'action': action, 'frames': len(frames), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
             'translucentCorePixels': max(translucent),
             'soleMin': min(s for s in soles if s is not None),
             'soleMax': max(s for s in soles if s is not None),
             'centerRange': round(max(centers) - min(centers), 2)}
    if action in ('walk', 'play'):
        entry['loopSeamMeanDifference'] = round(float(np.abs(frames[0].astype('float32') - frames[-1].astype('float32')).mean()), 4)
    report['clips'].append(entry)
    report['frames'] += len(frames)
    print(action, entry['frames'], 'translucent', entry['translucentCorePixels'],
          'sole', entry['soleMin'], entry['soleMax'], flush=True)

# Petting exit must start where petting ended.
pet = decode(WORK / 'petted.alpha.webm')
out = decode(WORK / 'petted-out.alpha.webm')
seam = float(np.abs(pet[-1][:, :, 3].astype('float32') - out[0][:, :, 3].astype('float32')).mean())
report['pettingSeam'] = round(seam, 4)
assert seam < .5, ('petting seam', seam)

# Four-beat gait: support and swing alternate, never a flight phase.
trace = json.loads((WORK / 'walk-foot-trajectories.json').read_text())
for feet in trace[:48]:
    states = [f['phase'] for f in feet]
    assert states.count('support') >= 2, states
    assert states.count('swing') <= 2, states
report['gait'] = {'sample': trace[0], 'minimumSupports': min(sum(f['phase'] == 'support' for f in feet) for feet in trace)}
assert report['gait']['minimumSupports'] >= 2, report['gait']

for c in report['clips']:
    assert c['translucentCorePixels'] == 0, c
    if c['action'] in ('walk', 'play', 'petted', 'petted-out', 'stretch', 'hug'):
        # Walk hips rotate rigidly, so a swing hoof may rise ~4px; the planted
        # hoof stays on the 448-449 line. The detached ball may rest lower.
        assert c['soleMin'] >= 446, c
        assert c['soleMax'] <= 453, c
    if c['action'] in ('walk', 'play'):
        assert c['loopSeamMeanDifference'] < 1.0, c

report['clipCount'] = len(report['clips'])
(WORK / 'verification.json').write_text(json.dumps(report, indent=2) + '\n')
print('PASS', report['clipCount'], 'clips;', report['frames'], 'decoded frames; zero translucent cores; fixed soles; gait closed')
