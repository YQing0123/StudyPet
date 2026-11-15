"""Restore only the lost alpha inside the existing ball; never repaint the dog.
Requires ffmpeg (libvpx-vp9), numpy, opencv-python. Original archive is read-only.
"""
from pathlib import Path
import subprocess, json
import numpy as np
import cv2
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT.parent / 'MengChong_Research_20261111/research/recovered/assets/videos/dog_corgi/play.alpha.webm'
OUT = ROOT / 'scripts/patches/videos/dog_corgi/play.alpha.webm'
OUT.parent.mkdir(parents=True, exist_ok=True)
raw = subprocess.check_output(['ffmpeg','-v','error','-c:v','libvpx-vp9','-i',str(SRC),'-f','rawvideo','-pix_fmt','rgba','-'])
frames = np.frombuffer(raw, np.uint8).reshape(-1,512,512,4).copy()
yy, xx = np.mgrid[:512,:512]
measurements = []
# Frames 92–97 partially overlap the dog; the white arc alone cannot fit a circle.
# Measured centres on the existing source, interpolated only over those frames.
overlap_centers = {92: (385,436), 93: (380,436), 94: (376,436), 95: (373,436), 96: (371,436), 97: (369,436)}
for index, frame in enumerate(frames):
    circles = cv2.HoughCircles(cv2.GaussianBlur(frame[350:,340:,3],(5,5),1), cv2.HOUGH_GRADIENT,
        1,30,param1=70,param2=13,minRadius=23,maxRadius=44)
    if circles is None: raise RuntimeError(f'Ball detection failed at frame {index}; review before publishing')
    candidates = circles[0] + [340,350,0]
    candidates = [c for c in candidates if 420 < c[1] < 450 and 30 < c[2] < 40]
    if index in overlap_centers: candidates = [[*overlap_centers[index], 35.5]]
    if len(candidates) != 1: raise RuntimeError(f'Ambiguous ball at frame {index}: {candidates}')
    cx, cy, radius = candidates[0]
    # Stay inside the measured silhouette. Existing edge alpha is preserved.
    distance = np.hypot(xx-cx, yy-cy)
    restored = np.clip((radius - .8 - distance)*255,0,255).astype(np.uint8)
    before = frame[:,:,3].copy()
    frame[:,:,3] = np.maximum(before,restored)
    measurements.append({'frame':index,'center':[float(cx),float(cy)],'radius':float(radius),
        'restoredPixels':int(np.count_nonzero(frame[:,:,3] > before))})
cmd=['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgba','-s','512x512','-r','24','-i','-',
    '-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-lossless','1','-auto-alt-ref','0',str(OUT)]
subprocess.run(cmd,input=frames.tobytes(),check=True)
OUT.with_suffix('.repair.json').write_text(json.dumps({'source':str(SRC.relative_to(ROOT.parent)),
    'frames':len(frames),'fps':24,'method':'interior alpha restoration; original RGB retained',
    'measurements':measurements},indent=2))
print(f'Restored ball alpha in {len(frames)} frames: {OUT}')
