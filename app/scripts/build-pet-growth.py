"""Offline atlas -> reviewed RGBA keys -> RIFE -> VP9 alpha pet growth packs.

No generation/API calls. Originals and exact prompts are retained in source/.
Prepare contact sheets first; render only after reviewing those sheets.
"""
import argparse, hashlib, importlib.util, json, shutil, subprocess, sys, types
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT.parent / 'output/imagegen/pet-growth-20261114'
WORK = ROOT.parent / 'output/pet-growth-20261114'
AGES = ['baby', 'child', 'teen', 'adult', 'mature', 'senior']
ROWS = ['sit', 'walk', 'eat', 'pet', 'play', 'hug', 'sleep', 'stretch']
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--prepare', action='store_true')
parser.add_argument('--render', action='store_true')
parser.add_argument('--publish', action='store_true')
parser.add_argument('--only', help='A single job id, e.g. corgi-1, capybara-4')
parser.add_argument('--rife-dir', type=Path, default=ROOT.parent / 'output/family-smooth-20261113/rife')
args = parser.parse_args()
if args.publish and (ROOT/'assets/pets/capybara_toon/source/motion-repair-v2.json').exists():
    parser.error('Reviewed capybara motion repair is installed. This legacy atlas/RIFE publisher would overwrite it. Use repair-capybara-motion-v3.py for the current repair.')
WORK.mkdir(exist_ok=True, parents=True)

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def matte(image):
    rgb = np.asarray(image.convert('RGB')).astype('float32') / 255
    dom = np.minimum(rgb[:, :, 0], rgb[:, :, 2]) - rgb[:, :, 1]
    alpha = np.clip((.52 - dom) / .34, 0, 1)
    alpha = alpha * alpha * (3 - 2 * alpha)
    n, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > .4).astype('uint8'), 8)
    keep = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > 75]
    support = cv2.dilate(np.isin(labels, keep).astype('uint8'), np.ones((3, 3), 'uint8'))
    alpha *= support
    foreground = np.clip((rgb - (1 - alpha[:, :, None]) * [1, 0, 1]) / np.maximum(alpha[:, :, None], .015), 0, 1)
    return np.dstack((foreground, alpha)).astype('float32')

def box(frame):
    y, x = np.where(frame[:, :, 3] > .4)
    if len(x) < 500: raise ValueError('Missing sprite in atlas')
    return int(x.min()), int(y.min()), int(x.max()+1), int(y.max()+1)

