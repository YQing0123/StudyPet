"""Decode and verify all v3 clips before allowing capybara-only publication."""
import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / 'output/capybara-motion-20261115'
spec = importlib.util.spec_from_file_location('capybara_v3', Path(__file__).with_name('repair-capybara-motion-v3.py'))
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)
rig = repair.load_rig()
report = {'ok': False, 'clips': [], 'frames': 0, 'gait': [], 'endpointChecks': []}


def decode(path):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', str(path),
                                   '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'])
    return np.frombuffer(raw, np.uint8).reshape(-1, 512, 512, 4)


def translucent_core(frames):
    maximum = 0
    for f in frames:
        core = cv2.erode((f[:, :, 3] > 16).astype('uint8'), np.ones((7, 7), 'uint8')) > 0
        maximum = max(maximum, int(((f[:, :, 3] < 250) & core).sum()))
    return maximum


def differences(frames):
    # Premultiplied values ignore invisible RGB outside the silhouette.
    premul = frames.astype('float32') / 255
    premul[:, :, :, :3] *= premul[:, :, :, 3:4]
    adjacent = np.abs(premul[1:] - premul[:-1]).mean(axis=(1, 2, 3))
    return {'max': round(float(adjacent.max()), 6), 'median': round(float(np.median(adjacent)), 6),
            'p95': round(float(np.quantile(adjacent, .95)), 6),
            'seam': round(float(np.abs(premul[0] - premul[-1]).mean()), 6)}


for age in range(1, 7):
    dest = WORK / f'age-{age}'
    production = json.loads((dest / 'production.json').read_text())
    endpoints = {}
    for action, info in production['actions'].items():
        path = dest / f'{action}.alpha.webm'
        expected = np.load(dest / f'{action}-frames.npz')['frames']
        frames = decode(path)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        assert digest == info['sha256']
        assert frames.shape == expected.shape and len(frames) == info['frames']
        probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                                                    '-show_entries', 'stream=r_frame_rate,width,height:format=duration',
                                                    '-of', 'json', str(path)]))
        assert probe['streams'][0]['r_frame_rate'] == '30/1'
        assert abs(float(probe['format']['duration']) - info['seconds']) < .01
        alpha_error = int(np.abs(frames[:, :, :, 3].astype('int16') - expected[:, :, :, 3]).max())
        assert alpha_error <= 1
        core_after = translucent_core(frames)
        assert core_after == 0, (age, action, 'translucent body', core_after)
        a = frames[:, :, :, 3]
        assert not a[:, :8].any() and not a[:, -8:].any() and not a[:, :, :8].any() and not a[:, :, -8:].any()
        interior = np.stack([cv2.erode((f[:, :, 3] == 255).astype('uint8'), np.ones((7, 7), 'uint8')) > 0 for f in expected])
        error = float(np.abs(frames[:, :, :, :3].astype('float32') - expected[:, :, :, :3])[interior].mean())
        assert error < 2.5, (age, action, 'encoded texture error', error)
        before_folder = WORK / 'baseline/pack' if age == 1 else WORK / f'baseline/pack/growth/{age}'
        before = decode(before_folder / f'videos/{action}.alpha.webm')
        diff = differences(frames)
        entry = {'age': age, 'action': action, 'frames': len(frames), 'sha256': digest,
                 'translucentCorePixelsBefore': translucent_core(before), 'translucentCorePixelsAfter': core_after,
                 'alphaMaxEncodingError': alpha_error, 'meanInteriorColorEncodingError': round(error, 4),
                 'adjacentDifferenceBefore': differences(before), 'adjacentDifferenceAfter': diff}
        if action == 'walk':
            assert len(frames) == 36 and info['gait'] == repair.GAIT
            assert diff['seam'] <= diff['max'] * 1.15
        else:
            assert info['sourceCountPerFrame'] == 1
            provenance = json.loads((dest / f'{action}-provenance.json').read_text())
            assert len(provenance) == len(frames)
            assert all(p['source'] in p['pair'] for p in provenance)
            entry['singleSourcePerFrame'] = True
        endpoints[action] = (expected[0].copy(), expected[-1].copy())
        report['clips'].append(entry)
        report['frames'] += len(frames)
        print('checked', age, action, flush=True)
    assert np.array_equal(endpoints['eat'][1], endpoints['eatrev'][0]), (age, 'eat exit seam')
    assert np.array_equal(endpoints['sleep'][1], endpoints['wake'][0]), (age, 'sleep wake seam')
    report['endpointChecks'].append({'age': age, 'eatToExitExact': True, 'sleepToWakeExact': True})
    report['gait'].append({'age': age, **repair.GAIT})

phases = [0, .5, .75, .25]
contacts = [sum(rig.stride(t / 1000 + phase, 30, 21, .62)[2] == 'support' for phase in phases) for t in range(1000)]
assert min(contacts) >= 2
for phase in phases:
    points = [rig.stride((t + .5) / 1000 + phase, 30, 21, .62) for t in range(1000)]
    support = [p for p in points if p[2] == 'support']
    assert len(support) == 620 and max(abs(p[1]) for p in support) == 0
    eps = 1e-5
    left, mid, right = [np.array(rig.stride(t, 30, 21, .62)[:2]) for t in [1 - eps, 0, eps]]
    assert max(abs((mid - left) / eps - (right - mid) / eps)) < .15
report['minimumSimultaneousSupports'] = min(contacts)
report['sourcePixelsPerSecondBefore'] = 44 / 1.088
report['sourcePixelsPerSecondAfter'] = repair.GAIT['stridePixels'] / repair.GAIT['supportSeconds']
report['clipCount'] = len(report['clips'])
assert report['clipCount'] == 48
report['ok'] = True
(WORK / 'verification.json').write_text(json.dumps(report, indent=2) + '\n')
print('PASS:', report['clipCount'], 'clips,', report['frames'], 'decoded frames; opaque bodies, exact care endpoints, continuous gait')
