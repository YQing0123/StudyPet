"""Local-only capybara repair: single-source flow warps and a faster four-beat walk.

No generation or network calls. Keep the reviewed v2 play/petting rig intact.
The system Python prepares/decontaminates the original keys and renders the
walk; a separate local Torch Python estimates geometry for the other actions.
Review the outputs and run verify-capybara-motion-v3.py before --publish-only.
"""
import argparse
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import types
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / 'output/capybara-motion-20261115'
PACK = ROOT / 'app/assets/pets/capybara_toon'
VERSION = '2026-11-15.capybara-motion-v3'
FPS = 30
WALK_FRAMES = 36
WALK_AMPLITUDE = 30
WALK_DUTY = .62
GAIT = {'stridePixels': WALK_AMPLITUDE * 2,
        'supportSeconds': WALK_FRAMES / FPS * WALK_DUTY, 'canvasPixels': 512}
ACTIONS = {
    'greet': ('sit', 2.4, True), 'eat': ('eat', 1.6, False),
    'eatrev': ('eat', .8, False), 'hug': ('hug', 2.2, False),
    'sleep': ('sleep', 2.4, False), 'wake': ('sleep', 2., False),
    'stretch': ('stretch', 2.6, False),
}
WEIGHT_SHA = '6615790efd627772917205db291f51cd392528a157ecbb2ecaeec3bff8eb6de2'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_rig():
    spec = importlib.util.spec_from_file_location('capybara_v2', Path(__file__).with_name('repair-capybara-motion.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def encode(path, frames):
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba',
                    '-s', '512x512', '-r', str(FPS), '-i', '-', '-an', '-c:v', 'libvpx-vp9',
                    '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-lossless', '1', '-b:v', '0',
                    '-threads', '4', str(path)], input=frames.tobytes(), check=True)


def opaque_rgba(premultiplied):
    alpha = premultiplied[:, :, 3:4]
    mask = alpha >= .5
    rgb = premultiplied[:, :, :3] / np.maximum(alpha, 1e-5)
    # Rasterized contour only: the body texture is never faded between poses.
    interior = cv2.erode(mask[:, :, 0].astype('uint8'), np.ones((3, 3), 'uint8')) > 0
    alpha = np.where(mask, alpha, 0)
    alpha[interior] = 1
    return np.round(np.concatenate((rgb * mask, alpha), axis=2).clip(0, 1) * 255).astype('uint8')


def save_action(dest, name, frames, **extra):
    frames = np.stack(frames)
    path = dest / f'{name}.alpha.webm'
    encode(path, frames)
    np.savez_compressed(dest / f'{name}-frames.npz', frames=frames)
    meta = {'frames': len(frames), 'seconds': len(frames) / FPS,
            'sha256': sha(path), 'distinctFrames': len({hashlib.sha256(f.tobytes()).hexdigest() for f in frames}), **extra}
    (dest / f'{name}.json').write_text(json.dumps(meta, indent=2) + '\n')
    print(dest.name, name, len(frames), 'frames', flush=True)


def prepare(stage):
    rig = load_rig()
    dest = WORK / f'age-{stage}'
    dest.mkdir(parents=True, exist_ok=True)
    source = ROOT / f'output/pet-growth-20261114/capybara-{stage}/keys.npz'
    keys = np.load(source)
    # v2's measured contour decontamination removes magenta without changing
    # the pink cheeks/ears. These prepared keys are premultiplied RGBA.
    cleaned = {key: np.stack([rig.clean(pose) for pose in keys[key]]) for key in ['sit', 'eat', 'hug', 'sleep', 'stretch']}
    np.savez_compressed(dest / 'clean-keys.npz', **cleaned)
    original_stride = rig.stride
    rig.stride = lambda phase, amplitude=22, lift=19: original_stride(phase, WALK_AMPLITUDE, lift, WALK_DUTY)
    frames, trace = rig.walk_frames(rig.clean(keys['walk'][2]), stage, count=WALK_FRAMES)
    save_action(dest, 'walk', frames, method='v2 independent opaque paws; faster continuous four-beat cycle', gait=GAIT)
    Image.fromarray(frames[0]).save(dest / 'frame-walk.png')
    # Match repaired video endpoints to the static sleep/sit fallbacks.
    Image.fromarray(opaque_rgba(cleaned['sleep'][-1])).save(dest / 'frame-sleep.png')
    Image.fromarray(opaque_rgba(cleaned['sit'][0])).save(dest / 'frame-sit.png')
    (dest / 'walk-foot-trajectories.json').write_text(json.dumps(trace) + '\n')
    (dest / 'source.json').write_text(json.dumps({'sourceKeys': str(source.relative_to(ROOT)),
                                                'sourceSHA256': sha(source), 'weightSHA256': WEIGHT_SHA}, indent=2) + '\n')