def prepare(species, stage):
    job = f'{species}-{stage}'
    dest = WORK / job
    dest.mkdir(exist_ok=True)
    source = GEN / f'{species}-{AGES[stage-1]}.png'
    atlas = Image.open(source)
    if atlas.size != (2048, 2048): raise ValueError(f'{source}: unexpected size {atlas.size}')
    # Generated atlases respect the 6x8 ordering, but their gutters drift from a
    # mathematically uniform grid. Recover the actual 48 bodies before cropping.
    full = matte(atlas)
    n, labels, stats, centers = cv2.connectedComponentsWithStats((full[:, :, 3] > .4).astype('uint8'), 8)
    bodies = sorted(range(1,n), key=lambda i: stats[i,4], reverse=True)[:48]
    assert len(bodies) == 48 and min(stats[i,4] for i in bodies) > 3000, 'Incomplete body grid'
    bodies.sort(key=lambda i: centers[i,1])
    groups = [sorted(bodies[i:i+6],key=lambda j: centers[j,0]) for i in range(0,48,6)]
    ybounds = [0] + [round((max(stats[j,1]+stats[j,3] for j in groups[r-1])+min(stats[j,1] for j in groups[r]))/2) for r in range(1,8)] + [2048]
    cells = {}
    for row, name in enumerate(ROWS):
        xbounds = [0] + [round((centers[groups[row][c-1],0]+centers[groups[row][c],0])/2) for c in range(1,6)] + [2048]
        cells[name] = [matte(atlas.crop((xbounds[c],ybounds[row],xbounds[c+1],ybounds[row+1]))) for c in range(6)]
    heights = [box(f)[3]-box(f)[1] for f in cells['sit']]
    scale = 330 / float(np.median(heights))
    normalized = {}
    for name, frames in cells.items():
        normalized[name] = []
        for frame in frames:
            x0, y0, x1, y1 = box(frame)
            # Body component anchors ignore the loose ball/bowl. No per-pose resizing.
            n, labels, stats, _ = cv2.connectedComponentsWithStats((frame[:, :, 3] > .4).astype('uint8'), 8)
            body = stats[1+np.argmax(stats[1:, cv2.CC_STAT_AREA])]
            x, y, w, h, _ = body
            matrix = np.array([[scale, 0, 246-(x+w/2)*scale], [0, scale, 450-y1*scale]], 'float32')
            pre = frame.copy(); pre[:, :, :3] *= pre[:, :, 3:4]
            fitted = cv2.warpAffine(pre, matrix, (512, 512), flags=cv2.INTER_CUBIC).clip(0, 1)
            fitted[:, :, :3] /= np.maximum(fitted[:, :, 3:4], .001)
            normalized[name].append(fitted.clip(0, 1))
    # Curated single stride: planted paw moves backwards, lifts, then recovers forwards.
    # The generated forward-extending order is not a valid ground-contact cycle.
    order = [3, 2, 1, 0, 5, 4] if species == 'corgi' else [2, 1, 0, 5, 4, 3]
    normalized['walk'] = [normalized['walk'][i] for i in order]
    np.savez_compressed(dest/'keys.npz', **{k: np.stack(v) for k, v in normalized.items()})
    report = {'source': str(source.relative_to(ROOT.parent)), 'sha256': digest(source), 'model': 'gpt-image-2.6-sunburst', 'quality': 'high', 'size': [2048, 2048], 'walkKeyOrder': order, 'scale': scale, 'extractedRowBoundaries': ybounds}
    (dest/'source.json').write_text(json.dumps(report, indent=2))
    sheet = Image.new('RGB', (1536, 8*256), '#f6efdf'); draw = ImageDraw.Draw(sheet)
    for row, name in enumerate(ROWS):
        for col, frame in enumerate(normalized[name]):
            im = Image.fromarray(np.round(frame*255).astype('uint8')).resize((256,256), Image.Resampling.LANCZOS)
            bg = Image.new('RGB', (256,256), '#34463c' if col%2 else '#f6efdf'); bg.paste(im, (0,0),im)
            sheet.paste(bg,(col*256,row*256));draw.text((col*256+8,row*256+6),f'{name} {col}',fill='#d1aa6d')
    sheet.save(dest/'review.jpg', quality=94)
    print('Prepared', job, flush=True)

def load_rife():
    import torch
    import torch.nn.functional as F
    weight = args.rife_dir/'model.pkl'
    assert digest(weight) == '6615790efd627772917205db291f51cd392528a157ecbb2ecaeec3bff8eb6de2'
    device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
    torch.set_num_threads(4)
    def warp(image, flow):
        n, _, h, w = flow.shape
        x = torch.linspace(-1,1,w,device=flow.device).view(1,1,1,w).expand(n,-1,h,-1)
        y = torch.linspace(-1,1,h,device=flow.device).view(1,1,h,1).expand(n,-1,-1,w)
        grid = torch.cat((x,y),1)+torch.cat((flow[:,:1]/((w-1)/2),flow[:,1:]/((h-1)/2)),1)
        return F.grid_sample(image,grid.clamp(-1,1).permute(0,2,3,1),mode='bilinear',padding_mode='zeros',align_corners=True)
    sys.modules['model'] = types.ModuleType('model')
    sys.modules['model.warplayer'] = types.ModuleType('model.warplayer')
    sys.modules['model.warplayer'].warp = warp
    spec = importlib.util.spec_from_file_location('rife_growth',args.rife_dir/'IFNet_HDv3.py')
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    net=mod.IFNet().eval()
    state=torch.load(weight,map_location='cpu',weights_only=True)
    net.load_state_dict({k.removeprefix('module.'):v for k,v in state.items() if not k.removeprefix('module.').startswith(('teacher.','caltime.'))},strict=True)
    return torch, net.to(device), device

