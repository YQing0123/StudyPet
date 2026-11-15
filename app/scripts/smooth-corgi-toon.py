"""Offline RIFE v4.25 in-betweens. Original GIFs and poses remain unchanged.

Run build-corgi-toon.py --export-keys KEYS.npz first. RIFE code/checkpoint live
outside the shipped web app; provenance and hashes are written alongside exports.
"""
import argparse, hashlib, importlib.util, json, sys, types, subprocess
from pathlib import Path
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('--keys', type=Path, required=True)
parser.add_argument('--rife-dir', type=Path, required=True)
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('--key-curation', type=Path, help='Reviewed native-key exclusions, preserving their original timing')
parser.add_argument('--actions', default='greet,walk,eat,eatrev,petted,petted-out,play,sleep,wake')
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
weight = args.rife_dir / 'model.pkl'
expected = '6615790efd627772917205db291f51cd392528a157ecbb2ecaeec3bff8eb6de2'
assert hashlib.sha256(weight.read_bytes()).hexdigest() == expected, 'Incomplete or different checkpoint'
device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
torch.set_num_threads(4)

def warp(image, flow):
    """Backward bilinear warp with edge padding, matching RIFE warplayer."""
    n, _, h, w = flow.shape
    x = torch.linspace(-1, 1, w, device=flow.device).view(1, 1, 1, w).expand(n, -1, h, -1)
    y = torch.linspace(-1, 1, h, device=flow.device).view(1, 1, h, 1).expand(n, -1, -1, w)
    grid = torch.cat((x, y), 1) + torch.cat((flow[:, :1] / ((w-1)/2), flow[:, 1:] / ((h-1)/2)), 1)
    # Clamping normalized coordinates is border padding; this also supports MPS.
    return F.grid_sample(image, grid.clamp(-1, 1).permute(0, 2, 3, 1), mode='bilinear', padding_mode='zeros', align_corners=True)

sys.modules['model'] = types.ModuleType('model')
sys.modules['model.warplayer'] = types.ModuleType('model.warplayer')
sys.modules['model.warplayer'].warp = warp
spec = importlib.util.spec_from_file_location('rife_inference', args.rife_dir / 'IFNet_HDv3.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
net = module.IFNet().eval()
state = torch.load(weight, map_location='cpu', weights_only=True)
state={k.removeprefix('module.'):v for k,v in state.items()}
# Published checkpoint includes training-only teacher/time estimator weights.
net.load_state_dict({k:v for k,v in state.items() if not k.startswith(('teacher.','caltime.'))}, strict=True)
net.to(device)
sources = np.load(args.keys)
actions = {'greet':(sources['sit'],2.4,True), 'walk':(sources['walk'],1.8,True),
 'eat':(sources['eat'][:6],1.8,False),'eatrev':(sources['eat'][5:],.8,False),
 'petted':(sources['pet'][:6],1.8,False),'petted-out':(sources['pet'][5:],.7,False),
 'play':(sources['play'],2.6,True),'sleep':(sources['sleep'],2.4,False),
 'wake':(sources['sleep'][::-1],2.,False)}
curation = json.loads(args.key_curation.read_text()) if args.key_curation else {}
for name, policy in curation.items():
    source = sources[policy['source']]
    assert hashlib.sha256(source.tobytes()).hexdigest() == policy['normalizedKeysSHA256'], 'Curation does not match source keys'
    selected = policy['keep']
    assert selected == sorted(set(selected)) and selected[0] == 0 and selected[-1] < len(source)
    keys, seconds, loop = actions[name]
    assert loop and len(keys) == len(source)
    actions[name] = (keys[selected], seconds, loop)
report = {'method':'RIFE 4.25, arbitrary timestep, learned flow and occlusion mask, premultiplied RGBA',
 'fps':30,'checkpointSHA256':expected,'codeSHA256':hashlib.sha256((args.rife_dir/'IFNet_HDv3.py').read_bytes()).hexdigest(),
 'source':'https://huggingface.co/MonsterMMORPG/Practical-RIFE','device':str(device),'actions':{}}

if (args.out/'interpolation.json').exists():
    previous=json.loads((args.out/'interpolation.json').read_text())
    report['actions']=previous['actions']
    if previous.get('keyCuration'): report['keyCuration']=previous['keyCuration']

for action in args.actions.split(','):
    if action in curation:
        report.setdefault('keyCuration', {})[action] = curation[action]
    else:
        report.get('keyCuration', {}).pop(action, None)
    keys, seconds, loop = actions[action]
    tensors=[]
    for rgba in keys:
        pre=rgba.copy();pre[:,:,:3]*=pre[:,:,3:4]
        tensors.append(torch.from_numpy(pre.transpose(2,0,1).copy()).unsqueeze(0).to(device))
    frames=[];count=round(seconds*30)
    with torch.inference_mode():
        for i in range(count):
            if action in curation:
                policy = curation[action]
                times = policy['keep'] + [len(sources[policy['source']])]
                position = i * times[-1] / count
                index = int(np.searchsorted(times, position, side='right') - 1)
                t = (position - times[index]) / (times[index+1] - times[index])
            else:
                position=i*len(keys)/count if loop else i*(len(keys)-1)/(count-1)
                index=min(int(position),len(keys)-1);t=position-index
            if t<1e-5: frame=tensors[index]
            else:
                pair=torch.cat((tensors[index],tensors[(index+1)%len(keys)]),1)
                frame=net(pair,timestep=t,scale_list=[16,8,4,2,1])[-1][-1]
            rgba=frame[0].detach().cpu().numpy().transpose(1,2,0).clip(0,1)
            rgba[:,:,:3]/=np.maximum(rgba[:,:,3:4],.015)
            rgba[:,:,:3][rgba[:,:,3]<.01]=0
            frames.append(np.round(rgba.clip(0,1)*255).astype('uint8'))
    path=args.out/f'{action}.alpha.webm'
    subprocess.run(['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgba','-s','512x512','-r','30','-i','-',
      '-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0','-crf','20','-b:v','0',str(path)],input=b''.join(f.tobytes() for f in frames),check=True)
    hashes=[hashlib.sha256(f.tobytes()).hexdigest() for f in frames]
    changes=[float(np.mean(np.abs(frames[i].astype(float)-frames[i-1].astype(float)))) for i in range(1,count)]
    report['actions'][action]={'frames':count,'distinctFrames':len(set(hashes)),'duration':count/30,'originalKeys':len(sources[curation[action]['source']]) if action in curation else len(keys), 'usedKeys':len(keys),'meanAdjacentDifference':float(np.mean(changes)),'maxAdjacentDifference':max(changes),'bytes':path.stat().st_size}
    # Comparison includes an actual generated middle frame between native poses.
    sheet=Image.new('RGB',(1024,512),'#FBF6EA')
    for col,idx in enumerate([0,1,2,3]):
        im=Image.fromarray(frames[idx]);im.thumbnail((256,256));sheet.paste(im,(col*256,0),im)
        im=Image.fromarray(frames[count//2+idx]);im.thumbnail((256,256));sheet.paste(im,(col*256,256),im)
    sheet.save(args.out/f'{action}-inbetweens.jpg',quality=94)
    previews=[]
    for f in frames:
        bg=Image.new('RGB',(384,384),'#FBF6EA');im=Image.fromarray(f).resize((384,384));bg.paste(im,(0,0),im);previews.append(bg)
    previews[0].save(args.out/f'{action}-preview.gif',save_all=True,append_images=previews[1:],duration=[30,30,40]*(count//3)+[30]*(count%3),loop=0)
    print(action,report['actions'][action],flush=True)
    (args.out/'interpolation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