def load_flow(weight):
    import torch
    import torch.nn.functional as functional
    assert sha(weight) == WEIGHT_SHA, 'Unreviewed flow model'
    device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
    torch.set_num_threads(4)

    def warp(image, flow):
        n, _, h, w = flow.shape
        x = torch.linspace(-1, 1, w, device=flow.device).view(1, 1, 1, w).expand(n, -1, h, -1)
        y = torch.linspace(-1, 1, h, device=flow.device).view(1, 1, h, 1).expand(n, -1, -1, w)
        grid = torch.cat((x, y), 1) + torch.cat((flow[:, :1] / ((w - 1) / 2), flow[:, 1:] / ((h - 1) / 2)), 1)
        return functional.grid_sample(image, grid.clamp(-1, 1).permute(0, 2, 3, 1),
                                      mode='bilinear', padding_mode='zeros', align_corners=True)

    sys.modules['model'] = types.ModuleType('model')
    sys.modules['model.warplayer'] = types.ModuleType('model.warplayer')
    sys.modules['model.warplayer'].warp = warp
    spec = importlib.util.spec_from_file_location('capybara_flow', Path(__file__).parent / 'lib/rife/IFNet_HDv3.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    net = mod.IFNet().eval()
    state = torch.load(weight, map_location='cpu', weights_only=True)
    net.load_state_dict({k.removeprefix('module.'): v for k, v in state.items()
                         if not k.removeprefix('module.').startswith(('teacher.', 'caltime.'))}, strict=True)
    return torch, net.to(device), device, warp


def flow_worker(stages, weight):
    torch, net, device, warp = load_flow(weight)
    with torch.inference_mode():
        for stage in stages:
            dest = WORK / f'age-{stage}'
            keys = np.load(dest / 'clean-keys.npz')
            for name, (key, seconds, loop) in ACTIONS.items():
                poses = keys[key]
                if name == 'eat':
                    poses = poses[:4]
                elif name == 'eatrev':
                    poses = poses[3:]
                elif name == 'wake':
                    poses = poses[::-1]
                tensors = [torch.from_numpy(p.transpose(2, 0, 1).copy()).unsqueeze(0).to(device) for p in poses]
                frames, provenance = [], []
                count = round(seconds * FPS)
                for i in range(count):
                    pos = i * len(poses) / count if loop else i * (len(poses) - 1) / (count - 1)
                    j = min(int(pos), len(poses) - 1)
                    t = pos - j
                    following = (j + 1) % len(poses)
                    selected = j if t < .5 else following
                    if t < 1e-5:
                        result = tensors[j]
                    else:
                        flow, _, _ = net(torch.cat((tensors[j], tensors[following]), 1), timestep=t,
                                         scale_list=[16, 8, 4, 2, 1])
                        # Do NOT use the model's merged RGBA output: it dissolves
                        # mismatched noses/eyes. Sample one whole texture only.
                        result = warp(tensors[selected], flow[-1][:, :2] if t < .5 else flow[-1][:, 2:4])
                    frame = result[0].cpu().numpy().transpose(1, 2, 0).clip(0, 1)
                    frames.append(opaque_rgba(frame))
                    provenance.append({'frame': i, 'pair': [j, following], 't': round(t, 6), 'source': selected})
                save_action(dest, name, frames, method='single-source RGBA warp; local RIFE geometry only; no pose blending',
                            loop=loop, sourceCountPerFrame=1, keySHA256=hashlib.sha256(poses.tobytes()).hexdigest())
                (dest / f'{name}-provenance.json').write_text(json.dumps(provenance) + '\n')


def previews(stages):
    rig = load_rig()
    for stage in stages:
        dest = WORK / f'age-{stage}'
        report = {'version': VERSION, 'fps': FPS, **json.loads((dest / 'source.json').read_text()),
                  'method': 'local geometry/rig repair; no generation/API calls', 'actions': {}}
        overview = Image.new('RGB', (6 * 256, 8 * 256), '#f6efdf')
        draw = ImageDraw.Draw(overview)
        for row, name in enumerate(['walk', *ACTIONS]):
            frames = np.load(dest / f'{name}-frames.npz')['frames']
            report['actions'][name] = json.loads((dest / f'{name}.json').read_text())
            for col, index in enumerate(np.round(np.linspace(0, len(frames) - 1, 6)).astype(int)):
                im = Image.fromarray(frames[index]).resize((256, 256), Image.Resampling.LANCZOS)
                bg = Image.new('RGB', (256, 256), '#f6efdf' if col % 2 == 0 else '#34463c')
                bg.paste(im, (0, 0), im)
                overview.paste(bg, (col * 256, row * 256))
                draw.text((col * 256 + 8, row * 256 + 8), f'age {stage} {name} {index}', fill='#b88745')
            if stage in [1, 4, 6]:
                rig.previews(dest, name, list(frames))
        overview.save(dest / 'overview.jpg', quality=95)
        (dest / 'production.json').write_text(json.dumps(report, indent=2) + '\n')


def publish():
    verification = json.loads((WORK / 'verification.json').read_text())
    assert verification['ok'] and verification['clipCount'] == 48
    verified = {(r['age'], r['action']): r['sha256'] for r in verification['clips']}
    spec = json.loads((PACK / 'pet.json').read_text())
    assert spec['version'] in ['2026-11-14.capybara-motion-v2', VERSION]
    for stage in range(1, 7):
        dest = WORK / f'age-{stage}'
        folder = PACK if stage == 1 else PACK / f'growth/{stage}'
        report = json.loads((dest / 'production.json').read_text())
        for name, info in report['actions'].items():
            source = dest / f'{name}.alpha.webm'
            assert sha(source) == info['sha256'] == verified[(stage, name)], 'Verify again after rebuilding'
            shutil.copy2(source, folder / 'videos' / source.name)
        for name in ['walk', 'sit', 'sleep']:
            shutil.copy2(dest / f'frame-{name}.png', folder / f'frames/frame-{name}.png')
        shutil.copy2(dest / 'production.json', folder / 'source/motion-repair-v3.json')
        shutil.copy2(dest / 'walk-foot-trajectories.json', folder / 'source/walk-foot-trajectories-v3.json')
        look = spec if stage == 1 else spec['growth'][str(stage)]
        look['videos']['walk']['gait'] = GAIT
    spec['version'] = VERSION
    temporary = PACK / 'pet.json.tmp'
    temporary.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(PACK / 'pet.json')
    print('Published only capybara v3 media/metadata to the source pack', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', type=int, choices=range(1, 7))
    parser.add_argument('--flow-worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--publish-only', action='store_true')
    parser.add_argument('--torch-python', type=Path, default=ROOT / 'output/family-smooth-20261113/animation-venv/bin/python')
    parser.add_argument('--weights', type=Path, default=ROOT / 'output/family-smooth-20261113/rife/model.pkl')
    args = parser.parse_args()
    stages = [args.stage] if args.stage else list(range(1, 7))
    if args.flow_worker:
        flow_worker(stages, args.weights)
    elif args.publish_only:
        assert not args.stage, 'Publish all reviewed ages together'
        publish()
    else:
        WORK.mkdir(parents=True, exist_ok=True)
        for stage in stages:
            prepare(stage)
        command = [str(args.torch_python), __file__, '--flow-worker', '--weights', str(args.weights)]
        if args.stage:
            command += ['--stage', str(args.stage)]
        subprocess.run(command, check=True)
        previews(stages)