def action_keys(keys, repair=False):
    if repair: return {'walk': (keys['walk'], 1.2, True)}
    return {'greet':(keys['sit'],2.4,True), 'walk':(keys['walk'],1.2,True),
      'eat':(keys['eat'][:4],1.6,False), 'eatrev':(keys['eat'][3:],.8,False),
      'petted':(keys['pet'][:4],1.6,False), 'petted-out':(keys['pet'][3:],.7,False),
      'play':(keys['play'],2.4,True), 'hug':(keys['hug'],2.2,False),
      'sleep':(keys['sleep'],2.4,False), 'wake':(keys['sleep'][::-1],2.,False),
      'stretch':(keys['stretch'],2.6,False)}

def render(job, torch, net, device):
    dest=WORK/job; keys=np.load(dest/'keys.npz')
    source=json.loads((dest/'source.json').read_text())
    report={'fps':30,'method':'RIFE 4.25; articulated atlas keys, premultiplied RGBA; VP9 alpha','source':source,'actions':{}}
    for name,(poses,seconds,loop) in action_keys(keys,job=='corgi-1').items():
        path=dest/f'{name}.alpha.webm'
        key_hash=hashlib.sha256(poses.tobytes()).hexdigest()
        if path.exists() and (dest/f'{name}.json').exists():
            previous=json.loads((dest/f'{name}.json').read_text())
            if previous.get('keySHA256')==key_hash:
                report['actions'][name]=previous;continue
        tensors=[]
        for pose in poses:
            pre=pose.copy();pre[:,:,:3]*=pre[:,:,3:4]
            tensors.append(torch.from_numpy(pre.transpose(2,0,1).copy()).unsqueeze(0).to(device))
        count=round(seconds*30);frames=[]
        with torch.inference_mode():
            for i in range(count):
                pos=i*len(poses)/count if loop else i*(len(poses)-1)/(count-1)
                index=min(int(pos),len(poses)-1);t=pos-index
                if t<1e-5: f=tensors[index]
                else: f=net(torch.cat((tensors[index],tensors[(index+1)%len(poses)]),1),timestep=t,scale_list=[16,8,4,2,1])[-1][-1]
                rgba=f[0].detach().cpu().numpy().transpose(1,2,0).clip(0,1)
                rgba[:,:,:3]/=np.maximum(rgba[:,:,3:4],.015);rgba[:,:,:3][rgba[:,:,3]<.01]=0
                frames.append(np.round(rgba.clip(0,1)*255).astype('uint8'))
        subprocess.run(['ffmpeg','-y','-v','error','-f','rawvideo','-pix_fmt','rgba','-s','512x512','-r','30','-i','-','-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0','-crf','22','-b:v','0',str(path)],input=b''.join(f.tobytes() for f in frames),check=True)
        meta={'frames':count,'distinctFrames':len(set(hashlib.sha256(f.tobytes()).hexdigest() for f in frames)),'seconds':seconds,'keys':len(poses),'sha256':digest(path),'keySHA256':key_hash}
        (dest/f'{name}.json').write_text(json.dumps(meta));report['actions'][name]=meta
        if name=='walk':
            previews=[]
            for f in frames*3:
                im=Image.fromarray(f).resize((384,384));bg=Image.new('RGB',(384,384),'#f6efdf');bg.paste(im,(0,0),im);previews.append(bg)
            previews[0].save(dest/'walk-preview.gif',save_all=True,append_images=previews[1:],duration=[30,30,40]*(len(previews)//3),loop=0)
        print(job,name,meta['frames'],flush=True)
    (dest/'production.json').write_text(json.dumps(report,indent=2))

def publish(species, stage):
    breed='dog_corgi_toon' if species=='corgi' else 'capybara_toon'
    pack=ROOT/'assets/pets'/breed;dest=WORK/f'{species}-{stage}'
    keys=np.load(dest/'keys.npz');meta=json.loads((dest/'production.json').read_text())
    folder=Path('growth')/str(stage) if stage>1 else Path('.')
    for d in ['frames','videos','source/prompts']:(pack/folder/d).mkdir(parents=True,exist_ok=True)
    if species=='corgi' and stage==1:
        shutil.copy2(dest/'walk.alpha.webm',pack/'videos/walk.alpha.webm')
        (pack/'source/walk-repair.json').write_text(json.dumps(meta,indent=2))
        return None
    poses={'sit':keys['sit'][0],'walk':keys['walk'][0],'sleep':keys['sleep'][-1],
      'stretch':keys['stretch'][2],'roll':keys['play'][2],'jump':keys['hug'][2]}
    frames=[]
    for name,pose in poses.items():
        path=folder/'frames'/f'frame-{name}.png'
        Image.fromarray(np.round(pose*255).astype('uint8')).save(pack/path)
        frames.append({'key':name,'file':str(path),'bottom':box(pose)[3]/512})
    videos={}
    for name in meta['actions']:
        path=folder/'videos'/f'{name}.alpha.webm';shutil.copy2(dest/path.name,pack/path)
        videos[name]={'file':str(path),'mode':'alpha','bottom':450/512}
    avatar=folder/'avatar.png'
    Image.fromarray(np.round(keys['sit'][0]*255).astype('uint8')).crop((56,80,450,450)).resize((256,240),Image.Resampling.LANCZOS).save(pack/avatar)
    source=GEN/f'{species}-{AGES[stage-1]}.png';shutil.copy2(source,pack/folder/'source/atlas.png')
    shutil.copy2(GEN/'prompts'/f'{species}-{AGES[stage-1]}.txt',pack/folder/'source/prompts/atlas.txt')
    shutil.copy2(dest/'production.json',pack/folder/'source/production.json')
    return {'avatar':str(avatar),'frames':frames,'videos':videos}

jobs=['corgi-1']+[f'corgi-{s}' for s in range(2,7)]+[f'capybara-{s}' for s in range(1,7)]
if args.only:jobs=[job for job in jobs if job == args.only or job.startswith(args.only+'-')]
if args.prepare:
    for job in jobs:
        species,stage=job.split('-');stage=int(stage)
        if job=='corgi-1':
            dest=WORK/job;dest.mkdir(exist_ok=True)
            original=ROOT.parent/'output/family-smooth-20261113/original-keys.npz'
            poses=np.load(original)['walk'];order=[3,2,1,0,8,7]
            np.savez_compressed(dest/'keys.npz',walk=poses[order])
            (dest/'source.json').write_text(json.dumps({'source':str(original.relative_to(ROOT.parent)),'sha256':digest(original),'walkKeyOrder':order,'excludedRepeatedExtensionKeys':[4,5,6]},indent=2))
        else:prepare(species,stage)
if args.render:
    torch,net,device=load_rife()
    for job in jobs:render(job,torch,net,device)
if args.publish:
    for species in ['corgi','capybara']:
        breed='dog_corgi_toon' if species=='corgi' else 'capybara_toon';pack=ROOT/'assets/pets'/breed
        spec=json.loads((pack/'pet.json').read_text()) if (pack/'pet.json').exists() else {'id':breed,'name':'卡皮巴拉','species':'capybara','walkTransitions':False}
        spec['growth']={}
        for stage in range(1,7):
            look=publish(species,stage)
            if stage==1 and look:spec.update(look)
            elif look:spec['growth'][str(stage)]=look
        spec['version']='2026-11-14.growth-v1'
        (pack/'pet.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
        print('Published',breed,flush=True)
