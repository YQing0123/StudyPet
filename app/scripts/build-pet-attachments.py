#!/usr/bin/env python3
"""Build small, source-space attachment tracks from shipped frames/video mattes.

No runtime video readback or pose-inference dependency. Rebuild after changing pets.
Coordinates are normalized to the untrimmed source canvas, not the scene. Tracks
are geometry estimates; breed/action overrides can refine unusual source poses.
"""
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PETS = ROOT / 'web/public/pets'
FPS = 12


def landmarks(rgba, breed, species, pose):
    mask = (rgba[:, :, 3] > 110).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    if count < 2:
        return [.5, .22, .5, .52, .18]
    # Detached sparkles/food must not move the animal's anchors.
    mask = labels == (1 + np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    ys, xs = np.where(mask)
    l, r, t, b = xs.min(), xs.max(), ys.min(), ys.max()
    w, h = max(r - l, 1), max(b - t, 1)
    lying = pose in ('sleep', 'roll')
    side = w > h * 1.15
    upper = mask[int(t + h * .09):int(t + h * (.40 if species == 'turtle' else .30)) + 1]
    _, hx = np.where(upper)
    cx = float(np.median(hx)) if hx.size else (l + r) / 2
    crown_y = t + h * ({'dog': .13, 'cat': .10, 'alpaca': .17}.get(species, .035))
    neck_y = t + h * ({'alpaca': .52, 'bird': .30, 'turtle': .33, 'capybara': .48}.get(species, .40))
    neck_x = cx
    head_width = w * {'bird': .42, 'turtle': .35, 'capybara': .48, 'alpaca': .45}.get(species, .54)
    if side or lying:
        # Original packs have different facing directions; use the upper body
        # mass rather than assuming scene-left is always the head.
        crown_y = t + h * (.10 if species in ('cat', 'dog') else .04)
        neck_y = t + h * .54
        neck_x = cx + ((l + r) / 2 - cx) * .15
        head_width = min(head_width, h * .63)
    if breed == 'capybara_toon':
        neck_x = cx + w * .09
        neck_y = t + h * (.72 if lying else .57)
        if pose in ('eat', 'eatrev', 'feedcatch'):
            neck_x, neck_y = cx - w * .05, t + h * .67
    if breed == 'dog_corgi_toon':
        neck_x = cx - w * .04
        neck_y = t + h * (.78 if lying else .60)
        if pose in ('eat', 'eatrev', 'feedcatch'):
            neck_x, neck_y = cx - w * .11, t + h * .77
    if breed == 'alpaca_toon' and pose in ('eat', 'eatrev', 'feedcatch'):
        neck_x, neck_y = cx - w * .03, t + h * .68
    if species in ('cat', 'dog') and breed != 'dog_corgi_toon':
        head_width = min(head_width, h * .34)
    if species == 'turtle' and side and pose != 'greet':
        # The shell is the highest point in side views. Find the brighter
        # olive head near an outside edge instead of putting a crown on it.
        rgb = rgba[:, :, :3].astype(float)
        skin = mask & (rgb[:, :, 1] > rgb[:, :, 0] * .93) & (rgb[:, :, 1] > rgb[:, :, 2] * 1.10)
        skin[:int(t + h * .10)] = False
        skin[int(t + h * .68):] = False
        candidates = []
        for start, end in [(int(l), int(l + w * .30)), (int(r - w * .30), int(r + 1))]:
            yy, xx = np.where(skin[:, start:end])
            if len(xx) > 8:
                candidates.append((len(xx), float(np.median(xx)) + start, float(np.median(yy))))
        if candidates:
            _, cx, cy = max(candidates)
            crown_y = cy - h * .11
            neck_x = cx + ((l + r) / 2 - cx) * .30
            neck_y = cy + h * .14
            head_width = w * .23
    ih, iw = mask.shape
    return [round(cx / iw, 4), round(crown_y / ih, 4), round(neck_x / iw, 4), round(neck_y / ih, 4), round(head_width / iw, 4)]


def decode(frame, mode):
    if mode == 'packed-alpha':
        half = frame.shape[1] // 2
        rgb = cv2.cvtColor(frame[:, :half], cv2.COLOR_BGR2RGB)
        alpha = cv2.cvtColor(frame[:, half:], cv2.COLOR_BGR2GRAY)
    else:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        c = rgb.astype(float) / 255
        dominant = c[:, :, 2] - np.maximum(c[:, :, 0], c[:, :, 1]) if mode == 'blue' else c[:, :, 1] - np.maximum(c[:, :, 0], c[:, :, 2])
        alpha = ((1 - np.clip((dominant - .06) / .11, 0, 1)) * 255).astype(np.uint8)
    return np.dstack([rgb, alpha])


def build_video(job):
    file, entry, breed, species, pose = job
    source = entry.get('compatible', entry)
    cap = cv2.VideoCapture(str(PETS / source['file']))
    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30
    samples, next_time, index = [], 0, 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        time = index / native_fps
        if time + 1e-5 >= next_time:
            rgba = decode(frame, source['mode'])
            rgba = cv2.resize(rgba, (192, 192), interpolation=cv2.INTER_AREA)
            samples.append(landmarks(rgba, breed, species, pose))
            next_time += 1 / FPS
        index += 1
    cap.release()
    if not samples:
        raise RuntimeError(f'Cannot decode {file}')
    # A short median filter removes isolated matte noise without drifting off
    # the actual body position; client interpolates adjacent samples.
    arr = np.asarray(samples)
    smooth = [np.median(arr[max(0, i - 1):i + 2], axis=0).round(4).tolist() for i in range(len(arr))]
    return file, {'fps': FPS, 'points': smooth}


def main():
    manifest = json.loads((PETS / 'manifest.json').read_text())
    frames, jobs = {}, {}
    for breed, base in manifest['breeds'].items():
        for look in [base, *base.get('growth', {}).values()]:
            for f in look['frames']:
                rgba = np.array(Image.open(PETS / f['file']).convert('RGBA').resize((192, 192)))
                frames[f['file']] = landmarks(rgba, breed, base['species'], f['key'])
            for action, entry in look['videos'].items():
                jobs[entry['file']] = (entry['file'], entry, breed, base['species'], 'sleep' if action == 'sleep' else action)
    with ThreadPoolExecutor(max_workers=4) as pool:
        videos = dict(pool.map(build_video, jobs.values()))
    out = PETS / 'attachments.json'
    out.write_text(json.dumps({'version': 1, 'frames': frames, 'videos': videos}, separators=(',', ':')))
    print(f'Built {len(frames)} frame anchors, {len(videos)} video tracks, {out.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
